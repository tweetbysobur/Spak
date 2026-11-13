import { addDecimal, compareDecimal, isDecimal } from "../spak-in/lib/decimal";
import { getNetwork } from "../spak-in/registries/networks";
import { getAsset } from "../spak-in/registries/assets";
import type { GuardDecision, GuardOutcome, GuardPolicy, GuardStage, GuardSubject, RuleResult, Spending } from "./types";

const netName = (id: string) => getNetwork(id)?.name ?? id;
const assetName = (id: string) => { const a = getAsset(id); return a ? `${a.symbol} on ${netName(a.network)}` : id; };
const usd = (v: string) => `$${v}`;

/** Address comparison for a network: EVM addresses are case-insensitive, everything else is exact. */
export function sameAddress(network: string, a: string, b: string): boolean {
  return getNetwork(network)?.family === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * USD amount from a provider string such as "50.0" or "50.01 USD". Null when it is not a plain number: anything
 * after the number other than a unit word ("1,234.56", "1.2e3") is refused rather than truncated to a smaller value.
 */
export function cleanUsd(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)(?:\s+[A-Za-z]+)?\s*$/.exec(v);
  return m && isDecimal(m[1]) ? m[1] : null;
}

/** Slippage implied by a quote, (amountOut - minAmountOut) / amountOut, in basis points rounded down. For messages only. */
export function impliedSlippageBps(amountOut: string, minAmountOut: string): number | null {
  if (!/^\d+$/.test(amountOut) || !/^\d+$/.test(minAmountOut)) return null;
  const out = BigInt(amountOut), min = BigInt(minAmountOut);
  if (out <= 0n) return null;
  if (min >= out) return 0;
  return Number(((out - min) * 10_000n) / out);
}

/**
 * Does the quote's minimum output stay within `maxBps` of its expected output? Exact integer math, with the same
 * one-base-unit rounding allowance the quote validator uses for the provider's own floor. Null when unreadable.
 */
export function quoteWithinSlippage(amountOut: string, minAmountOut: string, maxBps: number): boolean | null {
  if (!/^\d+$/.test(amountOut) || !/^\d+$/.test(minAmountOut)) return null;
  const out = BigInt(amountOut), min = BigInt(minAmountOut);
  if (out <= 0n) return null;
  const floor = (out * BigInt(10_000 - maxBps)) / 10_000n;
  return min + 1n >= floor;
}

/** The per-transfer limit that applies: the user's own limit when it is lower than the platform ceiling, else the ceiling. */
export function effectiveMaxUsd(p: GuardPolicy, ceilingUsd: string): string {
  const own = p.limits.maxTransactionUsd;
  return own && compareDecimal(own, ceilingUsd) < 0 ? own : ceilingUsd;
}

const PRE_APPROVAL: GuardStage[] = ["PLAN", "QUOTE", "FIRM_QUOTE", "APPROVAL"];

/**
 * The Guard policy engine. Pure and deterministic: the same policy, subject, spending, stage, ceiling and time
 * always give the same decision. No network, no database, no model.
 *
 * Fails closed: a missing policy is NEEDS_CONFIGURATION, an unknown USD value blocks at every quote-based stage, and
 * a network without a rule needs configuration rather than being allowed.
 */
export function evaluateGuard(args: {
  policy: GuardPolicy | null; subject: GuardSubject; spending: Spending; stage: GuardStage; ceilingUsd: string; now: Date;
  /** APPROVAL only: Guard already checked this exact firm quote for this plan. Approval is bound to that check. */
  quoteChecked?: boolean;
}): GuardDecision {
  const { policy: p, subject: s, spending, stage, ceilingUsd } = args;
  const rules: RuleResult[] = [];
  const add = (rule: RuleResult["rule"], status: RuleResult["status"], reason: string) => rules.push({ rule, status, reason });

  if (!p) {
    add("POLICY", "NEEDS_CONFIGURATION", "Your Guard policy is not set up yet. Open Guard to set it up.");
    return finish(rules, stage, null, s, args.now);
  }
  add("POLICY", "PASS", `Policy version ${p.version}.`);

  // Emergency controls.
  if (p.executionDisabled) add("EXECUTION_DISABLED", "FAIL", "You turned off all execution in Guard. Turn it back on to continue.");
  else add("EXECUTION_DISABLED", "PASS", "Execution is on.");
  if (PRE_APPROVAL.includes(stage)) {
    if (p.status === "PAUSED") add("PAUSED", "FAIL", "Guard is paused, so SPak accepts no new transfers. Resume Guard to continue.");
    else add("PAUSED", "PASS", "Guard is active.");
  }

  // Networks: per direction, explicit. No rule means the user has not decided yet.
  for (const [rule, id, dir] of [["SOURCE_NETWORK", s.sourceNetwork, "source"], ["DESTINATION_NETWORK", s.destinationNetwork, "destination"]] as const) {
    const r = p.networks[id];
    if (!r) add(rule, "NEEDS_CONFIGURATION", `${netName(id)} has no Guard setting yet. Choose whether to allow it in Guard.`);
    else if (r.disabled) add(rule, "FAIL", `${netName(id)} is disabled in your Guard settings.`);
    else if (dir === "source" ? !r.allowSource : !r.allowDestination) add(rule, "FAIL", `Your Guard settings do not allow ${netName(id)} as a ${dir} network.`);
    else add(rule, "PASS", `${netName(id)} is allowed as a ${dir} network.`);
  }

  if (stage === "APPROVAL") {
    if (args.quoteChecked) add("QUOTE_CHECKED", "PASS", "Guard checked this exact quote before you reviewed it.");
    else add("QUOTE_CHECKED", "FAIL", "Guard has not checked this quote. Get a new quote and review it again.");
  }

  // Deposit stage: only the emergency controls and networks matter. Limits were reserved at approval.
  if (stage !== "DEPOSIT") {
    // Assets: canonical id only. A block always wins.
    const allowCount = Object.values(p.assets).filter((r) => r === "ALLOW").length;
    for (const [rule, id] of [["SOURCE_ASSET", s.sourceAssetId], ["DESTINATION_ASSET", s.destinationAssetId]] as const) {
      const r = p.assets[id];
      if (r === "BLOCK") add(rule, "FAIL", `${assetName(id)} is blocked in your Guard settings.`);
      else if (p.assetMode === "ALLOWLIST" && allowCount === 0) add(rule, "NEEDS_CONFIGURATION", "Your Guard token allowlist is empty. Add the tokens you use.");
      else if (p.assetMode === "ALLOWLIST" && r !== "ALLOW") add(rule, "FAIL", `${assetName(id)} is not on your Guard token allowlist.`);
      else add(rule, "PASS", `${assetName(id)} is allowed.`);
    }

    // Slippage: the requested tolerance and, once quoted, what the quote actually allows. Never raised to fit.
    if (s.slippageBps > p.maxSlippageBps) add("SLIPPAGE", "FAIL", `Slippage ${s.slippageBps / 100}% is above your ${p.maxSlippageBps / 100}% limit.`);
    else if (s.quote) {
      const { amountOut: out, minAmountOut: min } = s.quote;
      const within = out && min ? quoteWithinSlippage(out, min, p.maxSlippageBps) : null;
      const implied = out && min ? impliedSlippageBps(out, min) : null;
      if (within === null || implied === null) add("SLIPPAGE", "FAIL", "The quote's minimum output could not be checked against your slippage limit.");
      else if (!within) add("SLIPPAGE", "FAIL", `The quote allows about ${implied / 100}% slippage, above your ${p.maxSlippageBps / 100}% limit.`);
      else add("SLIPPAGE", "PASS", `The quote's minimum output is within your ${p.maxSlippageBps / 100}% limit.`);
    } else add("SLIPPAGE", "PASS", `Slippage ${s.slippageBps / 100}% is within your ${p.maxSlippageBps / 100}% limit.`);

    // Recipients: approval is per network. An address approved on another network does not count.
    if (s.recipientKind === "SELF") add("RECIPIENT", "PASS", "You are sending to your own wallet.");
    else if (p.recipientMode === "ANY") add("RECIPIENT", "PASS", "Any recipient is allowed.");
    else if (p.recipients.some((r) => r.network === s.destinationNetwork && sameAddress(r.network, r.address, s.recipient))) add("RECIPIENT", "PASS", "The recipient is on your approved list for this network.");
    else if (p.recipients.some((r) => sameAddress(r.network, r.address, s.recipient))) add("RECIPIENT", "FAIL", `This recipient is approved on another network, not on ${netName(s.destinationNetwork)}.`);
    else add("RECIPIENT", "FAIL", "This recipient is not on your approved list.");

    // Value and limits. The platform ceiling always applies and no setting can raise it.
    const max = effectiveMaxUsd(p, ceilingUsd);
    const v = s.valueUsd;
    if (v === null) {
      if (stage === "PLAN") add("VALUE_KNOWN", "NOT_APPLICABLE", "The USD value is not known before a quote. Limits are checked on the quote.");
      else add("VALUE_KNOWN", "FAIL", "The USD value of this transfer is not known, so Guard cannot check your limits.");
    } else {
      add("VALUE_KNOWN", "PASS", `About ${usd(v)}.`);
      add("MAX_TRANSACTION", compareDecimal(v, max) > 0 ? "FAIL" : "PASS",
        compareDecimal(v, max) > 0 ? `About ${usd(v)}, above your ${usd(max)} per-transfer limit.` : `Within the ${usd(max)} per-transfer limit.`);
      const min = p.limits.minTransactionUsd;
      if (min) add("MIN_TRANSACTION", compareDecimal(v, min) < 0 ? "FAIL" : "PASS", compareDecimal(v, min) < 0 ? `About ${usd(v)}, below your ${usd(min)} minimum.` : `Above the ${usd(min)} minimum.`);
      for (const [rule, limit, spent, label] of [
        ["DAILY_LIMIT", p.limits.dailyUsd, spending.dayUsd, "24 hours"], ["WEEKLY_LIMIT", p.limits.weeklyUsd, spending.weekUsd, "7 days"],
        ["MONTHLY_LIMIT", p.limits.monthlyUsd, spending.monthUsd, "30 days"],
      ] as const) {
        if (!limit) continue;
        const total = addDecimal(spent, v);
        add(rule, compareDecimal(total, limit) > 0 ? "FAIL" : "PASS", compareDecimal(total, limit) > 0
          ? `This would bring your spending in the last ${label} to ${usd(total)}, above your ${usd(limit)} limit.`
          : `${usd(total)} of your ${usd(limit)} limit for the last ${label}.`);
      }
    }
  }
  return finish(rules, stage, p.version, s, args.now);
}

function finish(rules: RuleResult[], stage: GuardStage, version: number | null, s: GuardSubject, now: Date): GuardDecision {
  const failed = rules.filter((r) => r.status === "FAIL");
  const config = rules.filter((r) => r.status === "NEEDS_CONFIGURATION");
  const outcome: GuardOutcome = failed.length ? "BLOCKED" : config.length ? "NEEDS_CONFIGURATION"
    : stage === "APPROVAL" || stage === "DEPOSIT" ? "ALLOWED" : "REQUIRES_APPROVAL";
  return {
    outcome, stage, rules, reasons: [...failed, ...config].map((r) => r.reason), policyVersion: version, valueUsd: s.valueUsd,
    planHash: s.planHash, quoteId: s.quoteId, executionId: s.executionId, evaluatedAt: now.toISOString(),
  };
}
