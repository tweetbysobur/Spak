import type { Db } from "../database/repositories";
import { ExecutionError } from "../execution/errors";
import type { AgentGate } from "../execution/service";
import { ACTING_MESSAGE, actingProblem, loadAgent } from "./authority";

/**
 * The execution engine's view of Agent authority (Stage 9). Reads the Agent row from the database on every call:
 * owned by this user, VERIFIED, ownership proof in date. Anything else refuses, including a failed read.
 */
export class DbAgentGate implements AgentGate {
  private readonly clock: () => Date;
  constructor(private readonly db: Db, clock?: () => Date) { this.clock = clock ?? (() => new Date()); }
  async assertCanAct(userId: string, agentId: string): Promise<void> {
    let problem;
    try { problem = actingProblem(await loadAgent(this.db, userId, agentId), userId, this.clock()); } catch (e) {
      console.error("[spak-agent] authority check failed", e);
      throw new ExecutionError("AGENT_NOT_AUTHORIZED", "SPak could not confirm your Agent, so it did not act. Try again.");
    }
    if (problem) throw new ExecutionError("AGENT_NOT_AUTHORIZED", ACTING_MESSAGE[problem], { reason: problem });
  }
}
