import { NextResponse } from "next/server";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/quotes/:id  One quote. Owner only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    const id = idSchema("qte").parse((await ctx.params).id);
    return NextResponse.json(await (await spak()).execution.quote(id, c.userId));
  });
}
