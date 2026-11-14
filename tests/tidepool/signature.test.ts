/** Quote signatures, against REAL Tidepool responses recorded from https://www.usetidepool.tech/v0/quote (fixtures). */
import { describe, expect, it } from "vitest";
import dry from "./fixtures/quote-dry.json";
import live from "./fixtures/quote-live.json";
import { ONECLICK_QUOTE_PUBLIC_KEY, TIDEPOOL_QUOTE_PUBLIC_KEY, stableStringify, verifyQuoteSignature } from "@/integrations/near-intents/signature";
import type { OneClickQuoteResponse } from "@/integrations/near-intents/client";

const r = (x: unknown) => structuredClone(x) as OneClickQuoteResponse;

describe("Tidepool quote signatures (same scheme as 1Click, Tidepool's maker key)", () => {
  it("real dry and live quotes verify against Tidepool's published key, and not against 1Click's", () => {
    expect(verifyQuoteSignature(r(dry), TIDEPOOL_QUOTE_PUBLIC_KEY)).toBe(true);
    expect(verifyQuoteSignature(r(live), TIDEPOOL_QUOTE_PUBLIC_KEY)).toBe(true);
    expect(verifyQuoteSignature(r(live), ONECLICK_QUOTE_PUBLIC_KEY)).toBe(false);
  });
  it.each([
    ["deposit address", (x: OneClickQuoteResponse) => { x.quote.depositAddress = "0x000000000000000000000000000000000000bEEF"; }],
    ["minimum output", (x: OneClickQuoteResponse) => { x.quote.minAmountOut = String(BigInt(x.quote.minAmountOut) - 1n); }],
    ["recipient", (x: OneClickQuoteResponse) => { x.quoteRequest.recipient = "0x000000000000000000000000000000000000bEEF"; }],
    ["amount", (x: OneClickQuoteResponse) => { x.quoteRequest.amount = "1"; }],
    ["timestamp", (x: OneClickQuoteResponse) => { x.timestamp = new Date(0).toISOString(); }],
    ["deadline", (x: OneClickQuoteResponse) => { x.quote.deadline = new Date(0).toISOString(); }],
    ["signature", (x: OneClickQuoteResponse) => { x.signature = "ed25519:" + "1".repeat(80); }],
    ["missing signature", (x: OneClickQuoteResponse) => { x.signature = ""; }],
  ])("any change to the live quote breaks it: %s", (_n, mutate) => {
    const x = r(live); mutate(x);
    expect(verifyQuoteSignature(x, TIDEPOOL_QUOTE_PUBLIC_KEY)).toBe(false);
  });
  it("stable stringify sorts keys at every level and drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [2, { z: 1, y: 0 }] } })).toBe('{"a":{"c":[2,{"y":0,"z":1}]},"b":1}');
  });
});
