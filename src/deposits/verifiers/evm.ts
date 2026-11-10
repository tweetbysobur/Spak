import type { ChainRpc } from "../rpc";
import { EVM_MIN_CONFIRMATIONS, type DepositExpectation, type VerificationResult } from "../types";

export const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const lc = (s: unknown) => String(s ?? "").toLowerCase();
const topicAddr = (t: string | undefined) => (t ? `0x${t.slice(-40)}`.toLowerCase() : "");

interface Tx { hash: string; from: string; to: string | null; value: string; chainId?: string; blockNumber: string | null; input: string }
interface Receipt { status: string; blockNumber: string; logs: { address: string; topics: string[]; data: string }[] }

/**
 * Verify an EVM deposit from chain data only: the transaction succeeded, was sent by the user's verified wallet,
 * and moved exactly the required amount of the required asset to the deposit address.
 */
export async function verifyEvmDeposit(rpc: ChainRpc, e: DepositExpectation): Promise<VerificationResult> {
  const tx = await rpc.call<Tx | null>(e.network, "eth_getTransactionByHash", [e.txHash]);
  if (!tx) return { outcome: "NOT_FOUND", confirmations: null, problems: [], observed: {} };
  const receipt = await rpc.call<Receipt | null>(e.network, "eth_getTransactionReceipt", [e.txHash]);
  if (!receipt || !tx.blockNumber) return { outcome: "PENDING", confirmations: 0, problems: [], observed: { from: tx.from, to: tx.to } };
  const observed: Record<string, unknown> = { from: lc(tx.from), to: lc(tx.to), value: BigInt(tx.value).toString(), block: parseInt(receipt.blockNumber, 16) };
  if (receipt.status !== "0x1") return { outcome: "FAILED", confirmations: null, problems: ["the transaction reverted"], observed };

  const problems: string[] = [];
  if (lc(tx.from) !== lc(e.sender)) problems.push(`sent from ${tx.from}, not your verified wallet ${e.sender}`);
  if (tx.chainId && e.chainId !== null && parseInt(tx.chainId, 16) !== e.chainId) problems.push(`chain id ${parseInt(tx.chainId, 16)}, expected ${e.chainId}`);
  if (e.kind === "NATIVE") {
    if (lc(tx.to) !== lc(e.depositAddress)) problems.push(`sent to ${tx.to}, not the deposit address`);
    if (BigInt(tx.value) !== BigInt(e.amount)) problems.push(`amount ${BigInt(tx.value)} differs from required ${e.amount}`);
  } else {
    if (lc(tx.to) !== lc(e.tokenContract)) problems.push(`called ${tx.to}, not the token contract ${e.tokenContract}`);
    if (BigInt(tx.value) !== 0n) problems.push("token transfer also sent native value");
    const moves = receipt.logs.filter((l) => lc(l.address) === lc(e.tokenContract) && lc(l.topics[0]) === ERC20_TRANSFER_TOPIC && topicAddr(l.topics[2]) === lc(e.depositAddress));
    const total = moves.reduce((s, l) => s + BigInt(l.data), 0n);
    observed.tokenTransferred = total.toString();
    if (!moves.length) problems.push("no transfer of the required token to the deposit address");
    else if (total !== BigInt(e.amount)) problems.push(`token amount ${total} differs from required ${e.amount}`);
    if (moves.some((l) => topicAddr(l.topics[1]) !== lc(e.sender))) problems.push("token moved from a different wallet");
  }
  if (problems.length) return { outcome: "MISMATCH", confirmations: null, problems, observed };

  const head = parseInt(await rpc.call<string>(e.network, "eth_blockNumber", []), 16);
  const confirmations = head - parseInt(receipt.blockNumber, 16) + 1;
  const need = EVM_MIN_CONFIRMATIONS[e.network] ?? 5;
  return { outcome: confirmations >= need ? "CONFIRMED" : "PENDING", confirmations, problems: [], observed: { ...observed, requiredConfirmations: need } };
}
