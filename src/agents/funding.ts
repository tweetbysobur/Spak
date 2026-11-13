import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { agentAccounts, agentEvents, agentFundingChecks } from "../database/schema";
import { AgentError } from "./service";
import { actingProblem, ACTING_MESSAGE, loadAgent } from "./authority";
import { STORAGE_YOCTO_PER_BYTE } from "./accounts";
import type { AgentNearChain } from "./near-chain";

/** Spendable NEAR the account must hold to count as funded: 0.01 NEAR above its storage reserve, enough for gas on a few calls. */
export const MIN_FUNDED_YOCTO = "10000000000000000000000";

export type FundingResult = "FUNDED" | "UNFUNDED" | "INCONCLUSIVE";
export type FundingReason = "BELOW_MINIMUM" | "ACCOUNT_NOT_FOUND" | "NEAR_UNREACHABLE" | "UNREADABLE_BALANCE";

export interface FundingView {
  result: FundingResult; reason: FundingReason | null; network: string; accountId: string;
  balanceYocto: string | null; lockedYocto: string | null; storageUsage: number | null; spendableYocto: string | null; minimumYocto: string;
  checkedAt: string; source: "NEAR_RPC_VIEW_ACCOUNT";
}

/**
 * Pure funding assessment from what NEAR returned. Exact integer math in yoctoNEAR. Unreadable or missing data is
 * never FUNDED: a missing account is UNFUNDED with a reason, a failed read is INCONCLUSIVE.
 */
export function assessFunding(view: { amount: string; locked?: string; storageUsage?: number } | null | "UNREACHABLE", minimumYocto = MIN_FUNDED_YOCTO): { result: FundingResult; reason: FundingReason | null; spendableYocto: string | null } {
  if (view === "UNREACHABLE") return { result: "INCONCLUSIVE", reason: "NEAR_UNREACHABLE", spendableYocto: null };
  if (view === null) return { result: "UNFUNDED", reason: "ACCOUNT_NOT_FOUND", spendableYocto: null };
  if (!/^\d+$/.test(view.amount) || (view.storageUsage !== undefined && !(Number.isInteger(view.storageUsage) && view.storageUsage >= 0))) {
    return { result: "INCONCLUSIVE", reason: "UNREADABLE_BALANCE", spendableYocto: null };
  }
  const reserve = BigInt(view.storageUsage ?? 0) * STORAGE_YOCTO_PER_BYTE;
  const raw = BigInt(view.amount) - reserve;
  const spendable = raw > 0n ? raw : 0n;
  return spendable >= BigInt(minimumYocto)
    ? { result: "FUNDED", reason: null, spendableYocto: spendable.toString() }
    : { result: "UNFUNDED", reason: "BELOW_MINIMUM", spendableYocto: spendable.toString() };
}

const toView = (r: typeof agentFundingChecks.$inferSelect): FundingView => ({
  result: r.result as FundingResult, reason: r.reason as FundingReason | null, network: r.network, accountId: r.accountId,
  balanceYocto: r.balanceYocto, lockedYocto: r.lockedYocto, storageUsage: r.storageUsage, spendableYocto: r.spendableYocto, minimumYocto: r.minimumYocto,
  checkedAt: r.checkedAt.toISOString(), source: "NEAR_RPC_VIEW_ACCOUNT",
});

/**
 * Agent account funding (Stage 9). The owner funds the dedicated account from their own wallet: SPak signs nothing
 * and holds no key on it. SPak only reads the balance from NEAR and records what it saw, bound to the Agent, its
 * owner and the exact account. The browser's idea of a balance is never used.
 */
export class AgentFundingService {
  private readonly clock: () => Date;
  constructor(private readonly d: { db: Db; chain: Pick<AgentNearChain, "viewAccount"> | null; clock?: () => Date; minimumYocto?: string }) {
    this.clock = d.clock ?? (() => new Date());
  }

  private async activeAccount(userId: string, agentId: string) {
    const a = await loadAgent(this.d.db, userId, agentId);
    if (!a) throw new AgentError("AGENT_NOT_FOUND", "No such Agent.");
    const problem = actingProblem(a, userId, this.clock());
    if (problem) throw new AgentError(problem === "AGENT_REVOKED" ? "AGENT_REVOKED" : "AGENT_INVALID_STATE", ACTING_MESSAGE[problem]);
    const [acct] = await this.d.db.select().from(agentAccounts)
      .where(and(eq(agentAccounts.agentId, agentId), eq(agentAccounts.userId, userId), eq(agentAccounts.status, "ACTIVE"))).limit(1);
    if (!acct) throw new AgentError("AGENT_INVALID_STATE", "This Agent has no active dedicated NEAR account to fund.");
    if (acct.ownerPublicKey !== a.ownerPublicKey) throw new AgentError("AGENT_INVALID_STATE", "The account's owner key does not match the Agent's verified key. Re-verify the account.");
    return { a, acct };
  }

  /** The latest recorded observation, or null. Reading history never calls NEAR. */
  async latest(userId: string, agentId: string): Promise<FundingView | null> {
    const [r] = await this.d.db.select().from(agentFundingChecks)
      .where(and(eq(agentFundingChecks.agentId, agentId), eq(agentFundingChecks.userId, userId))).orderBy(desc(agentFundingChecks.checkedAt)).limit(1);
    return r ? toView(r) : null;
  }

  /** Read the balance on NEAR now and record it. FUNDED only from a successful read. */
  async check(userId: string, agentId: string): Promise<FundingView> {
    const { acct } = await this.activeAccount(userId, agentId);
    if (!this.d.chain) throw new AgentError("AGENT_VERIFICATION_UNAVAILABLE", "SPak cannot read NEAR testnet right now, so funding was not checked.");
    let view: { amount: string; locked?: string; storageUsage?: number } | null | "UNREACHABLE";
    try { view = await this.d.chain.viewAccount(acct.accountId); } catch { view = "UNREACHABLE"; }
    const minimum = this.d.minimumYocto ?? MIN_FUNDED_YOCTO;
    const v = assessFunding(view, minimum);
    const now = this.clock();
    const raw = view && view !== "UNREACHABLE" ? view : null;
    const row = {
      id: `afc_${randomBytes(12).toString("hex")}`, agentId, userId, accountRowId: acct.id, network: acct.network, accountId: acct.accountId,
      result: v.result, reason: v.reason, balanceYocto: raw?.amount ?? null, lockedYocto: raw?.locked ?? null, storageUsage: raw?.storageUsage ?? null,
      spendableYocto: v.spendableYocto, minimumYocto: minimum, checkedAt: now,
    };
    await this.d.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      await tx.insert(agentFundingChecks).values(row);
      await tx.insert(agentEvents).values({ agentId, userId, event: `FUNDING_${v.result}`, fromStatus: null, toStatus: null, data: { accountId: acct.accountId, network: acct.network, spendableYocto: v.spendableYocto, reason: v.reason }, at: now });
    });
    return toView(row as typeof agentFundingChecks.$inferSelect);
  }
}
