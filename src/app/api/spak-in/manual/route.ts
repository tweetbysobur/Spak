import { NextResponse } from "next/server";
import { handle, spak, userIdFrom } from "@/server/spak";

/** POST /api/spak-in/manual  Manual Access form fields. Same validation, policy and planning as chat. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json();
    const result = await spak().engine.interpretManual({
      ...body, text: "", userId: userIdFrom(req) ?? undefined, mode: "MANUAL",
      policy: { ...(body?.policy ?? {}), autonomous: { enabled: false } },
    });
    return NextResponse.json(result);
  });
}
