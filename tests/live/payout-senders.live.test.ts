/**
 * LIVE (LIVE=1), read-only. Re-derives the trusted mainnet payout sender from today's chain:
 * recent NEAR withdrawals from intents.near to the PoA USDC tokens (api.nearblocks.io) are resolved by the official NEAR
 * Intents PoA bridge API (withdrawal_status), and each destination receipt is read from the chain through SPak's RPC
 * client. Fails if any payout came from a sender SPak does not trust, which means the trust list must be reviewed.
 */
import { describe, expect, it } from "vitest";
import { httpChainRpc } from "@/deposits/rpc";
import { trustedSendersFromEnv } from "@/tracking/route-trust";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ROUTES = [
  { network: "arbitrum", omft: "arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  { network: "base", omft: "base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
];

describe("live mainnet payout senders", () => {
  it.each(ROUTES)("$network USDC payouts come only from trusted senders", async ({ network, omft, token }) => {
    const list = (await (await fetch(`https://api.nearblocks.io/v1/account/${omft}/txns?per_page=25`)).json()) as { txns: { predecessor_account_id: string; transaction_hash: string; actions: { args?: string }[] }[] };
    const hashes = [...new Set(list.txns.filter((t) => t.predecessor_account_id === "intents.near" && /WITHDRAW_TO/.test(t.actions[0]?.args ?? "")).map((t) => t.transaction_hash))].slice(0, 5);
    expect(hashes.length).toBeGreaterThan(0);
    const trusted = new Set(trustedSendersFromEnv({}, "mainnet")(network));
    const rpc = httpChainRpc();
    let checked = 0;
    for (const h of hashes) {
      const s = (await (await fetch("https://bridge.chaindefuser.com/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "withdrawal_status", params: [{ withdrawal_hash: h }] }) })).json()) as { result?: { status: string; data?: { transfer_tx_hash?: string; withdraw_amount?: string } } };
      const tx = s.result?.data?.transfer_tx_hash;
      if (s.result?.status !== "COMPLETED" || !tx) continue;
      const rc = await rpc.call<{ status: string; logs: { address: string; topics: string[]; data: string }[] }>(network, "eth_getTransactionReceipt", [tx]);
      const log = rc.logs.find((l) => l.address.toLowerCase() === token && l.topics[0] === TRANSFER)!;
      const from = `0x${log.topics[1].slice(26)}`;
      console.log(network, h, tx, from, BigInt(log.data).toString());
      expect(rc.status).toBe("0x1");
      expect(trusted.has(from)).toBe(true);
      expect(BigInt(log.data)).toBe(BigInt(s.result.data!.withdraw_amount!));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});
