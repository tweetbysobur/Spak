import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

const body = z.object({ txHash: z.string().trim().min(10).max(120) }).strict();

/**
 * POST /api/executions/:id/refund/transactions  Submit a refund transaction hash seen in the wallet.
 * Idempotent per hash. SPak verifies it on chain; submitting it never marks anything refunded by itself. Owner only.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    rateLimit(req, "exec-refund-submit", 10, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const { txHash } = body.parse(await req.json());
    return NextResponse.json(await (await spak()).failures.submitRefundTx(c.userId, id, txHash));
  });
}
