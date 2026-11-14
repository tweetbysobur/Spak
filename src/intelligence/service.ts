/**
 * SPak Intelligence service. Composes SPak Portfolio (balances), SPak's independent pricing, the NEAR Intents token
 * list and route quotes into facts that SPak-in results and the Intelligence screen can use.
 *
 * Boundaries: it never interprets text (SPak-in does), never decides policy (Guard does), never creates or signs a
 * transaction (Execution and the user's wallet do). Route quotes here are dry quotes: no deposit address, no funds.
 */
import mainnetMap from "../integrations/near-intents/data/asset-map.json";
import testnetMap from "../integrations/near-intents/data/tidepool-asset-map.json";
import { IS_TESTNET } from "../environment";
import type { OneClickClient, OneClickToken } from "../integrations/near-intents/client";
import { verifyQuoteSignature } from "../integrations/near-intents/signature";
import type { PriceService } from "../pricing/oracle";
import { fromBaseUnits, toBaseUnits, mulDecimal, isDecimal } from "../spak-in/lib/decimal";
import { getAsset, listAssets } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import type { IntentResult } from "../spak-in/schemas/result";
import { automaticDelivery, trustedSendersFromEnv, type TrustedSenders } from "../tracking/route-trust";
import { analyse, answerQuery, feasibility, sourceOptions, type Holding, type Snapshot } from "./analysis";
import { EXECUTABLE_NETWORKS, type PortfolioReader, type PortfolioWallet } from "./portfolio";

const ASSET_MAP = ((IS_TESTNET ? testnetMap : mainnetMap) as { map: Record<string, string> }).map;
export const SNAPSHOT_TTL_MS = 60_000;
const TOKENS_TTL_MS = 5 * 60_000;

export type IntelligenceContext =
  | { kind: "PORTFOLIO_ANSWER"; text: string; lines: string[]; usd: string; incomplete: string | null; readAt: string; cached: boolean }
  | { kind: "FEASIBILITY"; status: "OK" | "INSUFFICIENT" | "UNKNOWN"; available: string | null; required: string; symbol: string; network: string; notes: string[]; readAt: string }
  | { kind: "SOURCE_OPTIONS"; text: string; options: { text: string; instruction: string | null; enough: boolean }[]; readAt: string }
  | { kind: "UNAVAILABLE"; text: string };

export interface RouteOption {
  destinationNetwork: string; destinationAssetId: string; symbol: string;
  status: "QUOTED" | "TOO_SMALL" | "UNAVAILABLE" | "NO_WALLET" | "REJECTED";
  amountOut: string | null; minAmountOut: string | null; feePct: number | null; timeEstimateSec: number | null;
  delivery: "AUTOMATIC" | "MANUAL_REVIEW"; detail: string | null;
}

export class IntelligenceService {
  private snapshots = new Map<string, { at: number; s: Snapshot }>();
  private tokens: { at: number; byId: Map<string, OneClickToken> } | null = null;
  private trust: TrustedSenders | null = null;
  private readonly clock: () => Date;

  constructor(private readonly d: { reader: PortfolioReader; prices: PriceService; client: OneClickClient; quotePublicKey: string | null; clock?: () => Date }) {
    this.clock = d.clock ?? (() => new Date());
  }

  private async liveTokens(): Promise<Map<string, OneClickToken> | null> {
    const now = this.clock().getTime();
    if (this.tokens && now - this.tokens.at < TOKENS_TTL_MS) return this.tokens.byId;
    try {
      const list = await this.d.client.tokens();
      this.tokens = { at: now, byId: new Map(list.map((t) => [t.assetId, t])) };
      return this.tokens.byId;
    } catch { return this.tokens?.byId ?? null; }
  }

  /** The user's valued portfolio. Cached for a minute per user; `refresh` reads the chains again. */
  async snapshot(userId: string, wallets: PortfolioWallet[], opts: { refresh?: boolean } = {}): Promise<{ snapshot: Snapshot; cached: boolean; ageSec: number }> {
    const now = this.clock().getTime();
    const hit = this.snapshots.get(userId);
    const key = wallets.map((w) => `${w.id}:${w.networks.filter((n) => n.enabled).map((n) => n.id).join(",")}`).join("|");
    if (!opts.refresh && hit && now - hit.at < SNAPSHOT_TTL_MS && (hit.s as Snapshot & { key?: string }).key === key) {
      return { snapshot: hit.s, cached: true, ageSec: Math.round((now - hit.at) / 1000) };
    }
    const [read, tokens] = await Promise.all([this.d.reader.read(wallets), this.liveTokens()]);
    // One CoinGecko request for every listed token that SPak has no built-in price mapping for.
    const cgIds = read.holdings.map((r) => (tokens?.get(ASSET_MAP[r.asset.id] ?? "") as { coingeckoId?: unknown } | undefined)?.coingeckoId).filter((x): x is string => typeof x === "string");
    await this.d.prices.prefetchCoingecko(cgIds);
    const holdings: Holding[] = await Promise.all(read.holdings.map(async (r) => {
      const amount = fromBaseUnits(r.units.toString(), r.asset.decimals);
      // Native NEAR has no NEAR Intents id of its own; wNEAR is NEAR wrapped one to one, so its listed price applies.
      const providerId = ASSET_MAP[r.asset.id] ?? (r.asset.id === "near:native" ? ASSET_MAP["near:wrap.near"] : undefined);
      const live = providerId ? tokens?.get(providerId) : undefined;
      const price = (live as { price?: unknown } | undefined)?.price;
      const providerUsd = typeof price === "number" && price > 0 && isDecimal(String(price)) ? mulDecimal(amount, String(price)) : null;
      const coingeckoId = (live as { coingeckoId?: unknown } | undefined)?.coingeckoId;
      const v = await this.d.prices.value({ symbol: r.asset.symbol, decimals: r.asset.decimals, amountUnits: r.units.toString(), providerUsd, coingeckoId: typeof coingeckoId === "string" ? coingeckoId : null });
      const ok = v.status === "OK";
      return {
        walletId: r.walletId, address: r.address, network: r.network, networkName: getNetwork(r.network)?.name ?? r.network,
        assetId: r.asset.id, symbol: r.asset.symbol, decimals: r.asset.decimals, native: !r.asset.contract,
        units: r.units.toString(), amount,
        // SPak's own price, not the conservative "higher of the two" used for spending limits.
        usd: ok ? (v.spakUsd ?? v.usd) : null,
        priceSource: ok ? ((v.reading?.source as Holding["priceSource"]) ?? null) : null,
        priceNote: ok ? null : (v.reasons[0] ?? "No verified price."),
        routable: !!ASSET_MAP[r.asset.id] && !!live && !/\(deprecated\)/i.test(live.symbol),
      };
    }));
    const s = analyse({ holdings, reads: read.reads, wallets: wallets.map((w) => ({ id: w.id, family: w.family, address: w.address, label: w.label })), readAt: read.readAt });
    this.snapshots.set(userId, { at: now, s: Object.assign(s, { key }) });
    return { snapshot: s, cached: false, ageSec: 0 };
  }

  /**
   * Facts for a SPak-in result, attached after deterministic interpretation (the engine itself is unchanged):
   * answers to portfolio questions, the funding check for an exact transfer, and real source options when SPak-in
   * still needs the source network or a balance-based amount resolved. Options are instructions for the user to pick;
   * nothing is executed from here.
   */
  context(r: IntentResult, s: Snapshot, cached: boolean): IntelligenceContext | null {
    if (r.intentType === "PORTFOLIO_QUERY" && r.status === "VALIDATED") {
      const a = answerQuery(s, r.query);
      return { kind: "PORTFOLIO_ANSWER", text: a.text, lines: a.lines, usd: a.usd, incomplete: a.incomplete, readAt: s.readAt, cached };
    }
    const moves = ["BRIDGE", "CROSS_CHAIN_SWAP", "CROSS_CHAIN_TRANSFER", "SWAP", "PAYMENT"].includes(r.intentType);
    if (!moves) return null;
    const leg = r.plan?.legs?.[0];
    if (leg && leg.amount.kind === "EXACT") {
      const asset = getAsset(leg.sourceAssetId);
      if (!asset) return null;
      const f = feasibility(s, { sourceNetwork: leg.sourceNetwork, sourceAssetId: leg.sourceAssetId, refundAddress: leg.refundAddress, amount: leg.amount.value, symbol: asset.symbol, decimals: asset.decimals });
      return { kind: "FEASIBILITY", ...f, readAt: s.readAt };
    }
    const symbol = r.source.asset?.symbol;
    if (!symbol) return null;
    const amount = r.source.amount?.kind === "EXACT" ? r.source.amount.value : null;
    // "All my USDC on Base": a balance-based amount on a known network becomes an exact figure for the user to confirm.
    if (r.source.amount?.kind === "PERCENT_OF_BALANCE" && r.source.network) {
      const pctAmount = r.source.amount.percent;
      const opts = sourceOptions(s, { symbol, amount: null, destinationNetwork: r.destination.network }).filter((o) => o.network === r.source.network).map((o) => {
        const dec = s.holdings.find((h) => h.network === o.network && h.symbol.toUpperCase() === symbol.toUpperCase())?.decimals ?? 18;
        const units = (BigInt(toBaseUnits(o.available, dec)) * BigInt(toBaseUnits(pctAmount, 4))) / 1_000_000n;
        const exact = fromBaseUnits(units.toString(), dec);
        const dst = r.destination.network ? getNetwork(r.destination.network)?.name : null;
        return { text: `${pctAmount}% of ${o.text} is ${exact} ${symbol}`, instruction: dst ? `Move ${exact} ${symbol} from ${getNetwork(o.network)?.name} to ${dst}` : null, enough: true };
      });
      return { kind: "SOURCE_OPTIONS", text: opts.length ? "SPak needs an exact amount. This is what that comes to from your balance:" : `SPak found no ${symbol} on ${getNetwork(r.source.network)?.name} in your wallets.`, options: opts, readAt: s.readAt };
    }
    if (r.status === "NEEDS_CLARIFICATION" && !r.source.network) {
      const opts = sourceOptions(s, { symbol, amount, destinationNetwork: r.destination.network });
      return {
        kind: "SOURCE_OPTIONS",
        text: opts.length ? `Your ${symbol} in connected wallets:` : `SPak found no ${symbol} that can be moved from your connected wallets.`,
        options: opts.map((o) => ({ text: o.text, instruction: amount === null ? null : o.instruction, enough: o.enough })),
        readAt: s.readAt,
      };
    }
    return null;
  }

  /**
   * Compare NEAR Intents routes for one holding to the same asset on other executable networks (dry quotes, signature
   * checked, no deposit address). Recipients are the user's own verified wallets; networks without one are listed as such.
   */
  async routes(args: { assetId: string; amount: string; refundAddress: string; recipients: Record<string, string> }): Promise<RouteOption[]> {
    const src = getAsset(args.assetId);
    if (!src || !ASSET_MAP[src.id]) return [];
    this.trust ??= trustedSendersFromEnv();
    const tokens = await this.liveTokens();
    const targets = listAssets().filter((a) => a.symbol === src.symbol && a.network !== src.network && (EXECUTABLE_NETWORKS as readonly string[]).includes(a.network) && ASSET_MAP[a.id]);
    let units: string;
    try { units = toBaseUnits(args.amount, src.decimals); } catch { return []; }
    const out: RouteOption[] = [];
    for (const dst of targets.slice(0, 9)) {
      const providerDst = ASSET_MAP[dst.id];
      const base = { destinationNetwork: dst.network, destinationAssetId: dst.id, symbol: dst.symbol, amountOut: null, minAmountOut: null, feePct: null, timeEstimateSec: null, delivery: automaticDelivery(dst.network, providerDst, this.trust) ? "AUTOMATIC" as const : "MANUAL_REVIEW" as const };
      const live = tokens?.get(providerDst);
      if (!live || /\(deprecated\)/i.test(live.symbol)) { out.push({ ...base, status: "UNAVAILABLE", detail: "NEAR Intents does not list this asset now." }); continue; }
      const recipient = args.recipients[dst.network];
      if (!recipient) { out.push({ ...base, status: "NO_WALLET", detail: `Connect a wallet on ${getNetwork(dst.network)?.name} to receive there.` }); continue; }
      try {
        const res = await this.d.client.quote({
          dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: ASSET_MAP[src.id], depositType: "ORIGIN_CHAIN",
          destinationAsset: providerDst, amount: units, refundTo: args.refundAddress, refundType: "ORIGIN_CHAIN",
          recipient, recipientType: "DESTINATION_CHAIN", deadline: new Date(this.clock().getTime() + 30 * 60_000).toISOString(),
        });
        if (!this.d.quotePublicKey || !verifyQuoteSignature(res, this.d.quotePublicKey)) { out.push({ ...base, status: "REJECTED", detail: "The quote signature does not verify; SPak does not use it." }); continue; }
        const q = res.quote as { amountOut: string; minAmountOut: string; amountInUsd?: string; amountOutUsd?: string; timeEstimate?: number };
        const inUsd = Number(q.amountInUsd), outUsd = Number(q.amountOutUsd);
        out.push({ ...base, status: "QUOTED", amountOut: fromBaseUnits(q.amountOut, dst.decimals), minAmountOut: fromBaseUnits(q.minAmountOut, dst.decimals),
          feePct: inUsd > 0 && outUsd >= 0 ? Math.max(0, Math.round((1 - outUsd / inUsd) * 10_000) / 100) : null, timeEstimateSec: q.timeEstimate ?? null, detail: null });
      } catch (e) {
        const m = (e as Error).message;
        out.push({ ...base, status: /too low|at least/i.test(m) ? "TOO_SMALL" : "UNAVAILABLE", detail: m.slice(0, 200) });
      }
    }
    return out;
  }
}
