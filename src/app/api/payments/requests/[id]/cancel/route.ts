import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/** POST /api/payments/requests/:id/cancel  Payee only. An open request stops being payable. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "requests-write", 20, 60_000, u.userId);
    const id = z.string().regex(/^prq_[0-9a-f]{24}$/).parse((await ctx.params).id);
    return NextResponse.json(await (await spak()).requests.cancel(u.userId, id));
  });
}
