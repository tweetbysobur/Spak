import { z } from "zod";
import {
  allocationSchema, clarificationSchema, conditionSchema, constraintsSchema, destinationSchema, errorSchema,
  executionModeSchema, intentStatusSchema, intentTypeSchema, querySchema, recipientSchema, scheduleSchema,
  sourceSchema, targetSchema,
} from "./intent";
import { policyDecisionSchema } from "./policy";
import { executionPlanSchema } from "./plan";

export const intentResultSchema = z.object({
  intentId: z.string(),
  sessionId: z.string(),
  /** Increments each time a follow-up amends this intent. */
  revision: z.number().int().nonnegative(),
  intentType: intentTypeSchema,
  /** For SCHEDULED and CONDITIONAL intents: the transaction they wrap. */
  innerIntentType: intentTypeSchema.nullable(),
  status: intentStatusSchema,
  input: z.string(),
  source: sourceSchema,
  destination: destinationSchema,
  recipient: recipientSchema.nullable(),
  refundAddress: z.string().nullable(),
  constraints: constraintsSchema,
  schedule: scheduleSchema.nullable(),
  condition: conditionSchema.nullable(),
  target: targetSchema.nullable(),
  query: querySchema.nullable(),
  allocations: z.array(allocationSchema).nullable(),
  executionMode: executionModeSchema,
  approvalRequired: z.boolean(),
  missingFields: z.array(z.string()),
  errors: z.array(errorSchema),
  clarifications: z.array(clarificationSchema),
  assumptions: z.array(z.string()),
  policy: policyDecisionSchema.nullable(),
  plan: executionPlanSchema.nullable(),
  meta: z.object({
    engineVersion: z.string(),
    processingMs: z.number(),
    contextApplied: z.enum(["NONE", "AMENDMENT", "CLARIFICATION_ANSWER"]),
  }),
});
export type IntentResult = z.infer<typeof intentResultSchema>;
