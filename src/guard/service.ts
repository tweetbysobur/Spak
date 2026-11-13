import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../database/repositories";
import { guardAssetRules, guardDecisions, guardNetworkRules, guardPolicies, guardPolicyHistory, guardRecipients, guardReservations } from "../database/schema";
import { ExecutionError } from "../execution/errors";
import type { AuditLog } from "../execution/audit";
import type { ExecutionRow, QuoteRow } from "../execution/records";
import type { ValidatedPlan } from "../execution/plan-validator";
import type { ExecutionPlan } from "../spak-in/schemas/plan";
import type { PolicyConfigInput, PolicyRuntime } from "../spak-in/schemas/policy";
import { compareDecimal, isDecimal, normalizeDecimal } from "../spak-in/lib/decimal";
import { getNetwork, listNetworks } from "../spak-in/registries/networks";
import { getAsset } from "../spak-in/registries/assets";
import { isAddressFor } from "../spak-in/validator/address";
import { platformCeilingUsd } from "./ceiling";
import { cleanUsd, effectiveMaxUsd, evaluateGuard } from "./engine";
import { WINDOWS_MS, type GuardDecision, type GuardPolicy, type GuardStage, type GuardSubject, type Spending } from "./types";

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;

/** A Guard decision that stops the transfer. Thrown inside a database transaction so the transaction rolls back. */
export class GuardDecisionError extends Error {
  constructor(readonly decision: GuardDecision) { super(decision.reasons.join(" ") || "Guard stopped this transfer."); this.name = "GuardDecisionError"; }
}

/** The public error for a stopping decision. Reasons are written for the user and name only their own settings. */
export function guardError(d: GuardDecision): ExecutionError {
  const failedRules = d.rules.filter((r) => r.status === "FAIL" || r.status === "NEEDS_CONFIGURATION").map((r) => r.rule);
  const details = { outcome: d.outcome, stage: d.stage, reasons: d.reasons, failedRules, policyVersion: d.policyVersion };
  return d.outcome === "NEEDS_CONFIGURATION"
    ? new ExecutionError("GUARD_NEEDS_CONFIGURATION", d.reasons.join(" ") || "Finish setting up Guard first.", details)
    : new ExecutionError("GUARD_BLOCKED", d.reasons.join(" ") || "Guard stopped this transfer.", details);
}

const unavailable = () => new ExecutionError("GUARD_UNAVAILABLE", "Guard could not check this transfer, so it did not go ahead. Try again shortly.");

/* --------------------------------------------------------------- settings input -------------------------------------------------------------- */

const money = z.string().max(24).refine((v) => isDecimal(v) && compareDecimal(v, "0") > 0, "must be a positive amount in USD").transform(normalizeDecimal);
const networkId = z.string().refine((n) => !!getNetwork(n), "unknown network");
const assetId = z.string().refine((a) => !!getAsset(a), "unknown asset");

export const guardUpdateSchema = z.object({
  version: z.number().int().positive(),
  maxTransactionUsd: money.nullable().optional(),
  minTransactionUsd: money.nullable().optional(),
  dailyLimitUsd: money.nullable().optional(),
  weeklyLimitUsd: money.nullable().optional(),
  monthlyLimitUsd: money.nullable().optional(),
  maxSlippageBps: z.number().int().min(1).max(5000).optional(),
  assetMode: z.enum(["ANY", "ALLOWLIST"]).optional(),
  recipientMode: z.enum(["ANY", "APPROVED_ONLY"]).optional(),
  /** Full replacement of the listed networks' rules. Networks not listed keep their rule. */
  networks: z.array(z.object({ network: networkId, allowSource: z.boolean(), allowDestination: z.boolean(), disabled: z.boolean() })).max(100).optional(),
  /** Full replacement of the asset rule list. */
  assets: z.array(z.object({ assetId, rule: z.enum(["ALLOW", "BLOCK"]) })).max(500).optional(),
}).strict();
export type GuardUpdate = z.input<typeof guardUpdateSchema>;

export const recipientInputSchema = z.object({
  version: z.number().int().positive(),
  network: networkId,
  address: z.string().trim().min(1).max(128),
  label: z.string().trim().max(60).optional(),
}).strict();

/* ------------------------------------------------------------------ service ------------------------------------------------------------------ */

type Row = typeof guardPolicies.$inferSelect;

export interface GuardDeps { db: Db; clock?: () => Date; ceilingUsd?: () => string; audit?: AuditLog }

/**
 * SPak Guard. Reads each user's policy from the database, evaluates it with the pure engine, records every
 * decision, and reserves spending atomically with approval. Every method takes the user id from the caller's
 * server-side session; no id in a request body ever selects whose policy is read or changed.
 */
export class GuardService {
  private readonly clock: () => Date;
  readonly ceilingUsd: () => string;
  constructor(private readonly d: GuardDeps) {
    this.clock = d.clock ?? (() => new Date());
    this.ceilingUsd = d.ceilingUsd ?? platformCeilingUsd;
  }

  /* -------- reads -------- */

  /** The user's policy, or null when none exists. Throws when stored values are not valid (fail closed). */
  async load(userId: string, q: Db = this.d.db, lock = false): Promise<GuardPolicy | null> {
    const base = q.select().from(guardPolicies).where(eq(guardPolicies.userId, userId)).limit(1);
    const [row] = lock ? await base.for("update") : await base;
    if (!row) return null;
    const [nets, assets, recipients] = await Promise.all([
      q.select().from(guardNetworkRules).where(eq(guardNetworkRules.userId, userId)),
      q.select().from(guardAssetRules).where(eq(guardAssetRules.userId, userId)),
      q.select().from(guardRecipients).where(eq(guardRecipients.userId, userId)).orderBy(guardRecipients.createdAt),
    ]);
    return toPolicy(row, nets, assets, recipients);
  }

  /** The user's policy, creating the default on first use. The default equals the protections SPak always had. */
  async ensure(userId: string): Promise<GuardPolicy> {
    const existing = await this.load(userId);
    if (existing) return existing;
    const now = this.clock();
    await this.d.db.transaction(async (tx) => {
      const [created] = await tx.insert(guardPolicies).values({
        userId, version: 1, status: "ACTIVE", executionDisabled: false, maxSlippageBps: 100, assetMode: "ANY", recipientMode: "ANY", createdAt: now, updatedAt: now,
      }).onConflictDoNothing().returning();
      if (!created) return; // another request created it first
      await tx.insert(guardNetworkRules).values(listNetworks().map((n) => ({ userId, network: n.id, allowSource: true, allowDestination: true, disabled: false }))).onConflictDoNothing();
      await tx.insert(guardPolicyHistory).values({ userId, version: 1, actor: "system", action: "CREATED_DEFAULT", changes: {}, at: now }).onConflictDoNothing();
    });
    const p = await this.load(userId);
    if (!p) throw unavailable();
    return p;
  }

  /** USD reserved or consumed in each rolling window, excluding one execution. */
  async spending(userId: string, q: Db = this.d.db, excludeExecutionId?: string): Promise<Spending> {
    const now = this.clock().getTime();
    const sum = (since: number) => sql<string>`coalesce(sum(case when ${guardReservations.reservedAt} > ${new Date(since).toISOString()}::timestamptz then cast(${guardReservations.amountUsd} as numeric) else 0 end), 0)::text`;
    const [r] = await q.select({ day: sum(now - WINDOWS_MS.day), week: sum(now - WINDOWS_MS.week), month: sum(now - WINDOWS_MS.month) })
      .from(guardReservations).where(and(
        eq(guardReservations.userId, userId), inArray(guardReservations.status, ["RESERVED", "CONSUMED"]),
        gt(guardReservations.reservedAt, new Date(now - WINDOWS_MS.month)),
        ...(excludeExecutionId ? [ne(guardReservations.executionId, excludeExecutionId)] : []),
      ));
    return { dayUsd: normalizeDecimal(r?.day ?? "0"), weekUsd: normalizeDecimal(r?.week ?? "0"), monthUsd: normalizeDecimal(r?.month ?? "0") };
  }

  /** Everything the Guard page shows. */
  async view(userId: string) {
    const policy = await this.ensure(userId);
    const spending = await this.spending(userId);
    const known = new Set(Object.keys(policy.networks));
    return {
      policy, spending, ceilingUsd: this.ceilingUsd(),
      /** Supported networks with no rule yet: they need a decision before use. */
      unconfiguredNetworks: listNetworks().filter((n) => !known.has(n.id)).map((n) => n.id),
    };
  }

  async history(userId: string, limit = 50) {
    return this.d.db.select().from(guardPolicyHistory).where(eq(guardPolicyHistory.userId, userId)).orderBy(desc(guardPolicyHistory.version)).limit(limit);
  }

  async decisionsFor(userId: string, executionId: string) {
    return this.d.db.select().from(guardDecisions).where(and(eq(guardDecisions.userId, userId), eq(guardDecisions.executionId, executionId))).orderBy(guardDecisions.at);
  }

  async reservationFor(userId: string, executionId: string) {
    const [r] = await this.d.db.select().from(guardReservations).where(and(eq(guardReservations.userId, userId), eq(guardReservations.executionId, executionId))).limit(1);
    return r ?? null;
  }

  /* -------- writes: each one locks the policy row, checks the version, bumps it and records history -------- */

  private async change(userId: string, version: number | null, action: string, fn: (tx: Db, p: GuardPolicy) => Promise<Record<string, unknown>>) {
    await this.ensure(userId);
    const now = this.clock();
    let next = 0;
    let changes: Record<string, unknown> = {};
    await this.d.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const p = await this.load(userId, tx, true);
      if (!p) throw unavailable();
      if (version !== null && p.version !== version) {
        throw new ExecutionError("GUARD_VERSION_CONFLICT", "Your Guard settings changed in another window. Reload and try again.", { currentVersion: p.version });
      }
      changes = await fn(tx, p);
      next = p.version + 1;
      await tx.update(guardPolicies).set({ version: next, updatedAt: now }).where(and(eq(guardPolicies.userId, userId), eq(guardPolicies.version, p.version)));
      await tx.insert(guardPolicyHistory).values({ userId, version: next, actor: `user:${userId}`, action, changes, at: now });
    });
    await this.d.audit?.record({ at: now.toISOString(), actor: `user:${userId}`, event: `GUARD_${action}`, ref: userId, data: { version: next, changes } }).catch(() => {});
    return this.view(userId);
  }

  async update(userId: string, input: unknown) {
    const u = parseOrThrow(guardUpdateSchema, input);
    return this.change(userId, u.version, "UPDATED", async (tx, p) => {
      const lim = {
        maxTransactionUsd: u.maxTransactionUsd !== undefined ? u.maxTransactionUsd : p.limits.maxTransactionUsd,
        minTransactionUsd: u.minTransactionUsd !== undefined ? u.minTransactionUsd : p.limits.minTransactionUsd,
        dailyLimitUsd: u.dailyLimitUsd !== undefined ? u.dailyLimitUsd : p.limits.dailyUsd,
        weeklyLimitUsd: u.weeklyLimitUsd !== undefined ? u.weeklyLimitUsd : p.limits.weeklyUsd,
        monthlyLimitUsd: u.monthlyLimitUsd !== undefined ? u.monthlyLimitUsd : p.limits.monthlyUsd,
      };
      validateLimits(lim, this.ceilingUsd());
      const changes: Record<string, unknown> = {};
      const before: Record<string, unknown> = { maxTransactionUsd: p.limits.maxTransactionUsd, minTransactionUsd: p.limits.minTransactionUsd, dailyLimitUsd: p.limits.dailyUsd, weeklyLimitUsd: p.limits.weeklyUsd, monthlyLimitUsd: p.limits.monthlyUsd, maxSlippageBps: p.maxSlippageBps, assetMode: p.assetMode, recipientMode: p.recipientMode };
      const after = { ...lim, maxSlippageBps: u.maxSlippageBps ?? p.maxSlippageBps, assetMode: u.assetMode ?? p.assetMode, recipientMode: u.recipientMode ?? p.recipientMode };
      for (const k of Object.keys(after) as (keyof typeof after)[]) if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
      await tx.update(guardPolicies).set(after).where(eq(guardPolicies.userId, userId));
      if (u.networks) {
        for (const n of u.networks) {
          const prev = p.networks[n.network];
          if (prev && prev.allowSource === n.allowSource && prev.allowDestination === n.allowDestination && prev.disabled === n.disabled) continue;
          changes[`network:${n.network}`] = { from: prev ?? null, to: { allowSource: n.allowSource, allowDestination: n.allowDestination, disabled: n.disabled } };
          await tx.insert(guardNetworkRules).values({ userId, ...n }).onConflictDoUpdate({ target: [guardNetworkRules.userId, guardNetworkRules.network], set: { allowSource: n.allowSource, allowDestination: n.allowDestination, disabled: n.disabled } });
        }
      }
      if (u.assets) {
        const seen = new Set<string>();
        for (const a of u.assets) { if (seen.has(a.assetId)) throw new ExecutionError("GUARD_INVALID_SETTING", "Each token can have only one rule."); seen.add(a.assetId); }
        changes.assets = { from: p.assets, to: Object.fromEntries(u.assets.map((a) => [a.assetId, a.rule])) };
        await tx.delete(guardAssetRules).where(eq(guardAssetRules.userId, userId));
        if (u.assets.length) await tx.insert(guardAssetRules).values(u.assets.map((a) => ({ userId, assetId: a.assetId, rule: a.rule })));
      }
      return changes;
    });
  }

  async addRecipient(userId: string, input: unknown) {
    const r = parseOrThrow(recipientInputSchema, input);
    const fam = getNetwork(r.network)!.family;
    if (!isAddressFor(fam, r.address)) throw new ExecutionError("GUARD_INVALID_SETTING", `That is not a valid ${getNetwork(r.network)!.name} address.`);
    const address = fam === "evm" ? r.address.toLowerCase() : r.address;
    return this.change(userId, r.version, "RECIPIENT_ADDED", async (tx) => {
      const [row] = await tx.insert(guardRecipients).values({ id: id("grc"), userId, network: r.network, address, label: r.label || null, createdAt: this.clock() }).onConflictDoNothing().returning();
      if (!row) throw new ExecutionError("GUARD_INVALID_SETTING", "That recipient is already approved on this network.");
      return { recipient: { network: r.network, address, label: r.label || null } };
    });
  }

  async removeRecipient(userId: string, recipientId: string, version: unknown) {
    const v = parseOrThrow(z.number().int().positive(), version);
    return this.change(userId, v, "RECIPIENT_REMOVED", async (tx) => {
      // Scoped to the user: another user's recipient id is simply not found.
      const [row] = await tx.delete(guardRecipients).where(and(eq(guardRecipients.id, recipientId), eq(guardRecipients.userId, userId))).returning();
      if (!row) throw new ExecutionError("GUARD_RECIPIENT_NOT_FOUND", "No such recipient.");
      return { recipient: { network: row.network, address: row.address } };
    });
  }

  /** Emergency controls. No version check: stopping must always work. Resuming clears both. */
  async pause(userId: string, scope: "REQUESTS" | "ALL") {
    return this.change(userId, null, scope === "ALL" ? "EXECUTION_DISABLED" : "PAUSED", async (tx, p) => {
      await tx.update(guardPolicies).set({ status: "PAUSED", ...(scope === "ALL" ? { executionDisabled: true } : {}) }).where(eq(guardPolicies.userId, userId));
      return { status: { from: p.status, to: "PAUSED" }, ...(scope === "ALL" ? { executionDisabled: { from: p.executionDisabled, to: true } } : {}) };
    });
  }
  async resume(userId: string, version: unknown) {
    const v = parseOrThrow(z.number().int().positive(), version);
    return this.change(userId, v, "RESUMED", async (tx, p) => {
      await tx.update(guardPolicies).set({ status: "ACTIVE", executionDisabled: false }).where(eq(guardPolicies.userId, userId));
      return { status: { from: p.status, to: "ACTIVE" }, executionDisabled: { from: p.executionDisabled, to: false } };
    });
  }

  /* -------- enforcement -------- */

  /** SPak-in's interpretation-time view of the stored policy. Replaces anything the browser used to send. */
  async interpretContext(userId: string): Promise<{ policy: PolicyConfigInput; runtime: PolicyRuntime }> {
    try {
      const p = await this.ensure(userId);
      const s = await this.spending(userId);
      const max = effectiveMaxUsd(p, this.ceilingUsd());
      return {
        policy: {
          maxTransactionUsd: max, ...(p.limits.dailyUsd ? { dailyLimitUsd: p.limits.dailyUsd } : {}),
          allowedNetworks: Object.entries(p.networks).filter(([, r]) => !r.disabled && (r.allowSource || r.allowDestination)).map(([n]) => n),
          ...(p.assetMode === "ALLOWLIST" ? { allowedAssets: Object.entries(p.assets).filter(([, r]) => r === "ALLOW").map(([a]) => a) } : {}),
          maxSlippageBps: p.maxSlippageBps, recipientMode: p.recipientMode, approvedRecipients: p.recipients.map((r) => r.address),
          autonomous: { enabled: false },
        },
        runtime: { spentTodayUsd: s.dayUsd, pricesUsd: {} },
      };
    } catch (e) { throw e instanceof ExecutionError ? e : this.fail(e); }
  }

  /** Evaluate and record. Any failure to load, evaluate or record is GUARD_UNAVAILABLE: the caller does not proceed. */
  private async decide(userId: string, stage: GuardStage, subject: GuardSubject): Promise<GuardDecision> {
    try {
      const policy = await this.ensure(userId);
      const spending = await this.spending(userId, this.d.db, subject.executionId ?? undefined);
      const decision = evaluateGuard({ policy, subject, spending, stage, ceilingUsd: this.ceilingUsd(), now: this.clock() });
      await this.record(userId, decision);
      return decision;
    } catch (e) { throw e instanceof ExecutionError ? e : this.fail(e); }
  }

  async record(userId: string, d: GuardDecision, q: Db = this.d.db): Promise<string> {
    const decisionId = id("gdc");
    await q.insert(guardDecisions).values({
      id: decisionId, userId, executionId: d.executionId, stage: d.stage, outcome: d.outcome, planHash: d.planHash, quoteId: d.quoteId,
      policyVersion: d.policyVersion, valueUsd: d.valueUsd, rules: d.rules, reasons: d.reasons, at: new Date(d.evaluatedAt),
    });
    return decisionId;
  }

  /** A SPak-in plan, before anything is quoted. Returns the decision (the interpret route shows it). Null for plans that move no value. */
  async checkPlan(userId: string, plan: ExecutionPlan, recipientKind: "SELF" | "EXTERNAL" | null): Promise<GuardDecision | null> {
    const leg = plan.legs[0];
    if (!leg) return null;
    return this.decide(userId, "PLAN", {
      sourceNetwork: leg.sourceNetwork, destinationNetwork: leg.destinationNetwork, sourceAssetId: leg.sourceAssetId, destinationAssetId: leg.destinationAssetId,
      recipient: leg.recipient, recipientKind: recipientKind ?? "EXTERNAL", slippageBps: plan.constraints.slippageBps,
      valueUsd: leg.amount.kind === "FIAT_VALUE" ? leg.amount.value : null, planHash: plan.hash, quoteId: null, executionId: null,
    });
  }

  /** Before an execution is created from a validated plan. Throws unless Guard allows it to go on to approval. */
  async enforcePlan(userId: string, v: ValidatedPlan): Promise<GuardDecision> {
    const d = await this.decide(userId, "PLAN", {
      sourceNetwork: v.leg.sourceNetwork, destinationNetwork: v.leg.destinationNetwork, sourceAssetId: v.leg.sourceAssetId, destinationAssetId: v.leg.destinationAssetId,
      recipient: v.leg.recipient, recipientKind: v.recipientKind, slippageBps: v.plan.constraints.slippageBps, valueUsd: null, planHash: v.plan.hash, quoteId: null, executionId: null,
    });
    if (d.outcome !== "REQUIRES_APPROVAL") throw guardError(d);
    return d;
  }

  /** After a quote (indicative or firm), on the route, amount, fees and slippage the provider actually returned. */
  async enforceQuote(stage: "QUOTE" | "FIRM_QUOTE", row: ExecutionRow, quote: QuoteRow): Promise<GuardDecision> {
    const d = await this.decide(row.userId, stage, subjectOf(row, quote));
    if (d.outcome !== "REQUIRES_APPROVAL") throw guardError(d);
    return d;
  }

  /**
   * Inside the approval transaction: lock the user's policy row (serialising this user's approvals), re-read the
   * latest policy, require that Guard checked this exact firm quote, evaluate against current spending, and reserve.
   * Throws GuardDecisionError to roll the approval back. Idempotent per execution.
   */
  async reserveInTx(tx: Db, row: ExecutionRow, quote: QuoteRow): Promise<GuardDecision> {
    const policy = await this.load(row.userId, tx, true);
    const now = this.clock();
    const subject = subjectOf(row, quote);
    const [existing] = await tx.select().from(guardReservations).where(eq(guardReservations.executionId, row.id)).limit(1);
    if (existing) {
      if (existing.status === "RESERVED" && existing.quoteId === quote.id) {
        // Still evaluated against the current policy: a pause, disabled execution or lowered limit stops it here too.
        const again = evaluateGuard({ policy, subject, spending: await this.spending(row.userId, tx, row.id), stage: "APPROVAL", ceilingUsd: this.ceilingUsd(), now, quoteChecked: true });
        if (again.outcome !== "ALLOWED") throw new GuardDecisionError(again);
        return again;
      }
      const reason = "This transfer's spending reservation was already settled. Start a new transfer.";
      throw new GuardDecisionError({ outcome: "BLOCKED", stage: "APPROVAL", rules: [{ rule: "POLICY", status: "FAIL", reason }], reasons: [reason],
        policyVersion: policy?.version ?? null, valueUsd: subject.valueUsd, planHash: row.planHash, quoteId: quote.id, executionId: row.id, evaluatedAt: now.toISOString() });
    }
    const [checked] = await tx.select({ id: guardDecisions.id }).from(guardDecisions).where(and(
      eq(guardDecisions.executionId, row.id), eq(guardDecisions.quoteId, quote.id), eq(guardDecisions.planHash, row.planHash),
      eq(guardDecisions.stage, "FIRM_QUOTE"), eq(guardDecisions.outcome, "REQUIRES_APPROVAL"),
    )).limit(1);
    const spending = await this.spending(row.userId, tx, row.id);
    const decision = evaluateGuard({ policy, subject, spending, stage: "APPROVAL", ceilingUsd: this.ceilingUsd(), now, quoteChecked: !!checked });
    if (decision.outcome !== "ALLOWED" || !decision.valueUsd) throw new GuardDecisionError(decision);
    const decisionId = await this.record(row.userId, decision, tx);
    await tx.insert(guardReservations).values({
      id: id("grs"), userId: row.userId, executionId: row.id, quoteId: quote.id, decisionId, amountUsd: decision.valueUsd, status: "RESERVED", reservedAt: now,
    });
    return decision;
  }

  /**
   * Stage 10, for transfers the Agent approved: before deposit instructions, the full approval-stage policy again
   * (limits, recipients, tokens, slippage, pause), so a policy change after the Agent approved applies at once.
   * Spending excludes this execution's own reservation.
   */
  async recheckApproval(row: ExecutionRow, quote: QuoteRow): Promise<GuardDecision> {
    let d: GuardDecision;
    try {
      const policy = await this.ensure(row.userId);
      d = evaluateGuard({ policy, subject: subjectOf(row, quote), spending: await this.spending(row.userId, this.d.db, row.id), stage: "APPROVAL", ceilingUsd: this.ceilingUsd(), now: this.clock(), quoteChecked: true });
      await this.record(row.userId, d);
    } catch (e) { throw e instanceof ExecutionError ? e : this.fail(e); }
    if (d.outcome !== "ALLOWED") throw guardError(d);
    return d;
  }

  /** Before deposit instructions are prepared: emergency controls, networks, and a live reservation for this execution. */
  async enforceDeposit(row: ExecutionRow, quote: QuoteRow): Promise<GuardDecision> {
    let d: GuardDecision;
    try {
      const reservation = await this.reservationFor(row.userId, row.id);
      // ensure, not load: a transfer approved before Guard existed (backfilled reservation) belongs to a user who may
      // have no policy row yet, and its deposit must still be preparable under the default policy.
      const policy = await this.ensure(row.userId);
      d = evaluateGuard({ policy, subject: subjectOf(row, quote), spending: zero, stage: "DEPOSIT", ceilingUsd: this.ceilingUsd(), now: this.clock() });
      if (!reservation || reservation.status !== "RESERVED") {
        d = { ...d, outcome: "BLOCKED", rules: [...d.rules, { rule: "POLICY", status: "FAIL", reason: "This transfer has no Guard spending reservation. Start a new transfer." }] };
        d.reasons = d.rules.filter((r) => r.status !== "PASS" && r.status !== "NOT_APPLICABLE").map((r) => r.reason);
      }
      await this.record(row.userId, d);
    } catch (e) { throw e instanceof ExecutionError ? e : this.fail(e); }
    if (d.outcome !== "ALLOWED") throw guardError(d);
    return d;
  }

  private fail(e: unknown): ExecutionError {
    console.error("[spak-guard] evaluation failed", e);
    return unavailable();
  }
}

const zero: Spending = { dayUsd: "0", weekUsd: "0", monthUsd: "0" };

function subjectOf(row: ExecutionRow, quote: QuoteRow): GuardSubject {
  return {
    sourceNetwork: row.sourceNetwork, destinationNetwork: row.destinationNetwork, sourceAssetId: row.sourceAssetId, destinationAssetId: row.destinationAssetId,
    recipient: row.recipient, recipientKind: row.recipientKind === "SELF" ? "SELF" : "EXTERNAL", slippageBps: quote.slippageBps,
    valueUsd: cleanUsd(quote.amountInUsd), quote: { amountOut: quote.amountOut, minAmountOut: quote.minAmountOut },
    planHash: row.planHash, quoteId: quote.id, executionId: row.id,
  };
}

const storedMoney = z.string().refine(isDecimal).nullable();
const storedRow = z.object({
  version: z.number().int().positive(), status: z.enum(["ACTIVE", "PAUSED"]), executionDisabled: z.boolean(),
  maxTransactionUsd: storedMoney, minTransactionUsd: storedMoney, dailyLimitUsd: storedMoney, weeklyLimitUsd: storedMoney, monthlyLimitUsd: storedMoney,
  maxSlippageBps: z.number().int().min(1).max(5000), assetMode: z.enum(["ANY", "ALLOWLIST"]), recipientMode: z.enum(["ANY", "APPROVED_ONLY"]),
}).passthrough();

/** Stored rows to a policy. Anything malformed throws, which callers turn into GUARD_UNAVAILABLE (fail closed). */
function toPolicy(row: Row, nets: (typeof guardNetworkRules.$inferSelect)[], assets: (typeof guardAssetRules.$inferSelect)[], recipients: (typeof guardRecipients.$inferSelect)[]): GuardPolicy {
  const r = storedRow.parse(row) as unknown as Row & z.infer<typeof storedRow>;
  return {
    userId: row.userId, version: r.version, status: r.status, executionDisabled: r.executionDisabled,
    limits: { maxTransactionUsd: r.maxTransactionUsd, minTransactionUsd: r.minTransactionUsd, dailyUsd: r.dailyLimitUsd, weeklyUsd: r.weeklyLimitUsd, monthlyUsd: r.monthlyLimitUsd },
    maxSlippageBps: r.maxSlippageBps, assetMode: r.assetMode, recipientMode: r.recipientMode,
    networks: Object.fromEntries(nets.map((n) => [n.network, { allowSource: n.allowSource, allowDestination: n.allowDestination, disabled: n.disabled }])),
    assets: Object.fromEntries(assets.map((a) => [a.assetId, z.enum(["ALLOW", "BLOCK"]).parse(a.rule)])),
    recipients: recipients.map((x) => ({ id: x.id, network: x.network, address: x.address, label: x.label })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateLimits(l: { maxTransactionUsd: string | null; minTransactionUsd: string | null; dailyLimitUsd: string | null; weeklyLimitUsd: string | null; monthlyLimitUsd: string | null }, ceiling: string) {
  const bad = (m: string) => { throw new ExecutionError("GUARD_INVALID_SETTING", m); };
  if (l.maxTransactionUsd && compareDecimal(l.maxTransactionUsd, ceiling) > 0) bad(`The per-transfer limit cannot be above SPak's $${ceiling} ceiling.`);
  if (l.minTransactionUsd && l.maxTransactionUsd && compareDecimal(l.minTransactionUsd, l.maxTransactionUsd) > 0) bad("The minimum cannot be above the per-transfer limit.");
  if (l.minTransactionUsd && compareDecimal(l.minTransactionUsd, ceiling) > 0) bad(`The minimum cannot be above SPak's $${ceiling} ceiling.`);
  const chain: [string | null, string][] = [[l.dailyLimitUsd, "daily"], [l.weeklyLimitUsd, "weekly"], [l.monthlyLimitUsd, "monthly"]];
  for (let i = 0; i < chain.length; i++) for (let j = i + 1; j < chain.length; j++) {
    const [a, an] = chain[i], [b, bn] = chain[j];
    if (a && b && compareDecimal(a, b) > 0) bad(`The ${an} limit cannot be above the ${bn} limit.`);
  }
}

function parseOrThrow<T extends z.ZodTypeAny>(s: T, v: unknown): z.output<T> {
  const r = s.safeParse(v);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ExecutionError("GUARD_INVALID_SETTING", `${i.path.join(".") || "input"}: ${i.message}`);
  }
  return r.data;
}
