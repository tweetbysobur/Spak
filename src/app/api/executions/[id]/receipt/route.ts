import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";
import { ExecutionError } from "@/execution/errors";
import { buildReceipt } from "@/tracking/receipt";

/**
 * GET /api/executions/:id/receipt  The receipt of a completed transfer or payment. Owner only; reads only.
 * 409 RECEIPT_NOT_AVAILABLE until SPak has verified delivery on the destination chain.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "exec-receipt", 60, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const s = await spak();
    const x = await s.execution.details(id, c.userId);
    const t = await s.tracking.view(c.userId, id);
    const a = await s.execution.approvalFor(id, c.userId);
    const receipt = buildReceipt(x, t, a);
    if (!receipt) throw new ExecutionError("RECEIPT_NOT_AVAILABLE", "A receipt is issued only after SPak verifies delivery on the destination chain.", { state: x.state });
    return NextResponse.json(receipt, { headers: { "cache-control": "no-store" } });
  });
}
