import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { agentIdentities, authSessions, users, walletChallenges, walletNetworks, wallets } from "../database/schema";
import { listNetworks } from "../spak-in/registries/networks";
import { normalizeAddress } from "./address";
import { buildChallengeMessage } from "./messages";
import { AuthError, type ChallengePurpose, type WalletFamily } from "./types";
import { verifyEvmSignature } from "./verify/evm";
import { revokeAssociationsForWallet } from "../agents/wallets";
import { nearRpc as defaultNearRpc, verifyNearSignature, type NearRpc } from "./verify/near";
import { verifySolanaSignature } from "./verify/solana";

export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // absolute lifetime
export const SESSION_IDLE_MS = 24 * 60 * 60_000; // expires after a day without use
const TOUCH_EVERY_MS = 5 * 60_000;

export interface AuthServiceOptions {
  clock?: () => Date;
  nearRpc?: NearRpc;
}

export interface WalletView {
  id: string;
  family: WalletFamily;
  address: string;
  label: string | null;
  verifiedAt: string;
  active: boolean;
  networks: { id: string; enabled: boolean }[];
}

export interface SessionUser {
  userId: string;
  sessionId: string;
  expiresAt: string;
}

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Networks a wallet family can serve, from the SPak network registry. */
export function networksForFamily(family: WalletFamily): string[] {
  return listNetworks().filter((n) => (family === "evm" ? n.family === "evm" : n.family === family)).map((n) => n.id);
}

function isUniqueViolation(e: unknown): boolean {
  const c = (e as { code?: string; cause?: { code?: string } }) ?? {};
  return c.code === "23505" || c.cause?.code === "23505";
}

/**
 * Identity and wallet ownership. All state lives in Postgres.
 * Sign-in = prove control of a wallet by signing a one-time server-issued message. No passwords, no keys stored.
 */
export class AuthService {
  private readonly clock: () => Date;
  private readonly rpc: NearRpc;

  constructor(private readonly db: Db, opts: AuthServiceOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.rpc = opts.nearRpc ?? defaultNearRpc();
  }

  // ------------------------------------------------------------------ challenges

  async createChallenge(input: {
    family: WalletFamily; address?: string | null; purpose: ChallengePurpose; domain: string; uri: string;
    userId?: string | null; chainId?: number;
  }) {
    if (input.purpose === "LINK" && !input.userId) throw new AuthError("UNAUTHENTICATED", "Sign in before linking another wallet.");
    // NEAR wallets choose the account while signing (NEP-413 returns it). EVM and Solana must name the address up front.
    if (!input.address && input.family !== "near") throw new AuthError("INVALID_ADDRESS", `A ${input.family} address is required.`);
    const address = input.address ? normalizeAddress(input.family, input.address) : "";
    const now = this.clock();
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const message = buildChallengeMessage({ family: input.family, address, purpose: input.purpose, domain: input.domain, uri: input.uri, nonce, issuedAt: now, expiresAt, chainId: input.chainId });
    const row = {
      id: id("chl"), nonce, purpose: input.purpose, family: input.family, address, userId: input.userId ?? null,
      message, domain: input.domain, issuedAt: now, expiresAt, usedAt: null,
    };
    await this.db.insert(walletChallenges).values(row);
    // Housekeeping: drop challenges that expired over an hour ago.
    await this.db.delete(walletChallenges).where(lt(walletChallenges.expiresAt, new Date(now.getTime() - 3_600_000)));
    return {
      challengeId: row.id, message, expiresAt: expiresAt.toISOString(),
      // NEAR NEP-413 needs the 32-byte nonce and the recipient alongside the message.
      ...(input.family === "near" ? { nonce: Buffer.from(nonce, "hex").toString("base64"), recipient: input.domain } : {}),
    };
  }

  /**
   * Complete a challenge. The challenge is consumed atomically before the signature is checked,
   * so each one can be tried exactly once (replay and brute-force protection).
   */
  async verifyChallenge(input: {
    challengeId: string; signature: string; publicKey?: string; accountId?: string; currentUserId?: string | null; userAgent?: string | null;
  }): Promise<{ userId: string; walletId: string; created: boolean; session?: { token: string; expiresAt: string } }> {
    const now = this.clock();
    const [c] = await this.db.update(walletChallenges).set({ usedAt: now })
      .where(and(eq(walletChallenges.id, input.challengeId), isNull(walletChallenges.usedAt)))
      .returning();
    if (!c) {
      const [exists] = await this.db.select({ id: walletChallenges.id }).from(walletChallenges).where(eq(walletChallenges.id, input.challengeId)).limit(1);
      throw exists ? new AuthError("CHALLENGE_USED", "This sign-in request was already used. Start again.") : new AuthError("CHALLENGE_NOT_FOUND", "Unknown sign-in request.");
    }
    if (c.expiresAt.getTime() <= now.getTime()) throw new AuthError("CHALLENGE_EXPIRED", "The sign-in request expired. Start again.");
    if (c.purpose === "LINK" && c.userId !== input.currentUserId) throw new AuthError("FORBIDDEN", "This link request belongs to another session.");

    const family = c.family as WalletFamily;
    // An open NEAR challenge is bound to the account the wallet reports. The on-chain key check below proves it.
    let address = c.address;
    if (family === "near" && !address) {
      if (!input.accountId) throw new AuthError("BAD_REQUEST", "NEAR sign-in needs the account id returned by the wallet.");
      address = normalizeAddress("near", input.accountId);
    } else if (family === "near" && input.accountId && normalizeAddress("near", input.accountId) !== address) {
      throw new AuthError("SIGNATURE_INVALID", `You signed with ${input.accountId}, but this request was for ${address}.`);
    }
    let ok = false;
    let publicKey: string | null = null;
    if (family === "evm") ok = await verifyEvmSignature(address, c.message, input.signature);
    else if (family === "solana") ok = verifySolanaSignature(address, c.message, input.signature);
    else {
      if (!input.publicKey) throw new AuthError("BAD_REQUEST", "NEAR sign-in needs the public key returned by the wallet.");
      ok = await verifyNearSignature({ accountId: address, publicKey: input.publicKey, signatureB64: input.signature, message: c.message, nonceHex: c.nonce, recipient: c.domain, rpc: this.rpc });
      publicKey = input.publicKey;
    }
    if (!ok) throw new AuthError("SIGNATURE_INVALID", "The signature does not match this wallet and message.");

    const [existing] = await this.db.select().from(wallets).where(and(eq(wallets.family, family), eq(wallets.address, address))).limit(1);

    if (c.purpose === "SIGN_IN") {
      let userId = existing?.userId;
      let walletId = existing?.id;
      let created = false;
      if (!existing) {
        userId = id("usr");
        walletId = id("wal");
        try {
          await this.db.transaction(async (tx) => {
            await tx.insert(users).values({ id: userId!, activeWalletId: walletId!, createdAt: now });
            await tx.insert(wallets).values({ id: walletId!, userId: userId!, family, address: address, publicKey, label: null, verifiedAt: now, createdAt: now });
            await tx.insert(walletNetworks).values(networksForFamily(family).map((n) => ({ walletId: walletId!, networkId: n, enabled: 1 })));
            await tx.insert(agentIdentities).values({ id: id("agt"), userId: userId!, nearAccountId: null, walletId: null, status: "NOT_LINKED", createdAt: now, updatedAt: now });
          });
          created = true;
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          // Two first sign-ins raced. The other one created the wallet; use it.
          const [w] = await this.db.select().from(wallets).where(and(eq(wallets.family, family), eq(wallets.address, address))).limit(1);
          userId = w.userId; walletId = w.id;
        }
      } else {
        await this.db.update(wallets).set({ verifiedAt: now, ...(publicKey ? { publicKey } : {}) }).where(eq(wallets.id, existing.id));
      }
      const session = await this.createSession(userId!, input.userAgent ?? null);
      return { userId: userId!, walletId: walletId!, created, session };
    }

    // LINK
    const userId = c.userId!;
    if (existing) {
      if (existing.userId === userId) throw new AuthError("WALLET_ALREADY_LINKED", "This wallet is already on your account.");
      throw new AuthError("WALLET_OWNED_BY_OTHER_USER", "This wallet belongs to another SPak account. Sign in with it there, or disconnect it from that account first.");
    }
    const walletId = id("wal");
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(wallets).values({ id: walletId, userId, family, address, publicKey, label: null, verifiedAt: now, createdAt: now });
        await tx.insert(walletNetworks).values(networksForFamily(family).map((n) => ({ walletId, networkId: n, enabled: 1 })));
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AuthError("WALLET_OWNED_BY_OTHER_USER", "This wallet was just linked to another account.");
      throw e;
    }
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (u && !u.activeWalletId) await this.db.update(users).set({ activeWalletId: walletId }).where(eq(users.id, userId));
    return { userId, walletId, created: false };
  }

  // ------------------------------------------------------------------ sessions

  async createSession(userId: string, userAgent: string | null) {
    const now = this.clock();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.db.insert(authSessions).values({
      id: id("ses"), userId, tokenHash: sha256(token), createdAt: now, expiresAt, lastSeenAt: now, revokedAt: null,
      userAgent: userAgent?.slice(0, 200) ?? null,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** Server-side session check. Returns null for unknown, revoked, expired or idle sessions. */
  async validateSession(token: string | null | undefined): Promise<SessionUser | null> {
    if (!token || token.length < 20 || token.length > 100) return null;
    const now = this.clock();
    const [s] = await this.db.select().from(authSessions).where(eq(authSessions.tokenHash, sha256(token))).limit(1);
    if (!s || s.revokedAt) return null;
    if (s.expiresAt.getTime() <= now.getTime() || s.lastSeenAt.getTime() + SESSION_IDLE_MS <= now.getTime()) return null;
    if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, s.id));
    }
    return { userId: s.userId, sessionId: s.id, expiresAt: s.expiresAt.toISOString() };
  }

  async logout(token: string | null | undefined): Promise<void> {
    if (!token) return;
    await this.db.update(authSessions).set({ revokedAt: this.clock() }).where(eq(authSessions.tokenHash, sha256(token)));
  }

  async logoutAll(userId: string): Promise<void> {
    await this.db.update(authSessions).set({ revokedAt: this.clock() }).where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
  }

  // ------------------------------------------------------------------ wallets

  async listWallets(userId: string): Promise<WalletView[]> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const ws = await this.db.select().from(wallets).where(eq(wallets.userId, userId)).orderBy(asc(wallets.createdAt));
    const nets = ws.length ? await this.db.select().from(walletNetworks).where(or(...ws.map((w) => eq(walletNetworks.walletId, w.id)))) : [];
    return ws.map((w) => ({
      id: w.id, family: w.family as WalletFamily, address: w.address, label: w.label, verifiedAt: w.verifiedAt.toISOString(),
      active: u?.activeWalletId === w.id,
      networks: networksForFamily(w.family as WalletFamily).map((n) => ({ id: n, enabled: nets.some((x) => x.walletId === w.id && x.networkId === n && x.enabled === 1) })),
    }));
  }

  private async ownWallet(userId: string, walletId: string) {
    const [w] = await this.db.select().from(wallets).where(and(eq(wallets.id, walletId), eq(wallets.userId, userId))).limit(1);
    if (!w) throw new AuthError("WALLET_NOT_FOUND", "No such wallet on your account.");
    return w;
  }

  async setActiveWallet(userId: string, walletId: string): Promise<void> {
    await this.ownWallet(userId, walletId);
    await this.db.update(users).set({ activeWalletId: walletId }).where(eq(users.id, userId));
  }

  /** Choose which networks a wallet is used on. Networks must match the wallet's family. */
  async setWalletNetworks(userId: string, walletId: string, enabled: string[]): Promise<void> {
    const w = await this.ownWallet(userId, walletId);
    const allowed = networksForFamily(w.family as WalletFamily);
    const bad = enabled.filter((n) => !allowed.includes(n));
    if (bad.length) throw new AuthError("NETWORK_NOT_SUPPORTED", `${bad.join(", ")} cannot be used with a ${w.family} wallet.`);
    await this.db.transaction(async (tx) => {
      for (const n of allowed) {
        await tx.insert(walletNetworks).values({ walletId, networkId: n, enabled: enabled.includes(n) ? 1 : 0 })
          .onConflictDoUpdate({ target: [walletNetworks.walletId, walletNetworks.networkId], set: { enabled: enabled.includes(n) ? 1 : 0 } });
      }
    });
  }

  async setWalletLabel(userId: string, walletId: string, label: string | null): Promise<void> {
    await this.ownWallet(userId, walletId);
    await this.db.update(wallets).set({ label: label?.slice(0, 40) || null }).where(eq(wallets.id, walletId));
  }

  /** Disconnect a wallet. The last wallet cannot be removed, or the account could never be signed into again. */
  async removeWallet(userId: string, walletId: string): Promise<void> {
    await this.ownWallet(userId, walletId);
    const all = await this.db.select({ id: wallets.id }).from(wallets).where(eq(wallets.userId, userId));
    if (all.length <= 1) throw new AuthError("LAST_WALLET", "This is your only wallet. Link another before disconnecting it.");
    await this.db.transaction(async (tx) => {
      await tx.update(agentIdentities).set({ walletId: null, nearAccountId: null, status: "NOT_LINKED", updatedAt: this.clock() })
        .where(and(eq(agentIdentities.userId, userId), eq(agentIdentities.walletId, walletId)));
      // Agent wallet associations for this wallet are revoked before the wallet row goes (history is kept).
      await revokeAssociationsForWallet(tx as unknown as Db, userId, walletId, this.clock());
      await tx.delete(wallets).where(eq(wallets.id, walletId));
      const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (u?.activeWalletId === walletId) {
        const next = all.find((w) => w.id !== walletId)!;
        await tx.update(users).set({ activeWalletId: next.id }).where(eq(users.id, userId));
      }
    });
  }

  /**
   * Wallet context for SPak-in: network -> verified address the user controls.
   * The active wallet wins for every network it serves; other wallets fill the rest.
   */
  async walletContext(userId: string): Promise<Record<string, string>> {
    const list = await this.listWallets(userId);
    const ordered = [...list.filter((w) => w.active), ...list.filter((w) => !w.active)];
    const out: Record<string, string> = {};
    for (const w of ordered) for (const n of w.networks) if (n.enabled && !out[n.id]) out[n.id] = w.address;
    return out;
  }

  // ------------------------------------------------------------------ agent identity

  async getAgentIdentity(userId: string) {
    const [a] = await this.db.select().from(agentIdentities).where(eq(agentIdentities.userId, userId)).limit(1);
    return a ? { status: a.status as "NOT_LINKED" | "LINKED", nearAccountId: a.nearAccountId, walletId: a.walletId, updatedAt: a.updatedAt.toISOString() } : { status: "NOT_LINKED" as const, nearAccountId: null, walletId: null, updatedAt: null };
  }

  /**
   * Associate a verified NEAR wallet as the SPak Agent account. Foundation only:
   * no keys are created or stored and nothing can sign on the user's behalf.
   */
  async linkAgentAccount(userId: string, walletId: string) {
    const w = await this.ownWallet(userId, walletId);
    if (w.family !== "near") throw new AuthError("BAD_REQUEST", "The SPak Agent identity must be a NEAR account.");
    const now = this.clock();
    try {
      await this.db.insert(agentIdentities).values({ id: id("agt"), userId, nearAccountId: w.address, walletId, status: "LINKED", createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: agentIdentities.userId, set: { nearAccountId: w.address, walletId, status: "LINKED", updatedAt: now } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AuthError("AGENT_ALREADY_LINKED", "That NEAR account is already another user's agent identity.");
      throw e;
    }
    return this.getAgentIdentity(userId);
  }

  async unlinkAgentAccount(userId: string) {
    await this.db.update(agentIdentities).set({ nearAccountId: null, walletId: null, status: "NOT_LINKED", updatedAt: this.clock() }).where(eq(agentIdentities.userId, userId));
    return this.getAgentIdentity(userId);
  }

  /** Active sessions count, for the account page. */
  async activeSessionCount(userId: string): Promise<number> {
    const rows = await this.db.select({ id: authSessions.id }).from(authSessions)
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, this.clock())));
    return rows.length;
  }
}
