import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/** POST /api/payments/schedules/:id/resume  Owner only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "schedules-write", 20, 60_000, u.userId);
    const id = z.string().regex(/^sch_[0-9a-f]{24}$/).parse((await ctx.params).id);
    return NextResponse.json(await (await spak()).schedules.resume(u.userId, id));
  });
}
