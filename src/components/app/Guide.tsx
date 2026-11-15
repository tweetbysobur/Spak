"use client";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { Icon } from "@/components/icons";
import { PROVIDER_LABEL } from "@/environment";
import { startTour } from "./Tour";
import type { View } from "./Shell";

/**
 * In-app guide: how each live feature works, step by step, with a direct way to open it.
 * Copy describes only what the code does today. Searchable index on the left (a picker on phones).
 */
type Topic = { id: string; title: string; summary: string; steps: string[]; checks?: string[]; open?: { view: View; label: string } };

const TOPICS: Topic[] = [
  {
    id: "start", title: "Getting started", summary: "Sign in with a wallet and link the wallets you want to use.",
    steps: [
      "Choose Sign in and pick an EVM, Solana or NEAR wallet.",
      "Your wallet asks you to sign a one-time message. It is not a transaction and costs nothing.",
      "In Settings, link more wallets and choose which one SPak uses on each network.",
    ],
    checks: ["SPak never asks for a private key or seed phrase.", "The signature is verified on SPak's server before you are signed in."],
    open: { view: "settings", label: "Open Settings" },
  },
  {
    id: "execute", title: "Make a transfer", summary: "Describe a transfer in plain words. SPak turns it into an exact plan.",
    steps: [
      "Open Execute and type an instruction, for example “Move 20 USDC from Base to NEAR”.",
      "SPak shows how it read your instruction: amount, token, source and destination network, recipient.",
      "If anything is unclear, SPak asks a question instead of guessing.",
      "SPak checks your balance on the source network and warns you before the quote if it is short.",
    ],
    checks: ["The reading uses fixed rules, not a language model, so the same sentence always gives the same plan."],
    open: { view: "execute", label: "Open Execute" },
  },
  {
    id: "review", title: "Review and confirm", summary: `Check a signed ${PROVIDER_LABEL} quote, then confirm once.`,
    steps: [
      "The review shows what you send, the minimum you receive, every fee and the recipient.",
      "Press Confirm and send. SPak gets a firm quote and stops if its minimum is lower than the one you saw.",
      "If the token needs an approval, your wallet asks for it first.",
      "Your wallet then asks you to sign the deposit. Nothing moves until you sign.",
    ],
    checks: ["The quote signature is verified.", "Your approval is tied to this exact plan. A changed plan needs a new approval.", "SPak Guard checks the transfer before the quote and again before the deposit."],
    open: { view: "execute", label: "Start a transfer" },
  },
  {
    id: "tracking", title: "Tracking and Activity", summary: "Follow every transfer until delivery is proven.",
    steps: [
      "After your deposit, the transfer page shows each step and refreshes on its own.",
      "Activity lists every transfer with its live status. Filter by in progress, completed or needs attention.",
      "A transfer shows Completed only after SPak reads the destination chain and finds the payout.",
    ],
    checks: ["Some routes cannot be verified automatically. SPak marks them for manual review before you confirm."],
    open: { view: "activity", label: "Open Activity" },
  },
  {
    id: "refunds", title: "Failures and refunds", summary: "If a swap fails, the refund is tracked the same way.",
    steps: [
      `${PROVIDER_LABEL} refunds a failed swap to the refund address shown in the review.`,
      "The transfer moves to Refunding, then Refunded once SPak sees the refund on chain.",
      "If an outcome cannot be confirmed, SPak says so and opens a review. It never marks it complete.",
    ],
    open: { view: "activity", label: "Open Activity" },
  },
  {
    id: "intelligence", title: "Intelligence", summary: "Your balances on 10 networks, valued with independent prices.",
    steps: [
      "Open Intelligence to see holdings across your linked wallets.",
      "Ask questions like “How much USDC do I have?”.",
      "Choose Routes on a holding and enter an amount to compare live quotes. Nothing moves.",
      "Choose Move here on a route to start that transfer in Execute.",
    ],
    checks: ["A balance SPak cannot read shows as unknown, never as zero.", "Prices come from Chainlink first; other prices are used only when they agree."],
    open: { view: "portfolio", label: "Open Intelligence" },
  },
  {
    id: "guard", title: "SPak Guard", summary: "Your own limits, checked on SPak's server for every transfer.",
    steps: [
      "Open SPak Guard and set per-transfer, 24-hour, 7-day and 30-day spending limits.",
      "Choose allowed networks and tokens, and keep a list of approved recipients.",
      "Use the pause switch to stop all new transfers at once.",
    ],
    checks: ["Guard runs before the quote and again before the deposit.", "If Guard cannot price or check a transfer, it refuses it."],
    open: { view: "guard", label: "Open SPak Guard" },
  },
  {
    id: "agent", title: "SPak Agent", summary: "Let your Agent approve transfers for you, only within limits you sign.",
    steps: [
      "Open Agent and verify a NEAR wallet you own as your Agent identity.",
      "Create a permission: per-transfer and 24-hour limits, number of transfers, minimum minutes between transfers, networks, tokens, recipients and how long it lasts.",
      "Sign the permission with your NEAR wallet. Every limit is in the message you sign.",
      "Transfers started through your Agent inside those limits are approved without asking you. Your wallet still signs every deposit.",
      "The Agent page lists each Agent approval with its status. Waiting for your wallet signature means the deposit is ready for you.",
      "Pause, resume or revoke the permission at any time. It takes effect at once.",
    ],
    checks: ["SPak Guard still checks every Agent approval.", "Anything outside the permission goes back to you to approve.", "SPak holds no key and never signs for you."],
    open: { view: "agent", label: "Open Agent" },
  },
  {
    id: "settings", title: "Wallets and networks", summary: "Choose which wallet SPak uses on each network.",
    steps: [
      "Link EVM, Solana and NEAR wallets in Settings.",
      "Pick the active wallet per network. It is used as the source and as your own recipient.",
      "Remove a wallet at any time. Signing out ends your session on this device.",
    ],
    open: { view: "settings", label: "Open Settings" },
  },
];

export function Guide({ onSelect }: { onSelect: (v: View) => void }) {
  const [id, setId] = useState(TOPICS[0].id);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? TOPICS.filter((x) => [x.title, x.summary, ...x.steps, ...(x.checks ?? [])].join(" ").toLowerCase().includes(t)) : TOPICS;
  }, [q]);
  const topic = TOPICS.find((t) => t.id === id) ?? TOPICS[0];
  const i = TOPICS.indexOf(topic);

  return (
    <div className="flex flex-col gap-6" data-guide>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-body-sm text-fg-2">How each part of SPak works, step by step.</p>
        <button onClick={startTour} className="type-button-sm min-h-9 rounded-control border border-line-strong px-3 text-fg hover:bg-secondary">Replay the tour</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Guide topics" className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
          <label className="sr-only" htmlFor="guide-search">Search the guide</label>
          <input id="guide-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guide"
            className="type-body-sm min-h-10 w-full rounded-control border border-line bg-elevated px-3 text-fg placeholder:text-fg-2 dark:bg-surface" />
          <label className="sr-only" htmlFor="guide-topic">Topic</label>
          <select id="guide-topic" value={topic.id} onChange={(e) => setId(e.target.value)} className="type-body-sm min-h-10 rounded-control border border-line bg-elevated px-3 text-fg lg:hidden dark:bg-surface">
            {list.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <ul className="hidden flex-col lg:flex">
            {list.map((t) => (
              <li key={t.id}>
                <button onClick={() => setId(t.id)} aria-current={t.id === topic.id ? "page" : undefined}
                  className={`type-body-sm flex min-h-10 w-full items-center rounded-control px-3 text-left ${t.id === topic.id ? "bg-secondary font-semibold text-fg" : "text-fg-2 hover:bg-secondary hover:text-fg"}`}>{t.title}</button>
              </li>
            ))}
            {list.length === 0 && <li className="type-body-sm px-3 py-2 text-fg-2">No topic matches “{q}”.</li>}
          </ul>
        </nav>

        <Card>
          <article aria-labelledby="guide-title" data-guide-topic={topic.id}>
            <p className="type-caption text-fg-2">{i + 1} of {TOPICS.length}</p>
            <h2 id="guide-title" className="type-app-subheading mt-1 text-fg">{topic.title}</h2>
            <p className="type-body mt-2 text-fg-2">{topic.summary}</p>
            <ol className="mt-5 flex flex-col gap-3">
              {topic.steps.map((s, n) => (
                <li key={s} className="type-body-sm flex gap-3 text-fg">
                  <span className="type-label flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary text-primary">{n + 1}</span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
            {topic.checks && (
              <div className="mt-6 border-t border-line pt-4">
                <p className="type-label text-fg">What SPak checks</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {topic.checks.map((c) => <li key={c} className="type-body-sm flex gap-2 text-fg-2"><Icon name="success" size={16} className="mt-0.5 shrink-0 text-primary" />{c}</li>)}
                </ul>
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {topic.open && <button onClick={() => onSelect(topic.open!.view)} className="type-button-sm min-h-10 rounded-control bg-primary px-4 text-on-primary">{topic.open.label}</button>}
              <span className="flex-1" />
              {i > 0 && <button onClick={() => setId(TOPICS[i - 1].id)} className="type-button-sm min-h-10 px-2 text-fg-2 hover:text-fg">Previous: {TOPICS[i - 1].title}</button>}
              {i < TOPICS.length - 1 && <button onClick={() => setId(TOPICS[i + 1].id)} className="type-button-sm min-h-10 px-2 text-fg hover:underline">Next: {TOPICS[i + 1].title}</button>}
            </div>
          </article>
        </Card>
      </div>
    </div>
  );
}
