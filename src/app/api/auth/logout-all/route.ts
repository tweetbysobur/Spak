import { NextResponse } from "next/server";
import { authService, clearSessionCookie, requireUser, route } from "@/server/auth";

/** POST /api/auth/logout-all  Revoke every session of this user. */
export async function POST(req: Request) {
  return route(req, async () => {
    const u = await requireUser(req);
    await (await authService()).logoutAll(u.userId);
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res, req);
    return res;
  });
}
