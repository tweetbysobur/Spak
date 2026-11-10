import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/executions/:id/refund  Refund eligibility, instructions (automatic), refund record and transactions. Owner only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    rateLimit(req, "exec-refund", 120, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    return NextResponse.json(await (await spak()).failures.refund(c.userId, id));
  });
}
