/** SPak Guard policy engine: pure, deterministic, fail closed. No database, no network. */
import { describe, expect, it } from "vitest";
import { evaluateGuard, impliedSlippageBps, quoteWithinSlippage, cleanUsd, type GuardPolicy, type GuardSubject, type GuardStage, type Spending } from "@/guard";

const USDC_BASE = "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOL = "solana:native";
const EVM_R = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-11-13T10:00:00Z");
const zero: Spending = { dayUsd: "0", weekUsd: "0", monthUsd: "0" };

const policy = (o: Partial<GuardPolicy> = {}): GuardPolicy => ({
  userId: "usr_1", version: 3, status: "ACTIVE", executionDisabled: false,
  limits: { maxTransactionUsd: null, minTransactionUsd: null, dailyUsd: null, weeklyUsd: null, monthlyUsd: null },
  maxSlippageBps: 100, assetMode: "ANY", recipientMode: "ANY",
  networks: { base: { allowSource: true, allowDestination: true, disabled: false }, solana: { allowSource: true, allowDestination: true, disabled: false }, arbitrum: { allowSource: true, allowDestination: true, disabled: false } },
  assets: {}, recipients: [], updatedAt: NOW.toISOString(), ...o,
});
const subject = (o: Partial<GuardSubject> = {}): GuardSubject => ({
  sourceNetwork: "base", destinationNetwork: "solana", sourceAssetId: USDC_BASE, destinationAssetId: SOL, recipient: "So1ana1111111111111111111111111111111111111", recipientKind: "SELF",
  slippageBps: 100, valueUsd: "50", quote: { amountOut: "1000", minAmountOut: "990" }, planHash: "a".repeat(64), quoteId: "qte_1", executionId: "exe_1", ...o,
});
const run = (p: GuardPolicy | null, s: GuardSubject = subject(), stage: GuardStage = "QUOTE", spending = zero, extra: { ceilingUsd?: string; quoteChecked?: boolean } = {}) =>
  evaluateGuard({ policy: p, subject: s, spending, stage, ceilingUsd: extra.ceilingUsd ?? "1000", now: NOW, quoteChecked: extra.quoteChecked });
const failed = (d: ReturnType<typeof run>) => d.rules.filter((r) => r.status === "FAIL").map((r) => r.rule);

describe("Guard engine: outcomes", () => {
  it("allowed transfers still need the user's approval before APPROVAL, and are ALLOWED at approval and deposit", () => {
    for (const stage of ["PLAN", "QUOTE", "FIRM_QUOTE"] as const) expect(run(policy(), subject(), stage).outcome).toBe("REQUIRES_APPROVAL");
    expect(run(policy(), subject(), "APPROVAL", zero, { quoteChecked: true }).outcome).toBe("ALLOWED");
    expect(run(policy(), subject(), "DEPOSIT").outcome).toBe("ALLOWED");
  });
  it("no policy at all needs configuration (never allowed by default)", () => {
    const d = run(null);
    expect(d.outcome).toBe("NEEDS_CONFIGURATION");
    expect(d.policyVersion).toBeNull();
  });
  it("a decision carries rules, reasons, timestamp, policy version and the plan, quote and execution it is bound to", () => {
    const d = run(policy({ limits: { ...policy().limits, maxTransactionUsd: "10" } }));
    expect(d).toMatchObject({ outcome: "BLOCKED", policyVersion: 3, planHash: "a".repeat(64), quoteId: "qte_1", executionId: "exe_1", evaluatedAt: NOW.toISOString(), valueUsd: "50" });
    expect(d.reasons[0]).toMatch(/\$10 per-transfer limit/);
  });
  it("is deterministic", () => {
    const p = policy({ limits: { ...policy().limits, dailyUsd: "100" } });
    expect(run(p, subject(), "QUOTE", { dayUsd: "60", weekUsd: "60", monthUsd: "60" })).toEqual(run(p, subject(), "QUOTE", { dayUsd: "60", weekUsd: "60", monthUsd: "60" }));
  });
});

describe("Guard engine: limits", () => {
  const lim = (l: Partial<GuardPolicy["limits"]>) => policy({ limits: { ...policy().limits, ...l } });
  it("per-transfer maximum, exact decimals", () => {
    expect(failed(run(lim({ maxTransactionUsd: "49.99" })))).toEqual(["MAX_TRANSACTION"]);
    expect(run(lim({ maxTransactionUsd: "50" })).outcome).toBe("REQUIRES_APPROVAL");
  });
  it("the platform ceiling applies with no setting and no setting can raise it", () => {
    expect(failed(run(policy(), subject({ valueUsd: "1000.01" })))).toEqual(["MAX_TRANSACTION"]);
    expect(failed(run(lim({ maxTransactionUsd: "5000" }), subject({ valueUsd: "1500" })))).toEqual(["MAX_TRANSACTION"]);
  });
  it("optional minimum", () => {
    expect(failed(run(lim({ minTransactionUsd: "50.01" })))).toEqual(["MIN_TRANSACTION"]);
    expect(run(lim({ minTransactionUsd: "50" })).outcome).toBe("REQUIRES_APPROVAL");
  });
  it("daily, weekly and monthly limits include spending already counted", () => {
    const s = { dayUsd: "60", weekUsd: "300", monthUsd: "900" };
    expect(failed(run(lim({ dailyUsd: "100" }), subject(), "QUOTE", s))).toEqual(["DAILY_LIMIT"]);
    expect(run(lim({ dailyUsd: "110" }), subject(), "QUOTE", s).outcome).toBe("REQUIRES_APPROVAL");
    expect(failed(run(lim({ weeklyUsd: "349.99" }), subject(), "QUOTE", s))).toEqual(["WEEKLY_LIMIT"]);
    expect(failed(run(lim({ monthlyUsd: "940" }), subject(), "QUOTE", s))).toEqual(["MONTHLY_LIMIT"]);
  });
  it("an unknown USD value blocks at every quote-based stage; only the plan stage defers it", () => {
    for (const stage of ["QUOTE", "FIRM_QUOTE", "APPROVAL"] as const) expect(failed(run(policy(), subject({ valueUsd: null }), stage, zero, { quoteChecked: true }))).toContain("VALUE_KNOWN");
    expect(run(policy(), subject({ valueUsd: null, quote: null }), "PLAN").outcome).toBe("REQUIRES_APPROVAL");
  });
});

describe("Guard engine: networks, assets, slippage, recipients", () => {
  it("networks are checked per direction; disabled wins; a network with no rule needs configuration", () => {
    expect(failed(run(policy({ networks: { ...policy().networks, solana: { allowSource: true, allowDestination: false, disabled: false } } })))).toEqual(["DESTINATION_NETWORK"]);
    expect(failed(run(policy({ networks: { ...policy().networks, base: { allowSource: false, allowDestination: true, disabled: false } } })))).toEqual(["SOURCE_NETWORK"]);
    expect(failed(run(policy({ networks: { ...policy().networks, base: { allowSource: true, allowDestination: true, disabled: true } } })))).toEqual(["SOURCE_NETWORK"]);
    const { solana: _s, ...rest } = policy().networks;
    expect(run(policy({ networks: rest })).outcome).toBe("NEEDS_CONFIGURATION");
  });
  it("assets by canonical id: a block always wins; an allowlist must name the asset; an empty allowlist needs configuration", () => {
    expect(failed(run(policy({ assets: { [USDC_BASE]: "BLOCK" } })))).toEqual(["SOURCE_ASSET"]);
    expect(failed(run(policy({ assetMode: "ALLOWLIST", assets: { [USDC_BASE]: "ALLOW" } })))).toEqual(["DESTINATION_ASSET"]);
    expect(run(policy({ assetMode: "ALLOWLIST", assets: { [USDC_BASE]: "ALLOW", [SOL]: "ALLOW" } })).outcome).toBe("REQUIRES_APPROVAL");
    expect(run(policy({ assetMode: "ALLOWLIST", assets: {} })).outcome).toBe("NEEDS_CONFIGURATION");
    // A symbol is never an asset id.
    expect(failed(run(policy({ assetMode: "ALLOWLIST", assets: { USDC: "ALLOW", SOL: "ALLOW" } as GuardPolicy["assets"] })))).toEqual(["SOURCE_ASSET", "DESTINATION_ASSET"]);
  });
  it("slippage: the requested tolerance and the quote's implied tolerance; never raised to fit", () => {
    expect(failed(run(policy(), subject({ slippageBps: 150 })))).toEqual(["SLIPPAGE"]);
    expect(failed(run(policy(), subject({ quote: { amountOut: "1000", minAmountOut: "980" } })))).toEqual(["SLIPPAGE"]);
    expect(failed(run(policy(), subject({ quote: { amountOut: "1000", minAmountOut: null } })))).toEqual(["SLIPPAGE"]);
    expect(run(policy({ maxSlippageBps: 200 }), subject({ quote: { amountOut: "1000", minAmountOut: "980" } })).outcome).toBe("REQUIRES_APPROVAL");
  });
  it("recipients: approval is per network, never across networks", () => {
    const ext = subject({ recipientKind: "EXTERNAL", destinationNetwork: "arbitrum", recipient: EVM_R });
    const p = (recipients: GuardPolicy["recipients"]) => policy({ recipientMode: "APPROVED_ONLY", recipients });
    expect(failed(run(p([]), ext))).toEqual(["RECIPIENT"]);
    expect(failed(run(p([{ id: "grc_1", network: "base", address: EVM_R, label: null }]), ext))).toEqual(["RECIPIENT"]);
    expect(run(p([{ id: "grc_1", network: "base", address: EVM_R, label: null }]), ext).reasons[0]).toMatch(/another network/);
    expect(run(p([{ id: "grc_1", network: "arbitrum", address: EVM_R.toUpperCase().replace("0X", "0x"), label: null }]), ext).outcome).toBe("REQUIRES_APPROVAL");
    expect(run(p([]), subject()).outcome).toBe("REQUIRES_APPROVAL"); // own wallet
  });
});

describe("Guard engine: emergency controls and binding", () => {
  it("pause blocks every step up to approval but not deposit or tracking of approved transfers", () => {
    for (const stage of ["PLAN", "QUOTE", "FIRM_QUOTE", "APPROVAL"] as const) expect(failed(run(policy({ status: "PAUSED" }), subject(), stage, zero, { quoteChecked: true }))).toContain("PAUSED");
    expect(run(policy({ status: "PAUSED" }), subject(), "DEPOSIT").outcome).toBe("ALLOWED");
  });
  it("disabling all execution also blocks deposit preparation", () => {
    expect(failed(run(policy({ status: "PAUSED", executionDisabled: true }), subject(), "DEPOSIT"))).toEqual(["EXECUTION_DISABLED"]);
  });
  it("a disabled network blocks deposit preparation for an approved transfer", () => {
    expect(failed(run(policy({ networks: { ...policy().networks, base: { allowSource: true, allowDestination: true, disabled: true } } }), subject(), "DEPOSIT"))).toEqual(["SOURCE_NETWORK"]);
  });
  it("approval is bound to a prior Guard check of that exact firm quote", () => {
    expect(failed(run(policy(), subject(), "APPROVAL", zero, { quoteChecked: false }))).toEqual(["QUOTE_CHECKED"]);
  });
});

describe("Guard engine: helpers", () => {
  it("slippage on a quote: exact integer math with the validator's one-unit rounding allowance", () => {
    expect(quoteWithinSlippage("1000", "990", 100)).toBe(true);
    expect(quoteWithinSlippage("1000", "989", 100)).toBe(true); // one base unit of provider rounding
    expect(quoteWithinSlippage("1000", "988", 100)).toBe(false);
    // Regression (seen with the live provider): a minimum one unit under the exact 1% floor is 100.0000016 bps, which an
    // earlier version rounded up to 101 bps and blocked. The quote validator accepts it, so Guard must too.
    expect(quoteWithinSlippage("4182640339", "4140813934", 100)).toBe(true);
    expect(quoteWithinSlippage("4182640339", "4140813933", 100)).toBe(false);
    expect(quoteWithinSlippage("x", "1", 100)).toBeNull();
    expect(quoteWithinSlippage("0", "0", 100)).toBeNull();
    expect(impliedSlippageBps("1000", "990")).toBe(100);
    expect(impliedSlippageBps("3", "2")).toBe(3333);
    expect(impliedSlippageBps("x", "1")).toBeNull();
  });
  it("USD values from the provider are parsed strictly", () => {
    expect(cleanUsd("50.0")).toBe("50.0");
    expect(cleanUsd("50.01 USD")).toBe("50.01");
    expect(cleanUsd("")).toBeNull();
    expect(cleanUsd("abc")).toBeNull();
    expect(cleanUsd(null)).toBeNull();
  });
});
