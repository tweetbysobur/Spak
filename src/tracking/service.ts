import type { DepositRecords } from "../deposits/records";
import { toDepositView } from "../deposits/service";
import { ExecutionError } from "../execution/errors";
import type { ExecutionRecords, ExecutionRow } from "../execution/records";
import type { ExecutionService } from "../execution/service";
import { isDestinationReference, NOT_DESTINATION_CHAIN, type DestinationVerifier } from "./destination";
import { getNetwork } from "../spak-in/registries/networks";
import { txExplorerUrl } from "./explorers";
import type { DestinationVerificationRow, TrackingRecords } from "./records";
import type { FailureService } from "../failures/service";

export const TRACKING_STEPS = [
  ["APPROVED", "Transaction approved"], ["DEPOSIT_SUBMITTED", "Deposit submitted"], ["DEPOSIT_CONFIRMED", "Deposit confirmed"],
  ["PROCESSING", "Cross-chain processing"], ["DESTINATION_DETECTED", "Destination transaction detected"],
  ["DESTINATION_VERIFICATION", "Destination verification"], ["COMPLETED", "Completed"],
] as const;
type StepId = (typeof TRACKING_STEPS)[number][0];

/** User-facing tracking: one owned execution, its deposits, destination verification and history. */
export class TrackingService {
  constructor(private readonly d: { executions: ExecutionRecords; execution: ExecutionService; tracking: TrackingRecords; depositRecords: DepositRecords; destination: DestinationVerifier; failures?: FailureService }) {}

  private async owned(userId: string, id: string) {
    const r = await this.d.executions.getForUser(id, userId);
    if (!r) throw new ExecutionError("EXECUTION_NOT_FOUND", "No such execution."); // also for another user's id
    return r;
  }

  async view(userId: string, id: string) {
    const row = await this.owned(userId, id);
    const [deps, dest, events] = await Promise.all([this.d.depositRecords.forExecution(row.id), this.d.tracking.destinationsFor(row.id), this.d.executions.events(row.id)]);
    const firm = row.firmQuoteId ? await this.d.executions.getQuote(row.firmQuoteId) : null;
    const base = toTrackingView(row, firm ? { amountOut: firm.amountOut, minAmountOut: firm.minAmountOut } : null, deps, dest, events);
    if (!this.d.failures) return { ...base, failure: null, refund: null, review: null };
    const [f, r] = await Promise.all([this.d.failures.failure(userId, id), this.d.failures.refund(userId, id)]);
    return { ...base, failure: f.classification, review: f.review, refund: { eligibility: r.eligibility, instructions: r.instructions, record: r.refund, transactions: r.transactions } };
  }

  async events(userId: string, id: string) {
    const row = await this.owned(userId, id);
    return (await this.d.executions.events(row.id)).map((e) => ({ at: e.at.toISOString(), from: e.fromState, to: e.toState, reason: e.reason }));
  }

  async destination(userId: string, id: string) {
    const row = await this.owned(userId, id);
    return (await this.d.tracking.destinationsFor(row.id)).map(destinationView);
  }

  /** Permitted user refresh: provider status (rate limited per execution) and destination verification. Resumes stopped monitoring. */
  async refresh(userId: string, id: string) {
    let row = await this.owned(userId, id);
    if (row.monitorGaveUpAt) await this.d.tracking.resume(row.id);
    row = (await this.d.execution.checkProvider(row)).row;
    // A-3: provider references that cannot be destination-chain transactions are classified in any state (audit kept).
    await this.d.destination.classifyReferences(row);
    if (row.state === "VERIFYING_DESTINATION") await this.d.destination.verify(row);
    if (this.d.failures && (row.state === "FAILED" || row.state === "REFUNDING")) await this.d.failures.verifyRefund(userId, id, true).catch(() => undefined);
    return this.view(userId, id);
  }
}

/**
 * A reference that cannot be a transaction on the destination chain is shown as what it is (a provider reference),
 * with no explorer link, whatever its stored outcome: the view never presents it as a pending destination transaction.
 */
function destinationView(v: DestinationVerificationRow) {
  const onChain = isDestinationReference(getNetwork(v.network)?.family, v.txHash);
  return {
    network: v.network, txHash: v.txHash, explorerUrl: onChain ? txExplorerUrl(v.network, v.txHash) : null, outcome: onChain ? v.outcome : NOT_DESTINATION_CHAIN, recipient: v.recipient,
    assetId: v.assetId, tokenContract: v.tokenContract, receivedAmount: v.receivedAmount, confirmations: v.confirmations, problems: v.problems,
    attempts: v.attempts, firstCheckedAt: v.firstCheckedAt.toISOString(), lastCheckedAt: v.lastCheckedAt.toISOString(), verifiedAt: v.verifiedAt?.toISOString() ?? null,
  };
}

export function toTrackingView(
  r: ExecutionRow, quote: { amountOut: string | null; minAmountOut: string | null } | null,
  deps: Awaited<ReturnType<DepositRecords["forExecution"]>>, dest: DestinationVerificationRow[],
  events: { at: Date; fromState: string | null; toState: string; reason: string }[],
) {
  const confirmedDep = deps.find((d) => d.state === "CONFIRMED");
  const submittedDep = deps.find((d) => d.txHash);
  const destHashes = (r.destinationTxHashes as string[]) ?? [];
  const originHashes = (r.originTxHashes as string[]) ?? [];
  const firstAt = (to: string) => events.find((e) => e.toState === to)?.at.toISOString() ?? null;
  const reached: Record<StepId, { done: boolean; at: string | null }> = {
    APPROVED: { done: !!r.approvedAt, at: r.approvedAt?.toISOString() ?? null },
    DEPOSIT_SUBMITTED: { done: !!submittedDep || originHashes.length > 0, at: submittedDep?.submittedAt?.toISOString() ?? null },
    DEPOSIT_CONFIRMED: { done: !!confirmedDep, at: confirmedDep?.verifiedAt?.toISOString() ?? null },
    PROCESSING: { done: ["PROCESSING", "VERIFYING_DESTINATION", "COMPLETED"].includes(r.state) || destHashes.length > 0, at: firstAt("PROCESSING") },
    DESTINATION_DETECTED: { done: destHashes.length > 0, at: dest[0]?.firstCheckedAt.toISOString() ?? firstAt("VERIFYING_DESTINATION") },
    DESTINATION_VERIFICATION: { done: r.state === "COMPLETED", at: firstAt("VERIFYING_DESTINATION") },
    COMPLETED: { done: r.state === "COMPLETED", at: r.destinationVerifiedAt?.toISOString() ?? null },
  };
  const firstOpen = TRACKING_STEPS.findIndex(([id]) => !reached[id].done);
  const halted = ["FAILED", "REFUNDED", "EXPIRED", "CANCELLED", "UNKNOWN"].includes(r.state);
  return {
    id: r.id, state: r.state, providerStatus: r.providerStatus,
    steps: TRACKING_STEPS.map(([id, label], i) => ({
      id, label, at: reached[id].at,
      status: reached[id].done ? "done" : i === firstOpen ? (halted ? "halted" : "current") : "pending",
    })),
    source: { network: r.sourceNetwork, assetId: r.sourceAssetId, amountIn: r.amountIn },
    destination: {
      network: r.destinationNetwork, assetId: r.destinationAssetId,
      expectedAmountOut: quote?.amountOut ?? null, minAmountOut: quote?.minAmountOut ?? null,
      providerReportedAmountOut: r.amountOutSettled, // what NEAR Intents says; not proof
      verifiedAmountOut: r.amountOutVerified, verifiedAt: r.destinationVerifiedAt?.toISOString() ?? null, // what SPak saw on chain
    },
    recipient: r.recipient, refundAddress: r.refundAddress, refundedAmount: r.refundedAmount,
    sourceTxs: [...new Set([...deps.filter((d) => d.txHash).map((d) => d.txHash!), ...originHashes])].map((h) => ({ hash: h, explorerUrl: txExplorerUrl(r.sourceNetwork, h) })),
    deposits: deps.map((d) => toDepositView(d, [])),
    destinationTxs: dest.length ? dest.map(destinationView) : destHashes.map((h) => {
      const onChain = isDestinationReference(getNetwork(r.destinationNetwork)?.family, h);
      return { network: r.destinationNetwork, txHash: h, explorerUrl: onChain ? txExplorerUrl(r.destinationNetwork, h) : null, outcome: onChain ? "NOT_CHECKED" : NOT_DESTINATION_CHAIN };
    }),
    needsReconciliation: (r.error as { code?: string } | null)?.code === "NEEDS_RECONCILIATION" || !!r.monitorGaveUpAt,
    note: r.lastStatusError,
    monitoring: { nextCheckAt: r.monitorNextAt?.toISOString() ?? null, consecutiveFailures: r.monitorFailures, stoppedAt: r.monitorGaveUpAt?.toISOString() ?? null },
    events: events.map((e) => ({ at: e.at.toISOString(), from: e.fromState, to: e.toState, reason: e.reason })),
    lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString(), createdAt: r.createdAt.toISOString(),
  };
}
export type TrackingView = Awaited<ReturnType<TrackingService["view"]>>;
