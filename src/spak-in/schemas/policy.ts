import { z } from "zod";
import { decimalString, errorSchema } from "./intent";

/** SPak Guard configuration. Every field is optional; absent means "no limit configured". */
export const policyConfigSchema = z.object({
  maxTransactionUsd: decimalString.optional(),
  dailyLimitUsd: decimalString.optional(),
  allowedNetworks: z.array(z.string()).optional(),
  /** Canonical asset ids ("base:0x..."). Symbols are not accepted as a match. */
  allowedAssets: z.array(z.string()).optional(),
  maxSlippageBps: z.number().int().min(1).max(5000).default(100),
  recipientMode: z.enum(["ANY", "APPROVED_ONLY"]).default("ANY"),
  approvedRecipients: z.array(z.string()).default([]),
  /** Above this USD value, always ask for manual approval, even in autonomous mode. */
  manualApprovalAboveUsd: decimalString.optional(),
  autonomous: z.object({
    enabled: z.boolean().default(false),
    maxTransactionUsd: decimalString.optional(),
    allowedIntentTypes: z.array(z.string()).default([]),
  }).default({}),
});
export type PolicyConfig = z.infer<typeof policyConfigSchema>;
export type PolicyConfigInput = z.input<typeof policyConfigSchema>;

/** Live numbers the policy engine needs. Supplied by the caller; SPak-in never fetches them itself. */
export const policyRuntimeSchema = z.object({
  spentTodayUsd: decimalString.default("0"),
  /** USD price per unit, keyed by canonical asset id. */
  pricesUsd: z.record(decimalString).default({}),
});
export type PolicyRuntime = z.infer<typeof policyRuntimeSchema>;

export const policyDecisionSchema = z.object({
  outcome: z.enum(["ALLOW_AUTONOMOUS", "REQUIRE_APPROVAL", "DENY"]),
  reasons: z.array(z.string()),
  violations: z.array(errorSchema),
  valueUsd: decimalString.nullable(),
});
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
