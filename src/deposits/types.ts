export const DEPOSIT_STATES = [
  "WALLET_CONFIRMATION_REQUESTED", // transaction prepared, waiting for the user's wallet
  "SUBMITTED", // wallet (or user) reported a transaction reference
  "VERIFICATION_PENDING", // reference recorded, chain has not confirmed it yet
  "CONFIRMED", // chain shows the exact transfer to the deposit address, with enough confirmations
  "REJECTED", // rejected in the wallet, or the transaction does not match the deposit requirements
  "FAILED", // the transaction failed on chain
  "EXPIRED", // deposit deadline passed without a confirmed deposit
] as const;
export type DepositState = (typeof DEPOSIT_STATES)[number];
export const DEPOSIT_TERMINAL: ReadonlySet<DepositState> = new Set(["CONFIRMED", "REJECTED", "FAILED", "EXPIRED"]);
/** States that block preparing another deposit for the same execution (no double funding). */
export const DEPOSIT_LIVE: ReadonlySet<DepositState> = new Set(["SUBMITTED", "VERIFICATION_PENDING", "CONFIRMED"]);

const NEXT: Record<DepositState, DepositState[]> = {
  WALLET_CONFIRMATION_REQUESTED: ["WALLET_CONFIRMATION_REQUESTED", "SUBMITTED", "REJECTED", "EXPIRED"],
  SUBMITTED: ["VERIFICATION_PENDING", "CONFIRMED", "REJECTED", "FAILED", "EXPIRED"],
  VERIFICATION_PENDING: ["VERIFICATION_PENDING", "CONFIRMED", "REJECTED", "FAILED", "EXPIRED"],
  CONFIRMED: [], REJECTED: [], FAILED: [], EXPIRED: [],
};
export function canMove(from: DepositState, to: DepositState): boolean {
  return NEXT[from].includes(to);
}

export type DepositKind = "NATIVE" | "ERC20" | "SPL" | "NEP141";

/** What the chain says about a submitted transaction, compared with what the deposit required. */
export interface VerificationResult {
  outcome: "CONFIRMED" | "PENDING" | "NOT_FOUND" | "FAILED" | "MISMATCH";
  confirmations: number | null;
  problems: string[];
  observed: Record<string, unknown>;
}

export interface DepositExpectation {
  network: string;
  kind: DepositKind;
  txHash: string;
  sender: string;
  depositAddress: string;
  amount: string; // smallest units
  tokenContract: string | null;
  chainId: number | null;
  decimals: number;
}

/** Minimum confirmations before an EVM deposit counts as confirmed. Solana uses "finalized"; NEAR uses FINAL. */
export const EVM_MIN_CONFIRMATIONS: Readonly<Record<string, number>> = {
  ethereum: 3, base: 3, arbitrum: 3, optimism: 3, polygon: 32, bsc: 5, avalanche: 3, gnosis: 5,
};
