import "server-only";
import { NextResponse } from "next/server";
import { SpakIn, SpakInError, type SpakError } from "@/spak-in";
import { oneClickFromEnv } from "@/integrations/near-intents";
import { getDb, PgAuditLog, PgIntentLog, PgSessionStore } from "@/database";
import { ExecutionError, ExecutionRecords, ExecutionService, IntentLogPlanStore } from "@/execution";
import { DepositRecords, DepositService, httpChainRpc } from "@/deposits";
import { DestinationVerifier, ExecutionMonitor, TrackingRecords, TrackingService } from "@/tracking";
import { FailureRecords, FailureService, RefundVerifier, ReviewService } from "@/failures";
import { AuthError } from "@/auth/types";
import { authService, requireUser, route } from "./auth";

/**
 * Server wiring. One engine and one coordinator per server process, both on the shared database
 * (Postgres with DATABASE_URL, embedded PGlite in local development).
 */
async function build() {
  const db = await getDb();
  const intentLog = new PgIntentLog(db);
  const engine = new SpakIn({
    sessions: new PgSessionStore(db),
    onResult: (r, req) => intentLog.record(r, req.userId ?? null),
    onError: (e) => console.error("[spak-in] result log failed", e),
  });
  // SPak Execution: only plans SPak-in issued (read from the intent log) can execute.
  const client = oneClickFromEnv();
  const executionRecords = new ExecutionRecords(db);
  const audit = new PgAuditLog(db);
  const execution = new ExecutionService({ client, records: executionRecords, plans: new IntentLogPlanStore(db), audit });
  // Deposits extend the same execution engine: same records, same provider client, plus source-chain RPC.
  const rpc = httpChainRpc();
  const depositRecords = new DepositRecords(db);
  const deposits = new DepositService({ records: depositRecords, executions: executionRecords, executionService: execution, rpc, client, audit });
  // Tracking: background monitor and destination-chain verification over the same records. Not a second engine.
  const tracking = new TrackingRecords(db);
  const destination = new DestinationVerifier({ executions: executionRecords, tracking, rpc, audit });
  // Failures and refunds: same records again; refunds are verified on the source chain, never taken on the provider's word.
  const failureRecords = new FailureRecords(db);
  const refunds = new RefundVerifier({ executions: executionRecords, failures: failureRecords, depositRecords, rpc, audit });
  const failures = new FailureService({ executions: executionRecords, failures: failureRecords, depositRecords, tracking, refunds, audit });
  const reviews = new ReviewService({ executions: executionRecords, failures: failureRecords, depositRecords, tracking, refunds, audit });
  const monitor = new ExecutionMonitor({
    tracking, executions: executionRecords, execution, deposits, depositRecords, destination, refunds, failures,
    log: (msg, data) => console.warn(`[spak-monitor] ${msg}`, JSON.stringify(data ?? {})),
  });
  const trackingService = new TrackingService({ executions: executionRecords, execution, tracking, depositRecords, destination, failures });
  return { engine, execution, deposits, monitor, tracking: trackingService, failures, reviews };
}

const g = globalThis as unknown as { __spak?: ReturnType<typeof build> };
export const spak = () => (g.__spak ??= build());

/**
 * Identity for SPak-in calls: the signed-in user and the wallets they proved they own.
 * Client-supplied wallet addresses are ignored.
 */
export async function spakContext(req: Request, clientSessionId?: unknown) {
  const user = await requireUser(req);
  const auth = await authService();
  const wallets = await auth.walletContext(user.userId);
  const agent = await auth.getAgentIdentity(user.userId);
  // Conversation sessions are namespaced by user, so one user can never continue another's draft.
  const sid = typeof clientSessionId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(clientSessionId) ? clientSessionId : "default";
  return { userId: user.userId, wallets, agentLinked: agent.status === "LINKED", sessionId: `${user.userId}:${sid}` };
}

const STATUS: Partial<Record<SpakError["code"], number>> = {
  INPUT_MALFORMED: 400, APPROVAL_MISMATCH: 409, DUPLICATE_SUBMISSION: 409, DUPLICATE_SUSPECTED: 409,
  APPROVAL_EXPIRED: 410, APPROVAL_REQUIRED: 400, AUTONOMY_NOT_PERMITTED: 403, PLAN_NOT_EXECUTABLE: 422,
  PROVIDER_UNAVAILABLE: 503, PROVIDER_ERROR: 502, TRANSACTION_NOT_FOUND: 404, NO_PENDING_TRANSACTION: 409,
};

export function errorResponse(error: SpakError) {
  return NextResponse.json({ error }, { status: STATUS[error.code] ?? 400 });
}

/** Wrapper for SPak-in routes: CSRF, auth errors, SPak-in errors. */
export function handle(req: Request, fn: () => Promise<Response>): Promise<Response> {
  return route(req, async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SpakInError) return errorResponse(e.error);
      if (e instanceof ExecutionError) return NextResponse.json({ error: e.toJSON() }, { status: e.status });
      if (e instanceof AuthError) throw e;
      if (e instanceof SyntaxError || (e as { name?: string }).name === "ZodError") throw e;
      console.error("[spak-in]", e);
      return NextResponse.json({ error: { code: "PROVIDER_ERROR", message: "Internal error." } }, { status: 500 });
    }
  });
}
