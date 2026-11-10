import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ExecutionCoordinator, MemoryPlanStore, MemorySessionStore, SpakIn, SpakInError, type SpakError } from "@/spak-in";
import { NearIntentsProvider } from "@/integrations/near-intents";
import { getDatabase, PgAuditLog, PgIntentLog, PgSessionStore, PgSubmissionRepository } from "@/database";

/**
 * Server wiring. One engine and one coordinator per server process.
 * With DATABASE_URL: sessions, intents, submissions and audit go to Postgres.
 * Without it: in-memory stores (fine for local development, lost on restart).
 */
function build() {
  const db = getDatabase();
  const intentLog = db ? new PgIntentLog(db) : null;
  const memoryPlans = new MemoryPlanStore();
  const engine = new SpakIn({
    sessions: db ? new PgSessionStore(db) : new MemorySessionStore(),
    onResult: async (r, req) => {
      if (intentLog) await intentLog.record(r, req.userId ?? null);
      else if (r.plan) await memoryPlans.put(r.plan);
    },
    onError: (e) => console.error("[spak-in] result log failed", e),
  });
  const coordinator = new ExecutionCoordinator({
    planSource: intentLog ?? memoryPlans,
    providers: [new NearIntentsProvider({ baseUrl: process.env.ONECLICK_API_URL, jwt: process.env.ONECLICK_JWT })],
    ...(db ? { submissions: new PgSubmissionRepository(db), audit: new PgAuditLog(db) } : {}),
  });
  return { engine, coordinator, persistent: !!db };
}

const g = globalThis as unknown as { __spak?: ReturnType<typeof build> };
export const spak = () => (g.__spak ??= build());

/**
 * PLACEHOLDER IDENTITY. The browser sends an anonymous id it generated. This scopes duplicate checks and
 * cancellations per browser, but it is not authentication. Replace with wallet-signature or NEAR account auth
 * before any multi-user deployment.
 */
export function userIdFrom(req: Request): string | null {
  const id = req.headers.get("x-spak-user");
  return id && /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : null;
}

const STATUS: Partial<Record<SpakError["code"], number>> = {
  INPUT_MALFORMED: 400, APPROVAL_MISMATCH: 409, DUPLICATE_SUBMISSION: 409, DUPLICATE_SUSPECTED: 409,
  APPROVAL_EXPIRED: 410, APPROVAL_REQUIRED: 400, AUTONOMY_NOT_PERMITTED: 403, PLAN_NOT_EXECUTABLE: 422,
  PROVIDER_UNAVAILABLE: 503, PROVIDER_ERROR: 502, TRANSACTION_NOT_FOUND: 404, NO_PENDING_TRANSACTION: 409,
};

export function errorResponse(error: SpakError) {
  return NextResponse.json({ error }, { status: STATUS[error.code] ?? 400 });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SpakInError) return errorResponse(e.error);
    if (e instanceof ZodError) return errorResponse({ code: "INPUT_MALFORMED", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    if (e instanceof SyntaxError) return errorResponse({ code: "INPUT_MALFORMED", message: "Body must be JSON." });
    console.error("[spak-in]", e);
    return NextResponse.json({ error: { code: "PROVIDER_ERROR", message: "Internal error." } }, { status: 500 });
  }
}
