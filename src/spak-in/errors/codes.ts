/** Every error SPak-in can return. Codes are stable API; messages are for people. */
export const ERROR_CODES = [
  // input
  "INPUT_EMPTY", "INPUT_TOO_LONG", "INPUT_MALFORMED",
  // understanding
  "UNKNOWN_INTENT", "AMBIGUOUS_ACTION", "AMBIGUOUS_AMOUNT", "AMBIGUOUS_ASSET", "AMBIGUOUS_NETWORK_ROLE",
  "AMBIGUOUS_TARGET", "MULTI_STEP_NOT_SUPPORTED",
  // validation
  "UNSUPPORTED_NETWORK", "UNSUPPORTED_ASSET", "ASSET_NOT_ON_NETWORK", "INVALID_AMOUNT", "AMOUNT_PRECISION",
  "INVALID_PERCENTAGE", "INVALID_ADDRESS", "ADDRESS_NETWORK_MISMATCH", "SAME_ASSET_SAME_NETWORK",
  "INVALID_ALLOCATION", "INVALID_SCHEDULE", "INVALID_CONDITION", "INVALID_CONSTRAINT",
  "NO_PENDING_TRANSACTION", "TRANSACTION_NOT_FOUND", "UNSUPPORTED_MODE",
  // policy
  "POLICY_NETWORK_NOT_ALLOWED", "POLICY_ASSET_NOT_ALLOWED", "POLICY_TX_LIMIT_EXCEEDED",
  "POLICY_DAILY_LIMIT_EXCEEDED", "POLICY_RECIPIENT_NOT_APPROVED", "POLICY_SLIPPAGE_EXCEEDED",
  // context and coordination
  "CONTEXT_EXPIRED", "NOTHING_TO_AMEND", "DUPLICATE_SUBMISSION", "DUPLICATE_SUSPECTED",
  "APPROVAL_REQUIRED", "APPROVAL_MISMATCH", "APPROVAL_EXPIRED", "AUTONOMY_NOT_PERMITTED",
  "PLAN_NOT_EXECUTABLE", "INTENT_NOT_IMPLEMENTED", "PROVIDER_UNAVAILABLE", "PROVIDER_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SpakError {
  code: ErrorCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export function err(code: ErrorCode, message: string, field?: string, details?: Record<string, unknown>): SpakError {
  return { code, message, ...(field ? { field } : {}), ...(details ? { details } : {}) };
}

/** Thrown only for programmer errors and infrastructure failures. User-facing problems are returned, not thrown. */
export class SpakInError extends Error {
  constructor(public readonly error: SpakError) {
    super(error.message);
    this.name = "SpakInError";
  }
}
