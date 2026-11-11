import type { Metadata } from "next";
import Link from "next/link";
import colors from "@/design/colors.json";
import { NETWORKS } from "@/spak-in/registries/networks";
import { StatusBadge } from "@/components/status";
import { CtaLink } from "@/components/marketing/site";
import { OG_IMAGE, SITE, VERIFIED_FAMILIES } from "@/marketing/content";

export const metadata: Metadata = {
  title: "Documentation",
  description: "How to use SPak: writing instructions, quotes and approval, deposits, execution states, on-chain verification coverage, failures and refunds.",
  alternates: { canonical: "/docs" },
  openGraph: { type: "website", siteName: SITE.name, images: [OG_IMAGE], url: "/docs", title: "SPak documentation", description: "Instructions, approval, states, verification coverage, failures and refunds." },
};

const TOC = [
  ["start", "Getting started"], ["instructions", "Writing instructions"], ["approval", "Quotes and approval"], ["states", "Execution states"],
  ["networks", "Networks and verification"], ["refunds", "Failures and refunds"], ["limits", "Not built yet"],
] as const;

/** One line per execution state. The states and their status roles come from src/design/colors.json (stateRoles). */
const STATE_MEANING: Record<string, string> = {
  DRAFT: "A plan exists. No quote yet.",
  QUOTED: "An estimate is available to review.",
  AWAITING_APPROVAL: "A firm quote is waiting for your approval.",
  AWAITING_DEPOSIT: "Approved. Waiting for your wallet to send the deposit.",
  PROCESSING: "The deposit is confirmed, or NEAR Intents reports the transfer in progress.",
  VERIFYING_DESTINATION: "NEAR Intents reported a delivery. SPak is reading the destination chain.",
  COMPLETED: "SPak verified on chain that the recipient received at least the approved minimum.",
  FAILED: "NEAR Intents reported that the transfer failed. SPak keeps watching for a refund.",
  REFUNDING: "NEAR Intents reported a refund. SPak is verifying it on chain.",
  REFUNDED: "A refund to your wallet is verified on chain and linked to this transfer.",
  EXPIRED: "The deadline passed with no confirmed deposit.",
  CANCELLED: "You cancelled before sending a deposit.",
  UNKNOWN: "SPak could not confirm the outcome. A manual review may be open.",
};
const STATE_ORDER = ["DRAFT", "QUOTED", "AWAITING_APPROVAL", "AWAITING_DEPOSIT", "PROCESSING", "VERIFYING_DESTINATION", "COMPLETED", "FAILED", "REFUNDING", "REFUNDED", "EXPIRED", "CANCELLED", "UNKNOWN"]
  .filter((s) => s in colors.stateRoles.execution);

const H2 = "type-heading-section text-fg";
const P = "type-body mt-4 text-fg-2";
const LI = "type-body text-fg-2";

export default function DocsPage() {
  return (
    <div className="mkt-wrap grid gap-12 pb-24 pt-14 md:pt-20 lg:grid-cols-[14rem_1fr] lg:gap-20">
      <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
        <h2 className="type-label text-fg">On this page</h2>
        <ul className="mt-3 flex flex-col gap-1">
          {TOC.map(([id, label]) => <li key={id}><a href={`#${id}`} className="type-body-sm inline-block py-1 text-fg-2 transition-colors hover:text-fg">{label}</a></li>)}
        </ul>
      </nav>

      <article className="min-w-0 max-w-[44rem]">
        <h1 className="type-display-lg text-fg">Documentation</h1>
        <p className="type-lead mt-5 text-fg-2">How SPak behaves, written from the code as it is today.</p>

        <section id="start" className="mt-16">
          <h2 className={H2}>Getting started</h2>
          <ol className="mt-5 flex list-decimal flex-col gap-3 pl-5">
            <li className={LI}>Open the app and choose a wallet. EVM, Solana and NEAR wallets are supported.</li>
            <li className={LI}>Sign the one-time message. This proves you control the wallet. It is not a transaction and costs nothing.</li>
            <li className={LI}>Write an instruction, or use the Manual Swap form.</li>
            <li className={LI}>Review the estimate, then request the firm quote.</li>
            <li className={LI}>Tick the approval box and approve. SPak shows the deposit to send.</li>
            <li className={LI}>Sign the deposit in your wallet. SPak verifies it and tracks the transfer.</li>
          </ol>
          <CtaLink href={SITE.appPath} className="mt-8">Launch SPak</CtaLink>
        </section>

        <section id="instructions" className="mt-20">
          <h2 className={H2}>Writing instructions</h2>
          <p className={P}>Name the amount, the asset you hold, its network, and what should arrive where. For example:</p>
          <pre className="type-code-block mt-5 overflow-x-auto rounded-card border border-line bg-surface p-5 text-fg"><code>Swap 50 USDC on Base to SOL on Solana</code></pre>
          <ul className="mt-5 flex list-disc flex-col gap-3 pl-5">
            <li className={LI}>If the destination needs an address SPak does not have, it asks for one. Connect a wallet for that network or include the address.</li>
            <li className={LI}>If an instruction can be read two ways, SPak asks which you mean. It never fills a gap with a guess.</li>
            <li className={LI}>An address is checked against the destination network before any quote is requested.</li>
            <li className={LI}>Only exact amounts can execute. Percentages of a balance and amounts in dollars are understood and cannot run yet.</li>
          </ul>
        </section>

        <section id="approval" className="mt-20">
          <h2 className={H2}>Quotes and approval</h2>
          <p className={P}>The first quote is an estimate. The firm quote is the provider&apos;s committed terms for one deposit address. It shows what you send, the minimum you receive after slippage, each fee, the recipient, the refund address and the deadline.</p>
          <ul className="mt-5 flex list-disc flex-col gap-3 pl-5">
            <li className={LI}>Only a firm quote can be approved, and it must be approved within 10 minutes.</li>
            <li className={LI}>The expected output is not guaranteed. The minimum is the worst case.</li>
            <li className={LI}>A new quote or a cancel invalidates the approval.</li>
            <li className={LI}>Each transfer has a value cap. A transfer SPak cannot price is refused.</li>
            <li className={LI}>Approval does not move funds. Your wallet still asks you to sign the deposit.</li>
          </ul>
        </section>

        <section id="states" className="mt-20">
          <h2 className={H2}>Execution states</h2>
          <p className={P}>Every transfer is in exactly one of these states. The app shows the same labels.</p>
          <dl className="mt-6">
            {STATE_ORDER.map((s) => (
              <div key={s} className="grid gap-2 border-t border-line py-4 sm:grid-cols-[15rem_1fr] sm:items-center sm:gap-6">
                <dt><StatusBadge state={s} /></dt>
                <dd className={LI}>{STATE_MEANING[s]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="networks" className="mt-20">
          <h2 className={H2}>Networks and verification</h2>
          <p className={P}>SPak verifies deposits and deliveries by reading the chain itself, where it can. On the other networks a delivery cannot be confirmed automatically, so the transfer goes to manual review and is not marked Completed.</p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="type-label py-3 pr-6 text-fg-2">Network</th>
                  <th scope="col" className="type-label py-3 pr-6 text-fg-2">Native asset</th>
                  <th scope="col" className="type-label py-3 text-fg-2">Deposit and delivery check</th>
                </tr>
              </thead>
              <tbody>
                {NETWORKS.map((n) => {
                  const ok = (VERIFIED_FAMILIES as readonly string[]).includes(n.family);
                  return (
                    <tr key={n.id} className="border-b border-line">
                      <th scope="row" className="type-body py-3 pr-6 font-medium text-fg">{n.name}</th>
                      <td className="type-body py-3 pr-6 text-fg-2">{n.nativeSymbol}</td>
                      <td className={`type-body py-3 ${ok ? "text-fg" : "text-fg-2"}`}>{ok ? "Verified on chain by SPak" : "Manual review"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={P}>SPak does not verify the settlement steps between deposit and delivery. For those it relies on the status NEAR Intents reports.</p>
        </section>

        <section id="refunds" className="mt-20">
          <h2 className={H2}>Failures and refunds</h2>
          <ul className="mt-5 flex list-disc flex-col gap-3 pl-5">
            <li className={LI}>A delay is not a failure. Failed is shown only when NEAR Intents reports it.</li>
            <li className={LI}>Refunds are automatic and sent by NEAR Intents to the wallet that made the deposit. There is nothing to sign and no refund button.</li>
            <li className={LI}>A refund can be partial, and a refund fee can apply. The firm quote shows the fee.</li>
            <li className={LI}>NEAR Intents reports a refunded amount and does not identify the refund transaction. SPak looks for a matching transfer on the source chain.</li>
            <li className={LI}>Refunded is shown only when a transfer back to you is verified on chain and linked to your transfer. A transfer that merely looks right is held for manual review.</li>
            <li className={LI}>A transfer with a submitted or confirmed deposit cannot be cancelled.</li>
          </ul>
        </section>

        <section id="limits" className="mt-20">
          <h2 className={H2}>Not built yet</h2>
          <ul className="mt-5 flex list-disc flex-col gap-3 pl-5">
            <li className={LI}>Portfolio balances and prices.</li>
            <li className={LI}>Scheduled, conditional and rebalancing transfers. SPak understands them and does not run them.</li>
            <li className={LI}>Saved Guard settings such as daily limits and approved recipients.</li>
            <li className={LI}>Execution by the agent without your approval. Every transfer needs you.</li>
            <li className={LI}>A public API and SDK. See <Link href="/developers" className="text-primary underline underline-offset-4">Developers</Link>.</li>
          </ul>
        </section>
      </article>
    </div>
  );
}
