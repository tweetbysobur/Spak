import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";
import { spak } from "@/server/spak";

/** POST /api/agents/:id/permissions/pause  Pause the Agent's permission at once. Agent approvals not yet funded stop at deposit. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-grant-pause", 20, 60_000, userId);
    return NextResponse.json({ grant: await (await spak()).grants.pause(userId, agentIdParam((await ctx.params).id)) });
  });
}
