import { randomBytes } from "node:crypto";
import { OneClickError, type OneClickClient, type OneClickQuoteRequest, type OneClickQuoteResponse } from "../integrations/near-intents/client";
import { compareDecimal, fromBaseUnits, toBaseUnits } from "../spak-in/lib/decimal";
import type { ResolvedAsset } from "./asset-resolver";
import { ExecutionError } from "./errors";
import type { ValidatedPlan } from "./plan-validator";
import { checkQuote } from "./quote-validator";
import type { ExecutionRecords, QuoteRow } from "./records";

/** How long SPak honours an indicative (dry) quote for approval. Prices move; re-quote after this. */
export const INDICATIVE_TTL_MS = 2 * 60_000;
/** Deposit deadline requested from the provider for firm quotes. */
export const FIRM_DEADLINE_MS = 30 * 60_000;

export interface QuoteFee { kind: "PROVIDER_APP_FEE" | "DESTINATION_NETWORK" | "REFUND"; bps?: number; amount?: string; assetId?: string; note: string }

export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;

export function providerError(e: unknown): ExecutionError {
  if (e instanceof ExecutionError) return e;
  if (e instanceof OneClickError) {
    switch (e.kind) {
      case "BAD_REQUEST": return new ExecutionError("QUOTE_REJECTED", `NEAR Intents could not quote this: ${e.message}`);
      case "UNAUTHORIZED": return new ExecutionError("PROVIDER_ERROR", "NEAR Intents rejected SPak's credentials. This is a server configuration problem.");
      case "RATE_LIMITED": return new ExecutionError("PROVIDER_UNAVAILABLE", "NEAR Intents is rate limiting requests. Try again shortly.");
      case "INVALID_RESPONSE": return new ExecutionError("PROVIDER_ERROR", e.message);
      default: return new ExecutionError("PROVIDER_UNAVAILABLE", "NEAR Intents is unavailable. Try again shortly.");
    }
  }
  return new ExecutionError("PROVIDER_ERROR", (e as Error)?.message ?? "Provider error.");
}

/** Quote Service: build the 1Click request from a validated plan, call the provider, validate and persist. */
export class QuoteService {
  constructor(private readonly client: OneClickClient, private readonly records: ExecutionRecords, private readonly clock: () => Date = () => new Date()) {}

  buildRequest(v: ValidatedPlan, src: ResolvedAsset, dst: ResolvedAsset, dry: boolean): OneClickQuoteRequest {
    let amount: string;
    try { amount = toBaseUnits(v.leg.amount.value, src.decimals); }
    catch { throw new ExecutionError("INVALID_AMOUNT", `${src.symbol} supports ${src.decimals} decimal places.`); }
    if (amount === "0") throw new ExecutionError("INVALID_AMOUNT", "Amount is zero after conversion.");
    return {
      dry, swapType: "EXACT_INPUT", slippageTolerance: v.plan.constraints.slippageBps,
      originAsset: src.providerAssetId, depositType: "ORIGIN_CHAIN", destinationAsset: dst.providerAssetId,
      amount, refundTo: v.leg.refundAddress, refundType: "ORIGIN_CHAIN",
      recipient: v.leg.recipient, recipientType: "DESTINATION_CHAIN",
      deadline: new Date(this.clock().getTime() + FIRM_DEADLINE_MS).toISOString(),
      // Stellar deposits are identified by memo (per the 1Click spec); everything else uses a unique address.
      ...(src.providerChain === "stellar" ? { depositMode: "MEMO" as const } : {}),
    };
  }

  async quote(args: { executionId: string; userId: string; v: ValidatedPlan; src: ResolvedAsset; dst: ResolvedAsset; dry: boolean }): Promise<QuoteRow> {
    const { v, src, dst, dry } = args;
    const req = this.buildRequest(v, src, dst, dry);
    let res: OneClickQuoteResponse;
    try { res = await this.client.quote(req); } catch (e) { throw providerError(e); }
    const now = this.clock();

    const check = checkQuote(req, res, { sourceNetwork: src.network, now });
    if (!dry && req.depositMode === "MEMO" && !res.quote.depositMemo) check.problems.push("memo deposit mode but no memo returned");
    const min = v.plan.constraints.minOutput;
    if (min) {
      const minUnits = toBaseUnits(min.value, dst.decimals);
      if (BigInt(res.quote.minAmountOut) < BigInt(minUnits)) {
        check.problems.push(`worst-case output ${fromBaseUnits(res.quote.minAmountOut, dst.decimals)} ${dst.symbol} is below your minimum ${min.value}`);
      }
    }
    const ok = check.problems.length === 0;
    const q = res.quote;
    const appFeeBps = (res.quoteRequest.appFees ?? []).reduce((s, f) => s + f.fee, 0);
    const fees: QuoteFee[] = [
      ...(appFeeBps ? [{ kind: "PROVIDER_APP_FEE" as const, bps: appFeeBps, note: "Taken from the input, already reflected in the output." }] : []),
      ...(q.withdrawFee ? [{ kind: "DESTINATION_NETWORK" as const, amount: q.withdrawFee, assetId: dst.id, note: "Already deducted from the output." }] : []),
      ...(q.refundFee ? [{ kind: "REFUND" as const, amount: q.refundFee, assetId: src.id, note: "Charged only if a refund happens." }] : []),
    ];
    const providerDeadline = q.deadline ? new Date(q.deadline) : dry ? null : new Date(req.deadline);
    const expiresAt = dry ? new Date(now.getTime() + INDICATIVE_TTL_MS) : providerDeadline!;
    const row = await this.records.insertQuote({
      id: newId("qte"), executionId: args.executionId, userId: args.userId, planId: v.plan.planId, planHash: v.plan.hash, planRevision: v.revision,
      kind: dry ? "INDICATIVE" : "FIRM", status: ok ? "VALID" : "REJECTED",
      sourceNetwork: src.network, destinationNetwork: dst.network, sourceAssetId: src.id, destinationAssetId: dst.id,
      providerOriginAsset: src.providerAssetId, providerDestinationAsset: dst.providerAssetId,
      amountIn: q.amountIn, amountOut: q.amountOut, minAmountOut: q.minAmountOut, amountInUsd: q.amountInUsd ?? null, amountOutUsd: q.amountOutUsd ?? null,
      slippageBps: req.slippageTolerance, fees, depositAddress: dry ? null : q.depositAddress ?? null, depositMemo: dry ? null : q.depositMemo ?? null,
      timeEstimateSec: q.timeEstimate != null ? Math.round(q.timeEstimate) : null, expiresAt, providerDeadline,
      providerCorrelationId: res.correlationId ?? null, providerSignature: res.signature, providerTimestamp: res.timestamp,
      rejectionReason: ok ? null : check.problems.join("; "), request: req, response: res, createdAt: now,
    });
    if (!ok) {
      const code = min && check.problems.some((x) => x.includes("below your minimum")) && check.problems.length === 1 ? "QUOTE_REJECTED" : "QUOTE_MISMATCH";
      throw new ExecutionError(code, `The quote was rejected: ${check.problems.join("; ")}.`, { quoteId: row.id });
    }
    return row;
  }
}

/** Firm terms must be at least as good as the worst case the user approved. */
export function firmWithinApproved(indicative: QuoteRow, firm: QuoteRow): boolean {
  return compareDecimal(firm.amountOut ?? "0", indicative.minAmountOut ?? "0") >= 0 && compareDecimal(firm.minAmountOut ?? "0", "0") > 0;
}
