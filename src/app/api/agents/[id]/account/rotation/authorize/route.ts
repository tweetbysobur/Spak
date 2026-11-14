import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentAccountService, agentDomain, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** POST /api/agents/:id/account/rotation/authorize  { rotationId, publicKey, signature }  NEP-413 from the key on the dedicated account. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    await rateLimit(req, "agent-rotation", 10, 60_000, userId);
    const b = z.object({ rotationId: z.string().regex(/^akr_[0-9a-f]{24}$/), publicKey: z.string().max(100), signature: z.string().max(200) }).strict().parse(await req.json());
    return NextResponse.json({ rotation: await (await agentAccountService()).authorizeRotation(userId, agentIdParam((await ctx.params).id), { ...b, domain: agentDomain(req) }) });
  });
}
