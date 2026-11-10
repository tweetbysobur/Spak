import { NextResponse } from "next/server";
import { z } from "zod";
import { authService, currentUser, rateLimit, route, sessionToken, setSessionCookie } from "@/server/auth";

const body = z.object({
  challengeId: z.string().min(1).max(64),
  signature: z.string().min(1).max(1000),
  publicKey: z.string().max(100).optional(), // NEAR only
});

/** POST /api/auth/verify  Check the signature. SIGN_IN sets the session cookie; LINK adds the wallet. */
export async function POST(req: Request) {
  return route(req, async () => {
    rateLimit(req, "auth-verify", 20);
    const b = body.parse(await req.json());
    const user = await currentUser(req);
    const auth = await authService();
    const r = await auth.verifyChallenge({ ...b, currentUserId: user?.userId ?? null, userAgent: req.headers.get("user-agent") });
    const res = NextResponse.json({ userId: r.userId, walletId: r.walletId, created: r.created, wallets: await auth.listWallets(r.userId) });
    if (r.session) {
      // A new sign-in replaces any session this browser had.
      if (user) await auth.logout(sessionToken(req));
      setSessionCookie(res, req, r.session.token, r.session.expiresAt);
    }
    return res;
  });
}
