import { deriveTxType, TX_INTENT_TYPES } from "../classifier/transaction-type";
import type { Draft } from "../context/draft";
import { err, type SpakError } from "../errors/codes";
import { addDecimal, compareDecimal, fractionDigits, isZero } from "../lib/decimal";
import { findAssets, getAsset, isKnownSymbol, networksForSymbol, type AssetDefinition } from "../registries/assets";
import { getNetwork } from "../registries/networks";
import type { AssetRef, Clarification, Recipient, Target } from "../schemas/intent";
import type { InterpretRequest, PendingTransaction } from "../schemas/request";
import { addressFamilies, isAddressFor } from "./address";

export interface Validation {
  intentType: string;
  innerType: string | null;
  sourceAsset: AssetDefinition | null;
  destAsset: AssetDefinition | null;
  sourceRef: AssetRef | null;
  destRef: AssetRef | null;
  recipient: Recipient | null;
  refundAddress: string | null;
  target: Target | null;
  missing: string[];
  errors: SpakError[];
  clarifications: Clarification[];
  assumptions: string[];
}

const PENDING_STATES = new Set(["DRAFT", "AWAITING_APPROVAL", "AWAITING_DEPOSIT", "SCHEDULED", "ACTIVE", "PENDING", "PREPARED"]);
const SCHEDULE_STATES = new Set(["SCHEDULED", "ACTIVE"]);
const IMPLICIT_SELF_VERBS = new Set(["SWAP", "BRIDGE", "TRANSFER"]);
const netName = (id: string | null) => (id ? getNetwork(id)?.name ?? id : "");

export function toAssetRef(a: AssetDefinition): AssetRef {
  return { symbol: a.symbol, id: a.id, chainId: getNetwork(a.network)?.chainId ?? null, decimals: a.decimals, contract: a.contract };
}
const symbolRef = (symbol: string): AssetRef => ({ symbol, id: null, chainId: null, decimals: null, contract: null });

/** Validation Engine: turn a draft into resolved, checked parameters, or say exactly what is missing or wrong. */
export type CustomValidator = (draft: Draft, req: InterpretRequest) => { errors: SpakError[]; missing: Clarification[] };

export function validate(draft: Draft, req: InterpretRequest, custom?: CustomValidator): Validation {
  const v: Validation = {
    intentType: draft.intentType, innerType: draft.innerType, sourceAsset: null, destAsset: null,
    sourceRef: draft.sourceSymbol ? symbolRef(draft.sourceSymbol) : null,
    destRef: draft.destSymbol ? symbolRef(draft.destSymbol) : null,
    recipient: null, refundAddress: null, target: draft.target,
    missing: [], errors: [...draft.parseIssues], clarifications: [], assumptions: [...draft.assumptions],
  };
  const ask = (field: string, question: string, options?: string[]) => {
    if (!v.missing.includes(field)) v.missing.push(field);
    if (!v.clarifications.some((c) => c.field === field)) v.clarifications.push({ field, question, ...(options?.length ? { options } : {}) });
  };

  switch (draft.intentType) {
    case "UNKNOWN":
      if (!v.errors.length) v.errors.push(err("UNKNOWN_INTENT", "SPak could not tell what you want to do."));
      ask("intentType", "What would you like to do? For example: swap, bridge, send, check your portfolio, or check a transaction.");
      break;
    case "PORTFOLIO_QUERY":
      validateQuery(draft, req, v, ask);
      break;
    case "PORTFOLIO_REBALANCE":
      validateRebalance(draft, req, v, ask);
      break;
    case "TRANSACTION_HISTORY":
      break;
    case "TRANSACTION_STATUS":
    case "CANCEL_TRANSACTION":
      validateTarget(draft, req.transactions, v, ask);
      break;
    case "SCHEDULED_TRANSACTION":
    case "CONDITIONAL_TRANSACTION":
      validateWrapper(draft, req, v, ask);
      break;
    default:
      if (TX_INTENT_TYPES.has(draft.intentType) || draft.verb) validateTx(draft, req, v, ask, false);
      else if (custom) {
        const c = custom(draft, req);
        v.errors.push(...c.errors);
        for (const m of c.missing) ask(m.field, m.question, m.options);
      } else {
        v.errors.push(err("INTENT_NOT_IMPLEMENTED", `${draft.intentType} is registered but has no validator, so SPak will not act on it.`, "intentType"));
      }
  }
  return v;
}

type Ask = (field: string, question: string, options?: string[]) => void;

function validateTx(draft: Draft, req: InterpretRequest, v: Validation, ask: Ask, wrapped: boolean): void {
  const d = { ...draft };
  const verbWord = d.verb === "SWAP" ? "swap" : d.verb === "BRIDGE" ? "move" : d.verb === "PAY" ? "pay" : d.verb === "TRANSFER" ? "transfer" : "send";
  let type = deriveTxType(d) ?? "PAYMENT";

  // Same-asset intents deliver the asset they send.
  if (!d.destSymbol && d.sourceSymbol && type !== "SWAP" && type !== "CROSS_CHAIN_SWAP") d.destSymbol = d.sourceSymbol;

  // One network named for a swap ("swap ETH to USDC on Base") applies to both sides when both assets live there.
  if (d.verb === "SWAP" && d.sourceSymbol && d.destSymbol && (!!d.sourceNetwork !== !!d.destNetwork)) {
    const n = (d.sourceNetwork ?? d.destNetwork)!;
    if (findAssets(d.sourceSymbol, n).length && findAssets(d.destSymbol, n).length) {
      d.sourceNetwork = n; d.destNetwork = n;
      v.assumptions.push(`Both ${d.sourceSymbol} and ${d.destSymbol} are on ${netName(n)}, so this is a swap on ${netName(n)}.`);
    }
  }
  // A payment with only a source network stays on that network.
  if (type === "PAYMENT" && d.sourceNetwork && !d.destNetwork && d.recipient?.kind === "EXTERNAL") {
    const fam = getNetwork(d.sourceNetwork)?.family;
    if (fam && d.recipient.address && isAddressFor(fam, d.recipient.address)) {
      d.destNetwork = d.sourceNetwork;
      v.assumptions.push(`Paying on ${netName(d.sourceNetwork)}, the network the funds are on.`);
    }
  }
  type = deriveTxType(d) ?? type;
  if (!wrapped) v.intentType = type; else v.innerType = type;

  // Required parameters.
  if (!d.amount) ask("source.amount", `How much ${d.sourceSymbol ?? ""} do you want to ${verbWord}?`.replace("  ", " "));
  if (!d.sourceSymbol) ask("source.asset", `Which asset do you want to ${verbWord}?`);
  if (!d.sourceNetwork) ask("source.network", `Which network is your ${d.sourceSymbol ?? "asset"} on?`, d.sourceSymbol ? networksForSymbol(d.sourceSymbol).slice(0, 8) : undefined);
  if (!d.destSymbol && (type === "SWAP" || type === "CROSS_CHAIN_SWAP")) ask("destination.asset", "Which asset should arrive?");
  if (!d.destNetwork) {
    let options = d.destSymbol ? networksForSymbol(d.destSymbol) : [];
    if (d.recipient?.kind === "EXTERNAL" && d.recipient.address) {
      const fams = addressFamilies(d.recipient.address);
      const fit = options.filter((n) => fams.includes(getNetwork(n)!.family));
      if (fit.length) options = fit;
    }
    ask("destination.network", `Which network should receive ${d.destSymbol ?? "it"}?`, options.slice(0, 8));
  }

  // Assets: verified registry entries only. Never pick one of several silently.
  const resolveSide = (symbol: string | null, network: string | null, side: "source" | "destination"): AssetDefinition | null => {
    const pinned = side === "source" ? d.sourceAssetId : d.destAssetId;
    if (pinned) {
      const a = getAsset(pinned);
      if (!a) { v.errors.push(err("UNSUPPORTED_ASSET", `Unknown asset id ${pinned}.`, `${side}.asset`)); return null; }
      if (network && a.network !== network) { v.errors.push(err("ASSET_NOT_ON_NETWORK", `${pinned} is not on ${netName(network)}.`, `${side}.asset`)); return null; }
      return a;
    }
    if (!symbol) return null;
    if (!isKnownSymbol(symbol)) {
      v.errors.push(err("UNSUPPORTED_ASSET", `SPak does not support ${symbol}.`, `${side}.asset`, { symbol }));
      return null;
    }
    if (!network || !getNetwork(network)) return null;
    const found = findAssets(symbol, network);
    if (found.length === 0) {
      v.errors.push(err("ASSET_NOT_ON_NETWORK", `${symbol} is not available on ${netName(network)}. Available on: ${networksForSymbol(symbol).map(netName).join(", ")}.`, `${side}.asset`, { symbol, network, availableOn: networksForSymbol(symbol) }));
      return null;
    }
    if (found.length > 1) {
      v.errors.push(err("AMBIGUOUS_ASSET", `${found.length} assets called ${symbol} exist on ${netName(network)}.`, `${side}.asset`));
      ask(`${side}.asset`, `Which ${symbol} on ${netName(network)}?`, found.map((a) => a.id));
      return null;
    }
    if (found[0].symbol.toUpperCase() !== symbol.toUpperCase()) v.assumptions.push(`NEAR Intents settles ${symbol} on ${netName(network)} as ${found[0].symbol} (${found[0].contract ?? "native"}).`);
    return found[0];
  };
  v.sourceAsset = resolveSide(d.sourceSymbol, d.sourceNetwork, "source");
  v.destAsset = resolveSide(d.destSymbol, d.destNetwork, "destination");
  if (v.sourceAsset) v.sourceRef = toAssetRef(v.sourceAsset);
  else if (d.sourceSymbol) v.sourceRef = symbolRef(d.sourceSymbol);
  if (v.destAsset) v.destRef = toAssetRef(v.destAsset);
  else if (d.destSymbol) v.destRef = symbolRef(d.destSymbol);
  draft.sourceNetwork = d.sourceNetwork; draft.destNetwork = d.destNetwork; draft.destSymbol = d.destSymbol;

  // Amount.
  if (d.amount) {
    if (d.amount.kind === "EXACT") {
      if (isZero(d.amount.value)) v.errors.push(err("INVALID_AMOUNT", "Amount must be greater than zero.", "source.amount"));
      else if (v.sourceAsset && fractionDigits(d.amount.value) > v.sourceAsset.decimals) {
        v.errors.push(err("AMOUNT_PRECISION", `${v.sourceAsset.symbol} supports ${v.sourceAsset.decimals} decimal places.`, "source.amount"));
      } else if (d.amount.value.replace(".", "").length > 36) v.errors.push(err("INVALID_AMOUNT", "Amount is too large.", "source.amount"));
    } else if (d.amount.kind === "PERCENT_OF_BALANCE") {
      if (isZero(d.amount.percent) || compareDecimal(d.amount.percent, "100") > 0) {
        v.errors.push(err("INVALID_PERCENTAGE", "Percentage must be above 0 and at most 100.", "source.amount"));
      }
    } else if (isZero(d.amount.value)) v.errors.push(err("INVALID_AMOUNT", "Amount must be greater than zero.", "source.amount"));
  }

  // Same asset, same place: nothing to do.
  if (v.sourceAsset && v.destAsset && v.sourceAsset.id === v.destAsset.id && type !== "PAYMENT") {
    v.errors.push(err("SAME_ASSET_SAME_NETWORK", `Source and destination are both ${v.sourceAsset.symbol} on ${netName(v.sourceAsset.network)}.`, "destination"));
  }

  // Recipient. Never invent an address.
  const destFamily = d.destNetwork ? getNetwork(d.destNetwork)?.family : undefined;
  const r = d.recipient;
  if (r?.kind === "EXTERNAL" && r.address) {
    if (destFamily && !isAddressFor(destFamily, r.address)) {
      const fams = addressFamilies(r.address);
      v.errors.push(err("ADDRESS_NETWORK_MISMATCH", `${r.address} is not a valid ${netName(d.destNetwork)} address${fams.length ? ` (it looks like a ${fams.join("/")} address)` : ""}.`, "recipient"));
    } else v.recipient = { address: r.address, network: d.destNetwork, kind: "EXTERNAL" };
  } else if (r?.kind === "PLACEHOLDER") {
    if (!v.errors.some((e) => e.field === "recipient")) ask("recipient", `You mentioned an address but did not include it. Paste the ${netName(d.destNetwork) || "recipient"} address.`);
    else v.missing.push("recipient");
  } else {
    const selfAllowed = r?.kind === "SELF" || (d.verb && IMPLICIT_SELF_VERBS.has(d.verb) && type !== "PAYMENT");
    if (selfAllowed && d.destNetwork) {
      const own = req.wallets[d.destNetwork];
      if (own) {
        v.recipient = { address: own, network: d.destNetwork, kind: "SELF" };
        if (!r) v.assumptions.push(`Delivering to your connected ${netName(d.destNetwork)} wallet.`);
      } else ask("recipient", `Connect a ${netName(d.destNetwork)} wallet or give the address that should receive the funds.`);
    } else if (!selfAllowed || !d.destNetwork) {
      if (type === "PAYMENT" || d.verb === "SEND" || d.destNetwork) ask("recipient", `Which address should receive the funds${d.destNetwork ? ` on ${netName(d.destNetwork)}` : ""}?`);
    }
  }

  // Refund address on the source network. NEAR Intents returns funds there if execution fails.
  if (d.sourceNetwork && getNetwork(d.sourceNetwork)) {
    const refund = d.refundAddress ?? req.wallets[d.sourceNetwork] ?? null;
    const fam = getNetwork(d.sourceNetwork)!.family;
    if (!refund) ask("refundAddress", `Connect a ${netName(d.sourceNetwork)} wallet so SPak has a refund address if the transaction fails.`);
    else if (!isAddressFor(fam, refund)) v.errors.push(err("ADDRESS_NETWORK_MISMATCH", `Refund address ${refund} is not a valid ${netName(d.sourceNetwork)} address.`, "refundAddress"));
    else v.refundAddress = refund;
  }

  if (d.constraints.minOutput && d.destSymbol && d.constraints.minOutput.symbol !== d.destSymbol.toUpperCase()) {
    v.errors.push(err("INVALID_CONSTRAINT", `Minimum output is in ${d.constraints.minOutput.symbol} but you receive ${d.destSymbol}.`, "constraints.minOutput"));
  }
}

function validateWrapper(draft: Draft, req: InterpretRequest, v: Validation, ask: Ask): void {
  if (draft.schedule && draft.condition) {
    v.errors.push(err("MULTI_STEP_NOT_SUPPORTED", "SPak cannot combine a schedule and a price or fee trigger yet. Use one.", "schedule"));
  }
  const notifyOnly = draft.condition?.onTrigger === "NOTIFY" && !draft.verb;
  if (!notifyOnly) {
    if (!draft.verb) ask("innerIntent", "What transaction should SPak run?");
    else validateTx(draft, req, v, ask, true);
  }
  if (draft.intentType === "SCHEDULED_TRANSACTION" && draft.schedule) {
    const s = draft.schedule;
    if (!s.timezone && req.timezone) s.timezone = req.timezone;
    const recurringNeedsZone = s.type === "RECURRING" && s.frequency !== "HOURLY";
    if (s.type === "RECURRING" && !s.frequency) ask("schedule.frequency", "How often should it run?");
    if (recurringNeedsZone && !s.time) ask("schedule.time", `At what time${s.daysOfWeek.length ? " on that day" : ""}?`);
    if (s.type === "ONCE" && !s.startAt && !s.time) ask("schedule.time", "At what time?");
    if ((recurringNeedsZone || (s.type === "ONCE" && !s.startAt)) && !s.timezone) ask("schedule.timezone", "Which time zone? For example: Africa/Lagos or America/New_York.");
  }
  if (draft.intentType === "SCHEDULED_TRANSACTION" && !draft.schedule) ask("schedule", "When should it run?");
  if (draft.intentType === "CONDITIONAL_TRANSACTION" && draft.condition?.kind === "PRICE" && !isKnownSymbol(draft.condition.symbol)) {
    v.errors.push(err("UNSUPPORTED_ASSET", `SPak has no price feed for ${draft.condition.symbol}.`, "condition"));
  }
  if (draft.intentType === "CONDITIONAL_TRANSACTION" && !draft.condition && !v.errors.some((e) => e.code === "INVALID_CONDITION")) ask("condition", "What should trigger it?");
}

function validateQuery(draft: Draft, req: InterpretRequest, v: Validation, ask: Ask): void {
  if (!Object.keys(req.wallets).length) ask("wallets", "Connect a wallet so SPak can read your balances.");
  for (const s of draft.query?.assets ?? []) if (!isKnownSymbol(s)) v.errors.push(err("UNSUPPORTED_ASSET", `SPak does not track ${s}.`, "query.assets"));
}

function validateRebalance(draft: Draft, req: InterpretRequest, v: Validation, ask: Ask): void {
  if (!Object.keys(req.wallets).length) ask("wallets", "Connect a wallet so SPak can read your balances.");
  const a = draft.allocations;
  if (!a?.length) { ask("allocations", "What target split do you want? For example: 60% ETH, 40% USDC."); return; }
  const seen = new Set<string>();
  let total = "0";
  for (const x of a) {
    if (!isKnownSymbol(x.symbol)) v.errors.push(err("UNSUPPORTED_ASSET", `SPak does not support ${x.symbol}.`, "allocations"));
    if (seen.has(x.symbol)) v.errors.push(err("INVALID_ALLOCATION", `${x.symbol} appears twice.`, "allocations"));
    seen.add(x.symbol);
    total = addDecimal(total, x.percent);
  }
  if (compareDecimal(total, "100") !== 0) v.errors.push(err("INVALID_ALLOCATION", `Target percentages add up to ${total}%, not 100%.`, "allocations"));
}

function validateTarget(draft: Draft, txs: PendingTransaction[], v: Validation, ask: Ask): void {
  const t = draft.target ?? { ref: draft.intentType === "CANCEL_TRANSACTION" ? "LATEST_PENDING" : "LATEST", id: null, resolvedId: null };
  v.target = { ...t };
  const cancel = draft.intentType === "CANCEL_TRANSACTION";
  const pending = txs.filter((x) => PENDING_STATES.has(x.state.toUpperCase()));
  const label = (x: PendingTransaction) => `${x.id}${x.summary ? ` (${x.summary})` : ""}`;

  if (t.ref === "ID") {
    const found = txs.find((x) => x.id === t.id);
    if (!found) { v.errors.push(err("TRANSACTION_NOT_FOUND", `No transaction ${t.id} in your account.`, "target")); return; }
    if (cancel && !PENDING_STATES.has(found.state.toUpperCase())) {
      v.errors.push(err("NO_PENDING_TRANSACTION", `${found.id} is ${found.state.toLowerCase()} and can no longer be cancelled.`, "target")); return;
    }
    v.target.resolvedId = found.id; return;
  }
  if (!cancel) {
    if (!txs.length) { v.errors.push(err("TRANSACTION_NOT_FOUND", "You have no transactions yet.", "target")); return; }
    const pool = t.ref === "LATEST_PENDING" ? pending : txs;
    if (!pool.length) { v.errors.push(err("NO_PENDING_TRANSACTION", "You have no pending transactions.", "target")); return; }
    v.target.resolvedId = [...pool].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id;
    return;
  }
  const pool = t.ref === "SCHEDULED" ? pending.filter((x) => SCHEDULE_STATES.has(x.state.toUpperCase())) : pending;
  if (!pool.length) {
    const processing = txs.some((x) => x.state.toUpperCase() === "PROCESSING");
    v.errors.push(err("NO_PENDING_TRANSACTION", processing
      ? "Your transaction is already processing on-chain and cannot be cancelled."
      : `You have no ${t.ref === "SCHEDULED" ? "scheduled" : "pending"} transactions to cancel.`, "target"));
    return;
  }
  if (t.ref === "ALL_PENDING") return;
  if (pool.length > 1) {
    v.errors.push(err("AMBIGUOUS_TARGET", `You have ${pool.length} ${t.ref === "SCHEDULED" ? "scheduled" : "pending"} transactions.`, "target"));
    ask("target", "Which one should SPak cancel?", pool.map(label));
    return;
  }
  v.target.resolvedId = pool[0].id;
}
