/**
 * MOCKED PROVIDER for deterministic tests. A fake fetch that behaves like the NEAR Intents 1Click API
 * (shapes from the official OpenAPI 0.1.10). It is not evidence that the real provider works;
 * see tests/live/execution.live.test.ts for that.
 */
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { quoteSigningMessage } from "@/integrations/near-intents/signature";
import type { OneClickQuoteResponse } from "@/integrations/near-intents/client";

/**
 * MOCKED provider signing key (TEST ONLY). The fake signs every quote with the same scheme 1Click and Tidepool use, so
 * SPak's signature check runs in every unit test. Never a real provider key.
 */
const TEST_QUOTE_SECRET = new Uint8Array(32).fill(7);
export const TEST_QUOTE_PUBLIC_KEY = `ed25519:${base58.encode(ed25519.getPublicKey(TEST_QUOTE_SECRET))}`;
export function signQuote(r: Omit<OneClickQuoteResponse, "signature">): string {
  return `ed25519:${base58.encode(ed25519.sign(new TextEncoder().encode(quoteSigningMessage({ ...r, signature: "" } as OneClickQuoteResponse)), TEST_QUOTE_SECRET))}`;
}
import mapData from "@/integrations/near-intents/data/asset-map.json";
import { SPAK_TO_ONECLICK } from "@/integrations/near-intents/networks";
import { listAssets } from "@/spak-in/registries/assets";

const MAP = (mapData as { map: Record<string, string> }).map;

export type FakeMode =
  | "ok" | "http400" | "http401" | "http429" | "http500" | "timeout" | "network" | "invalid-json-shape"
  | "echo-wrong-recipient" | "echo-wrong-asset" | "amount-in-differs" | "excess-slippage" | "no-deposit-address" | "bad-deposit-address" | "worse-firm" | "bad-signature";

export class Fake1Click {
  mode: FakeMode = "ok";
  /** depositAddress -> status payload (or "404"). */
  statuses = new Map<string, Record<string, unknown> | "404" | "500" | "429">();
  tokenOverrides: Record<string, Partial<{ decimals: number; blockchain: string; contractAddress: string }>> = {};
  delistedAssets = new Set<string>();
  calls: { path: string; body?: unknown }[] = [];
  /** Output per input unit, as a ratio numerator/denominator applied to amountIn (base-unit agnostic, deterministic). */
  rate = { num: 12n, den: 1n };
  firmRate: { num: bigint; den: bigint } | null = null;
  /** USD value the quote reports for the input amount. Null leaves it out. */
  /** Provider-reported USD for amountIn. A function lets the harness quote consistently with the test prices. */
  usdIn: string | null | ((body: { originAsset: string; amount: string }) => string | null) = "50.0";

  tokens() {
    return listAssets().filter((a) => MAP[a.id] && !this.delistedAssets.has(MAP[a.id])).map((a) => ({
      assetId: MAP[a.id], decimals: a.decimals, blockchain: SPAK_TO_ONECLICK[a.network], symbol: a.symbol,
      ...(a.contract ? { contractAddress: a.contract } : {}), price: 1, priceUpdatedAt: "2026-11-10T00:00:00Z",
      ...(this.tokenOverrides[MAP[a.id]] ?? {}),
    }));
  }

  private depositFor(originAsset: string): string {
    const chain = originAsset.startsWith("nep141:base-") || originAsset.includes("eth-") || originAsset.startsWith("nep141:arb-") ? "evm" : originAsset.startsWith("nep141:sol") ? "sol" : "evm";
    if (chain === "sol") return "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA" + randomBytes(1).toString("hex").replace(/[0lIO]/g, "9").slice(0, 2);
    return `0x${randomBytes(20).toString("hex")}`;
  }

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ path: u.pathname + u.search, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (this.mode === "network") throw new TypeError("fetch failed");
    if (this.mode === "timeout") { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }
    if (u.pathname === "/v0/tokens") return json(200, this.tokens());
    if (u.pathname === "/v0/status") {
      const s = this.statuses.get(u.searchParams.get("depositAddress") ?? "");
      if (!s || s === "404") return json(404, { message: "Deposit address not found", statusCode: 404 });
      if (s === "500") return json(500, { message: "internal" });
      if (s === "429") return json(429, { message: "Too many requests" });
      return json(200, s);
    }
    if (u.pathname !== "/v0/quote") return json(404, { message: "not found" });
    if (this.mode === "http400") return json(400, { message: "amount is too low for bridge, try at least 1000000" });
    if (this.mode === "http401") return json(401, { message: "Unauthorized" });
    if (this.mode === "http429") return json(429, { message: "Too many requests" });
    if (this.mode === "http500") return json(500, { message: "Internal server error" });
    if (this.mode === "invalid-json-shape") return json(201, { quote: { amountIn: "x" } });

    const rate = !body.dry && this.firmRate ? this.firmRate : this.rate;
    const amountOut = (BigInt(body.amount) * rate.num) / rate.den;
    const minAmountOut = this.mode === "excess-slippage" ? amountOut / 2n : (amountOut * BigInt(10_000 - body.slippageTolerance)) / 10_000n;
    const echo = { ...body, depositMode: body.depositMode ?? "SIMPLE", appFees: [{ recipient: "fee.near", fee: 20 }] };
    if (this.mode === "echo-wrong-recipient") echo.recipient = "0x9999999999999999999999999999999999999999";
    if (this.mode === "echo-wrong-asset") echo.destinationAsset = "nep141:eth.bridge.near";
    const quote: Record<string, unknown> = {
      amountIn: this.mode === "amount-in-differs" ? String(BigInt(body.amount) - 1n) : body.amount, amountInFormatted: "x", ...((u) => (u !== null ? { amountInUsd: u } : {}))(typeof this.usdIn === "function" ? this.usdIn(body) : this.usdIn),
      minAmountIn: body.amount, amountOut: amountOut.toString(), amountOutFormatted: "y", amountOutUsd: "49.9", minAmountOut: minAmountOut.toString(),
      timeEstimate: 32, refundFee: "2400", withdrawFee: "1000",
    };
    if (!body.dry) {
      if (this.mode !== "no-deposit-address") quote.depositAddress = this.mode === "bad-deposit-address" ? "not-an-address" : this.depositFor(body.originAsset);
      quote.deadline = body.deadline;
      quote.timeWhenInactive = body.deadline;
    }
    const res = { correlationId: randomBytes(8).toString("hex"), timestamp: new Date().toISOString(), quoteRequest: echo, quote };
    return json(201, { ...res, signature: this.mode === "bad-signature" ? signQuote({ ...res, quote: { ...quote, amountOut: "1" } }) : signQuote(res) });
  };
}

export function statusPayload(status: string, extra: Record<string, unknown> = {}, signature?: string) {
  return {
    correlationId: "c", status, updatedAt: new Date().toISOString(),
    ...(signature ? { quoteResponse: { signature, quote: {} } } : {}),
    swapDetails: { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [], ...extra },
  };
}
