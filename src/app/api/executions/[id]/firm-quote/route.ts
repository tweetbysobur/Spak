import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, firmQuoteBody, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";
import { toQuoteView } from "@/execution";

/**
 * POST /api/executions/:id/firm-quote  { quoteId }  (the current indicative quote)
 * Gets a firm quote with deposit address for the user to review. Approves nothing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    rateLimit(req, "exec-firm", 10, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const b = firmQuoteBody.parse(await req.json());
    const s = (await spak()).execution;
    const r = await s.firmQuote({ userId: c.userId, executionId: id, quoteId: b.quoteId, wallets: c.wallets });
    return NextResponse.json({ execution: await s.details(id, c.userId), quote: toQuoteView(r.quote), reused: r.reused });
  });
}
