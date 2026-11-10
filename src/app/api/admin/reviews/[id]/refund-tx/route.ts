import { NextResponse } from "next/server";
import { z } from "zod";
import { adminHandle } from "@/server/admin";
import { idSchema } from "@/server/execution";
import { spak } from "@/server/spak";

const body = z.object({ txHash: z.string().trim().min(10).max(120), note: z.string().trim().min(3).max(4000) }).strict();

/** POST /api/admin/reviews/:id/refund-tx  Attach a refund transaction found during review. SPak verifies it on chain. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return adminHandle(req, async (reviewer) => {
    const b = body.parse(await req.json());
    return NextResponse.json(await (await spak()).reviews.attachRefundTx(idSchema("rev").parse((await ctx.params).id), reviewer, b.txHash, b.note));
  });
}
