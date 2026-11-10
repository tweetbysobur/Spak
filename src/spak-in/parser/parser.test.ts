import { describe, expect, it } from "vitest";
import { processInput } from "../processor/input-processor";
import { extractEntities } from "../extractor";
import { parse } from "./intent-parser";

const NOW = new Date("2026-11-10T10:00:00.000Z");
const p = (s: string) => {
  const r = processInput(s);
  if (!r.ok) throw new Error(r.error.message);
  return parse(r.value.tokens, extractEntities(r.value.tokens, { now: NOW }));
};

describe("intent parser: roles", () => {
  it("source and destination by preposition", () => {
    expect(p("Swap 50 USDC on Base to SOL on Solana")).toMatchObject({ sourceSymbol: "USDC", sourceNetwork: "base", destSymbol: "SOL", destNetwork: "solana" });
    expect(p("bridge 0.5 eth from ethereum to near")).toMatchObject({ sourceNetwork: "ethereum", destNetwork: "near", destSymbol: null });
  });
  it("reads ambiguous words from grammar", () => {
    expect(p("swap 1 usdc on base to sol")).toMatchObject({ destSymbol: "SOL", destNetwork: null });
    expect(p("bridge 1 usdc from base to sol")).toMatchObject({ destNetwork: "solana" });
    expect(p("swap 10 near to usdc on near")).toMatchObject({ sourceSymbol: "NEAR", destNetwork: "near" });
  });
  it("handles buy word order", () => {
    expect(p("buy SOL with 50 USDC on Solana")).toMatchObject({ sourceSymbol: "USDC", destSymbol: "SOL", amount: { kind: "EXACT", value: "50" } });
  });
  it("recipients", () => {
    expect(p("send 5 usdc to 0x1111111111111111111111111111111111111111 on arbitrum").recipient).toEqual({ kind: "EXTERNAL", address: "0x1111111111111111111111111111111111111111" });
    expect(p("send 5 usdc to this arbitrum address")).toMatchObject({ recipient: { kind: "PLACEHOLDER" }, destNetwork: "arbitrum" });
    expect(p("move 5 usdc from base to my wallet on arbitrum").recipient?.kind).toBe("SELF");
  });
  it("amount forms", () => {
    expect(p("move 25% of my usdc to near").amount).toEqual({ kind: "PERCENT_OF_BALANCE", percent: "25" });
    expect(p("move half my usdc to near").amount).toEqual({ kind: "PERCENT_OF_BALANCE", percent: "50" });
    expect(p("bridge all my eth to base").amount).toEqual({ kind: "PERCENT_OF_BALANCE", percent: "100" });
    expect(p("swap $100 of eth to usdc").amount).toEqual({ kind: "FIAT_VALUE", value: "100", currency: "USD" });
  });
  it("detects ambiguity instead of guessing", () => {
    expect(p("swap 50 or 60 usdc to sol").issues.map((i) => i.code)).toContain("AMBIGUOUS_AMOUNT");
    expect(p("swap 5 usdc to sol and send it to 0x1111111111111111111111111111111111111111").issues.map((i) => i.code)).toContain("MULTI_STEP_NOT_SUPPORTED");
  });
  it("unsupported networks and unknown tickers", () => {
    expect(p("swap 5 usdc on fantom to sol").issues[0]).toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    expect(p("swap 50 FOOBAR on base to usdc").unknownSymbols).toEqual(["FOOBAR"]);
  });
  it("rebalance allocations", () => {
    expect(p("rebalance my portfolio to 60% ETH and 40% USDC").allocations).toEqual([{ symbol: "ETH", percent: "60" }, { symbol: "USDC", percent: "40" }]);
  });
});
