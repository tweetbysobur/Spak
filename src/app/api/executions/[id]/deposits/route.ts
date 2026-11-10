import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/executions/:id/deposits  Deposit instructions (once approved) and the deposit attempts. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    const id = idSchema("exe").parse((await ctx.params).id);
    const s = await spak();
    const ex = await s.execution.details(id, c.userId);
    return NextResponse.json({ instructions: ex.deposit, deposits: await s.deposits.list(c.userId, { limit: 20, executionId: id }) });
  });
}

/**
 * POST /api/executions/:id/deposits  Prepare the deposit transaction for the user's wallet.
 * Server-built from the approved firm quote; returns the transaction, the steps to show, and the sender balance.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const c = await executionContext(req);
    rateLimit(req, "deposit-prepare", 20, 60_000, c.userId);
    const id = idSchema("exe").parse((await ctx.params).id);
    const s = await spak();
    const r = await s.deposits.prepare({ userId: c.userId, executionId: id, wallets: c.wallets });
    return NextResponse.json({ deposit: await s.deposits.get(c.userId, r.deposit.id), transaction: r.transaction, balance: r.balance });
  });
}
