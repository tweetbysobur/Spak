import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/** POST /api/payments/occurrences/:id/retry  Owner only. Prepares a missed or failed date, or a fresh attempt after an expired, cancelled or refunded one. One attempt at a time. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "schedules-write", 20, 60_000, u.userId);
    const id = z.string().regex(/^occ_[0-9a-f]{24}$/).parse((await ctx.params).id);
    return NextResponse.json(await (await spak()).schedules.retry(u.userId, id));
  });
}
