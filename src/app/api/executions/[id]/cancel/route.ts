import { NextResponse } from "next/server";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** POST /api/executions/:id/cancel  Only before a deposit. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    const id = idSchema("exe").parse((await ctx.params).id);
    const s = (await spak()).execution;
    await s.cancel({ userId: c.userId, executionId: id });
    return NextResponse.json(await s.details(id, c.userId));
  });
}
