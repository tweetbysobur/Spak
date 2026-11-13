import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { createBody, executionContext, idempotencyKeySchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";
import { toQuoteView } from "@/execution";

/**
 * POST /api/executions  { planHash, idempotencyKey?, agentId? }  header Idempotency-Key also accepted.
 * agentId attributes the transfer to the user's Agent; the server refuses unless that Agent is owned, verified and current.
 * Creates (or returns) the execution for a SPak-in plan and attaches an indicative quote.
 * 201 when created, 200 when the same key or plan was already used.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const ctx = await executionContext(req);
    rateLimit(req, "exec-create", 20, 60_000, ctx.userId);
    const b = createBody.parse(await req.json());
    const idempotencyKey = idempotencyKeySchema.parse(req.headers.get("idempotency-key") ?? b.idempotencyKey);
    const s = (await spak()).execution;
    const r = await s.create({ userId: ctx.userId, planHash: b.planHash, idempotencyKey, wallets: ctx.wallets, agentId: b.agentId ?? null });
    return NextResponse.json({ execution: await s.details(r.execution.id, ctx.userId), quote: r.quote ? toQuoteView(r.quote) : null }, { status: r.created ? 201 : 200 });
  });
}

/** GET /api/executions?limit=20&before=ISO  Execution history, newest first. */
export async function GET(req: Request) {
  return handle(req, async () => {
    const ctx = await executionContext(req);
    const u = new URL(req.url);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), before: z.string().datetime().optional() })
      .parse({ limit: u.searchParams.get("limit") ?? undefined, before: u.searchParams.get("before") ?? undefined });
    const items = await (await spak()).execution.history(ctx.userId, { limit: q.limit, before: q.before ? new Date(q.before) : undefined });
    return NextResponse.json({ items, next: items.length === q.limit ? items[items.length - 1].createdAt : null });
  });
}
