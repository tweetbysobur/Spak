import { NextResponse } from "next/server";
import { authService, rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/**
 * GET /api/intelligence/portfolio[?refresh=1]  (signed-in users only)
 * Read-only balances of the user's verified wallets on SPak's executable networks, valued with SPak's independent
 * prices, plus factual insights. `cached` and `ageSec` say how old the data is.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const user = await requireUser(req);
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    await rateLimit(req, refresh ? "portfolio-refresh" : "portfolio", refresh ? 6 : 30, 60_000, user.userId);
    const wallets = await (await authService()).listWallets(user.userId);
    const r = await (await spak()).intelligence.snapshot(user.userId, wallets, { refresh });
    return NextResponse.json({ ...r.snapshot, cached: r.cached, ageSec: r.ageSec });
  });
}
