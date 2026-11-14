/** What SPak expects the recipient to receive on the destination chain, from the approved execution. */
export interface DeliveryExpectation {
  network: string;
  txHash: string;
  recipient: string;
  /** Exact asset: NATIVE coin, or the token contract / mint / NEP-141 account. Never a symbol. */
  kind: "NATIVE" | "TOKEN";
  tokenContract: string | null;
  /** EVM only: the destination chain id from SPak's registry. A transaction from another chain is rejected. */
  chainId?: number | null;
}

/** One counted movement of the exact asset to the recipient, with the on-chain sender that delivered it. */
export interface DeliveredTransfer { from: string; amount: string }

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
  /** Every counted transfer and its sender. The service decides which senders are trusted for the route. */
  transfers?: DeliveredTransfer[];
  /** Block time of the destination transaction (unix seconds). Null when the chain did not establish it. */
  blockTime?: number | null;
}

export const DESTINATION_VERIFIABLE_FAMILIES = ["evm", "solana", "near"] as const;
