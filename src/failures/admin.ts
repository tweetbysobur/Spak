import type { AuditLog } from "../execution/audit";
import { ExecutionError } from "../execution/errors";
import type { ExecutionRecords } from "../execution/records";
import type { DepositRecords } from "../deposits/records";
import { toDepositView } from "../deposits/service";
import type { TrackingRecords } from "../tracking/records";
import { txExplorerUrl } from "../tracking/explorers";
import type { FailureRecords } from "./records";
import type { RefundVerifier } from "./refunds";
import { refundView } from "./service";

/** Outcomes a reviewer may record. None of them changes the execution state. */
export const REVIEW_RESOLUTIONS = ["NO_ACTION_NEEDED", "USER_CONTACTED", "REFERRED_TO_PROVIDER", "RESOLVED_BY_VERIFICATION"] as const;

/**
 * Manual reconciliation. Reviewers read evidence, add notes, attach transaction references for SPak to verify,
 * and close cases. They cannot set COMPLETED or REFUNDED: only the verifiers move an execution. History is append-only.
 */
export class ReviewService {
  constructor(private readonly d: { executions: ExecutionRecords; failures: FailureRecords; depositRecords: DepositRecords; tracking: TrackingRecords; refunds: RefundVerifier; audit?: AuditLog; clock?: () => Date }) {}
  private now() { return (this.d.clock ?? (() => new Date()))(); }

  async list(status: string | null, limit = 50) {
    return (await this.d.failures.listReviews(status, limit)).map((r) => ({ id: r.id, executionId: r.executionId, status: r.status, reason: r.reason, openedAt: r.openedAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null }));
  }

  /** Full evidence for one case: every reference SPak holds, every verification result, every event. */
  async get(id: string) {
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
      refundTransactions: refundTxs.map((t) => ({ txHash: t.txHash, source: t.source, outcome: t.outcome, receivedAmount: t.receivedAmount, problems: t.problems, observed: t.observed, explorerUrl: txExplorerUrl(t.network, t.txHash) })),
      events: events.map((e) => ({ at: e.at.toISOString(), from: e.fromState, to: e.toState, reason: e.reason })),
      failureHistory: failures.map((e) => ({ at: e.at.toISOString(), category: e.category, code: e.code, detail: e.detail })),
      notes: notes.map((n) => ({ at: n.at.toISOString(), author: n.author, note: n.note, evidence: n.evidence })),
    };
  }

  async note(id: string, author: string, note: string, evidence: Record<string, unknown>) {
    const review = await this.d.failures.review(id);
    if (!review) throw new ExecutionError("REVIEW_NOT_FOUND", "No such review.");
    await this.d.failures.addNote(id, author, note, evidence);
    await this.d.audit?.record({ at: this.now().toISOString(), actor: `admin:${author}`, event: "REVIEW_NOTE", ref: review.executionId, data: { reviewId: id } });
    return this.get(id);
  }

  /** Attach a refund transaction found during investigation. SPak verifies it; the reviewer cannot force the outcome. */
  async attachRefundTx(id: string, author: string, txHash: string, note: string) {
    const review = await this.d.failures.review(id);
    if (!review) throw new ExecutionError("REVIEW_NOT_FOUND", "No such review.");
    const ex = (await this.d.executions.get(review.executionId))!;
    if (!(await this.d.refunds.ensure(ex))) await this.d.failures.openRefund({ executionId: ex.id, userId: ex.userId, state: "PENDING_PROVIDER", network: ex.sourceNetwork, assetId: ex.sourceAssetId, refundTo: ex.refundAddress, refundType: "ORIGIN_CHAIN", depositedAmount: null });
    const t = await this.d.refunds.register(ex, txHash, "ADMIN");
    const v = await this.d.refunds.verify(ex);
    await this.d.failures.addNote(id, author, note, { refundTxHash: t.txHash, verificationOutcome: (await this.d.failures.refundTxsFor(ex.id)).find((x) => x.id === t.id)?.outcome, executionState: v.row.state });
    await this.d.failures.recovery({ executionId: ex.id, actor: `admin:${author}`, action: "ATTACH_REFUND_TX", outcome: v.row.state, detail: { txHash: t.txHash } });
    return this.get(id);
  }

  async resolve(id: string, author: string, resolution: string, note: string, evidence: Record<string, unknown>) {
    if (!(REVIEW_RESOLUTIONS as readonly string[]).includes(resolution)) throw new ExecutionError("BAD_REQUEST", "Unknown resolution.");
    if (!note.trim() || !Object.keys(evidence).length) throw new ExecutionError("EVIDENCE_REQUIRED", "Closing a review needs a note and evidence.");
    const review = await this.d.failures.review(id);
    if (!review) throw new ExecutionError("REVIEW_NOT_FOUND", "No such review.");
    if (resolution === "RESOLVED_BY_VERIFICATION") {
      const ex = (await this.d.executions.get(review.executionId))!;
      if (!["COMPLETED", "REFUNDED"].includes(ex.state)) throw new ExecutionError("INVALID_STATE", "SPak has not verified delivery or refund for this transfer. Attach the transaction for verification instead.");
    }
    await this.d.failures.addNote(id, author, note, { ...evidence, resolution });
    const r = await this.d.failures.resolveReview(id, resolution);
    if (!r) throw new ExecutionError("INVALID_STATE", "This review is already resolved.");
    await this.d.audit?.record({ at: this.now().toISOString(), actor: `admin:${author}`, event: "REVIEW_RESOLVED", ref: review.executionId, data: { reviewId: id, resolution } });
    return this.get(id);
  }
}
