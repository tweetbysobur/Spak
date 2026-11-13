import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentAccountService, agentDomain, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** POST /api/agents/:id/account/prepare  {}  Pick a free account name and issue the owner's NEP-413 consent request. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-account-prepare", 10, 60_000, userId);
    z.object({}).strict().parse(await req.json().catch(() => ({})));
    return NextResponse.json(await (await agentAccountService()).prepare(userId, agentIdParam((await ctx.params).id), agentDomain(req)));
  });
}
