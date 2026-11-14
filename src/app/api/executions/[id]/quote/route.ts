import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";
import { toQuoteView } from "@/execution";

/** POST /api/executions/:id/quote  Fresh indicative quote (before approval). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "exec-quote", 30, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const s = (await spak()).execution;
    const r = await s.requote({ userId: c.userId, executionId: id, wallets: c.wallets });
    return NextResponse.json({ execution: await s.details(id, c.userId), quote: toQuoteView(r.quote) });
  });
}
