import { NextResponse } from "next/server";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/**
 * GET  /api/payments/schedules  The user's recurring payment schedules with their payments. Opening the list also
 *      prepares any of the user's payments that are due (the daily job does the same for everyone).
 * POST /api/payments/schedules  Create a schedule. Every field is validated on the server and one payment is planned
 *      as a check. A schedule prepares payments; it never signs or approves a deposit.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "schedules-read", 60, 60_000, u.userId);
    const s = (await spak()).schedules;
    await s.processDue({ userId: u.userId, limit: 5 });
    return NextResponse.json({ schedules: await s.list(u.userId) }, { headers: { "cache-control": "no-store" } });
  });
}
export async function POST(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "schedules-write", 20, 60_000, u.userId);
    return NextResponse.json(await (await spak()).schedules.create(u.userId, await req.json()), { status: 201 });
  });
}
