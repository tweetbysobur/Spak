import { NextResponse } from "next/server";
import { z } from "zod";
import { agentRoute, agentService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** POST /api/agents/:id/revoke  { confirm: "REVOKE" }  Permanent. A revoked Agent can never become active again. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    const b = z.object({ confirm: z.string().max(20) }).strict().parse(await req.json());
    return NextResponse.json({ agent: await (await agentService()).revoke(userId, agentIdParam((await ctx.params).id), b.confirm) });
  });
}
