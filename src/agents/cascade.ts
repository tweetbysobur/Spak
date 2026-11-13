import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { agentEvents, agentWalletChallenges, agentWallets } from "../database/schema";
import { cascadeAgentAccount } from "./accounts";

/**
 * How an Agent's lifecycle change applies to its wallet associations. Runs inside the Agent's own state-change
 * transaction, so the Agent and its associations never disagree.
 * - SUSPENDED: live associations are suspended; open association challenges are closed.
 * - REVOKED: every association is revoked (history is kept).
 * - VERIFIED after a suspension: associations suspended with the Agent return to ACTIVE if still in date, else EXPIRED.
 *   (Expired ones never come back without a fresh wallet signature.)
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
  } else if (to === "VERIFIED" && from === "SUSPENDED") {
    const back = await tx.update(agentWallets).set({ status: "ACTIVE", updatedAt: now })
      .where(and(eq(agentWallets.agentId, a.id), eq(agentWallets.status, "SUSPENDED"), gt(agentWallets.expiresAt, now))).returning({ id: agentWallets.id });
    await log(back, "WALLET_RESTORED_WITH_AGENT", "ACTIVE");
    const stale = await tx.update(agentWallets).set({ status: "EXPIRED", updatedAt: now })
      .where(and(eq(agentWallets.agentId, a.id), eq(agentWallets.status, "SUSPENDED"), lte(agentWallets.expiresAt, now))).returning({ id: agentWallets.id });
    await log(stale, "WALLET_EXPIRED", "EXPIRED");
    // Suspended before they were ever verified: they need a fresh proof, so they are closed.
    const never = await tx.update(agentWallets).set({ status: "REVOKED", revokedAt: now, revokeReason: "UNVERIFIED_AT_SUSPENSION", updatedAt: now })
      .where(and(eq(agentWallets.agentId, a.id), eq(agentWallets.status, "SUSPENDED"))).returning({ id: agentWallets.id });
    await log(never, "WALLET_REVOKED", "REVOKED");
  }
}
