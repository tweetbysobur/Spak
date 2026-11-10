import type { OneClickQuoteRequest, OneClickQuoteResponse } from "../integrations/near-intents/client";
import { getNetwork } from "../spak-in/registries/networks";
import { isAddressFor } from "../spak-in/validator/address";

export interface QuoteCheck {
  ok: boolean;
  problems: string[];
}

const big = (s: string) => BigInt(s);

/**
 * Quote Validator. The provider must quote exactly what we asked for:
 * same assets, amount, recipient, refund address, swap type and slippage, with sane outputs.
 * Firm quotes must carry a deposit address valid on the source network. Any difference rejects the quote;
 * nothing is ever substituted.
 */
export function checkQuote(req: OneClickQuoteRequest, res: OneClickQuoteResponse, ctx: { sourceNetwork: string; now: Date }): QuoteCheck {
  const p: string[] = [];
  const echo = res.quoteRequest;
  const same = (field: keyof OneClickQuoteRequest, got: unknown) => { if (req[field] !== got) p.push(`${field}: asked ${String(req[field])}, provider echoed ${String(got)}`); };
  same("originAsset", echo.originAsset);
  same("destinationAsset", echo.destinationAsset);
  same("amount", echo.amount);
  same("recipient", echo.recipient);
  same("refundTo", echo.refundTo);
  same("swapType", echo.swapType);
  same("slippageTolerance", echo.slippageTolerance);
  same("dry", echo.dry);
  same("depositType", echo.depositType);
  same("recipientType", echo.recipientType);
  same("refundType", echo.refundType);

  const q = res.quote;
  if (q.amountIn !== req.amount) p.push(`amountIn ${q.amountIn} differs from requested ${req.amount}`);
  if (big(q.amountOut) <= 0n) p.push("amountOut is zero");
  if (big(q.minAmountOut) > big(q.amountOut)) p.push("minAmountOut is above amountOut");
  // Slippage: minAmountOut must not be lower than amountOut minus the tolerance we asked for (1 unit rounding).
  const floor = (big(q.amountOut) * BigInt(10_000 - req.slippageTolerance)) / 10_000n;
  if (big(q.minAmountOut) + 1n < floor) p.push(`minAmountOut ${q.minAmountOut} allows more than ${req.slippageTolerance} bps slippage`);
  const fees = (echo.appFees ?? []).reduce((s, f) => s + f.fee, 0);
  if (fees > 100) p.push(`provider app fees of ${fees} bps exceed the 100 bps ceiling`);

  if (!req.dry) {
    const fam = getNetwork(ctx.sourceNetwork)?.family;
    if (!q.depositAddress) p.push("firm quote has no deposit address");
    else if (fam && !isAddressFor(fam, q.depositAddress)) p.push(`deposit address is not a valid ${ctx.sourceNetwork} address`);
    if (!res.signature) p.push("firm quote is not signed by the provider");
    if (q.deadline && Date.parse(q.deadline) <= ctx.now.getTime()) p.push("deposit deadline already passed");
  }
  return { ok: p.length === 0, problems: p };
}
