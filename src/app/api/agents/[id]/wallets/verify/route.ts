import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentDomain, agentRoute, agentWalletService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/**
 * POST /api/agents/:id/wallets/verify  { challengeId, signature, publicKey?, accountId? }
 * The wallet's signature over the stored challenge. Verified on the server only; a status in the body is refused.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-wallet-verify", 30, 60_000, userId);
    const b = z.object({
      challengeId: z.string().regex(/^awc_[0-9a-f]{24}$/), signature: z.string().min(1).max(300),
      publicKey: z.string().max(100).optional(), accountId: z.string().max(64).optional(),
    }).strict().parse(await req.json());
    return NextResponse.json({ association: await (await agentWalletService()).verify(userId, agentIdParam((await ctx.params).id), { ...b, domain: agentDomain(req) }) });
  });
}
