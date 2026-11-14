import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { getNetwork } from "../spak-in/registries/networks";
import { ExecutionError } from "../execution/errors";
import type { ChainRpc } from "./rpc";
import { RpcUnavailable } from "./rpc";
import type { DepositKind } from "./types";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xLWBvKw4oUgcVu1jw";
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export interface DepositInput {
  network: string;
  assetId: string;
  symbol: string;
  decimals: number;
  contract: string | null;
  depositAddress: string;
  depositMemo: string | null;
  amount: string; // smallest units
  sender: string;
}

/** A human-readable line the UI shows before the wallet prompt. */
export interface DisplayStep { action: string; detail: string }

export type DepositTransaction =
  | { family: "evm"; kind: "NATIVE" | "ERC20"; chainId: number; request: { from: string; to: string; value: string; data: Hex }; steps: DisplayStep[]; approvals: [] }
  | { family: "solana"; kind: "NATIVE" | "SPL"; chain: "solana:mainnet"; transactionBase64: string; lastValidBlockHeight: number; tokenProgram: string | null; steps: DisplayStep[]; approvals: [] }
  | { family: "near"; kind: "NATIVE" | "NEP141"; receiverId: string; actions: { type: "Transfer"; deposit: string }[] | NearFunctionCall[]; steps: DisplayStep[]; approvals: []; walletSigning: false; reason: string };

export type NearFunctionCall =
  | { type: "FunctionCall"; methodName: "storage_deposit"; args: { account_id: string; registration_only: true }; gas: string; deposit: string }
  | { type: "FunctionCall"; methodName: "ft_transfer"; args: { receiver_id: string; amount: string; memo?: string }; gas: string; deposit: "1" };

export function depositKind(family: string, contract: string | null): DepositKind {
  if (!contract) return "NATIVE";
  return family === "evm" ? "ERC20" : family === "solana" ? "SPL" : "NEP141";
}

/**
 * Build the exact deposit transaction from server-side data only (firm quote + verified registry).
 * NEAR Intents ORIGIN_CHAIN deposits are plain transfers to the deposit address, so no token allowance
 * (approve) is ever requested; `approvals` is always empty.
 */
export async function buildDepositTransaction(rpc: ChainRpc, d: DepositInput): Promise<DepositTransaction> {
  const net = getNetwork(d.network);
  if (!net) throw new ExecutionError("UNSUPPORTED_NETWORK", `Unknown network ${d.network}.`);
  const human = `${d.amount} base units of ${d.symbol} (${d.decimals} decimals)`;

  if (net.family === "evm") {
    if (!net.chainId) throw new ExecutionError("UNSUPPORTED_NETWORK", `${net.name} has no chain id.`);
    const chainId = Number(net.chainId);
    if (!d.contract) {
      return { family: "evm", kind: "NATIVE", chainId, approvals: [],
        request: { from: d.sender, to: d.depositAddress, value: d.amount, data: "0x" },
        steps: [{ action: `Send ${d.symbol}`, detail: `${human} to ${d.depositAddress} on ${net.name}` }] };
    }
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [d.depositAddress as Hex, BigInt(d.amount)] });
    return { family: "evm", kind: "ERC20", chainId, approvals: [],
      request: { from: d.sender, to: d.contract, value: "0", data },
      steps: [{ action: `Transfer ${d.symbol} (ERC-20)`, detail: `token contract ${d.contract}: transfer ${human} to ${d.depositAddress}. No allowance is requested.` }] };
  }

  if (net.family === "solana") {
    const from = new PublicKey(d.sender), to = new PublicKey(d.depositAddress);
    const { value: bh } = await rpc.call<{ value: { blockhash: string; lastValidBlockHeight: number } }>(d.network, "getLatestBlockhash", [{ commitment: "finalized" }]);
    const tx = new Transaction({ feePayer: from, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });
    const steps: DisplayStep[] = [];
    let tokenProgram: string | null = null;
    if (!d.contract) {
      tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: BigInt(d.amount) }));
      steps.push({ action: "Send SOL", detail: `${human} to ${d.depositAddress}` });
    } else {
      const mint = new PublicKey(d.contract);
      const info = await rpc.call<{ value: { owner: string } | null }>(d.network, "getAccountInfo", [d.contract, { encoding: "base64", commitment: "finalized" }]);
      tokenProgram = info.value?.owner ?? null;
      if (tokenProgram !== TOKEN_PROGRAM && tokenProgram !== TOKEN_2022_PROGRAM) {
        throw new ExecutionError("UNSUPPORTED_ASSET", `Mint ${d.contract} is not owned by a known token program; deposit refused.`);
      }
      const program = new PublicKey(tokenProgram);
      const ata = (owner: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), program.toBuffer(), mint.toBuffer()], new PublicKey(ATA_PROGRAM))[0];
      const source = ata(from), dest = ata(to);
      // Create the deposit address's token account if it does not exist yet (idempotent: no-op when it does).
      tx.add(new TransactionInstruction({
        programId: new PublicKey(ATA_PROGRAM), data: Buffer.from([1]),
        keys: [
          { pubkey: from, isSigner: true, isWritable: true }, { pubkey: dest, isSigner: false, isWritable: true },
          { pubkey: to, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: program, isSigner: false, isWritable: false },
        ],
      }));
      // TransferChecked (instruction 12): amount u64 LE + decimals u8. Checks mint and decimals on chain.
      const data = Buffer.alloc(10); data.writeUInt8(12, 0); data.writeBigUInt64LE(BigInt(d.amount), 1); data.writeUInt8(d.decimals, 9);
      tx.add(new TransactionInstruction({
        programId: program, data,
        keys: [
          { pubkey: source, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: dest, isSigner: false, isWritable: true }, { pubkey: from, isSigner: true, isWritable: false },
        ],
      }));
      steps.push({ action: "Create the deposit token account if needed", detail: `associated account ${dest.toBase58()} owned by ${d.depositAddress} (you pay rent once if it is new)` });
      steps.push({ action: `Transfer ${d.symbol} (SPL)`, detail: `${human} from ${source.toBase58()} to ${dest.toBase58()}, mint ${d.contract}` });
    }
    if (d.depositMemo) {
      tx.add(new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [{ pubkey: from, isSigner: true, isWritable: false }], data: Buffer.from(d.depositMemo, "utf8") }));
      steps.push({ action: "Attach memo", detail: d.depositMemo });
    }
    const transactionBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    return { family: "solana", kind: d.contract ? "SPL" : "NATIVE", chain: "solana:mainnet", transactionBase64, lastValidBlockHeight: bh.lastValidBlockHeight, tokenProgram, steps, approvals: [] };
  }

  if (net.family === "near") {
    const reason = "Meteor Wallet can only sign transactions after a sign-in that adds an access key to your account, which SPak does not request. Send this transfer from your NEAR wallet and paste the transaction hash.";
    if (!d.contract) {
      return { family: "near", kind: "NATIVE", receiverId: d.depositAddress, actions: [{ type: "Transfer", deposit: d.amount }], approvals: [], walletSigning: false, reason,
        steps: [{ action: "Send NEAR", detail: `${human} (yoctoNEAR) to ${d.depositAddress}` }] };
    }
    // NEP-141 rejects ft_transfer to an account without storage on the token contract, and 1Click deposit accounts
    // start unregistered (observed on mainnet USDC, 2026-11-14). Register it first, in the same transaction, when needed.
    const storage = await nearStorageRequired(rpc, d.network, d.contract, d.depositAddress);
    const actions: NearFunctionCall[] = [];
    const steps: DisplayStep[] = [];
    if (storage) {
      actions.push({ type: "FunctionCall", methodName: "storage_deposit", args: { account_id: d.depositAddress, registration_only: true }, gas: "30000000000000", deposit: storage });
      steps.push({ action: `storage_deposit on ${d.contract}`, detail: `account_id ${d.depositAddress}, registration_only true, attach ${storage} yoctoNEAR` });
    }
    actions.push({ type: "FunctionCall", methodName: "ft_transfer", args: { receiver_id: d.depositAddress, amount: d.amount, ...(d.depositMemo ? { memo: d.depositMemo } : {}) }, gas: "30000000000000", deposit: "1" });
    steps.push({ action: `ft_transfer on ${d.contract}`, detail: `${human} to ${d.depositAddress}, attach 1 yoctoNEAR` });
    return { family: "near", kind: "NEP141", receiverId: d.contract, walletSigning: false, reason, approvals: [], actions, steps };
  }
  throw new ExecutionError("UNSUPPORTED_NETWORK", `Deposits on ${net.name} are not supported yet.`);
}

/** yoctoNEAR to attach to storage_deposit when `account` is not registered on `contract`; null when it already is. */
export async function nearStorageRequired(rpc: ChainRpc, network: string, contract: string, account: string): Promise<string | null> {
  const view = async (method: string, args: object) => {
    const r = await rpc.call<{ result: number[] }>(network, "query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
    return JSON.parse(Buffer.from(r.result).toString("utf8")) as unknown;
  };
  const balance = await view("storage_balance_of", { account_id: account });
  if (balance !== null) return null;
  const bounds = (await view("storage_balance_bounds", {})) as { min?: string } | null;
  if (!bounds?.min || !/^\d+$/.test(bounds.min)) throw new ExecutionError("CHAIN_UNAVAILABLE", `${contract} did not report its storage deposit.`);
  return bounds.min;
}

/** Sender balance of the deposit asset. "unknown" when the chain cannot be read; the wallet still checks. */
export async function senderBalance(rpc: ChainRpc, d: DepositInput): Promise<{ balance: string | null; sufficient: boolean | null }> {
  const fam = getNetwork(d.network)?.family;
  try {
    let bal: bigint;
    if (fam === "evm") {
      if (!d.contract) bal = BigInt(await rpc.call<string>(d.network, "eth_getBalance", [d.sender, "latest"]));
      else {
        const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [d.sender as Hex] });
        const out = await rpc.call<string>(d.network, "eth_call", [{ to: d.contract, data }, "latest"]);
        bal = out && out !== "0x" ? BigInt(out) : 0n;
      }
    } else if (fam === "solana") {
      if (!d.contract) bal = BigInt((await rpc.call<{ value: number }>(d.network, "getBalance", [d.sender, { commitment: "confirmed" }])).value);
      else {
        const r = await rpc.call<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(d.network, "getTokenAccountsByOwner", [d.sender, { mint: d.contract }, { encoding: "jsonParsed", commitment: "confirmed" }]);
        bal = r.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
      }
    } else if (fam === "near") {
      if (!d.contract) bal = BigInt((await rpc.call<{ amount: string }>(d.network, "query", { request_type: "view_account", finality: "final", account_id: d.sender })).amount);
      else {
        const r = await rpc.call<{ result: number[] }>(d.network, "query", { request_type: "call_function", finality: "final", account_id: d.contract, method_name: "ft_balance_of", args_base64: Buffer.from(JSON.stringify({ account_id: d.sender })).toString("base64") });
        bal = BigInt(JSON.parse(Buffer.from(r.result).toString("utf8")) as string);
      }
    } else return { balance: null, sufficient: null };
    return { balance: bal.toString(), sufficient: bal >= BigInt(d.amount) };
  } catch (e) {
    if (e instanceof RpcUnavailable) return { balance: null, sufficient: null };
    // An account that does not exist yet has no balance.
    return { balance: "0", sufficient: BigInt(d.amount) === 0n };
  }
}
