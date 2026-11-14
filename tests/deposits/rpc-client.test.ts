/** The JSON-RPC client's endpoint fallback. MOCKED transport; the error bodies are the real answers public nodes return. */
import { describe, expect, it } from "vitest";
import { httpChainRpc, RpcAnswerError, RpcUnavailable } from "@/deposits/rpc";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(answers: Record<string, () => Response>) {
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => { seen.push(url); return answers[url](); }) as unknown as typeof fetch;
  return { rpc: httpChainRpc(fetchImpl), seen };
}

describe("httpChainRpc endpoint fallback", () => {
  const prev = process.env.SPAK_RPC_ARBITRUM;
  const urls = "https://a.example,https://b.example";
  const withUrls = async (fn: () => Promise<void>) => { process.env.SPAK_RPC_ARBITRUM = urls; try { await fn(); } finally { if (prev === undefined) delete process.env.SPAK_RPC_ARBITRUM; else process.env.SPAK_RPC_ARBITRUM = prev; } };

  it("an endpoint that refuses archive reads is skipped, and the next endpoint answers", () => withUrls(async () => {
    const { rpc, seen } = client({
      "https://a.example": () => reply({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode" } }),
      "https://b.example": () => reply({ jsonrpc: "2.0", id: 1, result: { status: "0x1" } }),
    });
    expect(await rpc.call("arbitrum", "eth_getTransactionReceipt", ["0x1"])).toEqual({ status: "0x1" });
    expect(seen).toEqual(["https://a.example", "https://b.example"]);
  }));

  it("when every endpoint refuses, the chain is unavailable (nothing decided), never an answer", () => withUrls(async () => {
    const refuse = () => reply({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Archive requests require a personal token." } });
    const { rpc } = client({ "https://a.example": refuse, "https://b.example": refuse });
    await expect(rpc.call("arbitrum", "eth_getTransactionReceipt", ["0x1"])).rejects.toBeInstanceOf(RpcUnavailable);
  }));

  it("a real answer error (for example a revert) is returned at once, not retried elsewhere", () => withUrls(async () => {
    const { rpc, seen } = client({
      "https://a.example": () => reply({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted" } }),
      "https://b.example": () => reply({ jsonrpc: "2.0", id: 1, result: "0x" }),
    });
    await expect(rpc.call("arbitrum", "eth_call", [{}])).rejects.toBeInstanceOf(RpcAnswerError);
    expect(seen).toEqual(["https://a.example"]);
  }));
});
