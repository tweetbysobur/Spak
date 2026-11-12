/**
 * Marketing copy that makes product claims. Kept as data so tests can check it against the implementation
 * (tests/marketing/site.test.ts). Rule: describe what the code does today. Anything else is listed as "planned".
 */
import { NETWORKS } from "@/spak-in/registries/networks";
import { listAssets } from "@/spak-in/registries/assets";

export const SITE = {
  name: "SPak",
  tagline: "Intelligent execution across chains.",
  description: "SPak turns your intentions into controlled, verifiable actions across blockchain networks.",
  /** Public origin for canonical URLs and Open Graph. Same variable the app uses for sign-in messages. */
  origin: (process.env.SPAK_APP_ORIGIN ?? "https://usespak.vercel.app").replace(/\/$/, ""),
  appPath: "/app",
} as const;

/** Share image, built by scripts/marketing/build_og.cjs. Child pages must repeat it: Next.js replaces openGraph as a whole. */
export const OG_IMAGE = { url: "/marketing/spak-og.png", width: 1200, height: 630, alt: "SPak. Intelligent execution across chains." } as const;

export const NAV = [
  { label: "Product", href: "/#product" },
  { label: "Developers", href: "/developers" },
  { label: "Documentation", href: "/docs" },
] as const;

/** Networks where SPak reads the chain itself to verify deposits and deliveries (docs/SPAK-TRACKING.md). */
export const VERIFIED_FAMILIES = ["evm", "solana", "near"] as const;
const verified = (family: string) => (VERIFIED_FAMILIES as readonly string[]).includes(family);
export const NETWORKS_VERIFIED = NETWORKS.filter((n) => verified(n.family)).map((n) => n.name);
export const NETWORKS_REVIEWED = NETWORKS.filter((n) => !verified(n.family)).map((n) => n.name);
export const NETWORK_COUNT = NETWORKS.length;
export const ASSET_COUNT = listAssets().length;

/** The execution journey. `lane` is who acts. `moves` is false until the user has approved and signed. */
export const STEPS = [
  { id: "intent", lane: "You", title: "Understand intent", body: "You write what you want in plain words. SPak reads the amount, assets, networks and recipient. If anything is unclear it asks. It does not guess.", moves: false },
  { id: "plan", lane: "SPak", title: "Build the plan", body: "SPak turns the instruction into a fixed plan and fetches a quote from NEAR Intents: what you send, the minimum you receive, every fee and the deadline.", moves: false },
  { id: "approval", lane: "You", title: "You approve", body: "Nothing moves without you. You approve the firm quote, then sign the deposit in your own wallet. SPak never holds your keys.", moves: false },
  { id: "execute", lane: "NEAR Intents", title: "Execute", body: "Your wallet sends the deposit. NEAR Intents settles the transfer and delivers to the recipient on the destination network.", moves: true },
  { id: "verify", lane: "SPak", title: "Verify the outcome", body: "SPak reads the destination chain and compares the delivery with what you approved. Only then does it say Completed.", moves: true },
] as const;

export type Pillar = { id: string; name: string; summary: string; status: "Live" | "Partly live" | "Planned"; live: string[]; planned: string[] };

export const PILLARS: Pillar[] = [
  {
    id: "agent", name: "SPak Agent", status: "Partly live",
    summary: "A NEAR account that represents you inside SPak. Your connected wallets stay yours and keep signing.",
    live: [
      "Mark one verified NEAR wallet as your agent identity. This records the link only.",
      "The agent identity is tied to your account and checked on every request.",
    ],
    planned: [
      "A dedicated NEAR account created for your agent.",
      "Execution by the agent inside limits you set. Today nothing signs on your behalf.",
    ],
  },
  {
    id: "intelligence", name: "SPak Intelligence", status: "Partly live",
    summary: "The part that understands what you ask. It follows fixed rules and does not use a language model, so the same sentence always gives the same plan.",
    live: [
      "Reads swaps, bridges, transfers and payments written in plain words.",
      "Stops and asks when an instruction is ambiguous or incomplete.",
      "History of your transfers with live tracking for each one.",
    ],
    planned: [
      "Portfolio balances and cross-chain insights. SPak understands these questions today but cannot answer them yet.",
      "Rebalancing. It is understood and planned, and it does not run.",
    ],
  },
  {
    id: "guard", name: "SPak Guard", status: "Partly live",
    summary: "The controls between an instruction and your funds.",
    live: [
      "Every transfer needs your approval of a firm quote. The approval is bound to that exact plan.",
      "A value cap applies to each transfer. If SPak cannot price a transfer, it refuses it.",
      "A slippage limit sets the minimum you can receive, shown before you approve.",
    ],
    planned: [
      "Your own saved limits: daily spending, allowed networks and assets, approved recipients. The policy engine exists. The settings screen does not.",
    ],
  },
  {
    id: "payments", name: "SPak Payments", status: "Partly live",
    summary: "Pay someone on another network from the asset you hold.",
    live: [
      "Send an asset to another person's address on a different network in one instruction.",
      "The recipient address is checked against the destination network before any quote.",
      "Delivery to the recipient is verified on the networks SPak can read.",
    ],
    planned: [
      "Payment requests, checkout and recurring payments are not built.",
    ],
  },
  {
    id: "conditional", name: "SPak Conditional Execution", status: "Planned",
    summary: "Transfers that wait for a time or a price. SPak reads these instructions today; it does not run them.",
    live: [
      "Understands many scheduled and price-conditional instructions and shows the plan they would follow.",
      "Says plainly that the plan needs a scheduler or a price monitor that is not built, so nothing runs.",
    ],
    planned: [
      "A scheduler and a condition monitor. Each run would still need your approval unless you set limits in SPak Guard.",
    ],
  },
  {
    id: "connect", name: "SPak Connect", status: "Partly live",
    summary: "How wallets, and later other apps, connect to SPak.",
    live: [
      "Sign in with an EVM, Solana or NEAR wallet by signing a one-time message. No password, key or seed phrase.",
      "Link several wallets to one account and choose which one is active on each network.",
    ],
    planned: [
      "A public API and SDK so other apps can hand SPak an intent. Today the API serves only the SPak app.",
    ],
  },
];

export type SecurityItem = { title: string; body: string };

export const SECURITY: SecurityItem[] = [
  { title: "Wallet authorization", body: "You sign in by signing a one-time message. SPak checks the signature on the server. It never asks for a private key or seed phrase." },
  { title: "Explicit approval", body: "A deposit address exists only after you approve the firm quote. A new quote or a changed plan cancels the approval." },
  { title: "Deposit verification", body: "After your wallet sends the deposit, SPak reads the source chain and checks sender, recipient, asset and exact amount." },
  { title: "Destination verification", body: "SPak reads the destination chain and confirms the recipient received at least the approved minimum. Completed is shown only after this check." },
  { title: "Failure handling", body: "Delays are never reported as failures. If SPak cannot confirm an outcome it says so and opens a manual review." },
];

/** What SPak verifies itself, and what it takes from NEAR Intents. Mirrors docs/SPAK-TRACKING.md and docs/SPAK-FAILURE-REFUNDS.md. */
export const VERIFICATION_ROWS = [
  { stage: "Sign-in", source: "SPak", detail: "Signature checked on the server against a one-time challenge." },
  { stage: "Quote and settlement", source: "NEAR Intents", detail: "SPak relies on the provider's quote and status. It does not verify the settlement steps in between." },
  { stage: "Deposit", source: "SPak, on chain", detail: "Read from the source chain on EVM networks, Solana and NEAR." },
  { stage: "Delivery", source: "SPak, on chain", detail: "Read from the destination chain on EVM networks, Solana and NEAR. On other networks the transfer goes to manual review." },
  { stage: "Refund", source: "NEAR Intents, then SPak", detail: "NEAR Intents sends refunds automatically and does not name the refund transaction. SPak shows Refunded only when a transfer back to you is verified on chain and linked to your transfer." },
] as const;

/** Homepage: how SPak works, five stops. `moves` is false until the user has approved and signed. */
export const JOURNEY = [
  { id: "describe", title: "Describe your intention", body: "Write what you want in plain words.", moves: false },
  { id: "plan", title: "SPak prepares the plan", body: "A fixed plan and a quote, with every fee.", moves: false },
  { id: "approve", title: "You review and approve", body: "Nothing moves before this.", moves: false },
  { id: "execute", title: "NEAR Intents executes", body: "Your wallet sends; NEAR Intents settles.", moves: true },
  { id: "verify", title: "SPak tracks and verifies", body: "Delivery is checked on chain where supported.", moves: true },
] as const;

/** Homepage: trust and control, three points. The detail is in /docs. */
export const TRUST = [
  { title: "You approve every transfer", body: "SPak prepares a transfer and stops. It continues only when you approve the exact quote." },
  { title: "Your wallet authorises it", body: "Your own wallet signs and sends. SPak never holds your keys and cannot move your funds." },
  { title: "Tracked and verified", body: "SPak tracks every transfer to the end and verifies delivery on chain where supported: EVM networks, Solana and NEAR." },
] as const;

/** Documentation: the detailed execution lifecycle, seven stages. */
export const LIFECYCLE = [
  { id: "intent", title: "Understand intent", actor: "You and SPak", moves: false,
    body: "You write the outcome in plain words. SPak reads the amount, assets, networks and recipient with fixed rules. If something is missing or could mean two things, it asks." },
  { id: "plan", title: "Build the plan", actor: "SPak", moves: false,
    body: "The instruction becomes a fixed plan with a hash. Each step names who acts. SPak can prepare; only your wallet can send." },
  { id: "quote", title: "Get a quote", actor: "NEAR Intents", moves: false,
    body: "NEAR Intents quotes the route: an estimate first, then a firm quote with the minimum you receive, every fee and a deadline." },
  { id: "approval", title: "Your approval", actor: "You", moves: false,
    body: "You tick the box and approve that exact quote. A new quote or a changed plan cancels it. Approval alone moves nothing." },
  { id: "deposit", title: "Deposit and execution", actor: "Your wallet, then NEAR Intents", moves: true,
    body: "Your wallet signs and sends the deposit. SPak checks it on the source chain, then NEAR Intents settles the transfer." },
  { id: "verification", title: "Destination verification", actor: "SPak", moves: true,
    body: "SPak reads the destination chain and compares the delivery with the minimum you approved. Only then does it say Completed." },
  { id: "refunds", title: "Failure and refunds", actor: "NEAR Intents, then SPak", moves: true,
    body: "If a transfer fails, NEAR Intents returns the funds to the wallet that sent them. SPak marks it Refunded only when it can verify that on chain." },
] as const;

/** Phrases the brand guidelines forbid in every channel (docs/SPAK-BRAND-GUIDELINES.md, honesty rules). */
export const BANNED_PHRASES = ["instant", "guaranteed", "risk-free", "zero fees", "trustless", "seamless", "revolutionary"] as const;
