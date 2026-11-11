/**
 * MOCKED CHAIN RPC for deterministic tests. Answers the JSON-RPC methods SPak uses on EVM, Solana and NEAR nodes,
 * from transactions the test registers. Not evidence about real chains; see tests/live/deposit-verify.live.test.ts.
 */
import { pad } from "viem";
import { ERC20_TRANSFER_TOPIC } from "@/deposits/verifiers/evm";
import { RpcAnswerError, RpcUnavailable, type ChainRpc } from "@/deposits/rpc";
import { TOKEN_PROGRAM } from "@/deposits/builder";

export class FakeChain implements ChainRpc {
  down = new Set<string>();
  calls: { network: string; method: string }[] = [];
  evmHead = 1000;
  evm = new Map<string, { tx: Record<string, unknown>; receipt: Record<string, unknown> | null; network?: string }>();
  sol = new Map<string, { status: Record<string, unknown> | null; tx: Record<string, unknown> | null }>();
  near = new Map<string, Record<string, unknown>>();
  nearReceipts = new Map<string, Record<string, unknown>>();
  balances = new Map<string, bigint>(); // key: network|owner|token-or-native
  mintOwner = TOKEN_PROGRAM;
  /** Chain time (unix seconds). EVM: base + 2 s per block from block 1000. Solana and NEAR: per transaction, default base. */
  timeBase = Math.floor(Date.parse("2026-11-10T10:00:00Z") / 1000);
  nearBlockTimes = new Map<string, number>();
  evmBlockTime(n: number) { return this.timeBase + (n - 1000) * 2; }

  async call<T>(network: string, method: string, params: unknown): Promise<T> {
    this.calls.push({ network, method });
    if (this.down.has(network)) throw new RpcUnavailable(network, `${network} RPC down (test)`);
    const p = params as unknown[];
    const bal = (owner: string, token = "native") => this.balances.get(`${network}|${owner.toLowerCase()}|${token.toLowerCase()}`) ?? 0n;
    switch (method) {
      case "eth_getTransactionByHash": { const e = this.evm.get(String(p[0]).toLowerCase()); return ((e && (!e.network || e.network === network)) ? e.tx : null) as T; }
      case "eth_getTransactionReceipt": { const e = this.evm.get(String(p[0]).toLowerCase()); return ((e && (!e.network || e.network === network)) ? e.receipt : null) as T; }
      case "eth_getBlockByNumber": return { number: p[0], timestamp: `0x${this.evmBlockTime(parseInt(String(p[0]), 16)).toString(16)}`, transactions: [] } as T;
      case "block": {
        const bh = (params as { block_id: string }).block_id;
        return { header: { hash: bh, timestamp: String(BigInt(this.nearBlockTimes.get(bh) ?? this.timeBase) * 1_000_000_000n) } } as T;
      }
      case "eth_blockNumber": return `0x${this.evmHead.toString(16)}` as T;
      case "eth_getBalance": return `0x${bal(String(p[0])).toString(16)}` as T;
      case "eth_call": {
        const { to, data } = p[0] as { to: string; data: string };
        return pad(`0x${bal(`0x${data.slice(-40)}`, to).toString(16)}`) as T;
      }
      case "getLatestBlockhash": return { value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 300 } } as T;
      case "getAccountInfo": return { value: { owner: this.mintOwner } } as T;
      case "getBalance": return { value: Number(bal(String(p[0]))) } as T;
      case "getTokenAccountsByOwner": {
        const amount = bal(String(p[0]), (p[1] as { mint: string }).mint);
        return { value: amount ? [{ account: { data: { parsed: { info: { tokenAmount: { amount: amount.toString() } } } } } }] : [] } as T;
      }
      case "getSignatureStatuses": return { value: [this.sol.get(String((p[0] as string[])[0]))?.status ?? null] } as T;
      case "getTransaction": return (this.sol.get(String(p[0]))?.tx ?? null) as T;
      case "tx": {
        const r = this.near.get((params as { tx_hash: string }).tx_hash);
        if (!r) throw new RpcAnswerError("UNKNOWN_TRANSACTION", "Transaction doesn't exist");
        return r as T;
      }
      case "EXPERIMENTAL_tx_status": {
        const q = params as { tx_hash: string; sender_account_id: string };
        const r = this.nearReceipts.get(q.tx_hash);
        if (!r || r.signer !== q.sender_account_id) throw new RpcAnswerError("UNKNOWN_TRANSACTION", "Transaction doesn't exist");
        return r as T;
      }
      case "query": {
        const q = params as { request_type: string; account_id: string; args_base64?: string };
        if (q.request_type === "view_account") return { amount: bal(q.account_id).toString() } as T;
        const who = JSON.parse(Buffer.from(q.args_base64 ?? "", "base64").toString()).account_id as string;
        return { result: [...Buffer.from(JSON.stringify(bal(who, q.account_id).toString()))] } as T;
      }
      default: throw new Error(`FakeChain: unsupported ${method}`);
    }
  }

  setBalance(network: string, owner: string, amount: bigint, token = "native") { this.balances.set(`${network}|${owner.toLowerCase()}|${token.toLowerCase()}`, amount); }

  /** Register an EVM transaction. Defaults describe a correct deposit; override fields to break it. */
  evmTx(hash: string, o: { network?: string; from: string; to: string; value?: bigint; status?: "0x1" | "0x0"; block?: number | null; chainId?: number; logs?: { address: string; from: string; to: string; amount: bigint }[] }) {
    const block = o.block === undefined ? this.evmHead - 10 : o.block;
    this.evm.set(hash.toLowerCase(), {
      network: o.network,
      tx: { hash, from: o.from, to: o.to, value: `0x${(o.value ?? 0n).toString(16)}`, chainId: o.chainId ? `0x${o.chainId.toString(16)}` : undefined, blockNumber: block === null ? null : `0x${block.toString(16)}`, input: "0x" },
      receipt: block === null ? null : {
        status: o.status ?? "0x1", blockNumber: `0x${block.toString(16)}`,
        logs: (o.logs ?? []).map((l) => ({ address: l.address, topics: [ERC20_TRANSFER_TOPIC, pad(l.from as `0x${string}`), pad(l.to as `0x${string}`)], data: `0x${l.amount.toString(16)}` })),
      },
    });
  }

  /** Register a Solana transaction (jsonParsed shape). */
  solTx(sig: string, o: { feePayer: string; keys?: string[]; pre?: number[]; post?: number[]; preToken?: unknown[]; postToken?: unknown[]; err?: unknown; status?: "finalized" | "confirmed" | null; blockTime?: number }) {
    const keys = o.keys ?? [o.feePayer];
    this.sol.set(sig, {
      status: o.status === null ? null : { confirmationStatus: o.status ?? "finalized", err: o.err ?? null },
      tx: { blockTime: o.blockTime ?? this.timeBase, meta: { err: o.err ?? null, preBalances: o.pre ?? keys.map(() => 0), postBalances: o.post ?? keys.map(() => 0), preTokenBalances: o.preToken ?? [], postTokenBalances: o.postToken ?? [] },
        transaction: { message: { accountKeys: keys.map((k, i) => ({ pubkey: k, signer: i === 0 })) } } },
    });
  }

  nearTx(hash: string, o: { signer: string; receiver: string; actions: unknown[]; failure?: boolean; final?: boolean }) {
    this.near.set(hash, {
      final_execution_status: o.final === false ? "EXECUTED_OPTIMISTIC" : "FINAL",
      status: o.failure ? { Failure: { ActionError: {} } } : { SuccessValue: "" },
      transaction: { signer_id: o.signer, receiver_id: o.receiver, actions: o.actions },
      receipts_outcome: [{ outcome: { status: o.failure ? { Failure: {} } : { SuccessValue: "" } } }],
    });
  }

  /** Register a NEAR transaction with receipts (destination delivery shape). */
  nearRxTx(hash: string, o: { signer?: string; receipts: { id: string; receiver: string; predecessor?: string; actions: unknown[]; failed?: boolean }[]; final?: boolean; failure?: boolean; time?: number }) {
    if (o.time !== undefined) this.nearBlockTimes.set(`blk-${hash}`, o.time);
    this.nearReceipts.set(hash, {
      signer: o.signer ?? "intents.near",
      transaction: { signer_id: o.signer ?? "intents.near", hash },
      transaction_outcome: { block_hash: `blk-${hash}` },
      final_execution_status: o.final === false ? "EXECUTED_OPTIMISTIC" : "FINAL",
      status: o.failure ? { Failure: {} } : { SuccessValue: "" },
      receipts: o.receipts.map((r) => ({ receipt_id: r.id, receiver_id: r.receiver, predecessor_id: r.predecessor ?? "intents.near", receipt: { Action: { actions: r.actions } } })),
      receipts_outcome: o.receipts.map((r) => ({ id: r.id, outcome: { status: r.failed ? { Failure: {} } : { SuccessValue: "" } } })),
    });
  }
}
