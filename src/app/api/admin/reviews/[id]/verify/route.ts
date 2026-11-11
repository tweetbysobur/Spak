import { NextResponse } from "next/server";
import { z } from "zod";
import { adminHandle } from "@/server/admin";
import { idSchema } from "@/server/execution";
import { spak } from "@/server/spak";

const body = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

/** POST /api/admin/reviews/:id/verify  Ask SPak to re-run refund verification. The outcome is SPak's, not the reviewer's. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return adminHandle(req, async (actor) => {
    const b = body.parse(await req.json());
    return NextResponse.json(await (await spak()).reviews.requestVerification(actor, idSchema("rev").parse((await ctx.params).id), b.reason));
  });
}
