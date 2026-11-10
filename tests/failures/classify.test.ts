/** Failure classification rules (pure, no I/O). */
import { describe, expect, it } from "vitest";
import { classify, type FailureFacts } from "@/failures";

const base: FailureFacts = { state: "AWAITING_DEPOSIT", providerStatus: null, lastStatusError: null, error: null, refundReason: null, quoteStatus: "VALID", deposits: [], destinations: [], refund: null, reviewOpen: false };
const k = (o: Partial<FailureFacts>) => classify({ ...base, ...o });
const conf = [{ state: "CONFIRMED", reason: null, txHash: "0x1" }];

describe("failure classification", () => {
  it("pre-deposit", () => {
    expect(k({ state: "EXPIRED" }).code).toBe("QUOTE_EXPIRED");
    expect(k({ state: "CANCELLED" }).code).toBe("USER_CANCELLED");
    expect(k({ state: "AWAITING_APPROVAL", quoteStatus: "REJECTED" }).code).toBe("QUOTE_REJECTED");
    expect(k({ lastErrorCode: "INSUFFICIENT_BALANCE" })).toMatchObject({ code: "INSUFFICIENT_BALANCE", funds: "WALLET" });
    expect(k({ lastErrorCode: "UNSUPPORTED_ASSET" }).code).toBe("UNSUPPORTED_ASSET");
    expect(k({ deposits: [{ state: "REJECTED", reason: "Wallet: User rejected", txHash: null }] }).code).toBe("WALLET_REJECTED");
  });
  it("deposit", () => {
    expect(k({ deposits: [{ state: "FAILED", reason: "reverted", txHash: "0x1" }] })).toMatchObject({ code: "DEPOSIT_TX_FAILED", funds: "WALLET" });
    expect(k({ deposits: [{ state: "EXPIRED", reason: null, txHash: "0x1" }] }).code).toBe("DEPOSIT_EXPIRED");
    expect(k({ deposits: [{ state: "REJECTED", reason: "token amount 1 differs from required 5", txHash: "0x1" }] }).code).toBe("WRONG_DEPOSIT_AMOUNT");
    expect(k({ deposits: [{ state: "REJECTED", reason: "sent to 0x9, not the deposit address", txHash: "0x1" }] }).code).toBe("WRONG_DEPOSIT_ADDRESS");
    expect(k({ deposits: [{ state: "REJECTED", reason: "called 0x4, not the token contract 0x8", txHash: "0x1" }] }).code).toBe("WRONG_DEPOSIT_ASSET");
    expect(k({ deposits: [{ state: "REJECTED", reason: "That transaction is already linked to a deposit.", txHash: "0x1" }] }).code).toBe("DUPLICATE_DEPOSIT");
    expect(k({ deposits: [{ state: "VERIFICATION_PENDING", reason: "Could not reach base: timeout", txHash: "0x1" }] })).toMatchObject({ code: "DEPOSIT_VERIFICATION_UNAVAILABLE", temporary: true });
    expect(k({ state: "PROCESSING", providerStatus: "INCOMPLETE_DEPOSIT", deposits: conf }).code).toBe("INCOMPLETE_DEPOSIT");
  });
  it("execution: timeouts are temporary, never failures", () => {
    expect(k({ state: "PROCESSING", deposits: conf, lastStatusError: "TIMEOUT: timed out" })).toMatchObject({ code: "PROVIDER_TIMEOUT", temporary: true, category: "EXECUTION" });
    expect(k({ state: "UNKNOWN", deposits: conf, lastStatusError: "UNAVAILABLE: 503" })).toMatchObject({ code: "PROVIDER_INTERRUPTION", temporary: true });
    expect(k({ state: "UNKNOWN" })).toMatchObject({ code: "UNKNOWN_OUTCOME", temporary: true });
    expect(k({ state: "FAILED", deposits: conf })).toMatchObject({ code: "PROVIDER_REJECTED", temporary: false, funds: "IN_TRANSIT" });
    expect(k({ state: "FAILED", deposits: conf, refundReason: "INSUFFICIENT_LIQUIDITY" }).code).toBe("INSUFFICIENT_LIQUIDITY");
    expect(k({ state: "FAILED", deposits: conf, refundReason: "slippage exceeded" }).code).toBe("SLIPPAGE");
  });
  it("destination", () => {
    expect(k({ state: "UNKNOWN", deposits: conf, error: { code: "NEEDS_RECONCILIATION", reason: "Recipient received 5, below the approved minimum 9." }, destinations: [{ outcome: "CONFIRMED", problems: [] }] }).code).toBe("BELOW_MINIMUM");
    expect(k({ state: "UNKNOWN", deposits: conf, destinations: [{ outcome: "FAILED", problems: [] }] }).code).toBe("DESTINATION_TX_FAILED");
    expect(k({ state: "UNKNOWN", deposits: conf, destinations: [{ outcome: "NO_TRANSFER", problems: ["recipient received a different token (0x4)"] }] }).code).toBe("WRONG_ASSET");
    expect(k({ state: "UNKNOWN", deposits: conf, destinations: [{ outcome: "NO_TRANSFER", problems: ["no transfer"] }] }).code).toBe("WRONG_RECIPIENT");
    expect(k({ state: "VERIFYING_DESTINATION", deposits: conf, destinations: [{ outcome: "PENDING", problems: [] }] })).toMatchObject({ code: "DESTINATION_DELAYED", temporary: true });
    expect(k({ state: "VERIFYING_DESTINATION", deposits: conf, lastStatusError: "Could not reach solana" })).toMatchObject({ code: "DESTINATION_VERIFICATION_UNAVAILABLE", temporary: true });
  });
  it("refunds: returned only when verified; partial noted", () => {
    const r = (state: string, extra: object = {}) => k({ state: "REFUNDING", deposits: conf, refund: { state, verifiedAmount: null, depositedAmount: "100", providerRefundedAmount: null, ...extra } });
    expect(r("PENDING_PROVIDER")).toMatchObject({ code: "REFUND_EXPECTED", funds: "IN_TRANSIT" });
    expect(r("INITIATED").actions).toContain("SUBMIT_REFUND_TX");
    expect(r("VERIFICATION_PENDING").code).toBe("REFUND_VERIFICATION_PENDING");
    expect(r("DELAYED").code).toBe("REFUND_DELAYED");
    expect(r("FAILED").actions).toContain("MANUAL_REVIEW");
    expect(r("UNKNOWN").code).toBe("REFUND_STATUS_UNKNOWN");
    expect(r("COMPLETED", { verifiedAmount: "100" })).toMatchObject({ code: "REFUND_COMPLETED", funds: "REFUND_ADDRESS" });
    expect(r("COMPLETED", { verifiedAmount: "60" }).code).toBe("REFUND_COMPLETED_PARTIAL");
    for (const s of ["PENDING_PROVIDER", "INITIATED", "VERIFICATION_PENDING", "DELAYED", "FAILED", "UNKNOWN"]) expect(r(s).funds).not.toBe("REFUND_ADDRESS");
  });
  it("never suggests resending a deposit", () => {
    const all = ["AWAITING_DEPOSIT", "PROCESSING", "FAILED", "UNKNOWN", "REFUNDING", "EXPIRED"].map((state) => k({ state, deposits: conf }));
    for (const c of all) expect(c.actions).not.toContain("RESEND_DEPOSIT" as never);
  });
});
