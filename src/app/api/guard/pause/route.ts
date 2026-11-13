import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/**
 * POST /api/guard/pause  { scope: "REQUESTS" | "ALL" }
 * REQUESTS: no new transfers. ALL: also no deposit instructions for transfers already approved.
 * Transfers already in flight keep being tracked, verified and refunded either way.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    rateLimit(req, "guard-write", 30, 60_000, u.userId);
    const b = z.object({ scope: z.enum(["REQUESTS", "ALL"]).default("REQUESTS") }).parse(await req.json().catch(() => ({})));
    return NextResponse.json(await (await spak()).guard.pause(u.userId, b.scope));
  });
}
