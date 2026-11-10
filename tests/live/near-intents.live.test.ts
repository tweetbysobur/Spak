/**
 * Live check against the real NEAR Intents 1Click API. Dry quotes only: no deposit address, no funds.
 *   LIVE=1 npx vitest run tests/live
 */
import { describe, expect, it } from "vitest";
import { NearIntentsProvider } from "@/integrations/near-intents";
import { ExecutionCoordinator, SpakIn } from "@/spak-in";
import { WALLETS } from "../helpers";

describe("NEAR Intents live (dry quote)", () => {
  it("quotes a SPak-in plan end to end", async () => {
    const r = await new SpakIn().interpret({ text: "Swap 50 USDC on Base to SOL on Solana", wallets: WALLETS });
    expect(r.status).toBe("VALIDATED");
    const c = new ExecutionCoordinator({ providers: [new NearIntentsProvider({ jwt: process.env.ONECLICK_JWT })] });
    const q = await c.quote(r.plan);
    if (!q.ok) throw new Error(q.error.message);
    console.log("live quote:", JSON.stringify(q.value));
    expect(Number(q.value.amountOut)).toBeGreaterThan(0);
  });
});
