import { afterEach, describe, expect, it } from "vitest";
import { parseNearCallback } from "@/wallets/near-callback";
import { classifyWalletError } from "@/wallets/errors";
import { nearRpc } from "@/auth/verify/near";
import { appOrigin } from "@/server/auth";

describe("NEAR browser-wallet callback parsing", () => {
  const sig = "AbC+dEf/gh==";
  const hash = (o: Record<string, string>) => "#" + new URLSearchParams(o).toString();
  it("accepts a callback for the challenge this tab started and restores '+' in base64", () => {
    const r = parseNearCallback(hash({ accountId: "alice.near", publicKey: "ed25519:abc", signature: sig, state: "chl_1" }), "chl_1");
    expect(r).toEqual({ kind: "signed", challengeId: "chl_1", accountId: "alice.near", publicKey: "ed25519:abc", signature: sig });
  });
  it("rejects callbacks this tab did not start (login CSRF) and replays after the pending marker is gone", () => {
    const h = hash({ accountId: "attacker.near", publicKey: "ed25519:abc", signature: sig, state: "chl_attacker" });
    expect(parseNearCallback(h, "chl_mine").kind).toBe("rejected");
    expect(parseNearCallback(h, null).kind).toBe("rejected");
  });
  it("reports wallet cancellation and errors", () => {
    expect(parseNearCallback(hash({ errorCode: "userRejected", state: "c" }), "c")).toMatchObject({ kind: "error", message: expect.stringMatching(/Cancelled/) });
    expect(parseNearCallback(hash({ error: "boom", state: "c" }), "c")).toMatchObject({ kind: "error" });
  });
  it("ignores unrelated hashes and incomplete or oversized data", () => {
    expect(parseNearCallback("#section-2", "c").kind).toBe("none");
    expect(parseNearCallback("", "c").kind).toBe("none");
    expect(parseNearCallback(hash({ signature: sig, state: "c" }), "c").kind).toBe("error");
    expect(parseNearCallback(hash({ accountId: "a".repeat(80), publicKey: "k", signature: sig, state: "c" }), "c").kind).toBe("error");
  });
});

describe("wallet error classification", () => {
  it.each([
    [{ code: 4001, message: "User rejected the request." }, "CANCELLED"],              // MetaMask / EIP-1193
    [{ code: 4001, message: "User rejected the request" }, "CANCELLED"],               // Phantom
    [new Error("User closed the window"), "CANCELLED"],                                // MyNearWallet popup
    [new Error("Couldn't sign message owner: User cancelled the action"), "CANCELLED"], // Meteor
    [{ code: -32002, message: "Request of type 'wallet_requestPermissions' already pending" }, "PENDING"],
    [new Error("Popup window blocked. Please allow popups for this site."), "POPUP_BLOCKED"],
    [{ code: "CHALLENGE_EXPIRED", message: "x" }, "EXPIRED"],
    [{ code: "CHALLENGE_USED", message: "x" }, "REPLAYED"],
    [{ code: "ACCOUNT_CHANGED", message: "switched" }, "ACCOUNT_CHANGED"],
    [{ code: 4100, message: "Unauthorized" }, "NO_ACCOUNT"],
    [{ code: "WALLET_OWNED_BY_OTHER_USER", message: "taken" }, "OWNED_ELSEWHERE"],
    [new Error("weird"), "FAILED"],
  ])("%o -> %s", (e, kind) => expect(classifyWalletError(e).kind).toBe(kind));
});

describe("NEAR RPC failover", () => {
  const ok = (permission: unknown) => new Response(JSON.stringify({ result: { permission } }));
  it("moves to the next endpoint only when one is unreachable", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => { seen.push(url); if (url === "https://a") throw new TypeError("fetch failed"); return ok("FullAccess"); }) as unknown as typeof fetch;
    expect(await nearRpc(["https://a", "https://b"], f).accessKey("x.near", "ed25519:k")).toBe("FullAccess");
    expect(seen).toEqual(["https://a", "https://b"]);
  });
  it("never retries past a definite 'no'", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => { seen.push(url); return new Response(JSON.stringify({ result: { error: "access key ed25519:k does not exist while viewing" } })); }) as unknown as typeof fetch;
    expect(await nearRpc(["https://a", "https://b"], f).accessKey("x.near", "ed25519:k")).toBeNull();
    expect(seen).toEqual(["https://a"]);
  });
  it("fails closed when every endpoint is down", async () => {
    const f = (async () => { throw new TypeError("down"); }) as unknown as typeof fetch;
    await expect(nearRpc("https://a,https://b", f).accessKey("x.near", "ed25519:k")).rejects.toMatchObject({ code: "NEAR_RPC_UNAVAILABLE" });
  });
});

describe("app origin (message domain binding)", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("uses SPAK_APP_ORIGIN and ignores forwarded headers", () => {
    process.env.SPAK_APP_ORIGIN = "https://spak.app";
    const r = new Request("https://spak.app/api/auth/challenge", { headers: { host: "evil.example", "x-forwarded-host": "evil.example" } });
    expect(appOrigin(r).host).toBe("spak.app");
  });
  it("refuses to derive the domain from headers in production", () => {
    delete process.env.SPAK_APP_ORIGIN;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() => appOrigin(new Request("https://x/api", { headers: { host: "evil.example" } }))).toThrow(/SPAK_APP_ORIGIN/);
  });
  it("development ignores X-Forwarded-Host", () => {
    delete process.env.SPAK_APP_ORIGIN;
    const r = new Request("http://localhost:3000/api", { headers: { host: "localhost:3000", "x-forwarded-host": "evil.example" } });
    expect(appOrigin(r).host).toBe("localhost:3000");
  });
});
