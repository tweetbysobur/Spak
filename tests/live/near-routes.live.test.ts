/**
 * ACTUAL NEAR INTENTS INTEGRATION (not mocked), read-only. LIVE=1.
 * One route into NEAR and one out of NEAR through SPak-in, the real 1Click API, the published 1Click key and real prices.
 * Firm quotes create real deposit addresses; no funds are sent; each execution is cancelled.
 * For the NEAR source, the deposit address is checked on the token contract (NEP-145 storage), because an ft_transfer
 * to an unregistered account fails.
 */
import { describe, expect, it } from "vitest";
import { oneClickFromEnv } from "@/integrations/near-intents/client";
import { ONECLICK_QUOTE_PUBLIC_KEY } from "@/integrations/near-intents/signature";
import { httpPriceReader, PriceService } from "@/pricing/oracle";
import { buildDepositTransaction } from "@/deposits/builder";
import { httpChainRpc } from "@/deposits/rpc";
import { verifyNearDelivery } from "@/tracking/verifiers/near";
import { bind } from "@/tracking/destination";
import { trustedSendersFromEnv } from "@/tracking/route-trust";
import { harness } from "../execution/harness";

const USDC_NEAR = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

async function nearView(contract: string, method: string, args: object) {
  const res = await fetch("https://rpc.mainnet.near.org", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j = (await res.json()) as { result?: { result: number[] }; error?: unknown };
  if (!j.result) throw new Error(JSON.stringify(j.error));
  return JSON.parse(Buffer.from(j.result.result).toString());
}

describe.each([
  { text: "Bridge 5 USDC from Base to Arbitrum", source: "base", destination: "arbitrum" },
  { text: "Bridge 5 USDC from Base to NEAR", source: "base", destination: "near" },
  { text: "Bridge 5 USDC from NEAR to Base", source: "near", destination: "base" },
  { text: "Bridge 5 USDC from Arbitrum to NEAR", source: "arbitrum", destination: "near" },
  { text: "Bridge 5 USDC from NEAR to Arbitrum", source: "near", destination: "arbitrum" },
])("$text", ({ text, source, destination }) => {
  it("interprets, quotes (signed, valued), firm-quotes and the deposit address is usable", async () => {
    const h = await harness({ client: oneClickFromEnv(), quotePublicKey: ONECLICK_QUOTE_PUBLIC_KEY, priceService: new PriceService(httpPriceReader()) });
    h.clock.now = Date.now();
    const u = await h.newUser();
    const r = await u.plan(text);
    expect(r.plan, JSON.stringify(r).slice(0, 600)).toBeTruthy();
    const wallets = await u.wallets();
    const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `live-${source}-${Date.now()}`, wallets });
    expect(x.execution).toMatchObject({ sourceNetwork: source, destinationNetwork: destination });
    const q = (await h.records.getQuote(x.quote!.id))!;
    console.log(text, "indicative", JSON.stringify({ origin: x.execution.sourceAssetId, dest: x.execution.destinationAssetId, recipient: x.execution.recipient, refundTo: x.execution.refundAddress, amountIn: q.amountIn, amountOut: q.amountOut, min: q.minAmountOut, usd: q.valuationUsd, dev: (q.valuation as { deviationBps?: number })?.deviationBps }));
    expect(q).toMatchObject({ status: "VALID", amountIn: "5000000" });
    expect(q.valuation).toMatchObject({ status: "OK" });
    expect(BigInt(q.amountOut!)).toBeGreaterThan(4_800_000n);

    const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
    const fq = (await h.records.getQuote(f.quote.id))!;
    console.log(text, "firm", JSON.stringify({ depositAddress: fq.depositAddress, memo: fq.depositMemo, deadline: fq.providerDeadline, min: fq.minAmountOut }));
    expect(fq).toMatchObject({ kind: "FIRM", status: "VALID" });
    if (source === "near") {
      expect(fq.depositAddress).toBeTruthy();
      const storage = await nearView(USDC_NEAR, "storage_balance_of", { account_id: fq.depositAddress });
      console.log(text, "deposit address storage on USDC contract:", JSON.stringify(storage));
      // The real instructions SPak gives the user, built against mainnet NEAR.
      const t = await buildDepositTransaction(httpChainRpc(), { network: "near", assetId: `near:${USDC_NEAR}`, symbol: "USDC", decimals: 6, contract: USDC_NEAR, depositAddress: fq.depositAddress!, depositMemo: fq.depositMemo, amount: fq.amountIn, sender: x.execution.refundAddress });
      console.log(text, "instructions:", JSON.stringify(t.steps));
      if (t.family !== "near") throw new Error("near");
      expect(t.actions.map((a) => (a as { methodName: string }).methodName)).toEqual(storage === null ? ["storage_deposit", "ft_transfer"] : ["ft_transfer"]);
    } else {
      expect(fq.depositAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    expect((await h.svc.cancel({ userId: u.userId, executionId: x.execution.id })).state).toBe("CANCELLED");
  }, 120_000);
});

describe("real NEAR Intents USDC payout to a NEAR account", () => {
  // Found on 2026-11-14: a receipt from intents.near calling ft_transfer on USDC for x3lang.near (4,999,746 units).
  it("SPak's NEAR delivery verifier confirms it, and it binds only with intents.near trusted", async () => {
    const r = await verifyNearDelivery(httpChainRpc(), { network: "near", txHash: "CXoXgJ5FwcSZcyPDVu7PrNby7KULfY8bJxUBRT9fu4ia", recipient: "x3lang.near", kind: "TOKEN", tokenContract: USDC_NEAR } as never);
    console.log("NEAR payout", JSON.stringify({ outcome: r.outcome, received: r.received, transfers: r.transfers, blockTime: r.blockTime }));
    expect(r).toMatchObject({ outcome: "CONFIRMED", received: "4999746", transfers: [{ from: "intents.near", amount: "4999746" }] });
    const trusted = new Set(trustedSendersFromEnv({}, "mainnet")("near"));
    expect(bind(r, r.blockTime! - 60, trusted, "near", "NEAR")).toMatchObject({ outcome: "CONFIRMED", counted: 4_999_746n });
    expect(bind(r, r.blockTime! - 60, new Set(), "near", "NEAR")).toMatchObject({ outcome: "UNTRUSTED_SENDER" });
  }, 60_000);
});
