import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** POST /api/deposits/:id/verify  Check the source chain now (rate limited, at most every 4 s per deposit). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "deposit-verify", 60, 60_000, c.userId);
    const id = idSchema("dep").parse((await ctx.params).id);
    const s = await spak();
    await s.deposits.verify({ userId: c.userId, depositId: id });
    return NextResponse.json(await s.deposits.get(c.userId, id));
  });
}
