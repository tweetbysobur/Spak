import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/**
 * POST /api/payments/requests/link/:token/pay  { sourceNetwork, sourceAssetId }  Signed-in payer only.
 * Prepares a normal payment for review: nothing is approved or signed here.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    await rateLimit(req, "requests-pay", 10, 60_000, c.userId);
    const s = await spak();
    const r = await s.requests.preparePayment(c.userId, (await ctx.params).token, await req.json());
    return NextResponse.json({ intent: r.intent, execution: await s.execution.details(r.execution.id, c.userId), quote: r.quote ? await s.execution.quote(r.quote.id, c.userId) : null, sizing: r.sizing });
  });
}
