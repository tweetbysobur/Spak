/** What SPak expects the recipient to receive on the destination chain, from the approved execution. */
export interface DeliveryExpectation {
  network: string;
  txHash: string;
  recipient: string;
  /** Exact asset: NATIVE coin, or the token contract / mint / NEP-141 account. Never a symbol. */
  kind: "NATIVE" | "TOKEN";
  tokenContract: string | null;
}

/**
 * What one destination transaction shows. received = amount the recipient got from this transaction
 * of the exact asset (smallest units). Verifiers never decide completion; the service aggregates.
 */
export interface DeliveryResult {
  outcome: "CONFIRMED" | "PENDING" | "NOT_FOUND" | "FAILED" | "NO_TRANSFER" | "UNVERIFIABLE";
  received: string;
  confirmations: number | null;
  problems: string[];
  observed: Record<string, unknown>;
}

export const DESTINATION_VERIFIABLE_FAMILIES = ["evm", "solana", "near"] as const;
