import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, gt, lte, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { hex } from "@scure/base";
import type { Db } from "../database/repositories";
import { agentEvents, agentWalletChallenges, agentWallets, agents, wallets } from "../database/schema";
import { isUniqueViolation } from "../execution/records";
import { AuthError } from "../auth/types";
import { verifyEvmSignature } from "../auth/verify/evm";
import { verifySolanaSignature } from "../auth/verify/solana";
import { nearRpc as defaultNearRpc, verifyNearSignature, type NearRpc } from "../auth/verify/near";
import { listNetworks } from "../spak-in/registries/networks";
import { AgentError, ownershipCurrent, userRef } from "./service";

export const WALLET_METHOD = { evm: "EIP4361_PERSONAL_SIGN", solana: "SIWS_ED25519", near: "NEAR_NEP413_FULL_ACCESS_KEY" } as const;
export type Family = keyof typeof WALLET_METHOD;
export const ASSOCIATION_PURPOSE = "AGENT_WALLET_ASSOCIATION";
export const WALLET_CHALLENGE_TTL_MS = 5 * 60_000;
/**
 * Associations are valid for 90 days, half the Agent ownership period: a wallet changes hands or is compromised
 * more often than the Agent owner's NEAR key, and a wallet signature costs the user nothing to renew.
 */
export const ASSOCIATION_VALID_MS = 90 * 24 * 3600_000;
export const MAX_ASSOCIATIONS = 20;

type Row = typeof agentWallets.$inferSelect;
const newId = (p: string) => `${p}_${randomBytes(12).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** EVM networks SPak supports, by numeric chain id. Any other chain id is refused. */
const EVM_CHAINS = new Map(listNetworks().filter((n) => n.family === "evm" && n.chainId).map((n) => [Number(n.chainId), n.id]));

export interface AssociationView {
  id: string; family: Family; network: string; chainId: number | null; address: string; publicKey: string | null; method: string;
  /** Effective state. ACTIVE only when verified, in date and the Agent's own ownership is current. */
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "REVOKED";
  verifiedAt: string | null; expiresAt: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string;
  /** Association never grants signing authority. */
  signingAuthority: "NONE";
}

export function toAssociationView(r: Row): AssociationView {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: r.id, family: r.family as Family, network: r.network, chainId: r.chainId ? Number(r.chainId) : null, address: r.address, publicKey: r.publicKey, method: r.method,
    status: r.status as AssociationView["status"], verifiedAt: iso(r.verifiedAt), expiresAt: iso(r.expiresAt), revokedAt: iso(r.revokedAt), revokeReason: r.revokeReason,
    createdAt: r.createdAt.toISOString(), signingAuthority: "NONE",
  };
}

/** For later stages: an association may be relied on only when ACTIVE, in date, and its Agent's ownership is current. */
export function associationUsable(r: Pick<Row, "status" | "expiresAt">, agent: { status: string; verificationExpiresAt: Date | null }, now: Date) {
  return r.status === "ACTIVE" && !!r.expiresAt && r.expiresAt.getTime() > now.getTime() && ownershipCurrent(agent, now);
}

/** The exact text a wallet signs. EVM uses EIP-4361; Solana and NEAR use the same fields as plain text. */
export function associationMessage(c: { family: Family; domain: string; uri: string; address: string; chainId: number | null; agentId: string; userRef: string; nonce: string; issuedAt: Date; expiresAt: Date; challengeId: string }) {
  const statement = `Associate this wallet with SPak Agent ${c.agentId}. This proves you control it. It is not a transaction and gives SPak no signing authority.`;
  if (c.family === "evm") {
    return createSiweMessage({
      domain: c.domain, address: getAddress(c.address), statement, uri: c.uri, version: "1", chainId: c.chainId!, nonce: c.nonce,
      issuedAt: c.issuedAt, expirationTime: c.expiresAt, requestId: c.challengeId,
      resources: [`urn:spak:agent:${c.agentId}`, `urn:spak:owner:${c.userRef}`, `urn:spak:purpose:${ASSOCIATION_PURPOSE}`],
    });
  }
  return [
    `${c.domain} wants you to associate your ${c.family === "solana" ? "Solana" : "NEAR"} account with a SPak Agent:`,
    c.address,
    "",
    statement,
    "",
    `URI: ${c.uri}`,
    "Version: 1",
    `Agent: ${c.agentId}`,
    `Owner: ${c.userRef}`,
    `Purpose: ${ASSOCIATION_PURPOSE}`,
    `Nonce: ${c.nonce}`,
    `Issued At: ${c.issuedAt.toISOString()}`,
    `Expiration Time: ${c.expiresAt.toISOString()}`,
    `Request ID: ${c.challengeId}`,
  ].join("\n");
}

export interface AgentWalletOptions { clock?: () => Date; nearRpc?: NearRpc }

/**
 * Wallet association (Stage 6). Associating a wallet proves the Agent owner controlled it when signing.
 * It does not create signing authority, does not add recipients, and does not touch SPak Guard or execution.
 * Every method scopes reads and writes to the session user; another user's Agent or association is "not found".
 */
export class AgentWalletService {
  private readonly clock: () => Date;
  private readonly rpc: NearRpc;
  constructor(private readonly db: Db, opts: AgentWalletOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.rpc = opts.nearRpc ?? defaultNearRpc();
  }

  private async agent(userId: string, agentId: string, q: Db = this.db, lock = false) {
    const base = q.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.userId, userId))).limit(1);
    const [a] = lock ? await base.for("update") : await base;
    if (!a) throw new AgentError("AGENT_NOT_FOUND", "No such Agent.");
    return a;
  }
  /** New associations need a verified, in-date, active Agent. */
  private eligible(a: typeof agents.$inferSelect) {
    if (a.status === "REVOKED") throw new AgentError("AGENT_REVOKED", "This Agent was revoked.");
    if (a.status === "SUSPENDED") throw new AgentError("AGENT_INVALID_STATE", "This Agent is suspended. Verify ownership again to resume it first.");
    if (a.status !== "VERIFIED") throw new AgentError("AGENT_INVALID_STATE", "Verify ownership of this Agent before associating wallets.");
    if (!ownershipCurrent(a, this.clock())) throw new AgentError("AGENT_INVALID_STATE", "This Agent's ownership verification expired. Verify it again before associating wallets.");
  }
  private async event(q: Db, a: { id: string; userId: string }, event: string, from: string | null, to: string | null, data: Record<string, unknown>) {
    await q.insert(agentEvents).values({ agentId: a.id, userId: a.userId, event, fromStatus: from, toStatus: to, data, at: this.clock() });
  }

  /** Mark associations past their expiry as EXPIRED, with an event each. Expired is never treated as verified. */
  private async expire(agentId: string, userId: string) {
    const now = this.clock();
    const rows = await this.db.update(agentWallets).set({ status: "EXPIRED", updatedAt: now })
      .where(and(eq(agentWallets.agentId, agentId), eq(agentWallets.userId, userId), eq(agentWallets.status, "ACTIVE"), lte(agentWallets.expiresAt, now))).returning();
    for (const r of rows) await this.event(this.db, { id: agentId, userId }, "WALLET_EXPIRED", "ACTIVE", "EXPIRED", { associationId: r.id });
  }

  async list(userId: string, agentId: string) {
    await this.agent(userId, agentId);
    await this.expire(agentId, userId);
    const rows = await this.db.select().from(agentWallets).where(and(eq(agentWallets.agentId, agentId), eq(agentWallets.userId, userId))).orderBy(desc(agentWallets.createdAt));
    return rows.map(toAssociationView);
  }

  async get(userId: string, agentId: string, associationId: string) {
    await this.agent(userId, agentId);
    await this.expire(agentId, userId);
    return toAssociationView(await this.own(userId, agentId, associationId));
  }

  private async own(userId: string, agentId: string, associationId: string, q: Db = this.db) {
    const [r] = await q.select().from(agentWallets).where(and(eq(agentWallets.id, associationId), eq(agentWallets.agentId, agentId), eq(agentWallets.userId, userId))).limit(1);
    if (!r) throw new AgentError("AGENT_NOT_FOUND", "No such wallet association.");
    return r;
  }

  async events(userId: string, agentId: string, associationId: string) {
    await this.own(userId, agentId, associationId);
    return this.db.select({ id: agentEvents.id, event: agentEvents.event, fromStatus: agentEvents.fromStatus, toStatus: agentEvents.toStatus, at: agentEvents.at })
      .from(agentEvents).where(and(eq(agentEvents.agentId, agentId), eq(agentEvents.userId, userId), sql`${agentEvents.data}->>'associationId' = ${associationId}`)).orderBy(asc(agentEvents.id));
  }

  /**
   * Start an association or a re-verification for one of the user's verified wallets. The wallet is chosen by its
   * SPak wallet id, so only a wallet the user already proved they own can be named, and its canonical address is
   * taken from the server's record. EVM needs the chain id the wallet will sign on, which must be a supported chain.
   */
  async challenge(userId: string, agentId: string, input: { walletId: string; chainId?: number; domain: string; uri: string }) {
    const a = await this.agent(userId, agentId);
    this.eligible(a);
    const [w] = await this.db.select().from(wallets).where(and(eq(wallets.id, input.walletId), eq(wallets.userId, userId))).limit(1);
    if (!w) throw new AgentError("AGENT_NOT_FOUND", "No such wallet on your account.");
    const family = w.family as Family;
    if (!(family in WALLET_METHOD)) throw new AgentError("AGENT_UNSUPPORTED_METHOD", "This wallet type cannot be associated.");
    if (family === "near" && w.address === a.ownerAccountId) throw new AgentError("AGENT_BAD_REQUEST", "This NEAR account already owns the Agent. It is shown as the owner, not as an associated wallet.");
    let network: string, chainId: number | null = null;
    if (family === "evm") {
      if (!input.chainId || !EVM_CHAINS.has(input.chainId)) throw new AgentError("AGENT_BAD_REQUEST", "Switch your wallet to a network SPak supports, then try again.");
      chainId = input.chainId; network = EVM_CHAINS.get(chainId)!;
    } else network = family;

    const now = this.clock();
    await this.expire(agentId, userId);
    // Reuse the live association for this wallet (re-verification), or create a PENDING one.
    let [assoc] = await this.db.select().from(agentWallets).where(and(eq(agentWallets.agentId, a.id), eq(agentWallets.family, family), eq(agentWallets.address, w.address), inArray(agentWallets.status, ["PENDING", "ACTIVE", "SUSPENDED", "EXPIRED"]))).limit(1);
    if (!assoc) {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(agentWallets).where(and(eq(agentWallets.agentId, a.id), inArray(agentWallets.status, ["PENDING", "ACTIVE", "SUSPENDED", "EXPIRED"])));
      if (n >= MAX_ASSOCIATIONS) throw new AgentError("AGENT_BAD_REQUEST", `An Agent can have at most ${MAX_ASSOCIATIONS} associated wallets.`);
      try {
        [assoc] = await this.db.transaction(async (t) => {
          const tx = t as unknown as Db;
          const rows = await tx.insert(agentWallets).values({
            id: newId("awa"), agentId: a.id, userId, walletId: w.id, family, network, chainId: chainId ? String(chainId) : null, address: w.address,
            method: WALLET_METHOD[family], status: "PENDING", createdAt: now, updatedAt: now,
          }).returning();
          await this.event(tx, a, "WALLET_ASSOCIATION_STARTED", null, "PENDING", { associationId: rows[0].id, family, network });
          return rows;
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // The same wallet is live on another Agent (another user), or a concurrent request created it.
        const [mine] = await this.db.select().from(agentWallets).where(and(eq(agentWallets.agentId, a.id), eq(agentWallets.family, family), eq(agentWallets.address, w.address), inArray(agentWallets.status, ["PENDING", "ACTIVE", "SUSPENDED", "EXPIRED"]))).limit(1);
        if (!mine) throw new AgentError("AGENT_OWNER_IN_USE", "This wallet is already associated with another SPak Agent.");
        assoc = mine;
      }
    }
    const id = newId("awc");
    const nonce = hex.encode(randomBytes(16));
    const expiresAt = new Date(now.getTime() + WALLET_CHALLENGE_TTL_MS);
    const message = associationMessage({ family, domain: input.domain, uri: input.uri, address: w.address, chainId, agentId: a.id, userRef: userRef(userId), nonce, issuedAt: now, expiresAt, challengeId: id });
    // NEAR: NEP-413 needs a 32-byte nonce; the message nonce doubles as it, padded with the challenge id hash.
    const nep413Nonce = family === "near" ? sha256(`${nonce}:${id}`) : null;
    await this.db.insert(agentWalletChallenges).values({ id, associationId: assoc.id, agentId: a.id, userId, family, method: WALLET_METHOD[family], address: w.address, chainId: chainId ? String(chainId) : null, domain: input.domain, nonce: nep413Nonce ?? nonce, message, issuedAt: now, expiresAt });
    await this.event(this.db, a, "WALLET_CHALLENGE_ISSUED", assoc.status, assoc.status, { associationId: assoc.id, challengeId: id });
    return {
      challengeId: id, associationId: assoc.id, family, method: WALLET_METHOD[family], address: w.address, chainId, message, expiresAt: expiresAt.toISOString(),
      ...(family === "near" ? { nonce: Buffer.from(nep413Nonce!, "hex").toString("base64"), recipient: input.domain } : {}),
    };
  }

  /**
   * Complete an association. The challenge is consumed atomically first (single use, even under concurrency); the
   * signature is then checked against the stored message and the wallet's canonical address. On success, the
   * association becomes ACTIVE in a transaction that re-checks the Agent under a row lock.
   */
  async verify(userId: string, agentId: string, input: { challengeId: string; signature: string; publicKey?: string; accountId?: string; domain: string }) {
    const a = await this.agent(userId, agentId);
    if (a.status === "REVOKED") throw new AgentError("AGENT_REVOKED", "This Agent was revoked.");
    const now = this.clock();
    const [c] = await this.db.select().from(agentWalletChallenges).where(eq(agentWalletChallenges.id, input.challengeId)).limit(1);
    if (!c || c.agentId !== a.id || c.userId !== userId) throw new AgentError("AGENT_CHALLENGE_INVALID", "That challenge is not valid for this Agent.");
    if (c.usedAt) throw new AgentError("AGENT_CHALLENGE_USED", "That challenge was already used. Start again.");
    if (c.expiresAt.getTime() <= now.getTime()) throw new AgentError("AGENT_CHALLENGE_EXPIRED", "That challenge expired. Start again.");
    if (c.domain !== input.domain) throw new AgentError("AGENT_DOMAIN_MISMATCH", "That challenge was issued for another site.");
    const [claimed] = await this.db.update(agentWalletChallenges).set({ usedAt: now })
      .where(and(eq(agentWalletChallenges.id, c.id), isNull(agentWalletChallenges.usedAt), gt(agentWalletChallenges.expiresAt, now))).returning();
    if (!claimed) throw new AgentError("AGENT_CHALLENGE_USED", "That challenge was already used. Start again.");

    const fail = async (code: "AGENT_PROOF_INVALID" | "AGENT_KEY_NOT_AUTHORIZED" | "AGENT_VERIFICATION_UNAVAILABLE", message: string, reason: string) => {
      await this.db.update(agentWalletChallenges).set({ outcome: "FAILED" }).where(eq(agentWalletChallenges.id, c.id));
      await this.event(this.db, a, "WALLET_VERIFICATION_FAILED", null, null, { associationId: c.associationId, reason });
      return new AgentError(code, message);
    };
    let publicKey: string | null = null;
    if (c.family === "evm") {
      if (!(await verifyEvmSignature(c.address, c.message, input.signature))) throw await fail("AGENT_PROOF_INVALID", "The signature is not from this wallet for this request.", "SIGNATURE_INVALID");
    } else if (c.family === "solana") {
      if (!verifySolanaSignature(c.address, c.message, input.signature)) throw await fail("AGENT_PROOF_INVALID", "The signature is not from this wallet for this request.", "SIGNATURE_INVALID");
      publicKey = c.address;
    } else {
      if (!input.publicKey || (input.accountId ?? "").trim().toLowerCase() !== c.address) throw await fail("AGENT_PROOF_INVALID", "The signature is for a different NEAR account than this request.", "ACCOUNT_MISMATCH");
      try {
        const ok = await verifyNearSignature({ accountId: c.address, publicKey: input.publicKey, signatureB64: input.signature, message: c.message, nonceHex: c.nonce, recipient: c.domain, rpc: this.rpc });
        if (!ok) throw await fail("AGENT_PROOF_INVALID", "The signature is not from this account for this request.", "SIGNATURE_INVALID");
      } catch (e) {
        if (e instanceof AgentError) throw e;
        if (e instanceof AuthError && e.code === "KEY_NOT_AUTHORIZED") throw await fail("AGENT_KEY_NOT_AUTHORIZED", e.message, "KEY_NOT_FULL_ACCESS");
        if (e instanceof AuthError && e.code === "NEAR_RPC_UNAVAILABLE") throw await fail("AGENT_VERIFICATION_UNAVAILABLE", "SPak could not confirm the key on NEAR, so the wallet was not associated. Try again.", "NEAR_RPC_UNAVAILABLE");
        throw await fail("AGENT_PROOF_INVALID", "The signature could not be verified.", "SIGNATURE_ERROR");
      }
      publicKey = input.publicKey;
    }

    const verifiedAt = this.clock();
    const r = await this.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const locked = await this.agent(userId, agentId, tx, true);
      this.eligible(locked); // suspended, revoked or expired since the challenge: nothing becomes active
      const [cur] = await tx.select().from(agentWallets).where(eq(agentWallets.id, c.associationId)).for("update").limit(1);
      if (!cur || !["PENDING", "ACTIVE", "SUSPENDED", "EXPIRED"].includes(cur.status)) throw new AgentError("AGENT_INVALID_STATE", "This association was removed. Start a new one.");
      // The wallet must still be on the user's account.
      const [w] = await tx.select({ id: wallets.id }).from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.family, cur.family), eq(wallets.address, cur.address))).limit(1);
      if (!w) throw new AgentError("AGENT_INVALID_STATE", "This wallet is no longer connected to your account.");
      const [u] = await tx.update(agentWallets).set({
        status: "ACTIVE", publicKey, verifiedAt, expiresAt: new Date(verifiedAt.getTime() + ASSOCIATION_VALID_MS), walletId: w.id, version: cur.version + 1, updatedAt: verifiedAt,
      }).where(and(eq(agentWallets.id, cur.id), eq(agentWallets.version, cur.version))).returning();
      if (!u) throw new AgentError("AGENT_CONCURRENT_UPDATE", "This association changed in another request. Try again.");
      await tx.update(agentWalletChallenges).set({ outcome: "VERIFIED" }).where(eq(agentWalletChallenges.id, c.id));
      await this.event(tx, a, cur.status === "PENDING" ? "WALLET_ASSOCIATED" : cur.status === "SUSPENDED" ? "WALLET_REACTIVATED_BY_PROOF" : "WALLET_REVERIFIED", cur.status, "ACTIVE", { associationId: cur.id, family: cur.family, network: cur.network, method: cur.method, messageSha256: sha256(c.message) });
      return u;
    });
    return toAssociationView(r);
  }

  /**
   * Remove an association now. Works for any non-revoked association, even while the Agent is suspended or expired,
   * so a compromised wallet can always be cut off. Revoked is final: a new association needs a new challenge.
   */
  async remove(userId: string, agentId: string, associationId: string, reason: "REMOVED" | "COMPROMISED") {
    const a = await this.agent(userId, agentId);
    const now = this.clock();
    return this.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const cur = await this.own(userId, agentId, associationId, tx);
      if (cur.status === "REVOKED") return toAssociationView(cur);
      const [u] = await tx.update(agentWallets).set({ status: "REVOKED", revokedAt: now, revokeReason: reason, version: cur.version + 1, updatedAt: now })
        .where(and(eq(agentWallets.id, cur.id), eq(agentWallets.version, cur.version))).returning();
      if (!u) throw new AgentError("AGENT_CONCURRENT_UPDATE", "This association changed in another request. Try again.");
      await tx.update(agentWalletChallenges).set({ usedAt: now, outcome: "FAILED" }).where(and(eq(agentWalletChallenges.associationId, cur.id), isNull(agentWalletChallenges.usedAt)));
      await this.event(tx, a, reason === "COMPROMISED" ? "WALLET_REPORTED_COMPROMISED" : "WALLET_REMOVED", cur.status, "REVOKED", { associationId: cur.id, family: cur.family, network: cur.network });
      return toAssociationView(u);
    });
  }
}

/** When a wallet is disconnected from the SPak account, its associations are revoked in the same transaction. */
export async function revokeAssociationsForWallet(tx: Db, userId: string, walletId: string, now: Date) {
  const rows = await tx.update(agentWallets).set({ status: "REVOKED", revokedAt: now, revokeReason: "WALLET_DISCONNECTED", updatedAt: now })
    .where(and(eq(agentWallets.userId, userId), eq(agentWallets.walletId, walletId), inArray(agentWallets.status, ["PENDING", "ACTIVE", "SUSPENDED", "EXPIRED"]))).returning();
  for (const r of rows) {
    await tx.update(agentWalletChallenges).set({ usedAt: now, outcome: "FAILED" }).where(and(eq(agentWalletChallenges.associationId, r.id), isNull(agentWalletChallenges.usedAt)));
    await tx.insert(agentEvents).values({ agentId: r.agentId, userId, event: "WALLET_REVOKED", fromStatus: null, toStatus: "REVOKED", data: { associationId: r.id, cause: "WALLET_DISCONNECTED" }, at: now });
  }
}
