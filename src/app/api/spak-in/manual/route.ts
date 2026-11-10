import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { handle, spak, spakContext } from "@/server/spak";

/** POST /api/spak-in/manual  Manual Access form. Same validation, policy and planning as chat. */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = await req.json();
    const ctx = await spakContext(req, body?.sessionId);
    rateLimit(req, "interpret", 60, 60_000, ctx.userId);
    const result = await (await spak()).engine.interpretManual({
      text: "", intent: body?.intent, sessionId: ctx.sessionId, userId: ctx.userId, wallets: ctx.wallets, mode: "MANUAL",
      policy: { ...(body?.policy ?? {}), autonomous: { enabled: false } },
    });
    return NextResponse.json(result);
  });
}
