import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** POST /api/executions/:id/refund/verify  Check refund transactions on chain now. Owner only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "exec-refund-verify", 10, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    z.object({}).strict().parse(await req.json().catch(() => ({})));
    return NextResponse.json(await (await spak()).failures.verifyRefund(c.userId, id));
  });
}
