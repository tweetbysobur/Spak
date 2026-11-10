import { NextResponse } from "next/server";
import { authService, clearSessionCookie, route, sessionToken } from "@/server/auth";

/** POST /api/auth/logout  Revoke this session and clear the cookie. */
export async function POST(req: Request) {
  return route(req, async () => {
    await (await authService()).logout(sessionToken(req));
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res, req);
    return res;
  });
}
