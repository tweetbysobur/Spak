import { NextResponse } from "next/server";
import { agentAccountService, agentRoute } from "@/server/agents";
import { agentIdParam } from "@/server/agent-ids";

/** GET /api/agents/:id/account  Availability and the Agent's dedicated NEAR account (testnet), with failed attempts. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(req, async (userId) => NextResponse.json(await (await agentAccountService()).view(userId, agentIdParam((await ctx.params).id))));
}
