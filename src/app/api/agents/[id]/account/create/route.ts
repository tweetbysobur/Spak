import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { idempotencyKeySchema } from "@/server/execution";
import { agentAccountService, agentDomain, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/**
 * POST /api/agents/:id/account/create  { challengeId, accountId, publicKey, signature }  Idempotency-Key header required.
 * The owner's signed consent. The server verifies it, reserves testnet sponsorship, creates the account and verifies
 * it on NEAR. Any status in the body is refused.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => {
    rateLimit(req, "agent-account-create", 5, 60_000, userId);
    const idempotencyKey = idempotencyKeySchema.parse(req.headers.get("idempotency-key"));
    const b = z.object({ challengeId: z.string().regex(/^aac_[0-9a-f]{24}$/), accountId: z.string().min(2).max(64), publicKey: z.string().max(100), signature: z.string().max(200) }).strict().parse(await req.json());
    return NextResponse.json({ account: await (await agentAccountService()).create(userId, agentIdParam((await ctx.params).id), { ...b, idempotencyKey: `${userId}:${idempotencyKey}`, domain: agentDomain(req) }) });
  });
}
