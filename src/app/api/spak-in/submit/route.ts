import { NextResponse } from "next/server";
import { rateLimit, requireUser } from "@/server/auth";
import { errorResponse, handle, spak } from "@/server/spak";

/**
 * POST /api/spak-in/submit  { plan, approval } -> deposit instructions.
 * The approval is the signed-in user's. SPak never signs or sends funds; the user's wallet does.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const user = await requireUser(req);
    rateLimit(req, "submit", 10, 60_000, user.userId);
    const { plan, approval } = await req.json();
    const r = await (await spak()).coordinator.submit({ plan, approval: { ...approval, approvedBy: "USER" }, userId: user.userId });
    return r.ok ? NextResponse.json(r.value) : errorResponse(r.error);
  });
}
