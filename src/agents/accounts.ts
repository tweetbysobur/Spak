import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { hex } from "@scure/base";
import type { Db } from "../database/repositories";
import { agentAccountChallenges, agentAccounts, agentEvents, agents } from "../database/schema";
import { isUniqueViolation } from "../execution/records";
import { AuthError } from "../auth/types";
import { nearRpc as defaultNearRpc, verifyNearSignature, type NearRpc } from "../auth/verify/near";
import { AgentError, ownershipCurrent, userRef } from "./service";
import { NearUnavailable, type AgentAccountConfig, type AgentNearChain } from "./near-chain";

export const ACCOUNT_STATUSES = ["NOT_CREATED", "CREATION_PENDING", "CREATED", "OWNERSHIP_VERIFICATION_PENDING", "ACTIVE", "SUSPENDED", "RECOVERY_REQUIRED", "REVOKED", "CREATION_FAILED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Valid transitions. REVOKED and CREATION_FAILED are final for their row; a retry after failure is a new row. */
export const ACCOUNT_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  NOT_CREATED: ["CREATION_PENDING"],
  CREATION_PENDING: ["CREATION_PENDING", "CREATED", "CREATION_FAILED", "REVOKED"],
  CREATED: ["OWNERSHIP_VERIFICATION_PENDING", "SUSPENDED", "REVOKED"],
  OWNERSHIP_VERIFICATION_PENDING: ["ACTIVE", "RECOVERY_REQUIRED", "SUSPENDED", "REVOKED"],
  ACTIVE: ["ACTIVE", "RECOVERY_REQUIRED", "SUSPENDED", "REVOKED"],
  SUSPENDED: ["OWNERSHIP_VERIFICATION_PENDING", "REVOKED"],
  RECOVERY_REQUIRED: ["OWNERSHIP_VERIFICATION_PENDING", "SUSPENDED", "REVOKED"],
  REVOKED: [],
  CREATION_FAILED: [],
};

export const ACCOUNT_CHALLENGE_TTL_MS = 5 * 60_000;
/** Abuse control: account creation attempts per user in 24 hours (failed attempts count). */
export const MAX_ATTEMPTS_PER_DAY = 3;
const NAME_ATTEMPTS = 4;

type Row = typeof agentAccounts.$inferSelect;
const newId = (p: string) => `${p}_${randomBytes(12).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Deterministic, collision-resistant, non-personal name: "a" + hex of sha256(agent id, parent, attempt).
 * Nothing about the user is in it. A taken name moves to the next attempt (a longer hash).
 */
export function agentAccountName(agentId: string, parent: string, attempt = 0) {
  return `a${sha256(`spak.agent.account:${agentId}:${parent}`).slice(0, 16 + attempt * 4)}.${parent}`;
}

export function consentMessage(c: { agentId: string; userRef: string; accountId: string; ownerPublicKey: string; network: string; domain: string; issuedAt: string; expiresAt: string; challengeId: string }) {
  return [
    "SPak dedicated Agent account",
    "",
    "Sign to approve creating this NEAR account for your SPak Agent.",
    "Your key below becomes its only full-access key. SPak gets no key on it and cannot sign for it.",
    "This is not a transaction. SPak pays the creation on testnet.",
    "",
    `Agent: ${c.agentId}`,
    `Owner: ${c.userRef}`,
    `Account: ${c.accountId}`,
    `Network: ${c.network}`,
    `Owner key: ${c.ownerPublicKey}`,
    `Purpose: AGENT_ACCOUNT_CREATION`,
    `Domain: ${c.domain}`,
    `Issued At: ${c.issuedAt}`,
    `Expires At: ${c.expiresAt}`,
    `Challenge: ${c.challengeId}`,
  ].join("\n");
}

export interface AccountView {
  id: string; status: AccountStatus; network: string; accountId: string; parentAccountId: string; ownerPublicKey: string; keyType: string;
  sponsorship: string; creationTxHash: string | null; creationOutcome: string | null; creationError: string | null;
  createdOnChainAt: string | null; ownershipVerifiedAt: string | null; activatedAt: string | null; lastVerifiedAt: string | null; recoveryReason: string | null;
  createdAt: string; signingAuthority: "OWNER_ONLY";
}
export function toAccountView(r: Row): AccountView {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: r.id, status: r.status as AccountStatus, network: r.network, accountId: r.accountId, parentAccountId: r.parentAccountId, ownerPublicKey: r.ownerPublicKey, keyType: r.keyType,
    sponsorship: r.sponsorship, creationTxHash: r.creationTxHash, creationOutcome: r.creationOutcome, creationError: r.creationError,
    createdOnChainAt: iso(r.createdOnChainAt), ownershipVerifiedAt: iso(r.ownershipVerifiedAt), activatedAt: iso(r.activatedAt), lastVerifiedAt: iso(r.lastVerifiedAt),
    recoveryReason: r.recoveryReason, createdAt: r.createdAt.toISOString(), signingAuthority: "OWNER_ONLY",
  };
}

export interface AgentAccountDeps { db: Db; config: AgentAccountConfig | { unavailable: string }; chain: AgentNearChain | null; clock?: () => Date; ownerRpc?: NearRpc }

/**
 * Dedicated Agent NEAR accounts (Stage 7), testnet only.
 *
 * - Creation needs a verified, in-date, active Agent and a fresh NEP-413 consent from the Agent owner's verified key,
 *   naming the exact account. A session alone cannot create an account.
 * - SPak's parent account sends one transaction: CreateAccount + Transfer + AddKey(owner key, FullAccess). No key of
 *   SPak's is ever added. Atomic per NEAR's transaction rules.
 * - ACTIVE only after the backend reads the account from NEAR and finds the owner key with full access and no
 *   SPak parent key. Submission success alone never counts.
 * - Nothing here grants permissions, signs for the user or touches SPak Guard.
 */
export class AgentAccountService {
  private readonly clock: () => Date;
  private readonly ownerRpc: NearRpc;
  constructor(private readonly d: AgentAccountDeps) {
    this.clock = d.clock ?? (() => new Date());
    this.ownerRpc = d.ownerRpc ?? defaultNearRpc();
  }

  private get cfg(): AgentAccountConfig | null { return "unavailable" in this.d.config ? null : this.d.config; }
  private unavailable(): never {
    throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", "unavailable" in this.d.config ? this.d.config.unavailable : "Dedicated Agent accounts are not available.");
  }

  private async agent(userId: string, agentId: string, q: Db = this.d.db, lock = false) {
    const base = q.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.userId, userId))).limit(1);
    const [a] = lock ? await base.for("update") : await base;
    if (!a) throw new AgentError("AGENT_NOT_FOUND", "No such Agent.");
    return a;
  }
  private eligible(a: typeof agents.$inferSelect) {
    if (a.status === "REVOKED") throw new AgentError("AGENT_REVOKED", "This Agent was revoked.");
    if (a.status !== "VERIFIED" || !ownershipCurrent(a, this.clock()) || !a.ownerPublicKey) throw new AgentError("AGENT_INVALID_STATE", "Verify ownership of this Agent before creating its NEAR account.");
  }
  private async event(q: Db, a: { id: string; userId: string }, event: string, from: string | null, to: string | null, data: Record<string, unknown>) {
    await q.insert(agentEvents).values({ agentId: a.id, userId: a.userId, event, fromStatus: from, toStatus: to, data, at: this.clock() });
  }
  private async live(agentId: string, userId: string, q: Db = this.d.db) {
    const [r] = await q.select().from(agentAccounts).where(and(eq(agentAccounts.agentId, agentId), eq(agentAccounts.userId, userId), ne(agentAccounts.status, "CREATION_FAILED"))).limit(1);
    return r ?? null;
  }

  /** Compare-and-set state change with an audit event. */
  private async move(r: Row, to: AccountStatus, patch: Partial<typeof agentAccounts.$inferInsert>, data: Record<string, unknown> = {}, q: Db = this.d.db) {
    if (!ACCOUNT_TRANSITIONS[r.status as AccountStatus].includes(to)) throw new AgentError("AGENT_INVALID_STATE", `The account cannot move from ${r.status} to ${to}.`);
    const [u] = await q.update(agentAccounts).set({ ...patch, status: to, version: r.version + 1, updatedAt: this.clock() })
      .where(and(eq(agentAccounts.id, r.id), eq(agentAccounts.version, r.version))).returning();
    if (!u) throw new AgentError("AGENT_CONCURRENT_UPDATE", "The account changed in another request. Reload.");
    await this.event(q, { id: r.agentId, userId: r.userId }, `ACCOUNT_${to}`, r.status, to, { accountRowId: r.id, accountId: r.accountId, ...data });
    return u;
  }

  async view(userId: string, agentId: string) {
    const a = await this.agent(userId, agentId);
    const rows = await this.d.db.select().from(agentAccounts).where(and(eq(agentAccounts.agentId, agentId), eq(agentAccounts.userId, userId))).orderBy(desc(agentAccounts.createdAt));
    const live = rows.find((r) => r.status !== "CREATION_FAILED");
    const availability = this.cfg ? (a.status === "VERIFIED" && ownershipCurrent(a, this.clock()) ? "AVAILABLE" : "AGENT_NOT_VERIFIED") : "UNAVAILABLE";
    return {
      availability, unavailableReason: this.cfg ? null : (this.d.config as { unavailable: string }).unavailable, network: this.cfg?.network ?? null,
      account: live ? toAccountView(live) : null, failedAttempts: rows.filter((r) => r.status === "CREATION_FAILED").map(toAccountView),
    };
  }

  /** Name the account and issue the owner's consent challenge. Needs NEAR to confirm the name is free. */
  async prepare(userId: string, agentId: string, domain: string) {
    const cfg = this.cfg ?? this.unavailable();
    const a = await this.agent(userId, agentId);
    this.eligible(a);
    const existing = await this.live(agentId, userId);
    if (existing) throw new AgentError("AGENT_EXISTS", "This Agent already has a dedicated account.");
    const chain = this.d.chain ?? this.unavailable();
    let accountId: string | null = null;
    try {
      if ((await chain.chainId()) !== "testnet") throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", "The configured NEAR network is not testnet.");
      for (let i = 0; i < NAME_ATTEMPTS && !accountId; i++) {
        const name = agentAccountName(a.id, cfg.parentAccountId, i);
        const [taken] = await this.d.db.select({ id: agentAccounts.id }).from(agentAccounts).where(and(eq(agentAccounts.accountId, name), ne(agentAccounts.agentId, a.id))).limit(1);
        if (!taken && !(await chain.viewAccount(name))) accountId = name;
      }
    } catch (e) { if (e instanceof AgentError) throw e; throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", "NEAR testnet could not be reached. Nothing was created."); }
    if (!accountId) throw new AgentError("AGENT_OWNER_IN_USE", "No free account name was found. Try again later.");
    const now = this.clock(), id = newId("aac"), expiresAt = new Date(now.getTime() + ACCOUNT_CHALLENGE_TTL_MS);
    const message = consentMessage({ agentId: a.id, userRef: userRef(userId), accountId, ownerPublicKey: a.ownerPublicKey!, network: cfg.network, domain, issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), challengeId: id });
    const nonce = hex.encode(randomBytes(32));
    await this.d.db.insert(agentAccountChallenges).values({ id, agentId: a.id, userId, accountId, ownerPublicKey: a.ownerPublicKey!, domain, nonce, message, issuedAt: now, expiresAt });
    await this.event(this.d.db, a, "ACCOUNT_CONSENT_ISSUED", null, null, { challengeId: id, accountId });
    return {
      challengeId: id, accountId, network: cfg.network, parentAccountId: cfg.parentAccountId, ownerAccountId: a.ownerAccountId, ownerPublicKey: a.ownerPublicKey,
      initialBalanceYocto: cfg.initialBalanceYocto, message, nonce: Buffer.from(nonce, "hex").toString("base64"), recipient: domain, expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verify the owner's consent, reserve sponsorship under a lock, create the account in one transaction, then verify
   * it independently. Idempotent per key and per Agent: a repeat returns the existing account.
   */
  async create(userId: string, agentId: string, input: { challengeId: string; accountId: string; publicKey: string; signature: string; idempotencyKey: string; domain: string }) {
    const cfg = this.cfg ?? this.unavailable();
    const chain = this.d.chain ?? this.unavailable();
    const [byKey] = await this.d.db.select().from(agentAccounts).where(and(eq(agentAccounts.idempotencyKey, input.idempotencyKey), eq(agentAccounts.userId, userId))).limit(1);
    if (byKey) return toAccountView(byKey);
    const a = await this.agent(userId, agentId);
    this.eligible(a);
    const existing = await this.live(agentId, userId);
    if (existing) return toAccountView(existing);

    // 1. Consent: single use, this Agent, this user, this domain, signed by the Agent owner's verified key.
    const now = this.clock();
    const [c] = await this.d.db.select().from(agentAccountChallenges).where(eq(agentAccountChallenges.id, input.challengeId)).limit(1);
    if (!c || c.agentId !== a.id || c.userId !== userId) throw new AgentError("AGENT_CHALLENGE_INVALID", "That consent request is not valid for this Agent.");
    if (c.domain !== input.domain) throw new AgentError("AGENT_DOMAIN_MISMATCH", "That consent was issued for another site.");
    const [claimed] = await this.d.db.update(agentAccountChallenges).set({ usedAt: now })
      .where(and(eq(agentAccountChallenges.id, c.id), isNull(agentAccountChallenges.usedAt), gt(agentAccountChallenges.expiresAt, now))).returning();
    if (!claimed) throw new AgentError(c.usedAt ? "AGENT_CHALLENGE_USED" : "AGENT_CHALLENGE_EXPIRED", "That consent request was used or expired. Start again.");
    if (input.accountId !== a.ownerAccountId || input.publicKey !== c.ownerPublicKey || c.ownerPublicKey !== a.ownerPublicKey) {
      throw new AgentError("AGENT_PROOF_INVALID", "The consent must be signed by the Agent owner's verified key.");
    }
    try {
      const ok = await verifyNearSignature({ accountId: a.ownerAccountId!, publicKey: input.publicKey, signatureB64: input.signature, message: c.message, nonceHex: c.nonce, recipient: c.domain, rpc: this.ownerRpc });
      if (!ok) throw new AgentError("AGENT_PROOF_INVALID", "The consent signature does not match.");
    } catch (e) {
      if (e instanceof AgentError) throw e;
      if (e instanceof AuthError && e.code === "KEY_NOT_AUTHORIZED") throw new AgentError("AGENT_KEY_NOT_AUTHORIZED", "The owner key no longer has full access to the owner account. Verify ownership again.");
      throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", "SPak could not confirm the owner key on NEAR. Nothing was created.");
    }

    // 2. Reserve: lock the Agent row and the sponsorship budget; enforce per-user limits; insert CREATION_PENDING.
    let row: Row;
    try {
      row = await this.d.db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const locked = await this.agent(userId, agentId, tx, true);
        this.eligible(locked);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('spak_agent_sponsorship'))`);
        const [{ attempts }] = await tx.select({ attempts: sql<number>`count(*)::int` }).from(agentAccounts)
          .where(and(eq(agentAccounts.userId, userId), gt(agentAccounts.createdAt, new Date(now.getTime() - 24 * 3600_000))));
        if (attempts >= MAX_ATTEMPTS_PER_DAY) throw new AgentError("AGENT_BAD_REQUEST", "Too many account creation attempts today. Try again tomorrow.");
        const [{ spent }] = await tx.select({ spent: sql<string>`coalesce(sum(cast(${agentAccounts.fundingYocto} as numeric)), 0)::text` }).from(agentAccounts)
          .where(inArray(agentAccounts.sponsorship, ["RESERVED", "FUNDED"]));
        if (BigInt(spent.split(".")[0]) + BigInt(cfg.initialBalanceYocto) > BigInt(cfg.budgetYocto)) throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", "The testnet sponsorship budget is used up. Nothing was created.");
        const [r] = await tx.insert(agentAccounts).values({
          id: newId("aga"), agentId: a.id, userId, network: cfg.network, accountId: c.accountId, parentAccountId: cfg.parentAccountId, ownerPublicKey: c.ownerPublicKey,
          keyType: "ed25519", status: "CREATION_PENDING", sponsorship: "RESERVED", fundingYocto: cfg.initialBalanceYocto, idempotencyKey: input.idempotencyKey, createdAt: now, updatedAt: now,
        }).returning();
        await this.event(tx, a, "ACCOUNT_CREATION_PENDING", "NOT_CREATED", "CREATION_PENDING", { accountRowId: r.id, accountId: r.accountId, consentChallengeId: c.id });
        return r;
      });
    } catch (e) {
      if (isUniqueViolation(e)) { const r = await this.live(agentId, userId); if (r) return toAccountView(r); throw new AgentError("AGENT_OWNER_IN_USE", "That account name was taken. Start again."); }
      throw e;
    }

    // 3. Preflight on chain: testnet, parent authority, name still free.
    try {
      if ((await chain.chainId()) !== "testnet") return toAccountView(await this.fail(row, "WRONG_NETWORK"));
      const parentKeys = await chain.accessKeys(cfg.parentAccountId);
      if (!parentKeys.some((k) => k.publicKey === chain.parentPublicKey() && k.permission === "FullAccess")) return toAccountView(await this.fail(row, "PARENT_NOT_AUTHORIZED"));
      if (await chain.viewAccount(row.accountId)) return toAccountView(await this.fail(row, "NAME_TAKEN"));
    } catch { return toAccountView(await this.fail(row, "NEAR_UNREACHABLE")); }

    // 4. One transaction: CreateAccount + Transfer + AddKey(owner, FullAccess).
    const out = await chain.createSubAccount({ newAccountId: row.accountId, ownerPublicKey: row.ownerPublicKey, amountYocto: row.fundingYocto! });
    if (out.outcome === "FAILURE") return toAccountView(await this.fail(row, "TRANSACTION_FAILED", out.txHash));
    if (out.outcome === "UNKNOWN") {
      row = await this.move(row, "CREATION_PENDING", { creationTxHash: out.txHash, creationOutcome: "UNKNOWN", creationError: out.error ?? null }, { outcome: "UNKNOWN" });
      return toAccountView(await this.reconcile(row));
    }
    row = await this.move(row, "CREATED", { creationTxHash: out.txHash, creationOutcome: "SUCCESS", createdOnChainAt: this.clock(), sponsorship: "FUNDED" }, { txHash: out.txHash });
    return toAccountView(await this.verifyRow(row));
  }

  private async fail(r: Row, reason: string, txHash: string | null = null) {
    return this.move(r, "CREATION_FAILED", { creationOutcome: txHash || reason === "TRANSACTION_FAILED" ? "FAILURE" : null, creationTxHash: txHash, creationError: reason, sponsorship: "NOT_SPENT" }, { reason });
  }

  /** A creation whose outcome is unknown: look at the transaction and the account itself. Never guesses. */
  private async reconcile(r: Row): Promise<Row> {
    const chain = this.d.chain!;
    let exists: boolean;
    try { exists = !!(await chain.viewAccount(r.accountId)); } catch { return r; }
    const tx = r.creationTxHash ? await chain.txStatus(r.creationTxHash, r.parentAccountId) : "UNKNOWN";
    if (exists) {
      const keys = await chain.accessKeys(r.accountId).catch(() => null);
      if (!keys) return r;
      // Created by this flow only if the owner key is there and SPak's parent key is not.
      if (keys.some((k) => k.publicKey === r.ownerPublicKey && k.permission === "FullAccess") && !keys.some((k) => k.publicKey === chain.parentPublicKey())) {
        const c = await this.move(r, "CREATED", { creationOutcome: "SUCCESS", createdOnChainAt: this.clock(), sponsorship: "FUNDED" }, { reconciled: true });
        return this.verifyRow(c);
      }
      return this.fail(r, "NAME_TAKEN");
    }
    if (tx === "FAILURE") return this.fail(r, "TRANSACTION_FAILED", r.creationTxHash);
    return r; // still unknown: stays CREATION_PENDING, not active
  }

  /**
   * Independent ownership verification from NEAR: the account exists on testnet, the owner key has full access,
   * SPak's parent key is absent, and the Agent is still verified and active.
   */
  private async verifyRow(r0: Row): Promise<Row> {
    const chain = this.d.chain!;
    let r = r0;
    if (r.status === "CREATED" || r.status === "SUSPENDED" || r.status === "RECOVERY_REQUIRED") r = await this.move(r, "OWNERSHIP_VERIFICATION_PENDING", {});
    if (r.status !== "OWNERSHIP_VERIFICATION_PENDING" && r.status !== "ACTIVE") return r;
    let keys: { publicKey: string; permission: string }[];
    try {
      if ((await chain.chainId()) !== "testnet") return r;
      if (!(await chain.viewAccount(r.accountId))) return this.move(r, "RECOVERY_REQUIRED", { recoveryReason: "ACCOUNT_NOT_FOUND", lastVerifiedAt: this.clock() });
      keys = await chain.accessKeys(r.accountId);
    } catch (e) { if (e instanceof NearUnavailable) return r; throw e; }
    const [a] = await this.d.db.select().from(agents).where(eq(agents.id, r.agentId)).limit(1);
    if (!a || a.status !== "VERIFIED" || !ownershipCurrent(a, this.clock())) return r; // the Agent must be active for the account to be
    const ownerOk = keys.some((k) => k.publicKey === r.ownerPublicKey && k.permission === "FullAccess");
    const spakKey = keys.some((k) => k.publicKey === chain.parentPublicKey());
    if (!ownerOk || spakKey) return this.move(r, "RECOVERY_REQUIRED", { recoveryReason: spakKey ? "UNEXPECTED_SPAK_KEY" : "OWNER_KEY_MISSING", lastVerifiedAt: this.clock() });
    const now = this.clock();
    if (r.status === "ACTIVE") {
      const [u] = await this.d.db.update(agentAccounts).set({ lastVerifiedAt: now, updatedAt: now }).where(eq(agentAccounts.id, r.id)).returning();
      return u;
    }
    return this.move(r, "ACTIVE", { ownershipVerifiedAt: now, activatedAt: r.activatedAt ?? now, lastVerifiedAt: now, recoveryReason: null }, { keys: keys.length });
  }

  /** Re-check the account on NEAR: reconcile a pending creation, or re-verify ownership. */
  async verify(userId: string, agentId: string) {
    if (!this.d.chain) this.unavailable();
    await this.agent(userId, agentId);
    const r = await this.live(agentId, userId);
    if (!r) throw new AgentError("AGENT_NOT_FOUND", "This Agent has no dedicated account.");
    if (r.status === "REVOKED") return toAccountView(r);
    return toAccountView(r.status === "CREATION_PENDING" ? await this.reconcile(r) : await this.verifyRow(r));
  }
}

/** Agent lifecycle applied to its dedicated account, inside the Agent's transaction. The NEAR account is never deleted. */
export async function cascadeAgentAccount(tx: Db, a: { id: string; userId: string }, from: string, to: string, now: Date) {
  const set = async (states: string[], status: string) => {
    const rows = await tx.update(agentAccounts).set({ status, updatedAt: now, version: sql`${agentAccounts.version} + 1` })
      .where(and(eq(agentAccounts.agentId, a.id), inArray(agentAccounts.status, states))).returning();
    for (const r of rows) await tx.insert(agentEvents).values({ agentId: a.id, userId: a.userId, event: `ACCOUNT_${status}`, fromStatus: null, toStatus: status, data: { accountRowId: r.id, cause: `AGENT_${to}` }, at: now });
  };
  if (to === "SUSPENDED") await set(["CREATED", "OWNERSHIP_VERIFICATION_PENDING", "ACTIVE", "RECOVERY_REQUIRED"], "SUSPENDED");
  else if (to === "REVOKED") await set(["CREATION_PENDING", "CREATED", "OWNERSHIP_VERIFICATION_PENDING", "ACTIVE", "SUSPENDED", "RECOVERY_REQUIRED"], "REVOKED");
  else if (to === "VERIFIED" && from === "SUSPENDED") await set(["SUSPENDED"], "OWNERSHIP_VERIFICATION_PENDING");
}
