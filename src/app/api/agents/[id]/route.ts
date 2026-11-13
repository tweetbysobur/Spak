import { NextResponse } from "next/server";
import { agentRoute, agentService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** GET /api/agents/:id  One of the user's Agents, including ownership verification status. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => NextResponse.json({ agent: await (await agentService()).get(userId, agentIdParam((await ctx.params).id)) }));
}
