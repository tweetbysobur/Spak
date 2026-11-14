import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/** POST /api/guard/resume  { version }  Lift a pause and turn execution back on. */
export async function POST(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "guard-write", 30, 60_000, u.userId);
    const b = z.object({ version: z.number() }).parse(await req.json());
    return NextResponse.json(await (await spak()).guard.resume(u.userId, b.version));
  });
}
