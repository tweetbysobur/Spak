import { NextResponse } from "next/server";
import { agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";
import { spak } from "@/server/spak";

/** GET /api/agents/:id/permissions  Mode (MANUAL unless a signed permission is ACTIVE), the permission, usage, version history and Agent approvals. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    const id = agentIdParam((await ctx.params).id);
    const g = (await spak()).grants;
    return NextResponse.json({ ...(await g.view(userId, id)), approvals: await g.approvals(userId, id) });
  });
}
