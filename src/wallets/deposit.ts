"use client";
import { base58, base64 } from "@scure/base";
import { toHex } from "viem";
import type { DepositTransaction } from "@/deposits/builder";
import type { EvmWalletInfo } from "./evm";
import type { SolanaWalletInfo } from "./solana";

type EvmTx = Extract<DepositTransaction, { family: "evm" }>;
type SolTx = Extract<DepositTransaction, { family: "solana" }>;

const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { code, ...extra });

/** Read-only checks before asking the wallet to sign. Never switches networks by itself. */
export async function checkEvmWallet(w: EvmWalletInfo, tx: EvmTx): Promise<{ account: string | null; chainId: number; accountOk: boolean; networkOk: boolean }> {
  const accounts = ((await w.provider.request({ method: "eth_accounts" })) as string[] | undefined) ?? [];
  const chainId = Number.parseInt((await w.provider.request({ method: "eth_chainId" })) as string, 16);
  const account = accounts[0] ?? null;
  return { account, chainId, accountOk: !!account && account.toLowerCase() === tx.request.from.toLowerCase(), networkOk: chainId === tx.chainId };
}

/** Ask the wallet (with its own confirmation screen) to switch to the deposit network. Called only from a user click. */
export async function requestEvmNetwork(w: EvmWalletInfo, chainId: number): Promise<void> {
  await w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(chainId) }] });
}

/** Ask the wallet to connect the account that must send the deposit. */
export async function requestEvmAccounts(w: EvmWalletInfo): Promise<void> {
  await w.provider.request({ method: "eth_requestAccounts" });
}

/**
 * The wallet signs and broadcasts the server-prepared transaction. Re-checks account and network right before
 * the prompt; refuses rather than sending from the wrong account or chain.
 */
export async function sendEvmDeposit(w: EvmWalletInfo, tx: EvmTx): Promise<string> {
  const c = await checkEvmWallet(w, tx);
  if (!c.account) throw fail("NO_ACCOUNT", "Unlock your wallet and connect the account that must send this deposit.");
  if (!c.accountOk) throw fail("WRONG_ACCOUNT", `Your wallet is on ${c.account}. Switch to ${tx.request.from} in the wallet to send this deposit.`);
  if (!c.networkOk) throw fail("WRONG_NETWORK", `Your wallet is on chain ${c.chainId}. This deposit must be sent on chain ${tx.chainId}.`, { required: tx.chainId });
  const hash = (await w.provider.request({
    method: "eth_sendTransaction",
    params: [{ from: tx.request.from, to: tx.request.to, value: toHex(BigInt(tx.request.value)), data: tx.request.data, chainId: toHex(tx.chainId) }],
  })) as string;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) throw fail("BAD_WALLET_RESPONSE", "The wallet did not return a transaction hash.");
  return hash;
}

type SignAndSend = {
  "solana:signAndSendTransaction"?: { signAndSendTransaction(...inputs: { account: unknown; transaction: Uint8Array; chain: string }[]): Promise<{ signature: Uint8Array }[]> };
};

export function checkSolanaWallet(w: SolanaWalletInfo, tx: SolTx, sender: string) {
  const account = w.wallet.accounts.find((a) => a.address === sender) ?? null;
  const canSend = "solana:signAndSendTransaction" in w.wallet.features;
  return { accountOk: !!account, account: w.wallet.accounts[0]?.address ?? null, canSend, chainOk: w.wallet.chains.includes(tx.chain) };
}

/** Phantom and other Wallet Standard wallets: sign and broadcast the server-built transaction. Returns the signature. */
export async function sendSolanaDeposit(w: SolanaWalletInfo, tx: SolTx, sender: string): Promise<string> {
  const account = w.wallet.accounts.find((a) => a.address === sender);
  if (!account) throw fail("WRONG_ACCOUNT", `Connect ${sender} in your Solana wallet to send this deposit.`);
  const feature = (w.wallet.features as unknown as SignAndSend)["solana:signAndSendTransaction"];
  if (!feature) throw fail("4200", "This Solana wallet cannot send transactions.");
  const [out] = await feature.signAndSendTransaction({ account, transaction: base64.decode(tx.transactionBase64), chain: tx.chain });
  if (!out?.signature?.length) throw fail("BAD_WALLET_RESPONSE", "The wallet did not return a signature.");
  return base58.encode(out.signature);
}
