/**
 * ACTUAL PROVIDER AND CHAIN DATA (not mocked). LIVE=1 npm run test:live
 * Destination verifiers run against real, already-confirmed mainnet transactions picked from recent blocks; the
 * expected recipient and amount are read from each transaction, then altered to prove mismatches are caught.
 * The real 1Click status endpoint is queried for an unknown deposit address. No funds move; nothing is signed.
 */
import { describe, expect, it } from "vitest";
import { httpChainRpc } from "@/deposits/rpc";
import { verifyEvmDelivery, verifyNearDelivery, verifySolanaDelivery } from "@/tracking/verifiers";
import { oneClickFromEnv, OneClickError } from "@/integrations/near-intents/client";

const rpc = httpChainRpc();
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("destination verification on real chain data", () => {
  it("Base: a real USDC Transfer to its recipient verifies; another recipient or token does not", async () => {
    const head = parseInt(await rpc.call<string>("base", "eth_blockNumber", []), 16);
    let found: { hash: string; to: string; amount: bigint } | undefined;
    for (let b = head - 20; b > head - 80 && !found; b--) {
      const block = await rpc.call<{ transactions: { hash: string; to: string | null; input: string }[] }>("base", "eth_getBlockByNumber", [`0x${b.toString(16)}`, true]);
      // Skip zero-value transfers (common spam); the verifier correctly reports those as no delivery.
      const t = block.transactions.find((x) => x.to?.toLowerCase() === USDC_BASE && x.input.startsWith("0xa9059cbb") && BigInt(`0x${x.input.slice(74, 138) || "0"}`) > 0n);
      if (!t) continue;
      const rc = await rpc.call<{ status: string }>("base", "eth_getTransactionReceipt", [t.hash]);
      if (rc.status === "0x1") found = { hash: t.hash, to: `0x${t.input.slice(34, 74)}`, amount: BigInt(`0x${t.input.slice(74, 138)}`) };
    }
    expect(found, "no successful USDC transfer found in recent Base blocks").toBeTruthy();
    const e = { network: "base", txHash: found!.hash, recipient: found!.to, kind: "TOKEN" as const, tokenContract: USDC_BASE };
    const r = await verifyEvmDelivery(rpc, e);
    console.log("[live] Base USDC delivery", found!.hash, r.outcome, r.received);
    expect(r).toMatchObject({ outcome: "CONFIRMED" });
    expect(BigInt(r.received)).toBeGreaterThanOrEqual(found!.amount);
    expect((await verifyEvmDelivery(rpc, { ...e, recipient: "0x000000000000000000000000000000000000dEaD" })).outcome).toBe("NO_TRANSFER");
    expect((await verifyEvmDelivery(rpc, { ...e, tokenContract: "0x4200000000000000000000000000000000000006" })).outcome).toBe("NO_TRANSFER");
  }, 180_000);

  it("Solana: a real finalized USDC balance increase verifies for its owner; wrong owner or mint does not", async () => {
    type TB = { mint: string; owner?: string; uiTokenAmount: { amount: string } };
    const sum = (l: TB[] | undefined, owner: string) => (l ?? []).filter((x) => x.mint === USDC_SOL && x.owner === owner).reduce((a, x) => a + BigInt(x.uiTokenAmount.amount), 0n);
    const sigs = await rpc.call<{ signature: string; err: unknown }[]>("solana", "getSignaturesForAddress", [USDC_SOL, { limit: 25, commitment: "finalized" }]);
    let found: { sig: string; owner: string; delta: bigint } | undefined;
    for (const { signature, err } of sigs) {
      if (err || found) continue;
      const t = await rpc.call<{ meta: { err: unknown; preTokenBalances?: TB[]; postTokenBalances?: TB[] } | null } | null>("solana", "getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 1 }]);
      for (const owner of new Set((t?.meta?.postTokenBalances ?? []).filter((x) => x.mint === USDC_SOL && x.owner).map((x) => x.owner!))) {
        const d = sum(t!.meta!.postTokenBalances, owner) - sum(t!.meta!.preTokenBalances, owner);
        if (d > 0n) { found = { sig: signature, owner, delta: d }; break; }
      }
    }
    expect(found, "no USDC receipt found in recent Solana blocks").toBeTruthy();
    const e = { network: "solana", txHash: found!.sig, recipient: found!.owner, kind: "TOKEN" as const, tokenContract: USDC_SOL };
    const r = await verifySolanaDelivery(rpc, e);
    console.log("[live] Solana USDC delivery", found!.sig, r.outcome, r.received);
    expect(r).toMatchObject({ outcome: "CONFIRMED", received: found!.delta.toString() });
    expect((await verifySolanaDelivery(rpc, { ...e, recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" })).outcome).toBe("NO_TRANSFER");
    expect((await verifySolanaDelivery(rpc, { ...e, tokenContract: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" })).outcome).toBe("NO_TRANSFER");
  }, 180_000);

  it("NEAR: the receipts endpoint answers; an unknown hash is NOT_FOUND", async () => {
    const r = await verifyNearDelivery(rpc, { network: "near", txHash: "8vRGpZJuRXGgCWXkzxLs4pcwHbkBDeqWzXAxDkzbbRVN", recipient: "x.near", kind: "NATIVE", tokenContract: null });
    expect(r.outcome).toBe("NOT_FOUND");
  }, 60_000);
});

describe("real NEAR Intents status endpoint", () => {
  it("unknown deposit address: NOT_FOUND, which SPak treats as still waiting, not failure", async () => {
    const c = oneClickFromEnv();
    try {
      const s = await c.status("0x000000000000000000000000000000000000dEaD");
      console.log("[live] 1Click status for unused address:", s.status ?? "(no status)");
      expect(["PENDING_DEPOSIT", undefined, null]).toContain(s.status);
    } catch (e) {
      expect(e).toBeInstanceOf(OneClickError);
      console.log("[live] 1Click status error kind:", (e as OneClickError).kind);
      expect((e as OneClickError).kind).toBe("NOT_FOUND");
    }
  }, 60_000);
});
