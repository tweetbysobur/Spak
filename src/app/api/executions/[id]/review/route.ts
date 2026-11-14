import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/executions/:id/review  Manual review status (no internal notes). Owner only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "exec-review", 60, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    return NextResponse.json({ reviews: await (await spak()).failures.reviewStatus(c.userId, id) });
  });
}
