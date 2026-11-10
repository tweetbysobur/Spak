import { NextResponse } from "next/server";
import { errorResponse, handle, spak, userIdFrom } from "@/server/spak";

/**
 * POST /api/spak-in/submit  { plan, approval } -> deposit instructions.
 * The user's wallet sends the deposit. SPak never signs or sends funds.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const userId = userIdFrom(req);
    if (!userId) return errorResponse({ code: "APPROVAL_REQUIRED", message: "Missing x-spak-user header." });
    const { plan, approval } = await req.json();
    const r = await spak().coordinator.submit({ plan, approval: { ...approval, approvedBy: "USER" }, userId });
    return r.ok ? NextResponse.json(r.value) : errorResponse(r.error);
  });
}
