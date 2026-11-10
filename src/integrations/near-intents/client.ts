/** Minimal HTTP client for the NEAR Intents 1Click API. Server-side only: the JWT must never reach a browser. */
export interface OneClickConfig {
  baseUrl?: string;
  jwt?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
}

export interface OneClickQuoteResponse {
  quote: {
    depositAddress?: string; depositMemo?: string;
    amountIn: string; amountInFormatted: string; amountInUsd?: string;
    amountOut: string; amountOutFormatted: string; amountOutUsd?: string;
    minAmountOut: string; timeEstimate?: number; deadline?: string;
    withdrawFee?: string; refundFee?: string;
  };
  quoteRequest: { deadline: string; appFees?: { fee: number }[] };
}

export interface OneClickStatusResponse {
  status: string;
  updatedAt?: string;
  swapDetails?: {
    originChainTxHashes?: { hash: string }[];
    destinationChainTxHashes?: { hash: string }[];
    amountOut?: string;
  };
}

export class OneClickHttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export class OneClickClient {
  private readonly base: string;
  private readonly f: typeof fetch;
  constructor(private readonly cfg: OneClickConfig = {}) {
    this.base = cfg.baseUrl ?? "https://1click.chaindefuser.com";
    this.f = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 15_000);
    try {
      const res = await this.f(`${this.base}${path}`, {
        ...init,
        signal: ctl.signal,
        headers: { "content-type": "application/json", ...(this.cfg.jwt ? { authorization: `Bearer ${this.cfg.jwt}` } : {}) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new OneClickHttpError((body as { message?: string }).message ?? `NEAR Intents returned ${res.status}`, res.status);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  quote(body: OneClickQuoteRequest) { return this.call<OneClickQuoteResponse>("/v0/quote", { method: "POST", body: JSON.stringify(body) }); }
  status(depositAddress: string) { return this.call<OneClickStatusResponse>(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`); }
  tokens() { return this.call<{ assetId: string; symbol: string; blockchain: string; decimals: number }[]>("/v0/tokens"); }
}
