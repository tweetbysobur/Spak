import type { toExecutionView, toQuoteView } from "./service";
/** API response shapes. Type-only, safe for browser code. */
export type ExecutionView = ReturnType<typeof toExecutionView>;
export type QuoteView = ReturnType<typeof toQuoteView>;
