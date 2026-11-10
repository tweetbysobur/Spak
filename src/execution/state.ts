import { ExecutionError } from "./errors";

export const EXECUTION_STATES = [
  "DRAFT", "QUOTED", "AWAITING_APPROVAL", "AWAITING_DEPOSIT", "PROCESSING", "VERIFYING_DESTINATION",
  "REFUNDING", "COMPLETED", "FAILED", "EXPIRED", "REFUNDED", "UNKNOWN", "CANCELLED",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

/**
 * Final states: nothing changes after these. FAILED is not final: NEAR Intents may still refund a failed swap,
 * and a confirmed deposit is never written off, so FAILED stays monitored and can move to REFUNDING.
 */
export const TERMINAL: ReadonlySet<ExecutionState> = new Set(["COMPLETED", "EXPIRED", "REFUNDED", "CANCELLED"]);

/** Allowed transitions. Anything else is a bug and is refused. */
const NEXT: Record<ExecutionState, ExecutionState[]> = {
  DRAFT: ["QUOTED", "AWAITING_APPROVAL", "FAILED", "CANCELLED"],
  QUOTED: ["AWAITING_APPROVAL", "AWAITING_DEPOSIT", "QUOTED", "FAILED", "CANCELLED"],
  AWAITING_APPROVAL: ["AWAITING_APPROVAL", "AWAITING_DEPOSIT", "FAILED", "CANCELLED"],
  AWAITING_DEPOSIT: ["PROCESSING", "VERIFYING_DESTINATION", "FAILED", "REFUNDING", "EXPIRED", "UNKNOWN", "CANCELLED"],
  PROCESSING: ["PROCESSING", "VERIFYING_DESTINATION", "FAILED", "REFUNDING", "UNKNOWN"],
  // COMPLETED is reachable only from here: SPak's own destination-chain verification, never a provider claim alone.
  VERIFYING_DESTINATION: ["VERIFYING_DESTINATION", "COMPLETED", "REFUNDING", "UNKNOWN"],
  // REFUNDED is reachable only from here: SPak's own source-chain refund verification.
  REFUNDING: ["REFUNDING", "REFUNDED", "UNKNOWN"],
  FAILED: ["FAILED", "REFUNDING", "UNKNOWN"],
  UNKNOWN: ["AWAITING_DEPOSIT", "PROCESSING", "VERIFYING_DESTINATION", "FAILED", "REFUNDING", "EXPIRED", "UNKNOWN"],
  COMPLETED: [], EXPIRED: [], REFUNDED: [], CANCELLED: [],
};

export function assertTransition(from: ExecutionState, to: ExecutionState): void {
  if (from === to && !TERMINAL.has(from)) return;
  if (!NEXT[from].includes(to)) throw new ExecutionError("INVALID_STATE", `Cannot move an execution from ${from} to ${to}.`);
}

/** After this long with no successful status check while funds may be in flight, report UNKNOWN (delayed). */
export const DELAYED_AFTER_MS = 30 * 60_000;

export interface ProviderObservation {
  /** 1Click status, NOT_FOUND when the deposit address is unknown to the provider, or null when the response had none. */
  status: string | null;
  destinationTxHashes: string[];
  amountOut: string | null;
  /** SPak verified a source deposit on chain. Such an execution is never expired for "no deposit". */
  depositConfirmed?: boolean;
}

/**
 * Execution State Manager: map what the provider reports to a SPak state.
 * The provider never completes an execution. SUCCESS with destination transaction(s) moves it to
 * VERIFYING_DESTINATION; only SPak's destination-chain verifier assigns COMPLETED.
 */
export function stateFromProvider(current: ExecutionState, o: ProviderObservation, depositDeadline: Date | null, now: Date): { state: ExecutionState; reason: string } {
  if (current === "VERIFYING_DESTINATION" && o.status !== "REFUNDED") {
    return { state: current, reason: "Destination verification in progress." };
  }
  if (current === "REFUNDING") return { state: current, reason: "Refund verification in progress." };
  if (!o.status) return { state: current, reason: "Provider response had no status; nothing changed." };
  switch (o.status) {
    case "SUCCESS":
      if (o.destinationTxHashes.length) return { state: "VERIFYING_DESTINATION", reason: "Provider reported success with destination transaction(s). Verifying on the destination chain." };
      return { state: "PROCESSING", reason: "Provider reported success without a destination transaction yet." };
    // Provider says it refunded. Not proof: SPak verifies the refund on the source chain before REFUNDED.
    case "REFUNDED": return { state: "REFUNDING", reason: "NEAR Intents reports a refund. Verifying it on the source chain." };
    case "FAILED": return { state: "FAILED", reason: "NEAR Intents reported that the swap failed." };
    case "KNOWN_DEPOSIT_TX": case "PROCESSING": case "INCOMPLETE_DEPOSIT":
      return { state: "PROCESSING", reason: `Provider status ${o.status}.` };
    case "PENDING_DEPOSIT":
    case "NOT_FOUND":
      if (o.depositConfirmed) return { state: current === "AWAITING_DEPOSIT" || current === "UNKNOWN" ? "PROCESSING" : current, reason: "Deposit confirmed on the source chain; NEAR Intents has not picked it up yet." };
      if (current !== "PROCESSING" && depositDeadline && depositDeadline.getTime() < now.getTime()) return { state: "EXPIRED", reason: "No deposit before the deadline." };
      return { state: current === "UNKNOWN" ? "AWAITING_DEPOSIT" : current, reason: "Waiting for the deposit." };
    default:
      return { state: "UNKNOWN", reason: `Unrecognized provider status ${o.status}.` };
  }
}
