/** ACTUAL CHAIN DATA (not mocked). LIVE=1. Reads block time and sender of real recent transactions (refund time checks). */
import { describe, expect, it } from "vitest";
import { httpChainRpc } from "@/deposits/rpc";
import { txChainFacts } from "@/failures/chain-facts";

const rpc = httpChainRpc();
describe("refund time and sender facts on real chains", () => {
  it("Base: block time is recent UTC and the sender matches the transaction", async () => {
    const head = await rpc.call<string>("base", "eth_blockNumber", []);
    const b = await rpc.call<{ transactions: { hash: string; from: string }[] }>("base", "eth_getBlockByNumber", [`0x${(parseInt(head, 16) - 5).toString(16)}`, true]);
    const t = b.transactions[0];
    const f = await txChainFacts(rpc, "evm", "base", t.hash);
    console.log("[live] Base facts", t.hash, f.timestamp?.toISOString(), f.sender);
    expect(f.sender).toBe(t.from.toLowerCase());
    expect(Math.abs(Date.now() - f.timestamp!.getTime())).toBeLessThan(15 * 60_000);
  }, 60_000);
  it("Solana: block time and fee payer of a real finalized transaction", async () => {
    const [s] = await rpc.call<{ signature: string; blockTime: number }[]>("solana", "getSignaturesForAddress", ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", { limit: 1, commitment: "finalized" }]);
    const f = await txChainFacts(rpc, "solana", "solana", s.signature);
    console.log("[live] Solana facts", s.signature, f.timestamp?.toISOString(), f.sender);
    expect(f.timestamp!.getTime()).toBe(s.blockTime * 1000);
    expect(f.sender).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }, 60_000);
});
