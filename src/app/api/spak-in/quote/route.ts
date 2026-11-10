import { NextResponse } from "next/server";
import { rateLimit, requireUser } from "@/server/auth";
import { errorResponse, handle, spak } from "@/server/spak";

/** POST /api/spak-in/quote  { plan } -> dry quote. Nothing moves. */
export async function POST(req: Request) {
  return handle(req, async () => {
    const user = await requireUser(req);
    rateLimit(req, "quote", 30, 60_000, user.userId);
    const { plan } = await req.json();
    const r = await (await spak()).coordinator.quote(plan);
    return r.ok ? NextResponse.json(r.value) : errorResponse(r.error);
  });
}
