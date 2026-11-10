import type { NetworkFamily } from "../registries/networks";

const B58 = "[1-9A-HJ-NP-Za-km-z]";
const PATTERNS: Record<NetworkFamily, RegExp[]> = {
  evm: [/^0x[0-9a-fA-F]{40}$/],
  solana: [new RegExp(`^${B58}{32,44}$`)],
  near: [/^(?=.{2,64}$)([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*\.(near|tg)$/, /^[0-9a-f]{64}$/, /^0x[0-9a-f]{40}$/],
  bitcoin: [/^bc1[02-9ac-hj-np-z]{11,71}$/, new RegExp(`^[13]${B58}{25,34}$`)],
  tron: [new RegExp(`^T${B58}{33}$`)],
  sui: [/^0x[0-9a-fA-F]{64}$/],
  aptos: [/^0x[0-9a-fA-F]{64}$/],
  xrp: [/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/],
  dogecoin: [new RegExp(`^[DA9]${B58}{25,34}$`)],
  litecoin: [new RegExp(`^[LM3]${B58}{26,33}$`), /^ltc1[02-9ac-hj-np-z]{11,71}$/],
  ton: [/^[EU]Q[A-Za-z0-9_-]{46}$/, /^-?\d:[0-9a-fA-F]{64}$/],
  stellar: [/^G[A-Z2-7]{55}$/],
};

const FAMILIES = Object.keys(PATTERNS) as NetworkFamily[];

/** Families whose address format this string matches. Empty when it is not an address. */
export function addressFamilies(s: string): NetworkFamily[] {
  // Base58 strings that are plain words (no digits, all lower) are not addresses.
  return FAMILIES.filter((f) => PATTERNS[f].some((re) => re.test(s))).filter(
    (f) => !(f === "solana" && !/\d/.test(s)),
  );
}

export function isAddressFor(family: NetworkFamily, s: string): boolean {
  return PATTERNS[family].some((re) => re.test(s));
}

/** Looks like someone tried to write an address but it is malformed or truncated. */
export function looksLikeBrokenAddress(s: string): boolean {
  if (addressFamilies(s).length) return false;
  return /^0x[0-9a-fA-F….]+$/.test(s) || /^0x$/.test(s) || /^(bc1|ltc1)[a-z0-9]{3,}$/.test(s) || /…/.test(s);
}

/** ENS, SNS and similar names. SPak-in does not resolve names; it asks for the address. */
export function looksLikeNameService(s: string): boolean {
  return /^[a-z0-9-]+\.(eth|sol|base\.eth|crypto|nft|x|bnb|arb)$/i.test(s);
}
