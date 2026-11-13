import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/executions/:id/guard  Guard decisions and the spending reservation for one of the user's transfers. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const u = await requireUser(req);
    const id = idSchema("exe").parse((await ctx.params).id);
    const s = await spak();
    await s.execution.mustGet(id, u.userId); // 404 for anyone else's execution
    const [decisions, reservation] = await Promise.all([s.guard.decisionsFor(u.userId, id), s.guard.reservationFor(u.userId, id)]);
    return NextResponse.json({ decisions, reservation });
  });
}
