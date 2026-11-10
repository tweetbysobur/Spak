/**
 * SIMULATED WALLET TESTS. The browser flow code (src/wallets/flow.ts) runs against the real route handlers,
 * with in-test wallets that sign with real keys. These are not real wallet applications.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64, hex } from "@scure/base";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToString } from "viem";
import { POST as challengeRoute } from "@/app/api/auth/challenge/route";
import { POST as verifyRoute } from "@/app/api/auth/verify/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { nep413Hash } from "@/auth/verify/near";
import type { Eip1193, EvmWalletInfo } from "@/wallets/evm";

// NEAR selector is browser-only: replace signNear with a NEP-413 signer driven by the test.
const nearKey = { sk: ed25519.utils.randomSecretKey(), reject: false };
vi.mock("@/wallets/near", () => ({
  signNear: async (_id: string, a: { message: string; nonceB64: string; recipient: string }) => {
    if (nearKey.reject) throw new Error("User closed the window");
    const pk = ed25519.getPublicKey(nearKey.sk);
    const sig = ed25519.sign(nep413Hash(a.message, base64.decode(a.nonceB64), a.recipient), nearKey.sk);
    return { signature: base64.encode(sig), publicKey: `ed25519:${base58.encode(pk)}`, accountId: hex.encode(pk) };
  },
}));
const { prepare, complete } = await import("@/wallets/flow");
const { classifyWalletError } = await import("@/wallets/errors");

// fetch shim: relative /api calls go to the route handlers, with a cookie jar and same-origin headers.
let jar = "";
const ROUTES: Record<string, (r: Request) => Promise<Response>> = {
  "POST /api/auth/challenge": challengeRoute, "POST /api/auth/verify": verifyRoute, "GET /api/auth/session": sessionRoute,
};
let ipn = 0;
beforeEach(() => {
  jar = "";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const h = new Headers(init.headers);
    h.set("origin", "http://localhost:3000"); h.set("x-forwarded-for", `10.1.0.${++ipn % 250}`);
    if (jar) h.set("cookie", jar);
    const res = await ROUTES[`${method} ${url}`](new Request(`http://localhost:3000${url}`, { ...init, headers: h }));
    const set = res.headers.get("set-cookie");
    if (set) jar = set.split(";")[0];
    return res;
  });
});

function evmSim(opts: { reject?: boolean } = {}) {
  let acct = privateKeyToAccount(generatePrivateKey());
  const provider: Eip1193 = {
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct.address];
      if (method === "eth_chainId") return "0x2105"; // Base
      if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method === "personal_sign") {
        if (opts.reject) throw Object.assign(new Error("MetaMask Tx Signature: User denied message signature."), { code: 4001 });
        const [msgHex, addr] = params as [`0x${string}`, string];
        if (addr.toLowerCase() !== acct.address.toLowerCase()) throw new Error("wrong account");
        return acct.signMessage({ message: hexToString(msgHex) });
      }
      throw new Error(`unsupported ${method}`);
    },
  };
  return { info: { id: "sim.evm", name: "Simulated EVM", provider } as EvmWalletInfo, switchAccount: () => { acct = privateKeyToAccount(generatePrivateKey()); } };
}

function solanaSim() {
  const sk = ed25519.utils.randomSecretKey();
  const address = base58.encode(ed25519.getPublicKey(sk));
  const account = { address, publicKey: ed25519.getPublicKey(sk), chains: ["solana:mainnet"], features: [] };
  const wallet = {
    name: "Simulated Solana", icon: "", chains: ["solana:mainnet"], accounts: [account], version: "1.0.0",
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "solana:signMessage": { version: "1.0.0", signMessage: async ({ message }: { message: Uint8Array }) => [{ signedMessage: message, signature: ed25519.sign(message, sk) }] },
    },
  };
  return { id: "sim.sol", name: wallet.name, wallet } as never;
}

const signedIn = async () => ((await (await fetch("/api/auth/session")).json()) as { authenticated: boolean; wallets?: { address: string }[] });

describe("simulated wallets through the real flow code", () => {
  it("EVM: connect, sign the SIWE message, session cookie set", async () => {
    const w = evmSim();
    const p = await prepare({ family: "evm", info: w.info }, "SIGN_IN");
    expect(p.challenge.message).toContain("Chain ID: 8453");
    expect(await complete(p)).toMatchObject({ created: true });
    expect((await signedIn()).authenticated).toBe(true);
  });
  it("EVM: rejection in the wallet leaves the user signed out and is reported as cancelled", async () => {
    const w = evmSim({ reject: true });
    const p = await prepare({ family: "evm", info: w.info }, "SIGN_IN");
    const e = await complete(p).catch((x) => x);
    expect(classifyWalletError(e).kind).toBe("CANCELLED");
    expect((await signedIn()).authenticated).toBe(false);
  });
  it("EVM: switching accounts between connect and sign stops before signing", async () => {
    const w = evmSim();
    const p = await prepare({ family: "evm", info: w.info }, "SIGN_IN");
    w.switchAccount();
    const e = await complete(p).catch((x) => x);
    expect(classifyWalletError(e).kind).toBe("ACCOUNT_CHANGED");
  });
  it("EVM: an expired challenge is refused client-side before the wallet is asked", async () => {
    const w = evmSim();
    const p = await prepare({ family: "evm", info: w.info }, "SIGN_IN");
    p.challenge.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(classifyWalletError(await complete(p).catch((x) => x)).kind).toBe("EXPIRED");
  });
  it("Solana: Wallet Standard connect + solana:signMessage", async () => {
    const p = await prepare({ family: "solana", info: solanaSim() }, "SIGN_IN");
    expect(p.challenge.message).toContain("wants you to sign in with your Solana account:");
    expect(await complete(p)).toMatchObject({ created: true });
  });
  it("NEAR: account chosen by the wallet, NEP-413 signature, then linking EVM to the same user", async () => {
    nearKey.sk = ed25519.utils.randomSecretKey(); nearKey.reject = false;
    const p = await prepare({ family: "near", id: "meteor-wallet", name: "Meteor" }, "SIGN_IN");
    expect(p.address).toBeNull();
    const r = await complete(p);
    expect(r).toMatchObject({ created: true });
    const w = evmSim();
    const l = await complete(await prepare({ family: "evm", info: w.info }, "LINK"));
    expect((l as unknown as { userId: string }).userId).toBe((r as unknown as { userId: string }).userId);
    expect((await signedIn()).wallets).toHaveLength(2);
  });
  it("NEAR: closing the wallet popup is a cancellation and the challenge stays unused", async () => {
    nearKey.sk = ed25519.utils.randomSecretKey(); nearKey.reject = true;
    const p = await prepare({ family: "near", id: "my-near-wallet", name: "MyNearWallet" }, "SIGN_IN");
    expect(classifyWalletError(await complete(p).catch((x) => x)).kind).toBe("CANCELLED");
    nearKey.reject = false;
    expect(await complete(p)).toMatchObject({ created: true }); // user retries the same request
  });
});
