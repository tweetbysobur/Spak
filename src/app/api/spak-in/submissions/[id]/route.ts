import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { errorResponse, handle, spak } from "@/server/spak";

/** GET /api/spak-in/submissions/:id  Only the owner can read it. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const c = (await spak()).coordinator;
    const owned = await c.submissions.get(id);
    if (!owned || owned.userId !== user.userId) return errorResponse({ code: "TRANSACTION_NOT_FOUND", message: `No submission ${id}.` });
    const r = await c.refresh(id);
    return r.ok ? NextResponse.json(r.value) : errorResponse(r.error);
  });
}
