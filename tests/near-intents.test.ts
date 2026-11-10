import { describe, expect, it } from "vitest";
import { mapOneClickStatus, toOneClickRequest } from "@/integrations/near-intents";
import { run, NOW } from "./helpers";

describe("NEAR Intents adapter (pure conversion, no network)", () => {
  it("maps a SPak plan leg to a 1Click quote request", async () => {
    const r = await run("Swap 50 USDC on Base to SOL on Solana with max 0.5% slippage");
    const req = toOneClickRequest(r.plan!.legs[0], r.plan!.constraints.slippageBps, true, new Date(NOW));
    expect(req).toMatchObject({
      dry: true, swapType: "EXACT_INPUT", slippageTolerance: 50, amount: "50000000",
      originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      destinationAsset: "nep141:sol.omft.near", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN",
      deadline: "2026-11-10T10:30:00.000Z",
    });
  });
  it("refuses inexact amounts", async () => {
    const r = await run("Move 25% of my USDC from Base to NEAR");
    expect(() => toOneClickRequest({ ...r.plan!.legs[0] }, 100, true, new Date(NOW))).toThrow(/exact amount/);
  });
  it("maps statuses conservatively", () => {
    expect(mapOneClickStatus("SUCCESS", null, new Date(NOW))).toBe("COMPLETED");
    expect(mapOneClickStatus("KNOWN_DEPOSIT_TX", null, new Date(NOW))).toBe("PROCESSING");
    expect(mapOneClickStatus("PENDING_DEPOSIT", "2026-11-10T09:00:00.000Z", new Date(NOW))).toBe("EXPIRED");
    expect(mapOneClickStatus("SOMETHING_NEW", null, new Date(NOW))).toBe("UNKNOWN");
  });
});
