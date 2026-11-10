/** SPak Execution errors. Codes are stable API; messages are for people. */
export const EXECUTION_ERRORS = {
  UNAUTHENTICATED: 401,
  BAD_REQUEST: 400,
  PLAN_NOT_FOUND: 404,
  PLAN_NOT_OWNED: 404, // same answer as not found: never reveal another user's plan
  PLAN_SUPERSEDED: 409,
  PLAN_TAMPERED: 409,
  PLAN_NOT_EXECUTABLE: 422,
  AUTONOMY_DISABLED: 403,
  WALLET_NOT_VERIFIED: 403,
  UNSUPPORTED_NETWORK: 422,
  UNSUPPORTED_ASSET: 422,
  ASSET_MISMATCH: 502,
  INVALID_AMOUNT: 422,
  EXECUTION_NOT_FOUND: 404,
  QUOTE_NOT_FOUND: 404,
  QUOTE_EXPIRED: 409,
  QUOTE_NOT_CURRENT: 409,
  QUOTE_MISMATCH: 502,
  QUOTE_REJECTED: 422,
  QUOTE_WORSE_THAN_APPROVED: 409,
  APPROVAL_REQUIRED: 400,
  APPROVAL_MISMATCH: 409,
  APPROVAL_EXPIRED: 410,
  APPROVAL_IN_PROGRESS: 409,
  DUPLICATE_SUSPECTED: 409,
  INVALID_STATE: 409,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_ERROR: 502,
  RATE_LIMITED: 429,
} as const;
export type ExecutionErrorCode = keyof typeof EXECUTION_ERRORS;

export class ExecutionError extends Error {
  readonly status: number;
  constructor(public readonly code: ExecutionErrorCode, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ExecutionError";
    this.status = EXECUTION_ERRORS[code];
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}
