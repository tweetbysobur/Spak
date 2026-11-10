import { NextResponse } from "next/server";
import { z } from "zod";
import { authService, rateLimit, requireUser, route } from "@/server/auth";

const patch = z.object({
  active: z.literal(true).optional(),
  networks: z.array(z.string().max(20)).max(30).optional(),
  label: z.string().max(40).nullable().optional(),
});

/** PATCH /api/wallets/:id  Make active, choose networks, rename. Owner only. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return route(req, async () => {
    const u = await requireUser(req);
    rateLimit(req, "wallets", 60, 60_000, u.userId);
    const { id } = await ctx.params;
    const b = patch.parse(await req.json());
    const auth = await authService();
    if (b.active) await auth.setActiveWallet(u.userId, id);
    if (b.networks) await auth.setWalletNetworks(u.userId, id, b.networks);
    if (b.label !== undefined) await auth.setWalletLabel(u.userId, id, b.label);
    return NextResponse.json({ wallets: await auth.listWallets(u.userId) });
  });
}

/** DELETE /api/wallets/:id  Disconnect a wallet. The last wallet stays. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return route(req, async () => {
    const u = await requireUser(req);
    const { id } = await ctx.params;
    const auth = await authService();
    await auth.removeWallet(u.userId, id);
    return NextResponse.json({ wallets: await auth.listWallets(u.userId) });
  });
}
