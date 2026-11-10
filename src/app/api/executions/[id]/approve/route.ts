import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { approveBody, executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";
import { toQuoteView } from "@/execution";

/**
 * POST /api/executions/:id/approve  { quoteId, approval: { planHash, planRevision, approvedAt, allowDuplicate? } }
 * The signed-in user approves the exact firm quote they reviewed (see /firm-quote). Releases deposit instructions.
 * SPak signs nothing; the user's wallet sends the deposit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    rateLimit(req, "exec-approve", 10, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const b = approveBody.parse(await req.json());
    const s = (await spak()).execution;
    const r = await s.approve({ userId: c.userId, executionId: id, quoteId: b.quoteId, approval: b.approval, wallets: c.wallets });
    return NextResponse.json({ execution: await s.details(id, c.userId), quote: r.quote ? toQuoteView(r.quote) : null, duplicate: r.duplicate });
  });
}
