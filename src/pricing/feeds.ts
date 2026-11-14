/**
 * SPak's independent price sources. Provider-reported USD values never authorise spending on their own.
 *
 * Primary: Chainlink price feeds on Ethereum mainnet, read with eth_call (latestRoundData, decimals, description).
 * Every address below was verified on 2026-11-14 by reading description() and decimals() on chain; the reader checks
 * description() again on every read, so a wrong or replaced address fails closed. Max age is the feed heartbeat plus a
 * margin (ETH, BTC, DAI, LINK: 1 h heartbeat; stablecoins, SOL, BNB, AVAX: 24 h heartbeat).
 *
 * Secondary: CoinGecko simple price, only for assets with no Chainlink feed here, and only when the provider's own
 * USD value agrees within the deviation limit (two independent sources must agree; one alone never authorises).
 *
 * Identity: an asset maps to a source by its registry symbol, on networks SPak supports, within the registry of this
 * build. Testnet test tokens are valued as their mainnet counterparts so limits behave the same; they have no value.
 */
export interface ChainlinkFeed { key: string; address: string; description: string; decimals: number; maxAgeSec: number; stable: boolean }

export const CHAINLINK_FEEDS: Readonly<Record<string, ChainlinkFeed>> = {
  ETH: { key: "ETH", address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", description: "ETH / USD", decimals: 8, maxAgeSec: 3_960, stable: false },
  BTC: { key: "BTC", address: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", description: "BTC / USD", decimals: 8, maxAgeSec: 3_960, stable: false },
  USDC: { key: "USDC", address: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", description: "USDC / USD", decimals: 8, maxAgeSec: 90_000, stable: true },
  USDT: { key: "USDT", address: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D", description: "USDT / USD", decimals: 8, maxAgeSec: 90_000, stable: true },
  DAI: { key: "DAI", address: "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9", description: "DAI / USD", decimals: 8, maxAgeSec: 3_960, stable: true },
  SOL: { key: "SOL", address: "0x4ffC43a60e009B551865A93d232E33Fce9f01507", description: "SOL / USD", decimals: 8, maxAgeSec: 90_000, stable: false },
  BNB: { key: "BNB", address: "0x14e613AC84a31f709eadbdF89C6CC390fDc9540A", description: "BNB / USD", decimals: 8, maxAgeSec: 90_000, stable: false },
  AVAX: { key: "AVAX", address: "0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7", description: "AVAX / USD", decimals: 8, maxAgeSec: 90_000, stable: false },
  LINK: { key: "LINK", address: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c", description: "LINK / USD", decimals: 8, maxAgeSec: 3_960, stable: false },
};

/** Registry symbol to Chainlink feed. Wrapped forms share the underlying feed (documented peg assumption). */
export const SYMBOL_TO_CHAINLINK: Readonly<Record<string, string>> = {
  ETH: "ETH", WETH: "ETH", BTC: "BTC", WBTC: "BTC", CBBTC: "BTC", USDC: "USDC", USDT: "USDT", DAI: "DAI",
  SOL: "SOL", WSOL: "SOL", BNB: "BNB", WBNB: "BNB", AVAX: "AVAX", WAVAX: "AVAX", LINK: "LINK",
};

/** Registry symbol to CoinGecko id, for assets without a Chainlink feed here. Needs provider agreement to be used. */
export const SYMBOL_TO_COINGECKO: Readonly<Record<string, string>> = {
  NEAR: "near", WNEAR: "near", XRP: "ripple", TRX: "tron", DOGE: "dogecoin", LTC: "litecoin", SUI: "sui", XLM: "stellar",
  APT: "aptos", TON: "the-open-network", POL: "polygon-ecosystem-token", XAUT: "tether-gold", ZEC: "zcash",
};

/** Valuation policy. Basis points; 10_000 = 100%. */
export const PRICE_POLICY = {
  /** Provider USD must agree with SPak's value within this, or the quote is rejected as a price disagreement. */
  maxDeviationBps: 300,
  /** A stablecoin outside this band around $1 is treated as depegged: transfers are refused. */
  depegBps: 200,
  /** CoinGecko reading must be at most this old. */
  coingeckoMaxAgeSec: 600,
  /** Readings are cached this long. */
  cacheMs: 30_000,
  /** Decimal places of stored USD values (rounded up: conservative for limits). */
  usdDecimals: 6,
} as const;
