import { NATIVE_HOME, NETWORKS, resolveNetwork, resolveToken } from "./catalog";
import { isValidAddressFor, looksLikeAddress } from "./address";
import type {
  ExecutionPlan, Intent, IntentAction, InterpretResult, MissingField, PolicyConfig, WalletContext,
} from "./types";

export const DEFAULT_POLICY: PolicyConfig = { maxSlippageBps: 100 };

const SWAP_VERBS = new Set(["swap", "convert", "exchange", "trade"]);
const BRIDGE_VERBS = new Set(["bridge", "move"]);
const TRANSFER_VERBS = new Set(["send", "pay", "transfer"]);
const SOURCE_PREPS = new Set(["on", "from"]);
const DEST_SWITCH = new Set(["to", "into", "for"]);
const DEST_PREPS = new Set(["on", "at", "via"]);

// ---------- 1. Intent parser: normalise and tokenise ----------
export function tokenize(text: string): string[] {
  return text
    .replace(/->|→|=>/g, " to ")
    .replace(/(\d),(\d{3})/g, "$1$2")
    .split(/\s+/)
    .map((w) => w.replace(/^[("'“]+|[)"'”,!?;:]+$/g, "").replace(/\.$/, ""))
    .filter(Boolean);
}

// ---------- 2 + 3. Entity extraction and intent classification ----------
interface Extracted {
  action?: IntentAction;
  isBridge: boolean;
  partial: Partial<Intent>;
  issues: string[];
}

export function extract(text: string): Extracted {
  const words = tokenize(text);
  const lower = words.map((w) => w.toLowerCase());
  const issues: string[] = [];
  const partial: Partial<Intent> = {};

  let action: IntentAction | undefined;
  let isBridge = false;
  const verbs = lower.filter((w) => SWAP_VERBS.has(w) || BRIDGE_VERBS.has(w) || TRANSFER_VERBS.has(w));
  const kinds = new Set(verbs.map((v) => (TRANSFER_VERBS.has(v) ? "transfer" : "swap")));
  if (kinds.size > 1) issues.push("The instruction mixes a swap and a transfer. Ask for one action at a time.");
  if (verbs[0]) {
    action = TRANSFER_VERBS.has(verbs[0]) ? "transfer" : "swap";
    isBridge = BRIDGE_VERBS.has(verbs[0]);
  }

  const amountIdx = lower.findIndex((w) => /^\$?\d+(\.\d+)?$/.test(w));
  const amounts = lower.filter((w) => /^\$?\d+(\.\d+)?$/.test(w));
  if (amounts.length > 1) issues.push(`Found ${amounts.length} amounts (${amounts.join(", ")}). Give one amount.`);
  if (amountIdx >= 0) partial.amount = lower[amountIdx].replace(/^\$/, "");

  let side: "source" | "dest" = "source";
  for (let i = amountIdx >= 0 ? amountIdx + 1 : 0; i < words.length; i++) {
    const w = lower[i];
    const raw = words[i];
    if (SWAP_VERBS.has(w) || BRIDGE_VERBS.has(w) || TRANSFER_VERBS.has(w)) continue;

    if (looksLikeAddress(raw)) {
      if (side === "dest" || action === "transfer") partial.recipient = raw;
      else partial.refundTo = raw;
      continue;
    }
    if (DEST_SWITCH.has(w) && side === "source") { side = "dest"; continue; }
    if ((side === "source" ? SOURCE_PREPS : DEST_PREPS).has(w)) {
      const net = lower[i + 1] && resolveNetwork(lower[i + 1]);
      if (net) {
        if (side === "source") partial.sourceNetwork = net; else partial.destNetwork = net;
        i++;
      }
      continue;
    }
    if (side === "source") {
      if (!partial.sourceToken) { const t = resolveToken(w); if (t) partial.sourceToken = t; continue; }
      const net = resolveNetwork(w);
      if (net && !partial.sourceNetwork) partial.sourceNetwork = net; // "50 usdc base to ..."
      continue;
    }
    // dest side
    const net = resolveNetwork(w);
    const tok = resolveToken(w);
    const preferNetwork = isBridge || action === "transfer" || (partial.destToken !== undefined);
    if (net && (preferNetwork || !tok)) { if (!partial.destNetwork) partial.destNetwork = net; continue; }
    if (tok && !partial.destToken) { partial.destToken = tok; continue; }
    if (net && !partial.destNetwork) partial.destNetwork = net;
  }
  if (action) partial.action = action;
  return { action, isBridge, partial, issues };
}

// ---------- 4. Context resolver ----------
function resolveContext(p: Partial<Intent>, ctx: WalletContext, assumptions: string[]): void {
  if (!p.sourceNetwork && p.sourceToken && NATIVE_HOME[p.sourceToken]) {
    p.sourceNetwork = NATIVE_HOME[p.sourceToken];
    assumptions.push(`${p.sourceToken} is native to ${NETWORKS[p.sourceNetwork].name}, so the source network is ${NETWORKS[p.sourceNetwork].name}.`);
  }
  if (p.action === "transfer" && !p.destToken && p.sourceToken) p.destToken = p.sourceToken;
  if (p.action === "swap" && !p.destToken && p.destNetwork && p.sourceToken) {
    p.destToken = p.sourceToken;
    assumptions.push(`No destination token given. Bridging ${p.sourceToken} as ${p.sourceToken}.`);
  }
  if (!p.destNetwork && p.destToken && NATIVE_HOME[p.destToken]) {
    p.destNetwork = NATIVE_HOME[p.destToken];
    assumptions.push(`${p.destToken} is native to ${NETWORKS[p.destNetwork].name}, so the destination network is ${NETWORKS[p.destNetwork].name}.`);
  }
  if (!p.destNetwork && p.sourceNetwork && p.action === "transfer" && !p.recipient) {
    // no-op: recipient decides the network for transfers; leave it missing.
  } else if (!p.destNetwork && p.sourceNetwork) {
    p.destNetwork = p.sourceNetwork;
    assumptions.push(`No destination network given. Using ${NETWORKS[p.sourceNetwork]?.name ?? p.sourceNetwork}, the same as the source.`);
  }
  if (!p.recipient && p.destNetwork && ctx.addresses?.[p.destNetwork]) {
    p.recipient = ctx.addresses[p.destNetwork];
    assumptions.push(`Delivering to your connected ${NETWORKS[p.destNetwork]?.name ?? p.destNetwork} address.`);
  }
  if (!p.refundTo && p.sourceNetwork && ctx.addresses?.[p.sourceNetwork]) {
    p.refundTo = ctx.addresses[p.sourceNetwork];
  }
}

// ---------- 5. Validation engine ----------
function validate(p: Partial<Intent>, missing: MissingField[], issues: string[], rejects: string[]): void {
  if (!p.action) missing.push("action");
  if (!p.amount) missing.push("amount");
  else if (!(Number(p.amount) > 0)) rejects.push("Amount must be greater than zero.");
  if (!p.sourceToken) missing.push("sourceToken");
  if (!p.sourceNetwork) missing.push("sourceNetwork");
  if (!p.destToken) missing.push("destToken");
  if (!p.destNetwork) missing.push("destNetwork");
  if (!p.recipient) missing.push("recipient");
  if (!p.refundTo) missing.push("refundTo");

  for (const n of [p.sourceNetwork, p.destNetwork]) {
    if (n && !NETWORKS[n]) rejects.push(`Network "${n}" is not supported.`);
  }
  if (p.recipient && p.destNetwork && isValidAddressFor(p.destNetwork, p.recipient) === false) {
    rejects.push(`${p.recipient} is not a valid ${NETWORKS[p.destNetwork].name} address.`);
  }
  if (p.refundTo && p.sourceNetwork && isValidAddressFor(p.sourceNetwork, p.refundTo) === false) {
    rejects.push(`Refund address ${p.refundTo} is not a valid ${NETWORKS[p.sourceNetwork].name} address.`);
  }
  if (p.action === "swap" && p.sourceToken === p.destToken && p.sourceNetwork && p.sourceNetwork === p.destNetwork) {
    rejects.push("Source and destination are the same token on the same network. Nothing to swap.");
  }
  void issues;
}

// ---------- 8. Policy engine ----------
function applyPolicy(p: Partial<Intent>, policy: PolicyConfig, rejects: string[]): void {
  if (policy.allowedNetworks) {
    for (const n of [p.sourceNetwork, p.destNetwork]) {
      if (n && !policy.allowedNetworks.includes(n)) rejects.push(`Your Guard settings do not allow ${NETWORKS[n]?.name ?? n}.`);
    }
  }
  if (policy.allowedTokens) {
    for (const t of [p.sourceToken, p.destToken]) {
      if (t && !policy.allowedTokens.includes(t)) rejects.push(`Your Guard settings do not allow ${t}.`);
    }
  }
}

// ---------- 6 + 7. Execution planner (route evaluation happens against live quotes) ----------
function plan(i: Required<Intent>, policy: PolicyConfig): ExecutionPlan {
  const cross = i.sourceNetwork !== i.destNetwork;
  const sameToken = i.sourceToken === i.destToken;
  const kind: ExecutionPlan["kind"] =
    i.action === "transfer" ? (cross ? "cross_chain_transfer" : "same_chain_transfer")
    : sameToken ? "bridge" : cross ? "cross_chain_swap" : "same_chain_swap";
  const src = NETWORKS[i.sourceNetwork].name;
  const dst = NETWORKS[i.destNetwork].name;
  return {
    kind,
    slippageBps: policy.maxSlippageBps,
    steps: [
      `Request a NEAR Intents quote: ${i.amount} ${i.sourceToken} on ${src} to ${i.destToken} on ${dst}.`,
      "Show the review and wait for your explicit approval.",
      `Deposit ${i.amount} ${i.sourceToken} on ${src} to the quoted deposit address.`,
      `Solvers settle through NEAR Intents and deliver ${i.destToken} to ${i.recipient} on ${dst}.`,
      "Track status until NEAR Intents reports success, refund or failure.",
    ],
  };
}

/** SPak-in entry point. Deterministic: same text and context always give the same result. */
export function interpret(text: string, ctx: WalletContext = {}, policy: PolicyConfig = DEFAULT_POLICY): InterpretResult {
  const { partial, issues } = extract(text);
  const assumptions: string[] = [];
  resolveContext(partial, ctx, assumptions);

  const missing: MissingField[] = [];
  const rejects: string[] = [];
  validate(partial, missing, issues, rejects);
  applyPolicy(partial, policy, rejects);

  if (rejects.length) return { status: "rejected", partial, issues: [...issues, ...rejects] };
  if (missing.length || issues.length) return { status: "needs_info", partial, missing, issues, assumptions };

  const intent = partial as Required<Intent>;
  return { status: "ready", intent, assumptions, plan: plan(intent, policy) };
}

export const FIELD_PROMPTS: Record<MissingField, string> = {
  action: "What should SPak do: swap, bridge or send?",
  amount: "How much?",
  sourceToken: "Which token are you sending?",
  sourceNetwork: "Which network are the funds on?",
  destToken: "Which token should arrive?",
  destNetwork: "Which network should receive it?",
  recipient: "Which address should receive the funds?",
  refundTo: "Which address on the source network gets a refund if the swap fails?",
};
