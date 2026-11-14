import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, firmQuoteBody, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";
import { toQuoteView } from "@/execution";

/**
 * POST /api/executions/:id/agent-approve  { quoteId }
 * The Agent approves the firm quote under the user's signed permission. 403 AGENT_APPROVAL_REQUIRED (with reasons)
 * when the transfer is outside the permission: the user then approves it with /approve. Guard applies either way.
 * SPak signs nothing; the user's wallet sends the deposit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "exec-agent-approve", 10, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const b = firmQuoteBody.parse(await req.json());
    const s = (await spak()).execution;
    const r = await s.approveByAgent({ userId: c.userId, executionId: id, quoteId: b.quoteId, wallets: c.wallets });
    return NextResponse.json({ execution: await s.details(id, c.userId), quote: r.quote ? toQuoteView(r.quote) : null, duplicate: r.duplicate });
  });
}
