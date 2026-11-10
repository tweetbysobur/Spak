import type { ChainRpc } from "@/deposits/rpc";
import type { DeliveryExpectation, DeliveryResult } from "../types";

interface TokenBal { mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string } }
interface ParsedTx {
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBal[]; postTokenBalances?: TokenBal[] } | null;
  transaction: { message: { accountKeys: { pubkey: string }[] } };
}

/**
 * Solana delivery from balance changes, which cover the Token and Token-2022 programs, inner instructions and
 * newly created token accounts alike: the recipient's (owner's) balance of the exact mint, or its lamports for
 * native SOL, must grow. Wrapped SOL is a mint like any other and is not counted as native. Finalized only.
 */
export async function verifySolanaDelivery(rpc: ChainRpc, e: DeliveryExpectation): Promise<DeliveryResult> {
  const st = (await rpc.call<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>(e.network, "getSignatureStatuses", [[e.txHash], { searchTransactionHistory: true }])).value[0];
  if (!st) return { outcome: "NOT_FOUND", received: "0", confirmations: null, problems: [], observed: {} };
  const tx = await rpc.call<ParsedTx | null>(e.network, "getTransaction", [e.txHash, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
  if (!tx?.meta) return { outcome: "PENDING", received: "0", confirmations: null, problems: [], observed: { confirmationStatus: st.confirmationStatus } };
  const observed: Record<string, unknown> = { confirmationStatus: st.confirmationStatus };
  if (tx.meta.err || st.err) return { outcome: "FAILED", received: "0", confirmations: null, problems: ["the destination transaction failed"], observed };

  let received = 0n;
  const problems: string[] = [];
  if (e.kind === "NATIVE") {
    const i = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey === e.recipient);
    if (i >= 0) received = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
    if (received <= 0n) { received = 0n; problems.push("the recipient's SOL balance did not increase"); }
  } else {
    const sum = (l: TokenBal[] | undefined, mint: (m: string) => boolean) => (l ?? []).filter((b) => b.owner === e.recipient && mint(b.mint)).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    received = sum(tx.meta.postTokenBalances, (m) => m === e.tokenContract) - sum(tx.meta.preTokenBalances, (m) => m === e.tokenContract);
    const other = (tx.meta.postTokenBalances ?? []).filter((b) => b.owner === e.recipient && b.mint !== e.tokenContract).map((b) => b.mint);
    if (other.length) observed.otherMintsForRecipient = [...new Set(other)];
    if (received <= 0n) { received = 0n; problems.push(other.length ? `recipient's balance changed for a different mint, not ${e.tokenContract}` : `the recipient's ${e.tokenContract} balance did not increase`); }
  }
  observed.received = received.toString();
  if (received === 0n) return { outcome: "NO_TRANSFER", received: "0", confirmations: null, problems, observed };
  return { outcome: st.confirmationStatus === "finalized" ? "CONFIRMED" : "PENDING", received: received.toString(), confirmations: null, problems: [], observed };
}
