import { NextResponse } from "next/server";
import { executionContext, idSchema, rejectBody } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** POST /api/deposits/:id/reject  { reason }  The user rejected the wallet request. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    const id = idSchema("dep").parse((await ctx.params).id);
    const { reason } = rejectBody.parse(await req.json());
    const s = await spak();
    await s.deposits.walletRejected({ userId: c.userId, depositId: id, reason });
    return NextResponse.json(await s.deposits.get(c.userId, id));
  });
}
