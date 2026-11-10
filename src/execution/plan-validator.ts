import { planHash } from "../spak-in/planner/execution-planner";
import { executionPlanSchema, type ExecutionPlan, type Leg } from "../spak-in/schemas/plan";
import { getNetwork } from "../spak-in/registries/networks";
import { isAddressFor } from "../spak-in/validator/address";
import { isDecimal, isZero } from "../spak-in/lib/decimal";
import { ExecutionError } from "./errors";

/** A plan as SPak-in recorded it: owner, intent and revision come from the server's intent log. */
export interface IssuedPlan {
  plan: ExecutionPlan;
  userId: string | null;
  intentId: string;
  revision: number;
  latestRevision: number;
  recipientKind: "SELF" | "EXTERNAL" | null;
}

export interface PlanStore {
  findIssued(planHash: string): Promise<IssuedPlan | null>;
}

export interface VerifiedWallet {
  family: "evm" | "solana" | "near";
  address: string;
  networks: { id: string; enabled: boolean }[];
}

export interface ValidatedPlan {
  plan: ExecutionPlan;
  leg: Leg & { amount: { kind: "EXACT"; value: string } };
  intentId: string;
  revision: number;
  recipientKind: "SELF" | "EXTERNAL";
}

const owns = (wallets: VerifiedWallet[], network: string, address: string) => {
  const fam = getNetwork(network)?.family;
  return wallets.some((w) => w.family === fam && w.networks.some((n) => n.id === network && n.enabled)
    && (fam === "solana" ? w.address === address : w.address.toLowerCase() === address.toLowerCase()));
};

/**
 * Execution Plan Validator. The plan is looked up by hash in the server's own record of what SPak-in issued,
 * so nothing about it is taken from the browser. Checks, in order:
 * issued by SPak-in, owned by this user, latest revision, untampered, executable, exact amount,
 * manual approval mode, supported networks, address formats, and wallet ownership.
 */
export async function validateExecutionPlan(args: { planHash: string; userId: string; wallets: VerifiedWallet[]; store: PlanStore }): Promise<ValidatedPlan> {
  if (!/^[0-9a-f]{64}$/.test(args.planHash)) throw new ExecutionError("BAD_REQUEST", "planHash must be a 64-character hex string.");
  const issued = await args.store.findIssued(args.planHash);
  if (!issued) throw new ExecutionError("PLAN_NOT_FOUND", "SPak-in did not issue this plan. Interpret the instruction again.");
  if (issued.userId !== args.userId) throw new ExecutionError("PLAN_NOT_OWNED", "SPak-in did not issue this plan. Interpret the instruction again.");
  if (issued.revision !== issued.latestRevision) {
    throw new ExecutionError("PLAN_SUPERSEDED", "This plan was changed by a later message. Use the latest version.");
  }

  const parsed = executionPlanSchema.safeParse(issued.plan);
  if (!parsed.success) throw new ExecutionError("PLAN_TAMPERED", "The stored plan is malformed.");
  const plan = parsed.data;
  const { planId: _id, hash, ...body } = plan;
  if (hash !== args.planHash || planHash(body) !== hash || plan.planId !== `spak_plan_${hash.slice(0, 16)}`) {
    throw new ExecutionError("PLAN_TAMPERED", "The plan does not match its hash.");
  }
  if (!plan.executable || plan.legs.length !== 1) {
    throw new ExecutionError("PLAN_NOT_EXECUTABLE", `This plan needs ${plan.requires.join(", ").toLowerCase() || "more information"} before it can execute.`);
  }
  if (plan.executionMode !== "MANUAL" || !plan.approvalRequired) {
    throw new ExecutionError("AUTONOMY_DISABLED", "Autonomous execution is not enabled. Every execution needs your approval.");
  }

  const leg = plan.legs[0];
  if (leg.amount.kind !== "EXACT" || !isDecimal(leg.amount.value) || isZero(leg.amount.value)) {
    throw new ExecutionError("INVALID_AMOUNT", "Execution needs an exact amount greater than zero.");
  }
  for (const [n, addr, label] of [[leg.sourceNetwork, leg.refundAddress, "refund"], [leg.destinationNetwork, leg.recipient, "recipient"]] as const) {
    const net = getNetwork(n);
    if (!net) throw new ExecutionError("UNSUPPORTED_NETWORK", `Network ${n} is not supported.`);
    if (!isAddressFor(net.family, addr)) throw new ExecutionError("PLAN_TAMPERED", `The ${label} address is not valid on ${net.name}.`);
  }

  // Refunds must go to a wallet the user proved they own, enabled on the source network.
  if (!owns(args.wallets, leg.sourceNetwork, leg.refundAddress)) {
    throw new ExecutionError("WALLET_NOT_VERIFIED", "The refund address is not one of your verified wallets on the source network. Interpret the instruction again.");
  }
  const recipientKind = issued.recipientKind ?? (owns(args.wallets, leg.destinationNetwork, leg.recipient) ? "SELF" : "EXTERNAL");
  // A delivery to "your wallet" must still be your verified wallet now (it may have been disconnected).
  if (recipientKind === "SELF" && !owns(args.wallets, leg.destinationNetwork, leg.recipient)) {
    throw new ExecutionError("WALLET_NOT_VERIFIED", "The receiving wallet is no longer one of your verified wallets. Interpret the instruction again.");
  }
  return { plan, leg: leg as ValidatedPlan["leg"], intentId: issued.intentId, revision: issued.revision, recipientKind };
}
