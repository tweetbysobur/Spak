import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { agentRoute, agentService } from "@/server/agents";

/** GET /api/agents  The signed-in user's live Agent (or null) and revoked Agents as history. */
export async function GET(req: Request) {
  return agentRoute(req, async (userId) => NextResponse.json(await (await agentService()).current(userId)));
}

/**
 * POST /api/agents  { displayName }  Create the user's Agent identity. Grants no permission and needs no NEAR account.
 * Status, owner and verification fields cannot be sent: the body is strict.
 */
export async function POST(req: Request) {
  return agentRoute(req, async (userId) => {
    await rateLimit(req, "agent-create", 10, 60_000, userId);
    const b = z.object({ displayName: z.string().max(80) }).strict().parse(await req.json());
    return NextResponse.json({ agent: await (await agentService()).create(userId, b.displayName) }, { status: 201 });
  });
}
