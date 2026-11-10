import { NextResponse } from "next/server";
import { authService, requireUser, route } from "@/server/auth";

/** GET /api/wallets  The signed-in user's verified wallets and their networks. */
export async function GET(req: Request) {
  return route(req, async () => {
    const u = await requireUser(req);
    return NextResponse.json({ wallets: await (await authService()).listWallets(u.userId) });
  });
}
