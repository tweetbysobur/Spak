import type { AuditLog } from "../execution/audit";
import { ExecutionError } from "../execution/errors";
import type { ExecutionRecords } from "../execution/records";
import type { DepositRecords } from "../deposits/records";
import { toDepositView } from "../deposits/service";
import type { TrackingRecords } from "../tracking/records";
import { txExplorerUrl } from "../tracking/explorers";
import type { FailureRecords } from "./records";
import type { RefundVerifier } from "./refunds";
import { refundTxView, refundView } from "./service";

export interface Actor { reviewerId: string; credentialRef: string }

/** Outcomes a reviewer may record. None of them changes the execution state. */
export const REVIEW_RESOLUTIONS = ["NO_ACTION_NEEDED", "USER_CONTACTED", "REFERRED_TO_PROVIDER", "RESOLVED_BY_VERIFICATION"] as const;

/**
 * Manual reconciliation. Reviewers read evidence, add notes, attach transaction references for SPak to verify,
 * and close cases. They cannot set COMPLETED or REFUNDED: only the verifiers move an execution. History is append-only.
 */
export class ReviewService {
  constructor(private readonly d: { executions: ExecutionRecords; failures: FailureRecords; depositRecords: DepositRecords; tracking: TrackingRecords; refunds: RefundVerifier; audit?: AuditLog; clock?: () => Date }) {}
  private now() { return (this.d.clock ?? (() => new Date()))(); }

  /** Record a reviewer action (append-only), including refused ones. */
  private async audit(actor: Actor, action: string, f: { executionId?: string | null; reviewId?: string | null; reason?: string | null; evidence?: Record<string, unknown>; outcome: string }) {
    await this.d.failures.adminAudit({ ...actor, action, ...f });
  }
  private async run<T>(actor: Actor, action: string, ctx: { reviewId: string; reason?: string; evidence?: Record<string, unknown> }, fn: (executionId: string) => Promise<T>): Promise<T> {
    const review = await this.d.failures.review(ctx.reviewId);
    if (!review) { await this.audit(actor, action, { reviewId: ctx.reviewId, reason: ctx.reason, evidence: ctx.evidence, outcome: "REVIEW_NOT_FOUND" }); throw new ExecutionError("REVIEW_NOT_FOUND", "No such review."); }
    try {
      const out = await fn(review.executionId);
      await this.audit(actor, action, { executionId: review.executionId, reviewId: review.id, reason: ctx.reason, evidence: ctx.evidence, outcome: "OK" });
      return out;
    } catch (e) {
      await this.audit(actor, action, { executionId: review.executionId, reviewId: review.id, reason: ctx.reason, evidence: ctx.evidence, outcome: (e as ExecutionError).code ?? "ERROR" });
      throw e;
    }
  }

  async list(actor: Actor, status: string | null, limit = 50) {
    await this.audit(actor, "LIST_REVIEWS", { reason: status, outcome: "OK" });
    return (await this.d.failures.listReviews(status, limit)).map((r) => ({ id: r.id, executionId: r.executionId, status: r.status, reason: r.reason, openedAt: r.openedAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null }));
  }

  async get(actor: Actor, id: string) {
    return this.run(actor, "READ_REVIEW", { reviewId: id }, () => this.evidence(id));
  }

  /** Full evidence for one case: every reference SPak holds, every verification result, every event. */
  private async evidence(id: string) {
    const review = await this.d.failures.review(id);
    if (!review) throw new ExecutionError("REVIEW_NOT_FOUND", "No such review.");
    const ex = (await this.d.executions.get(review.executionId))!;
    const firm = ex.firmQuoteId ? await this.d.executions.getQuote(ex.firmQuoteId) : null;
    const [deps, dest, refund, refundTxs, events, failures, notes] = await Promise.all([
      this.d.depositRecords.forExecution(ex.id), this.d.tracking.destinationsFor(ex.id), this.d.failures.refund(ex.id), this.d.failures.refundTxsFor(ex.id),
      this.d.executions.events(ex.id), this.d.failures.failureEvents(ex.id), this.d.failures.notes(id),
    ]);
    return {
      review: { id: review.id, status: review.status, reason: review.reason, openedBy: review.openedBy, openedAt: review.openedAt.toISOString(), resolvedAt: review.resolvedAt?.toISOString() ?? null, resolution: review.resolution },
      execution: {
        id: ex.id, userId: ex.userId, state: ex.state, source: { network: ex.sourceNetwork, assetId: ex.sourceAssetId, amountIn: ex.amountIn },
        destination: { network: ex.destinationNetwork, assetId: ex.destinationAssetId, minAmountOut: firm?.minAmountOut ?? null, verifiedAmountOut: ex.amountOutVerified },
        recipient: ex.recipient, refundAddress: ex.refundAddress, failure: ex.failure, error: ex.error,
      },
      provider: {
        depositAddress: ex.depositAddress, depositMemo: ex.depositMemo, status: ex.providerStatus, updatedAt: ex.providerUpdatedAt?.toISOString() ?? null,
        correlationId: firm?.providerCorrelationId ?? null, quoteSignature: firm?.providerSignature ?? null,
        refundedAmount: ex.refundedAmount, refundReason: ex.refundReason, originTxHashes: ex.originTxHashes, destinationTxHashes: ex.destinationTxHashes,
      },
      deposits: deps.map((x) => toDepositView(x, [])),
      destinationVerifications: dest.map((v) => ({ txHash: v.txHash, network: v.network, outcome: v.outcome, receivedAmount: v.receivedAmount, problems: v.problems, observed: v.observed, explorerUrl: txExplorerUrl(v.network, v.txHash) })),
      refund: refund ? refundView(refund) : null,
      originalDeposit: deps.filter((x) => x.state === "CONFIRMED").map((x) => ({ txHash: x.txHash, amount: x.amount, sender: x.sender, explorerUrl: x.txHash ? txExplorerUrl(x.network, x.txHash) : null }))[0] ?? null,
      refundTransactions: refundTxs.map((t) => ({ ...refundTxView(t), observed: t.observed,
        comparison: { recipient: { expected: ex.refundAddress, check: (t.checks as { recipient?: string }).recipient ?? "PENDING" }, asset: { expected: ex.sourceAssetId, tokenContract: t.tokenContract, check: (t.checks as { asset?: string }).asset ?? "PENDING" },
          time: { depositAt: refund?.depositTxTimestamp?.toISOString() ?? null, txAt: t.txTimestamp?.toISOString() ?? null, check: (t.checks as { time?: string }).time ?? "PENDING" } } })),
      events: events.map((e) => ({ at: e.at.toISOString(), from: e.fromState, to: e.toState, reason: e.reason })),
      failureHistory: failures.map((e) => ({ at: e.at.toISOString(), category: e.category, code: e.code, detail: e.detail })),
      notes: notes.map((n) => ({ at: n.at.toISOString(), author: n.author, note: n.note, evidence: n.evidence })),
      audit: (await this.d.failures.adminAuditFor(id)).map((a) => ({ at: a.at.toISOString(), reviewer: a.reviewerId, action: a.action, outcome: a.outcome, reason: a.reason })),
    };
  }

  async note(actor: Actor, id: string, note: string, evidence: Record<string, unknown>) {
    await this.run(actor, "ADD_NOTE", { reviewId: id, reason: note, evidence }, async () => this.d.failures.addNote(id, actor.reviewerId, note, evidence));
    return this.evidence(id);
  }

  /** Ask SPak to run refund (and delivery) verification again. Reviewers trigger checks; they never decide them. */
  async requestVerification(actor: Actor, id: string, reason: string) {
    await this.run(actor, "REQUEST_VERIFICATION", { reviewId: id, reason }, async (executionId) => {
      const ex = (await this.d.executions.get(executionId))!;
      const v = await this.d.refunds.verify(ex);
      await this.d.failures.addNote(id, actor.reviewerId, `Requested verification: ${reason}`, { executionState: v.row.state, refundState: v.refund?.state ?? null, ok: v.ok });
    });
    return this.evidence(id);
  }

  /** Attach a refund transaction found during investigation. SPak verifies it; the reviewer cannot force the outcome. */
  /**
   * Attach a candidate refund transaction found during investigation. SPak checks it on chain; it stays a candidate
   * (PENDING_ASSOCIATION) unless NEAR Intents lists it for this execution. A reviewer cannot associate it by hand.
   */
  async attachRefundTx(actor: Actor, id: string, txHash: string, note: string) {
    await this.run(actor, "ATTACH_REFUND_CANDIDATE", { reviewId: id, reason: note, evidence: { txHash: txHash.slice(0, 120) } }, (executionId) => this.attach(actor, id, executionId, txHash, note));
    return this.evidence(id);
  }
  private async attach(actor: Actor, id: string, executionId: string, txHash: string, note: string) {
    const ex = (await this.d.executions.get(executionId))!;
    if (!(await this.d.refunds.ensure(ex))) await this.d.failures.openRefund({ executionId: ex.id, userId: ex.userId, state: "PENDING_PROVIDER", network: ex.sourceNetwork, assetId: ex.sourceAssetId, refundTo: ex.refundAddress, refundType: "ORIGIN_CHAIN", depositedAmount: null });
    const t = await this.d.refunds.register(ex, txHash, "ADMIN");
    const v = await this.d.refunds.verify(ex);
    const after = (await this.d.failures.refundTxsFor(ex.id)).find((x) => x.id === t.id);
    await this.d.failures.addNote(id, actor.reviewerId, note, { refundTxHash: t.txHash, chainOutcome: after?.outcome, association: after?.association, executionState: v.row.state });
    await this.d.failures.recovery({ executionId: ex.id, actor: `admin:${actor.reviewerId}`, action: "ATTACH_REFUND_CANDIDATE", outcome: v.row.state, detail: { txHash: t.txHash } });
  }

  /** Close an investigation with a documented reason. Never changes the execution or refund state. */
  async resolve(actor: Actor, id: string, resolution: string, note: string, evidence: Record<string, unknown>) {
    await this.run(actor, "RESOLVE_REVIEW", { reviewId: id, reason: `${resolution}: ${note}`, evidence }, async (executionId) => {
      if (!(REVIEW_RESOLUTIONS as readonly string[]).includes(resolution)) throw new ExecutionError("BAD_REQUEST", "Unknown resolution.");
      if (!note.trim() || !Object.keys(evidence).length) throw new ExecutionError("EVIDENCE_REQUIRED", "Closing a review needs a note and evidence.");
      if (resolution === "RESOLVED_BY_VERIFICATION") {
        const ex = (await this.d.executions.get(executionId))!;
        if (!["COMPLETED", "REFUNDED"].includes(ex.state)) throw new ExecutionError("INVALID_STATE", "SPak has not verified delivery or refund for this transfer. Reviewers cannot supply that proof.");
      }
      const r = await this.d.failures.resolveReview(id, resolution);
      if (!r) throw new ExecutionError("INVALID_STATE", "This review is already resolved.");
      await this.d.failures.addNote(id, actor.reviewerId, note, { ...evidence, resolution });
      await this.d.audit?.record({ at: this.now().toISOString(), actor: `reviewer:${actor.reviewerId}`, event: "REVIEW_RESOLVED", ref: executionId, data: { reviewId: id, resolution } });
    });
    return this.evidence(id);
  }
}
