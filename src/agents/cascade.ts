import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { agentEvents, agentWalletChallenges, agentWallets } from "../database/schema";
import { cascadeAgentAccount } from "./accounts";

/**
 * How an Agent's lifecycle change applies to its wallet associations. Runs inside the Agent's own state-change
 * transaction, so the Agent and its associations never disagree.
 * - SUSPENDED: live associations are suspended; open association challenges are closed.
 * - REVOKED: every association is revoked (history is kept).
 * - VERIFIED after a suspension: nothing changes. Suspended associations need a fresh wallet signature each.
 */
export async function cascadeAgentStatus(tx: Db, a: { id: string; userId: string }, from: string, to: string, now: Date) {
  await cascadeAgentAccount(tx, a, from, to, now);
  const log = async (rows: { id: string }[], event: string, toStatus: string) => {
    for (const r of rows) await tx.insert(agentEvents).values({ agentId: a.id, userId: a.userId, event, fromStatus: null, toStatus, data: { associationId: r.id, cause: `AGENT_${to}` }, at: now });
  };
  if (to === "SUSPENDED" || to === "REVOKED") {
    await tx.update(agentWalletChallenges).set({ usedAt: now, outcome: "FAILED" })
      .where(and(eq(agentWalletChallenges.agentId, a.id), isNull(agentWalletChallenges.usedAt)));
  }
  if (to === "SUSPENDED") {
    const rows = await tx.update(agentWallets).set({ status: "SUSPENDED", updatedAt: now })
      .where(and(eq(agentWallets.agentId, a.id), inArray(agentWallets.status, ["ACTIVE", "PENDING"]))).returning({ id: agentWallets.id });
    await log(rows, "WALLET_SUSPENDED", "SUSPENDED");
  } else if (to === "REVOKED") {
    const rows = await tx.update(agentWallets).set({ status: "REVOKED", revokedAt: now, revokeReason: "AGENT_REVOKED", updatedAt: now })
      .where(and(eq(agentWallets.agentId, a.id), inArray(agentWallets.status, ["PENDING", "ACTIVE", "SUSPENDED", "EXPIRED"]))).returning({ id: agentWallets.id });
    await log(rows, "WALLET_REVOKED", "REVOKED");
  }
  // Agent re-verified after a suspension: associations stay SUSPENDED. A fresh Agent proof does not show the user
  // still controls each wallet, so every association needs its own fresh wallet signature to become ACTIVE again.
}
