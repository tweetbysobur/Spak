import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, requireUser } from "@/server/auth";
import { idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** DELETE /api/guard/recipients/:id  { version }  Remove one of the signed-in user's approved recipients. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const u = await requireUser(req);
    rateLimit(req, "guard-write", 30, 60_000, u.userId);
    const id = idSchema("grc").parse((await ctx.params).id);
    const b = z.object({ version: z.number() }).parse(await req.json());
    return NextResponse.json(await (await spak()).guard.removeRecipient(u.userId, id, b.version));
  });
}
