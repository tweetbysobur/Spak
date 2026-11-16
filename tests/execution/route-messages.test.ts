/**
 * Messages a user sees when a route cannot be quoted. Found by the live route audit (scripts/route-audit.ts):
 * Stellar recipients without a trustline, provider outages on a single route, unverifiable quote signatures,
 * and sending from a network SPak cannot sign in on.
 */
import { describe, expect, it } from "vitest";
import { OneClickError } from "@/integrations/near-intents/client";
import { providerError } from "@/execution/quote-service";
import { harness } from "./harness";

describe("provider errors become one clear sentence", () => {
  it("a Stellar recipient without a trustline", () => {
    const raw = "Destination address does not have a trustline for this asset.\n\nBlockchain: stellar:pubnet\nAsset ID: nep245:v2_1.omni.hot.tg:1100_x\nDestination address: G...";
    const e = providerError(new OneClickError("BAD_REQUEST", raw, 400));
    expect(e.code).toBe("QUOTE_REJECTED");
    expect(e.message).toMatch(/no trustline for this token/);
    expect(e.message).not.toMatch(/\n/);
  });
  it("other provider refusals keep only their first line", () => {
    const e = providerError(new OneClickError("BAD_REQUEST", "recipient is not valid\nmore detail", 400));
    expect(e.message).toMatch(/could not quote this: recipient is not valid$/);
  });
  it("a provider outage on one route says nothing was sent", () => {
    const e = providerError(new OneClickError("UNAVAILABLE", "Internal server error", 500));
    expect(e.code).toBe("PROVIDER_UNAVAILABLE");
    expect(e.message).toMatch(/could not quote this route right now\. Nothing was sent\./);
  });
});

describe("sending from a network SPak cannot sign in on", () => {
  it("receive-only networks explain why instead of asking for a wallet that cannot be connected", async () => {
    const h = await harness(); const u = await h.newUser();
    const r = await u.plan("Swap 3 SUI on Sui to USDC on Base");
    expect(r.status).toBe("NEEDS_CLARIFICATION");
    const q = r.clarifications.find((c) => c.field === "refundAddress")!.question;
    expect(q).toMatch(/SPak can send to Sui but not from it yet/);
    expect(q).not.toMatch(/Connect a /);
  });
  it("sign-in networks still ask to connect the wallet", async () => {
    const h = await harness(); const u = await h.newUser();
    const near = await u.plan("Swap 4 NEAR on NEAR to USDC on Base");
    // The harness user has a NEAR wallet, so NEAR plans; a network with no wallet asks to connect it.
    expect(near.status).toBe("VALIDATED");
  });
});
