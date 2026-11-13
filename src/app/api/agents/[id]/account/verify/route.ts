import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { agentAccountService, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** POST /api/agents/:id/account/verify  Re-read the account on NEAR: reconcile a pending creation or re-verify ownership. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-account-verify", 20, 60_000, userId);
    return NextResponse.json({ account: await (await agentAccountService()).verify(userId, agentIdParam((await ctx.params).id)) });
  });
}
