import { NextResponse } from "next/server";
import { errorResponse, handle, spak, userIdFrom } from "@/server/spak";

/** GET /api/spak-in/submissions/:id  Refreshes state from the provider. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const r = await spak().coordinator.refresh(id);
    if (!r.ok) return errorResponse(r.error);
    if (r.value.userId !== userIdFrom(req)) return errorResponse({ code: "TRANSACTION_NOT_FOUND", message: `No submission ${id}.` });
    return NextResponse.json(r.value);
  });
}
