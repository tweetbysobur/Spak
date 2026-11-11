import type { ChainRpc } from "../deposits/rpc";
import { NEAR_DESTINATION_SIGNERS } from "../tracking/verifiers/near";

export interface TxChainFacts { timestamp: Date | null; sender: string | null }

/**
 * Block time and sender of a transaction, read from the chain (UTC). Used as supplementary evidence only:
 * a time inside the window never proves which execution a transfer belongs to. Unknown values stay null.
 */
export async function txChainFacts(rpc: ChainRpc, family: string, network: string, txHash: string, signers: string[] = NEAR_DESTINATION_SIGNERS): Promise<TxChainFacts> {
  if (family === "evm") {
    const tx = await rpc.call<{ from: string; blockNumber: string | null } | null>(network, "eth_getTransactionByHash", [txHash]);
    if (!tx?.blockNumber) return { timestamp: null, sender: tx?.from?.toLowerCase() ?? null };
    const b = await rpc.call<{ timestamp: string } | null>(network, "eth_getBlockByNumber", [tx.blockNumber, false]);
    return { timestamp: b ? new Date(parseInt(b.timestamp, 16) * 1000) : null, sender: tx.from.toLowerCase() };
  }
  if (family === "solana") {
    const tx = await rpc.call<{ blockTime?: number | null; transaction: { message: { accountKeys: { pubkey: string }[] } } } | null>(network, "getTransaction", [txHash, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
    return { timestamp: tx?.blockTime ? new Date(tx.blockTime * 1000) : null, sender: tx?.transaction.message.accountKeys[0]?.pubkey ?? null };
  }
  if (family === "near") {
    for (const sender of signers) {
      try {
        const r = await rpc.call<{ transaction: { signer_id: string }; transaction_outcome: { block_hash: string } }>(network, "EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: sender, wait_until: "NONE" });
        const b = await rpc.call<{ header: { timestamp: string } }>(network, "block", { block_id: r.transaction_outcome.block_hash });
        return { timestamp: new Date(Number(BigInt(b.header.timestamp) / 1_000_000n)), sender: r.transaction.signer_id };
      } catch { /* try next signer */ }
    }
  }
  return { timestamp: null, sender: null };
}
