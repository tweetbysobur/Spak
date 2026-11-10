import { NextResponse } from "next/server";
import { handle, spak, userIdFrom } from "@/server/spak";

/**
 * POST /api/spak-in/interpret
 * Body: InterpretRequest minus userId (taken from the session) and minus autonomy (not yet configurable over HTTP).
 * Returns: IntentResult.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    const result = await spak().engine.interpret({
      ...body,
      userId: userIdFrom(req) ?? undefined,
      // Guard settings will come from the user's stored SPak Agent profile. Until then autonomy stays off.
      mode: "MANUAL",
      policy: { ...(body?.policy ?? {}), autonomous: { enabled: false } },
    });
    return NextResponse.json(result);
  });
}
