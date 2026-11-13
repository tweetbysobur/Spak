import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";
import { spak } from "@/server/spak";

/** POST /api/agents/:id/permissions/revoke  Revoke the permission. Back to manual approval. Permanent for this version. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-grant-revoke", 20, 60_000, userId);
    return NextResponse.json({ grant: await (await spak()).grants.revoke(userId, agentIdParam((await ctx.params).id)) });
  });
}
