import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentAccountService, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** POST /api/agents/:id/account/rotation/complete  { rotationId, txHash? }  Read the account on NEAR and record the result. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-rotation", 10, 60_000, userId);
    const b = z.object({ rotationId: z.string().regex(/^akr_[0-9a-f]{24}$/), txHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/).optional() }).strict().parse(await req.json());
    return NextResponse.json({ rotation: await (await agentAccountService()).completeRotation(userId, agentIdParam((await ctx.params).id), b) });
  });
}
