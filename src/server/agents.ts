import "server-only";
import { NextResponse } from "next/server";
import { getDb } from "@/database";
import { AgentError, AgentService } from "@/agents/service";
import { AgentWalletService } from "@/agents/wallets";
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
