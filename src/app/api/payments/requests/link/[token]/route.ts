import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/** GET /api/payments/requests/link/:token  Public: what the link asks for and whether it is still open. Never who made it. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handle(req, async () => {
    await rateLimit(req, "requests-public", 60, 60_000);
    return NextResponse.json(await (await spak()).requests.publicView((await ctx.params).token), { headers: { "cache-control": "no-store" } });
  });
}
