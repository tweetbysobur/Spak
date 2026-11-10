import type { Frame } from "../parser/frame";
import { IntentRegistry, type IntentDefinition } from "../registries/intent-registry";
import { deriveTxType, type TxIntentType } from "./transaction-type";

const has = (f: Frame, ...cls: Frame["verbs"][number]["cls"][]) => f.verbs.some((v) => cls.includes(v.cls));
const txVerb = (f: Frame) => f.verbs.find((v) => ["SWAP", "BRIDGE", "SEND", "TRANSFER", "PAY"].includes(v.cls))?.cls ?? null;
export const txShape = (f: Frame) => ({
  verb: txVerb(f), sourceSymbol: f.sourceSymbol, destSymbol: f.destSymbol,
  sourceNetwork: f.sourceNetwork, destNetwork: f.destNetwork, recipient: f.recipient,
});

const txDef = (type: TxIntentType, description: string, priority: number): IntentDefinition => ({
  type, category: "TRANSACTION", description, priority, movesFunds: true,
  match: (f) => (txVerb(f) && !f.schedule && !f.condition && !has(f, "CANCEL", "SCHEDULE") && deriveTxType(txShape(f)) === type ? 70 : 0),
});

export const BUILTIN_INTENTS: IntentDefinition[] = [
  {
    type: "CANCEL_TRANSACTION", category: "MANAGEMENT", priority: 1, movesFunds: false,
    description: "Cancel a pending or scheduled transaction.",
    match: (f) => (f.primary === "CANCEL" ? 100 : 0),
  },
  {
    type: "CONDITIONAL_TRANSACTION", category: "WRAPPER", priority: 2, movesFunds: true,
    description: "Run a transaction or send a notification when a price, fee or route condition is met.",
    match: (f) => (f.condition || f.issues.some((i) => i.code === "INVALID_CONDITION") ? 95 : has(f, "NOTIFY") && f.keywords.has("destination_word") ? 0 : 0),
  },
  {
    type: "SCHEDULED_TRANSACTION", category: "WRAPPER", priority: 3, movesFunds: true,
    description: "Run a transaction once at a set time or on a recurring schedule.",
    match: (f) => ((f.schedule && (txVerb(f) || has(f, "SCHEDULE"))) || (has(f, "SCHEDULE") && txVerb(f)) ? 92 : 0),
  },
  {
    type: "PORTFOLIO_REBALANCE", category: "TRANSACTION", priority: 4, movesFunds: true,
    description: "Move holdings toward target percentages.",
    match: (f) => (f.primary === "REBALANCE" ? 90 : 0),
  },
  {
    type: "TRANSACTION_HISTORY", category: "READ", priority: 5, movesFunds: false,
    description: "List past transactions.",
    match: (f) => (f.keywords.has("history") && !txVerb(f) && !f.target?.id ? (f.tokens.some((t) => t.lower === "history") ? 88 : 75) : 0),
  },
  {
    type: "TRANSACTION_STATUS", category: "READ", priority: 6, movesFunds: false,
    description: "Report the state of a transaction.",
    match: (f) => ((has(f, "STATUS") || f.keywords.has("status") || (f.target?.ref === "ID" && !has(f, "CANCEL"))) && !has(f, "REBALANCE") ? 80 : 0),
  },
  {
    type: "PORTFOLIO_QUERY", category: "READ", priority: 7, movesFunds: false,
    description: "Show balances and portfolio value.",
    match: (f) => ((f.keywords.has("portfolio") || f.keywords.has("balance")) && !txVerb(f) ? 60 : 0),
  },
  txDef("SWAP", "Swap one asset for another on the same network.", 10),
  txDef("CROSS_CHAIN_SWAP", "Swap one asset for another across networks.", 11),
  txDef("BRIDGE", "Move the same asset to another network.", 12),
  txDef("CROSS_CHAIN_TRANSFER", "Move an asset to another network, to your own wallet.", 13),
  txDef("PAYMENT", "Send an asset to someone else's address.", 14),
];

export function createDefaultRegistry(): IntentRegistry {
  const r = new IntentRegistry();
  for (const d of BUILTIN_INTENTS) r.register(d);
  return r;
}
