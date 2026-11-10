import { err, type SpakError } from "../errors/codes";
import { hashObject, randomIds, type IdFactory } from "../lib/hash";
import { planHash } from "../planner/execution-planner";
import { executionPlanSchema, type ExecutionPlan } from "../schemas/plan";
import { MemoryAuditLog, MemorySubmissionRepository } from "./memory";
import {
  approvalSchema, DuplicateKeyError, TERMINAL_STATES, type ApprovalInput, type AuditLog, type ExecutionProvider,
  type ProviderQuote, type Submission, type SubmissionRepository,
} from "./types";

export const APPROVAL_TTL_MS = 10 * 60_000;
export const DUPLICATE_WINDOW_MS = 2 * 60_000;

export type CoordinatorResult<T> = { ok: true; value: T } | { ok: false; error: SpakError };

/** Where the coordinator looks up plans SPak-in produced. With it, plans built anywhere else are refused. */
export interface PlanSource {
  get(planHash: string): Promise<ExecutionPlan | null>;
}

export interface CoordinatorOptions {
  providers: ExecutionProvider[];
  /** Strongly recommended in production: only accept plans SPak-in issued. */
  planSource?: PlanSource;
  submissions?: SubmissionRepository;
  audit?: AuditLog;
  ids?: IdFactory;
  clock?: () => Date;
}

/**
 * Execution Coordinator: the only door between SPak-in and SPak Execution.
 * - Holds no keys and signs nothing. It returns deposit instructions for the user's wallet.
 * - Refuses plans that changed after approval (hash check), stale approvals and duplicates.
 * - Never reports COMPLETED unless the provider verified delivery.
 */
export class ExecutionCoordinator {
  private readonly providers: ExecutionProvider[];
  readonly submissions: SubmissionRepository;
  readonly audit: AuditLog;
  private readonly ids: IdFactory;
  private readonly clock: () => Date;
  private readonly planSource?: PlanSource;

  constructor(o: CoordinatorOptions) {
    this.planSource = o.planSource;
    this.providers = o.providers;
    this.submissions = o.submissions ?? new MemorySubmissionRepository();
    this.audit = o.audit ?? new MemoryAuditLog();
    this.ids = o.ids ?? randomIds;
    this.clock = o.clock ?? (() => new Date());
  }

  private async checkPlan(raw: unknown): Promise<CoordinatorResult<{ plan: ExecutionPlan; provider: ExecutionProvider }>> {
    const parsed = executionPlanSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: err("PLAN_NOT_EXECUTABLE", "The plan is malformed.") };
    let plan = parsed.data;
    if (this.planSource) {
      const issued = await this.planSource.get(plan.hash);
      if (!issued) return { ok: false, error: err("APPROVAL_MISMATCH", "SPak-in did not issue this plan. Interpret the instruction again.") };
      plan = issued; // trust the stored copy, never the client's
    }
    const { planId: _p, hash, ...body } = plan;
    if (planHash(body) !== hash || `spak_plan_${hash.slice(0, 16)}` !== plan.planId) {
      return { ok: false, error: err("APPROVAL_MISMATCH", "The plan was changed after SPak-in produced it.") };
    }
    if (!plan.executable) return { ok: false, error: err("PLAN_NOT_EXECUTABLE", `This plan needs ${plan.requires.join(", ") || "more steps"} before it can be quoted.`) };
    const reasons: string[] = [];
    for (const p of this.providers) {
      const s = p.supports(plan);
      if (s.ok) return { ok: true, value: { plan, provider: p } };
      reasons.push(`${p.id}: ${s.reason}`);
    }
    return { ok: false, error: err("PROVIDER_UNAVAILABLE", `No execution provider supports this plan. ${reasons.join(" ")}`) };
  }

  /** Price check. Moves nothing and creates no deposit address. */
  async quote(rawPlan: unknown): Promise<CoordinatorResult<ProviderQuote>> {
    const c = await this.checkPlan(rawPlan);
    if (!c.ok) return c;
    try { return { ok: true, value: await c.value.provider.quote(c.value.plan) }; }
    catch (e) { return { ok: false, error: err("PROVIDER_ERROR", (e as Error).message) }; }
  }

  /** Approved plan in, deposit instructions out. Idempotent per plan and per idempotency key. */
  async submit(input: { plan: unknown; approval: ApprovalInput; userId: string }): Promise<CoordinatorResult<{ submission: Submission; duplicate: boolean }>> {
    const c = await this.checkPlan(input.plan);
    if (!c.ok) return c;
    const { plan, provider } = c.value;
    const a = approvalSchema.safeParse(input.approval);
    if (!a.success) return { ok: false, error: err("APPROVAL_REQUIRED", "A valid approval is required.") };
    const approval = a.data;
    const now = this.clock();

    if (approval.planHash !== plan.hash || approval.planId !== plan.planId || approval.intentId !== plan.intentId) {
      return { ok: false, error: err("APPROVAL_MISMATCH", "The approval is for a different plan. Review and approve again.") };
    }
    const age = now.getTime() - Date.parse(approval.approvedAt);
    if (age > APPROVAL_TTL_MS || age < -60_000) return { ok: false, error: err("APPROVAL_EXPIRED", "The approval expired. Review the quote and approve again.") };
    if (approval.approvedBy === "POLICY" && (plan.approvalRequired || plan.executionMode !== "AUTONOMOUS")) {
      return { ok: false, error: err("AUTONOMY_NOT_PERMITTED", "This plan needs a person to approve it.") };
    }

    // Duplicate prevention, cheapest checks first.
    const byKey = approval.idempotencyKey ? await this.submissions.findByIdempotencyKey(input.userId, approval.idempotencyKey) : null;
    if (byKey) {
      if (byKey.planHash !== plan.hash) return { ok: false, error: err("DUPLICATE_SUBMISSION", "This idempotency key was already used for a different plan.") };
      return { ok: true, value: { submission: byKey, duplicate: true } };
    }
    const byPlan = await this.submissions.findByPlanHash(plan.hash);
    if (byPlan) return { ok: true, value: { submission: byPlan, duplicate: true } };
    const fingerprint = hashObject({ userId: input.userId, legs: plan.legs, schedule: plan.schedule, condition: plan.condition });
    const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString();
    const recent = (await this.submissions.findRecentByFingerprint(input.userId, fingerprint, since)).filter((s) => s.state !== "FAILED" && s.state !== "CANCELLED");
    if (recent.length && !approval.allowDuplicate) {
      return { ok: false, error: err("DUPLICATE_SUSPECTED", "You submitted the same transfer less than 2 minutes ago. Confirm to send it again.", undefined, { existing: recent[0].id }) };
    }

    const stamp = now.toISOString();
    const sub: Submission = {
      id: this.ids("spak_sub"), userId: input.userId, intentId: plan.intentId, planId: plan.planId, planHash: plan.hash,
      fingerprint, idempotencyKey: approval.idempotencyKey ?? null, provider: provider.id, state: "PREPARING",
      providerRef: null, deposit: null, quote: null, error: null, createdAt: stamp, updatedAt: stamp,
    };
    try {
      await this.submissions.create(sub); // atomic reservation: a concurrent second submit fails here
    } catch (e) {
      if (e instanceof DuplicateKeyError) {
        const existing = (approval.idempotencyKey && (await this.submissions.findByIdempotencyKey(input.userId, approval.idempotencyKey))) || (await this.submissions.findByPlanHash(plan.hash));
        if (existing) return { ok: true, value: { submission: existing, duplicate: true } };
      }
      throw e;
    }
    await this.audit.record({ at: stamp, actor: approval.approvedBy === "USER" ? `user:${input.userId}` : "policy", event: "PLAN_APPROVED", ref: sub.id, data: { planId: plan.planId, planHash: plan.hash, provider: provider.id } });

    try {
      const prepared = await provider.prepare(plan);
      const patch: Partial<Submission> = { state: "AWAITING_DEPOSIT", providerRef: prepared.providerRef, deposit: prepared.deposit, quote: prepared.quote, updatedAt: this.clock().toISOString() };
      await this.submissions.update(sub.id, patch);
      await this.audit.record({ at: patch.updatedAt!, actor: "coordinator", event: "DEPOSIT_PREPARED", ref: sub.id, data: { providerRef: prepared.providerRef, deadline: prepared.deposit.deadline } });
      return { ok: true, value: { submission: { ...sub, ...patch }, duplicate: false } };
    } catch (e) {
      const error = err("PROVIDER_ERROR", (e as Error).message);
      await this.submissions.update(sub.id, { state: "FAILED", error, updatedAt: this.clock().toISOString() });
      await this.audit.record({ at: this.clock().toISOString(), actor: "coordinator", event: "PREPARE_FAILED", ref: sub.id, data: { message: error.message } });
      return { ok: false, error };
    }
  }

  /** Ask the provider for the current state. COMPLETED only comes from the provider's verified status. */
  async refresh(submissionId: string): Promise<CoordinatorResult<Submission>> {
    const s = await this.submissions.get(submissionId);
    if (!s) return { ok: false, error: err("TRANSACTION_NOT_FOUND", `No submission ${submissionId}.`) };
    if (TERMINAL_STATES.has(s.state) || !s.providerRef) return { ok: true, value: s };
    const provider = this.providers.find((p) => p.id === s.provider);
    if (!provider) return { ok: false, error: err("PROVIDER_UNAVAILABLE", `Provider ${s.provider} is not configured.`) };
    try {
      const st = await provider.status(s.providerRef, s.deposit?.deadline ?? null);
      if (st.state !== s.state) {
        const updatedAt = this.clock().toISOString();
        await this.submissions.update(s.id, { state: st.state, updatedAt });
        await this.audit.record({ at: updatedAt, actor: "coordinator", event: `STATE_${st.state}`, ref: s.id, data: { raw: st.raw, originTxHashes: st.originTxHashes, destinationTxHashes: st.destinationTxHashes } });
        return { ok: true, value: { ...s, state: st.state, updatedAt } };
      }
      return { ok: true, value: s };
    } catch (e) {
      return { ok: false, error: err("PROVIDER_ERROR", (e as Error).message) };
    }
  }

  /** Cancel before any deposit. After a deposit the provider settles or refunds; nothing can recall it. */
  async cancel(submissionId: string, userId: string): Promise<CoordinatorResult<Submission>> {
    const r = await this.refresh(submissionId);
    if (!r.ok) return r;
    const s = r.value;
    if (s.userId !== userId) return { ok: false, error: err("TRANSACTION_NOT_FOUND", `No submission ${submissionId}.`) };
    if (s.state !== "AWAITING_DEPOSIT" && s.state !== "PREPARING") {
      return { ok: false, error: err("NO_PENDING_TRANSACTION", `This transaction is ${s.state.toLowerCase()} and cannot be cancelled.`) };
    }
    const updatedAt = this.clock().toISOString();
    await this.submissions.update(s.id, { state: "CANCELLED", updatedAt });
    await this.audit.record({ at: updatedAt, actor: `user:${userId}`, event: "CANCELLED", ref: s.id, data: { note: "Do not send the deposit. Funds sent to the address after cancel are refunded by the provider after its deadline." } });
    return { ok: true, value: { ...s, state: "CANCELLED", updatedAt } };
  }
}
