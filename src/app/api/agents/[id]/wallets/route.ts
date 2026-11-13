import { NextResponse } from "next/server";
import { agentRoute, agentWalletService } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** GET /api/agents/:id/wallets  The Agent's wallet associations (all states, newest first). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => NextResponse.json({ items: await (await agentWalletService()).list(userId, agentIdParam((await ctx.params).id)) }));
}
