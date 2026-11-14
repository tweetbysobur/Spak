import { compareDecimal, isDecimal } from "../spak-in/lib/decimal";
import { PRICE_POLICY } from "./feeds";

/** A price reading from one source, as integers. price = answer / 10^decimals USD per whole token. */
export interface PriceReading {
  source: "CHAINLINK" | "COINGECKO";
  ref: string; // feed address or CoinGecko id
  answer: bigint;
  decimals: number;
  updatedAt: number; // unix seconds
  stable: boolean;
  roundId?: string;
}

export type ValuationStatus = "OK" | "UNAVAILABLE" | "REJECTED";
export interface Valuation {
  status: ValuationStatus;
  /** The USD value SPak uses for limits: never lower than its own price, never lower than the provider's. Null unless OK. */
  usd: string | null;
  spakUsd: string | null;
  providerUsd: string | null;
  deviationBps: number | null;
  reasons: string[];
  reading: (Omit<PriceReading, "answer"> & { answer: string }) | null;
  at: string;
}

const pow10 = (n: number) => 10n ** BigInt(n);
/** amount (base units) * answer / 10^(tokenDecimals + feedDecimals), as a USD decimal with D places, rounded UP. */
export function usdValue(amountUnits: bigint, tokenDecimals: number, r: Pick<PriceReading, "answer" | "decimals">, places: number = PRICE_POLICY.usdDecimals): string {
  const num = amountUnits * r.answer * pow10(places);
  const den = pow10(tokenDecimals + r.decimals);
  const q = (num + den - 1n) / den;
  const s = q.toString().padStart(places + 1, "0");
  return `${s.slice(0, -places)}.${s.slice(-places)}`;
}
/** Decimal string to integer micro-units (6 places), truncating. Null if not a plain decimal. */
function micro(v: string): bigint | null {
  if (!isDecimal(v)) return null;
  const [i, f = ""] = v.split(".");
  return BigInt(i) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

/**
 * Pure valuation decision. Inputs come from SPak's own price reading and the provider's quote; nothing else.
 * - No reading: UNAVAILABLE (fail closed: limits cannot be checked, so nothing is approved).
 * - Stale, non-positive or malformed reading: UNAVAILABLE.
 * - Stablecoin off peg by more than the band: REJECTED.
 * - Provider USD disagreeing with SPak's value by more than the limit: REJECTED (manipulation or error).
 * - CoinGecko-only assets additionally need the provider's value to be present and agree.
 * The value used is the higher of SPak's and the provider's, so a lowballed provider value can never raise headroom.
 */
export function valuate(a: { amountUnits: string; tokenDecimals: number; providerUsd: string | null; reading: PriceReading | null; now: Date; maxAgeSec: number }): Valuation {
  const at = a.now.toISOString();
  const providerUsd = a.providerUsd && isDecimal(a.providerUsd) ? a.providerUsd : null;
  const malformed = !!a.providerUsd && !providerUsd;
  const base = { providerUsd, at, reading: a.reading ? { ...a.reading, answer: a.reading.answer.toString() } : null };
  const fail = (status: ValuationStatus, reason: string, extra: Partial<Valuation> = {}): Valuation => ({ status, usd: null, spakUsd: null, deviationBps: null, reasons: [reason], ...base, ...extra });
  const r = a.reading;
  if (!/^\d+$/.test(a.amountUnits)) return fail("UNAVAILABLE", "The amount is not an integer number of base units.");
  // A provider value that is present but not a plain number is treated as a disagreement, never ignored.
  if (malformed) return fail("REJECTED", `The provider's USD value "${String(a.providerUsd).slice(0, 40)}" is not a plain number. Quote refused.`);
  if (!r) return fail("UNAVAILABLE", "SPak has no independent price for this asset, so its USD value cannot be checked.");
  if (r.answer <= 0n || !Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 36) return fail("UNAVAILABLE", "The price reading is invalid.");
  const age = Math.floor(a.now.getTime() / 1000) - r.updatedAt;
  if (age > a.maxAgeSec) return fail("UNAVAILABLE", `The price reading is ${age} s old, older than the ${a.maxAgeSec} s limit.`);
  if (age < -300) return fail("UNAVAILABLE", "The price reading is timestamped in the future.");
  if (r.stable) {
    const one = pow10(r.decimals);
    const off = r.answer > one ? r.answer - one : one - r.answer;
    if (off * 10_000n > one * BigInt(PRICE_POLICY.depegBps)) {
      return fail("REJECTED", `The stablecoin is off its $1 peg (price ${usdValue(pow10(0), 0, r, 4)}). Transfers are refused until it recovers.`);
    }
  }
  const spakUsd = usdValue(BigInt(a.amountUnits), a.tokenDecimals, r);
  // Stablecoins are never valued below $1 for limits (conservative).
  const floorUsd = r.stable ? usdValue(BigInt(a.amountUnits), a.tokenDecimals, { answer: 1n, decimals: 0 }) : spakUsd;
  const spak = compareDecimal(floorUsd, spakUsd) > 0 ? floorUsd : spakUsd;
  let deviationBps: number | null = null;
  if (providerUsd) {
    const p = micro(providerUsd)!, s = micro(spak)!;
    if (s === 0n) return fail("UNAVAILABLE", "The amount is too small to value.", { spakUsd: spak });
    const diff = p > s ? p - s : s - p;
    deviationBps = Number((diff * 10_000n) / s);
    if (deviationBps > PRICE_POLICY.maxDeviationBps) {
      return fail("REJECTED", `The provider values this at $${providerUsd}, ${(deviationBps / 100).toFixed(2)}% away from SPak's independent $${spak}. Quote refused.`, { spakUsd: spak, deviationBps });
    }
  } else if (r.source === "COINGECKO") {
    return fail("UNAVAILABLE", "Only one off-chain price is available for this asset and the provider gave none to compare. Value not established.", { spakUsd: spak });
  }
  const usd = providerUsd && compareDecimal(providerUsd, spak) > 0 ? providerUsd : spak;
  return { status: "OK", usd, spakUsd: spak, deviationBps, reasons: [], ...base };
}
