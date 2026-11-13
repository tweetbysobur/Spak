import { NextResponse } from "next/server";
import { agentRoute, agentWalletService } from "@/server/agents";
import { agentIdParam, associationIdParam } from "@/server/agent-ids";

/** GET /api/agents/:id/wallets/:associationId/events  The association's audit history, oldest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; associationId: string }> }) {
  return agentRoute(req, async (userId) => {
    const p = await ctx.params;
    return NextResponse.json({ items: await (await agentWalletService()).events(userId, agentIdParam(p.id), associationIdParam(p.associationId)) });
  });
}
