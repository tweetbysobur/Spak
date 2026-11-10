import { TX_INTENT_TYPES } from "../classifier/transaction-type";
import type { Draft } from "../context/draft";
import { hashObject } from "../lib/hash";
import { getNetwork } from "../registries/networks";
import type { ExecutionPlan, Leg, PlanStep } from "../schemas/plan";
import type { PolicyDecision } from "../schemas/policy";
import type { Validation } from "../validator/validator";

export interface PlanInput {
  intentId: string;
  draft: Draft;
  validation: Validation;
  policy: PolicyDecision | null;
  defaultSlippageBps: number;
}

const name = (n: string) => getNetwork(n)?.name ?? n;

function amountText(l: Leg, symbol: string): string {
  const a = l.amount;
  return a.kind === "EXACT" ? `${a.value} ${symbol}` : a.kind === "PERCENT_OF_BALANCE" ? `${a.percent}% of your ${symbol} balance` : `$${a.value} of ${symbol}`;
}

/** Content that an approval binds to. planId and hash are derived from it, so equal plans get equal ids. */
export function planHash(p: Omit<ExecutionPlan, "planId" | "hash">): string {
  return hashObject(p);
}

/**
 * Execution Planner: validated intent in, provider-neutral plan out.
 * It never executes, signs or calls a provider. SPak Execution consumes the plan.
 */
export function buildPlan(input: PlanInput): ExecutionPlan {
  const { draft: d, validation: v, policy } = input;
  const type = v.intentType;
  const txType = TX_INTENT_TYPES.has(type) ? type : v.innerType;
  const moving = !!txType && (TX_INTENT_TYPES.has(type) || (d.verb !== null && type !== "CANCEL_TRANSACTION"));
  const legs: Leg[] = [];
  if (moving && v.sourceAsset && v.destAsset && v.recipient && v.refundAddress && d.amount) {
    legs.push({
      sourceNetwork: v.sourceAsset.network, sourceAssetId: v.sourceAsset.id,
      destinationNetwork: v.destAsset.network, destinationAssetId: v.destAsset.id,
      amount: d.amount, recipient: v.recipient.address, refundAddress: v.refundAddress,
    });
  }

  const requires = new Set<ExecutionPlan["requires"][number]>();
  if (d.amount?.kind === "PERCENT_OF_BALANCE") requires.add("BALANCES");
  if (d.amount?.kind === "FIAT_VALUE") requires.add("PRICE_FEED");
  if (type === "SCHEDULED_TRANSACTION") requires.add("SCHEDULER");
  if (type === "CONDITIONAL_TRANSACTION") requires.add("CONDITION_MONITOR");
  if (d.condition?.kind === "PRICE") requires.add("PRICE_FEED");
  if (type === "PORTFOLIO_QUERY") requires.add("BALANCES");
  if (type === "PORTFOLIO_REBALANCE") { requires.add("BALANCES"); requires.add("PRICE_FEED"); }
  if (["TRANSACTION_STATUS", "TRANSACTION_HISTORY", "CANCEL_TRANSACTION"].includes(type)) requires.add("TRANSACTION_LOOKUP");

  const autonomous = policy?.outcome === "ALLOW_AUTONOMOUS";
  const readOnly = ["PORTFOLIO_QUERY", "TRANSACTION_STATUS", "TRANSACTION_HISTORY"].includes(type);
  const notifyOnly = type === "CONDITIONAL_TRANSACTION" && d.condition?.onTrigger === "NOTIFY" && legs.length === 0;
  const approvalRequired = readOnly || notifyOnly ? false : !autonomous;

  const steps: Omit<PlanStep, "order">[] = [];
  const add = (action: PlanStep["action"], actor: PlanStep["actor"], description: string) => steps.push({ action, actor, description });
  const leg = legs[0];
  if (type === "SCHEDULED_TRANSACTION") add("REGISTER_SCHEDULE", "SPAK", `Register the schedule (${d.schedule?.raw}). Each run follows the steps below.`);
  if (type === "CONDITIONAL_TRANSACTION") add("REGISTER_CONDITION", "SPAK", `Watch for: ${d.condition?.raw}.`);
  if (leg && v.sourceAsset && v.destAsset) {
    if (d.amount?.kind !== "EXACT") add("RESOLVE_AMOUNT", "SPAK", `Turn ${amountText(leg, v.sourceAsset.symbol)} into an exact amount from live ${d.amount?.kind === "FIAT_VALUE" ? "prices" : "balances"}.`);
    add("QUOTE", "PROVIDER", `Quote ${amountText(leg, v.sourceAsset.symbol)} on ${name(leg.sourceNetwork)} to ${v.destAsset.symbol} on ${name(leg.destinationNetwork)}.`);
    add("REVIEW", "SPAK", "Show amounts, fees, slippage, recipient and timing.");
    if (approvalRequired) add("USER_APPROVAL", "USER_WALLET", "Wait for your explicit approval.");
    add("DEPOSIT", "USER_WALLET", `Your wallet signs and sends the deposit on ${name(leg.sourceNetwork)}. SPak never holds keys.`);
    add("SETTLE", "PROVIDER", `Settle and deliver ${v.destAsset.symbol} to ${leg.recipient} on ${name(leg.destinationNetwork)}.`);
    add("VERIFY", "SPAK", "Confirm delivery on the destination network before reporting success.");
  } else if (notifyOnly) {
    add("REVIEW", "SPAK", "Send you a notification when the condition is met. No funds move.");
  }
  if (type === "PORTFOLIO_QUERY") add("READ_PORTFOLIO", "SPAK", "Read balances for your connected wallets.");
  if (type === "PORTFOLIO_REBALANCE") {
    add("READ_PORTFOLIO", "SPAK", "Read balances and prices.");
    add("COMPUTE_REBALANCE", "SPAK", `Compute the swaps needed to reach ${d.allocations?.map((a) => `${a.percent}% ${a.symbol}`).join(", ")}.`);
    add("REVIEW", "SPAK", "Show each proposed swap for review.");
    add("USER_APPROVAL", "USER_WALLET", "Wait for your approval of the whole set.");
  }
  if (type === "TRANSACTION_STATUS") add("READ_TRANSACTIONS", "SPAK", `Look up ${v.target?.resolvedId ?? "the transaction"} and its on-chain status.`);
  if (type === "TRANSACTION_HISTORY") add("READ_TRANSACTIONS", "SPAK", "List your transactions, newest first.");
  if (type === "CANCEL_TRANSACTION") {
    add("USER_APPROVAL", "USER_WALLET", "Confirm the cancellation.");
    add("CANCEL", "SPAK", `Cancel ${v.target?.ref === "ALL_PENDING" ? "all pending transactions" : v.target?.resolvedId}. Deposits already sent cannot be recalled.`);
  }

  const body: Omit<ExecutionPlan, "planId" | "hash"> = {
    intentId: input.intentId,
    intentType: type,
    executable: legs.length === 1 && d.amount?.kind === "EXACT" && TX_INTENT_TYPES.has(type),
    requires: [...requires].sort(),
    legs,
    steps: steps.map((s, i) => ({ ...s, order: i + 1 })),
    constraints: { slippageBps: d.constraints.slippageBps ?? input.defaultSlippageBps, minOutput: d.constraints.minOutput },
    schedule: d.schedule,
    condition: d.condition,
    target: v.target,
    executionMode: autonomous ? "AUTONOMOUS" : "MANUAL",
    approvalRequired,
  };
  const hash = planHash(body);
  return { planId: `spak_plan_${hash.slice(0, 16)}`, hash, ...body };
}
