import type { Token } from "../tokenizer/tokenize";
import {
  MAX_NETWORK_ALIAS_WORDS, lookupNetworkAlias, lookupNetworkSlotAlias, lookupUnsupportedNetwork,
} from "../registries/networks";
import { isStrongSymbolAlias, lookupSymbol } from "../registries/assets";

/** What one token position (or multi-word phrase starting there) could mean. */
export interface Lex {
  start: number;
  /** Exclusive. */
  end: number;
  network?: { id: string; strong: boolean };
  unsupportedNetwork?: string;
  asset?: { symbol: string; strong: boolean };
}

const NOT_TICKERS = new Set([
  "to", "on", "from", "my", "me", "the", "a", "an", "of", "and", "for", "in", "at", "it", "is", "be", "all", "every", "each",
  "swap", "send", "pay", "move", "bridge", "transfer", "into", "with", "via", "this", "that", "address", "wallet", "chain",
  "network", "balance", "show", "what", "when", "if", "once", "make", "use", "instead", "please", "now", "then", "cancel",
  "public", "safe", "link", "loud", "purge", "gram", "cow", "trump", "inx", "mog", "spx", "public", "abg", "fms", "tlo",
  "hapi", "cfi", "titn", "evaa", "jambo", "coca", "prl", "qtc", "itlx", "adi", "rhea", "npro", "aster", "pengu", "kaito",
]);

/**
 * Lexical pass. For each position, the longest phrase that names a network, unsupported network or asset.
 * Words like "sol" or "near" get both readings; the parser picks one from grammar.
 */
export function lexicon(tokens: Token[]): Map<number, Lex> {
  const out = new Map<number, Lex>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "word") continue;
    for (let n = Math.min(MAX_NETWORK_ALIAS_WORDS, tokens.length - i); n >= 1; n--) {
      const slice = tokens.slice(i, i + n);
      if (slice.some((t) => t.kind !== "word")) continue;
      const phrase = slice.map((t) => t.lower).join(" ");
      const lex: Lex = { start: i, end: i + n };
      const strongNet = lookupNetworkAlias(phrase);
      const weakNet = strongNet ? undefined : lookupNetworkSlotAlias(phrase);
      if (strongNet) lex.network = { id: strongNet, strong: true };
      else if (weakNet) lex.network = { id: weakNet, strong: false };
      const unsupported = lookupUnsupportedNetwork(phrase);
      if (unsupported && !lex.network) lex.unsupportedNetwork = unsupported;
      if (n <= 2) {
        const sym = lookupSymbol(phrase);
        const raw = slice.map((t) => t.raw).join(" ");
        if (sym && !(n === 1 && NOT_TICKERS.has(phrase) && !isStrongSymbolAlias(phrase))) {
          // Registry-only tickers count when written in capitals or with $; aliases always count.
          const strong = isStrongSymbolAlias(phrase) || raw === raw.toUpperCase() || raw.startsWith("$");
          lex.asset = { symbol: sym, strong };
        }
      }
      if (lex.network || lex.unsupportedNetwork || lex.asset) {
        out.set(i, lex);
        break;
      }
    }
  }
  return out;
}

export const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, sundays: 0, monday: 1, mon: 1, mondays: 1, tuesday: 2, tue: 2, tues: 2, tuesdays: 2,
  wednesday: 3, wed: 3, wednesdays: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, thursdays: 4,
  friday: 5, fri: 5, fridays: 5, saturday: 6, sat: 6, saturdays: 6,
};

export const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
