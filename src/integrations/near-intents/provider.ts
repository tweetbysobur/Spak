import mapData from "./data/asset-map.json";
import { getAsset } from "../../spak-in/registries/assets";
import { compareDecimal, fromBaseUnits, toBaseUnits } from "../../spak-in/lib/decimal";
import type { ExecutionPlan, Leg } from "../../spak-in/schemas/plan";
import type { ExecutionProvider, ExecutionState, PreparedExecution, ProviderQuote, ProviderStatus } from "../../spak-in/coordinator/types";
import { OneClickClient, OneClickHttpError, type OneClickConfig, type OneClickQuoteRequest, type OneClickQuoteResponse } from "./client";

const ASSET_MAP = (mapData as { map: Record<string, string> }).map;
export const QUOTE_DEADLINE_MS = 30 * 60_000;

/** Pure conversion from a SPak leg to a 1Click quote request. */
export function toOneClickRequest(leg: Leg, slippageBps: number, dry: boolean, now: Date): OneClickQuoteRequest {
  if (leg.amount.kind !== "EXACT") throw new Error("NEAR Intents needs an exact amount. Resolve percentages and fiat amounts first.");
  const src = getAsset(leg.sourceAssetId);
  const originAsset = ASSET_MAP[leg.sourceAssetId];
  const destinationAsset = ASSET_MAP[leg.destinationAssetId];
  if (!src || !originAsset || !destinationAsset) throw new Error("Asset is not mapped to NEAR Intents.");
  return {
    dry, swapType: "EXACT_INPUT", slippageTolerance: slippageBps,
    originAsset, depositType: "ORIGIN_CHAIN", destinationAsset,
    amount: toBaseUnits(leg.amount.value, src.decimals),
    refundTo: leg.refundAddress, refundType: "ORIGIN_CHAIN",
    recipient: leg.recipient, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now.getTime() + QUOTE_DEADLINE_MS).toISOString(),
  };
}

export function mapOneClickStatus(status: string, deadline: string | null, now: Date): ExecutionState {
  switch (status) {
    case "SUCCESS": return "COMPLETED";
    case "REFUNDED": return "REFUNDED";
    case "FAILED": return "FAILED";
    case "KNOWN_DEPOSIT_TX": case "PROCESSING": case "INCOMPLETE_DEPOSIT": return "PROCESSING";
    case "PENDING_DEPOSIT": return deadline && Date.parse(deadline) < now.getTime() ? "EXPIRED" : "AWAITING_DEPOSIT";
    default: return "UNKNOWN";
  }
}

function toQuote(r: OneClickQuoteResponse, leg: Leg): ProviderQuote {
  const dst = getAsset(leg.destinationAssetId)!;
  const src = getAsset(leg.sourceAssetId)!;
  const appFeeBps = (r.quoteRequest.appFees ?? []).reduce((s, f) => s + f.fee, 0);
  return {
    provider: "near-intents",
    amountIn: r.quote.amountInFormatted,
    amountOut: r.quote.amountOutFormatted,
    minAmountOut: fromBaseUnits(r.quote.minAmountOut, dst.decimals),
    amountInUsd: r.quote.amountInUsd ?? null,
    amountOutUsd: r.quote.amountOutUsd ?? null,
    fees: [
      ...(appFeeBps ? [{ kind: "PROVIDER" as const, amount: `${appFeeBps / 100}%`, asset: null, note: "Included in the quoted output." }] : []),
      ...(r.quote.withdrawFee ? [{ kind: "NETWORK" as const, amount: fromBaseUnits(r.quote.withdrawFee, dst.decimals), asset: dst.id, note: "Destination network fee, included." }] : []),
      ...(r.quote.refundFee ? [{ kind: "REFUND" as const, amount: fromBaseUnits(r.quote.refundFee, src.decimals), asset: src.id, note: "Charged only if a refund happens." }] : []),
    ],
    estimatedSeconds: r.quote.timeEstimate ?? null,
    expiresAt: r.quote.deadline ?? r.quoteRequest.deadline ?? null,
  };
}

/** SPak Execution provider backed by NEAR Intents 1Click. */
export class NearIntentsProvider implements ExecutionProvider {
  readonly id = "near-intents";
  private readonly client: OneClickClient;
  constructor(cfg: OneClickConfig = {}, private readonly clock: () => Date = () => new Date()) {
    this.client = new OneClickClient(cfg);
  }

  supports(plan: ExecutionPlan) {
    if (plan.legs.length !== 1) return { ok: false as const, reason: "Supports exactly one leg per plan." };
    const leg = plan.legs[0];
    if (leg.amount.kind !== "EXACT") return { ok: false as const, reason: "Needs an exact amount." };
    if (!ASSET_MAP[leg.sourceAssetId] || !ASSET_MAP[leg.destinationAssetId]) return { ok: false as const, reason: "Asset not routable through NEAR Intents." };
    if (leg.sourceAssetId === leg.destinationAssetId) return { ok: false as const, reason: "Same asset on the same network is a direct wallet transfer, not an intent." };
    return { ok: true as const };
  }

  async quote(plan: ExecutionPlan): Promise<ProviderQuote> {
    const leg = plan.legs[0];
    const r = await this.client.quote(toOneClickRequest(leg, plan.constraints.slippageBps, true, this.clock()));
    return toQuote(r, leg);
  }

  async prepare(plan: ExecutionPlan): Promise<PreparedExecution> {
    const leg = plan.legs[0];
    const req = toOneClickRequest(leg, plan.constraints.slippageBps, false, this.clock());
    const r = await this.client.quote(req);
    if (!r.quote.depositAddress) throw new Error("NEAR Intents returned no deposit address. Nothing was sent.");
    const quote = toQuote(r, leg);
    if (plan.constraints.minOutput) {
      if (compareDecimal(quote.minAmountOut, plan.constraints.minOutput.value) < 0) {
        throw new Error(`Worst-case output ${quote.minAmountOut} is below your minimum ${plan.constraints.minOutput.value}. Nothing was sent.`);
      }
    }
    return {
      provider: this.id,
      providerRef: r.quote.depositAddress,
      deposit: {
        network: leg.sourceNetwork, assetId: leg.sourceAssetId, amount: r.quote.amountInFormatted,
        address: r.quote.depositAddress, memo: r.quote.depositMemo ?? null, deadline: quote.expiresAt ?? req.deadline,
      },
      quote,
    };
  }

  async status(ref: string, deadline: string | null): Promise<ProviderStatus> {
    try {
      const r = await this.client.status(ref);
      return {
        state: mapOneClickStatus(r.status, deadline, this.clock()),
        originTxHashes: r.swapDetails?.originChainTxHashes?.map((h) => h.hash) ?? [],
        destinationTxHashes: r.swapDetails?.destinationChainTxHashes?.map((h) => h.hash) ?? [],
        amountOut: r.swapDetails?.amountOut ?? null,
        raw: r.status,
      };
    } catch (e) {
      // Before the first deposit, 1Click may not know the address yet.
      if (e instanceof OneClickHttpError && e.status === 404) {
        return { state: deadline && Date.parse(deadline) < this.clock().getTime() ? "EXPIRED" : "AWAITING_DEPOSIT", originTxHashes: [], destinationTxHashes: [], amountOut: null, raw: "NOT_FOUND" };
      }
      throw e;
    }
  }
}
