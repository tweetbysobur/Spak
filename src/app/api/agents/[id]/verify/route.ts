import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentDomain, agentRoute, agentService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/**
 * POST /api/agents/:id/verify  { challengeId, method, accountId, publicKey, signature }
 * Submit the wallet's NEP-413 signature. The server verifies it against its stored challenge and checks on NEAR that
 * the key is a full-access key of the account. Any verification status in the body is rejected (strict schema).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-verify", 20, 60_000, userId);
    const b = z.object({
      challengeId: z.string().regex(/^ach_[0-9a-f]{24}$/), method: z.string().max(64), accountId: z.string().min(2).max(64),
      publicKey: z.string().max(100), signature: z.string().max(200),
    }).strict().parse(await req.json());
    return NextResponse.json({ agent: await (await agentService()).verify(userId, agentIdParam((await ctx.params).id), { ...b, domain: agentDomain(req) }) });
  });
}
