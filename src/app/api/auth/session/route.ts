import { NextResponse } from "next/server";
import { authService, currentUser, route } from "@/server/auth";

/** GET /api/auth/session  Who is signed in, their wallets and agent identity. */
export async function GET(req: Request) {
  return route(req, async () => {
    const u = await currentUser(req);
    if (!u) return NextResponse.json({ authenticated: false });
    const auth = await authService();
    return NextResponse.json({
      authenticated: true, userId: u.userId, expiresAt: u.expiresAt,
      wallets: await auth.listWallets(u.userId), agent: await auth.getAgentIdentity(u.userId),
      activeSessions: await auth.activeSessionCount(u.userId),
    });
  });
}
