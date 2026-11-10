import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/executions/:id/failure  What went wrong, whether it is temporary, where funds are, what to do. Owner only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    rateLimit(req, "exec-failure", 120, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    return NextResponse.json(await (await spak()).failures.failure(c.userId, id));
  });
}
