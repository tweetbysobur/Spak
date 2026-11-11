/**
 * Failure Classification Engine. Pure: reads execution, deposit, destination and refund facts and says what went
 * wrong, whether it is temporary, where the funds are, and what the user can do. It never changes state.
 * Temporary service problems (timeouts, outages, rate limits) are never reported as transaction failures.
 */
export type FailureCategory = "NONE" | "PRE_DEPOSIT" | "DEPOSIT" | "EXECUTION" | "DESTINATION" | "REFUND";
export type FundsLocation = "WALLET" | "IN_TRANSIT" | "DESTINATION" | "REFUND_ADDRESS" | "UNKNOWN";
export type RecoveryAction =
  | "NONE" | "WAIT" | "CHECK_AGAIN" | "START_NEW_TRANSFER" | "SUBMIT_REFUND_TX" | "VERIFY_REFUND" | "CONTACT_SUPPORT" | "MANUAL_REVIEW";

export interface Classification {
  category: FailureCategory;
  code: string;
  temporary: boolean;
  title: string;
  message: string;
  funds: FundsLocation;
  actions: RecoveryAction[];
}

export interface FailureFacts {
  state: string;
  providerStatus: string | null;
  lastStatusError: string | null;
  error: { code?: string; reason?: string } | null;
  refundReason: string | null;
  quoteStatus: string | null;
  deposits: { state: string; reason: string | null; txHash: string | null }[];
  destinations: { outcome: string; problems: unknown }[];
  refund: { state: string; verifiedAmount: string | null; associatedAmount?: string | null; depositedAmount: string | null; providerRefundedAmount: string | null } | null;
  reviewOpen: boolean;
  /** An API error the user just hit before any deposit (e.g. INSUFFICIENT_BALANCE). */
  lastErrorCode?: string | null;
}

const c = (category: FailureCategory, code: string, temporary: boolean, title: string, message: string, funds: FundsLocation, actions: RecoveryAction[]): Classification =>
  ({ category, code, temporary, title, message, funds, actions });
const TEMP = /TIMEOUT|RATE_LIMITED|UNAVAILABLE|could not reach|timed out|fetch failed|429|503|502/i;

export function classify(f: FailureFacts): Classification {
  const confirmed = f.deposits.some((d) => d.state === "CONFIRMED");
  const reviewNote = f.reviewOpen ? " SPak's team is reviewing it." : "";

  // E. Refunds (checked first: once a refund exists it is the main story).
  if (f.refund) {
    const r = f.refund;
    const got = r.associatedAmount ?? r.verifiedAmount;
    const partial = got && r.depositedAmount && BigInt(got) < BigInt(r.depositedAmount);
    switch (r.state) {
      case "COMPLETED": return c("REFUND", partial ? "REFUND_COMPLETED_PARTIAL" : "REFUND_COMPLETED", false, "Refund completed",
        partial ? "SPak verified the refund on chain. It is less than the deposit, which can happen when fees or a partial swap apply." : "SPak verified on chain that the funds are back at your refund address.", "REFUND_ADDRESS", ["NONE"]);
      case "PENDING_PROVIDER": return c("REFUND", "REFUND_EXPECTED", true, "Waiting for refund", "The swap did not complete. NEAR Intents returns funds automatically to your refund address. No action is needed yet." + reviewNote, "IN_TRANSIT", ["WAIT", "CHECK_AGAIN"]);
      case "INITIATED": return c("REFUND", "REFUND_INITIATED", true, "Refund started", "NEAR Intents reports a refund. SPak has not found the refund transaction on chain yet. If you see it in your wallet, you can submit it." + reviewNote, "IN_TRANSIT", ["WAIT", "CHECK_AGAIN", "SUBMIT_REFUND_TX"]);
      case "ASSOCIATION_PENDING": return c("REFUND", "REFUND_ASSOCIATION_PENDING", true, "Refund transfer found, not yet linked", "A transfer reached your refund address, but SPak cannot yet prove it is this refund: NEAR Intents does not identify refund transactions. It is not counted until that is established. A manual check is open.", "UNKNOWN", ["MANUAL_REVIEW", "CONTACT_SUPPORT"]);
      case "PARTIAL": return c("REFUND", "REFUND_PARTIAL", true, "Part of the refund verified", "Part of the refund NEAR Intents reported has been verified. The rest is not verified yet." + reviewNote, "IN_TRANSIT", ["WAIT", "CHECK_AGAIN", "CONTACT_SUPPORT"]);
      case "TX_DETECTED": case "VERIFICATION_PENDING": return c("REFUND", "REFUND_VERIFICATION_PENDING", true, "Refund being verified", "A refund transaction was found. SPak is waiting for it to be final on chain before confirming it.", "IN_TRANSIT", ["WAIT", "CHECK_AGAIN"]);
      case "DELAYED": return c("REFUND", "REFUND_DELAYED", true, "Refund delayed", "The refund is taking longer than usual. Your deposit is recorded and SPak keeps checking." + reviewNote, "IN_TRANSIT", ["WAIT", "SUBMIT_REFUND_TX", "CONTACT_SUPPORT"]);
      case "FAILED": return c("REFUND", "REFUND_FAILED", false, "Refund could not be verified", "The refund transaction did not return the funds as expected. This needs a manual check." + reviewNote, "UNKNOWN", ["MANUAL_REVIEW", "CONTACT_SUPPORT"]);
      default: return c("REFUND", "REFUND_STATUS_UNKNOWN", true, "Refund status unknown", "SPak cannot confirm the refund yet. Your deposit is recorded and is not lost track of." + reviewNote, "UNKNOWN", ["CHECK_AGAIN", "CONTACT_SUPPORT"]);
    }
  }

  // D. Destination.
  if (f.state === "VERIFYING_DESTINATION" || (f.state === "UNKNOWN" && f.destinations.length)) {
    const why = `${f.error?.reason ?? ""} ${JSON.stringify(f.destinations.map((d) => d.problems))}`;
    if (/below the approved minimum/i.test(why)) return c("DESTINATION", "BELOW_MINIMUM", false, "Received less than approved", "The recipient received less than the minimum you approved. This needs a manual check." + reviewNote, "DESTINATION", ["MANUAL_REVIEW", "CONTACT_SUPPORT"]);
    if (/already linked to another execution/i.test(why)) return c("DESTINATION", "DESTINATION_REFERENCE_CONFLICT", false, "Delivery reference conflict", "The reported delivery transaction belongs to another transfer. This needs a manual check." + reviewNote, "UNKNOWN", ["MANUAL_REVIEW"]);
    if (f.destinations.some((d) => d.outcome === "FAILED")) return c("DESTINATION", "DESTINATION_TX_FAILED", false, "Delivery transaction failed", "The delivery transaction failed on the destination chain." + reviewNote, "UNKNOWN", ["MANUAL_REVIEW", "CONTACT_SUPPORT"]);
    if (/different token|different mint/i.test(why)) return c("DESTINATION", "WRONG_ASSET", false, "Wrong asset delivered", "The recipient received a different asset than approved." + reviewNote, "UNKNOWN", ["MANUAL_REVIEW", "CONTACT_SUPPORT"]);
    if (f.destinations.some((d) => d.outcome === "NO_TRANSFER")) return c("DESTINATION", "WRONG_RECIPIENT", false, "Delivery not found for your recipient", "The delivery transaction does not pay the approved recipient." + reviewNote, "UNKNOWN", ["MANUAL_REVIEW", "CONTACT_SUPPORT"]);
    if (f.destinations.some((d) => d.outcome === "UNVERIFIABLE")) return c("DESTINATION", "DESTINATION_UNVERIFIABLE", true, "Delivery cannot be checked automatically", "SPak cannot read this kind of delivery on chain. It stays open until checked by hand." + reviewNote, "DESTINATION", ["MANUAL_REVIEW"]);
    if (TEMP.test(f.lastStatusError ?? "")) return c("DESTINATION", "DESTINATION_VERIFICATION_UNAVAILABLE", true, "Checking delivery", "The destination network could not be reached. SPak retries automatically.", "IN_TRANSIT", ["WAIT"]);
    if (f.state === "VERIFYING_DESTINATION") return c("DESTINATION", "DESTINATION_DELAYED", true, "Confirming delivery", "A delivery transaction exists. SPak is waiting for it to be final on the destination chain.", "IN_TRANSIT", ["WAIT"]);
  }

  // C. Execution.
  if (f.state === "FAILED") {
    const rr = f.refundReason ?? "";
    const code = /liquid/i.test(rr) ? "INSUFFICIENT_LIQUIDITY" : /route/i.test(rr) ? "ROUTE_UNAVAILABLE" : /slippage|min.*out|output/i.test(rr) ? "SLIPPAGE" : "PROVIDER_REJECTED";
    return c("EXECUTION", code, false, "Swap failed", `NEAR Intents could not complete the swap${rr ? ` (${rr})` : ""}.${confirmed ? " Your deposit is recorded. NEAR Intents refunds failed swaps to your refund address." : ""}` + reviewNote,
      confirmed ? "IN_TRANSIT" : "UNKNOWN", confirmed ? ["WAIT", "CHECK_AGAIN", "CONTACT_SUPPORT"] : ["CONTACT_SUPPORT"]);
  }
  if (f.state === "UNKNOWN") {
    if (f.error?.code === "NEEDS_RECONCILIATION") return c("EXECUTION", "MANUAL_REVIEW_REQUIRED", false, "Needs manual review", (f.error.reason ?? "SPak could not confirm the outcome.") + reviewNote, "UNKNOWN", ["MANUAL_REVIEW", "CONTACT_SUPPORT"]);
    if (TEMP.test(f.lastStatusError ?? "")) return c("EXECUTION", /TIMEOUT|timed out/i.test(f.lastStatusError ?? "") ? "PROVIDER_TIMEOUT" : "PROVIDER_INTERRUPTION", true, "Status delayed", "NEAR Intents is not answering right now. This is not a failure. SPak keeps checking.", confirmed ? "IN_TRANSIT" : "UNKNOWN", ["WAIT", "CHECK_AGAIN"]);
    return c("EXECUTION", "UNKNOWN_OUTCOME", true, "Outcome not known yet", "SPak has not received a clear status. Nothing is assumed; checking continues.", "UNKNOWN", ["WAIT", "CHECK_AGAIN"]);
  }
  if ((f.state === "PROCESSING" || f.state === "AWAITING_DEPOSIT") && TEMP.test(f.lastStatusError ?? "")) {
    return c("EXECUTION", /TIMEOUT|timed out/i.test(f.lastStatusError ?? "") ? "PROVIDER_TIMEOUT" : "PROVIDER_INTERRUPTION", true, "Status delayed", "NEAR Intents is not answering right now. This is not a failure. SPak keeps checking.", confirmed ? "IN_TRANSIT" : "WALLET", ["WAIT"]);
  }

  // B. Deposit.
  const last = f.deposits[0];
  if (last && !confirmed) {
    const why = last.reason ?? "";
    if (last.state === "FAILED") return c("DEPOSIT", "DEPOSIT_TX_FAILED", false, "Deposit transaction failed", "Your deposit transaction failed on chain, so no funds were sent. Only network fees were spent.", "WALLET", ["START_NEW_TRANSFER"]);
    if (last.state === "EXPIRED") return c("DEPOSIT", "DEPOSIT_EXPIRED", false, "Deposit expired", "No confirmed deposit arrived before the deadline.", "WALLET", ["START_NEW_TRANSFER", "CONTACT_SUPPORT"]);
    if (last.state === "REJECTED" && /^Wallet:/i.test(why)) return c("PRE_DEPOSIT", "WALLET_REJECTED", false, "Cancelled in your wallet", "You declined the deposit in your wallet. Nothing was sent.", "WALLET", ["START_NEW_TRANSFER"]);
    if (last.state === "REJECTED") {
      const code = /already linked/i.test(why) ? "DUPLICATE_DEPOSIT" : /deposit address|sent to|deposit account/i.test(why) ? "WRONG_DEPOSIT_ADDRESS"
        : /amount|lamports|differs|required \d/i.test(why) ? "WRONG_DEPOSIT_AMOUNT" : /token|asset|mint|contract/i.test(why) ? "WRONG_DEPOSIT_ASSET" : "DEPOSIT_MISMATCH";
      return c("DEPOSIT", code, false, "Deposit does not match", "The transaction you submitted does not match the deposit instructions, so SPak did not accept it. If funds went to the deposit address, contact support.", "UNKNOWN", ["CONTACT_SUPPORT", "MANUAL_REVIEW"]);
    }
    if (last.state === "VERIFICATION_PENDING" && TEMP.test(why)) return c("DEPOSIT", "DEPOSIT_VERIFICATION_UNAVAILABLE", true, "Checking your deposit", "The source network could not be reached. SPak retries automatically.", "IN_TRANSIT", ["WAIT"]);
  }
  if (f.providerStatus === "INCOMPLETE_DEPOSIT" || /PARTIAL_DEPOSIT/i.test(f.refundReason ?? "")) {
    return c("DEPOSIT", "INCOMPLETE_DEPOSIT", false, "Deposit below the required amount", "NEAR Intents received less than required. It refunds incomplete deposits to your refund address after the deadline.", "IN_TRANSIT", ["WAIT", "CONTACT_SUPPORT"]);
  }

  // A. Before any deposit.
  if (f.state === "CANCELLED") return c("PRE_DEPOSIT", "USER_CANCELLED", false, "Cancelled", "You cancelled this transfer before sending a deposit.", "WALLET", ["START_NEW_TRANSFER"]);
  if (f.state === "EXPIRED") return c("PRE_DEPOSIT", "QUOTE_EXPIRED", false, "Expired", "The quote expired before a deposit arrived. Nothing was sent.", "WALLET", ["START_NEW_TRANSFER"]);
  const ec = f.lastErrorCode ?? f.error?.code ?? "";
  if (ec === "INSUFFICIENT_BALANCE") return c("PRE_DEPOSIT", "INSUFFICIENT_BALANCE", false, "Not enough funds", "Your wallet does not hold enough for this deposit and its network fee.", "WALLET", ["START_NEW_TRANSFER"]);
  if (ec === "UNSUPPORTED_ASSET" || ec === "ASSET_MISMATCH") return c("PRE_DEPOSIT", "UNSUPPORTED_ASSET", false, "Asset not supported", "This asset is not available for this route.", "WALLET", ["START_NEW_TRANSFER"]);
  if (ec === "UNSUPPORTED_NETWORK" || ec === "ROUTE_UNSUPPORTED") return c("PRE_DEPOSIT", "UNSUPPORTED_NETWORK", false, "Network not supported", "This network or route is not available.", "WALLET", ["START_NEW_TRANSFER"]);
  if (ec === "INVALID_DEPOSIT_ADDRESS" || ec === "QUOTE_INVALID") return c("PRE_DEPOSIT", "INVALID_DEPOSIT_INSTRUCTIONS", false, "Invalid deposit instructions", "The provider returned deposit instructions SPak could not trust, so nothing was offered for signing.", "WALLET", ["START_NEW_TRANSFER"]);
  if (f.quoteStatus === "REJECTED") return c("PRE_DEPOSIT", "QUOTE_REJECTED", false, "Quote rejected", "SPak rejected the provider's quote because it did not match your plan.", "WALLET", ["START_NEW_TRANSFER"]);
  if (f.quoteStatus === "EXPIRED" && ["AWAITING_APPROVAL", "QUOTED"].includes(f.state)) return c("PRE_DEPOSIT", "QUOTE_EXPIRED", false, "Quote expired", "The quote expired. Get a new quote to continue.", "WALLET", ["CHECK_AGAIN"]);

  return c("NONE", "NONE", false, "", "", f.state === "COMPLETED" ? "DESTINATION" : confirmed ? "IN_TRANSIT" : "WALLET", ["NONE"]);
}
