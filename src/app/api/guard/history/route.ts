import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/** GET /api/guard/history?limit=50  The signed-in user's Guard policy changes, newest first. */
export async function GET(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(new URL(req.url).searchParams.get("limit") ?? undefined);
    return NextResponse.json({ items: await (await spak()).guard.history(u.userId, limit) });
  });
}
