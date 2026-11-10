import { NextResponse } from "next/server";
import { z } from "zod";
import { adminHandle } from "@/server/admin";
import { idSchema } from "@/server/execution";
import { spak } from "@/server/spak";
import { REVIEW_RESOLUTIONS } from "@/failures";

const body = z.object({ resolution: z.enum(REVIEW_RESOLUTIONS), note: z.string().trim().min(3).max(4000), evidence: z.record(z.unknown()) }).strict();

/** POST /api/admin/reviews/:id/resolve  Close a case with a documented reason. Never changes the execution state. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return adminHandle(req, async (reviewer) => {
    const b = body.parse(await req.json());
    return NextResponse.json(await (await spak()).reviews.resolve(idSchema("rev").parse((await ctx.params).id), reviewer, b.resolution, b.note, b.evidence));
  });
}
