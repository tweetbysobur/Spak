import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";
import { spak } from "@/server/spak";

/** POST /api/agents/:id/permissions/resume  Resume the same signed permission, unchanged, if it is still in date. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-grant-resume", 20, 60_000, userId);
    return NextResponse.json({ grant: await (await spak()).grants.resume(userId, agentIdParam((await ctx.params).id)) });
  });
}
