import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentDomain, agentRoute, agentService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** POST /api/agents/:id/challenge  { accountId }  A one-time NEP-413 ownership challenge for that NEAR account. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    await rateLimit(req, "agent-challenge", 10, 60_000, userId);
    const b = z.object({ accountId: z.string().min(2).max(64) }).strict().parse(await req.json());
    return NextResponse.json(await (await agentService()).challenge(userId, agentIdParam((await ctx.params).id), { accountId: b.accountId, domain: agentDomain(req) }));
  });
}
