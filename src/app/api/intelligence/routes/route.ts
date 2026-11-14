import { NextResponse } from "next/server";
import { authService, rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";
import { isDecimal, isZero } from "@/spak-in/lib/decimal";
import { AuthError } from "@/auth/types";

/**
 * POST /api/intelligence/routes  { assetId, amount, walletAddress }  (signed-in users only)
 * Dry NEAR Intents quotes for moving a holding to the same asset on other networks. The source wallet and every
 * recipient must be the user's own verified wallets. No deposit address is created and nothing moves.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const user = await requireUser(req);
    await rateLimit(req, "intelligence-routes", 6, 60_000, user.userId);
    const body = await req.json().catch(() => null) as { assetId?: unknown; amount?: unknown; walletAddress?: unknown } | null;
    const assetId = typeof body?.assetId === "string" ? body.assetId : "";
    const amount = typeof body?.amount === "string" ? body.amount : "";
    const from = typeof body?.walletAddress === "string" ? body.walletAddress : "";
    if (!assetId || !isDecimal(amount) || isZero(amount) || !from) throw new AuthError("BAD_REQUEST", "assetId, amount and walletAddress are required.");
    const wallets = await (await authService()).listWallets(user.userId);
    const network = assetId.split(":")[0];
    const owns = wallets.some((w) => w.networks.some((n) => n.id === network && n.enabled) && (w.family === "solana" ? w.address === from : w.address.toLowerCase() === from.toLowerCase()));
    if (!owns) throw new AuthError("FORBIDDEN", "That wallet is not one of your verified wallets on this network.");
    const recipients: Record<string, string> = {};
    for (const w of wallets) for (const n of w.networks) if (n.enabled && !recipients[n.id]) recipients[n.id] = w.address;
    const routes = await (await spak()).intelligence.routes({ assetId, amount, refundAddress: from, recipients });
    return NextResponse.json({ assetId, amount, routes, quotedAt: new Date().toISOString() });
  });
}
