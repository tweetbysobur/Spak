import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { agentDomain, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";
import { spak } from "@/server/spak";

/**
 * POST /api/agents/:id/permissions/prepare  { maxTransactionUsd, dailyLimitUsd, maxTransactions, durationHours, sourceNetworks,
 * destinationNetworks, assets, recipients: { self, addresses } }  A one-time challenge naming the exact permission. Nothing changes yet.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    await rateLimit(req, "agent-grant-prepare", 10, 60_000, userId);
    return NextResponse.json(await (await spak()).grants.prepare(userId, agentIdParam((await ctx.params).id), await req.json(), agentDomain(req)));
  });
}
