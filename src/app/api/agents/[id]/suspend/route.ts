import { NextResponse } from "next/server";
import { agentRoute, agentService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** POST /api/agents/:id/suspend  Suspend the Agent. Resuming needs a fresh ownership proof. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => NextResponse.json({ agent: await (await agentService()).suspend(userId, agentIdParam((await ctx.params).id)) }));
}
