import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentAccountService, agentDomain, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/**
 * POST /api/agents/:id/account/rotation/prepare  { newPublicKey }
 * Start a key rotation for the dedicated account. Returns the message the CURRENT dedicated-account key signs and the
 * exact transaction the owner sends from their own wallet (AddKey new + DeleteKey old). SPak signs nothing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-rotation", 10, 60_000, userId);
    const b = z.object({ newPublicKey: z.string().max(100) }).strict().parse(await req.json());
    return NextResponse.json(await (await agentAccountService()).prepareRotation(userId, agentIdParam((await ctx.params).id), { ...b, domain: agentDomain(req) }));
  });
}
