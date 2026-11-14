/**
 * S-3: official 1Click quote signatures. Fixtures are REAL responses from https://1click.chaindefuser.com/v0/quote
 * (mainnet), recorded 2026-11-14: a dry quote and a firm quote with a deposit address, 5 USDC Base to USDC Arbitrum,
 * recipient and refund the SPak disposable test wallet. Quotes only: nothing was deposited or signed.
 */
import { describe, expect, it } from "vitest";
import dry from "./fixtures/oneclick-quote-dry.json";
import live from "./fixtures/oneclick-quote-live.json";
import { ONECLICK_QUOTE_PUBLIC_KEY, TIDEPOOL_QUOTE_PUBLIC_KEY, verifyQuoteSignature } from "@/integrations/near-intents/signature";
import type { OneClickQuoteResponse } from "@/integrations/near-intents/client";
import { checkQuote } from "@/execution/quote-validator";

const r = (x: unknown) => structuredClone(x) as OneClickQuoteResponse;

describe("official 1Click quote signatures (real mainnet fixtures)", () => {
  it("real dry and firm quotes verify against 1Click's published key, never against Tidepool's", () => {
    expect(verifyQuoteSignature(r(dry), ONECLICK_QUOTE_PUBLIC_KEY)).toBe(true);
    expect(verifyQuoteSignature(r(live), ONECLICK_QUOTE_PUBLIC_KEY)).toBe(true);
    expect(verifyQuoteSignature(r(live), TIDEPOOL_QUOTE_PUBLIC_KEY)).toBe(false);
  });
  it.each([
    ["amount", (x: OneClickQuoteResponse) => { x.quoteRequest.amount = "5000001"; }],
    ["origin token", (x: OneClickQuoteResponse) => { x.quoteRequest.originAsset = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near"; }],
    ["destination network and token", (x: OneClickQuoteResponse) => { x.quoteRequest.destinationAsset = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"; }],
    ["deposit address", (x: OneClickQuoteResponse) => { x.quote.depositAddress = "0x000000000000000000000000000000000000bEEF"; }],
    ["minimum output", (x: OneClickQuoteResponse) => { x.quote.minAmountOut = "1"; }],
    ["recipient", (x: OneClickQuoteResponse) => { x.quoteRequest.recipient = "0x000000000000000000000000000000000000bEEF"; }],
    ["deadline", (x: OneClickQuoteResponse) => { x.quote.deadline = "2099-01-01T00:00:00.000Z"; }],
    ["malformed signature", (x: OneClickQuoteResponse) => { x.signature = "ed25519:not-base58-0OIl"; }],
    ["empty signature", (x: OneClickQuoteResponse) => { x.signature = ""; }],
    ["signature from the dry quote", (x: OneClickQuoteResponse) => { x.signature = (dry as { signature: string }).signature; }],
  ])("tampering is detected: %s", (_n, m) => {
    const x = r(live); m(x);
    expect(verifyQuoteSignature(x, ONECLICK_QUOTE_PUBLIC_KEY)).toBe(false);
  });
  it("an expired firm quote is refused by the validator even with a valid signature", () => {
    const x = r(live);
    const req = { ...x.quoteRequest, dry: false } as never;
    expect(checkQuote(req, x, { sourceNetwork: "base", now: new Date("2099-01-01T00:00:00Z") }).problems).toContain("deposit deadline already passed");
  });
});
