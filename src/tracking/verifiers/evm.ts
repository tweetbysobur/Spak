import type { ChainRpc } from "@/deposits/rpc";
import { ERC20_TRANSFER_TOPIC } from "@/deposits/verifiers/evm";
import { EVM_MIN_CONFIRMATIONS } from "@/deposits/types";
import type { DeliveryExpectation, DeliveryResult } from "../types";

const lc = (s: unknown) => String(s ?? "").toLowerCase();
const topicAddr = (t: string | undefined) => (t ? `0x${t.slice(-40)}`.toLowerCase() : "");
interface Tx { from: string; to: string | null; value: string; blockNumber: string | null; chainId?: string }
interface Receipt { status: string; blockNumber: string; logs: { address: string; topics: string[]; data: string }[] }

/**
 * EVM delivery: receipt succeeded; ERC-20 Transfer logs from the exact token contract to the recipient
 * (any number, any emitter path: router, multicall, bridge contract); or a direct native transfer to the
 * recipient. Native value moved by an internal call is not visible without tracing: UNVERIFIABLE, never assumed.
 */
export async function verifyEvmDelivery(rpc: ChainRpc, e: DeliveryExpectation): Promise<DeliveryResult> {
  const tx = await rpc.call<Tx | null>(e.network, "eth_getTransactionByHash", [e.txHash]);
  if (!tx) return { outcome: "NOT_FOUND", received: "0", confirmations: null, problems: [], observed: {} };
  const receipt = await rpc.call<Receipt | null>(e.network, "eth_getTransactionReceipt", [e.txHash]);
  if (!receipt || !tx.blockNumber) return { outcome: "PENDING", received: "0", confirmations: 0, problems: [], observed: { to: tx.to } };
  const observed: Record<string, unknown> = { from: lc(tx.from), to: lc(tx.to), block: parseInt(receipt.blockNumber, 16) };
  if (receipt.status !== "0x1") return { outcome: "FAILED", received: "0", confirmations: null, problems: ["the destination transaction reverted"], observed };
  if (e.chainId && tx.chainId && parseInt(tx.chainId, 16) !== e.chainId) {
    return { outcome: "FAILED", received: "0", confirmations: null, problems: [`the transaction is for chain ${parseInt(tx.chainId, 16)}, not ${e.chainId}`], observed };
  }

  let received = 0n;
  const problems: string[] = [];
  const delivered: { from: string; amount: string }[] = [];
  if (e.kind === "TOKEN") {
    const transfers = receipt.logs.filter((l) => lc(l.topics[0]) === ERC20_TRANSFER_TOPIC && l.topics.length === 3 && topicAddr(l.topics[2]) === lc(e.recipient));
    const right = transfers.filter((l) => lc(l.address) === lc(e.tokenContract));
    received = right.reduce((s, l) => s + BigInt(l.data), 0n);
    delivered.push(...right.map((l) => ({ from: topicAddr(l.topics[1]), amount: BigInt(l.data).toString() })));
    const wrong = transfers.filter((l) => lc(l.address) !== lc(e.tokenContract)).map((l) => lc(l.address));
    if (wrong.length) observed.otherTokensToRecipient = [...new Set(wrong)];
    if (!right.length) problems.push(wrong.length ? `recipient received a different token (${[...new Set(wrong)].join(", ")}), not ${e.tokenContract}` : "no transfer of the expected token to the recipient");
  } else {
    if (lc(tx.to) === lc(e.recipient)) { received = BigInt(tx.value); delivered.push({ from: lc(tx.from), amount: received.toString() }); }
    else {
      observed.received = "0";
      return { outcome: "UNVERIFIABLE", received: "0", confirmations: null, problems: ["native coin was not sent directly to the recipient; an internal transfer cannot be verified without a trace"], observed };
    }
  }
  observed.received = received.toString();
  if (received === 0n) return { outcome: "NO_TRANSFER", received: "0", confirmations: null, problems, observed };

  const head = parseInt(await rpc.call<string>(e.network, "eth_blockNumber", []), 16);
  const confirmations = head - parseInt(receipt.blockNumber, 16) + 1;
  const need = EVM_MIN_CONFIRMATIONS[e.network] ?? 5;
  const block = await rpc.call<{ timestamp: string } | null>(e.network, "eth_getBlockByNumber", [receipt.blockNumber, false]);
  const blockTime = block?.timestamp ? parseInt(block.timestamp, 16) : null;
  return { outcome: confirmations >= need ? "CONFIRMED" : "PENDING", received: received.toString(), confirmations, problems: [], observed: { ...observed, requiredConfirmations: need, txFrom: lc(tx.from) }, transfers: delivered, blockTime };
}
