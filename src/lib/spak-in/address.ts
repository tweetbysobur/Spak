import { NETWORKS } from "./catalog";
import type { NetworkId } from "./types";

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_NAMED = /^(?=.{2,64}$)([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*\.(near|tg)$/;
const NEAR_IMPLICIT = /^[a-f0-9]{64}$/;
const BTC = /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

/** True if a word looks like any supported wallet address. Used for slot detection. */
export function looksLikeAddress(word: string): boolean {
  return EVM.test(word) || NEAR_NAMED.test(word) || NEAR_IMPLICIT.test(word) || BTC.test(word) ||
    (SOLANA.test(word) && /[0-9]/.test(word) && /[A-Z]/.test(word));
}

/** Format check for a recipient on a given network. Returns undefined when the format is unknown to SPak-in. */
export function isValidAddressFor(network: NetworkId, address: string): boolean | undefined {
  const family = NETWORKS[network]?.family;
  switch (family) {
    case "evm": return EVM.test(address);
    case "solana": return SOLANA.test(address);
    case "near": return NEAR_NAMED.test(address) || NEAR_IMPLICIT.test(address);
    case "btc": return BTC.test(address);
    default: return undefined;
  }
}
