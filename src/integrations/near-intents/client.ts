import { z } from "zod";

/**
 * NEAR Intents 1Click API client (OpenAPI 0.1.10, https://1click.chaindefuser.com/docs/v0/openapi.yaml).
 * Server-side only. Credentials come from environment variables and never reach a browser.
 * Every response is schema-checked; nothing from the provider is trusted unparsed.
 */
export interface OneClickConfig {
  baseUrl?: string;
  /** Partner API key, sent as X-API-Key (recommended by 1Click). */
  apiKey?: string;
  /** Legacy partner JWT, sent as Authorization: Bearer. */
  jwt?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type OneClickErrorKind = "BAD_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "RATE_LIMITED" | "UNAVAILABLE" | "TIMEOUT" | "INVALID_RESPONSE";

export class OneClickError extends Error {
  constructor(public readonly kind: OneClickErrorKind, message: string, public readonly httpStatus: number | null = null) {
    super(message);
    this.name = "OneClickError";
  }
}

const intStr = z.string().regex(/^\d+$/, "integer string");

export const tokenSchema = z.object({
  assetId: z.string().min(1),
  decimals: z.number().int().nonnegative(),
  blockchain: z.string().min(1),
  symbol: z.string(),
  contractAddress: z.string().optional(),
}).passthrough();
export type OneClickToken = z.infer<typeof tokenSchema>;

export const quoteRequestSchema = z.object({
  dry: z.boolean(),
  swapType: z.literal("EXACT_INPUT"),
  slippageTolerance: z.number().int().min(0).max(10_000),
  originAsset: z.string(),
  depositType: z.literal("ORIGIN_CHAIN"),
  destinationAsset: z.string(),
  amount: intStr,
  refundTo: z.string(),
  refundType: z.literal("ORIGIN_CHAIN"),
  recipient: z.string(),
  recipientType: z.literal("DESTINATION_CHAIN"),
  deadline: z.string(),
  depositMode: z.enum(["SIMPLE", "MEMO"]).optional(),
});
export type OneClickQuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteResponseSchema = z.object({
  correlationId: z.string().nullish(),
  timestamp: z.string(),
  signature: z.string(),
  quoteRequest: z.object({
    dry: z.boolean(), swapType: z.string(), slippageTolerance: z.number(), originAsset: z.string(), depositType: z.string(),
    destinationAsset: z.string(), amount: z.string(), refundTo: z.string(), refundType: z.string(), recipient: z.string(),
    recipientType: z.string(), deadline: z.string(),
    appFees: z.array(z.object({ recipient: z.string(), fee: z.number() })).nullish(),
  }).passthrough(),
  quote: z.object({
    depositAddress: z.string().nullish(),
    depositMemo: z.string().nullish(),
    amountIn: intStr,
    amountInFormatted: z.string(),
    amountInUsd: z.string().nullish(),
    minAmountIn: intStr.nullish(),
    amountOut: intStr,
    amountOutFormatted: z.string(),
    amountOutUsd: z.string().nullish(),
    minAmountOut: intStr,
    deadline: z.string().nullish(),
    timeWhenInactive: z.string().nullish(),
    timeEstimate: z.number().nullish(),
    refundFee: intStr.nullish(),
    withdrawFee: intStr.nullish(),
  }).passthrough(),
}).passthrough();
export type OneClickQuoteResponse = z.infer<typeof quoteResponseSchema>;

export const ONECLICK_STATUSES = ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;
const txs = z.array(z.object({ hash: z.string(), explorerUrl: z.string().nullish() })).default([]);
export const statusResponseSchema = z.object({
  correlationId: z.string().nullish(),
  status: z.string().nullish(), // missing status is kept as "no information", never as failure
  updatedAt: z.string().nullish(),
  quoteResponse: z.object({ signature: z.string().nullish(), quote: z.object({ depositAddress: z.string().nullish() }).passthrough().nullish() }).passthrough().nullish(),
  swapDetails: z.object({
    intentHashes: z.array(z.string()).default([]),
    nearTxHashes: z.array(z.string()).default([]),
    amountIn: z.string().nullish(),
    amountOut: z.string().nullish(),
    amountOutFormatted: z.string().nullish(),
    originChainTxHashes: txs,
    destinationChainTxHashes: txs,
    refundedAmount: z.string().nullish(),
    refundReason: z.string().nullish(),
    depositedAmount: z.string().nullish(),
  }).passthrough().nullish(),
}).passthrough();
export type OneClickStatusResponse = z.infer<typeof statusResponseSchema>;

export class OneClickClient {
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private readonly cfg: OneClickConfig = {}) {
    this.base = (cfg.baseUrl ?? "https://1click.chaindefuser.com").replace(/\/$/, "");
    this.f = cfg.fetchImpl ?? fetch;
  }

  /** True when a partner credential is configured (affects fees and rate limits, not correctness). */
  get authenticated(): boolean {
    return !!(this.cfg.apiKey || this.cfg.jwt);
  }

  private async call<S extends z.ZodTypeAny>(path: string, schema: S, init?: RequestInit): Promise<z.output<S>> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.cfg.apiKey) headers["x-api-key"] = this.cfg.apiKey;
    else if (this.cfg.jwt) headers.authorization = `Bearer ${this.cfg.jwt}`;
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, { ...init, headers, signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000) });
    } catch (e) {
      const name = (e as { name?: string }).name;
      throw new OneClickError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "UNAVAILABLE", "NEAR Intents did not respond. Try again.");
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof (body as { message?: unknown })?.message === "string" ? (body as { message: string }).message : `NEAR Intents returned ${res.status}`;
      const kind: OneClickErrorKind = res.status === 400 ? "BAD_REQUEST" : res.status === 401 || res.status === 403 ? "UNAUTHORIZED"
        : res.status === 404 ? "NOT_FOUND" : res.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE";
      throw new OneClickError(kind, msg.slice(0, 500), res.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new OneClickError("INVALID_RESPONSE", `Unexpected NEAR Intents response: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, res.status);
    return parsed.data;
  }

  tokens(): Promise<OneClickToken[]> {
    return this.call("/v0/tokens", z.array(tokenSchema));
  }

  quote(body: OneClickQuoteRequest): Promise<OneClickQuoteResponse> {
    return this.call("/v0/quote", quoteResponseSchema, { method: "POST", body: JSON.stringify(quoteRequestSchema.parse(body)) });
  }

  /**
   * Sizing only: how much of the origin asset delivers `amountOut` of the destination asset (a DRY EXACT_OUTPUT quote).
   * Used to size a payment request; the payment itself is a normal EXACT_INPUT quote, signature-checked and bound to
   * a minimum output, so nothing here is trusted for execution.
   */
  async estimateInput(body: Omit<OneClickQuoteRequest, "swapType" | "dry">): Promise<{ amountIn: string }> {
    const req = { ...quoteRequestSchema.omit({ swapType: true, dry: true }).parse(body), dry: true, swapType: "EXACT_OUTPUT" };
    const r = await this.call("/v0/quote", z.object({ quote: z.object({ amountIn: intStr }).passthrough() }).passthrough(), { method: "POST", body: JSON.stringify(req) });
    return { amountIn: r.quote.amountIn };
  }

  status(depositAddress: string, depositMemo?: string | null): Promise<OneClickStatusResponse> {
    const q = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
    return this.call(`/v0/status?${q}`, statusResponseSchema);
  }

  /** Tell 1Click about a deposit transaction to speed up detection. Used by the deposit UI (phase 3). */
  submitDeposit(args: { txHash: string; depositAddress: string; memo?: string; nearSenderAccount?: string }) {
    return this.call("/v0/deposit/submit", z.object({}).passthrough(), { method: "POST", body: JSON.stringify(args) });
  }
}

export function oneClickFromEnv(fetchImpl?: typeof fetch): OneClickClient {
  return new OneClickClient({
    baseUrl: process.env.ONECLICK_API_URL, apiKey: process.env.ONECLICK_API_KEY, jwt: process.env.ONECLICK_JWT, fetchImpl,
  });
}
