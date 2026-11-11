import { NextResponse } from "next/server";
import { z } from "zod";
import { adminHandle } from "@/server/admin";
import { idSchema } from "@/server/execution";
import { spak } from "@/server/spak";

const body = z.object({ note: z.string().trim().min(3).max(4000), evidence: z.record(z.unknown()).default({}) }).strict();

/** POST /api/admin/reviews/:id/notes  Append a note with evidence. History is append-only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return adminHandle(req, async (actor) => {
    const b = body.parse(await req.json());
    return NextResponse.json(await (await spak()).reviews.note(actor, idSchema("rev").parse((await ctx.params).id), b.note, b.evidence));
  });
}
