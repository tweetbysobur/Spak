import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema, txBody } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/**
 * POST /api/deposits/:id/submit  { txHash }  The wallet's transaction reference.
 * Recorded once (a transaction can fund one deposit only) and verified on chain; the browser's word proves nothing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    rateLimit(req, "deposit-submit", 20, 60_000, c.userId);
    const id = idSchema("dep").parse((await ctx.params).id);
    const { txHash } = txBody.parse(await req.json());
    const s = await spak();
    await s.deposits.submit({ userId: c.userId, depositId: id, txHash });
    return NextResponse.json(await s.deposits.get(c.userId, id));
  });
}
