import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentDomain, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";
import { spak } from "@/server/spak";

/** POST /api/agents/:id/permissions/confirm  { challengeId, accountId, publicKey, signature }  The owner's NEP-413 signature over the permission. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-grant-confirm", 10, 60_000, userId);
    const b = z.object({ challengeId: z.string().regex(/^agc_[0-9a-f]{24}$/), accountId: z.string().min(2).max(64), publicKey: z.string().min(10).max(120), signature: z.string().min(10).max(200) }).strict().parse(await req.json());
    return NextResponse.json({ grant: await (await spak()).grants.confirm(userId, agentIdParam((await ctx.params).id), { ...b, domain: agentDomain(req) }) });
  });
}
