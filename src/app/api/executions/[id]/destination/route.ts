import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/executions/:id/destination  SPak's destination-chain verification records. Owner only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "exec-destination", 120, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    return NextResponse.json({ verifications: await (await spak()).tracking.destination(c.userId, id) });
  });
}
