/** Live NEAR mainnet RPC: the access-key lookup used for named-account ownership. LIVE=1 only. */
import { describe, expect, it } from "vitest";
import { nearRpc } from "@/auth/verify/near";

// Public keys read from mainnet with view_access_key_list on 2026-11-10. If they rotate, update them.
describe("NEAR RPC live", () => {
  const rpc = nearRpc();
  it("unknown key: not authorized", async () => {
    expect(await rpc.accessKey("relay.aurora", "ed25519:11111111111111111111111111111111")).toBeNull();
  });
  it("full-access key", async () => {
    expect(await rpc.accessKey("relay.aurora", "ed25519:hQ8oAMNWRq83v9R6rRrFoWAmMx64tWTyLsoTYjAZoR2")).toBe("FullAccess");
  });
  it("function-call key is not enough", async () => {
    expect(await rpc.accessKey("relay.aurora", "ed25519:8Z3k41xLFJ951xUcqaoAFW822jQBVyXE8C6vMdFWF5C")).toBe("FunctionCall");
  });
});
