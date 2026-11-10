import { describe, expect, it } from "vitest";
import { assertTransition, checkQuote, stateFromProvider } from "@/execution";
import type { OneClickQuoteRequest, OneClickQuoteResponse } from "@/integrations/near-intents/client";

const req: OneClickQuoteRequest = {
  dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "o", depositType: "ORIGIN_CHAIN", destinationAsset: "d",
  amount: "1000", refundTo: "0x1111111111111111111111111111111111111111", refundType: "ORIGIN_CHAIN",
  recipient: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", recipientType: "DESTINATION_CHAIN", deadline: "2026-11-10T11:00:00Z",
};
const res = (q: Partial<OneClickQuoteResponse["quote"]> = {}, echo: Partial<OneClickQuoteRequest> = {}): OneClickQuoteResponse => ({
  timestamp: "t", signature: "sig", quoteRequest: { ...req, ...echo },
  quote: { amountIn: "1000", amountInFormatted: "", amountOut: "500", amountOutFormatted: "", minAmountOut: "495", depositAddress: "0x2222222222222222222222222222222222222222", deadline: "2026-11-10T11:00:00Z", ...q },
} as OneClickQuoteResponse);
const ctx = { sourceNetwork: "base", now: new Date("2026-11-10T10:00:00Z") };

describe("quote validator", () => {
  it("accepts an exact match", () => expect(checkQuote(req, res(), ctx)).toEqual({ ok: true, problems: [] }));
  it.each([
    ["recipient swapped", res({}, { recipient: "x" })],
    ["refund swapped", res({}, { refundTo: "x" })],
    ["asset swapped", res({}, { destinationAsset: "other" })],
    ["amount changed", res({ amountIn: "999" })],
    ["slippage beyond tolerance", res({ minAmountOut: "400" })],
    ["min above expected", res({ minAmountOut: "600" })],
    ["zero output", res({ amountOut: "0", minAmountOut: "0" })],
    ["no deposit address", res({ depositAddress: undefined })],
    ["deposit address for another chain", res({ depositAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" })],
    ["deadline passed", res({ deadline: "2026-11-10T09:00:00Z" })],
  ])("rejects: %s", (_n, r) => expect(checkQuote(req, r, ctx).ok).toBe(false));
});

describe("state machine", () => {
  it("refuses impossible transitions", () => {
    expect(() => assertTransition("COMPLETED", "PROCESSING")).toThrow();
    expect(() => assertTransition("AWAITING_APPROVAL", "COMPLETED")).toThrow();
    expect(() => assertTransition("DRAFT", "AWAITING_APPROVAL")).not.toThrow();
  });
  it("never completes without destination proof", () => {
    const now = new Date();
    expect(stateFromProvider("PROCESSING", { status: "SUCCESS", destinationTxHashes: [], amountOut: "1" }, null, now).state).toBe("PROCESSING");
    expect(stateFromProvider("PROCESSING", { status: "SUCCESS", destinationTxHashes: ["h"], amountOut: null }, null, now).state).toBe("PROCESSING");
    expect(stateFromProvider("PROCESSING", { status: "SUCCESS", destinationTxHashes: ["h"], amountOut: "1" }, null, now).state).toBe("COMPLETED");
    expect(stateFromProvider("AWAITING_DEPOSIT", { status: "SOMETHING_NEW", destinationTxHashes: [], amountOut: null }, null, now).state).toBe("UNKNOWN");
  });
});
