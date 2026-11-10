import { NextResponse } from "next/server";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/deposits/:id  Deposit status and history. Owner only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    const id = idSchema("dep").parse((await ctx.params).id);
    return NextResponse.json(await (await spak()).deposits.get(c.userId, id));
  });
}
