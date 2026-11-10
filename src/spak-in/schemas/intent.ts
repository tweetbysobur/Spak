import { z } from "zod";
import { ERROR_CODES } from "../errors/codes";

export const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "decimal string");

export const BUILTIN_INTENT_TYPES = [
  "SWAP", "CROSS_CHAIN_SWAP", "BRIDGE", "CROSS_CHAIN_TRANSFER", "PAYMENT",
  "PORTFOLIO_QUERY", "PORTFOLIO_REBALANCE", "SCHEDULED_TRANSACTION", "CONDITIONAL_TRANSACTION",
  "TRANSACTION_STATUS", "TRANSACTION_HISTORY", "CANCEL_TRANSACTION", "UNKNOWN",
] as const;
export type BuiltinIntentType = (typeof BUILTIN_INTENT_TYPES)[number];
/** Built-in types plus any registered through the intent registry. */
export type IntentType = BuiltinIntentType | (string & { readonly __custom?: never });
export const intentTypeSchema = z.string().min(1);

export const INTENT_STATUSES = ["VALIDATED", "NEEDS_CLARIFICATION", "INVALID", "UNSUPPORTED", "POLICY_REJECTED"] as const;
export const intentStatusSchema = z.enum(INTENT_STATUSES);
export type IntentStatus = z.infer<typeof intentStatusSchema>;

export const executionModeSchema = z.enum(["MANUAL", "AUTONOMOUS"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export const accessModeSchema = z.enum(["MANUAL", "AGENT"]);
export type AccessMode = z.infer<typeof accessModeSchema>;

export const amountSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EXACT"), value: decimalString }),
  z.object({ kind: z.literal("PERCENT_OF_BALANCE"), percent: decimalString }),
  z.object({ kind: z.literal("FIAT_VALUE"), value: decimalString, currency: z.literal("USD") }),
]);
export type AmountSpec = z.infer<typeof amountSpecSchema>;

export const assetRefSchema = z.object({
  symbol: z.string(),
  /** Canonical asset id "<network>:<contract|native>". Null until resolved against the registry. */
  id: z.string().nullable(),
  chainId: z.string().nullable(),
  decimals: z.number().int().nullable(),
  contract: z.string().nullable(),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

export const sourceSchema = z.object({
  network: z.string().nullable(),
  asset: assetRefSchema.nullable(),
  amount: amountSpecSchema.nullable(),
});
export const destinationSchema = z.object({
  network: z.string().nullable(),
  asset: assetRefSchema.nullable(),
});

export const recipientSchema = z.object({
  address: z.string(),
  network: z.string().nullable(),
  kind: z.enum(["EXTERNAL", "SELF"]),
});
export type Recipient = z.infer<typeof recipientSchema>;

export const scheduleSchema = z.object({
  type: z.enum(["ONCE", "RECURRING"]),
  frequency: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).nullable(),
  interval: z.number().int().positive(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  startAt: z.string().nullable(),
  timezone: z.string().nullable(),
  raw: z.string(),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const comparatorSchema = z.enum(["GTE", "LTE", "CROSSES"]);
export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PRICE"), symbol: z.string(), comparator: comparatorSchema, value: decimalString, currency: z.literal("USD"), onTrigger: z.enum(["EXECUTE", "NOTIFY"]), raw: z.string() }),
  z.object({ kind: z.literal("NETWORK_FEE"), network: z.string().nullable(), comparator: comparatorSchema, value: decimalString, unit: z.enum(["GWEI", "USD"]), onTrigger: z.enum(["EXECUTE", "NOTIFY"]), raw: z.string() }),
  z.object({ kind: z.literal("ROUTE_AVAILABLE"), onTrigger: z.enum(["EXECUTE", "NOTIFY"]), raw: z.string() }),
]);
export type Condition = z.infer<typeof conditionSchema>;

export const constraintsSchema = z.object({
  slippageBps: z.number().int().positive().nullable(),
  minOutput: z.object({ value: decimalString, symbol: z.string() }).nullable(),
});
export type Constraints = z.infer<typeof constraintsSchema>;

export const targetSchema = z.object({
  ref: z.enum(["LATEST", "LATEST_PENDING", "ID", "ALL_PENDING", "SCHEDULED"]),
  id: z.string().nullable(),
  resolvedId: z.string().nullable(),
});
export type Target = z.infer<typeof targetSchema>;

export const allocationSchema = z.object({ symbol: z.string(), percent: decimalString });
export type Allocation = z.infer<typeof allocationSchema>;

export const querySchema = z.object({ assets: z.array(z.string()), networks: z.array(z.string()) });

export const errorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  field: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export const clarificationSchema = z.object({
  field: z.string(),
  question: z.string(),
  options: z.array(z.string()).optional(),
});
export type Clarification = z.infer<typeof clarificationSchema>;
