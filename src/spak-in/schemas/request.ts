import { z } from "zod";
import { accessModeSchema } from "./intent";
import { policyConfigSchema, policyRuntimeSchema } from "./policy";

export const MAX_INPUT_LENGTH = 500;

export const pendingTransactionSchema = z.object({
  id: z.string(),
  intentType: z.string(),
  state: z.string(),
  createdAt: z.string(),
  summary: z.string().optional(),
});
export type PendingTransaction = z.infer<typeof pendingTransactionSchema>;

/** Everything SPak-in needs for one instruction. All of it is supplied by the caller. */
export const interpretRequestSchema = z.object({
  text: z.string(),
  sessionId: z.string().min(1).max(100).optional(),
  userId: z.string().min(1).max(100).optional(),
  mode: accessModeSchema.default("MANUAL"),
  /** Addresses the user controls, by canonical network id. Used for SELF recipients and refunds. */
  wallets: z.record(z.string()).default({}),
  /** IANA zone, e.g. "Africa/Lagos". Needed to schedule anything with a clock time. */
  timezone: z.string().optional(),
  /** Reference time for relative dates ("tomorrow"). Injected for determinism. */
  now: z.string().datetime().optional(),
  transactions: z.array(pendingTransactionSchema).default([]),
  policy: policyConfigSchema.default({}),
  runtime: policyRuntimeSchema.default({}),
});
export type InterpretRequest = z.infer<typeof interpretRequestSchema>;
export type InterpretRequestInput = z.input<typeof interpretRequestSchema>;
