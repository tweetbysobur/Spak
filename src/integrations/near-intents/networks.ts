import { IS_TESTNET } from "../../environment";

/** Mainnet: SPak canonical network ids to NEAR Intents 1Click blockchain codes. */
export const MAINNET_TO_ONECLICK: Readonly<Record<string, string>> = {
  ethereum: "eth", base: "base", arbitrum: "arb", optimism: "op", polygon: "pol", bsc: "bsc",
  avalanche: "avax", gnosis: "gnosis", near: "near", solana: "sol", bitcoin: "btc", tron: "tron",
  sui: "sui", xrp: "xrp", dogecoin: "doge", litecoin: "ltc", ton: "ton", stellar: "stellar", aptos: "aptos",
};

/** Testnet: SPak testnet network ids to Tidepool blockchain codes (Tidepool reuses the 1Click codes for its testnets). */
export const TESTNET_TO_TIDEPOOL: Readonly<Record<string, string>> = {
  "base-sepolia": "base", "arbitrum-sepolia": "arb", "ethereum-sepolia": "eth", "bsc-testnet": "bsc",
};

/** The mapping for this build's environment. Never both. */
export const SPAK_TO_ONECLICK: Readonly<Record<string, string>> = IS_TESTNET ? TESTNET_TO_TIDEPOOL : MAINNET_TO_ONECLICK;

export const ONECLICK_TO_SPAK: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SPAK_TO_ONECLICK).map(([k, v]) => [v, k]),
);
