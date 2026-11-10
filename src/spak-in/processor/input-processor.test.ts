import { describe, expect, it } from "vitest";
import { normalize, processInput } from "./input-processor";

const kinds = (s: string) => {
  const r = processInput(s);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.tokens.map((t) => `${t.kind}:${t.value ?? t.raw}`);
};

describe("input processor", () => {
  it("normalizes whitespace, arrows and punctuation", () => {
    expect(normalize("  Swap   50 USDC  →  SOL!! ")).toBe("Swap 50 USDC to SOL");
    expect(normalize("Swap 1,000,000 USDC.")).toBe("Swap 1000000 USDC");
    expect(normalize("swap .5 eth")).toBe("swap 0.5 eth");
  });
  it("keeps decimals and addresses intact", () => {
    expect(kinds("send 0.25 ETH to 0x1111111111111111111111111111111111111111.")).toEqual([
      "word:send", "number:0.25", "word:ETH", "word:to", "address:0x1111111111111111111111111111111111111111",
    ]);
  });
  it("recognizes percent, money and suffixes", () => {
    expect(kinds("move 25% of my usdc")).toContain("percent:25");
    expect(kinds("move 25 percent")).toContain("percent:25");
    expect(kinds("buy $1.5k of eth")).toContain("money:1500");
    expect(kinds("swap 2k usdc")).toContain("number:2000");
    expect(kinds("swap 50usdc")).toEqual(["word:swap", "number:50", "word:usdc"]);
  });
  it("keeps clause commas", () => {
    expect(kinds("when eth hits 4000, swap 1 eth")).toContain("punct:,");
  });
  it("flags broken addresses and name services", () => {
    expect(kinds("send 5 usdc to 0x123")).toContain("bad_address:0x123");
    expect(kinds("send 5 usdc to vitalik.eth")).toContain("name_service:vitalik.eth");
  });
  it("rejects malformed input", () => {
    expect(processInput("").ok).toBe(false);
    expect(processInput("   ").ok).toBe(false);
    expect(processInput("!!! 123").ok).toBe(false);
    expect(processInput("a".repeat(501)).ok).toBe(false);
    expect(processInput("swap\u0000 eth").ok).toBe(false);
    expect(processInput(42).ok).toBe(false);
  });
});
