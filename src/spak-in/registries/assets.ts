import mainnetData from "./data/assets.json";
import testnetData from "./data/testnet-assets.json";
import { IS_TESTNET } from "../../environment";
import { getNetwork, NETWORKS } from "./networks";

/** A concrete asset on one network. id = "<network>:<contract|native>". */
export interface AssetDefinition {
  id: string;
  network: string;
  symbol: string;
  decimals: number;
  contract: string | null;
}

/** Ticker aliases users type. Maps to the registry symbol key (upper case). */
const SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  usdc: "USDC", "usd coin": "USDC", "usdc.e": "USDC",
  usdt: "USDT", tether: "USDT",
  eth: "ETH", ether: "ETH", ethers: "ETH",
  weth: "WETH", "wrapped eth": "WETH", "wrapped ether": "WETH",
  btc: "BTC", bitcoin: "BTC", bitcoins: "BTC", sats: "BTC",
  wbtc: "WBTC", "wrapped bitcoin": "WBTC",
  sol: "SOL", solana: "SOL",
  near: "NEAR", wnear: "WNEAR",
  dai: "DAI", bnb: "BNB", pol: "POL", matic: "POL", avax: "AVAX", arb: "ARB", op: "OP",
  doge: "DOGE", dogecoin: "DOGE", xrp: "XRP", trx: "TRX", tron: "TRX", sui: "SUI", ltc: "LTC", litecoin: "LTC",
  apt: "APT", xlm: "XLM", zec: "ZEC", link: "LINK", uni: "UNI", aave: "AAVE", pepe: "PEPE", shib: "SHIB",
};

/** Exactly one registry per build: mainnet (from 1Click) or testnet (from Tidepool). Ids never overlap. */
const data = IS_TESTNET ? testnetData : mainnetData;
const assets = (data as { assets: AssetDefinition[] }).assets.filter((a) => getNetwork(a.network));
export const ASSET_REGISTRY_META = (data as { meta: { source: string; fetchedAt: string; count: number } }).meta;

const byId = new Map<string, AssetDefinition>();
const bySymbolNetwork = new Map<string, AssetDefinition[]>();
const bySymbol = new Map<string, AssetDefinition[]>();
for (const a of assets) {
  byId.set(a.id, a);
  const key = a.symbol.toUpperCase();
  const k2 = `${a.network}|${key}`;
  bySymbolNetwork.set(k2, [...(bySymbolNetwork.get(k2) ?? []), a]);
  bySymbol.set(key, [...(bySymbol.get(key) ?? []), a]);
}

export function getAsset(id: string): AssetDefinition | undefined {
  return byId.get(id);
}

/** Resolve user text to a registry symbol key. Undefined when the word is not a known ticker. */
export function lookupSymbol(word: string): string | undefined {
  const w = word.toLowerCase().replace(/^\$/, "");
  if (SYMBOL_ALIASES[w]) return SYMBOL_ALIASES[w];
  const up = w.toUpperCase();
  return bySymbol.has(up) ? up : undefined;
}

export function isStrongSymbolAlias(word: string): boolean {
  return word.toLowerCase() in SYMBOL_ALIASES;
}

/**
 * Documented equivalences. NEAR Intents lists native NEAR only as wNEAR (wrap.near and its bridged forms),
 * so "NEAR" resolves to wNEAR when no asset is literally called NEAR on that network.
 */
export const SYMBOL_EQUIVALENTS: Readonly<Record<string, string>> = { NEAR: "WNEAR" };

/** All assets with this symbol on this network. Can be 0, 1 or several. Never pick one silently. */
export function findAssets(symbol: string, network: string): AssetDefinition[] {
  const key = symbol.toUpperCase();
  const direct = bySymbolNetwork.get(`${network}|${key}`) ?? [];
  if (direct.length || !SYMBOL_EQUIVALENTS[key]) return direct;
  return bySymbolNetwork.get(`${network}|${SYMBOL_EQUIVALENTS[key]}`) ?? [];
}

export function networksForSymbol(symbol: string): string[] {
  const key = symbol.toUpperCase();
  const all = [...(bySymbol.get(key) ?? []), ...(SYMBOL_EQUIVALENTS[key] ? bySymbol.get(SYMBOL_EQUIVALENTS[key]) ?? [] : [])];
  const on = new Set(all.map((a) => a.network));
  return NETWORKS.map((n) => n.id).filter((id) => on.has(id)); // registry order: most used networks first
}

export function isKnownSymbol(symbol: string): boolean {
  return bySymbol.has(symbol.toUpperCase());
}

export function listAssets(): readonly AssetDefinition[] {
  return assets;
}

export const MAX_SYMBOL_ALIAS_WORDS = 2;
