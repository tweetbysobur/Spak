/**
 * SIMULATED WALLETS: scripted EIP-1193 and Wallet Standard objects stand in for MetaMask and Phantom.
 * They test SPak's client logic (checks, refusals, error mapping), not the real extensions.
 */
import { describe, expect, it } from "vitest";
import { checkEvmWallet, requestEvmNetwork, sendEvmDeposit, sendSolanaDeposit } from "@/wallets/deposit";
import { classifyWalletError } from "@/wallets/errors";
import type { EvmWalletInfo } from "@/wallets/evm";
import type { SolanaWalletInfo } from "@/wallets/solana";
import type { DepositTransaction } from "@/deposits/builder";

const ME = "0x1111111111111111111111111111111111111111";
const tx = { family: "evm", chainId: 8453, approvals: [], steps: [], request: { from: ME, to: "0x2222222222222222222222222222222222222222", value: "1000", data: "0x" } } as unknown as Extract<DepositTransaction, { family: "evm" }>;

function evm(o: { accounts?: string[]; chain?: number; send?: () => unknown } = {}) {
  const calls: string[] = [];
  let chain = o.chain ?? 8453;
  const w = { id: "sim", name: "Sim", provider: { request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    calls.push(method);
    if (method === "eth_accounts") return o.accounts ?? [ME];
    if (method === "eth_chainId") return `0x${chain.toString(16)}`;
    if (method === "wallet_switchEthereumChain") { chain = parseInt((params![0] as { chainId: string }).chainId, 16); return null; }
    if (method === "eth_sendTransaction") return o.send ? o.send() : `0x${"c".repeat(64)}`;
    throw new Error(`unexpected ${method}`);
  } } } as unknown as EvmWalletInfo;
  return { w, calls };
}
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code?: string; message: string }; } };

describe("EVM deposit (simulated wallet)", () => {
  it("sends once account and network match and returns the hash", async () => {
    const { w, calls } = evm();
    expect(await sendEvmDeposit(w, tx)).toBe(`0x${"c".repeat(64)}`);
    expect(calls).not.toContain("wallet_switchEthereumChain");
    expect(calls).not.toContain("eth_signTypedData_v4");
  });
  it("refuses the wrong network without switching it", async () => {
    const { w, calls } = evm({ chain: 1 });
    expect((await err(sendEvmDeposit(w, tx)))?.code).toBe("WRONG_NETWORK");
    expect(calls).not.toContain("wallet_switchEthereumChain");
    expect(calls).not.toContain("eth_sendTransaction");
    await requestEvmNetwork(w, 8453); // only on an explicit user click
    expect((await checkEvmWallet(w, tx)).networkOk).toBe(true);
  });
  it("refuses the wrong account and a locked wallet", async () => {
    expect((await err(sendEvmDeposit(evm({ accounts: ["0x9999999999999999999999999999999999999999"] }).w, tx)))?.code).toBe("WRONG_ACCOUNT");
    expect((await err(sendEvmDeposit(evm({ accounts: [] }).w, tx)))?.code).toBe("NO_ACCOUNT");
  });
  it("maps rejection, disconnection and bad answers", async () => {
    const rej = await err(sendEvmDeposit(evm({ send: () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); } }).w, tx));
    expect(classifyWalletError(rej).kind).toBe("CANCELLED");
    const disc = await err(sendEvmDeposit(evm({ send: () => { throw Object.assign(new Error("Disconnected"), { code: 4900 }); } }).w, tx));
    expect(classifyWalletError(disc).kind).toBe("NO_ACCOUNT");
    expect((await err(sendEvmDeposit(evm({ send: () => "nope" }).w, tx)))?.code).toBe("BAD_WALLET_RESPONSE");
  });
});

const SME = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const stx = { family: "solana", chain: "solana:mainnet", transactionBase64: "AQID", approvals: [], steps: [] } as unknown as Extract<DepositTransaction, { family: "solana" }>;
function sol(o: { accounts?: string[]; send?: () => unknown; feature?: boolean } = {}) {
  const features: Record<string, unknown> = {};
  if (o.feature !== false) features["solana:signAndSendTransaction"] = { signAndSendTransaction: async () => (o.send ? o.send() : [{ signature: new Uint8Array(64).fill(7) }]) };
  return { id: "phantom", name: "Phantom", wallet: { accounts: (o.accounts ?? [SME]).map((address) => ({ address })), chains: ["solana:mainnet"], features } } as unknown as SolanaWalletInfo;
}
describe("Solana deposit (simulated wallet)", () => {
  it("signs and sends, returning a base58 signature", async () => {
    expect(await sendSolanaDeposit(sol(), stx, SME)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{60,90}$/);
  });
  it("refuses the wrong account and wallets that cannot send", async () => {
    expect((await err(sendSolanaDeposit(sol({ accounts: ["7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"] }), stx, SME)))?.code).toBe("WRONG_ACCOUNT");
    expect((await err(sendSolanaDeposit(sol({ feature: false }), stx, SME)))?.code).toBe("4200");
  });
  it("maps rejection", async () => {
    const e = await err(sendSolanaDeposit(sol({ send: () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); } }), stx, SME));
    expect(classifyWalletError(e).kind).toBe("CANCELLED");
  });
});

describe("deposit error classification", () => {
  it.each([
    ["INSUFFICIENT_BALANCE", "INSUFFICIENT_BALANCE"], ["DUPLICATE_TX", "DUPLICATE"], ["DEPOSIT_IN_PROGRESS", "DUPLICATE"],
    ["QUOTE_EXPIRED", "QUOTE_EXPIRED"], ["FIRM_QUOTE_REQUIRED", "QUOTE_EXPIRED"], ["DEPOSIT_EXPIRED", "DEPOSIT_EXPIRED"],
    ["UNSUPPORTED_ASSET", "UNSUPPORTED_TOKEN"], ["CHAIN_UNAVAILABLE", "NETWORK_INTERRUPTED"], ["WRONG_NETWORK", "WRONG_NETWORK"], ["WRONG_ACCOUNT", "WRONG_ACCOUNT"],
  ])("%s → %s", (code, kind) => { expect(classifyWalletError(Object.assign(new Error("x"), { code })).kind).toBe(kind); });
  it("maps wallet text", () => {
    expect(classifyWalletError(new Error("insufficient funds for gas * price + value")).kind).toBe("INSUFFICIENT_BALANCE");
    expect(classifyWalletError(new TypeError("Failed to fetch")).kind).toBe("NETWORK_INTERRUPTED");
  });
});
