import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { errorResponse, handle, spak } from "@/server/spak";

/** POST /api/spak-in/submissions/:id/cancel  Owner only, before deposit. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const r = await (await spak()).coordinator.cancel(id, user.userId);
    return r.ok ? NextResponse.json(r.value) : errorResponse(r.error);
  });
}
