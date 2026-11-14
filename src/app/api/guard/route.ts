import { NextResponse } from "next/server";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/**
 * GET /api/guard  The signed-in user's Guard policy, spending in each rolling window, and the platform ceiling.
 * PATCH /api/guard  { version, ...changes }  Change limits, slippage, modes, networks or token rules.
 * The user always comes from the session. There is no user id in the path or body.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    return NextResponse.json(await (await spak()).guard.view(u.userId));
  });
}

export async function PATCH(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "guard-write", 30, 60_000, u.userId);
    return NextResponse.json(await (await spak()).guard.update(u.userId, await req.json()));
  });
}
