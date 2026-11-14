/**
 * ACTUAL NEAR INTENTS INTEGRATION (not mocked), read-only. LIVE=1 ROUTE_MATRIX=1.
 * Every directed pair of the networks SPak can execute on (deposit builder and delivery verifier exist: EVM, NEAR,
 * Solana), through SPak-in, the real 1Click API (signature verified against the published key), SPak's independent
 * valuation and Guard. Indicative quotes only: no deposit address is created and no funds move.
 * Writes the observed matrix to $ROUTE_MATRIX_OUT (default /tmp/spak-route-matrix.json).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oneClickFromEnv } from "@/integrations/near-intents/client";
import { ONECLICK_QUOTE_PUBLIC_KEY } from "@/integrations/near-intents/signature";
import { httpPriceReader, PriceService } from "@/pricing/oracle";
import { trustedSendersFromEnv } from "@/tracking/route-trust";
import { harness } from "../execution/harness";

const NETS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "gnosis", "near", "solana"] as const;
const NAME: Record<string, string> = { ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", optimism: "Optimism", polygon: "Polygon", bsc: "BNB Smart Chain", avalanche: "Avalanche", gnosis: "Gnosis", near: "NEAR", solana: "Solana" };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Row = Record<string, unknown>;

async function attempt(h: Awaited<ReturnType<typeof harness>>, u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>, text: string): Promise<Row> {
  const r = await u.plan(text);
  if (!r.plan) return { stage: "SPAK_IN", outcome: "NOT_EXECUTABLE", detail: JSON.stringify(r).slice(0, 200) };
  try {
    const x = await h.svc.create({ userId: u.userId, planHash: r.plan.hash, idempotencyKey: `m-${Math.random()}`, wallets: await u.wallets() });
    const q = (await h.records.getQuote(x.quote!.id))!;
    await h.svc.cancel({ userId: u.userId, executionId: x.execution.id }).catch(() => {});
    return { stage: "QUOTE", outcome: "OK", source: x.execution.sourceAssetId, destination: x.execution.destinationAssetId, amountIn: q.amountIn, amountOut: q.amountOut, minAmountOut: q.minAmountOut, valuationUsd: q.valuationUsd, deviationBps: (q.valuation as { deviationBps?: number } | null)?.deviationBps ?? null, signed: !!q.providerSignature };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { stage: "QUOTE", outcome: err.code ?? "ERROR", detail: (err.message ?? "").slice(0, 200) };
  }
}

describe.runIf(process.env.ROUTE_MATRIX === "1")("live route matrix", () => {
  it("every directed pair at 25 USDC, and an amount sweep on three routes", async () => {
    const h = await harness({ client: oneClickFromEnv(), quotePublicKey: ONECLICK_QUOTE_PUBLIC_KEY, priceService: new PriceService(httpPriceReader()) });
    h.clock.now = Date.now();
    const u = await h.newUser();
    const trusted = trustedSendersFromEnv({}, "mainnet");
    const pairs: Row[] = [];
    for (const s of NETS) for (const d of NETS) {
      if (s === d) continue;
      h.clock.now = Date.now();
      const row = { source: s, destination: d, autoDelivery: trusted(d).length > 0, ...(await attempt(h, u, `Bridge 25 USDC from ${NAME[s]} to ${NAME[d]}`)) };
      console.log(JSON.stringify(row));
      pairs.push(row);
      await pause(400);
    }
    const sweep: Row[] = [];
    for (const [s, d] of [["base", "near"], ["near", "arbitrum"], ["ethereum", "solana"]] as const) {
      for (const amt of ["0.01", "1", "10", "250", "999", "1001", "50000"]) {
        h.clock.now = Date.now();
        const row = { source: s, destination: d, amount: amt, ...(await attempt(h, u, `Bridge ${amt} USDC from ${NAME[s]} to ${NAME[d]}`)) };
        console.log(JSON.stringify(row));
        sweep.push(row);
        await pause(400);
      }
    }
    writeFileSync(process.env.ROUTE_MATRIX_OUT ?? "/tmp/spak-route-matrix.json", JSON.stringify({ at: new Date().toISOString(), pairs, sweep }, null, 1));
    expect(pairs.length).toBe(90);
  }, 1_800_000);
});

describe.runIf(process.env.TOKEN_MATRIX === "1")("live token combinations", () => {
  it("native and non-stable tokens across chains", async () => {
    const h = await harness({ client: oneClickFromEnv(), quotePublicKey: ONECLICK_QUOTE_PUBLIC_KEY, priceService: new PriceService(httpPriceReader()) });
    const u = await h.newUser();
    const texts = [
      "Swap 0.01 ETH on Base to USDC on NEAR", "Swap 0.01 ETH on Arbitrum to ETH on Base", "Swap 0.01 ETH on Ethereum to SOL on Solana",
      "Swap 0.1 SOL on Solana to USDC on Arbitrum", "Swap 5 NEAR on NEAR to USDC on Base", "Swap 20 USDC on Base to NEAR on NEAR",
      "Swap 0.02 BNB on BNB Smart Chain to USDC on NEAR", "Swap 1 AVAX on Avalanche to USDC on Ethereum", "Swap 10 POL on Polygon to USDC on Base",
      "Swap 20 USDT on Ethereum to USDC on Solana", "Swap 0.01 ETH on Optimism to USDC on Gnosis", "Swap 20 USDC on Gnosis to xDAI on Gnosis",
    ];
    const rows: Row[] = [];
    for (const text of texts) { h.clock.now = Date.now(); const row = { text, ...(await attempt(h, u, text)) }; console.log(JSON.stringify(row)); rows.push(row); await pause(400); }
    writeFileSync(process.env.TOKEN_MATRIX_OUT ?? "/tmp/spak-token-matrix.json", JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
    expect(rows.length).toBe(texts.length);
  }, 600_000);
});
