import { CHAINLINK_FEEDS, PRICE_POLICY, SYMBOL_TO_CHAINLINK, SYMBOL_TO_COINGECKO, type ChainlinkFeed } from "./feeds";
import { valuate, type PriceReading, type Valuation } from "./valuation";

export class PriceUnavailable extends Error { constructor(m: string) { super(m); this.name = "PriceUnavailable"; } }

/** Where SPak reads prices from. Injected so tests can use fixed readings; production uses ChainlinkCoinGeckoReader. */
export interface PriceReader {
  chainlink(feed: ChainlinkFeed): Promise<PriceReading>;
  coingecko(id: string): Promise<PriceReading>;
  /** Optional batch read (one request); ids without a usable price are left out. */
  coingeckoMany?(ids: string[]): Promise<Map<string, PriceReading>>;
}

const hex = (s: string, i: number) => BigInt(`0x${s.slice(2 + 64 * i, 2 + 64 * (i + 1))}`);

/**
 * Production reader. Chainlink: eth_call on Ethereum mainnet (SPAK_PRICE_RPC_URL, default a public node), checking the
 * feed's description and decimals on every read and rejecting incomplete rounds. CoinGecko: the public simple-price API
 * with last_updated_at. Any transport or shape problem throws PriceUnavailable.
 */
export function httpPriceReader(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): PriceReader {
  const rpcUrls = (env.SPAK_PRICE_RPC_URL ?? "https://ethereum-rpc.publicnode.com,https://eth.llamarpc.com").split(",").map((s) => s.trim()).filter(Boolean);
  const call = async (to: string, data: string): Promise<string> => {
    let last = "";
    for (const url of rpcUrls) {
      try {
        const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }), signal: AbortSignal.timeout(8_000) });
        const b = (await r.json().catch(() => null)) as { result?: string } | null;
        if (b?.result && /^0x[0-9a-f]*$/i.test(b.result) && b.result.length > 2) return b.result;
        last = `${url}: no result`;
      } catch (e) { last = `${url}: ${(e as Error).message}`; }
    }
    throw new PriceUnavailable(`Price feed unreachable (${last}).`);
  };
  return {
    async chainlink(f) {
      const [desc, dec, round] = await Promise.all([call(f.address, "0x7284e416"), call(f.address, "0x313ce567"), call(f.address, "0xfeaf968c")]);
      let description = "";
      try { const len = Number(hex(desc, 1)); description = Buffer.from(desc.slice(2 + 128, 2 + 128 + len * 2), "hex").toString("utf8"); } catch { /* checked below */ }
      if (description !== f.description) throw new PriceUnavailable(`Feed ${f.address} describes itself as "${description}", not "${f.description}".`);
      if (Number(hex(dec, 0)) !== f.decimals) throw new PriceUnavailable(`Feed ${f.description} decimals changed.`);
      if (round.length < 2 + 64 * 5) throw new PriceUnavailable(`Feed ${f.description} returned a short answer.`);
      const roundId = hex(round, 0), raw = hex(round, 1), updatedAt = Number(hex(round, 3)), answeredIn = hex(round, 4);
      const answer = raw >= 1n << 255n ? raw - (1n << 256n) : raw; // int256
      if (answeredIn < roundId) throw new PriceUnavailable(`Feed ${f.description} round is incomplete.`);
      return { source: "CHAINLINK", ref: f.address, answer, decimals: f.decimals, updatedAt, stable: f.stable, roundId: roundId.toString() };
    },
    async coingeckoMany(ids) {
      const out = new Map<string, PriceReading>();
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        let b: Record<string, { usd?: number; last_updated_at?: number }> | null = null;
        try {
          const r = await fetchImpl(`https://api.coingecko.com/api/v3/simple/price?ids=${chunk.map(encodeURIComponent).join(",")}&vs_currencies=usd&include_last_updated_at=true&precision=8`, { signal: AbortSignal.timeout(10_000) });
          b = r.ok ? await r.json() : null;
        } catch { b = null; }
        for (const id of chunk) {
          const v = b?.[id];
          if (!v || typeof v.usd !== "number" || !Number.isFinite(v.usd) || typeof v.last_updated_at !== "number") continue;
          const [i2, f = ""] = v.usd.toFixed(8).split(".");
          out.set(id, { source: "COINGECKO", ref: id, answer: BigInt(i2 + f.padEnd(8, "0").slice(0, 8)), decimals: 8, updatedAt: v.last_updated_at, stable: false });
        }
      }
      return out;
    },
    async coingecko(id) {
      let b: Record<string, { usd?: number; last_updated_at?: number }> | null = null;
      try {
        const r = await fetchImpl(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_last_updated_at=true&precision=8`, { signal: AbortSignal.timeout(8_000) });
        b = r.ok ? await r.json() : null;
      } catch { b = null; }
      const v = b?.[id];
      if (!v || typeof v.usd !== "number" || !Number.isFinite(v.usd) || typeof v.last_updated_at !== "number") throw new PriceUnavailable(`CoinGecko has no usable price for ${id}.`);
      const [i, f = ""] = v.usd.toFixed(8).split(".");
      return { source: "COINGECKO", ref: id, answer: BigInt(i + f.padEnd(8, "0").slice(0, 8)), decimals: 8, updatedAt: v.last_updated_at, stable: false };
    },
  };
}

/** Valuation service: the one place Guard, Agent permissions and the approval ceiling get a USD value from. */
export class PriceService {
  private cache = new Map<string, { at: number; r: PriceReading }>();
  private readonly clock: () => Date;
  constructor(private readonly reader: PriceReader | null, clock?: () => Date) { this.clock = clock ?? (() => new Date()); }

  private async read(key: string, fn: () => Promise<PriceReading>): Promise<PriceReading> {
    const now = this.clock().getTime();
    const c = this.cache.get(key);
    if (c && now - c.at < PRICE_POLICY.cacheMs) return c.r;
    const r = await fn();
    this.cache.set(key, { at: now, r });
    return r;
  }

  /** Fill the cache for many CoinGecko ids with one request, when the reader supports it. Failures are ignored. */
  async prefetchCoingecko(ids: string[]): Promise<void> {
    const now = this.clock().getTime();
    const want = [...new Set(ids)].filter((id) => { const c = this.cache.get(`cg:${id}`); return !c || now - c.at >= PRICE_POLICY.cacheMs; });
    if (!want.length || !this.reader?.coingeckoMany) return;
    try { for (const [id, r] of await this.reader.coingeckoMany(want)) this.cache.set(`cg:${id}`, { at: now, r }); } catch { /* each value() call falls back to its own read */ }
  }

  /** Value an amount of an asset. Never throws: failures come back as UNAVAILABLE, with the reason. */
  /**
   * `coingeckoId` (optional, used by SPak Intelligence for display) names the CoinGecko asset when SPak has no mapping
   * for the symbol. It never overrides a mapping, and a CoinGecko price still counts only when the provider's figure
   * agrees with it. Guard, grants and Execution do not pass it.
   */
  async value(a: { symbol: string; decimals: number; amountUnits: string; providerUsd: string | null; coingeckoId?: string | null }): Promise<Valuation> {
    const sym = a.symbol.toUpperCase();
    const feed = SYMBOL_TO_CHAINLINK[sym] ? CHAINLINK_FEEDS[SYMBOL_TO_CHAINLINK[sym]] : null;
    const cg = SYMBOL_TO_COINGECKO[sym] ?? (a.coingeckoId && /^[a-z0-9-]{1,80}$/.test(a.coingeckoId) ? a.coingeckoId : null);
    let reading: PriceReading | null = null, maxAge: number = PRICE_POLICY.coingeckoMaxAgeSec, err: string | null = null;
    if (!this.reader) err = "No price source is configured on this server.";
    else if (feed) { try { reading = await this.read(`cl:${feed.key}`, () => this.reader!.chainlink(feed)); maxAge = feed.maxAgeSec; } catch (e) { err = (e as Error).message; } }
    else if (cg) { try { reading = await this.read(`cg:${cg}`, () => this.reader!.coingecko(cg)); } catch (e) { err = (e as Error).message; } }
    else err = `SPak has no independent price source for ${sym}.`;
    const v = valuate({ amountUnits: a.amountUnits, tokenDecimals: a.decimals, providerUsd: a.providerUsd, reading, now: this.clock(), maxAgeSec: maxAge });
    return err ? { ...v, reasons: [err, ...v.reasons.filter((r) => !r.startsWith("SPak has no independent price"))] } : v;
  }
}
