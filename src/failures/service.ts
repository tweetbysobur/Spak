import type { AuditLog } from "../execution/audit";
import { ExecutionError } from "../execution/errors";
import { newId } from "../execution/quote-service";
import type { ExecutionRecords, ExecutionRow } from "../execution/records";
import type { DepositRecords } from "../deposits/records";
import type { DestinationVerificationRow, TrackingRecords } from "../tracking/records";
import { txExplorerUrl } from "../tracking/explorers";
import { classify, type Classification } from "./classify";
import type { FailureRecords, RefundRow, RefundTxRow } from "./records";
import type { RefundVerifier } from "./refunds";

const USER_RECOVERY_LIMIT = { perHour: 10 };

/**
 * Failure and refund facade over the existing execution records. Classification, refund tracking and review
 * cases; never re-sends a deposit, never creates an execution, never sets COMPLETED or REFUNDED by hand.
 */
export class FailureService {
  constructor(private readonly d: {
    executions: ExecutionRecords; failures: FailureRecords; depositRecords: DepositRecords; tracking: TrackingRecords;
    refunds: RefundVerifier; audit?: AuditLog; clock?: () => Date;
  }) {}
  private now() { return (this.d.clock ?? (() => new Date()))(); }

  async classifyRow(row: ExecutionRow, lastErrorCode?: string | null): Promise<Classification> {
    const [deps, dest, refund, review, quote] = await Promise.all([
      this.d.depositRecords.forExecution(row.id), this.d.tracking.destinationsFor(row.id), this.d.failures.refund(row.id),
      this.d.failures.openReviewFor(row.id), row.currentQuoteId ? this.d.executions.getQuote(row.currentQuoteId) : null,
    ]);
    return classify({
      state: row.state, providerStatus: row.providerStatus, lastStatusError: row.lastStatusError, error: row.error as { code?: string; reason?: string } | null,
      refundReason: row.refundReason, quoteStatus: quote?.status ?? null,
      deposits: deps.map((x) => ({ state: x.state, reason: x.reason, txHash: x.txHash })),
      destinations: dest.map((x: DestinationVerificationRow) => ({ outcome: x.outcome, problems: x.problems })),
      refund: refund ? { state: refund.state, verifiedAmount: refund.verifiedAmount, associatedAmount: refund.associatedAmount, depositedAmount: refund.depositedAmount, providerRefundedAmount: refund.providerRefundedAmount } : null,
      reviewOpen: !!review, lastErrorCode,
    });
  }

  /** Classify and store (history logged only on change). Used by the monitor and user views. */
  async record(row: ExecutionRow) {
    const cls = await this.classifyRow(row);
    await this.d.failures.recordClassification(row.id, { ...cls });
    return cls;
  }

  /** Open (or keep) a manual review case. Idempotent: one open case per execution. */
  async flagForReview(executionId: string, reason: string, by: string) {
    const r = await this.d.failures.openReview({ id: newId("rev"), executionId, reason: reason.slice(0, 1000), openedBy: by });
    await this.d.audit?.record({ at: this.now().toISOString(), actor: by, event: "REVIEW_OPENED", ref: executionId, data: { reviewId: r.id, reason } });
    return r;
  }

  private async owned(userId: string, id: string) {
    const r = await this.d.executions.getForUser(id, userId);
    if (!r) throw new ExecutionError("EXECUTION_NOT_FOUND", "No such execution.");
    return r;
  }

  // ------------------------------------------------------------------ user-facing
  async failure(userId: string, id: string) {
    const row = await this.owned(userId, id);
    const cls = await this.record(row);
    const review = await this.d.failures.openReviewFor(row.id);
    const history = await this.d.failures.failureEvents(row.id);
    return {
      executionId: row.id, state: row.state, classification: cls, recoveryOptions: cls.actions,
      review: review ? { status: review.status, openedAt: review.openedAt.toISOString(), reason: review.reason } : null,
      history: history.map((e) => ({ at: e.at.toISOString(), category: e.category, code: e.code, temporary: !!e.temporary })),
    };
  }

  async refund(userId: string, id: string) {
    const row = await this.owned(userId, id);
    const refund = await this.d.refunds.ensure(row);
    const txs = await this.d.failures.refundTxsFor(row.id);
    const deps = await this.d.depositRecords.forExecution(row.id);
    return {
      executionId: row.id,
      eligibility: refundEligibility(row, refund, deps.some((x) => x.state === "CONFIRMED")),
      instructions: {
        initiation: "AUTOMATIC",
        text: "NEAR Intents returns funds automatically to your refund address on the source network. There is no refund request to sign. If you see the refund in your wallet before SPak does, you can submit its transaction hash.",
        refundTo: row.refundAddress, network: row.sourceNetwork, assetId: row.sourceAssetId, refundType: "ORIGIN_CHAIN",
      },
      refund: refund ? refundView(refund) : null,
      transactions: txs.map(refundTxView),
      original: { network: row.sourceNetwork, assetId: row.sourceAssetId, amountIn: row.amountIn, depositedAmount: refund?.depositedAmount ?? null },
    };
  }

  private async limit(row: ExecutionRow, userId: string) {
    const recent = await this.d.failures.recentRecoveries(row.id, new Date(this.now().getTime() - 3600_000));
    if (recent.filter((r) => r.actor === `user:${userId}`).length >= USER_RECOVERY_LIMIT.perHour) throw new ExecutionError("RATE_LIMITED", "Too many recovery actions for this transfer. Try again later.");
  }

  /** User submits a refund transaction hash they saw in their wallet. Verified like any other; never trusted alone. */
  async submitRefundTx(userId: string, id: string, txHash: string) {
    const row = await this.owned(userId, id);
    if (!["FAILED", "REFUNDING", "UNKNOWN"].includes(row.state)) throw new ExecutionError("INVALID_STATE", "This transfer is not waiting for a refund.");
    await this.limit(row, userId);
    try {
      if (!(await this.d.refunds.ensure(row))) await this.d.failures.openRefund({ executionId: row.id, userId, state: "PENDING_PROVIDER", network: row.sourceNetwork, assetId: row.sourceAssetId, refundTo: row.refundAddress, refundType: "ORIGIN_CHAIN", depositedAmount: null });
      const t = await this.d.refunds.register(row, txHash, "USER");
      await this.d.failures.recovery({ executionId: row.id, actor: `user:${userId}`, action: "SUBMIT_REFUND_TX", outcome: "ACCEPTED", detail: { txHash: t.txHash } });
    } catch (e) {
      await this.d.failures.recovery({ executionId: row.id, actor: `user:${userId}`, action: "SUBMIT_REFUND_TX", outcome: (e as ExecutionError).code ?? "ERROR", detail: { txHash: txHash.slice(0, 120) } });
      throw e;
    }
    return this.verifyRefund(userId, id, true);
  }

  async verifyRefund(userId: string, id: string, skipLimit = false) {
    const row = await this.owned(userId, id);
    if (!skipLimit) await this.limit(row, userId);
    const v = await this.d.refunds.verify(row);
    if (v.needsReview) await this.flagForReview(row.id, v.needsReview, "spak");
    if (!skipLimit) await this.d.failures.recovery({ executionId: row.id, actor: `user:${userId}`, action: "VERIFY_REFUND", outcome: v.ok ? "OK" : "RETRY", detail: {} });
    await this.record(v.row);
    return this.refund(userId, id);
  }

  async reviewStatus(userId: string, id: string) {
    const row = await this.owned(userId, id);
    const all = await this.d.failures.reviewsFor(row.id);
    return all.map((r) => ({ status: r.status, reason: r.reason, openedAt: r.openedAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null, resolution: r.resolution }));
  }
}

const ASSOCIATION_TEXT: Record<string, string> = {
  PROVIDER_LISTED: "NEAR Intents listed this transaction for this transfer's deposit address.",
  PENDING_ASSOCIATION: "Not linked to this transfer by NEAR Intents. A matching recipient, asset, amount or time does not prove it is this refund.",
  REJECTED: "Rejected: outside the time this refund could have happened.",
};
export function refundTxView(t: RefundTxRow) {
  return {
    txHash: t.txHash, source: t.source, submitted: t.source !== "PROVIDER", outcome: t.outcome,
    chainVerified: t.outcome === "CONFIRMED", association: t.association, associationExplanation: ASSOCIATION_TEXT[t.association] ?? t.association,
    checks: t.checks, receivedAmount: t.receivedAmount, confirmations: t.confirmations, sender: t.sender, txTimestamp: t.txTimestamp?.toISOString() ?? null,
    rejectedReason: t.rejectedReason, explorerUrl: txExplorerUrl(t.network, t.txHash), problems: t.problems, verifiedAt: t.verifiedAt?.toISOString() ?? null,
  };
}

export function refundView(r: RefundRow) {
  const partial = !!(r.associatedAmount && r.depositedAmount && BigInt(r.associatedAmount) < BigInt(r.depositedAmount));
  return {
    state: r.state, refundTo: r.refundTo, network: r.network, assetId: r.assetId,
    depositedAmount: r.depositedAmount, // original deposit SPak verified
    expectedAmount: r.providerRefundedAmount, // what NEAR Intents says it refunded; not proof
    verifiedAmount: r.verifiedAmount, // transfers to the refund address SPak saw on chain (any association)
    associatedAmount: r.associatedAmount, // verified AND linked to this execution; the only amount called returned
    outstandingAmount: r.outstandingAmount,
    depositTxTimestamp: r.depositTxTimestamp?.toISOString() ?? null,
    partial, reason: r.providerRefundReason, openedAt: r.openedAt.toISOString(), updatedAt: r.updatedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
  };
}

function refundEligibility(row: ExecutionRow, refund: RefundRow | null, depositConfirmed: boolean) {
  if (row.state === "REFUNDED") return { status: "REFUNDED", reason: "Refund verified on chain." };
  if (refund) return { status: "IN_PROGRESS", reason: "A refund is expected or in progress. NEAR Intents sends it automatically." };
  if (["COMPLETED"].includes(row.state)) return { status: "NOT_ELIGIBLE", reason: "The transfer completed and delivery was verified." };
  if (!depositConfirmed) return { status: "NOT_APPLICABLE", reason: "No confirmed deposit. Nothing to refund." };
  return { status: "NOT_YET", reason: "The deposit is confirmed and the transfer is still in progress. A refund applies only if the swap fails." };
}
