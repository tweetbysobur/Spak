import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { handle, spak, spakContext } from "@/server/spak";

/**
 * POST /api/spak-in/interpret  (signed-in users only)
 * Body: { text, sessionId?, timezone?, mode?, policy?, runtime?, transactions? }
 * Wallet context comes from the user's verified wallets; client-sent wallets are ignored.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = await req.json();
    const ctx = await spakContext(req, body?.sessionId);
    rateLimit(req, "interpret", 60, 60_000, ctx.userId);
    const result = await (await spak()).engine.interpret({
      text: body?.text, timezone: body?.timezone, transactions: body?.transactions, runtime: body?.runtime,
      sessionId: ctx.sessionId, userId: ctx.userId, wallets: ctx.wallets,
      // Agent mode needs a linked NEAR agent identity. Autonomy stays off in this milestone either way.
      mode: body?.mode === "AGENT" && ctx.agentLinked ? "AGENT" : "MANUAL",
      policy: { ...(body?.policy ?? {}), autonomous: { enabled: false } },
    });
    return NextResponse.json(result);
  });
}
