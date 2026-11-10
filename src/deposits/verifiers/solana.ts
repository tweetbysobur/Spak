import type { ChainRpc } from "../rpc";
import type { DepositExpectation, VerificationResult } from "../types";

interface TokenBal { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }
interface ParsedTx {
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBal[]; postTokenBalances?: TokenBal[] } | null;
  transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[] } };
}

/**
 * Verify a Solana deposit from chain data: succeeded, fee payer is the user's verified wallet, and the deposit
 * owner's SOL (native) or token balance for the required mint (SPL) grew by exactly the required amount.
 * Confirmed only at "finalized" commitment.
 */
export async function verifySolanaDeposit(rpc: ChainRpc, e: DepositExpectation): Promise<VerificationResult> {
  const statuses = await rpc.call<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>(e.network, "getSignatureStatuses", [[e.txHash], { searchTransactionHistory: true }]);
  const st = statuses.value[0];
  if (!st) return { outcome: "NOT_FOUND", confirmations: null, problems: [], observed: {} };
  const tx = await rpc.call<ParsedTx | null>(e.network, "getTransaction", [e.txHash, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
  if (!tx?.meta) return { outcome: "PENDING", confirmations: null, problems: [], observed: { confirmationStatus: st.confirmationStatus } };
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const observed: Record<string, unknown> = { feePayer: keys[0], confirmationStatus: st.confirmationStatus };
  if (tx.meta.err || st.err) return { outcome: "FAILED", confirmations: null, problems: ["the transaction failed"], observed };

  const problems: string[] = [];
  if (keys[0] !== e.sender) problems.push(`paid by ${keys[0]}, not your verified wallet ${e.sender}`);
  if (e.kind === "NATIVE") {
    const i = keys.indexOf(e.depositAddress);
    const delta = i >= 0 ? BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]) : 0n;
    observed.received = delta.toString();
    if (i < 0) problems.push("the deposit address is not in the transaction");
    else if (delta !== BigInt(e.amount)) problems.push(`deposit address received ${delta} lamports, required ${e.amount}`);
  } else {
    const sum = (list: TokenBal[] | undefined) => (list ?? []).filter((b) => b.owner === e.depositAddress && b.mint === e.tokenContract).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const delta = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
    observed.received = delta.toString();
    if (delta !== BigInt(e.amount)) problems.push(`deposit address received ${delta} of ${e.tokenContract}, required ${e.amount}`);
  }
  if (problems.length) return { outcome: "MISMATCH", confirmations: null, problems, observed };
  return { outcome: st.confirmationStatus === "finalized" ? "CONFIRMED" : "PENDING", confirmations: null, problems: [], observed };
}
