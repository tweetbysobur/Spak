/**
 * ACTUAL NEAR INTENTS INTEGRATION (not mocked). LIVE=1 npm run test:live
 * The mainnet canary route, USDC on Base to USDC on Arbitrum, through the real 1Click API, the published 1Click quote
 * key, and SPak's real independent prices (Chainlink on Ethereum mainnet). Indicative quotes always; a firm quote (a real
 * deposit address, no funds sent) only with LIVE_FIRM=1, cancelled straight after. No funds are ever moved by this test.
 * Database, Guard and users are local test fixtures.
 */
import { describe, expect, it } from "vitest";
import { oneClickFromEnv } from "@/integrations/near-intents/client";
import { ONECLICK_QUOTE_PUBLIC_KEY } from "@/integrations/near-intents/signature";
import { httpPriceReader, PriceService } from "@/pricing/oracle";
import { ExecutionError } from "@/execution/errors";
import { harness } from "../execution/harness";

const ROUTE = "Swap 5 USDC on Base to USDC on Arbitrum";
const live = () => harness({ client: oneClickFromEnv(), quotePublicKey: ONECLICK_QUOTE_PUBLIC_KEY, priceService: new PriceService(httpPriceReader()) });

describe("canary route against live NEAR Intents", () => {
  it("signed quote, exact token and network identities, independent valuation, Guard decision", async () => {
    const h = await live();
    h.clock.now = Date.now();
    const u = await h.newUser();
    const r = await u.plan(ROUTE);
    expect(r.plan).toBeTruthy();
    const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `live-${Date.now()}`, wallets: await u.wallets() });
    const q = (await h.records.getQuote(x.quote!.id))!;
    console.log("LIVE indicative:", JSON.stringify({ origin: x.execution.sourceAssetId, destination: x.execution.destinationAssetId, amountIn: q.amountIn, amountOut: q.amountOut, minAmountOut: q.minAmountOut, valuationUsd: q.valuationUsd, valuation: q.valuation, signed: !!q.providerSignature }));
    expect(q).toMatchObject({ status: "VALID", kind: "INDICATIVE", amountIn: "5000000" });
    expect(x.execution).toMatchObject({ sourceNetwork: "base", destinationNetwork: "arbitrum" });
    expect(q.providerSignature).toBeTruthy(); // verified against ONECLICK_QUOTE_PUBLIC_KEY or create() would have thrown
    expect(q.valuation).toMatchObject({ status: "OK", reading: { source: "CHAINLINK" } });
    expect(Number(q.valuationUsd)).toBeGreaterThanOrEqual(5);
    expect(Number(q.valuationUsd)).toBeLessThan(5.2);
    const out = BigInt(q.amountOut!), min = BigInt(q.minAmountOut!);
    expect(min <= out && out <= 5_000_000n).toBe(true); // USDC to USDC never delivers more than it took
    expect(out).toBeGreaterThan(4_800_000n); // fees under 4% on a 5 USDC canary

    // Guard on the same live quote: a per-transfer limit below SPak's value blocks; at or above it allows.
    const p = (await h.guard.view(u.userId)).policy;
    await h.guard.update(u.userId, { version: p.version, maxTransactionUsd: "4.99" });
    const r2 = await u.plan("Swap 5 USDC on Base to USDC on Arbitrum ");
    await expect(h.svc.create({ userId: u.userId, planHash: r2.plan!.hash, idempotencyKey: `live-b-${Date.now()}`, wallets: await u.wallets() })).rejects.toMatchObject({ code: "GUARD_BLOCKED" } satisfies Partial<ExecutionError>);

    if (process.env.LIVE_FIRM !== "1") return;
    const p2 = (await h.guard.view(u.userId)).policy;
    await h.guard.update(u.userId, { version: p2.version, maxTransactionUsd: "10" });
    const wallets = await u.wallets();
    const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
    const fq = (await h.records.getQuote(f.quote.id))!;
    console.log("LIVE firm:", JSON.stringify({ kind: fq.kind, depositAddress: fq.depositAddress, deadline: fq.providerDeadline, expiresAt: fq.expiresAt, amountOut: fq.amountOut, minAmountOut: fq.minAmountOut, valuationUsd: fq.valuationUsd }));
    expect(fq).toMatchObject({ kind: "FIRM", status: "VALID" });
    expect(fq.depositAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const c = await h.svc.cancel({ userId: u.userId, executionId: x.execution.id });
    expect(c.state).toBe("CANCELLED");
  }, 120_000);
});
