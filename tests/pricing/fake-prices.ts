/** MOCKED price reader for deterministic tests. Not evidence about real prices; see tests/live/prices.live.test.ts. */
import type { ChainlinkFeed } from "@/pricing/feeds";
import type { PriceReader } from "@/pricing/oracle";
import { PriceUnavailable } from "@/pricing/oracle";
import type { PriceReading } from "@/pricing/valuation";
import { usdValue } from "@/pricing/valuation";
import { SYMBOL_TO_CHAINLINK, SYMBOL_TO_COINGECKO } from "@/pricing/feeds";
import assetMap from "@/integrations/near-intents/data/asset-map.json";
import { getAsset } from "@/spak-in/registries/assets";

/** Default test prices (USD per whole token), keyed by Chainlink feed key or CoinGecko id. Same as tests/setup-prices.ts. */
export const TEST_PRICES: ReadonlyArray<[string, string]> = [["ETH", "2000"], ["BTC", "60000"], ["USDC", "1"], ["USDT", "1"], ["DAI", "1"], ["SOL", "150"], ["BNB", "600"], ["AVAX", "30"], ["LINK", "15"], ["near", "3"]];

/** What an honest provider would report as amountInUsd: the amount at the test price, 6 decimals. Null when unpriced. */
export function honestUsd(providerAsset: string, amount: string, prices: ReadonlyMap<string, string> = new Map(TEST_PRICES)): string | null {
  const spakId = Object.entries((assetMap as { map: Record<string, string> }).map).find(([, v]) => v === providerAsset)?.[0];
  const a = spakId ? getAsset(spakId) : undefined;
  if (!a) return null;
  const sym = a.symbol.toUpperCase();
  const key = SYMBOL_TO_CHAINLINK[sym] ?? SYMBOL_TO_COINGECKO[sym];
  const p = key ? prices.get(key) : undefined;
  if (!p) return null;
  const [i, f = ""] = p.split(".");
  return usdValue(BigInt(amount), a.decimals, { answer: BigInt(i + f.padEnd(8, "0").slice(0, 8)), decimals: 8 });
}

export class FakePrices implements PriceReader {
  /** USD price per whole token, by feed key (Chainlink) or CoinGecko id. */
  usd = new Map<string, string>(TEST_PRICES);
  ageSec = 10;
  down = false;
  calls = 0;
  constructor(private readonly now: () => Date) {}
  private reading(source: PriceReading["source"], ref: string, key: string, stable: boolean): PriceReading {
    this.calls++;
    if (this.down) throw new PriceUnavailable("price source down (test)");
    const p = this.usd.get(key);
    if (p === undefined) throw new PriceUnavailable(`no test price for ${key}`);
    const [i, f = ""] = p.split(".");
    return { source, ref, answer: BigInt(i + f.padEnd(8, "0").slice(0, 8)), decimals: 8, updatedAt: Math.floor(this.now().getTime() / 1000) - this.ageSec, stable, roundId: "1" };
  }
  async chainlink(f: ChainlinkFeed) { return this.reading("CHAINLINK", f.address, f.key, f.stable); }
  async coingecko(id: string) { return this.reading("COINGECKO", id, id, false); }
}
