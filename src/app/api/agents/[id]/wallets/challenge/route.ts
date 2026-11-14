import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentDomain, agentRoute, agentUri, agentWalletService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/**
 * POST /api/agents/:id/wallets/challenge  { walletId, chainId? }
 * Start (or re-verify) an association for one of the user's verified wallets. EVM needs the chain id the wallet
 * is on. The wallet's address comes from the server's record, never from this body.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    await rateLimit(req, "agent-wallet-challenge", 20, 60_000, userId);
    const b = z.object({ walletId: z.string().min(1).max(64), chainId: z.number().int().positive().optional() }).strict().parse(await req.json());
    return NextResponse.json(await (await agentWalletService()).challenge(userId, agentIdParam((await ctx.params).id), { ...b, domain: agentDomain(req), uri: agentUri(req) }));
  });
}
