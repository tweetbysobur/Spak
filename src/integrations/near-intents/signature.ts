import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import type { OneClickQuoteResponse } from "./client";

/** 1Click's published mainnet quote-signing key (from @defuse-protocol/one-click-sdk-typescript 0.1.26). */
export const ONECLICK_QUOTE_PUBLIC_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";
/** Tidepool's maker key, the only key on maker.tidepool-sandbox.testnet (usetidepool.tech/docs/guides/verify-quote-signatures). */
export const TIDEPOOL_QUOTE_PUBLIC_KEY = "ed25519:U1Mu4u1nHnHmgABpCkfDGXt2FZj8k29UGqhkMAu4iWY";

/** json-stable-stringify: keys sorted at every level, undefined properties omitted. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableStringify(x))).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

type Q = Record<string, unknown>;
const opt = (v: unknown) => (v ? v : undefined);

/**
 * The message 1Click (and Tidepool) sign: base58(sha256(stable JSON of selected request fields, selected quote fields
 * and timestamp)), as UTF-8 bytes. Mirrors verifyQuoteSignature() in the official SDK, field for field.
 */
export function quoteSigningMessage(res: OneClickQuoteResponse): string {
  const r = res.quoteRequest as Q, q = res.quote as Q;
  const req = {
    dry: r.dry, swapType: r.swapType, slippageTolerance: r.slippageTolerance, originAsset: r.originAsset, depositType: r.depositType,
    destinationAsset: r.destinationAsset, amount: r.amount, refundTo: r.refundTo, refundType: r.refundType, recipient: r.recipient,
    recipientType: r.recipientType, deadline: r.deadline, quoteWaitingTimeMs: opt(r.quoteWaitingTimeMs), referral: opt(r.referral),
    virtualChainRecipient: opt(r.virtualChainRecipient), virtualChainRefundRecipient: opt(r.virtualChainRefundRecipient), customRecipientMsg: opt(r.customRecipientMsg),
  };
  const base = { amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, amountInUsd: q.amountInUsd, minAmountIn: q.minAmountIn, amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted, amountOutUsd: q.amountOutUsd, minAmountOut: q.minAmountOut };
  const quote = r.dry ? base : {
    ...base, depositAddress: opt(q.depositAddress), depositMemo: opt(q.depositMemo), deadline: opt(q.deadline), timeWhenInactive: opt(q.timeWhenInactive),
    timeEstimate: opt(q.timeEstimate), refundFee: opt(q.refundFee), withdrawFee: opt(q.withdrawFee),
  };
  return base58.encode(sha256(new TextEncoder().encode(stableStringify({ ...req, ...quote, timestamp: res.timestamp }))));
}

const decode = (s: string) => base58.decode(s.startsWith("ed25519:") ? s.slice(8) : s);

/** True only when the signature verifies against this exact key. Anything malformed is false. */
export function verifyQuoteSignature(res: OneClickQuoteResponse, publicKey: string): boolean {
  try {
    const sig = decode(res.signature), pk = decode(publicKey);
    if (sig.length !== 64 || pk.length !== 32) return false;
    return ed25519.verify(sig, new TextEncoder().encode(quoteSigningMessage(res)), pk);
  } catch { return false; }
}
