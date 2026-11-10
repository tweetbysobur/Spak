import { NextResponse } from "next/server";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/executions/:id  Details, quotes and state history. Owner only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    const id = idSchema("exe").parse((await ctx.params).id);
    return NextResponse.json(await (await spak()).execution.details(id, c.userId));
  });
}
