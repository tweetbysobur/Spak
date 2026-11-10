import { NextResponse } from "next/server";
import { z } from "zod";
import { adminHandle } from "@/server/admin";
import { spak } from "@/server/spak";

export const dynamic = "force-dynamic";

/** GET /api/admin/reviews?status=OPEN  Review queue. Reviewer token only. */
export async function GET(req: Request) {
  return adminHandle(req, async () => {
    const status = z.enum(["OPEN", "IN_REVIEW", "RESOLVED"]).nullable().parse(new URL(req.url).searchParams.get("status"));
    return NextResponse.json({ reviews: await (await spak()).reviews.list(status) });
  });
}
