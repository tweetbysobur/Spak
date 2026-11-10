import { NextResponse } from "next/server";
import { z } from "zod";
import { authService, requireUser, route } from "@/server/auth";

/** GET /api/agent/identity  The user's SPak Agent identity. */
export async function GET(req: Request) {
  return route(req, async () => {
    const u = await requireUser(req);
    return NextResponse.json(await (await authService()).getAgentIdentity(u.userId));
  });
}

/**
 * POST /api/agent/identity  { walletId }  Use a verified NEAR wallet as the agent account.
 * Foundation only: no keys are created and nothing signs on the user's behalf.
 */
export async function POST(req: Request) {
  return route(req, async () => {
    const u = await requireUser(req);
    const { walletId } = z.object({ walletId: z.string().min(1).max(64) }).parse(await req.json());
    return NextResponse.json(await (await authService()).linkAgentAccount(u.userId, walletId));
  });
}

/** DELETE /api/agent/identity  Unlink. */
export async function DELETE(req: Request) {
  return route(req, async () => {
    const u = await requireUser(req);
    return NextResponse.json(await (await authService()).unlinkAgentAccount(u.userId));
  });
}
