import { z } from "zod";
import { amountSpecSchema, conditionSchema, constraintsSchema, executionModeSchema, scheduleSchema, targetSchema } from "./intent";

export const PLAN_STEP_ACTIONS = [
  "RESOLVE_AMOUNT", "QUOTE", "REVIEW", "USER_APPROVAL", "DEPOSIT", "SETTLE", "VERIFY",
  "REGISTER_SCHEDULE", "REGISTER_CONDITION", "READ_PORTFOLIO", "READ_TRANSACTIONS", "COMPUTE_REBALANCE", "CANCEL",
] as const;

export const planStepSchema = z.object({
  order: z.number().int().positive(),
  action: z.enum(PLAN_STEP_ACTIONS),
  description: z.string(),
  /** Who performs the step. SPak-in never signs; the user's wallet does. */
  actor: z.enum(["SPAK", "PROVIDER", "USER_WALLET"]),
});
export type PlanStep = z.infer<typeof planStepSchema>;

/** One movement of value. Provider-neutral: canonical ids only. */
export const legSchema = z.object({
  sourceNetwork: z.string(),
  sourceAssetId: z.string(),
  destinationNetwork: z.string(),
  destinationAssetId: z.string(),
  amount: amountSpecSchema,
  recipient: z.string(),
  refundAddress: z.string(),
});
export type Leg = z.infer<typeof legSchema>;

export const PLAN_REQUIREMENTS = ["BALANCES", "PRICE_FEED", "SCHEDULER", "CONDITION_MONITOR", "TRANSACTION_LOOKUP"] as const;

export const executionPlanSchema = z.object({
  planId: z.string(),
  intentId: z.string(),
  intentType: z.string(),
  /** True when SPak Execution can quote this plan right now. */
  executable: z.boolean(),
  requires: z.array(z.enum(PLAN_REQUIREMENTS)),
  legs: z.array(legSchema),
  steps: z.array(planStepSchema),
  constraints: constraintsSchema.extend({ slippageBps: z.number().int().positive() }),
  schedule: scheduleSchema.nullable(),
  condition: conditionSchema.nullable(),
  target: targetSchema.nullable(),
  executionMode: executionModeSchema,
  approvalRequired: z.boolean(),
  /** sha256 over the plan content. A user approval binds to this hash. */
  hash: z.string(),
});
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
