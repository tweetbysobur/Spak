import { err } from "../errors/codes";
import { normalizeDecimal } from "../lib/decimal";
import type { Entities } from "../extractor";
import type { Allocation, AmountSpec, Target } from "../schemas/intent";
import type { Token } from "../tokenizer/tokenize";
import type { Frame, Keyword, VerbClass } from "./frame";

/** Verb lexicon. Nouns like "transfer" or "swap" count too: "schedule a transfer", "cancel my swap". */
const VERBS: Record<string, VerbClass> = {
  swap: "SWAP", swapping: "SWAP", converting: "SWAP", convert: "SWAP", exchange: "SWAP", trade: "SWAP", buy: "SWAP", sell: "SWAP", flip: "SWAP",
  bridge: "BRIDGE", bridging: "BRIDGE", moving: "BRIDGE", move: "BRIDGE", port: "BRIDGE", shift: "BRIDGE", migrate: "BRIDGE",
  transfer: "TRANSFER", transferring: "TRANSFER", withdraw: "TRANSFER",
  send: "SEND", sending: "SEND", give: "SEND", tip: "SEND", wire: "SEND",
  pay: "PAY", paying: "PAY", payment: "PAY",
  show: "QUERY", view: "QUERY", check: "QUERY", display: "QUERY", list: "QUERY", see: "QUERY", what: "QUERY",
  "what's": "QUERY", whats: "QUERY", how: "QUERY",
  status: "STATUS", track: "STATUS", where: "STATUS",
  history: "HISTORY", activity: "HISTORY",
  cancel: "CANCEL", abort: "CANCEL", stop: "CANCEL", revoke: "CANCEL", undo: "CANCEL", halt: "CANCEL", terminate: "CANCEL",
  rebalance: "REBALANCE", reallocate: "REBALANCE", diversify: "REBALANCE", redistribute: "REBALANCE", reweight: "REBALANCE",
  schedule: "SCHEDULE", automate: "SCHEDULE", recurring: "SCHEDULE",
  notify: "NOTIFY", alert: "NOTIFY", remind: "NOTIFY", warn: "NOTIFY", ping: "NOTIFY",
  instead: "AMEND", actually: "AMEND", rather: "AMEND", change: "AMEND", switch: "AMEND", update: "AMEND", modify: "AMEND", edit: "AMEND",
};
const TX: ReadonlySet<VerbClass> = new Set(["SWAP", "BRIDGE", "SEND", "TRANSFER", "PAY"]);

const KEYWORDS: Record<string, Keyword> = {
  portfolio: "portfolio", have: "portfolio", hold: "portfolio", own: "portfolio", holdings: "portfolio", assets: "portfolio", worth: "portfolio", networth: "portfolio", positions: "portfolio", funds: "portfolio",
  balance: "balance", balances: "balance",
  history: "history", activity: "history", transactions: "history", txs: "history", past: "history", recent: "history", previous: "history",
  status: "status", progress: "status", where: "status", track: "status", stuck: "status", arrived: "status", arrive: "status", confirmed: "status", done: "status",
  pending: "pending", ongoing: "pending", open: "pending", unfinished: "pending", "in-progress": "pending", active: "pending",
  scheduled: "scheduled", recurring: "scheduled", automation: "scheduled", standing: "scheduled",
  instead: "amend", actually: "amend", rather: "amend", make: "amend", change: "amend", update: "amend", switch: "amend", use: "amend",
  destination: "destination_word", receive: "destination_word", receiving: "destination_word", recipient: "destination_word", target: "destination_word",
  source: "source_word", sending: "source_word", origin: "source_word",
};

const NET_PREPS = new Set(["on", "at", "in", "via", "over", "from"]);
const SKIP = new Set(["the", "a", "an", "my", "our", "your", "some", "of", "please", "kindly", "just", "now", "and", "then", "also", "can", "you", "i", "want", "would", "like", "need", "let's", "lets", "it", "is", "this", "that"]);
const SELF_WORDS = new Set(["me", "myself", "mine", "self"]);
const PLACE_WORDS = new Set(["address", "wallet", "account"]);
const ALL_WORDS = new Set(["all", "everything", "entire", "max", "whole"]);
const NETWORK_NOUNS = new Set(["network", "chain", "blockchain", "mainnet", "l2"]);
const TICKERISH = /^[a-z][a-z0-9]{1,9}$/;
const COMMON = new Set(["or", "and", "more", "less", "then", "now", "per", "times", "each", "units", "tokens", "coins", "worth", "only", "max", "min", "total", "bucks", "on", "at", "so", "as", "if", "when", "via", "by"]);
const ID_RE = /^spak_(int|sub|plan)_[a-z0-9]+$/i;

function classify(word: string, next: string | undefined): VerbClass | undefined {
  if (word === "let" && next === "me") return "NOTIFY";
  if (word === "tell" && next === "me") return "NOTIFY";
  if (word === "make" && next === "it") return "AMEND";
  if (word === "use" && next !== undefined) return "AMEND";
  if (word === "get" && (next === "my" || next === "me")) return "QUERY";
  return VERBS[word];
}

const PRIMARY_ORDER: VerbClass[] = ["CANCEL", "REBALANCE", "SCHEDULE", "NOTIFY", "SWAP", "BRIDGE", "TRANSFER", "SEND", "PAY", "STATUS", "HISTORY", "QUERY", "AMEND"];

/**
 * Intent Parser: assigns grammatical roles (source, destination, recipient) to extracted entities.
 * Prepositions drive the roles: "from/on X" = source network before "to", "to X" = destination.
 */
export function parse(tokens: Token[], ent: Entities): Frame {
  const f: Frame = {
    tokens, verbs: [], primary: null, amount: null,
    sourceSymbol: null, sourceNetwork: null, destSymbol: null, destNetwork: null,
    looseNetworks: [], looseSymbols: [], recipient: null, refundAddress: null,
    schedule: ent.schedule, scheduleMissing: ent.scheduleMissing, condition: ent.condition, constraints: ent.constraints,
    target: null, query: null, allocations: null, keywords: new Set(), issues: [...ent.issues], assumptions: [...ent.assumptions],
    unknownSymbols: [],
  };
  const w = tokens.map((t) => t.lower);
  const live = (i: number) => i >= 0 && i < tokens.length && !ent.consumed.has(i);

  // Pass 1: verbs and keywords.
  for (let i = 0; i < tokens.length; i++) {
    if (!live(i) || tokens[i].kind !== "word") continue;
    const cls = classify(w[i], w[i + 1]);
    if (cls) f.verbs.push({ word: w[i], cls, index: i });
    const kw = KEYWORDS[w[i]];
    if (kw) f.keywords.add(kw);
    if (SELF_WORDS.has(w[i])) f.keywords.add("self");
  }
  // A notify verb with a trigger already extracted counts even inside the masked clause.
  const classes = new Set(f.verbs.map((v) => v.cls));
  f.primary = PRIMARY_ORDER.find((c) => classes.has(c)) ?? null;
  const txVerbs = f.verbs.filter((v) => TX.has(v.cls));
  const txCls = txVerbs[0]?.cls ?? null;
  const txFamilies = new Set(txVerbs.map((v) => (v.cls === "SWAP" ? "SWAP" : v.cls === "BRIDGE" ? "BRIDGE" : "SEND")));
  if (txFamilies.size > 1 && !(txFamilies.has("BRIDGE") && txFamilies.has("SEND") && txVerbs.length === 2 && txVerbs.some((v) => v.word === "transfer"))) {
    f.issues.push(err("MULTI_STEP_NOT_SUPPORTED", "This asks for more than one action. Give SPak one action at a time.", "intentType"));
  }
  const isBuy = txVerbs[0]?.word === "buy";
  const rebalancing = f.primary === "REBALANCE";

  // Pass 2: roles.
  let side: "source" | "dest" = isBuy ? "dest" : "source";
  let prep: string | null = null;
  let amountCount = 0;
  const mentionedSymbols: string[] = [];
  const mentionedNetworks: string[] = [];
  const allocations: Allocation[] = [];
  let pendingPercent: { value: string; index: number } | null = null;
  let pendingAllocSymbol: string | null = null;

  const setNetwork = (role: "source" | "dest" | "loose", id: string) => {
    mentionedNetworks.push(id);
    if (role === "loose") { f.looseNetworks.push(id); return; }
    const key = role === "source" ? "sourceNetwork" : "destNetwork";
    const cur = f[key];
    if (cur && cur !== id) f.issues.push(err("AMBIGUOUS_NETWORK_ROLE", `Two ${role === "source" ? "source" : "destination"} networks given (${cur}, ${id}). Which one?`, key));
    else f[key] = id;
  };
  const setSymbol = (role: "source" | "dest" | "loose", sym: string) => {
    mentionedSymbols.push(sym);
    if (role === "loose") { f.looseSymbols.push(sym); return; }
    const key = role === "source" ? "sourceSymbol" : "destSymbol";
    const cur = f[key];
    if (cur && cur !== sym) {
      if (role === "source" && !f.destSymbol && txCls === "SWAP") { f.destSymbol = sym; return; }
      f.issues.push(err("AMBIGUOUS_ASSET", `Two ${role === "source" ? "source" : "destination"} assets given (${cur}, ${sym}). Which one?`, key));
    } else f[key] = sym;
  };
  const setAmount = (a: AmountSpec) => {
    amountCount++;
    if (!f.amount) f.amount = a;
  };

  let i = 0;
  while (i < tokens.length) {
    if (!live(i)) { i++; continue; }
    const t = tokens[i];
    const word = w[i];
    const L = ent.lex.get(i);

    if (t.kind === "punct") { i++; continue; }

    if (t.kind === "address") {
      if (prep === "from") f.refundAddress = t.raw;
      else if (f.recipient?.kind === "EXTERNAL" && f.recipient.address !== t.raw) {
        f.issues.push(err("AMBIGUOUS_TARGET", "Two recipient addresses given. Which one should receive the funds?", "recipient"));
      } else f.recipient = { kind: "EXTERNAL", address: t.raw };
      if (side === "source" && txCls && prep !== "from" && f.amount) side = "dest";
      prep = null; i++; continue;
    }
    if (t.kind === "bad_address") {
      f.issues.push(err("INVALID_ADDRESS", `"${t.raw}" is not a complete address. Paste the full address.`, "recipient"));
      f.recipient = { kind: "PLACEHOLDER", address: null };
      prep = null; i++; continue;
    }
    if (t.kind === "name_service") {
      f.issues.push(err("INVALID_ADDRESS", `SPak does not resolve names like ${t.raw}. Paste the wallet address instead.`, "recipient"));
      f.recipient = { kind: "PLACEHOLDER", address: null };
      prep = null; i++; continue;
    }

    if (t.kind === "number" || t.kind === "money" || t.kind === "percent") {
      const value = normalizeDecimal(t.value!);
      if (prep === "to" && !rebalancing) side = "dest";
      prep = null;
      if (rebalancing && t.kind === "percent") {
        if (pendingAllocSymbol) { allocations.push({ symbol: pendingAllocSymbol, percent: value }); pendingAllocSymbol = null; }
        else pendingPercent = { value, index: i };
        prep = null; i++; continue;
      }
      if (t.kind === "percent") setAmount({ kind: "PERCENT_OF_BALANCE", percent: value });
      else if (t.kind === "money") setAmount({ kind: "FIAT_VALUE", value, currency: "USD" });
      else {
        setAmount({ kind: "EXACT", value });
        if (isBuy && side === "dest") f.issues.push(err("AMBIGUOUS_AMOUNT", "SPak quotes by what you spend. How much do you want to pay, and in which asset?", "amount"));
      }
      // "50 FOO": an unknown ticker right after an amount is still the asset the user means.
      const nxt = i + 1;
      if (live(nxt) && tokens[nxt].kind === "word" && !ent.lex.get(nxt) && TICKERISH.test(w[nxt]) && !SKIP.has(w[nxt]) && !COMMON.has(w[nxt]) && !PLACE_WORDS.has(w[nxt]) && !VERBS[w[nxt]] && !KEYWORDS[w[nxt]]
        && !NET_PREPS.has(w[nxt]) && !["to", "into", "for", "with", "worth", "usd", "dollars", "percent"].includes(w[nxt])) {
        f.unknownSymbols.push(tokens[nxt].raw.toUpperCase());
        setSymbol(side, tokens[nxt].raw.toUpperCase());
        i += 2; prep = null; continue;
      }
      i++; continue;
    }

    // amount words
    if (word === "half" && !rebalancing) { setAmount({ kind: "PERCENT_OF_BALANCE", percent: "50" }); i++; continue; }
    if (ALL_WORDS.has(word) && (w[i + 1] === "my" || w[i + 1] === "of" || w[i + 1] === "the" || ent.lex.get(i + 1)?.asset) && txCls) {
      setAmount({ kind: "PERCENT_OF_BALANCE", percent: "100" }); i++; continue;
    }

    // verbs
    if (VERBS[word] || classify(word, w[i + 1])) {
      const cls = classify(word, w[i + 1]);
      if (cls && TX.has(cls) && word === "buy") side = "dest";
      // "transfer" as a noun after a verb: "schedule a transfer of 20 USDC"
      i++; continue;
    }

    // direction words
    if (word === "to" && live(i + 1) && classify(w[i + 1], w[i + 2])) { i++; continue; } // "I want to swap"
    if (word === "to" || word === "into" || (word === "for" && (txCls === "SWAP" || txCls === "BRIDGE"))) {
      if (txCls || f.primary === "AMEND" || !f.primary || rebalancing) side = "dest";
      prep = "to";
      if (rebalancing && pendingPercent) { /* "60% to ETH" */ }
      i++; continue;
    }
    if ((word === "with" || word === "using") && isBuy) { side = "source"; prep = null; i++; continue; }
    if (NET_PREPS.has(word)) { prep = word; i++; continue; }

    // self and placeholders
    if (SELF_WORDS.has(word) && (side === "dest" || prep === "to") && txCls) {
      if (!f.recipient) f.recipient = { kind: "SELF", address: null };
      prep = null; i++; continue;
    }
    if (word === "my" && PLACE_WORDS.has(w[i + 1] ?? "") && (side === "dest" || prep === "to")) {
      if (!f.recipient) f.recipient = { kind: "SELF", address: null };
      i += 2; prep = null; continue;
    }
    if (word === "my" && (w[i + 1] === "own") && PLACE_WORDS.has(w[i + 2] ?? "")) {
      if (!f.recipient) f.recipient = { kind: "SELF", address: null };
      i += 3; prep = null; continue;
    }
    if (PLACE_WORDS.has(word) && (side === "dest" || prep === "to") && txCls && !f.recipient && w[i - 1] !== "my") {
      f.recipient = { kind: "PLACEHOLDER", address: null };
      i++; continue;
    }

    // spak ids for status/cancel
    if (ID_RE.test(word)) { f.target = { ref: "ID", id: t.raw, resolvedId: null }; i++; continue; }

    if (L) {
      const span = L.end - L.start;
      const nextWord = w[L.end];
      const inNetSlot = prep !== null && (NET_PREPS.has(prep)) || NETWORK_NOUNS.has(nextWord ?? "") || (nextWord && PLACE_WORDS.has(nextWord) && side === "dest");
      const afterTo = prep === "to";

      if (L.unsupportedNetwork && (inNetSlot || afterTo || !L.asset)) {
        f.issues.push(err("UNSUPPORTED_NETWORK", `SPak does not support ${L.unsupportedNetwork} yet.`, prep === "from" || side === "source" ? "sourceNetwork" : "destNetwork", { network: L.unsupportedNetwork }));
        i += span; prep = null; if (NETWORK_NOUNS.has(w[i] ?? "")) i++; continue;
      }

      let asNetwork = false;
      if (L.network) {
        if (inNetSlot) asNetwork = true;
        else if (afterTo) {
          // "to NEAR": bridges and transfers move to a network; swaps go to an asset.
          asNetwork = txCls === "SWAP" || !txCls ? !(L.asset?.strong) : true;
          if (txCls === "SWAP" && L.asset && L.network.strong && L.asset.symbol !== "SOL" && L.asset.symbol !== "BTC") asNetwork = true;
        } else if (!L.asset) asNetwork = true;
        else if (txCls && (side === "dest" ? f.destSymbol : f.sourceSymbol) && !(side === "dest" ? f.destNetwork : f.sourceNetwork)) asNetwork = true;
        else if (L.network.strong && !L.asset.strong) asNetwork = true;
        else if (!txCls && f.primary !== "AMEND" && f.primary !== null) asNetwork = L.network.strong; // "show my balance on solana"
      }

      if (asNetwork && L.network) {
        let role: "source" | "dest" | "loose";
        if (prep === "from") role = "source";
        else if (prep === "to") role = "dest";
        else if (txCls) role = side;
        else role = "loose"; // follow-ups and queries: the context resolver decides
        setNetwork(role, L.network.id);
        i += span; prep = null; if (NETWORK_NOUNS.has(w[i] ?? "")) i++;
        continue;
      }
      if (L.asset) {
        const sym = L.asset.symbol;
        if (rebalancing) {
          if (pendingPercent) { allocations.push({ symbol: sym, percent: pendingPercent.value }); pendingPercent = null; }
          else pendingAllocSymbol = sym;
          mentionedSymbols.push(sym);
          i += span; prep = null; continue;
        }
        const strongEnough = L.asset.strong || tokens[i - 1]?.kind === "number" || prep === "to";
        if (strongEnough) {
          let role: "source" | "dest" | "loose" = txCls ? side : "loose";
          if (!txCls && prep === "to") role = "dest";
          if (!txCls && (prep === "from" || w[i - 1] === "with")) role = "source";
          if (!txCls && w[i - 1] === "of" && w[i - 2] === "instead") role = "loose";
          setSymbol(role, sym);
          if (role === "source" && w[L.end] === "balance") i++;
        }
        i += span; prep = null; continue;
      }
    }

    // Unknown word in a network slot followed by "network/chain": "on an unsupported network"
    if (prep && NET_PREPS.has(prep) && t.kind === "word") {
      const look = [];
      let j = i;
      while (j < tokens.length && j < i + 4 && !NETWORK_NOUNS.has(w[j])) { look.push(w[j]); j++; }
      if (NETWORK_NOUNS.has(w[j] ?? "")) {
        const phrase = look.filter((x) => !["a", "an", "the", "some"].includes(x)).join(" ");
        f.issues.push(err("UNSUPPORTED_NETWORK", `"${phrase || w[j]}" is not a network SPak supports.`, prep === "from" || side === "source" ? "sourceNetwork" : "destNetwork", { network: phrase }));
        i = j + 1; prep = null; continue;
      }
    }

    if (rebalancing && pendingPercent && /^[A-Z][A-Z0-9]{1,9}$/.test(t.raw)) {
      allocations.push({ symbol: t.raw, percent: pendingPercent.value }); pendingPercent = null; i++; continue;
    }
    // Unknown ticker in capitals where an asset belongs: "swap 5 USDC to FOO"
    if (txCls && t.kind === "word" && t.raw.length >= 2 && t.raw === t.raw.toUpperCase() && /^[A-Z][A-Z0-9]{1,9}$/.test(t.raw) && (prep === "to" || side === "source")) {
      f.unknownSymbols.push(t.raw);
      setSymbol(side, t.raw);
      i++; prep = null; continue;
    }

    if (!SKIP.has(word)) prep = null;
    i++;
  }

  if (amountCount > 1) {
    f.issues.push(err("AMBIGUOUS_AMOUNT", "Found more than one amount. Which amount should SPak use?", "amount"));
  }
  if (rebalancing) f.allocations = allocations.length ? allocations : null;

  // Targets for status and cancel.
  if (!f.target && (classes.has("CANCEL") || classes.has("STATUS") || f.keywords.has("status") || f.keywords.has("pending"))) {
    let ref: Target["ref"] = classes.has("CANCEL") ? "LATEST_PENDING" : "LATEST";
    if (f.keywords.has("scheduled") || f.schedule) ref = "SCHEDULED";
    else if ((w.includes("all") || w.includes("every") || w.includes("everything")) && classes.has("CANCEL")) ref = "ALL_PENDING";
    else if (f.keywords.has("pending")) ref = "LATEST_PENDING";
    f.target = { ref, id: null, resolvedId: null };
  }
  f.query = { assets: [...new Set(mentionedSymbols)], networks: [...new Set(mentionedNetworks)] };
  return f;
}
