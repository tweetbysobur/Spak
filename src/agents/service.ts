import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { hex } from "@scure/base";
import type { Db } from "../database/repositories";
import { agentChallenges, agentEvents, agents } from "../database/schema";
import { isUniqueViolation } from "../execution/records";
import { AuthError } from "../auth/types";
import { nearRpc as defaultNearRpc, verifyNearSignature, type NearRpc } from "../auth/verify/near";
import { cascadeAgentStatus } from "./cascade";

/* ----------------------------------------------------------------- constants ---------------------------------------------------------------- */

export const AGENT_STATUSES = ["CREATED", "PENDING_VERIFICATION", "VERIFIED", "SUSPENDED", "REVOKED"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export const VERIFICATION_METHOD = "NEAR_NEP413_FULL_ACCESS_KEY" as const;
export const CHALLENGE_PURPOSE = "AGENT_OWNERSHIP" as const;
export const AGENT_CHALLENGE_TTL_MS = 5 * 60_000;
/** Ownership proofs go stale: after this the identity must be re-verified before later stages may rely on it. */
export const OWNERSHIP_VALID_MS = 180 * 24 * 3600_000;
export const SCHEMA_VERSION = 1;
export const ATTESTATION_VERSION = 1;

/**
 * Lifecycle. REVOKED is terminal. SUSPENDED returns to VERIFIED only through a fresh ownership proof.
 * A failed proof never changes status.
 */
export const TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  CREATED: ["PENDING_VERIFICATION", "SUSPENDED", "REVOKED"],
  PENDING_VERIFICATION: ["VERIFIED", "SUSPENDED", "REVOKED"],
  VERIFIED: ["VERIFIED", "SUSPENDED", "REVOKED"],
  SUSPENDED: ["VERIFIED", "REVOKED"],
  REVOKED: [],
};

/* ------------------------------------------------------------------ errors ------------------------------------------------------------------ */

export const AGENT_ERRORS = {
  AGENT_NOT_FOUND: 404, AGENT_EXISTS: 409, AGENT_REVOKED: 409, AGENT_INVALID_STATE: 409, AGENT_OWNER_LOCKED: 409, AGENT_OWNER_IN_USE: 409,
  AGENT_CHALLENGE_INVALID: 400, AGENT_CHALLENGE_EXPIRED: 410, AGENT_CHALLENGE_USED: 409, AGENT_PROOF_INVALID: 401, AGENT_KEY_NOT_AUTHORIZED: 403,
  AGENT_UNSUPPORTED_METHOD: 400, AGENT_DOMAIN_MISMATCH: 400, AGENT_VERIFICATION_UNAVAILABLE: 503, AGENT_BAD_REQUEST: 400, AGENT_CONCURRENT_UPDATE: 409,
} as const;
export type AgentErrorCode = keyof typeof AGENT_ERRORS;
export class AgentError extends Error {
  readonly status: number;
  constructor(readonly code: AgentErrorCode, message: string) { super(message); this.name = "AgentError"; this.status = AGENT_ERRORS[code]; }
}

/* ------------------------------------------------------------------ helpers ----------------------------------------------------------------- */

type Row = typeof agents.$inferSelect;
const newId = (p: string) => `${p}_${randomBytes(12).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Stable JSON: keys sorted at every level. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
/** NEAR account ids: 2 to 64 chars of a-z 0-9 . - _, per docs.near.org. Implicit (64 hex) included. */
export const NEAR_ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** The exact text the owner signs. Every binding is in the signed bytes: Agent, user reference, account, domain, purpose, times, challenge. */
export function ownershipMessage(c: { agentId: string; userRef: string; accountId: string; domain: string; issuedAt: string; expiresAt: string; challengeId: string }) {
  return [
    "SPak Agent ownership verification",
    "",
    "Sign to prove you control this NEAR account for your SPak Agent.",
    "This is not a transaction. It grants no permission to move funds.",
    "",
    `Agent: ${c.agentId}`,
    `Owner: ${c.userRef}`,
    `NEAR account: ${c.accountId}`,
    `Purpose: ${CHALLENGE_PURPOSE}`,
    `Method: ${VERIFICATION_METHOD}`,
    `Domain: ${c.domain}`,
    `Issued At: ${c.issuedAt}`,
    `Expires At: ${c.expiresAt}`,
    `Challenge: ${c.challengeId}`,
  ].join("\n");
}

/** Privacy-preserving reference to the SPak user, used in signed messages and attestations instead of the raw id. */
export const userRef = (userId: string) => `spak-user:${sha256(`spak.agent.owner:${userId}`).slice(0, 32)}`;

/** Ownership counts for later stages only when verified, not suspended or revoked, and not expired. */
export function ownershipCurrent(a: Pick<Row, "status" | "verificationExpiresAt">, now: Date): boolean {
  return a.status === "VERIFIED" && !!a.verificationExpiresAt && a.verificationExpiresAt.getTime() > now.getTime();
}

export interface AgentView {
  id: string; displayName: string; status: AgentStatus; schemaVersion: number; createdAt: string; updatedAt: string;
  suspendedAt: string | null; revokedAt: string | null;
  ownership: {
    state: "NOT_VERIFIED" | "VERIFIED" | "EXPIRED" | "SUSPENDED" | "REVOKED";
    network: string | null; accountId: string | null; publicKey: string | null; method: string | null;
    verifiedAt: string | null; expiresAt: string | null; attestationHash: string | null;
    /** Where the attestation lives. Stage 5: SPak's database only. Never presented as on chain. */
    attestationLocation: "OFF_CHAIN" | null;
  };
  /** Stage 5 has no dedicated Agent NEAR account. */
  dedicatedAccount: { state: "NOT_AVAILABLE" };
  /** Stage 5 grants nothing. */
  permissions: "NONE";
}

export function toView(a: Row, now: Date): AgentView {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const state = a.status === "REVOKED" ? "REVOKED" : a.status === "SUSPENDED" ? "SUSPENDED" : a.status !== "VERIFIED" ? "NOT_VERIFIED" : ownershipCurrent(a, now) ? "VERIFIED" : "EXPIRED";
  return {
    id: a.id, displayName: a.displayName, status: a.status as AgentStatus, schemaVersion: a.schemaVersion, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(),
    suspendedAt: iso(a.suspendedAt), revokedAt: iso(a.revokedAt),
    ownership: {
      state, network: a.ownerNetwork, accountId: a.ownerAccountId, publicKey: a.ownerPublicKey, method: a.verificationMethod,
      verifiedAt: iso(a.verifiedAt), expiresAt: iso(a.verificationExpiresAt), attestationHash: a.attestationHash, attestationLocation: a.attestationHash ? "OFF_CHAIN" : null,
    },
    dedicatedAccount: { state: "NOT_AVAILABLE" },
    permissions: "NONE",
  };
}

/* ------------------------------------------------------------------ service ----------------------------------------------------------------- */

export interface AgentServiceOptions { clock?: () => Date; nearRpc?: NearRpc }

/**
 * Agent Identity Service. Every method takes the user id from the caller's server-side session and scopes every
 * read and write to it. Another user's Agent is "not found".
 *
 * Separate concepts, kept separate:
 * - Application login (session) lets a user create, view, suspend and revoke their Agent.
 * - Ownership proof (NEP-413 from a full-access key, checked on chain) is the only thing that sets owner fields
 *   and VERIFIED. A login never counts as one.
 * - Nothing here grants transaction permissions, signs anything, or touches SPak Guard.
 */
export class AgentService {
  private readonly clock: () => Date;
  private readonly rpc: NearRpc;
  constructor(private readonly db: Db, opts: AgentServiceOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.rpc = opts.nearRpc ?? defaultNearRpc();
  }

  private async event(q: Db, a: Pick<Row, "id" | "userId">, event: string, from: string | null, to: string | null, data: Record<string, unknown> = {}) {
    await q.insert(agentEvents).values({ agentId: a.id, userId: a.userId, event, fromStatus: from, toStatus: to, data, at: this.clock() });
  }

  /** The user's own Agent by id, or AGENT_NOT_FOUND. */
  private async own(userId: string, agentId: string, q: Db = this.db): Promise<Row> {
    const [a] = await q.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.userId, userId))).limit(1);
    if (!a) throw new AgentError("AGENT_NOT_FOUND", "No such Agent.");
    return a;
  }
  private live(a: Row) {
    if (a.status === "REVOKED") throw new AgentError("AGENT_REVOKED", "This Agent was revoked. Revocation is permanent; create a new Agent.");
  }

  /** Compare-and-set on status and version, with an audit event, in one transaction. */
  private async move(a: Row, to: AgentStatus, event: string, patch: Partial<typeof agents.$inferInsert>, data: Record<string, unknown> = {}) {
    if (!TRANSITIONS[a.status as AgentStatus].includes(to)) throw new AgentError("AGENT_INVALID_STATE", `An Agent that is ${a.status.toLowerCase().replaceAll("_", " ")} cannot become ${to.toLowerCase().replaceAll("_", " ")}.`);
    const now = this.clock();
    return this.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [r] = await tx.update(agents).set({ ...patch, status: to, version: a.version + 1, updatedAt: now })
        .where(and(eq(agents.id, a.id), eq(agents.userId, a.userId), eq(agents.status, a.status), eq(agents.version, a.version))).returning();
      if (!r) throw new AgentError("AGENT_CONCURRENT_UPDATE", "This Agent changed in another request. Reload and try again.");
      await this.event(tx, r, event, a.status, to, data);
      // Wallet associations follow the Agent in the same transaction.
      await cascadeAgentStatus(tx, r, a.status, to, now);
      return r;
    });
  }

  async create(userId: string, displayName: string) {
    const name = displayName.trim();
    if (name.length < 2 || name.length > 40 || /[\u0000-\u001f]/.test(name)) throw new AgentError("AGENT_BAD_REQUEST", "Name the Agent with 2 to 40 characters.");
    const now = this.clock();
    try {
      const row = await this.db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const [r] = await tx.insert(agents).values({ id: newId("agt"), userId, displayName: name, status: "CREATED", schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now }).returning();
        await this.event(tx, r, "CREATED", null, "CREATED", { displayName: name, schemaVersion: SCHEMA_VERSION });
        return r;
      });
      return toView(row, now);
    } catch (e) {
      if (isUniqueViolation(e)) throw new AgentError("AGENT_EXISTS", "You already have an Agent. Revoke it before creating another.");
      throw e;
    }
  }

  /** The user's live Agent (null if none), plus revoked ones as history. */
  async current(userId: string) {
    const rows = await this.db.select().from(agents).where(eq(agents.userId, userId)).orderBy(desc(agents.createdAt));
    const now = this.clock();
    return { agent: rows.find((r) => r.status !== "REVOKED") ? toView(rows.find((r) => r.status !== "REVOKED")!, now) : null, revoked: rows.filter((r) => r.status === "REVOKED").map((r) => toView(r, now)) };
  }

  async get(userId: string, agentId: string) { return toView(await this.own(userId, agentId), this.clock()); }

  async events(userId: string, agentId: string) {
    await this.own(userId, agentId);
    return this.db.select({ id: agentEvents.id, event: agentEvents.event, fromStatus: agentEvents.fromStatus, toStatus: agentEvents.toStatus, data: agentEvents.data, at: agentEvents.at })
      .from(agentEvents).where(and(eq(agentEvents.agentId, agentId), eq(agentEvents.userId, userId))).orderBy(asc(agentEvents.id));
  }

  /**
   * Issue a one-time ownership challenge for a NEAR account. The account is bound into the signed message.
   * Once an Agent has a verified owner account it is locked to that account: another account needs a new Agent.
   */
  async challenge(userId: string, agentId: string, input: { accountId: string; domain: string }) {
    const a = await this.own(userId, agentId);
    this.live(a);
    const accountId = input.accountId.trim().toLowerCase();
    if (!NEAR_ACCOUNT_RE.test(accountId)) throw new AgentError("AGENT_BAD_REQUEST", "That is not a valid NEAR account id.");
    if (a.ownerAccountId && a.ownerAccountId !== accountId) {
      throw new AgentError("AGENT_OWNER_LOCKED", `This Agent is owned by ${a.ownerAccountId}. To use another NEAR account, revoke it and create a new Agent.`);
    }
    const now = this.clock();
    const issuedAt = now.toISOString(), expiresAt = new Date(now.getTime() + AGENT_CHALLENGE_TTL_MS).toISOString();
    const id = newId("ach");
    const message = ownershipMessage({ agentId: a.id, userRef: userRef(userId), accountId, domain: input.domain, issuedAt, expiresAt, challengeId: id });
    const nonce = hex.encode(randomBytes(32));
    await this.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      await tx.insert(agentChallenges).values({ id, agentId: a.id, userId, purpose: CHALLENGE_PURPOSE, method: VERIFICATION_METHOD, ownerAccountId: accountId, recipient: input.domain, nonce, message, issuedAt: now, expiresAt: new Date(expiresAt) });
      await this.event(tx, a, "CHALLENGE_ISSUED", a.status, a.status, { challengeId: id, accountId });
    });
    if (a.status === "CREATED") await this.move(a, "PENDING_VERIFICATION", "VERIFICATION_STARTED", {}, { challengeId: id });
    return { challengeId: id, method: VERIFICATION_METHOD, message, nonce: Buffer.from(nonce, "hex").toString("base64"), recipient: input.domain, accountId, expiresAt };
  }

  /**
   * Verify an ownership proof. The challenge is consumed atomically first, so it can be used once even under
   * concurrent submissions. Anything that cannot be verified fails closed and leaves the status unchanged.
   */
  async verify(userId: string, agentId: string, input: { challengeId: string; method: string; accountId: string; publicKey: string; signature: string; domain: string }) {
    if (input.method !== VERIFICATION_METHOD) throw new AgentError("AGENT_UNSUPPORTED_METHOD", "Only NEAR NEP-413 signatures from a full-access key are supported.");
    const a = await this.own(userId, agentId);
    this.live(a);
    const now = this.clock();
    const [c] = await this.db.select().from(agentChallenges).where(eq(agentChallenges.id, input.challengeId)).limit(1);
    // A challenge for another Agent or another user is indistinguishable from a missing one.
    if (!c || c.agentId !== a.id || c.userId !== userId) throw new AgentError("AGENT_CHALLENGE_INVALID", "That challenge is not valid for this Agent.");
    if (c.usedAt) throw new AgentError("AGENT_CHALLENGE_USED", "That challenge was already used. Request a new one.");
    if (c.expiresAt.getTime() <= now.getTime()) throw new AgentError("AGENT_CHALLENGE_EXPIRED", "That challenge expired. Request a new one.");
    if (c.recipient !== input.domain) throw new AgentError("AGENT_DOMAIN_MISMATCH", "That challenge was issued for another site.");
    const [claimed] = await this.db.update(agentChallenges).set({ usedAt: now })
      .where(and(eq(agentChallenges.id, c.id), isNull(agentChallenges.usedAt), gt(agentChallenges.expiresAt, now))).returning();
    if (!claimed) throw new AgentError("AGENT_CHALLENGE_USED", "That challenge was already used. Request a new one.");

    const fail = async (code: AgentErrorCode, message: string, reason: string) => {
      await this.db.update(agentChallenges).set({ outcome: "FAILED" }).where(eq(agentChallenges.id, c.id));
      await this.event(this.db, a, "VERIFICATION_FAILED", a.status, a.status, { challengeId: c.id, reason });
      return new AgentError(code, message);
    };
    // The proof must be for the exact account the challenge names.
    if (input.accountId.trim().toLowerCase() !== c.ownerAccountId) throw await fail("AGENT_PROOF_INVALID", "The signature is for a different NEAR account than this challenge.", "ACCOUNT_MISMATCH");
    let ok: boolean;
    try {
      ok = await verifyNearSignature({ accountId: c.ownerAccountId, publicKey: input.publicKey, signatureB64: input.signature, message: c.message, nonceHex: c.nonce, recipient: c.recipient, rpc: this.rpc });
    } catch (e) {
      if (e instanceof AuthError && e.code === "KEY_NOT_AUTHORIZED") throw await fail("AGENT_KEY_NOT_AUTHORIZED", e.message, "KEY_NOT_FULL_ACCESS");
      if (e instanceof AuthError && e.code === "NEAR_RPC_UNAVAILABLE") throw await fail("AGENT_VERIFICATION_UNAVAILABLE", "SPak could not confirm the key on NEAR, so ownership was not verified. Try again.", "NEAR_RPC_UNAVAILABLE");
      throw await fail("AGENT_PROOF_INVALID", "The signature could not be verified.", "SIGNATURE_ERROR");
    }
    if (!ok) throw await fail("AGENT_PROOF_INVALID", "The signature does not match this challenge and key.", "SIGNATURE_INVALID");

    // Verified: record the attestation (off chain) and move to VERIFIED in one transaction.
    const fresh = await this.own(userId, agentId);
    this.live(fresh);
    const verifiedAt = this.clock();
    const attestation = {
      type: "spak.agent.ownership", v: ATTESTATION_VERSION, agentId: a.id, owner: userRef(userId), network: "near", accountId: c.ownerAccountId,
      publicKey: input.publicKey, method: VERIFICATION_METHOD, challengeId: c.id, recipient: c.recipient, messageSha256: sha256(c.message),
      signature: input.signature, verifiedAt: verifiedAt.toISOString(),
    };
    const attestationHash = sha256(canonical(attestation));
    try {
      const r = await this.move(fresh, "VERIFIED", fresh.status === "VERIFIED" ? "REVERIFIED" : fresh.status === "SUSPENDED" ? "RESUMED_BY_PROOF" : "VERIFIED", {
        ownerNetwork: "near", ownerAccountId: c.ownerAccountId, ownerPublicKey: input.publicKey, verificationMethod: VERIFICATION_METHOD,
        verifiedAt, verificationExpiresAt: new Date(verifiedAt.getTime() + OWNERSHIP_VALID_MS), attestationHash, attestation, suspendedAt: null,
      }, { challengeId: c.id, accountId: c.ownerAccountId, publicKey: input.publicKey, attestationHash });
      await this.db.update(agentChallenges).set({ outcome: "VERIFIED" }).where(eq(agentChallenges.id, c.id));
      return toView(r, verifiedAt);
    } catch (e) {
      if (isUniqueViolation(e)) throw await fail("AGENT_OWNER_IN_USE", "That NEAR account already owns another SPak Agent.", "OWNER_IN_USE");
      throw e;
    }
  }

  /** Suspend: takes authority away, so a session is enough. Resuming needs a fresh ownership proof. */
  async suspend(userId: string, agentId: string) {
    const a = await this.own(userId, agentId);
    this.live(a);
    if (a.status === "SUSPENDED") return toView(a, this.clock());
    const r = await this.move(a, "SUSPENDED", "SUSPENDED", { suspendedAt: this.clock() });
    await this.expireChallenges(a.id);
    return toView(r, this.clock());
  }

  /** Revoke: permanent. Requires typing REVOKE. Open challenges are closed. */
  async revoke(userId: string, agentId: string, confirm: string) {
    if (confirm !== "REVOKE") throw new AgentError("AGENT_BAD_REQUEST", "Type REVOKE to confirm. Revocation is permanent.");
    const a = await this.own(userId, agentId);
    this.live(a);
    const r = await this.move(a, "REVOKED", "REVOKED", { revokedAt: this.clock() });
    await this.expireChallenges(a.id);
    return toView(r, this.clock());
  }

  private async expireChallenges(agentId: string) {
    await this.db.update(agentChallenges).set({ usedAt: this.clock(), outcome: "FAILED" })
      .where(and(eq(agentChallenges.agentId, agentId), isNull(agentChallenges.usedAt)));
  }
}
