import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { base64, hex } from "@scure/base";
import type { Db } from "../database/repositories";
import { agentAccountChallenges, agentAccountRotations, agentAccounts, agentEvents, agents } from "../database/schema";
import { isUniqueViolation } from "../execution/records";
import { AuthError } from "../auth/types";
import { nearRpc as defaultNearRpc, nep413Hash, parseNearPublicKey, verifyNearSignature, type NearRpc } from "../auth/verify/near";
import { ed25519 } from "@noble/curves/ed25519.js";
import { AgentError, ownershipCurrent, userRef } from "./service";
import type { AccessKeyInfo, AgentAccountConfig, AgentNearChain } from "./near-chain";

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
  /** Background checks: latest attempt (decisive or not) and schedule. */
  checks: { lastSuccessfulAt: string | null; lastAttemptAt: string | null; lastResult: string | null; lastReason: string | null; nextAt: string | null; consecutiveFailures: number };
  /** What NEAR showed at the last decisive check: public keys and permissions only. */
  evidence: { checkedAt: string; decision: string; reason: string | null; keys: { publicKey: string; permission: string }[] } | null;
}
export function toAccountView(r: Row): AccountView {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: r.id, status: r.status as AccountStatus, network: r.network, accountId: r.accountId, parentAccountId: r.parentAccountId, ownerPublicKey: r.ownerPublicKey, keyType: r.keyType,
    sponsorship: r.sponsorship, creationTxHash: r.creationTxHash, creationOutcome: r.creationOutcome, creationError: r.creationError,
    createdOnChainAt: iso(r.createdOnChainAt), ownershipVerifiedAt: iso(r.ownershipVerifiedAt), activatedAt: iso(r.activatedAt), lastVerifiedAt: iso(r.lastVerifiedAt),
    recoveryReason: r.recoveryReason, createdAt: r.createdAt.toISOString(), signingAuthority: "OWNER_ONLY",
    checks: { lastSuccessfulAt: iso(r.lastVerifiedAt), lastAttemptAt: iso(r.lastCheckAt), lastResult: r.lastCheckResult, lastReason: r.lastCheckReason, nextAt: r.status === "ACTIVE" ? iso(r.nextCheckAt) : null, consecutiveFailures: r.consecutiveFailures },
    evidence: r.verificationEvidence ? (({ checkedAt, decision, reason, keys }) => ({ checkedAt, decision, reason, keys }))(r.verificationEvidence as { checkedAt: string; decision: string; reason: string | null; keys: { publicKey: string; permission: string }[] }) : null,
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

  private infraCache: { at: number; value: InfrastructureStatus } | null = null;

  /**
   * Is SPak's testnet infrastructure ready to create accounts? Reads NEAR: chain id, the parent account, that the
   * configured key is a full-access key on it, and that its spendable balance covers one more account. Configured
   * variables alone never mean ready. Cached for a minute for display; creation always re-checks.
   */
  async infrastructure(opts: { fresh?: boolean } = {}): Promise<InfrastructureStatus> {
    const cfg = this.cfg;
    if (!cfg) return { state: "NOT_CONFIGURED", reason: (this.d.config as { unavailable: string }).unavailable, network: null, parentAccountId: null, sponsorship: null };
    const now = this.clock().getTime();
    if (!opts.fresh && this.infraCache && now - this.infraCache.at < 60_000) return this.infraCache.value;
    const sponsorship = await this.sponsorship(cfg);
    const base = { network: cfg.network, parentAccountId: cfg.parentAccountId, sponsorship };
    let value: InfrastructureStatus;
    try {
      const chain = this.d.chain!;
      if ((await chain.chainId()) !== "testnet") value = { ...base, state: "UNAVAILABLE", reason: "The configured RPC is not NEAR testnet." };
      else {
        const parent = await chain.viewAccount(cfg.parentAccountId);
        const keys = parent ? await chain.accessKeys(cfg.parentAccountId) : [];
        if (!parent) value = { ...base, state: "UNAVAILABLE", reason: "The parent account does not exist on testnet." };
        else if (!keys.some((k) => k.publicKey === chain.parentPublicKey() && k.permission === "FullAccess")) value = { ...base, state: "UNAVAILABLE", reason: "The configured key is not a full-access key on the parent account." };
        else if (BigInt(spendable(parent)) < BigInt(requiredForOne(cfg))) value = { ...base, state: "UNAVAILABLE", reason: "The parent account does not have enough NEAR to sponsor another account." };
        else if (sponsorship.sponsoredAccounts >= cfg.maxSponsoredAccounts) value = { ...base, state: "UNAVAILABLE", reason: "The maximum number of sponsored accounts is reached." };
        else if (BigInt(sponsorship.remainingYocto) < BigInt(cfg.initialBalanceYocto)) value = { ...base, state: "UNAVAILABLE", reason: "The sponsorship budget is used up." };
        else value = { ...base, state: "READY", reason: null };
      }
    } catch { value = { ...base, state: "UNAVAILABLE", reason: "NEAR testnet could not be reached." }; }
    this.infraCache = { at: now, value };
    return value;
  }

  private async sponsorship(cfg: AgentAccountConfig, q: Db = this.d.db) {
    const [r] = await q.select({ spent: sql<string>`coalesce(sum(cast(${agentAccounts.fundingYocto} as numeric)), 0)::text`, n: sql<number>`count(*)::int` })
      .from(agentAccounts).where(inArray(agentAccounts.sponsorship, ["RESERVED", "FUNDED"]));
    const spent = BigInt((r?.spent ?? "0").split(".")[0]);
    const remaining = BigInt(cfg.budgetYocto) - spent;
    return { initialBalanceYocto: cfg.initialBalanceYocto, budgetYocto: cfg.budgetYocto, committedYocto: spent.toString(), remainingYocto: (remaining > 0n ? remaining : 0n).toString(), sponsoredAccounts: r?.n ?? 0, maxSponsoredAccounts: cfg.maxSponsoredAccounts };
  }

  async view(userId: string, agentId: string) {
    const a = await this.agent(userId, agentId);
    const rows = await this.d.db.select().from(agentAccounts).where(and(eq(agentAccounts.agentId, agentId), eq(agentAccounts.userId, userId))).orderBy(desc(agentAccounts.createdAt));
    const live = rows.find((r) => r.status !== "CREATION_FAILED");
    const infrastructure = await this.infrastructure();
    const availability = infrastructure.state !== "READY" ? "UNAVAILABLE" : a.status === "VERIFIED" && ownershipCurrent(a, this.clock()) ? "AVAILABLE" : "AGENT_NOT_VERIFIED";
    return {
      availability, unavailableReason: infrastructure.reason, network: this.cfg?.network ?? null, infrastructure,
      account: live ? toAccountView(live) : null, failedAttempts: rows.filter((r) => r.status === "CREATION_FAILED").map(toAccountView),
      rotation: live ? ((x) => (x ? rotationView(x) : null))(await this.openRotation(live.id)) : null,
      /** Rotation needs the current key on an ACTIVE account. A lost key cannot be rotated or recovered by SPak. */
      keyRotationAvailable: !!live && live.status === "ACTIVE" && a.status === "VERIFIED",
      recovery: live?.status === "RECOVERY_REQUIRED" ? (["OWNER_KEY_MISSING", "OWNER_KEY_NOT_FULL_ACCESS"].includes(live.recoveryReason ?? "") ? "KEY_LOST_OR_CHANGED" : live.recoveryReason === "VERIFICATION_UNAVAILABLE" ? "RECHECK" : "OWNER_ACTION_NEEDED") : null,
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
    const infra = await this.infrastructure({ fresh: true });
    if (infra.state !== "READY") throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", infra.reason ?? "Account creation is not available.");
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
        const [{ sponsored }] = await tx.select({ sponsored: sql<number>`count(*)::int` }).from(agentAccounts).where(inArray(agentAccounts.sponsorship, ["RESERVED", "FUNDED"]));
        if (sponsored >= cfg.maxSponsoredAccounts) throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", "The maximum number of sponsored testnet accounts is reached. Nothing was created.");
        const [r] = await tx.insert(agentAccounts).values({
          id: newId("aga"), agentId: a.id, userId, network: cfg.network, accountId: c.accountId, parentAccountId: cfg.parentAccountId, ownerPublicKey: c.ownerPublicKey,
          keyType: "ed25519", status: "CREATION_PENDING", sponsorship: "RESERVED", fundingYocto: cfg.initialBalanceYocto, idempotencyKey: input.idempotencyKey, consentChallengeId: c.id, createdAt: now, updatedAt: now,
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
      const parent = await chain.viewAccount(cfg.parentAccountId);
      if (!parent || BigInt(spendable(parent)) < BigInt(requiredForOne(cfg))) return toAccountView(await this.fail(row, "PARENT_INSUFFICIENT_BALANCE"));
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

  /** Read everything NEAR can tell us about the account. Any failure to read is recorded, never guessed. */
  private async evidence(r: Row): Promise<AccountEvidence> {
    const chain = this.d.chain!;
    const at = this.clock().toISOString();
    try {
      const chainId = await chain.chainId();
      const exists = chainId === "testnet" ? !!(await chain.viewAccount(r.accountId)) : false;
      const keys = exists ? await chain.accessKeys(r.accountId) : [];
      return { readable: true, chainId, exists, keys, checkedAt: at };
    } catch { return { readable: false, chainId: null, exists: false, keys: [], checkedAt: at }; }
  }

  /** The consent this account was created under must be for the same Agent, user and account, and for its key. */
  private async bindingOk(r: Row, q: Db): Promise<boolean> {
    if (!r.consentChallengeId) return false;
    const [c] = await q.select().from(agentAccountChallenges).where(eq(agentAccountChallenges.id, r.consentChallengeId)).limit(1);
    if (!c || c.agentId !== r.agentId || c.userId !== r.userId || c.accountId !== r.accountId) return false;
    if (c.ownerPublicKey === r.ownerPublicKey) return true;
    // The installed key changed only through a completed, owner-authorised rotation.
    const [rot] = await q.select({ id: agentAccountRotations.id }).from(agentAccountRotations)
      .where(and(eq(agentAccountRotations.accountRowId, r.id), eq(agentAccountRotations.status, "COMPLETED"), eq(agentAccountRotations.newPublicKey, r.ownerPublicKey))).limit(1);
    return !!rot;
  }

  /**
   * Independent, strict ownership verification. The account must show exactly one access key: the approved owner
   * key, with full access. Anything else, or anything NEAR cannot confirm, is RECOVERY_REQUIRED with the evidence.
   * Activation happens in one transaction that locks the Agent and the account and refuses stale reads.
   */
  private async verifyRow(r0: Row): Promise<Row> {
    let r = r0;
    if (r.status === "CREATED" || r.status === "RECOVERY_REQUIRED") r = await this.move(r, "OWNERSHIP_VERIFICATION_PENDING", {});
    if (r.status !== "OWNERSHIP_VERIFICATION_PENDING" && r.status !== "ACTIVE") return r;
    const ev = await this.evidence(r);
    // A rotation the owner authorised and sent: the new key alone on the account completes it.
    const landed = await this.completeLandedRotation(r, ev);
    if (landed) r = landed;
    return this.d.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [a] = await tx.select().from(agents).where(eq(agents.id, r.agentId)).for("update").limit(1);
      const [cur] = await tx.select().from(agentAccounts).where(eq(agentAccounts.id, r.id)).for("update").limit(1);
      // Stale: the account or Agent changed after NEAR was read. Nothing is written from old evidence.
      if (!cur || cur.version !== r.version || !["OWNERSHIP_VERIFICATION_PENDING", "ACTIVE"].includes(cur.status)) return cur ?? r;
      if (!a || a.status !== "VERIFIED" || !ownershipCurrent(a, this.clock())) return cur; // Agent suspended, revoked or expired: never activate
      const decision = assessAccount(ev, { accountId: cur.accountId, ownerPublicKey: cur.ownerPublicKey, parentPublicKey: this.d.chain!.parentPublicKey() }, await this.bindingOk(cur, tx));
      const evidence = { ...ev, decision: decision.ok ? "VERIFIED" : "RECOVERY_REQUIRED", reason: decision.reason };
      const now = this.clock();
      if (!decision.ok) return this.move(cur, "RECOVERY_REQUIRED", { recoveryReason: decision.reason, verificationEvidence: evidence, lastVerifiedAt: now, lastCheckAt: now, lastCheckResult: "RECOVERY_REQUIRED", lastCheckReason: decision.reason, lastCheckEvidence: evidence, nextCheckAt: null }, { reason: decision.reason }, tx);
      const check = { lastCheckAt: now, lastCheckResult: "VERIFIED", lastCheckReason: null, lastCheckEvidence: evidence, consecutiveFailures: 0, nextCheckAt: this.nextCheck(now) };
      if (cur.status === "ACTIVE") return this.move(cur, "ACTIVE", { lastVerifiedAt: now, verificationEvidence: evidence, ...check }, { reverified: true }, tx);
      return this.move(cur, "ACTIVE", { ownershipVerifiedAt: now, activatedAt: cur.activatedAt ?? now, lastVerifiedAt: now, recoveryReason: null, verificationEvidence: evidence, ...check }, { keys: ev.keys.length }, tx);
    });
  }

  private nextCheck(from: Date) {
    const h = this.cfg?.recheck.intervalHours ?? 24;
    return new Date(from.getTime() + h * 3600_000);
  }

  /**
   * Background re-verification of ACTIVE dedicated accounts whose next check is due. Read-only on NEAR: it never
   * signs, never changes keys, never activates anything that is not already ACTIVE.
   * - Rows are claimed with a short lease by a conditional update, so concurrent or duplicate jobs check each once.
   * - NEAR unreadable: retried a few times in-job, then recorded INCONCLUSIVE with bounded backoff; status and last
   *   decisive evidence are kept.
   * - Account not found or wrong network: INCONCLUSIVE (an RPC node can lag); not found three checks in a row is
   *   RECOVERY_REQUIRED.
   * - Exact authority wrong: RECOVERY_REQUIRED.
   * - All writes lock the account and Agent and refuse stale state (status or version changed since the claim).
   */
  async recheckDue(opts: { limit?: number; sleep?: (ms: number) => Promise<void> } = {}) {
    const out = { checked: 0, verified: 0, recovery: 0, inconclusive: 0, skipped: 0 };
    if (!this.cfg || !this.d.chain || !this.cfg.recheck.enabled) return { ...out, disabled: true };
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const now = this.clock();
    // The lease conditions are repeated outside the subquery: under READ COMMITTED a job that waited on a row lock
    // re-checks only the outer WHERE against the committed row, while the subquery keeps its older snapshot. SKIP LOCKED
    // lets concurrent jobs take different rows instead of queueing. Each due account is claimed by exactly one job.
    const unleased = sql`${agentAccounts.status} = 'ACTIVE' and ${agentAccounts.nextCheckAt} <= ${now.toISOString()}::timestamptz and (${agentAccounts.checkLeaseUntil} is null or ${agentAccounts.checkLeaseUntil} < ${now.toISOString()}::timestamptz)`;
    const claimed = await this.d.db.update(agentAccounts).set({ checkLeaseUntil: new Date(now.getTime() + 10 * 60_000) })
      .where(sql`${unleased} and ${agentAccounts.id} in (select id from ${agentAccounts} where ${unleased} order by ${agentAccounts.nextCheckAt} limit ${opts.limit ?? 50} for update skip locked)`)
      .returning();
    for (const r of claimed) {
      out.checked++;
      let ev = await this.evidence(r);
      for (let i = 0; i < 2 && !ev.readable; i++) { await sleep(1000 * 2 ** i); ev = await this.evidence(r); }
      const res = await this.d.db.transaction(async (t) => {
        const tx = t as unknown as Db;
        const [a] = await tx.select().from(agents).where(eq(agents.id, r.agentId)).for("update").limit(1);
        const [cur] = await tx.select().from(agentAccounts).where(eq(agentAccounts.id, r.id)).for("update").limit(1);
        if (!cur || cur.status !== "ACTIVE" || cur.version !== r.version || !a || a.status !== "VERIFIED") {
          if (cur) await tx.update(agentAccounts).set({ checkLeaseUntil: null }).where(eq(agentAccounts.id, cur.id));
          return "skipped" as const;
        }
        const at = this.clock();
        const evidenceRec = { ...ev, decision: "", reason: null as string | null };
        const inconclusive = async (reason: string, escalate: boolean) => {
          const failures = cur.consecutiveFailures + 1;
          if (escalate) {
            await this.move(cur, "RECOVERY_REQUIRED", { recoveryReason: reason, lastCheckAt: at, lastCheckResult: "RECOVERY_REQUIRED", lastCheckReason: reason, lastCheckEvidence: { ...evidenceRec, decision: "RECOVERY_REQUIRED", reason }, consecutiveFailures: failures, nextCheckAt: null, checkLeaseUntil: null }, { background: true, reason }, tx);
            return "recovery" as const;
          }
          const backoffH = Math.min(2 ** (failures - 1), this.cfg!.recheck.intervalHours);
          await tx.update(agentAccounts).set({ lastCheckAt: at, lastCheckResult: "INCONCLUSIVE", lastCheckReason: reason, lastCheckEvidence: { ...evidenceRec, decision: "INCONCLUSIVE", reason }, consecutiveFailures: failures, nextCheckAt: new Date(at.getTime() + backoffH * 3600_000), checkLeaseUntil: null, updatedAt: at })
            .where(eq(agentAccounts.id, cur.id));
          await this.event(tx, { id: cur.agentId, userId: cur.userId }, "ACCOUNT_CHECK_INCONCLUSIVE", "ACTIVE", "ACTIVE", { accountRowId: cur.id, reason, consecutiveFailures: failures });
          return "inconclusive" as const;
        };
        if (!ev.readable) return inconclusive("VERIFICATION_UNAVAILABLE", false);
        if (ev.chainId !== "testnet") return inconclusive("WRONG_NETWORK", false);
        if (!ev.exists) return inconclusive("ACCOUNT_NOT_FOUND", cur.lastCheckReason === "ACCOUNT_NOT_FOUND" && cur.consecutiveFailures >= 2);
        const d = assessAccount(ev, { accountId: cur.accountId, ownerPublicKey: cur.ownerPublicKey, parentPublicKey: this.d.chain!.parentPublicKey() }, await this.bindingOk(cur, tx));
        if (!d.ok) {
          await this.move(cur, "RECOVERY_REQUIRED", { recoveryReason: d.reason, verificationEvidence: { ...evidenceRec, decision: "RECOVERY_REQUIRED", reason: d.reason }, lastCheckAt: at, lastCheckResult: "RECOVERY_REQUIRED", lastCheckReason: d.reason, lastCheckEvidence: { ...evidenceRec, decision: "RECOVERY_REQUIRED", reason: d.reason }, nextCheckAt: null, checkLeaseUntil: null }, { background: true, reason: d.reason }, tx);
          return "recovery" as const;
        }
        const good = { ...evidenceRec, decision: "VERIFIED", reason: null };
        await tx.update(agentAccounts).set({ lastVerifiedAt: at, verificationEvidence: good, lastCheckAt: at, lastCheckResult: "VERIFIED", lastCheckReason: null, lastCheckEvidence: good, consecutiveFailures: 0, nextCheckAt: this.nextCheck(at), checkLeaseUntil: null, updatedAt: at })
          .where(eq(agentAccounts.id, cur.id));
        return "verified" as const;
      });
      out[res]++;
    }
    return { ...out, disabled: false };
  }

  /* ------------------------------------------- dedicated account key rotation ------------------------------------------- */

  private async openRotation(accountRowId: string, q: Db = this.d.db) {
    const [x] = await q.select().from(agentAccountRotations).where(and(eq(agentAccountRotations.accountRowId, accountRowId), inArray(agentAccountRotations.status, ["CHALLENGED", "AUTHORIZED"]))).limit(1);
    return x ?? null;
  }

  /**
   * Start a rotation of the dedicated account's key. Only for an ACTIVE account of a verified Agent. Returns the
   * NEP-413 message the CURRENT dedicated-account key must sign, and the exact transaction the owner will send from
   * their own wallet: on the dedicated account, AddKey(new, FullAccess) + DeleteKey(old), atomic in one transaction.
   * Re-verifying the Agent owner identity does not substitute for this: different account, different key.
   */
  async prepareRotation(userId: string, agentId: string, input: { newPublicKey: string; domain: string }) {
    if (!this.d.chain) this.unavailable();
    const a = await this.agent(userId, agentId);
    this.eligible(a);
    const r = await this.live(agentId, userId);
    if (!r || r.status !== "ACTIVE") throw new AgentError("AGENT_INVALID_STATE", "Key rotation needs an active dedicated account. Verify it on NEAR first.");
    if (!parseNearPublicKey(input.newPublicKey)) throw new AgentError("AGENT_BAD_REQUEST", "The new key must be an ed25519 NEAR public key.");
    if (input.newPublicKey === r.ownerPublicKey) throw new AgentError("AGENT_BAD_REQUEST", "The new key is the key already installed.");
    if (input.newPublicKey === this.d.chain!.parentPublicKey()) throw new AgentError("AGENT_BAD_REQUEST", "SPak's key can never be installed on an Agent account.");
    const now = this.clock(), id = newId("akr"), expiresAt = new Date(now.getTime() + ACCOUNT_CHALLENGE_TTL_MS);
    const message = [
      "SPak dedicated Agent account key rotation", "", "Sign with the key currently on this account to authorise replacing it.",
      "This is not the transaction. You send the transaction yourself; SPak cannot.", "",
      `Agent: ${a.id}`, `Owner: ${userRef(userId)}`, `Account: ${r.accountId}`, `Network: ${r.network}`, `Current key: ${r.ownerPublicKey}`,
      `New key: ${input.newPublicKey}`, "Purpose: AGENT_ACCOUNT_KEY_ROTATION", `Domain: ${input.domain}`, `Issued At: ${now.toISOString()}`,
      `Expires At: ${expiresAt.toISOString()}`, `Rotation: ${id}`,
    ].join("\n");
    const nonce = hex.encode(randomBytes(32));
    try {
      // Expire a stale challenge so a new one can be issued; an AUTHORIZED rotation must be completed or fail first.
      await this.d.db.update(agentAccountRotations).set({ status: "EXPIRED", updatedAt: now })
        .where(and(eq(agentAccountRotations.accountRowId, r.id), eq(agentAccountRotations.status, "CHALLENGED"), lte(agentAccountRotations.expiresAt, now)));
      await this.d.db.insert(agentAccountRotations).values({ id, accountRowId: r.id, agentId: a.id, userId, accountId: r.accountId, oldPublicKey: r.ownerPublicKey, newPublicKey: input.newPublicKey, status: "CHALLENGED", domain: input.domain, nonce, message, expiresAt, createdAt: now, updatedAt: now });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AgentError("AGENT_EXISTS", "A key rotation is already in progress for this account.");
      throw e;
    }
    await this.event(this.d.db, a, "ACCOUNT_KEY_ROTATION_REQUESTED", null, null, { rotationId: id, accountId: r.accountId, newPublicKey: input.newPublicKey });
    return {
      rotationId: id, accountId: r.accountId, network: r.network, currentPublicKey: r.ownerPublicKey, newPublicKey: input.newPublicKey,
      message, nonce: Buffer.from(nonce, "hex").toString("base64"), recipient: input.domain, expiresAt: expiresAt.toISOString(),
      transaction: { signerId: r.accountId, receiverId: r.accountId, actions: [{ type: "AddKey", publicKey: input.newPublicKey, permission: "FullAccess" }, { type: "DeleteKey", publicKey: r.ownerPublicKey }] },
    };
  }

  /** Proof of authority from the key installed on the dedicated account now, confirmed on NEAR. */
  async authorizeRotation(userId: string, agentId: string, input: { rotationId: string; publicKey: string; signature: string; domain: string }) {
    if (!this.d.chain) this.unavailable();
    const a = await this.agent(userId, agentId);
    this.eligible(a);
    const r = await this.live(agentId, userId);
    const now = this.clock();
    const [rot] = await this.d.db.select().from(agentAccountRotations).where(eq(agentAccountRotations.id, input.rotationId)).limit(1);
    if (!rot || !r || rot.accountRowId !== r.id || rot.userId !== userId || rot.agentId !== a.id) throw new AgentError("AGENT_CHALLENGE_INVALID", "That rotation is not valid for this account.");
    if (rot.domain !== input.domain) throw new AgentError("AGENT_DOMAIN_MISMATCH", "That rotation was issued for another site.");
    if (r.status !== "ACTIVE" || rot.oldPublicKey !== r.ownerPublicKey) throw new AgentError("AGENT_INVALID_STATE", "The account changed since the rotation was requested. Start again.");
    const [claimed] = await this.d.db.update(agentAccountRotations).set({ usedAt: now, updatedAt: now })
      .where(and(eq(agentAccountRotations.id, rot.id), eq(agentAccountRotations.status, "CHALLENGED"), isNull(agentAccountRotations.usedAt), gt(agentAccountRotations.expiresAt, now))).returning();
    if (!claimed) throw new AgentError(rot.usedAt ? "AGENT_CHALLENGE_USED" : "AGENT_CHALLENGE_EXPIRED", "That rotation request was used or expired. Start again.");
    const failRot = async (reason: string, code: "AGENT_PROOF_INVALID" | "AGENT_KEY_NOT_AUTHORIZED" | "AGENT_VERIFICATION_UNAVAILABLE", msg: string) => {
      await this.d.db.update(agentAccountRotations).set({ status: "FAILED", failureReason: reason, updatedAt: this.clock() }).where(eq(agentAccountRotations.id, rot.id));
      await this.event(this.d.db, a, "ACCOUNT_KEY_ROTATION_FAILED", null, null, { rotationId: rot.id, reason });
      return new AgentError(code, msg);
    };
    // Signed by the key installed on the dedicated account (not the owner identity's key unless they are the same key).
    if (input.publicKey !== r.ownerPublicKey) throw await failRot("NOT_CURRENT_KEY", "AGENT_PROOF_INVALID", "Sign with the key currently on the dedicated account.");
    const pub = parseNearPublicKey(input.publicKey);
    let sig: Uint8Array | null = null;
    try { sig = base64.decode(input.signature); } catch { sig = null; }
    if (!pub || !sig || sig.length !== 64 || !ed25519.verify(sig, nep413Hash(rot.message, hex.decode(rot.nonce), rot.domain), pub)) throw await failRot("SIGNATURE_INVALID", "AGENT_PROOF_INVALID", "The signature does not match this rotation.");
    let keys: AccessKeyInfo[];
    try { keys = await this.d.chain!.accessKeys(r.accountId); } catch { throw await failRot("VERIFICATION_UNAVAILABLE", "AGENT_VERIFICATION_UNAVAILABLE", "SPak could not confirm the key on NEAR. Nothing changed."); }
    if (!keys.some((k) => k.publicKey === input.publicKey && k.permission === "FullAccess")) throw await failRot("KEY_NOT_ON_ACCOUNT", "AGENT_KEY_NOT_AUTHORIZED", "That key is not a full-access key on the dedicated account.");
    const [u] = await this.d.db.update(agentAccountRotations).set({ status: "AUTHORIZED", updatedAt: this.clock() }).where(and(eq(agentAccountRotations.id, rot.id), isNull(agentAccountRotations.txHash))).returning();
    await this.event(this.d.db, a, "ACCOUNT_KEY_ROTATION_AUTHORIZED", null, null, { rotationId: rot.id });
    return rotationView(u);
  }

  /**
   * After the owner sent the transaction: read the account from NEAR. Completed only when the new key is the only
   * key, with full access. Old key still alone: failed (or still pending if NEAR does not know the outcome).
   * Any other key set: the rotation failed and the account needs recovery.
   */
  async completeRotation(userId: string, agentId: string, input: { rotationId: string; txHash?: string }) {
    if (!this.d.chain) this.unavailable();
    await this.agent(userId, agentId);
    const r = await this.live(agentId, userId);
    const [rot] = await this.d.db.select().from(agentAccountRotations).where(eq(agentAccountRotations.id, input.rotationId)).limit(1);
    if (!rot || !r || rot.accountRowId !== r.id || rot.userId !== userId) throw new AgentError("AGENT_CHALLENGE_INVALID", "That rotation is not valid for this account.");
    if (rot.status !== "AUTHORIZED") return rotationView(rot);
    if (input.txHash) await this.d.db.update(agentAccountRotations).set({ txHash: input.txHash, updatedAt: this.clock() }).where(eq(agentAccountRotations.id, rot.id));
    const ev = await this.evidence(r);
    if (!ev.readable || ev.chainId !== "testnet") throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", "SPak could not read the account on NEAR. The rotation is still pending.");
    const done = await this.completeLandedRotation(r, ev);
    if (done) await this.verifyRow(done);
    if (done) return rotationView((await this.d.db.select().from(agentAccountRotations).where(eq(agentAccountRotations.id, rot.id)))[0]);
    const onlyOld = ev.keys.length === 1 && ev.keys[0].publicKey === rot.oldPublicKey && ev.keys[0].permission === "FullAccess";
    if (onlyOld) {
      const st = input.txHash ? await this.d.chain!.txStatus(input.txHash, r.accountId) : "UNKNOWN";
      if (st === "FAILURE") {
        const [u] = await this.d.db.update(agentAccountRotations).set({ status: "FAILED", failureReason: "TRANSACTION_FAILED", evidence: ev, updatedAt: this.clock() }).where(eq(agentAccountRotations.id, rot.id)).returning();
        await this.event(this.d.db, { id: r.agentId, userId }, "ACCOUNT_KEY_ROTATION_FAILED", null, null, { rotationId: rot.id, reason: "TRANSACTION_FAILED" });
        return rotationView(u);
      }
      return rotationView((await this.d.db.select().from(agentAccountRotations).where(eq(agentAccountRotations.id, rot.id)))[0]); // not landed yet: still AUTHORIZED
    }
    // Neither the old key alone nor the new key alone: unexpected key set.
    const [u] = await this.d.db.update(agentAccountRotations).set({ status: "FAILED", failureReason: "UNEXPECTED_KEYS", evidence: ev, updatedAt: this.clock() }).where(eq(agentAccountRotations.id, rot.id)).returning();
    await this.event(this.d.db, { id: r.agentId, userId }, "ACCOUNT_KEY_ROTATION_FAILED", null, null, { rotationId: rot.id, reason: "UNEXPECTED_KEYS" });
    await this.verifyRow(r);
    return rotationView(u);
  }

  /** If an authorised rotation's new key is now the only key, record the rotation and the new installed key. */
  private async completeLandedRotation(r: Row, ev: AccountEvidence): Promise<Row | null> {
    if (!ev.readable || ev.chainId !== "testnet" || ev.keys.length !== 1 || ev.keys[0].permission !== "FullAccess") return null;
    const rot = await this.openRotation(r.id);
    if (!rot || rot.status !== "AUTHORIZED" || rot.newPublicKey !== ev.keys[0].publicKey || rot.oldPublicKey !== r.ownerPublicKey) return null;
    return this.d.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const [cur] = await tx.select().from(agentAccounts).where(eq(agentAccounts.id, r.id)).for("update").limit(1);
      if (!cur || cur.ownerPublicKey !== rot.oldPublicKey || !["ACTIVE", "OWNERSHIP_VERIFICATION_PENDING", "RECOVERY_REQUIRED"].includes(cur.status)) return null;
      const now = this.clock();
      await tx.update(agentAccountRotations).set({ status: "COMPLETED", evidence: ev, updatedAt: now }).where(and(eq(agentAccountRotations.id, rot.id), eq(agentAccountRotations.status, "AUTHORIZED")));
      const [u] = await tx.update(agentAccounts).set({ ownerPublicKey: rot.newPublicKey, version: cur.version + 1, updatedAt: now }).where(and(eq(agentAccounts.id, cur.id), eq(agentAccounts.version, cur.version))).returning();
      if (!u) return null;
      await this.event(tx, { id: cur.agentId, userId: cur.userId }, "ACCOUNT_KEY_ROTATED", cur.status, cur.status, { rotationId: rot.id, oldPublicKey: rot.oldPublicKey, newPublicKey: rot.newPublicKey });
      return u;
    });
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

export function rotationView(x: typeof agentAccountRotations.$inferSelect) {
  return { id: x.id, status: x.status, accountId: x.accountId, oldPublicKey: x.oldPublicKey, newPublicKey: x.newPublicKey, txHash: x.txHash, failureReason: x.failureReason, createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString() };
}

export type InfrastructureStatus = {
  state: "NOT_CONFIGURED" | "UNAVAILABLE" | "READY"; reason: string | null; network: "testnet" | null; parentAccountId: string | null;
  sponsorship: { initialBalanceYocto: string; budgetYocto: string; committedYocto: string; remainingYocto: string; sponsoredAccounts: number; maxSponsoredAccounts: number } | null;
};

/** Account creation burns a fixed 0.007 NEAR (docs.near.org/protocol/transactions/gas.md). */
export const CREATION_BURN_YOCTO = "7000000000000000000000";
/** Margin for the creation transaction's gas. An assumption, kept generous; it is not spent unless gas costs it. */
export const GAS_MARGIN_YOCTO = "10000000000000000000000";
/** Storage price: 1E19 yoctoNEAR per byte (docs.near.org/protocol/storage/storage-staking.md). */
export const STORAGE_YOCTO_PER_BYTE = 10_000_000_000_000_000_000n;
/** Spendable parent balance: liquid amount minus what its own storage must keep staked. */
export function spendable(a: { amount: string; storageUsage?: number }) {
  const v = BigInt(a.amount) - BigInt(a.storageUsage ?? 0) * STORAGE_YOCTO_PER_BYTE;
  return (v > 0n ? v : 0n).toString();
}
export const requiredForOne = (cfg: { initialBalanceYocto: string }) => (BigInt(cfg.initialBalanceYocto) + BigInt(CREATION_BURN_YOCTO) + BigInt(GAS_MARGIN_YOCTO)).toString();

export interface AccountEvidence { readable: boolean; chainId: string | null; exists: boolean; keys: AccessKeyInfo[]; checkedAt: string }
export type AccountReason =
  | "VERIFICATION_UNAVAILABLE" | "WRONG_NETWORK" | "ACCOUNT_NOT_FOUND" | "BINDING_MISMATCH" | "PARENT_KEY_PRESENT" | "OWNER_KEY_MISSING"
  | "OWNER_KEY_NOT_FULL_ACCESS" | "UNEXPECTED_FULL_ACCESS_KEY" | "UNEXPECTED_FUNCTION_CALL_KEY";

/**
 * The exact authority a dedicated account must have under the Stage 7 model: on testnet, it exists, it was created
 * under this Agent's consent, and its only access key is the approved owner key with full access. Pure function.
 */
export function assessAccount(ev: AccountEvidence, expect: { accountId: string; ownerPublicKey: string; parentPublicKey: string }, bound: boolean): { ok: boolean; reason: AccountReason | null } {
  if (!ev.readable) return { ok: false, reason: "VERIFICATION_UNAVAILABLE" };
  if (ev.chainId !== "testnet") return { ok: false, reason: "WRONG_NETWORK" };
  if (!ev.exists) return { ok: false, reason: "ACCOUNT_NOT_FOUND" };
  if (!bound) return { ok: false, reason: "BINDING_MISMATCH" };
  if (ev.keys.some((k) => k.publicKey === expect.parentPublicKey)) return { ok: false, reason: "PARENT_KEY_PRESENT" };
  const owner = ev.keys.find((k) => k.publicKey === expect.ownerPublicKey);
  if (!owner) return { ok: false, reason: "OWNER_KEY_MISSING" };
  if (owner.permission !== "FullAccess") return { ok: false, reason: "OWNER_KEY_NOT_FULL_ACCESS" };
  const others = ev.keys.filter((k) => k.publicKey !== expect.ownerPublicKey);
  if (others.some((k) => k.permission === "FullAccess")) return { ok: false, reason: "UNEXPECTED_FULL_ACCESS_KEY" };
  if (others.length) return { ok: false, reason: "UNEXPECTED_FUNCTION_CALL_KEY" };
  return { ok: true, reason: null };
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
