import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, gt, sql } from "drizzle-orm";
import { hex } from "@scure/base";
import { z } from "zod";
import type { Db } from "../database/repositories";
import { agentEvents, agentGrantChallenges, agentGrants, approvals, executions, guardReservations } from "../database/schema";
import { AuthError } from "../auth/types";
import { nearRpc as defaultNearRpc, verifyNearSignature, type NearRpc } from "../auth/verify/near";
import { addDecimal, compareDecimal, isDecimal } from "../spak-in/lib/decimal";
import { getNetwork } from "../spak-in/registries/networks";
import { getAsset } from "../spak-in/registries/assets";
import { platformCeilingUsd } from "../guard/ceiling";
import { cleanUsd, sameAddress } from "../guard/engine";
import { ExecutionError } from "../execution/errors";
import type { ExecutionRow, QuoteRow, ApprovalRow } from "../execution/records";
import { AgentError, canonical, userRef } from "./service";
import { ACTING_MESSAGE, actingProblem, loadAgent, type AgentActingProblem } from "./authority";

/* ------------------------------------------------------------------ scope ------------------------------------------------------------------- */

export const GRANT_CHALLENGE_TTL_MS = 5 * 60_000;
export const MAX_GRANT_HOURS = 168;
export const MAX_GRANT_TRANSACTIONS = 20;
export const DAY_MS = 24 * 3600_000;
export const MAX_MIN_INTERVAL_MINUTES = 1440;

const money = z.string().trim().refine((v) => isDecimal(v) && compareDecimal(v, "0") > 0, "Enter a positive amount in USD, like 25 or 25.50.");
export const grantInputSchema = z.object({
  maxTransactionUsd: money,
  dailyLimitUsd: money,
  maxTransactions: z.number().int().min(1).max(MAX_GRANT_TRANSACTIONS),
  durationHours: z.number().int().min(1).max(MAX_GRANT_HOURS),
  /** Frequency limit: minimum minutes between two Agent approvals. 0 or absent means no spacing rule. */
  minIntervalMinutes: z.number().int().min(0).max(MAX_MIN_INTERVAL_MINUTES).optional(),
  sourceNetworks: z.array(z.string().min(1).max(40)).min(1).max(20),
  destinationNetworks: z.array(z.string().min(1).max(40)).min(1).max(20),
  assets: z.array(z.string().min(1).max(200)).min(1).max(40),
  recipients: z.object({
    self: z.boolean(),
    addresses: z.array(z.object({ network: z.string().min(1).max(40), address: z.string().min(1).max(200) })).max(10),
  }),
}).strict();
export type GrantInput = z.input<typeof grantInputSchema>;

/** The stored, signed scope. Sorted and de-duplicated so the same permission always hashes the same. */
export interface GrantScope {
  maxTransactionUsd: string; dailyLimitUsd: string; maxTransactions: number;
  /** Present only when set above 0, so grants signed before this field existed keep their exact hash and message. */
  minIntervalMinutes?: number;
  sourceNetworks: string[]; destinationNetworks: string[]; assets: string[];
  recipients: { self: boolean; addresses: { network: string; address: string }[] };
}

const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();

/** Validate a requested scope against SPak's registries and ceiling. Never widens anything; refuses what it cannot check. */
export function normalizeScope(input: unknown, ceilingUsd: string): { scope: GrantScope; durationHours: number } {
  const r = grantInputSchema.safeParse(input);
  if (!r.success) { const i = r.error.issues[0]; throw new AgentError("AGENT_BAD_REQUEST", `${i.path.join(".") || "input"}: ${i.message}`); }
  const g = r.data;
  const bad = (m: string): never => { throw new AgentError("AGENT_BAD_REQUEST", m); };
  if (compareDecimal(g.maxTransactionUsd, ceilingUsd) > 0) bad(`The per-transfer limit cannot be above SPak's $${ceilingUsd} ceiling.`);
  if (compareDecimal(g.dailyLimitUsd, g.maxTransactionUsd) < 0) bad("The 24-hour limit cannot be below the per-transfer limit.");
  for (const n of [...g.sourceNetworks, ...g.destinationNetworks]) if (!getNetwork(n)) bad(`Unknown network: ${n}.`);
  for (const a of g.assets) if (!getAsset(a)) bad(`Unknown token: ${a}.`);
  const addresses = new Map<string, { network: string; address: string }>();
  for (const x of g.recipients.addresses) {
    const net = getNetwork(x.network);
    if (!net) bad(`Unknown network: ${x.network}.`);
    const address = net!.family === "evm" ? x.address.trim().toLowerCase() : x.address.trim();
    if (!/^[A-Za-z0-9._:-]{2,128}$/.test(address)) bad("A recipient address has characters SPak does not accept.");
    addresses.set(`${x.network}|${address}`, { network: x.network, address });
  }
  if (!g.recipients.self && addresses.size === 0) bad("Allow your own wallets, at least one recipient address, or both.");
  const scope: GrantScope = {
    maxTransactionUsd: g.maxTransactionUsd, dailyLimitUsd: g.dailyLimitUsd, maxTransactions: g.maxTransactions,
    ...(g.minIntervalMinutes ? { minIntervalMinutes: g.minIntervalMinutes } : {}),
    sourceNetworks: uniqSorted(g.sourceNetworks), destinationNetworks: uniqSorted(g.destinationNetworks), assets: uniqSorted(g.assets),
    recipients: { self: g.recipients.self, addresses: [...addresses.values()].sort((a, b) => `${a.network}|${a.address}`.localeCompare(`${b.network}|${b.address}`)) },
  };
  return { scope, durationHours: g.durationHours };
}

export const scopeHash = (s: GrantScope) => createHash("sha256").update(canonical(s)).digest("hex");

/** The exact text the owner signs. Every limit is in the signed bytes. */
export function grantMessage(c: { agentId: string; userRef: string; accountId: string; version: number; scope: GrantScope; validUntil: string; domain: string; issuedAt: string; expiresAt: string; challengeId: string }) {
  const s = c.scope;
  const recipients = [s.recipients.self ? "your own verified wallets" : null, ...s.recipients.addresses.map((a) => `${a.network}:${a.address}`)].filter(Boolean).join(", ");
  return [
    "SPak Agent permission",
    "",
    "Sign to let SPak approve transfers for your Agent within these limits, without asking you each time.",
    "This is not a transaction. Your wallet still signs every deposit. SPak Guard still checks every transfer.",
    "You can pause or revoke this permission at any time.",
    "",
    `Agent: ${c.agentId}`,
    `Owner: ${c.userRef}`,
    `NEAR account: ${c.accountId}`,
    `Permission version: ${c.version}`,
    `Per transfer: up to $${s.maxTransactionUsd}`,
    `Per 24 hours: up to $${s.dailyLimitUsd}`,
    `Transfers: at most ${s.maxTransactions}`,
    ...(s.minIntervalMinutes ? [`Spacing: at least ${s.minIntervalMinutes} minutes between transfers`] : []),
    `Source networks: ${s.sourceNetworks.join(", ")}`,
    `Destination networks: ${s.destinationNetworks.join(", ")}`,
    `Tokens: ${s.assets.join(", ")}`,
    `Recipients: ${recipients}`,
    `Valid until: ${c.validUntil}`,
    `Domain: ${c.domain}`,
    `Issued At: ${c.issuedAt}`,
    `Expires At: ${c.expiresAt}`,
    `Challenge: ${c.challengeId}`,
  ].join("\n");
}

/* ---------------------------------------------------------------- assessment ---------------------------------------------------------------- */

export type GrantRuleId = "AGENT" | "GRANT" | "GRANT_PAUSED" | "GRANT_EXPIRED" | "SOURCE_NETWORK" | "DESTINATION_NETWORK" | "SOURCE_ASSET" | "DESTINATION_ASSET"
  | "RECIPIENT" | "VALUE_KNOWN" | "MAX_TRANSACTION" | "DAILY_LIMIT" | "MAX_TRANSACTIONS" | "FREQUENCY";
export interface GrantRule { rule: GrantRuleId; ok: boolean; reason: string }
export interface GrantSubject { sourceNetwork: string; destinationNetwork: string; sourceAssetId: string; destinationAssetId: string; recipient: string; recipientKind: "SELF" | "EXTERNAL"; valueUsd: string | null }
export interface GrantUsage { transactions: number; dayUsd: string; lastAt?: Date | null }
type GrantRow = typeof agentGrants.$inferSelect;

/**
 * Pure: may the Agent approve this transfer under this grant? Every rule must pass. Anything unknown fails: a missing
 * grant, an unknown USD value, an Agent that cannot act. The answer is "ask the user", never "allow anyway".
 */
export function assessGrant(args: { grant: Pick<GrantRow, "status" | "expiresAt" | "validFrom" | "scope"> | null; agentProblem: AgentActingProblem | null; subject: GrantSubject; usage: GrantUsage; now: Date }): { ok: boolean; rules: GrantRule[]; reasons: string[] } {
  const rules: GrantRule[] = [];
  const add = (rule: GrantRuleId, ok: boolean, reason: string) => rules.push({ rule, ok, reason });
  const { grant: g, subject: s, usage, now } = args;
  add("AGENT", !args.agentProblem, args.agentProblem ? ACTING_MESSAGE[args.agentProblem] : "Your Agent is verified and in date.");
  if (!g) { add("GRANT", false, "Your Agent has no permission to approve transfers. You approve each one yourself."); return done(rules); }
  add("GRANT", g.status === "ACTIVE" || g.status === "PAUSED", g.status === "ACTIVE" || g.status === "PAUSED" ? "Your Agent has a permission." : "Your Agent's permission ended.");
  add("GRANT_PAUSED", g.status !== "PAUSED", g.status === "PAUSED" ? "You paused your Agent's permission." : "The permission is not paused.");
  const live = now.getTime() >= g.validFrom.getTime() && now.getTime() < g.expiresAt.getTime();
  add("GRANT_EXPIRED", live, live ? "The permission is in date." : "Your Agent's permission expired.");
  const sc = g.scope as GrantScope;
  const net = (id: string) => getNetwork(id)?.name ?? id;
  add("SOURCE_NETWORK", sc.sourceNetworks.includes(s.sourceNetwork), sc.sourceNetworks.includes(s.sourceNetwork) ? `${net(s.sourceNetwork)} is an allowed source.` : `${net(s.sourceNetwork)} is not an allowed source for your Agent.`);
  add("DESTINATION_NETWORK", sc.destinationNetworks.includes(s.destinationNetwork), sc.destinationNetworks.includes(s.destinationNetwork) ? `${net(s.destinationNetwork)} is an allowed destination.` : `${net(s.destinationNetwork)} is not an allowed destination for your Agent.`);
  for (const [rule, id] of [["SOURCE_ASSET", s.sourceAssetId], ["DESTINATION_ASSET", s.destinationAssetId]] as const) {
    const sym = getAsset(id)?.symbol ?? id;
    add(rule, sc.assets.includes(id), sc.assets.includes(id) ? `${sym} is allowed.` : `${sym} on ${net(id.split(":")[0])} is not an allowed token for your Agent.`);
  }
  const recipientOk = s.recipientKind === "SELF" ? sc.recipients.self : sc.recipients.addresses.some((a) => a.network === s.destinationNetwork && sameAddress(a.network, a.address, s.recipient));
  add("RECIPIENT", recipientOk, recipientOk ? "The recipient is allowed." : s.recipientKind === "SELF" ? "Your Agent may not send to your own wallets." : "This recipient is not on your Agent's list for this network.");
  if (s.valueUsd === null) add("VALUE_KNOWN", false, "The USD value is not known, so the Agent's limits cannot be checked.");
  else {
    add("VALUE_KNOWN", true, `About $${s.valueUsd}.`);
    const over = compareDecimal(s.valueUsd, sc.maxTransactionUsd) > 0;
    add("MAX_TRANSACTION", !over, over ? `About $${s.valueUsd}, above your Agent's $${sc.maxTransactionUsd} per-transfer limit.` : `Within the Agent's $${sc.maxTransactionUsd} per-transfer limit.`);
    const total = addDecimal(usage.dayUsd, s.valueUsd);
    const dayOver = compareDecimal(total, sc.dailyLimitUsd) > 0;
    add("DAILY_LIMIT", !dayOver, dayOver ? `This would bring your Agent's last 24 hours to $${total}, above its $${sc.dailyLimitUsd} limit.` : `$${total} of the Agent's $${sc.dailyLimitUsd} for 24 hours.`);
  }
  const countOver = usage.transactions + 1 > sc.maxTransactions;
  add("MAX_TRANSACTIONS", !countOver, countOver ? `Your Agent already approved ${usage.transactions} of ${sc.maxTransactions} transfers allowed.` : `Transfer ${usage.transactions + 1} of ${sc.maxTransactions}.`);
  if (sc.minIntervalMinutes) {
    const next = usage.lastAt ? usage.lastAt.getTime() + sc.minIntervalMinutes * 60_000 : 0;
    const early = now.getTime() < next;
    add("FREQUENCY", !early, early ? `Your Agent must wait ${sc.minIntervalMinutes} minutes between transfers. Next allowed at ${new Date(next).toISOString()}.` : `At least ${sc.minIntervalMinutes} minutes since the Agent's last transfer.`);
  }
  return done(rules);
}
const done = (rules: GrantRule[]) => ({ ok: rules.every((r) => r.ok), rules, reasons: rules.filter((r) => !r.ok).map((r) => r.reason) });

/** The Agent may not approve this one. The user can still approve it themselves. */
export class GrantDecisionError extends Error {
  constructor(readonly reasons: string[], readonly rules: GrantRule[]) { super(reasons[0] ?? "Your Agent may not approve this transfer."); this.name = "GrantDecisionError"; }
}

/* ----------------------------------------------------------------- views -------------------------------------------------------------------- */

export interface GrantView {
  id: string; version: number; status: "ACTIVE" | "PAUSED" | "REVOKED" | "SUPERSEDED" | "EXPIRED";
  scope: GrantScope; validFrom: string; expiresAt: string; ownerAccountId: string; signerPublicKey: string; scopeHash: string;
  pausedAt: string | null; revokedAt: string | null; endReason: string | null; createdAt: string;
}
export function toGrantView(g: GrantRow, now: Date): GrantView {
  const expired = (g.status === "ACTIVE" || g.status === "PAUSED") && g.expiresAt.getTime() <= now.getTime();
  return {
    id: g.id, version: g.version, status: expired ? "EXPIRED" : (g.status as GrantView["status"]), scope: g.scope as GrantScope,
    validFrom: g.validFrom.toISOString(), expiresAt: g.expiresAt.toISOString(), ownerAccountId: g.ownerAccountId, signerPublicKey: g.signerPublicKey, scopeHash: g.scopeHash,
    pausedAt: g.pausedAt?.toISOString() ?? null, revokedAt: g.revokedAt?.toISOString() ?? null, endReason: g.endReason, createdAt: g.createdAt.toISOString(),
  };
}

/* ---------------------------------------------------------------- service ------------------------------------------------------------------- */

const newId = (p: string) => `${p}_${randomBytes(12).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface AgentGrantDeps { db: Db; clock?: () => Date; nearRpc?: NearRpc; ceilingUsd?: () => string }

/**
 * Agent permissions (Stage 10). Every read and write is scoped to the session user. Creating or changing a grant needs
 * the owner's NEP-413 signature over the exact scope; pause and revoke take authority away and need only the session.
 * The execution engine calls precheck() before an Agent approval and authorizeInTx() inside the approval transaction,
 * with the Agent and grant rows locked. Deposits call assertStillValid(): a paused, revoked, superseded or expired
 * grant, or an Agent that can no longer act, means the earlier Agent approval no longer authorizes anything.
 */
export class AgentGrantService {
  private readonly clock: () => Date;
  private readonly rpc: NearRpc;
  private readonly ceiling: () => string;
  constructor(private readonly d: AgentGrantDeps) {
    this.clock = d.clock ?? (() => new Date());
    this.rpc = d.nearRpc ?? defaultNearRpc();
    this.ceiling = d.ceilingUsd ?? platformCeilingUsd;
  }

  private async event(q: Db, a: { id: string; userId: string }, event: string, data: Record<string, unknown>) {
    await q.insert(agentEvents).values({ agentId: a.id, userId: a.userId, event, fromStatus: null, toStatus: null, data, at: this.clock() });
  }
  private async agentFor(userId: string, agentId: string, q: Db = this.d.db, lock = false) {
    const a = await loadAgent(q, userId, agentId, lock);
    if (!a) throw new AgentError("AGENT_NOT_FOUND", "No such Agent.");
    return a;
  }
  private async live(agentId: string, q: Db = this.d.db, lock = false): Promise<GrantRow | null> {
    const base = q.select().from(agentGrants).where(and(eq(agentGrants.agentId, agentId), inArray(agentGrants.status, ["ACTIVE", "PAUSED"]))).limit(1);
    const [g] = lock ? await base.for("update") : await base;
    return g ?? null;
  }

  /** Current permission, mode and full version history. No grant means MANUAL. */
  async view(userId: string, agentId: string) {
    await this.agentFor(userId, agentId);
    const now = this.clock();
    const rows = await this.d.db.select().from(agentGrants).where(and(eq(agentGrants.agentId, agentId), eq(agentGrants.userId, userId))).orderBy(desc(agentGrants.version));
    const live = rows.find((r) => r.status === "ACTIVE" || r.status === "PAUSED") ?? null;
    const current = live ? toGrantView(live, now) : null;
    return {
      mode: current?.status === "ACTIVE" ? "PREAUTHORIZED" as const : "MANUAL" as const,
      grant: current, usage: live ? await this.usage(this.d.db, live, now) : null,
      history: rows.map((r) => toGrantView(r, now)),
    };
  }

  /** Issue a one-time challenge naming the exact scope. Nothing changes until the signature is verified. */
  async prepare(userId: string, agentId: string, input: unknown, domain: string) {
    const a = await this.agentFor(userId, agentId);
    const now = this.clock();
    const problem = actingProblem(a, userId, now);
    if (problem) throw new AgentError(problem === "AGENT_REVOKED" ? "AGENT_REVOKED" : "AGENT_INVALID_STATE", ACTING_MESSAGE[problem]);
    const { scope, durationHours } = normalizeScope(input, this.ceiling());
    const [last] = await this.d.db.select({ v: agentGrants.version }).from(agentGrants).where(eq(agentGrants.agentId, agentId)).orderBy(desc(agentGrants.version)).limit(1);
    const version = (last?.v ?? 0) + 1;
    const id = newId("agc");
    const issuedAt = now.toISOString(), expiresAt = new Date(now.getTime() + GRANT_CHALLENGE_TTL_MS).toISOString();
    const grantExpiresAt = new Date(now.getTime() + durationHours * 3600_000);
    const message = grantMessage({ agentId, userRef: userRef(userId), accountId: a.ownerAccountId!, version, scope, validUntil: grantExpiresAt.toISOString(), domain, issuedAt, expiresAt, challengeId: id });
    const nonce = hex.encode(randomBytes(32));
    await this.d.db.insert(agentGrantChallenges).values({
      id, agentId, userId, version, scope, scopeHash: scopeHash(scope), ownerAccountId: a.ownerAccountId!, ownerPublicKey: a.ownerPublicKey!,
      domain, nonce, message, grantExpiresAt, issuedAt: now, expiresAt: new Date(expiresAt),
    });
    return { challengeId: id, version, scope, message, nonce: Buffer.from(nonce, "hex").toString("base64"), recipient: domain, accountId: a.ownerAccountId!, expiresAt, grantExpiresAt: grantExpiresAt.toISOString() };
  }

  /**
   * Verify the owner's signature and make the grant live. The challenge is consumed atomically first. The key must be
   * the Agent's verified owner key and a full-access key on NEAR now. A new version supersedes the old one.
   */
  async confirm(userId: string, agentId: string, input: { challengeId: string; accountId: string; publicKey: string; signature: string; domain: string }) {
    const a0 = await this.agentFor(userId, agentId);
    const now = this.clock();
    const [c] = await this.d.db.select().from(agentGrantChallenges).where(eq(agentGrantChallenges.id, input.challengeId)).limit(1);
    if (!c || c.agentId !== agentId || c.userId !== userId) throw new AgentError("AGENT_CHALLENGE_INVALID", "That challenge is not valid for this Agent.");
    if (c.usedAt) throw new AgentError("AGENT_CHALLENGE_USED", "That challenge was already used. Start again.");
    if (c.expiresAt.getTime() <= now.getTime()) throw new AgentError("AGENT_CHALLENGE_EXPIRED", "That challenge expired. Start again.");
    if (c.domain !== input.domain) throw new AgentError("AGENT_DOMAIN_MISMATCH", "That challenge was issued for another site.");
    const [claimed] = await this.d.db.update(agentGrantChallenges).set({ usedAt: now })
      .where(and(eq(agentGrantChallenges.id, c.id), isNull(agentGrantChallenges.usedAt), gt(agentGrantChallenges.expiresAt, now))).returning();
    if (!claimed) throw new AgentError("AGENT_CHALLENGE_USED", "That challenge was already used. Start again.");
    const fail = async (code: "AGENT_PROOF_INVALID" | "AGENT_KEY_NOT_AUTHORIZED" | "AGENT_VERIFICATION_UNAVAILABLE" | "AGENT_INVALID_STATE", message: string, reason: string) => {
      await this.d.db.update(agentGrantChallenges).set({ outcome: "FAILED" }).where(eq(agentGrantChallenges.id, c.id));
      await this.event(this.d.db, a0, "GRANT_SIGNATURE_FAILED", { challengeId: c.id, reason });
      return new AgentError(code, message);
    };
    if (input.accountId.trim().toLowerCase() !== c.ownerAccountId) throw await fail("AGENT_PROOF_INVALID", "The signature is for a different NEAR account than your Agent's owner.", "ACCOUNT_MISMATCH");
    if (input.publicKey !== c.ownerPublicKey || input.publicKey !== a0.ownerPublicKey) throw await fail("AGENT_PROOF_INVALID", "Sign with the key you verified this Agent with.", "KEY_MISMATCH");
    let ok: boolean;
    try {
      ok = await verifyNearSignature({ accountId: c.ownerAccountId, publicKey: input.publicKey, signatureB64: input.signature, message: c.message, nonceHex: c.nonce, recipient: c.domain, rpc: this.rpc });
    } catch (e) {
      if (e instanceof AuthError && e.code === "KEY_NOT_AUTHORIZED") throw await fail("AGENT_KEY_NOT_AUTHORIZED", e.message, "KEY_NOT_FULL_ACCESS");
      if (e instanceof AuthError && e.code === "NEAR_RPC_UNAVAILABLE") throw await fail("AGENT_VERIFICATION_UNAVAILABLE", "SPak could not confirm the key on NEAR, so the permission was not created. Try again.", "NEAR_RPC_UNAVAILABLE");
      throw await fail("AGENT_PROOF_INVALID", "The signature could not be verified.", "SIGNATURE_ERROR");
    }
    if (!ok) throw await fail("AGENT_PROOF_INVALID", "The signature does not match this permission.", "SIGNATURE_INVALID");
    if (sha256(canonical(c.scope)) !== c.scopeHash) throw await fail("AGENT_INVALID_STATE", "The stored permission does not match what you signed.", "SCOPE_MISMATCH");

    const at = this.clock();
    const row = await this.d.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const a = await this.agentFor(userId, agentId, tx, true);
      const problem = actingProblem(a, userId, at);
      if (problem) throw new AgentError(problem === "AGENT_REVOKED" ? "AGENT_REVOKED" : "AGENT_INVALID_STATE", ACTING_MESSAGE[problem]);
      if (a.ownerPublicKey !== c.ownerPublicKey) throw new AgentError("AGENT_INVALID_STATE", "Your Agent's owner key changed. Start again.");
      const prev = await this.live(agentId, tx, true);
      const [last] = await tx.select({ v: agentGrants.version }).from(agentGrants).where(eq(agentGrants.agentId, agentId)).orderBy(desc(agentGrants.version)).limit(1);
      if ((last?.v ?? 0) + 1 !== c.version) throw new AgentError("AGENT_CONCURRENT_UPDATE", "Your Agent's permission changed while you signed. Start again.");
      if (prev) {
        await tx.update(agentGrants).set({ status: "SUPERSEDED", endReason: `REPLACED_BY_V${c.version}`, rowVersion: prev.rowVersion + 1, updatedAt: at }).where(and(eq(agentGrants.id, prev.id), eq(agentGrants.rowVersion, prev.rowVersion)));
        await this.event(tx, a, "GRANT_SUPERSEDED", { grantId: prev.id, version: prev.version, by: c.version });
      }
      const sc = c.scope as GrantScope;
      const [g] = await tx.insert(agentGrants).values({
        id: newId("agg"), agentId, userId, version: c.version, status: "ACTIVE", scope: sc, scopeHash: c.scopeHash,
        maxTransactionUsd: sc.maxTransactionUsd, dailyLimitUsd: sc.dailyLimitUsd, maxTransactions: sc.maxTransactions,
        validFrom: at, expiresAt: c.grantExpiresAt, ownerAccountId: c.ownerAccountId, signerPublicKey: input.publicKey,
        challengeId: c.id, messageSha256: sha256(c.message), signature: input.signature, createdAt: at, updatedAt: at,
      }).returning();
      await this.event(tx, a, "GRANT_CREATED", { grantId: g.id, version: g.version, scopeHash: g.scopeHash, expiresAt: g.expiresAt.toISOString() });
      return g;
    });
    await this.d.db.update(agentGrantChallenges).set({ outcome: "VERIFIED" }).where(eq(agentGrantChallenges.id, c.id));
    return toGrantView(row, at);
  }

  private async setStatus(userId: string, agentId: string, from: GrantRow["status"][], to: "ACTIVE" | "PAUSED" | "REVOKED", event: string, reason?: string) {
    await this.agentFor(userId, agentId);
    const at = this.clock();
    return this.d.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const a = await this.agentFor(userId, agentId, tx, true);
      const g = await this.live(agentId, tx, true);
      if (!g) throw new AgentError("AGENT_INVALID_STATE", "Your Agent has no permission to change.");
      if (!from.includes(g.status)) {
        if (g.status === to) return toGrantView(g, at);
        throw new AgentError("AGENT_INVALID_STATE", `The permission is ${g.status.toLowerCase()}.`);
      }
      if (to === "ACTIVE") {
        if (g.expiresAt.getTime() <= at.getTime()) throw new AgentError("AGENT_INVALID_STATE", "This permission expired. Sign a new one.");
        const problem = actingProblem(a, userId, at);
        if (problem) throw new AgentError("AGENT_INVALID_STATE", ACTING_MESSAGE[problem]);
      }
      const patch = to === "PAUSED" ? { pausedAt: at } : to === "REVOKED" ? { revokedAt: at, endReason: reason ?? "REVOKED_BY_USER" } : { pausedAt: null };
      const [u] = await tx.update(agentGrants).set({ ...patch, status: to, rowVersion: g.rowVersion + 1, updatedAt: at })
        .where(and(eq(agentGrants.id, g.id), eq(agentGrants.rowVersion, g.rowVersion))).returning();
      if (!u) throw new AgentError("AGENT_CONCURRENT_UPDATE", "The permission changed in another request. Reload.");
      await this.event(tx, a, event, { grantId: g.id, version: g.version });
      return toGrantView(u, at);
    });
  }
  /** Takes authority away at once: in-flight Agent approvals stop at deposit. */
  pause(userId: string, agentId: string) { return this.setStatus(userId, agentId, ["ACTIVE"], "PAUSED", "GRANT_PAUSED"); }
  /** Restores the same signed scope, unchanged. Only before it expires and while the Agent can act. */
  resume(userId: string, agentId: string) { return this.setStatus(userId, agentId, ["PAUSED"], "ACTIVE", "GRANT_RESUMED"); }
  /** Permanent for this version. Back to manual approval. */
  revoke(userId: string, agentId: string) { return this.setStatus(userId, agentId, ["ACTIVE", "PAUSED"], "REVOKED", "GRANT_REVOKED"); }

  /** Transfers the Agent approved under this grant (every one that reached a Guard reservation), and their USD in the last 24 hours. */
  async usage(q: Db, g: Pick<GrantRow, "id">, now: Date, excludeExecutionId?: string): Promise<GrantUsage> {
    const rows = await q.select({ executionId: approvals.executionId, amountUsd: guardReservations.amountUsd, status: guardReservations.status, reservedAt: guardReservations.reservedAt })
      .from(approvals).innerJoin(guardReservations, and(eq(guardReservations.executionId, approvals.executionId), eq(guardReservations.quoteId, approvals.quoteId)))
      .where(and(eq(approvals.grantId, g.id), eq(approvals.approvedBy, "AGENT_GRANT")));
    const seen = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (r.executionId !== excludeExecutionId) seen.set(r.executionId, r);
    let day = "0", lastAt: Date | null = null;
    for (const r of seen.values()) {
      if (r.status !== "RELEASED" && r.reservedAt.getTime() > now.getTime() - DAY_MS) day = addDecimal(day, r.amountUsd);
      if (!lastAt || r.reservedAt.getTime() > lastAt.getTime()) lastAt = r.reservedAt;
    }
    return { transactions: seen.size, dayUsd: day, lastAt };
  }

  private subject(row: ExecutionRow, firm: QuoteRow): GrantSubject {
    return { sourceNetwork: row.sourceNetwork, destinationNetwork: row.destinationNetwork, sourceAssetId: row.sourceAssetId, destinationAssetId: row.destinationAssetId,
      recipient: row.recipient, recipientKind: row.recipientKind === "SELF" ? "SELF" : "EXTERNAL", valueUsd: cleanUsd(firm.valuationUsd) };
  }
  private async assess(q: Db, userId: string, row: ExecutionRow, firm: QuoteRow, lock: boolean) {
    if (!row.agentId) throw new GrantDecisionError(["This transfer was not started through your Agent."], []);
    const now = this.clock();
    const a = await loadAgent(q, userId, row.agentId, lock);
    const g = await this.live(row.agentId, q, lock);
    const usage = g ? await this.usage(q, g, now, row.id) : { transactions: 0, dayUsd: "0" };
    const r = assessGrant({ grant: g, agentProblem: actingProblem(a, userId, now), subject: this.subject(row, firm), usage, now });
    return { g, r };
  }

  /** Outside the transaction: which grant would authorize this, or GrantDecisionError. */
  async precheck(userId: string, row: ExecutionRow, firm: QuoteRow): Promise<{ grantId: string; grantVersion: number }> {
    const { g, r } = await this.assess(this.d.db, userId, row, firm, false);
    if (!r.ok || !g) throw new GrantDecisionError(r.reasons, r.rules);
    return { grantId: g.id, grantVersion: g.version };
  }

  /** Inside the approval transaction, Agent and grant rows locked: the same grant, still allowing this transfer. */
  async authorizeInTx(tx: Db, userId: string, row: ExecutionRow, firm: QuoteRow, expect: { grantId: string; grantVersion: number }) {
    const { g, r } = await this.assess(tx, userId, row, firm, true);
    if (!g || g.id !== expect.grantId || g.version !== expect.grantVersion) throw new GrantDecisionError(["Your Agent's permission changed during approval."], r.rules);
    if (!r.ok) throw new GrantDecisionError(r.reasons, r.rules);
  }

  /** At deposit: an Agent approval counts only while its exact grant version is ACTIVE, in date, and the Agent can act. */
  async assertStillValid(userId: string, row: ExecutionRow, approval: ApprovalRow) {
    if (approval.approvedBy !== "AGENT_GRANT") return;
    const now = this.clock();
    let problem: string | null = null;
    try {
      const [g] = await this.d.db.select().from(agentGrants).where(eq(agentGrants.id, approval.grantId!)).limit(1);
      const a = row.agentId ? await loadAgent(this.d.db, userId, row.agentId) : null;
      const acting = actingProblem(a, userId, now);
      if (!g || g.userId !== userId || g.agentId !== row.agentId || g.version !== approval.grantVersion) problem = "Your Agent's permission changed after it approved this transfer.";
      else if (g.status === "PAUSED") problem = "You paused your Agent's permission after it approved this transfer.";
      else if (g.status !== "ACTIVE") problem = "Your Agent's permission ended after it approved this transfer.";
      else if (g.expiresAt.getTime() <= now.getTime()) problem = "Your Agent's permission expired after it approved this transfer.";
      else if (acting) problem = ACTING_MESSAGE[acting];
    } catch (e) {
      console.error("[spak-agent] grant re-check failed", e);
      throw new ExecutionError("AGENT_NOT_AUTHORIZED", "SPak could not confirm your Agent's permission, so no deposit was prepared. Try again.");
    }
    if (problem) throw new ExecutionError("AGENT_GRANT_CHANGED", `${problem} Cancel it and start again, approving it yourself.`);
  }

  /** History: every grant-approved transfer, newest first (ids and amounts only). */
  async approvals(userId: string, agentId: string) {
    await this.agentFor(userId, agentId);
    // Execution monitoring: each Agent approval with the transfer's live state. AWAITING_DEPOSIT means it waits for the owner's wallet signature.
    return this.d.db.select({ executionId: approvals.executionId, grantId: approvals.grantId, grantVersion: approvals.grantVersion, approvedAt: approvals.approvedAt, invalidatedAt: approvals.invalidatedAt,
      state: executions.state, sourceNetwork: executions.sourceNetwork, destinationNetwork: executions.destinationNetwork, sourceAssetId: executions.sourceAssetId, destinationAssetId: executions.destinationAssetId, amountIn: executions.amountIn, recipient: executions.recipient })
      .from(approvals).innerJoin(agentGrants, eq(agentGrants.id, approvals.grantId)).innerJoin(executions, and(eq(executions.id, approvals.executionId), eq(executions.userId, userId)))
      .where(and(eq(agentGrants.agentId, agentId), eq(agentGrants.userId, userId), eq(approvals.approvedBy, "AGENT_GRANT"), gte(approvals.approvedAt, new Date(0))))
      .orderBy(desc(approvals.approvedAt)).limit(50);
  }
}

/** Agent lifecycle cascade: a suspended Agent's grant is paused; a revoked Agent's grant is revoked. Runs in the Agent's transaction. */
export async function cascadeAgentGrants(tx: Db, a: { id: string; userId: string }, to: string, now: Date) {
  if (to === "SUSPENDED") {
    const rows = await tx.update(agentGrants).set({ status: "PAUSED", pausedAt: now, rowVersion: sql`${agentGrants.rowVersion} + 1`, updatedAt: now })
      .where(and(eq(agentGrants.agentId, a.id), eq(agentGrants.status, "ACTIVE"))).returning({ id: agentGrants.id });
    for (const r of rows) await tx.insert(agentEvents).values({ agentId: a.id, userId: a.userId, event: "GRANT_PAUSED", fromStatus: null, toStatus: null, data: { grantId: r.id, cause: "AGENT_SUSPENDED" }, at: now });
  } else if (to === "REVOKED") {
    const rows = await tx.update(agentGrants).set({ status: "REVOKED", revokedAt: now, endReason: "AGENT_REVOKED", rowVersion: sql`${agentGrants.rowVersion} + 1`, updatedAt: now })
      .where(and(eq(agentGrants.agentId, a.id), inArray(agentGrants.status, ["ACTIVE", "PAUSED"]))).returning({ id: agentGrants.id });
    for (const r of rows) await tx.insert(agentEvents).values({ agentId: a.id, userId: a.userId, event: "GRANT_REVOKED", fromStatus: null, toStatus: null, data: { grantId: r.id, cause: "AGENT_REVOKED" }, at: now });
  }
}
