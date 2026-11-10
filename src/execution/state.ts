import { ExecutionError } from "./errors";

export const EXECUTION_STATES = [
  "DRAFT", "QUOTED", "AWAITING_APPROVAL", "AWAITING_DEPOSIT", "PROCESSING",
  "COMPLETED", "FAILED", "EXPIRED", "REFUNDED", "UNKNOWN", "CANCELLED",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const TERMINAL: ReadonlySet<ExecutionState> = new Set(["COMPLETED", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"]);

/** Allowed transitions. Anything else is a bug and is refused. */
const NEXT: Record<ExecutionState, ExecutionState[]> = {
  DRAFT: ["QUOTED", "AWAITING_APPROVAL", "FAILED", "CANCELLED"],
  QUOTED: ["AWAITING_APPROVAL", "AWAITING_DEPOSIT", "QUOTED", "FAILED", "CANCELLED"],
  AWAITING_APPROVAL: ["AWAITING_APPROVAL", "AWAITING_DEPOSIT", "FAILED", "CANCELLED"],
  AWAITING_DEPOSIT: ["PROCESSING", "COMPLETED", "FAILED", "REFUNDED", "EXPIRED", "UNKNOWN", "CANCELLED"],
  PROCESSING: ["PROCESSING", "COMPLETED", "FAILED", "REFUNDED", "UNKNOWN"],
  UNKNOWN: ["AWAITING_DEPOSIT", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED", "EXPIRED", "UNKNOWN"],
  COMPLETED: [], FAILED: [], EXPIRED: [], REFUNDED: [], CANCELLED: [],
};

export function assertTransition(from: ExecutionState, to: ExecutionState): void {
  if (from === to && !TERMINAL.has(from)) return;
  if (!NEXT[from].includes(to)) throw new ExecutionError("INVALID_STATE", `Cannot move an execution from ${from} to ${to}.`);
}

/** After this long with no successful status check while funds may be in flight, report UNKNOWN (delayed). */
export const DELAYED_AFTER_MS = 30 * 60_000;

export interface ProviderObservation {
  /** 1Click status, or NOT_FOUND when the deposit address is unknown to the provider. */
  status: string;
  destinationTxHashes: string[];
  amountOut: string | null;
}

/**
 * Execution State Manager: map what the provider reports to a SPak state.
 * COMPLETED requires SUCCESS *and* at least one destination-chain transaction and a settled amount.
 * A SUCCESS without destination proof stays PROCESSING.
 */
export function stateFromProvider(current: ExecutionState, o: ProviderObservation, depositDeadline: Date | null, now: Date): { state: ExecutionState; reason: string } {
  switch (o.status) {
    case "SUCCESS":
      if (o.destinationTxHashes.length && o.amountOut) return { state: "COMPLETED", reason: "Provider reported success with destination transaction(s)." };
      return { state: "PROCESSING", reason: "Provider reported success without destination proof yet." };
    case "REFUNDED": return { state: "REFUNDED", reason: "Provider refunded the deposit." };
    case "FAILED": return { state: "FAILED", reason: "Provider reported failure." };
    case "KNOWN_DEPOSIT_TX": case "PROCESSING": case "INCOMPLETE_DEPOSIT":
      return { state: "PROCESSING", reason: `Provider status ${o.status}.` };
    case "PENDING_DEPOSIT":
    case "NOT_FOUND":
      if (depositDeadline && depositDeadline.getTime() < now.getTime()) return { state: "EXPIRED", reason: "No deposit before the deadline." };
      return { state: current === "UNKNOWN" ? "AWAITING_DEPOSIT" : current, reason: "Waiting for the deposit." };
    default:
      return { state: "UNKNOWN", reason: `Unrecognized provider status ${o.status}.` };
  }
}
