import { NextResponse } from "next/server";
import { adminHandle } from "@/server/admin";
import { idSchema } from "@/server/execution";
import { spak } from "@/server/spak";

/** GET /api/admin/reviews/:id  Full evidence for a case. Reviewer token only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return adminHandle(req, async () => NextResponse.json(await (await spak()).reviews.get(idSchema("rev").parse((await ctx.params).id))));
}
