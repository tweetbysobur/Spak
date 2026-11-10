// NEAR Intents 1Click API client. Server-side only: the optional JWT never reaches the browser.
import "server-only";
import { toBaseUnits, fromBaseUnits } from "./units";
import { mapStatus, type TxState } from "./status";

const BASE = process.env.ONECLICK_API_URL ?? "https://1click.chaindefuser.com";
const JWT = process.env.ONECLICK_JWT;

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  contractAddress?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(JWT ? { authorization: `Bearer ${JWT}` } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { message?: string }).message ?? `NEAR Intents returned ${res.status}`;
    throw new ExecutionError(msg, res.status);
  }
  return body as T;
}

export class ExecutionError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

let tokenCache: { at: number; tokens: OneClickToken[] } | undefined;
export async function getTokens(): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < 60_000) return tokenCache.tokens;
  const tokens = await call<OneClickToken[]>("/v0/tokens");
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

export async function findToken(symbol: string, network: string): Promise<OneClickToken> {
  const tokens = await getTokens();
  const matches = tokens.filter((t) => t.blockchain === network && t.symbol.toUpperCase() === symbol.toUpperCase());
  if (matches.length === 0) throw new ExecutionError(`NEAR Intents does not support ${symbol} on ${network}.`, 400);
  if (matches.length > 1) throw new ExecutionError(`${symbol} on ${network} matches ${matches.length} assets. Pick one in Manual Swap.`, 400);
  return matches[0];
}

export interface QuoteInput {
  amount: string;
  sourceToken: string;
  sourceNetwork: string;
  destToken: string;
  destNetwork: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  /** true: price only. false: user approved; returns a deposit address. */
  dry: boolean;
}

export interface Quote {
  dry: boolean;
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  minAmountOutFormatted: string;
  timeEstimateSec?: number;
  deadline: string;
  slippageBps: number;
  appFeeBps: number;
  withdrawFeeFormatted?: string;
  refundFeeFormatted?: string;
  origin: OneClickToken;
  destination: OneClickToken;
  recipient: string;
  refundTo: string;
}

interface RawQuote {
  quote: {
    depositAddress?: string; depositMemo?: string;
    amountIn: string; amountInFormatted: string; amountInUsd?: string;
    amountOut: string; amountOutFormatted: string; amountOutUsd?: string;
    minAmountOut: string; timeEstimate?: number; deadline?: string;
    withdrawFee?: string; refundFee?: string;
  };
  quoteRequest: { deadline: string; appFees?: { fee: number }[] };
}

export async function getQuote(input: QuoteInput): Promise<Quote> {
  const [origin, destination] = await Promise.all([
    findToken(input.sourceToken, input.sourceNetwork),
    findToken(input.destToken, input.destNetwork),
  ]);
  let amount: string;
  try { amount = toBaseUnits(input.amount, origin.decimals); }
  catch (e) { throw new ExecutionError((e as Error).message, 400); }

  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
  const raw = await call<RawQuote>("/v0/quote", {
    method: "POST",
    body: JSON.stringify({
      dry: input.dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: input.slippageBps,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destination.assetId,
      amount,
      refundTo: input.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: input.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline,
    }),
  });
  const q = raw.quote;
  if (!input.dry && !q.depositAddress) throw new ExecutionError("NEAR Intents returned no deposit address. Nothing was sent.", 502);
  return {
    dry: input.dry,
    depositAddress: q.depositAddress,
    depositMemo: q.depositMemo,
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountInUsd: q.amountInUsd,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    amountOutUsd: q.amountOutUsd,
    minAmountOutFormatted: fromBaseUnits(q.minAmountOut, destination.decimals),
    timeEstimateSec: q.timeEstimate,
    deadline: q.deadline ?? raw.quoteRequest.deadline,
    slippageBps: input.slippageBps,
    appFeeBps: (raw.quoteRequest.appFees ?? []).reduce((s, f) => s + f.fee, 0),
    withdrawFeeFormatted: q.withdrawFee ? fromBaseUnits(q.withdrawFee, destination.decimals) : undefined,
    refundFeeFormatted: q.refundFee ? fromBaseUnits(q.refundFee, origin.decimals) : undefined,
    origin,
    destination,
    recipient: input.recipient,
    refundTo: input.refundTo,
  };
}

export interface StatusResult {
  state: TxState;
  raw: string;
  updatedAt?: string;
  originTxHashes: string[];
  destinationTxHashes: string[];
  amountOutFormatted?: string;
  refundedAmountFormatted?: string;
}

export async function getStatus(depositAddress: string, deadline?: string): Promise<StatusResult> {
  try {
    const r = await call<{
      status: string; updatedAt?: string;
      swapDetails?: {
        originChainTxHashes?: { hash: string }[];
        destinationChainTxHashes?: { hash: string }[];
        amountOutFormatted?: string; refundedAmountFormatted?: string;
      };
    }>(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    return {
      state: mapStatus(r.status, deadline),
      raw: r.status,
      updatedAt: r.updatedAt,
      originTxHashes: r.swapDetails?.originChainTxHashes?.map((h) => h.hash) ?? [],
      destinationTxHashes: r.swapDetails?.destinationChainTxHashes?.map((h) => h.hash) ?? [],
      amountOutFormatted: r.swapDetails?.amountOutFormatted,
      refundedAmountFormatted: r.swapDetails?.refundedAmountFormatted,
    };
  } catch (e) {
    if (e instanceof ExecutionError && e.status === 404) {
      return { state: "unknown", raw: "NOT_FOUND", originTxHashes: [], destinationTxHashes: [] };
    }
    throw e;
  }
}
