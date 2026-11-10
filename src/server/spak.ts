import "server-only";
import { NextResponse } from "next/server";
import { ExecutionCoordinator, SpakIn, SpakInError, type SpakError } from "@/spak-in";
import { NearIntentsProvider } from "@/integrations/near-intents";
import { getDb, PgAuditLog, PgIntentLog, PgSessionStore, PgSubmissionRepository } from "@/database";
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
  const coordinator = new ExecutionCoordinator({
    planSource: intentLog, // only plans SPak-in issued can execute
    providers: [new NearIntentsProvider({ baseUrl: process.env.ONECLICK_API_URL, jwt: process.env.ONECLICK_JWT })],
    submissions: new PgSubmissionRepository(db),
    audit: new PgAuditLog(db),
  });
  return { engine, coordinator };
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
      if (e instanceof AuthError) throw e;
      if (e instanceof SyntaxError || (e as { name?: string }).name === "ZodError") throw e;
      console.error("[spak-in]", e);
      return NextResponse.json({ error: { code: "PROVIDER_ERROR", message: "Internal error." } }, { status: 500 });
    }
  });
}
