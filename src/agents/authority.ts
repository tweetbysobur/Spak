import { and, eq } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { agents } from "../database/schema";
import { ownershipCurrent } from "./service";

export type AgentRow = typeof agents.$inferSelect;

/** Why an Agent cannot act right now. Null means it can. */
export type AgentActingProblem = "AGENT_NOT_FOUND" | "AGENT_REVOKED" | "AGENT_SUSPENDED" | "AGENT_NOT_VERIFIED" | "AGENT_OWNERSHIP_EXPIRED";

export const ACTING_MESSAGE: Record<AgentActingProblem, string> = {
  AGENT_NOT_FOUND: "No such Agent.",
  AGENT_REVOKED: "This Agent was revoked. It cannot act for you.",
  AGENT_SUSPENDED: "This Agent is suspended. Verify ownership again before it acts for you.",
  AGENT_NOT_VERIFIED: "Verify ownership of this Agent before it acts for you.",
  AGENT_OWNERSHIP_EXPIRED: "This Agent's ownership proof expired. Verify ownership again before it acts for you.",
};

/** Pure: can this Agent row act for this user now? Fails closed on anything other than VERIFIED with a current proof. */
export function actingProblem(a: Pick<AgentRow, "userId" | "status" | "verificationExpiresAt" | "ownerPublicKey"> | null | undefined, userId: string, now: Date): AgentActingProblem | null {
  if (!a || a.userId !== userId) return "AGENT_NOT_FOUND";
  if (a.status === "REVOKED") return "AGENT_REVOKED";
  if (a.status === "SUSPENDED") return "AGENT_SUSPENDED";
  if (a.status !== "VERIFIED" || !a.ownerPublicKey) return "AGENT_NOT_VERIFIED";
  if (!ownershipCurrent(a, now)) return "AGENT_OWNERSHIP_EXPIRED";
  return null;
}

/** Read (optionally lock) the user's Agent row. Another user's Agent reads as missing. */
export async function loadAgent(q: Db, userId: string, agentId: string, lock = false): Promise<AgentRow | null> {
  const base = q.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.userId, userId))).limit(1);
  const [a] = lock ? await base.for("update") : await base;
  return a ?? null;
}
