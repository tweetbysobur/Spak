import "server-only";
import { NextResponse } from "next/server";
import { getDb } from "@/database";
import { AgentError, AgentService } from "@/agents/service";
import { AgentWalletService } from "@/agents/wallets";
import { AgentAccountService } from "@/agents/accounts";
import { AgentFundingService } from "@/agents/funding";
import { agentAccountConfig, nearTestnetChain, nearTestnetReader } from "@/agents/near-chain";
import { appOrigin, requireUser, route } from "./auth";

const g = globalThis as unknown as { __spakAgents?: Promise<AgentService> };
export const agentService = () => (g.__spakAgents ??= getDb().then((db) => new AgentService(db)));

/** The host the user's wallet signs for. Taken from the server's own configured origin, never from the request body. */
export const agentDomain = (req: Request) => appOrigin(req).host;

/** Wrapper for Agent routes: CSRF and auth from route(), Agent errors as JSON with their status. */
export function agentRoute(req: Request, fn: (userId: string) => Promise<Response>): Promise<Response> {
  return route(req, async () => {
    const u = await requireUser(req);
    try { return await fn(u.userId); } catch (e) {
      if (e instanceof AgentError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      throw e;
    }
  });
}

const gw = globalThis as unknown as { __spakAgentWallets?: Promise<AgentWalletService> };
export const agentWalletService = () => (gw.__spakAgentWallets ??= getDb().then((db) => new AgentWalletService(db)));
/** The URI wallets sign for: the server's configured origin. */
export const agentUri = (req: Request) => appOrigin(req).origin;

const ga = globalThis as unknown as { __spakAgentAccounts?: Promise<AgentAccountService> };
/**
 * Dedicated Agent accounts. Testnet only: the config refuses anything else, and without a complete testnet config
 * the feature reports itself unavailable. The parent key stays in the server environment and goes only to the signer.
 */
export const agentAccountService = () => (ga.__spakAgentAccounts ??= getDb().then((db) => {
  const config = agentAccountConfig();
  const chain = "unavailable" in config ? null : nearTestnetChain(config, process.env.SPAK_AGENT_PARENT_PRIVATE_KEY!);
  return new AgentAccountService({ db, config, chain });
}));

const gf = globalThis as unknown as { __spakAgentFunding?: Promise<AgentFundingService> };
/** Funding reads only: public view_account on NEAR testnet. No key is loaded or needed for it. */
export const agentFundingService = () => (gf.__spakAgentFunding ??= getDb().then((db) => new AgentFundingService({ db, chain: nearTestnetReader() })));
