/**
 * ACTUAL NEAR INTENTS INTEGRATION (not mocked). LIVE=1 npm run test:live
 * Uses the real 1Click API with a real SPak-in plan. Indicative quotes always; a firm quote (real deposit
 * address, no funds sent) only with LIVE_FIRM=1. No funds are ever moved by this test.
 */
import { describe, expect, it } from "vitest";
import { oneClickFromEnv } from "@/integrations/near-intents/client";
import { harness } from "../execution/harness";

describe("SPak Execution against live NEAR Intents", () => {
  it("resolves assets, gets a validated indicative quote, and (optionally) a firm quote and status", async () => {
    const client = oneClickFromEnv();
    const h = await harness({ client });
    h.clock.now = Date.now();
    const u = await h.newUser();
    const r = await u.plan("Swap 50 USDC on Base to SOL on Solana");
    const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "live-key-01", wallets: await u.wallets() });
    console.log("LIVE indicative:", JSON.stringify({ state: x.execution.state, amountIn: x.quote!.amountIn, amountOut: x.quote!.amountOut, minAmountOut: x.quote!.minAmountOut, fees: x.quote!.fees, correlationId: x.quote!.providerCorrelationId, signed: !!x.quote!.providerSignature }));
    expect(x.quote).toMatchObject({ status: "VALID", kind: "INDICATIVE", amountIn: "50000000" });
    expect(BigInt(x.quote!.amountOut!)).toBeGreaterThan(0n);
    if (process.env.LIVE_FIRM !== "1") return;
    const a = await h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, approval: { planHash: x.execution.planHash, approvedAt: new Date().toISOString() }, wallets: await u.wallets() });
    console.log("LIVE firm:", JSON.stringify({ state: a.execution.state, depositAddress: a.execution.depositAddress, deadline: a.execution.depositDeadline, amountOut: a.quote!.amountOut }));
    expect(a.execution.state).toBe("AWAITING_DEPOSIT");
    h.clock.now = Date.now() + 5000;
    const s = await h.svc.refresh({ userId: u.userId, executionId: x.execution.id });
    console.log("LIVE status:", JSON.stringify({ state: s.state, providerStatus: s.providerStatus, lastStatusError: s.lastStatusError }));
    expect(s.state).toBe("AWAITING_DEPOSIT");
    const c = await h.svc.cancel({ userId: u.userId, executionId: x.execution.id });
    expect(c.state).toBe("CANCELLED");
  });
});
