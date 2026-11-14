import { NextResponse } from "next/server";
import { authService, rateLimit } from "@/server/auth";
import type { IntelligenceContext } from "@/intelligence/service";
import { guardedInterpret, handle, spak, spakContext } from "@/server/spak";

/**
 * POST /api/spak-in/interpret  (signed-in users only)
 * Body: { text, sessionId?, timezone?, mode?, transactions? }
 * Wallet context comes from the user's verified wallets; client-sent wallets are ignored.
 * Guard settings, spending and prices come from the server; `policy` and `runtime` in the body are ignored.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = await req.json();
    const ctx = await spakContext(req, body?.sessionId);
    await rateLimit(req, "interpret", 60, 60_000, ctx.userId);
    const engine = (await spak()).engine;
    const result = await guardedInterpret(ctx.userId, (g) => engine.interpret({
      text: body?.text, timezone: body?.timezone, transactions: body?.transactions,
      sessionId: ctx.sessionId, userId: ctx.userId, wallets: ctx.wallets,
      // Agent mode needs a linked NEAR agent identity. Autonomy stays off in this milestone either way.
      mode: body?.mode === "AGENT" && ctx.agentLinked ? "AGENT" : "MANUAL",
      policy: g.policy, runtime: g.runtime,
    }));
    // SPak Intelligence adds portfolio facts after the deterministic interpretation; it never changes the plan.
    let intelligence: IntelligenceContext | null = null;
    const relevant = result.intentType === "PORTFOLIO_QUERY" || ["BRIDGE", "CROSS_CHAIN_SWAP", "CROSS_CHAIN_TRANSFER", "SWAP", "PAYMENT"].includes(result.intentType);
    if (relevant) {
      try {
        const wallets = await (await authService()).listWallets(ctx.userId);
        const intel = (await spak()).intelligence;
        const snap = await Promise.race([intel.snapshot(ctx.userId, wallets), new Promise<null>((r) => setTimeout(() => r(null), 12_000))]);
        intelligence = snap ? intel.context(result, snap.snapshot, snap.cached) : { kind: "UNAVAILABLE", text: "Your balances are still loading. Ask again in a moment." };
      } catch {
        intelligence = { kind: "UNAVAILABLE", text: "SPak could not read your balances just now. Nothing about this request depends on them yet." };
      }
    }
    return NextResponse.json({ ...result, intelligence });
  });
}
