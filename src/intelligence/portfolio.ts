/**
 * SPak Portfolio: read-only balance reads for a user's verified wallets on SPak's executable networks.
 * It reuses the deposit RPC client (same endpoints, same fallback). Nothing here signs or sends anything.
 *
 * Accuracy rules:
 * - A balance SPak could not read is UNKNOWN, never zero. A network that cannot be reached is reported as unavailable.
 * - Only assets in SPak's registry are read (the same list SPak-in and Execution use), so every holding maps to an
 *   asset SPak can name. Tokens outside the registry are not shown.
 */
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { RpcAnswerError, RpcUnavailable, type ChainRpc } from "../deposits/rpc";
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../deposits/builder";
import { listAssets, type AssetDefinition } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";

/** Networks SPak can execute on (deposit builder and delivery verifier exist). */
export const EXECUTABLE_NETWORKS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "gnosis", "near", "solana"] as const;
const TOKEN_PROGRAMS = [TOKEN_PROGRAM, TOKEN_2022_PROGRAM];

export interface PortfolioWallet { id: string; family: string; address: string; label: string | null; networks: { id: string; enabled: boolean }[] }
export interface RawHolding { walletId: string; address: string; network: string; asset: AssetDefinition; units: bigint }
export interface NetworkRead { walletId: string; address: string; network: string; status: "OK" | "PARTIAL" | "UNAVAILABLE"; unknownAssets: string[]; error: string | null }
export interface PortfolioRead { holdings: RawHolding[]; reads: NetworkRead[]; readAt: Date }

/** Runs tasks with at most `n` in flight, so public RPCs are not flooded. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/**
 * NEAR's own token is not in the registry: NEAR Intents lists only wrapped NEAR (wrap.near). A NEAR wallet still holds
 * native NEAR (its gas and storage money), so the portfolio reads it as its own entry.
 */
export const NATIVE_NEAR: AssetDefinition = { id: "near:native", network: "near", symbol: "NEAR", decimals: 24, contract: null } as AssetDefinition;
const assetsOn = (network: string) => {
  const reg = listAssets().filter((a) => a.network === network);
  return network === "near" && !reg.some((a) => !a.contract) ? [NATIVE_NEAR, ...reg] : reg;
};

export class PortfolioReader {
  constructor(private readonly rpc: ChainRpc, private readonly clock: () => Date = () => new Date()) {}

  async read(wallets: PortfolioWallet[]): Promise<PortfolioRead> {
    const jobs = wallets.flatMap((w) => w.networks.filter((n) => n.enabled && (EXECUTABLE_NETWORKS as readonly string[]).includes(n.id)).map((n) => ({ w, network: n.id })));
    const holdings: RawHolding[] = [];
    const reads: NetworkRead[] = [];
    await pool(jobs, 4, async ({ w, network }) => {
      const r = await this.readNetwork(w, network);
      holdings.push(...r.holdings);
      reads.push(r.read);
    });
    return { holdings, reads, readAt: this.clock() };
  }

  private async readNetwork(w: PortfolioWallet, network: string): Promise<{ holdings: RawHolding[]; read: NetworkRead }> {
    const fam = getNetwork(network)?.family;
    const out: RawHolding[] = [];
    const unknown: string[] = [];
    const base = { walletId: w.id, address: w.address, network };
    try {
      if (fam === "solana") {
        out.push(...(await this.readSolana(w, network)));
      } else {
        await pool([...assetsOn(network)], 6, async (asset) => {
          try {
            const units = fam === "evm" ? await this.evmBalance(network, w.address, asset) : await this.nearBalance(network, w.address, asset);
            if (units > 0n) out.push({ ...base, asset, units });
          } catch (e) {
            if (e instanceof RpcUnavailable) throw e;
            unknown.push(asset.symbol);
          }
        });
      }
      return { holdings: out, read: { ...base, status: unknown.length ? "PARTIAL" : "OK", unknownAssets: unknown, error: null } };
    } catch (e) {
      return { holdings: [], read: { ...base, status: "UNAVAILABLE", unknownAssets: [], error: (e as Error).message } };
    }
  }

  private async evmBalance(network: string, owner: string, a: AssetDefinition): Promise<bigint> {
    if (!a.contract) return BigInt(await this.rpc.call<string>(network, "eth_getBalance", [owner, "latest"]));
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner as Hex] });
    const out = await this.rpc.call<string>(network, "eth_call", [{ to: a.contract, data }, "latest"]);
    if (!out || out === "0x") throw new Error(`${a.symbol}: empty balanceOf answer`);
    return BigInt(out);
  }

  private async nearBalance(network: string, owner: string, a: AssetDefinition): Promise<bigint> {
    try {
      if (!a.contract) return BigInt((await this.rpc.call<{ amount: string }>(network, "query", { request_type: "view_account", finality: "final", account_id: owner })).amount);
      const r = await this.rpc.call<{ result: number[] }>(network, "query", { request_type: "call_function", finality: "final", account_id: a.contract, method_name: "ft_balance_of", args_base64: Buffer.from(JSON.stringify({ account_id: owner })).toString("base64") });
      return BigInt(JSON.parse(Buffer.from(r.result).toString("utf8")) as string);
    } catch (e) {
      // An implicit account that has never received NEAR does not exist yet: its balance is zero, not unknown.
      if (e instanceof RpcAnswerError && /UNKNOWN_ACCOUNT|does not exist/i.test(`${e.rpcCode} ${e.message}`) && !a.contract) return 0n;
      throw e;
    }
  }

  /** One native read plus one token-account listing per token program, matched to registry mints. */
  private async readSolana(w: PortfolioWallet, network: string): Promise<RawHolding[]> {
    const base = { walletId: w.id, address: w.address, network };
    const out: RawHolding[] = [];
    const reg = assetsOn(network);
    const lamports = BigInt((await this.rpc.call<{ value: number }>(network, "getBalance", [w.address, { commitment: "confirmed" }])).value);
    const native = reg.find((a) => !a.contract);
    if (native && lamports > 0n) out.push({ ...base, asset: native, units: lamports });
    const byMint = new Map<string, bigint>();
    for (const programId of TOKEN_PROGRAMS) {
      const r = await this.rpc.call<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string } } } } } }[] }>(
        network, "getTokenAccountsByOwner", [w.address, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]);
      for (const acc of r.value) {
        const { mint, tokenAmount } = acc.account.data.parsed.info;
        byMint.set(mint, (byMint.get(mint) ?? 0n) + BigInt(tokenAmount.amount));
      }
    }
    for (const a of reg) if (a.contract && (byMint.get(a.contract) ?? 0n) > 0n) out.push({ ...base, asset: a, units: byMint.get(a.contract)! });
    return out;
  }
}
