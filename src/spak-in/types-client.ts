/** Type-only exports that are safe to import from browser code. */
import type { IntentResult as SpakInResult } from "./schemas/result";
import type { GuardDecision } from "../guard/types";
/** SPak-in result as the API returns it: the interpretation plus SPak Guard's decision on the plan (null when no plan). */
export type IntentResult = SpakInResult & { guard?: GuardDecision | null };
export type { ExecutionPlan } from "./schemas/plan";
export type { Clarification } from "./schemas/intent";
export type { ExecutionState } from "../execution/state";
export type { ExecutionView, QuoteView } from "../execution/views";
