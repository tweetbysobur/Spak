import { NextResponse } from "next/server";
import { errorResponse, handle, spak, userIdFrom } from "@/server/spak";

/** POST /api/spak-in/submissions/:id/cancel  Only before a deposit. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const r = await spak().coordinator.cancel(id, userIdFrom(req) ?? "");
    return r.ok ? NextResponse.json(r.value) : errorResponse(r.error);
  });
}
