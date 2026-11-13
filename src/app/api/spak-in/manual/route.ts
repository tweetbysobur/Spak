import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { guardedInterpret, handle, spak, spakContext } from "@/server/spak";

/**
 * POST /api/spak-in/manual  Manual Access form. Same validation, policy and planning as chat.
 * Body: { intent, sessionId? }. Guard settings come from the user's stored policy; a `policy` in the body is ignored.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = await req.json();
    const ctx = await spakContext(req, body?.sessionId);
    rateLimit(req, "interpret", 60, 60_000, ctx.userId);
    const engine = (await spak()).engine;
    const result = await guardedInterpret(ctx.userId, (g) => engine.interpretManual({
      text: "", intent: body?.intent, sessionId: ctx.sessionId, userId: ctx.userId, wallets: ctx.wallets, mode: "MANUAL",
      policy: g.policy, runtime: g.runtime,
    }));
    return NextResponse.json(result);
  });
}
