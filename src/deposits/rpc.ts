/**
 * JSON-RPC access to source chains, for deposit verification and transaction preparation.
 * Each network can list several endpoints (SPAK_RPC_<NETWORK>, comma separated); the next one is tried
 * only when one is unreachable or errors at the transport level. Server-side only.
 */
export const DEFAULT_RPC: Readonly<Record<string, string[]>> = {
  ethereum: ["https://ethereum-rpc.publicnode.com"],
  base: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  arbitrum: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
  optimism: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
  polygon: ["https://polygon-bor-rpc.publicnode.com"],
  bsc: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"],
  avalanche: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"],
  gnosis: ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"],
  solana: ["https://api.mainnet-beta.solana.com"],
  near: ["https://rpc.mainnet.near.org", "https://free.rpc.fastnear.com"],
};

export class RpcUnavailable extends Error {
  constructor(public readonly network: string, message: string) { super(message); this.name = "RpcUnavailable"; }
}
/** A JSON-RPC error answer (the node replied; this is not a transport failure). */
export class RpcAnswerError extends Error {
  constructor(public readonly rpcCode: number | string | undefined, message: string, public readonly data?: unknown) { super(message); this.name = "RpcAnswerError"; }
}

export interface ChainRpc {
  call<T = unknown>(network: string, method: string, params: unknown): Promise<T>;
}

export function endpointsFor(network: string): string[] {
  const env = process.env[`SPAK_RPC_${network.toUpperCase()}`];
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_RPC[network] ?? [];
}

export function httpChainRpc(fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): ChainRpc {
  return {
    async call<T>(network: string, method: string, params: unknown): Promise<T> {
      const urls = endpointsFor(network);
      if (!urls.length) throw new RpcUnavailable(network, `No RPC endpoint configured for ${network}.`);
      let last = "";
      for (const url of urls) {
        try {
          const res = await fetchImpl(url, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: "spak", method, params }), signal: AbortSignal.timeout(timeoutMs),
          });
          const body = (await res.json().catch(() => null)) as { result?: T; error?: { code?: number | string; message?: string; cause?: { name?: string }; data?: unknown } } | null;
          if (!body) { last = `${url}: HTTP ${res.status}`; continue; }
          if (body.error) {
            // Rate limits and server faults are transport problems: try the next endpoint.
            if (res.status === 429 || res.status >= 500 || /limit|too many|unavailable|timeout/i.test(body.error.message ?? "")) { last = `${url}: ${body.error.message}`; continue; }
            throw new RpcAnswerError(body.error.cause?.name ?? body.error.code, body.error.message ?? "RPC error", body.error.data ?? body.error.cause);
          }
          return body.result as T;
        } catch (e) {
          if (e instanceof RpcAnswerError) throw e;
          last = `${url}: ${(e as Error).message}`;
        }
      }
      throw new RpcUnavailable(network, `Could not reach ${network}: ${last}`);
    },
  };
}
