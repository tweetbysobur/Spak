/** Guard in the browser: wording, display helpers and read views. Rendered with real components, data shaped like the API's. */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateGuard, type GuardPolicy } from "@/guard";
import { guardApi, guardMessage, guardState, planBlock, usage, type GuardView } from "@/lib/guard";
import { Limits, UsageRow } from "@/components/guard/Limits";
import { Assets, Networks, Protection } from "@/components/guard/Permissions";
import { Recipients } from "@/components/guard/Recipients";
import { Emergency } from "@/components/guard/Emergency";
import { describeChanges } from "@/components/guard/History";

const USDC_BASE = "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const policy = (o: Partial<GuardPolicy> = {}): GuardPolicy => ({
  userId: "usr_1", version: 4, status: "ACTIVE", executionDisabled: false,
  limits: { maxTransactionUsd: null, minTransactionUsd: null, dailyUsd: null, weeklyUsd: null, monthlyUsd: null },
  maxSlippageBps: 100, assetMode: "ANY", recipientMode: "ANY",
  networks: { base: { allowSource: true, allowDestination: false, disabled: false }, solana: { allowSource: true, allowDestination: true, disabled: true } },
  assets: {}, recipients: [], updatedAt: "2026-11-13T10:00:00.000Z", ...o,
});
const view = (o: Partial<GuardPolicy> = {}, extra: Partial<GuardView> = {}): GuardView => ({ policy: policy(o), spending: { dayUsd: "50", weekUsd: "120", monthUsd: "400" }, ceilingUsd: "1000", unconfiguredNetworks: [], ...extra });
const run = vi.fn(async () => null);
const html = (el: ReturnType<typeof h>) => renderToStaticMarkup(el);
const err = (code: string, details?: Record<string, unknown>, message = "server reason") => Object.assign(new Error(message), { code, details });

describe("guardMessage: Guard errors in plain words", () => {
  const cases: [string[], string][] = [
    [["DAILY_LIMIT"], "Daily spending limit reached."], [["WEEKLY_LIMIT"], "Weekly spending limit reached."], [["MONTHLY_LIMIT"], "Monthly spending limit reached."],
    [["MAX_TRANSACTION"], "Transfer exceeds your per-transfer limit."], [["DESTINATION_NETWORK"], "This network is not allowed by your Guard settings."],
    [["RECIPIENT"], "This recipient has not been approved."], [["SLIPPAGE"], "Slippage exceeds your configured limit."],
    [["PAUSED"], "Guard is paused. New transfers are currently disabled."], [["SOURCE_ASSET"], "This token is not allowed by your Guard settings."],
    // Emergency controls and limits come before permissions when several rules fail.
    [["RECIPIENT", "PAUSED"], "Guard is paused. New transfers are currently disabled."], [["SLIPPAGE", "DAILY_LIMIT"], "Daily spending limit reached."],
  ];
  for (const [rules, title] of cases) it(`${rules.join(" + ")} → ${title}`, () => {
    expect(guardMessage(err("GUARD_BLOCKED", { failedRules: rules, reasons: ["exact server reason"] }))).toEqual({ title, reasons: ["exact server reason"] });
  });
  it("falls back to the server's reason when there is no mapping", () => {
    expect(guardMessage(err("GUARD_BLOCKED", { reasons: ["Something specific."] }))).toEqual({ title: "Guard stopped this transfer.", reasons: ["Something specific."] });
    expect(guardMessage(err("GUARD_BLOCKED", undefined, "Only a message."))!.reasons).toEqual(["Only a message."]);
  });
  it("unavailable, conflict and needs-configuration; other errors are not Guard's", () => {
    expect(guardMessage(err("GUARD_UNAVAILABLE"))!.title).toBe("Guard is temporarily unavailable.");
    expect(guardMessage(err("GUARD_UNAVAILABLE"))!.reasons.join()).not.toMatch(/sql|stack|connection/i);
    expect(guardMessage(err("GUARD_VERSION_CONFLICT"))!.title).toMatch(/changed elsewhere/);
    expect(guardMessage(err("GUARD_NEEDS_CONFIGURATION", { failedRules: ["DESTINATION_NETWORK"] }))!.title).toMatch(/needs a setting/);
    expect(guardMessage(err("QUOTE_EXPIRED"))).toBeNull();
    expect(guardMessage(new Error("x"))).toBeNull();
  });
});

describe("planBlock: the server's plan decision decides whether the flow stops", () => {
  const subject = { sourceNetwork: "base", destinationNetwork: "arbitrum", sourceAssetId: USDC_BASE, destinationAssetId: USDC_BASE, recipient: "0x1", recipientKind: "SELF" as const, slippageBps: 100, valueUsd: null, planHash: "a", quoteId: null, executionId: null };
  const decide = (p: GuardPolicy) => evaluateGuard({ policy: p, subject, spending: { dayUsd: "0", weekUsd: "0", monthUsd: "0" }, stage: "PLAN", ceilingUsd: "1000", now: new Date() });
  it("BLOCKED and NEEDS_CONFIGURATION stop with an explanation; REQUIRES_APPROVAL and no decision go on", () => {
    expect(planBlock(decide(policy({ networks: { base: { allowSource: true, allowDestination: true, disabled: false } } })))?.title).toMatch(/needs a setting/);
    expect(planBlock(decide(policy({ status: "PAUSED", networks: { base: { allowSource: true, allowDestination: true, disabled: false }, arbitrum: { allowSource: true, allowDestination: true, disabled: false } } })))?.title).toBe("Guard is paused. New transfers are currently disabled.");
    expect(planBlock(decide(policy({ networks: { base: { allowSource: true, allowDestination: true, disabled: false }, arbitrum: { allowSource: true, allowDestination: true, disabled: false } } })))).toBeNull();
    expect(planBlock(null)).toBeNull();
    expect(planBlock(undefined)).toBeNull();
  });
});

describe("display helpers", () => {
  it("usage is a share only when a limit is set, and clamps", () => {
    expect(usage("50", null)).toBeNull();
    expect(usage("50", "200")).toBe(25);
    expect(usage("500", "200")).toBe(100);
    expect(usage("x", "200")).toBeNull();
  });
  it("status follows the server's policy", () => {
    expect(guardState(view())).toBe("ACTIVE");
    expect(guardState(view({ status: "PAUSED" }))).toBe("PAUSED");
    expect(guardState(view({ status: "PAUSED", executionDisabled: true }))).toBe("EXECUTION_DISABLED");
    expect(guardState(view({}, { unconfiguredNetworks: ["aptos"] }))).toBe("NEEDS_CONFIGURATION");
    expect(guardState(view({ assetMode: "ALLOWLIST" }))).toBe("NEEDS_CONFIGURATION");
  });
  it("every write sends the version on screen", async () => {
    const f = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", f);
    await guardApi.update(7, { dailyLimitUsd: "100" });
    await guardApi.addRecipient(7, { network: "base", address: "0x1" });
    await guardApi.removeRecipient(7, "grc_1");
    await guardApi.resume(7);
    await guardApi.pause("ALL");
    const bodies = f.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
    expect(bodies.slice(0, 4).every((b) => b.version === 7)).toBe(true);
    expect(bodies[0]).toEqual({ version: 7, dailyLimitUsd: "100" });
    expect(bodies[4]).toEqual({ scope: "ALL" });
    expect(f.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1].method)).toEqual(["PATCH", "POST", "DELETE", "POST", "POST"]);
  });
  afterEach(() => vi.unstubAllGlobals());
});

describe("read views render the server's values only", () => {
  it("limits: usage with a bar when set, no percentage when not, ceiling shown", () => {
    const out = html(h(Limits, { view: view({ limits: { maxTransactionUsd: "250", minTransactionUsd: null, dailyUsd: "200", weeklyUsd: null, monthlyUsd: null } }), run }));
    expect(out).toContain("$250");
    expect(out).toContain("$1,000");
    expect(out.match(/role="progressbar"/g)).toHaveLength(1);
    expect(out).toContain('aria-valuenow="25"');
    expect(out).toContain("no limit set");
    expect(html(h(UsageRow, { label: "7-day limit", spent: "0", limit: null, window: "last 7 days" }))).not.toContain("%");
  });
  it("networks: source and destination separately, disabled named, unconfigured flagged", () => {
    const out = html(h(Networks, { view: view(), run }));
    expect(out).toMatch(/data-network="base".*Send only/);
    expect(out).toMatch(/data-network="solana".*Disabled/);
    expect(out).toMatch(/data-network="arbitrum".*Needs a decision/);
    // Default networks are summarised once, not listed one by one.
    const open = { allowSource: true, allowDestination: true, disabled: false };
    const mostly = html(h(Networks, { view: view({ networks: { ...Object.fromEntries(["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "gnosis", "near", "solana", "bitcoin", "tron", "sui", "xrp", "dogecoin", "litecoin", "ton", "stellar", "aptos"].map((n) => [n, open])), base: { ...open, allowDestination: false } } }), run }));
    expect(mostly).toContain("18 of 19 networks: send and receive.");
    expect(mostly).not.toMatch(/data-network="ethereum"/);
    expect(mostly).toMatch(/data-network="base".*Send only/);
    const all = html(h(Networks, { view: { ...view(), policy: { ...policy(), networks: {} } }, run }));
    expect(all).toContain("No network allows both");
  });
  it("tokens: by canonical id, allowlist and blocks", () => {
    const out = html(h(Assets, { view: view({ assetMode: "ALLOWLIST", assets: { [USDC_BASE]: "BLOCK" } }), run }));
    expect(out).toContain(USDC_BASE.slice(0, 12));
    expect(out).toContain("USDC on Base");
    expect(out).toContain("Your allowlist is empty");
  });
  it("protection and recipients", () => {
    expect(html(h(Protection, { view: view({ maxSlippageBps: 50, recipientMode: "APPROVED_ONLY" }), run }))).toMatch(/0\.5%.*Only approved recipients/);
    const r = html(h(Recipients, { view: view({ recipientMode: "APPROVED_ONLY", recipients: [{ id: "grc_1", network: "arbitrum", address: "0x4444444444444444444444444444444444444444", label: "Savings" }] }), run }));
    expect(r).toContain("Savings");
    expect(r).toContain("Arbitrum only");
    expect(r).toContain("not approved on any other");
    expect(html(h(Recipients, { view: view(), run }))).toContain("No approved recipients yet.");
  });
  it("emergency controls say that transfers in flight continue", () => {
    const out = html(h(Emergency, { view: view(), run }));
    expect(out).toContain("Pause new transfers");
    expect(out).toContain("Disable all execution");
    expect(out).toMatch(/tracking, delivery checks and refund recovery always continue/);
    expect(out).not.toContain("Resume Guard");
    expect(html(h(Emergency, { view: view({ status: "PAUSED" }), run }))).toContain("Resume Guard");
  });
});

describe("history", () => {
  it("before and after values in words, no internal ids", () => {
    const lines = describeChanges({ version: 3, actor: "user:usr_abc", action: "UPDATED", at: "2026-11-13T10:00:00Z", changes: {
      dailyLimitUsd: { from: null, to: "100" }, maxSlippageBps: { from: 100, to: 50 }, "network:base": { from: { allowSource: true, allowDestination: true, disabled: false }, to: { allowSource: true, allowDestination: true, disabled: true } },
      assets: { from: {}, to: { [USDC_BASE]: "BLOCK" } },
    } });
    expect(lines).toEqual(["24-hour limit: not set → $100", "Maximum slippage: 1% → 0.5%", "Base: send and receive → disabled", "Token rules: none → USDC on Base blocked"]);
    expect(lines.join()).not.toContain("usr_");
  });
});
