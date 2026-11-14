import { PROVIDER_LABEL } from "@/environment";
/**
 * Tracking model: turns the server's own execution and tracking views into what the user sees. It only reads.
 * Rules it must never break (tested in tests/tracking/model.test.ts):
 * - "Completed" only when the server state is COMPLETED, which only destination verification can set.
 * - "Refunded" only when the server state is REFUNDED, which needs a verified, linked refund.
 * - UNKNOWN is never shown as a failure.
 */
import type { ExecutionView } from "@/lib/client";
import type { TrackingView } from "@/tracking/service";

export type Phase =
  | "AWAITING_APPROVAL" | "AWAITING_DEPOSIT" | "DEPOSIT_DETECTED" | "PROCESSING" | "VERIFYING" | "COMPLETED" | "FAILED"
  | "UNKNOWN" | "REFUND_PENDING" | "REFUND_REVIEW" | "REFUNDED" | "EXPIRED" | "CANCELLED";

/** Status role per phase, from the approved semantic colours. */
export const PHASE_ROLE: Record<Phase, string> = {
  AWAITING_APPROVAL: "pending", AWAITING_DEPOSIT: "pending", DEPOSIT_DETECTED: "processing", PROCESSING: "processing", VERIFYING: "processing",
  COMPLETED: "success", FAILED: "error", UNKNOWN: "warning", REFUND_PENDING: "processing", REFUND_REVIEW: "warning",
  REFUNDED: "refunded", EXPIRED: "neutral", CANCELLED: "neutral",
};

export const PHASE_TITLE: Record<Phase, string> = {
  AWAITING_APPROVAL: "Waiting for your approval", AWAITING_DEPOSIT: "Waiting for your deposit", DEPOSIT_DETECTED: "Deposit detected", PROCESSING: "NEAR Intents is processing",
  VERIFYING: "Verifying delivery", COMPLETED: "Delivered and verified", FAILED: "Transfer failed",
  UNKNOWN: "Outcome not confirmed yet", REFUND_PENDING: "Refund in progress", REFUND_REVIEW: "Refund under review",
  REFUNDED: "Refunded", EXPIRED: "Expired", CANCELLED: "Cancelled",
};

const REVIEW_REFUND = ["ASSOCIATION_PENDING", "FAILED", "DELAYED", "UNKNOWN"];
const PENDING_REFUND = ["PENDING_PROVIDER", "INITIATED", "TX_DETECTED", "VERIFICATION_PENDING", "PARTIAL"];

export function phaseOf(x: Pick<ExecutionView, "state">, t: TrackingView | null): Phase {
  const state = t?.state ?? x.state;
  const refundState = t?.refund?.record?.state ?? null;
  const reviewOpen = t?.review?.status === "OPEN";
  switch (state) {
    case "COMPLETED": return "COMPLETED";
    case "REFUNDED": return "REFUNDED";
    case "UNKNOWN": return "UNKNOWN";
    case "EXPIRED": return "EXPIRED";
    case "CANCELLED": return "CANCELLED";
    case "VERIFYING_DESTINATION": return "VERIFYING";
    case "PROCESSING": return "PROCESSING";
    // Not approved yet (opened from Activity): never shown as approved or waiting for a deposit.
    case "DRAFT": case "QUOTED": case "AWAITING_APPROVAL": return "AWAITING_APPROVAL";
    case "FAILED": case "REFUNDING":
      if (reviewOpen || (refundState && REVIEW_REFUND.includes(refundState))) return "REFUND_REVIEW";
      if (state === "REFUNDING" || (refundState && PENDING_REFUND.includes(refundState))) return "REFUND_PENDING";
      return "FAILED";
    default: {
      const submitted = t?.steps.find((s) => s.id === "DEPOSIT_SUBMITTED")?.status === "done";
      return submitted ? "DEPOSIT_DETECTED" : "AWAITING_DEPOSIT";
    }
  }
}

/** One plain sentence per phase. Never claims more than the server state supports. */
export function phaseSummary(phase: Phase, dest: string): string {
  switch (phase) {
    case "AWAITING_APPROVAL": return "Not approved yet. Nothing has moved: review and approve the firm quote to continue.";
    case "AWAITING_DEPOSIT": return "Approved. Nothing has moved yet: send the deposit from your wallet to start the transfer.";
    case "DEPOSIT_DETECTED": return "Your deposit transaction was submitted. SPak is confirming it on the source chain.";
    case "PROCESSING": return "NEAR Intents has your deposit and is executing the cross-chain transfer. Delivery is not confirmed yet.";
    case "VERIFYING": return `NEAR Intents reports a delivery. SPak is checking it on ${dest} before calling it complete.`;
    case "COMPLETED": return `SPak verified on ${dest} that the recipient received at least the amount you approved.`;
    case "FAILED": return "The transfer did not complete. See below for what happened and where your funds are.";
    case "UNKNOWN": return "SPak could not confirm the outcome yet. This is not a failure. Do not send the deposit again.";
    case "REFUND_PENDING": return "The transfer did not complete. NEAR Intents returns funds automatically; SPak is waiting to verify the refund on chain.";
    case "REFUND_REVIEW": return "A refund could not be verified automatically, so a person is reviewing it. It is not marked refunded until verified.";
    case "REFUNDED": return "The transfer did not complete. SPak verified on chain that the refund reached your refund address.";
    case "EXPIRED": return "The deposit deadline passed with no confirmed deposit. Nothing moved.";
    case "CANCELLED": return "You cancelled before sending a deposit. Nothing moved.";
  }
}

export type StageStatus = "done" | "current" | "halted" | "pending";
export interface Stage { id: string; title: string; detail: string; status: StageStatus; at: string | null; refs: { hash: string; url: string | null; label?: string }[] }

/**
 * The stages the user sees, in order. The last six come straight from the server's tracking steps; "Quote created"
 * comes from the execution's first quote. DESTINATION_VERIFICATION and COMPLETED are shown as one stage,
 * "Delivery verified", which is done only when COMPLETED is done.
 */
export function stagesOf(x: ExecutionView, t: TrackingView | null): Stage[] {
  const step = (id: string) => t?.steps.find((s) => s.id === id);
  const st = (id: string): StageStatus => (step(id)?.status as StageStatus) ?? "pending";
  const quoteAt = [...x.quotes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.createdAt ?? x.createdAt;
  const verifyStatus: StageStatus = st("COMPLETED") === "done" ? "done"
    : st("DESTINATION_VERIFICATION") === "current" || st("COMPLETED") === "current" ? "current"
    : st("DESTINATION_VERIFICATION") === "halted" || st("COMPLETED") === "halted" ? "halted" : "pending";
  return [
    { id: "QUOTE", title: "Quote created", detail: "NEAR Intents quoted the route, fees and minimum output.", status: "done", at: quoteAt, refs: [] },
    // Approval is known from the execution itself, so it shows before the tracking view has loaded.
    { id: "APPROVED", title: "You approved", detail: "You approved this exact firm quote.", status: step("APPROVED") ? st("APPROVED") : x.approvedAt ? "done" : "pending", at: step("APPROVED")?.at ?? x.approvedAt, refs: [] },
    { id: "DEPOSIT_SUBMITTED", title: "Deposit sent", detail: "Your wallet signed and sent the deposit.", status: st("DEPOSIT_SUBMITTED"), at: step("DEPOSIT_SUBMITTED")?.at ?? null,
      refs: (t?.sourceTxs ?? []).map((s) => ({ hash: s.hash, url: s.explorerUrl ?? null })) },
    { id: "DEPOSIT_CONFIRMED", title: "Deposit confirmed", detail: "SPak checked the deposit on the source chain.", status: st("DEPOSIT_CONFIRMED"), at: step("DEPOSIT_CONFIRMED")?.at ?? null, refs: [] },
    { id: "PROCESSING", title: `${PROVIDER_LABEL} processing`, detail: `${PROVIDER_LABEL} executes the cross-chain transfer.`, status: st("PROCESSING"), at: step("PROCESSING")?.at ?? null, refs: [] },
    { id: "DESTINATION_DETECTED", title: "Destination transaction detected", detail: `${PROVIDER_LABEL} reported a transaction on the destination network.`, status: st("DESTINATION_DETECTED"), at: step("DESTINATION_DETECTED")?.at ?? null,
      refs: (t?.destinationTxs ?? []).map((d) => ({ hash: d.txHash, url: d.explorerUrl ?? null, label: d.outcome })) },
    { id: "VERIFIED", title: "Delivery verified", detail: "SPak read the destination chain and confirmed the recipient received at least the approved minimum.", status: verifyStatus,
      at: step("COMPLETED")?.at ?? null, refs: [] },
  ];
}

/** Where the funds are, in words, from the server's failure classification. Null when the server does not say. */
export function fundsText(t: TrackingView | null): string | null {
  switch (t?.failure?.funds) {
    case "WALLET": return "Still in your wallet. No deposit reached NEAR Intents.";
    case "IN_TRANSIT": return "In transit with NEAR Intents. Failed transfers are refunded to your refund address.";
    case "DESTINATION": return "Delivered to the recipient.";
    case "REFUND_ADDRESS": return "Returned to your refund address (verified).";
    case "UNKNOWN": return "Not confirmed. A manual review decides where they are.";
    default: return null;
  }
}

/** Notification text for a state change, or null when the change is not worth a notification. */
export function notificationFor(from: string, to: string): string | null {
  if (from === to) return null;
  if (to === "PROCESSING") return "Deposit confirmed. NEAR Intents is executing your transfer.";
  if (to === "VERIFYING_DESTINATION") return "Delivery reported. SPak is verifying it on chain.";
  if (to === "COMPLETED") return "Delivery verified. Your transfer is complete.";
  if (to === "FAILED") return "A transfer failed. Open it to see where your funds are.";
  if (to === "REFUNDING") return "A refund has started. SPak will verify it on chain.";
  if (to === "REFUNDED") return "Refund verified on chain.";
  if (to === "UNKNOWN") return "A transfer needs attention: its outcome is not confirmed yet.";
  return null;
}
