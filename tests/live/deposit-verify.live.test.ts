/**
 * ACTUAL CHAIN DATA (not mocked). LIVE=1 npm run test:live
 * Runs SPak's verifiers and builder against real mainnet RPC with real historical transactions picked from
 * recent blocks. Expectations are derived from each transaction, then perturbed to prove mismatches are caught.
 * No funds are moved; nothing is signed.
 */
import { describe, expect, it } from "vitest";
import { httpChainRpc } from "@/deposits/rpc";
import { verifyEvmDeposit, verifyNearDeposit, verifySolanaDeposit } from "@/deposits/verifiers";
import { buildDepositTransaction } from "@/deposits/builder";

const rpc = httpChainRpc();
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
type Tx = { hash: string; from: string; to: string | null; value: string; input: string };

describe("verifiers on real mainnet transactions", () => {
  it("Base: confirms a real native transfer and a real USDC transfer; rejects altered amounts", async () => {
    const head = parseInt(await rpc.call<string>("base", "eth_blockNumber", []), 16);
    let native: Tx | undefined, token: Tx | undefined;
    for (let b = head - 20; b > head - 60 && (!native || !token); b--) {
      const block = await rpc.call<{ transactions: Tx[] }>("base", "eth_getBlockByNumber", [`0x${b.toString(16)}`, true]);
      native ??= block.transactions.find((t) => t.input === "0x" && BigInt(t.value) > 0n && t.to);
      token ??= block.transactions.find((t) => t.to?.toLowerCase() === USDC_BASE && t.input.startsWith("0xa9059cbb"));
    }
    expect(native).toBeTruthy();
    const e = { network: "base", kind: "NATIVE" as const, txHash: native!.hash, sender: native!.from, depositAddress: native!.to!, amount: BigInt(native!.value).toString(), tokenContract: null, chainId: 8453, decimals: 18 };
    expect((await verifyEvmDeposit(rpc, e)).outcome).toBe("CONFIRMED");
    expect((await verifyEvmDeposit(rpc, { ...e, amount: (BigInt(e.amount) + 1n).toString() })).outcome).toBe("MISMATCH");
    if (token) {
      const to = `0x${token.input.slice(34, 74)}`, amount = BigInt(`0x${token.input.slice(74, 138)}`).toString();
      const te = { ...e, kind: "ERC20" as const, txHash: token.hash, sender: token.from, depositAddress: to, amount, tokenContract: USDC_BASE, decimals: 6 };
      const r = await verifyEvmDeposit(rpc, te);
      expect(["CONFIRMED", "FAILED"]).toContain(r.outcome); // a real call can revert
      if (r.outcome === "CONFIRMED") expect((await verifyEvmDeposit(rpc, { ...te, depositAddress: native!.from })).outcome).toBe("MISMATCH");
    }
    expect((await verifyEvmDeposit(rpc, { ...e, txHash: `0x${"0".repeat(63)}1` })).outcome).toBe("NOT_FOUND");
  }, 120_000);

  it("Solana: reads a real finalized transaction and catches a wrong expectation", async () => {
    const sigs = await rpc.call<{ signature: string; err: unknown }[]>("solana", "getSignaturesForAddress", ["Vote111111111111111111111111111111111111111", { limit: 5, commitment: "finalized" }]);
    const r = await verifySolanaDeposit(rpc, { network: "solana", kind: "NATIVE", txHash: sigs[0].signature, sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", depositAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", amount: "1", tokenContract: null, chainId: null, decimals: 9 });
    expect(["MISMATCH", "FAILED"]).toContain(r.outcome);
  }, 60_000);

  it("NEAR: unknown hash is NOT_FOUND", async () => {
    const r = await verifyNearDeposit(rpc, { network: "near", kind: "NATIVE", txHash: "8vRGpZJuRXGgCWXkzxLs4pcwHbkBDeqWzXAxDkzbbRVN", sender: "spak-test.near", depositAddress: "x.near", amount: "1", tokenContract: null, chainId: null, decimals: 24 });
    expect(r.outcome).toBe("NOT_FOUND");
  }, 60_000);

  it("builder: real Solana blockhash and USDC mint program", async () => {
    const t = await buildDepositTransaction(rpc, { network: "solana", assetId: "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", depositAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", depositMemo: null, amount: "1000000", sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
    expect(t).toMatchObject({ family: "solana", approvals: [] });
  }, 60_000);
});
