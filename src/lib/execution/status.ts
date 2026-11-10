// SPak transaction states (PRD 6.4). Success is only shown after NEAR Intents reports SUCCESS.
export type TxState =
  | "draft" | "awaiting_approval" | "awaiting_deposit" | "processing"
  | "completed" | "failed" | "refunded" | "expired" | "unknown";

export type OneClickStatus =
  | "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT" | "PROCESSING"
  | "SUCCESS" | "REFUNDED" | "FAILED";

export function mapStatus(status: string | undefined, deadline?: string, now = Date.now()): TxState {
  switch (status) {
    case "SUCCESS": return "completed";
    case "REFUNDED": return "refunded";
    case "FAILED": return "failed";
    case "KNOWN_DEPOSIT_TX":
    case "PROCESSING":
    case "INCOMPLETE_DEPOSIT": return "processing";
    case "PENDING_DEPOSIT":
      return deadline && Date.parse(deadline) < now ? "expired" : "awaiting_deposit";
    default: return "unknown";
  }
}

export const STATE_LABEL: Record<TxState, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  awaiting_deposit: "Waiting for your deposit",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  refunded: "Refunded",
  expired: "Expired",
  unknown: "Unknown or delayed",
};

export const TERMINAL: TxState[] = ["completed", "failed", "refunded", "expired"];
