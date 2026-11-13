import { NextResponse } from "next/server";
import { z } from "zod";
import { agentRoute, agentWalletService } from "@/server/agents";
import { agentIdParam, associationIdParam } from "@/server/agent-ids";

type Ctx = { params: Promise<{ id: string; associationId: string }> };

/** GET /api/agents/:id/wallets/:associationId */
export async function GET(req: Request, ctx: Ctx) {
  return agentRoute(req, async (userId) => {
    const p = await ctx.params;
    return NextResponse.json({ association: await (await agentWalletService()).get(userId, agentIdParam(p.id), associationIdParam(p.associationId)) });
  });
}

/** DELETE /api/agents/:id/wallets/:associationId  { reason: "REMOVED" | "COMPROMISED" }  Immediate and final. */
export async function DELETE(req: Request, ctx: Ctx) {
  return agentRoute(req, async (userId) => {
    const p = await ctx.params;
    const b = z.object({ reason: z.enum(["REMOVED", "COMPROMISED"]).default("REMOVED") }).strict().parse(await req.json().catch(() => ({})));
    return NextResponse.json({ association: await (await agentWalletService()).remove(userId, agentIdParam(p.id), associationIdParam(p.associationId), b.reason) });
  });
}
