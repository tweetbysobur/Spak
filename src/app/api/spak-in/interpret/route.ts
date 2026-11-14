import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { guardedInterpret, handle, spak, spakContext } from "@/server/spak";

/**
 * POST /api/spak-in/interpret  (signed-in users only)
 * Body: { text, sessionId?, timezone?, mode?, transactions? }
 * Wallet context comes from the user's verified wallets; client-sent wallets are ignored.
 * Guard settings, spending and prices come from the server; `policy` and `runtime` in the body are ignored.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = await req.json();
    const ctx = await spakContext(req, body?.sessionId);
    await rateLimit(req, "interpret", 60, 60_000, ctx.userId);
    const engine = (await spak()).engine;
    const result = await guardedInterpret(ctx.userId, (g) => engine.interpret({
      text: body?.text, timezone: body?.timezone, transactions: body?.transactions,
      sessionId: ctx.sessionId, userId: ctx.userId, wallets: ctx.wallets,
      // Agent mode needs a linked NEAR agent identity. Autonomy stays off in this milestone either way.
      mode: body?.mode === "AGENT" && ctx.agentLinked ? "AGENT" : "MANUAL",
      policy: g.policy, runtime: g.runtime,
    }));
    return NextResponse.json(result);
  });
}
