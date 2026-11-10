import { err, type SpakError } from "../errors/codes";
import { addDecimal, compareDecimal, mulDecimal } from "../lib/decimal";
import type { AssetDefinition } from "../registries/assets";
import type { AccessMode, AmountSpec, Recipient } from "../schemas/intent";
import type { PolicyConfig, PolicyDecision, PolicyRuntime } from "../schemas/policy";

export interface PolicyInput {
  intentType: string;
  mode: AccessMode;
  sourceNetwork: string | null;
  destNetwork: string | null;
  sourceAsset: AssetDefinition | null;
  destAsset: AssetDefinition | null;
  amount: AmountSpec | null;
  recipient: Recipient | null;
  slippageBps: number | null;
  /** True for recurring or triggered runs, which execute later without a person watching. */
  deferred: boolean;
}

const assetAllowed = (a: AssetDefinition, list: string[]) =>
  list.some((x) => x === a.id || x.toUpperCase() === a.symbol.toUpperCase());

/** USD value of the amount when it can be known exactly now. Null when it depends on balances or missing prices. */
export function valueUsd(amount: AmountSpec | null, asset: AssetDefinition | null, rt: PolicyRuntime): string | null {
  if (!amount) return null;
  if (amount.kind === "FIAT_VALUE") return amount.value;
  if (amount.kind !== "EXACT" || !asset) return null;
  const price = rt.pricesUsd[asset.id];
  return price ? mulDecimal(amount.value, price) : null;
}

/**
 * Policy Engine (SPak Guard). Decides: deny, ask the user, or allow autonomous execution.
 * Fails safe: anything it cannot verify needs a person to approve.
 */
export function evaluatePolicy(p: PolicyInput, cfg: PolicyConfig, rt: PolicyRuntime): PolicyDecision {
  const violations: SpakError[] = [];
  const reasons: string[] = [];

  for (const [n, label] of [[p.sourceNetwork, "source"], [p.destNetwork, "destination"]] as const) {
    if (n && cfg.allowedNetworks && !cfg.allowedNetworks.includes(n)) {
      violations.push(err("POLICY_NETWORK_NOT_ALLOWED", `Your Guard settings do not allow ${n} as a ${label} network.`, `${label}.network`));
    }
  }
  for (const [a, label] of [[p.sourceAsset, "source"], [p.destAsset, "destination"]] as const) {
    if (a && cfg.allowedAssets && !assetAllowed(a, cfg.allowedAssets)) {
      violations.push(err("POLICY_ASSET_NOT_ALLOWED", `Your Guard settings do not allow ${a.symbol}.`, `${label}.asset`));
    }
  }
  const slippage = p.slippageBps ?? cfg.maxSlippageBps;
  if (slippage > cfg.maxSlippageBps) {
    violations.push(err("POLICY_SLIPPAGE_EXCEEDED", `Requested slippage ${slippage / 100}% is above your ${cfg.maxSlippageBps / 100}% limit.`, "constraints.slippageBps"));
  }
  const external = p.recipient?.kind === "EXTERNAL";
  const approvedRecipient = !external || cfg.approvedRecipients.some((r) => r.toLowerCase() === p.recipient!.address.toLowerCase());
  if (external && cfg.recipientMode === "APPROVED_ONLY" && !approvedRecipient) {
    violations.push(err("POLICY_RECIPIENT_NOT_APPROVED", `${p.recipient!.address} is not on your approved recipient list.`, "recipient"));
  }

  const value = valueUsd(p.amount, p.sourceAsset, rt);
  const limited = !!(cfg.maxTransactionUsd || cfg.dailyLimitUsd);
  if (value !== null) {
    if (cfg.maxTransactionUsd && compareDecimal(value, cfg.maxTransactionUsd) > 0) {
      violations.push(err("POLICY_TX_LIMIT_EXCEEDED", `This is about $${value}, above your $${cfg.maxTransactionUsd} per-transaction limit.`, "source.amount"));
    }
    if (cfg.dailyLimitUsd && compareDecimal(addDecimal(rt.spentTodayUsd, value), cfg.dailyLimitUsd) > 0) {
      violations.push(err("POLICY_DAILY_LIMIT_EXCEEDED", `This would bring today's spending to $${addDecimal(rt.spentTodayUsd, value)}, above your $${cfg.dailyLimitUsd} daily limit.`, "source.amount"));
    }
  } else if (limited) {
    reasons.push("The USD value is not known yet, so spending limits are checked again at quote time and you must approve.");
  }

  if (violations.length) return { outcome: "DENY", reasons: violations.map((v) => v.message), violations, valueUsd: value };

  // Autonomous only when every condition holds. Otherwise a person approves.
  const auto = cfg.autonomous;
  const blockers: string[] = [];
  if (p.mode !== "AGENT") blockers.push("Manual Access always asks for your approval.");
  else if (!auto.enabled) blockers.push("Autonomous execution is off.");
  else {
    if (!auto.allowedIntentTypes.includes(p.intentType)) blockers.push(`Autonomous execution is not enabled for ${p.intentType}.`);
    if (value === null) blockers.push("The value is not known, so SPak will not act alone.");
    else {
      if (!auto.maxTransactionUsd) blockers.push("No autonomous spending limit is set.");
      else if (compareDecimal(value, auto.maxTransactionUsd) > 0) blockers.push(`$${value} is above your $${auto.maxTransactionUsd} autonomous limit.`);
      if (cfg.manualApprovalAboveUsd && compareDecimal(value, cfg.manualApprovalAboveUsd) > 0) blockers.push(`Transactions above $${cfg.manualApprovalAboveUsd} need manual approval.`);
    }
    if (external && !approvedRecipient) blockers.push("The recipient is not on your approved list.");
  }
  if (blockers.length) return { outcome: "REQUIRE_APPROVAL", reasons: [...reasons, ...blockers], violations: [], valueUsd: value };
  return { outcome: "ALLOW_AUTONOMOUS", reasons: [...reasons, p.deferred ? "Within your autonomous limits for each run." : "Within your autonomous limits."], violations: [], valueUsd: value };
}
