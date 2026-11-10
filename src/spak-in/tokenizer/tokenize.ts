import { addressFamilies, looksLikeBrokenAddress, looksLikeNameService } from "../validator/address";
import type { NetworkFamily } from "../registries/networks";

export type TokenKind = "word" | "number" | "percent" | "money" | "address" | "bad_address" | "name_service" | "punct";

export interface Token {
  index: number;
  raw: string;
  lower: string;
  kind: TokenKind;
  /** Decimal string for number, percent and money tokens. */
  value?: string;
  families?: NetworkFamily[];
}

const NUM = /^\d+(\.\d+)?$/;
const SUFFIX: Record<string, string> = { k: "1000", m: "1000000" };

function scale(value: string, factor: string): string {
  // value * factor with exact decimal string math (factor is a power of ten)
  const zeros = factor.length - 1;
  const [w, f = ""] = value.split(".");
  const shifted = (w + f.padEnd(zeros, "0")).replace(/^0+(?=\d)/, "");
  const rest = f.slice(zeros);
  return rest ? `${shifted}.${rest}` : shifted;
}

function classifyWord(raw: string, index: number): Token[] {
  const lower = raw.toLowerCase();
  const fam = addressFamilies(raw);
  if (fam.length) return [{ index, raw, lower, kind: "address", families: fam }];
  if (looksLikeNameService(raw)) return [{ index, raw, lower, kind: "name_service" }];
  if (looksLikeBrokenAddress(raw)) return [{ index, raw, lower, kind: "bad_address" }];

  let m: RegExpExecArray | null;
  if ((m = /^\$(\d+(?:\.\d+)?)([km])?$/i.exec(raw))) {
    const v = m[2] ? scale(m[1], SUFFIX[m[2].toLowerCase()]) : m[1];
    return [{ index, raw, lower, kind: "money", value: v }];
  }
  if ((m = /^(\d+(?:\.\d+)?)%$/.exec(raw))) return [{ index, raw, lower, kind: "percent", value: m[1] }];
  if ((m = /^(\d+(?:\.\d+)?)([km])$/i.exec(raw))) return [{ index, raw, lower, kind: "number", value: scale(m[1], SUFFIX[m[2].toLowerCase()]) }];
  if (NUM.test(raw)) return [{ index, raw, lower, kind: "number", value: raw }];
  // "50usdc" -> "50" "usdc". Addresses were handled above, so this never splits one.
  if ((m = /^(\d+(?:\.\d+)?)([a-zA-Z][a-zA-Z0-9.]{1,15})$/.exec(raw))) {
    return [{ index, raw: m[1], lower: m[1], kind: "number", value: m[1] }, ...classifyWord(m[2], index)];
  }
  return [{ index, raw, lower, kind: "word" }];
}

/** Split normalized text into typed tokens. Commas stay as clause separators. */
export function tokenize(normalized: string): Token[] {
  const out: Token[] = [];
  for (const piece of normalized.split(" ")) {
    if (!piece) continue;
    if (piece === "," || piece === ";") { out.push({ index: 0, raw: ",", lower: ",", kind: "punct" }); continue; }
    for (const t of classifyWord(piece, 0)) out.push(t);
  }
  // merge "25 %" / "25 percent" and "50 dollars|usd" (only when no ticker follows)
  const merged: Token[] = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i], next = out[i + 1];
    if (t.kind === "number" && next && (next.lower === "%" || next.lower === "percent" || next.lower === "pct")) {
      merged.push({ ...t, raw: `${t.raw}%`, lower: `${t.lower}%`, kind: "percent" }); i++; continue;
    }
    if (t.kind === "number" && next && /^(dollars?|bucks|usd)$/.test(next.lower) && !(out[i + 2]?.lower === "of")) {
      // "50 usd" is ambiguous with the USD stablecoin family only if a ticker follows; "50 dollars of eth" is money.
      if (next.lower !== "usd" || !out[i + 2] || ["of", "worth", "in"].includes(out[i + 2].lower)) {
        merged.push({ ...t, raw: `$${t.raw}`, kind: "money" }); i++; continue;
      }
    }
    if (t.kind === "number" && next && /^(dollars?|bucks)$/.test(next.lower)) {
      merged.push({ ...t, raw: `$${t.raw}`, kind: "money" }); i++; continue;
    }
    merged.push(t);
  }
  return merged.map((t, index) => ({ ...t, index }));
}
