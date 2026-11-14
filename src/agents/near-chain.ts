/**
 * NEAR access for dedicated Agent accounts (Stage 7). Testnet only.
 *
 * Reads (account, access keys, transaction status, chain id) use plain JSON-RPC. The one write, creating a
 * sub-account, uses the official near-api-js SDK and is signed by SPak's configured testnet PARENT account key.
 * That key is never added to the new account. The transaction carries exactly three actions to one receiver:
 * CreateAccount, Transfer(initial balance), AddKey(owner public key, FullAccess). NEAR executes the actions of one
 * transaction atomically: if any fails, none take effect (docs.near.org/protocol/transactions/transaction-anatomy).
 */

export type AccessKeyInfo = { publicKey: string; permission: "FullAccess" | "FunctionCall" };
export type CreateOutcome = { txHash: string | null; outcome: "SUCCESS" | "FAILURE" | "UNKNOWN"; error?: string };

export interface AgentNearChain {
  readonly network: "testnet";
  chainId(): Promise<string>;
  /** null when the account does not exist. Throws when NEAR cannot be reached. */
  viewAccount(accountId: string): Promise<{ amount: string; locked?: string; storageUsage?: number } | null>;
  /** All access keys on the account. Throws when NEAR cannot be reached or the account is missing. */
  accessKeys(accountId: string): Promise<AccessKeyInfo[]>;
  txStatus(txHash: string, senderId: string): Promise<"SUCCESS" | "FAILURE" | "UNKNOWN">;
  createSubAccount(args: { newAccountId: string; ownerPublicKey: string; amountYocto: string }): Promise<CreateOutcome>;
  /** Public key of the configured parent key (never the secret). */
  parentPublicKey(): string;
  readonly parentAccountId: string;
}

export class NearUnavailable extends Error { constructor(m: string) { super(m); this.name = "NearUnavailable"; } }

export interface AgentAccountConfig {
  network: "testnet";
  rpcUrl: string;
  parentAccountId: string;
  /** Yocto NEAR attached to each new account. From configuration; never a hardcoded cost. */
  initialBalanceYocto: string;
  /** Total sponsorship budget in yocto NEAR across all Agents. */
  budgetYocto: string;
  /** Most accounts SPak will sponsor in total (reserved or funded). */
  maxSponsoredAccounts: number;
  recheck: { enabled: boolean; intervalHours: number };
}

const YOCTO = 24;
/** "0.1" NEAR to yocto, exact decimal math. Null when not a positive decimal with at most 24 places. */
export function nearToYocto(v: string | undefined): string | null {
  if (!v || !/^\d+(\.\d{1,24})?$/.test(v.trim())) return null;
  const [i, f = ""] = v.trim().split(".");
  const y = (BigInt(i) * 10n ** 24n + BigInt((f + "0".repeat(YOCTO)).slice(0, YOCTO))).toString();
  return y === "0" ? null : y;
}

/**
 * Configuration from the server environment. NOT_CONFIGURED (feature off) unless everything is set; anything other
 * than testnet is refused and never falls back to mainnet. Amounts are in NEAR (SPAK_AGENT_INITIAL_BALANCE=0.1) or,
 * for the earlier names, yocto (SPAK_AGENT_INITIAL_BALANCE_YOCTO). The parent key is read separately and never
 * returned by this function.
 *
 * NEAR_RPC_URL is deliberately NOT used here: it already points owner-identity checks at mainnet.
 */
export function agentAccountConfig(env: Record<string, string | undefined> = process.env): AgentAccountConfig | { unavailable: string } {
  const network = env.SPAK_AGENT_NEAR_NETWORK;
  if (!network) return { unavailable: "Dedicated Agent accounts are not configured on this server." };
  if (network !== "testnet") return { unavailable: "Only NEAR testnet is allowed for dedicated Agent accounts in this stage." };
  const parent = env.SPAK_AGENT_PARENT_ACCOUNT ?? "";
  if (!/^[a-z0-9][a-z0-9._-]*\.testnet$/.test(parent) || parent.includes("..")) return { unavailable: "The parent account must be a .testnet account." };
  const rpcUrl = env.SPAK_AGENT_NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
  if (!/^https:\/\/[^/]*testnet[^/]*/.test(rpcUrl)) return { unavailable: "The Agent account RPC must be an https testnet endpoint." };
  const key = env.SPAK_AGENT_PARENT_PRIVATE_KEY ?? "";
  if (!key) return { unavailable: "No parent account key is configured." };
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(key)) return { unavailable: "The parent account key is not a valid ed25519 secret key." };
  const bal = env.SPAK_AGENT_INITIAL_BALANCE ? nearToYocto(env.SPAK_AGENT_INITIAL_BALANCE) : (/^[1-9]\d*$/.test(env.SPAK_AGENT_INITIAL_BALANCE_YOCTO ?? "") ? env.SPAK_AGENT_INITIAL_BALANCE_YOCTO! : null);
  const budget = env.SPAK_AGENT_SPONSORSHIP_BUDGET ? nearToYocto(env.SPAK_AGENT_SPONSORSHIP_BUDGET) : (/^[1-9]\d*$/.test(env.SPAK_AGENT_SPONSOR_BUDGET_YOCTO ?? "") ? env.SPAK_AGENT_SPONSOR_BUDGET_YOCTO! : null);
  if (!bal || !budget) return { unavailable: "Sponsorship amounts are not configured." };
  if (BigInt(bal) > BigInt(budget)) return { unavailable: "The initial balance is larger than the sponsorship budget." };
  const max = Number(env.SPAK_AGENT_MAX_SPONSORED_ACCOUNTS ?? "");
  if (!Number.isInteger(max) || max < 1 || max > 1000) return { unavailable: "SPAK_AGENT_MAX_SPONSORED_ACCOUNTS must be a whole number from 1 to 1000." };
  const hours = Number(env.SPAK_AGENT_RECHECK_INTERVAL_HOURS ?? "24");
  if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) return { unavailable: "SPAK_AGENT_RECHECK_INTERVAL_HOURS must be between 1 and 720." };
  return { network: "testnet", rpcUrl, parentAccountId: parent, initialBalanceYocto: bal, budgetYocto: budget, maxSponsoredAccounts: max, recheck: { enabled: env.SPAK_AGENT_BACKGROUND_RECHECK_ENABLED !== "false", intervalHours: hours } };
}

async function rpc<T>(url: string, method: string, params: unknown, fetchImpl: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "spak", method, params }), signal: AbortSignal.timeout(15_000) });
  } catch { throw new NearUnavailable("NEAR testnet could not be reached."); }
  const body = (await res.json().catch(() => null)) as { result?: T; error?: { cause?: { name?: string }; data?: string } } | null;
  if (!body) throw new NearUnavailable("NEAR testnet returned an unreadable response.");
  if (body.error) throw Object.assign(new Error(body.error.cause?.name ?? "RPC_ERROR"), { cause: body.error.cause?.name });
  return body.result as T;
}

/** Real testnet chain access. The parent secret is read once from config and only handed to the SDK signer. */
export function nearTestnetChain(cfg: AgentAccountConfig, parentSecret: string, fetchImpl: typeof fetch = fetch): AgentNearChain {
  return {
    network: "testnet",
    parentAccountId: cfg.parentAccountId,
    parentPublicKey: () => publicKeyOf(parentSecret),
    async chainId() { return (await rpc<{ chain_id: string }>(cfg.rpcUrl, "status", [], fetchImpl)).chain_id; },
    async viewAccount(accountId) {
      try {
        const r = await rpc<{ amount: string; locked: string; storage_usage: number }>(cfg.rpcUrl, "query", { request_type: "view_account", finality: "final", account_id: accountId }, fetchImpl);
        return { amount: r.amount, locked: r.locked, storageUsage: r.storage_usage };
      }
      catch (e) { if ((e as { cause?: string }).cause === "UNKNOWN_ACCOUNT") return null; throw e instanceof NearUnavailable ? e : new NearUnavailable("NEAR returned an unexpected answer."); }
    },
    async accessKeys(accountId) {
      const r = await rpc<{ keys: { public_key: string; access_key: { permission: unknown } }[] }>(cfg.rpcUrl, "query", { request_type: "view_access_key_list", finality: "final", account_id: accountId }, fetchImpl)
        .catch((e) => { throw e instanceof NearUnavailable ? e : new NearUnavailable("NEAR returned an unexpected answer."); });
      return r.keys.map((k) => ({ publicKey: k.public_key, permission: k.access_key.permission === "FullAccess" ? "FullAccess" : "FunctionCall" }));
    },
    async txStatus(txHash, senderId) {
      try {
        const r = await rpc<{ status?: { SuccessValue?: unknown; Failure?: unknown } }>(cfg.rpcUrl, "tx", { tx_hash: txHash, sender_account_id: senderId, wait_until: "FINAL" }, fetchImpl);
        return r.status && "SuccessValue" in r.status ? "SUCCESS" : r.status && "Failure" in r.status ? "FAILURE" : "UNKNOWN";
      } catch { return "UNKNOWN"; }
    },
    async createSubAccount({ newAccountId, ownerPublicKey, amountYocto }) {
      const { Account, JsonRpcProvider, KeyPairSigner, actionCreators, PublicKey } = await loadSdk();
      const provider = new JsonRpcProvider({ url: cfg.rpcUrl });
      const parent = new Account(cfg.parentAccountId, provider, KeyPairSigner.fromSecretKey(parentSecret as `ed25519:${string}`));
      try {
        const out = await parent.signAndSendTransaction({
          receiverId: newAccountId,
          actions: [actionCreators.createAccount(), actionCreators.transfer(BigInt(amountYocto)), actionCreators.addKey(PublicKey.from(ownerPublicKey), actionCreators.fullAccessKey())],
          waitUntil: "FINAL", throwOnFailure: false,
        });
        const st = out.status as { SuccessValue?: unknown; Failure?: unknown };
        return { txHash: out.transaction_outcome?.id ?? out.transaction?.hash ?? null, outcome: st && "Failure" in st ? "FAILURE" : "SUCCESS", ...(st && "Failure" in st ? { error: "The creation transaction failed on chain." } : {}) };
      } catch (e) {
        // Timeouts or transport errors: the transaction may or may not have landed. Never assume either way.
        const msg = (e as Error).message ?? "";
        if (/timeout|fetch failed|ECONN|network/i.test(msg)) return { txHash: null, outcome: "UNKNOWN", error: "NEAR did not confirm the transaction in time." };
        return { txHash: null, outcome: "FAILURE", error: "NEAR rejected the creation transaction." };
      }
    },
  };
}

function publicKeyOf(secret: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KeyPair } = require("near-api-js") as typeof import("near-api-js");
  return KeyPair.fromString(secret as `ed25519:${string}`).getPublicKey().toString();
}

async function loadSdk() {
  const n = await import("near-api-js");
  const tx = n.transactions as unknown as Record<string, (...a: unknown[]) => unknown>;
  return {
    Account: n.Account, JsonRpcProvider: n.providers.JsonRpcProvider, KeyPairSigner: n.KeyPairSigner,
    PublicKey: (await import("@near-js/crypto")).PublicKey,
    actionCreators: { createAccount: tx.createAccount, transfer: tx.transfer, addKey: tx.addKey, fullAccessKey: tx.fullAccessKey } as unknown as {
      createAccount: () => never; transfer: (n: bigint) => never; addKey: (pk: unknown, ak: unknown) => never; fullAccessKey: () => never;
    },
  };
}

/**
 * Read-only NEAR testnet access for Agent funding checks (Stage 9). Needs no key of any kind: view_account is a
 * public read. Works without the parent-account configuration that account creation needs.
 */
export function nearTestnetReader(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Pick<AgentNearChain, "viewAccount"> | null {
  const rpcUrl = env.SPAK_AGENT_NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
  if (!/^https:\/\/[^/]*testnet[^/]*/.test(rpcUrl)) return null;
  return {
    async viewAccount(accountId) {
      try {
        const r = await rpc<{ amount: string; locked: string; storage_usage: number }>(rpcUrl, "query", { request_type: "view_account", finality: "final", account_id: accountId }, fetchImpl);
        return { amount: r.amount, locked: r.locked, storageUsage: r.storage_usage };
      } catch (e) { if ((e as { cause?: string }).cause === "UNKNOWN_ACCOUNT") return null; throw e instanceof NearUnavailable ? e : new NearUnavailable("NEAR returned an unexpected answer."); }
    },
  };
}
