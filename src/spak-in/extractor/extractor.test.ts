import { describe, expect, it } from "vitest";
import { processInput } from "../processor/input-processor";
import { extractEntities } from ".";

const NOW = new Date("2026-11-10T10:00:00.000Z"); // a Tuesday
const ex = (s: string, timezone?: string) => {
  const p = processInput(s);
  if (!p.ok) throw new Error(p.error.message);
  return extractEntities(p.value.tokens, { now: NOW, timezone });
};

describe("entity extractor: schedules", () => {
  it("weekly on a weekday", () => {
    const s = ex("transfer 20 usdc every monday at 9am", "Africa/Lagos").schedule!;
    expect(s).toMatchObject({ type: "RECURRING", frequency: "WEEKLY", daysOfWeek: [1], time: "09:00", timezone: "Africa/Lagos" });
  });
  it("intervals and adverbs", () => {
    expect(ex("send 5 usdc every 2 weeks").schedule).toMatchObject({ frequency: "WEEKLY", interval: 2 });
    expect(ex("swap 1 eth daily at 18:30").schedule).toMatchObject({ frequency: "DAILY", time: "18:30" });
    expect(ex("pay 10 usdc monthly on the 1st").schedule).toMatchObject({ frequency: "MONTHLY", dayOfMonth: 1 });
    expect(ex("send 5 usdc every weekday").schedule!.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });
  it("one-off times resolve against the injected clock and zone", () => {
    expect(ex("send 5 usdc in 2 hours").schedule!.startAt).toBe("2026-11-10T12:00:00.000Z");
    expect(ex("send 5 usdc tomorrow at 9am", "Africa/Lagos").schedule!.startAt).toBe("2026-11-11T08:00:00.000Z");
    expect(ex("send 5 usdc tomorrow at 9am").scheduleMissing).toContain("schedule.timezone");
  });
  it("flags an ambiguous hour", () => {
    expect(ex("send 5 usdc every monday at 9").issues[0].code).toBe("INVALID_SCHEDULE");
  });
});

describe("entity extractor: conditions", () => {
  it("price triggers", () => {
    expect(ex("swap 1 ETH to USDC when ETH reaches $4,000").condition).toMatchObject({ kind: "PRICE", symbol: "ETH", comparator: "CROSSES", value: "4000" });
    expect(ex("when SOL drops below 100, swap 50 usdc to sol").condition).toMatchObject({ comparator: "LTE", value: "100" });
    expect(ex("buy sol if sol is above 250").condition).toMatchObject({ comparator: "GTE" });
  });
  it("fee and route triggers", () => {
    expect(ex("bridge 1 eth when gas on ethereum is below 10 gwei").condition).toMatchObject({ kind: "NETWORK_FEE", network: "ethereum", unit: "GWEI", value: "10" });
    expect(ex("notify me when a better route is available").condition).toMatchObject({ kind: "ROUTE_AVAILABLE", onTrigger: "NOTIFY" });
  });
  it("rejects incomplete triggers", () => {
    expect(ex("swap 1 eth when it goes up").issues[0].code).toBe("INVALID_CONDITION");
  });
});

describe("entity extractor: constraints", () => {
  it("slippage and minimum output", () => {
    const e = ex("swap 50 usdc on base to sol with max 0.5% slippage and receive at least 0.5 SOL");
    expect(e.constraints).toEqual({ slippageBps: 50, minOutput: { value: "0.5", symbol: "SOL" } });
  });
  it("rejects silly slippage", () => {
    expect(ex("swap 1 eth with 80% slippage").issues[0].code).toBe("INVALID_CONSTRAINT");
  });
});
