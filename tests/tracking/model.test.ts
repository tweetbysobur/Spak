import { describe, expect, it } from "vitest";
import { PHASE_ROLE, PHASE_TITLE, fundsText, notificationFor, phaseOf, phaseSummary, stagesOf, type Phase } from "@/components/tracking/model";
import type { ExecutionView } from "@/lib/client";
import type { TrackingView } from "@/tracking/service";

const STEP_IDS = ["APPROVED", "DEPOSIT_SUBMITTED", "DEPOSIT_CONFIRMED", "PROCESSING", "DESTINATION_DETECTED", "DESTINATION_VERIFICATION", "COMPLETED"];
/** Tracking view with the first `done` steps done, the next one `next`, the rest pending. Shape of the real view. */
function view(state: string, done: number, extra: Partial<Record<string, unknown>> = {}, next: "current" | "halted" = "current"): TrackingView {
  return {
    state, steps: STEP_IDS.map((id, i) => ({ id, label: id, at: i < done ? "2026-11-13T10:00:00.000Z" : null, status: i < done ? "done" : i === done ? next : "pending" })),
    sourceTxs: [], destinationTxs: [], failure: null, refund: null, review: null, destination: {}, ...extra,
  } as unknown as TrackingView;
}
const x = (state: string) => ({ id: "exe_1", state, quotes: [], createdAt: "2026-11-13T09:59:00.000Z", approvedAt: "2026-11-13T10:00:00.000Z" }) as unknown as ExecutionView;

/** Every user-facing phase, from a real server state. */
const CASES: [Phase, string, TrackingView][] = [
  ["AWAITING_DEPOSIT", "AWAITING_DEPOSIT", view("AWAITING_DEPOSIT", 1)],
  ["DEPOSIT_DETECTED", "AWAITING_DEPOSIT", view("AWAITING_DEPOSIT", 2)],
  ["PROCESSING", "PROCESSING", view("PROCESSING", 3)],
  ["VERIFYING", "VERIFYING_DESTINATION", view("VERIFYING_DESTINATION", 5)],
  ["COMPLETED", "COMPLETED", view("COMPLETED", 7)],
  ["FAILED", "FAILED", view("FAILED", 3, {}, "halted")],
  ["UNKNOWN", "UNKNOWN", view("UNKNOWN", 5, {}, "halted")],
  ["REFUND_PENDING", "FAILED", view("FAILED", 3, { refund: { record: { state: "PENDING_PROVIDER" } } }, "halted")],
  ["REFUND_PENDING", "REFUNDING", view("REFUNDING", 3, { refund: { record: { state: "INITIATED" } } }, "halted")],
  ["REFUND_REVIEW", "FAILED", view("FAILED", 3, { refund: { record: { state: "ASSOCIATION_PENDING" } } }, "halted")],
  ["REFUND_REVIEW", "REFUNDING", view("REFUNDING", 3, { review: { status: "OPEN" }, refund: { record: { state: "TX_DETECTED" } } }, "halted")],
  ["REFUNDED", "REFUNDED", view("REFUNDED", 3, { refund: { record: { state: "COMPLETED" } } }, "halted")],
  ["EXPIRED", "EXPIRED", view("EXPIRED", 1, {}, "halted")],
  ["CANCELLED", "CANCELLED", view("CANCELLED", 1, {}, "halted")],
];

describe("tracking model: every transfer state", () => {
  for (const [phase, state, t] of CASES) {
    it(`${state}${t.refund?.record ? ` with refund ${t.refund.record.state}` : ""}${t.review ? " and an open review" : ""} → ${phase}`, () => {
      expect(phaseOf(x(state), t)).toBe(phase);
      expect(PHASE_TITLE[phase]).toBeTruthy();
      expect(phaseSummary(phase, "Arbitrum")).toBeTruthy();
    });
  }

  it("Completed is shown only for the server's COMPLETED state, never inferred from steps", () => {
    for (const state of ["PROCESSING", "VERIFYING_DESTINATION", "UNKNOWN", "FAILED"]) expect(phaseOf(x(state), view(state, 6))).not.toBe("COMPLETED");
    // Even if a provider-reported destination tx exists, the delivery stage stays open until COMPLETED is done.
    const stages = stagesOf(x("VERIFYING_DESTINATION"), view("VERIFYING_DESTINATION", 5));
    expect(stages.find((s) => s.id === "VERIFIED")?.status).toBe("current");
    expect(stagesOf(x("COMPLETED"), view("COMPLETED", 7)).find((s) => s.id === "VERIFIED")?.status).toBe("done");
  });

  it("Refunded is shown only for the server's REFUNDED state, whatever the refund record says", () => {
    for (const rs of ["PENDING_PROVIDER", "INITIATED", "TX_DETECTED", "VERIFICATION_PENDING", "PARTIAL", "ASSOCIATION_PENDING", "DELAYED", "FAILED", "UNKNOWN", "COMPLETED"]) {
      for (const state of ["FAILED", "REFUNDING"]) expect(phaseOf(x(state), view(state, 3, { refund: { record: { state: rs } } }, "halted")), `${state}/${rs}`).not.toBe("REFUNDED");
    }
  });

  it("an unknown outcome is never presented as a failure", () => {
    expect(phaseOf(x("UNKNOWN"), view("UNKNOWN", 5, {}, "halted"))).toBe("UNKNOWN");
    expect(PHASE_ROLE.UNKNOWN).toBe("warning");
    expect(phaseSummary("UNKNOWN", "Solana")).toMatch(/not a failure/);
  });

  it("success colour belongs to verified delivery only; waiting for a deposit is pending, not processing", () => {
    const success = (Object.keys(PHASE_ROLE) as Phase[]).filter((p) => PHASE_ROLE[p] === "success");
    expect(success).toEqual(["COMPLETED"]);
    expect(PHASE_ROLE.AWAITING_DEPOSIT).toBe("pending");
    expect(PHASE_ROLE.REFUNDED).toBe("refunded");
  });

  it("stages: seven, in lifecycle order, with references only from the server", () => {
    const t = view("PROCESSING", 3, { sourceTxs: [{ hash: "0xabc", explorerUrl: "https://basescan.org/tx/0xabc" }] });
    const s = stagesOf(x("PROCESSING"), t);
    expect(s.map((v) => v.id)).toEqual(["QUOTE", "APPROVED", "DEPOSIT_SUBMITTED", "DEPOSIT_CONFIRMED", "PROCESSING", "DESTINATION_DETECTED", "VERIFIED"]);
    expect(s.find((v) => v.id === "DEPOSIT_SUBMITTED")?.refs).toEqual([{ hash: "0xabc", url: "https://basescan.org/tx/0xabc" }]);
    expect(s.find((v) => v.id === "DESTINATION_DETECTED")?.refs).toEqual([]);
    expect(s.find((v) => v.id === "PROCESSING")?.status).toBe("current");
  });

  it("before the tracking view loads, approval comes from the execution and nothing else is marked done", () => {
    const s = stagesOf(x("AWAITING_DEPOSIT"), null);
    expect(s.find((v) => v.id === "APPROVED")?.status).toBe("done");
    expect(s.filter((v) => v.status === "done").map((v) => v.id)).toEqual(["QUOTE", "APPROVED"]);
    expect(stagesOf({ ...x("QUOTED"), approvedAt: null } as unknown as ExecutionView, null).find((v) => v.id === "APPROVED")?.status).toBe("pending");
  });

  it("funds location comes from the server classification and is silent when absent", () => {
    expect(fundsText(view("FAILED", 3, { failure: { funds: "IN_TRANSIT" } }))).toMatch(/In transit/);
    expect(fundsText(view("FAILED", 3, { failure: { funds: "REFUND_ADDRESS" } }))).toMatch(/verified/);
    expect(fundsText(view("FAILED", 3, { failure: { funds: "UNKNOWN" } }))).toMatch(/Not confirmed/);
    expect(fundsText(view("FAILED", 3))).toBeNull();
  });

  it("notifications: one per real change, none for no change or uninteresting moves", () => {
    expect(notificationFor("AWAITING_DEPOSIT", "PROCESSING")).toMatch(/executing/);
    expect(notificationFor("VERIFYING_DESTINATION", "COMPLETED")).toMatch(/Delivery verified/);
    expect(notificationFor("PROCESSING", "FAILED")).toMatch(/failed/);
    expect(notificationFor("REFUNDING", "REFUNDED")).toMatch(/Refund verified/);
    expect(notificationFor("PROCESSING", "UNKNOWN")).toMatch(/needs attention/);
    expect(notificationFor("PROCESSING", "PROCESSING")).toBeNull();
    expect(notificationFor("QUOTED", "AWAITING_DEPOSIT")).toBeNull();
  });
});
