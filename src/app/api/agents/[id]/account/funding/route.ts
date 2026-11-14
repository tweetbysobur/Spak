import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { agentFundingService, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** GET /api/agents/:id/account/funding  The last funding observation SPak recorded. Does not call NEAR. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => NextResponse.json({ funding: await (await agentFundingService()).latest(userId, agentIdParam((await ctx.params).id)) }));
}

/** POST /api/agents/:id/account/funding  Read the dedicated account's balance on NEAR now and record it. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    await rateLimit(req, "agent-funding-check", 10, 60_000, userId);
    return NextResponse.json({ funding: await (await agentFundingService()).check(userId, agentIdParam((await ctx.params).id)) });
  });
}
