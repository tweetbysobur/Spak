import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/executions/:id/status  Check NEAR Intents and return the updated execution. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "exec-status", 60, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const s = (await spak()).execution;
    await s.refresh({ userId: c.userId, executionId: id });
    return NextResponse.json(await s.details(id, c.userId));
  });
}
