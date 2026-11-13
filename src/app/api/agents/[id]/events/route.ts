import { NextResponse } from "next/server";
import { agentRoute, agentService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** GET /api/agents/:id/events  The Agent's identity audit trail, oldest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => NextResponse.json({ items: await (await agentService()).events(userId, agentIdParam((await ctx.params).id)) }));
}
