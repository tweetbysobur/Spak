import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema, txBody } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** POST /api/executions/:id/deposits/manual  { txHash }  A deposit sent outside SPak (e.g. NEAR). Verified on chain. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "deposit-submit", 20, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const { txHash } = txBody.parse(await req.json());
    const s = await spak();
    const d = await s.deposits.submitManual({ userId: c.userId, executionId: id, txHash, wallets: c.wallets });
    return NextResponse.json(await s.deposits.get(c.userId, d.id));
  });
}
