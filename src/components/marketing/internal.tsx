/**
 * Visuals for the internal marketing pages (/how-it-works, /product). Same rules as art.tsx: palette tokens only,
 * the symbol's 51.8 degree diagonal and leaf, the approved landscape, structured diagrams of real behaviour.
 * Solid lines mean something works today; dashed lines mean it is planned. Words always say the same.
 */
import { getImageProps } from "next/image";
import { band } from "./art";

const LEAF = "M59.73 36.48C59.73 41.57 67.87 51.47 81.61 51.47C65.49 51.47 59.73 63.46 59.73 66.06Z";
const leafAt = (tx: number, ty: number, s: number) => `translate(${Math.round((tx - 81.61 * s) * 10) / 10} ${Math.round((ty - 51.47 * s) * 10) / 10}) scale(${s})`;
const LANDSCAPE = "/brand/images/spak-hero-landscape.png";

export type Status = "Live" | "Partly live" | "Planned";

/** Status in words with a shape: filled (live), half (partly live), hollow (planned). Never colour alone. */
export function StatusMark({ status, className = "" }: { status: Status; className?: string }) {
  const shape = status === "Live" ? "fill" : status === "Partly live" ? "half" : "none";
  return (
    <span className={`type-label inline-flex items-center gap-2 ${status === "Planned" ? "text-fg-2" : "text-fg"} ${className}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <circle cx="6" cy="6" r="5" fill={shape === "fill" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeDasharray={shape === "none" ? "2 2" : undefined} />
        {shape === "half" && <path d="M6 1a5 5 0 0 1 0 10Z" fill="currentColor" />}
      </svg>
      {status === "Planned" ? "Planned, not available yet" : status}
    </span>
  );
}

/**
 * /how-it-works opening. The landscape inside a diagonal band, with the path of a transfer drawn across it:
 * intent, plan, your approval (the leaf), settlement, verified delivery. Dotted until you approve, solid after.
 */
export function JourneyBand({ className = "" }: { className?: string }) {
  const src = getImageProps({ src: LANDSCAPE, alt: "", width: 1200, height: 600, quality: 80 }).props.src;
  const clip = band(250, 0, 350, 480);
  const path = { before: "M50 410H140L230 300H300", after: "M372 300L452 200H520L580 110" };
  return (
    <svg viewBox="0 0 640 480" className={`mkt-art jb ${className}`} role="img" aria-labelledby="jb-title">
      <title id="jb-title">A transfer drawn as one path: intent, plan, your approval, settlement through NEAR Intents, delivery verified by SPak.</title>
      <defs><clipPath id="jb-clip"><polygon points={clip} /></clipPath></defs>
      <image href={src} x="-120" y="0" width="960" height="480" preserveAspectRatio="xMidYMid slice" clipPath="url(#jb-clip)" />
      <g fill="none" strokeWidth="2" strokeLinejoin="round">
        <path d={path.before} stroke="var(--spak-brand-muted-sage)" strokeDasharray="2 7" strokeLinecap="round" />
        <path d={path.after} stroke="var(--spak-brand-warm-white)" />
      </g>
      <path d={LEAF} transform={leafAt(372, 300, 1.3)} fill="var(--spak-brand-warm-white)" />
      {[[50, 410], [140, 410], [452, 200]].map(([x, y]) => <circle key={`${x}`} cx={x} cy={y} r="6" fill="var(--spak-background)" stroke="var(--spak-brand-muted-sage)" strokeWidth="2" />)}
      <circle cx="580" cy="110" r="7" fill="var(--spak-brand-warm-white)" />
      <g className="jb-labels">
        <text x="40" y="444" className="t-on-forest">intent</text>
        <text x="120" y="444" className="t-on-forest">plan</text>
        <text x="300" y="342" className="t-on-forest">you approve</text>
        <text x="440" y="196" textAnchor="end" className="t-on-forest">NEAR Intents settles</text>
        <text x="600" y="92" textAnchor="end" className="t-on-forest">delivery verified</text>
      </g>
    </svg>
  );
}

/** Stage 2: the plan the engine emits for a cross-chain transfer, with who acts at each step. */
export function PlanSteps({ steps }: { steps: readonly (readonly [string, string])[] }) {
  return (
    <ol className="type-code-block overflow-x-auto border-l-2 border-primary pl-5 text-fg">
      {steps.map(([action, actor], i) => (
        <li key={action} className={`grid grid-cols-[2ch_15ch_1fr] gap-4 whitespace-nowrap py-1.5 ${actor === "USER_WALLET" ? "text-primary" : ""}`}>
          <span className="text-fg-2">{i + 1}</span><span>{action}</span><span className={actor === "USER_WALLET" ? "" : "text-fg-2"}>{actor}</span>
        </li>
      ))}
    </ol>
  );
}

/** Stage 6: coverage, as two lists. The difference is the point, so they are shown apart. */
export function CoverageLists({ verified, reviewed }: { verified: readonly string[]; reviewed: readonly string[] }) {
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <div>
        <p className="type-label text-fg">Verified on chain by SPak</p>
        <ul className="type-demo-label mt-3 flex flex-col gap-1.5 border-l-2 border-primary pl-4 text-fg">{verified.map((n) => <li key={n}>{n}</li>)}</ul>
      </div>
      <div>
        <p className="type-label text-fg-2">Manual review</p>
        <ul className="type-demo-label mt-3 flex flex-col gap-1.5 border-l-2 border-dashed border-line-strong pl-4 text-fg-2">{reviewed.map((n) => <li key={n}>{n}</li>)}</ul>
      </div>
    </div>
  );
}

/**
 * /product opening: the architecture as a flow, built in HTML so it reads at every width. Connect brings wallets in;
 * Intelligence understands; Guard holds the approval; NEAR Intents settles; SPak verifies. Agent and Conditional
 * Execution sit beside the flow; Payments is the flow used to pay someone.
 */
export function ArchitectureFlow() {
  const flow: { name: string; role: string; status: Status; href: string }[] = [
    { name: "Connect", role: "your wallets", status: "Partly live", href: "#connect" },
    { name: "Intelligence", role: "understands the instruction", status: "Partly live", href: "#intelligence" },
    { name: "Guard", role: "your approval and limits", status: "Partly live", href: "#guard" },
    { name: "NEAR Intents", role: "quotes and settles", status: "Live", href: "#guard" },
    { name: "Verification", role: "SPak reads the chain", status: "Partly live", href: "/how-it-works#verification" },
  ];
  return (
    <figure className="w-full">
      <div className="type-demo-label flex flex-wrap items-center gap-x-6 gap-y-2 text-fg-2">
        <span className="inline-flex items-center gap-2"><span className="inline-block h-0 w-8 border-t-2 border-primary" />live path</span>
        <span className="inline-flex items-center gap-2"><span className="inline-block h-0 w-8 border-t-2 border-dashed border-line-strong" />planned</span>
      </div>
      <ol className="mt-6 grid gap-0 md:grid-cols-5">
        {flow.map((f, i) => (
          <li key={f.name} className="relative border-l-2 border-primary py-4 pl-5 md:border-l-0 md:border-t-2 md:py-0 md:pl-0 md:pr-4 md:pt-5">
            <span aria-hidden="true" className="absolute -left-[7px] top-5 h-3 w-3 rounded-full bg-primary md:-top-[7px] md:left-0" />
            <a href={f.href} className="type-heading-feature block text-fg transition-colors hover:text-primary">{f.name}</a>
            <p className="type-body-sm mt-1 text-fg-2">{f.role}</p>
            {i === 2 && <p className="type-demo-label mt-2 text-primary">nothing moves before this</p>}
          </li>
        ))}
      </ol>
      <div className="mt-8 grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
        <a href="#agent" className="block"><span className="type-label text-fg">Agent</span><span className="type-body-sm block text-fg-2">a NEAR identity beside your account</span></a>
        <a href="#payments" className="block"><span className="type-label text-fg">Payments</span><span className="type-body-sm block text-fg-2">the same path, to someone else</span></a>
        <a href="#conditional" className="block border-l-2 border-dashed border-line-strong pl-3"><span className="type-label text-fg-2">Conditional Execution</span><span className="type-body-sm block text-fg-2">would start the path on a time or price</span></a>
      </div>
      <figcaption className="sr-only">SPak architecture: Connect, Intelligence, Guard, NEAR Intents and verification in order, with Agent, Payments and Conditional Execution beside them.</figcaption>
    </figure>
  );
}

/** Intelligence: one real instruction, taken apart the way the engine reads it. */
export function ParseDiagram() {
  const words: { w: string; tag?: string }[] = [
    { w: "Swap" }, { w: "50", tag: "amount" }, { w: "USDC", tag: "asset" }, { w: "on" }, { w: "Base", tag: "network" },
    { w: "to" }, { w: "SOL", tag: "asset" }, { w: "on" }, { w: "Solana", tag: "network" },
  ];
  return (
    <figure>
      <p className="flex flex-wrap gap-x-3 gap-y-6">
        {words.map((x, i) => (
          <span key={i} className="inline-flex flex-col">
            <span className={`type-heading-section ${x.tag ? "text-fg" : "text-fg-2"}`}>{x.w}</span>
            <span className={`type-demo-label mt-1 border-t-2 pt-1 ${x.tag ? "border-primary text-primary" : "border-transparent text-transparent"}`} aria-hidden={!x.tag}>{x.tag ?? "."}</span>
          </span>
        ))}
      </p>
      <p className="type-demo-label mt-8 border-l-2 border-primary pl-4 text-fg">intent: CROSS_CHAIN_SWAP · status: VALIDATED · recipient: your connected Solana wallet</p>
      <figcaption className="type-demo-label mt-3 text-fg-2">How SPak reads an instruction. Fixed rules, no language model: the same sentence always gives the same plan.</figcaption>
    </figure>
  );
}

/** Agent and Connect: wallets join one account (live); one NEAR wallet is marked as the agent (live); the agent acting within limits is planned. */
export function AccountDiagram({ className = "" }: { className?: string }) {
  const wallets = [["EVM wallet", 70], ["Solana wallet", 170], ["NEAR wallet", 270]] as const;
  return (
    <svg viewBox="0 0 700 340" className={`mkt-art ${className}`} role="img" aria-labelledby="acc-title">
      <title id="acc-title">EVM, Solana and NEAR wallets connect to one SPak account. The NEAR wallet is marked as the agent identity. The agent acting within your limits is planned.</title>
      <g fill="none" strokeWidth="2">
        {wallets.map(([, y]) => <path key={y} d={`M150 ${y}H190L230 170H260`} stroke="var(--art-line)" />)}
        <path d="M380 170H420L440 270H470" stroke="var(--art-line)" />
        <path d="M470 270H520" stroke="var(--art-rule-strong)" strokeDasharray="4 6" />
      </g>
      {wallets.map(([label, y]) => (
        <g key={label}><circle cx="140" cy={y} r="6" fill="var(--art-paper)" stroke="var(--art-line)" strokeWidth="2" /><text x="126" y={y + 5} textAnchor="end" className="t-strong">{label}</text></g>
      ))}
      <polygon points={band(290, 140, 110, 60)} fill="var(--spak-primary)" />
      <text x="290" y="221" className="t-strong" textAnchor="middle">your SPak account</text>
      <circle cx="470" cy="270" r="7" fill="var(--art-line)" />
      <text x="460" y="304" textAnchor="end" className="t-strong">agent identity</text>
      <circle cx="530" cy="270" r="7" fill="var(--art-paper)" stroke="var(--art-rule-strong)" strokeWidth="2" strokeDasharray="3 3" />
      <text x="548" y="304">acts within limits</text>
      <text x="548" y="320">(planned)</text>
      <text x="20" y="20">SPak Connect: live</text>
      <text x="690" y="20" textAnchor="end">SPak Agent: link live</text>
    </svg>
  );
}

/** Payments: you pay from what you hold; the address is checked against the destination before any quote. */
export function PaymentDiagram({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 260" className={`mkt-art ${className}`} role="img" aria-labelledby="pay-title">
      <title id="pay-title">You send USDC on Base. SPak checks the recipient address fits Solana before any quote. The recipient receives SOL on Solana, and SPak verifies the delivery.</title>
      <polygon points={band(150, 30, 120, 70)} fill="var(--art-soft)" />
      <polygon points={band(470, 140, 150, 80)} fill="var(--spak-primary)" />
      <path d="M60 80H180L262 180H470" fill="none" stroke="var(--art-line)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="60" cy="80" r="6" fill="var(--art-paper)" stroke="var(--art-line)" strokeWidth="2" />
      <circle cx="470" cy="180" r="7" fill="var(--spak-on-primary)" />
      <text x="40" y="58" className="t-strong">you send USDC</text>
      <text x="40" y="104">on Base</text>
      <g transform="translate(262 180)"><circle r="16" fill="var(--art-paper)" stroke="var(--art-line)" strokeWidth="2" /><path d="M-7 0l5 5 9-10" fill="none" stroke="var(--art-line)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g>
      <text x="262" y="226" textAnchor="middle" className="t-strong">address fits Solana</text>
      <text x="262" y="244" textAnchor="middle">checked before any quote</text>
      <text x="520" y="132" textAnchor="end" className="t-strong">recipient gets SOL</text>
    </svg>
  );
}

/** Conditional Execution: drawn entirely dashed. Nothing on this diagram runs today. */
export function ConditionalDiagram({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 220" className={`mkt-art ${className}`} role="img" aria-labelledby="cond-title">
      <title id="cond-title">Planned: a schedule or a price condition would start a transfer, which would still go through your approval. None of this runs today.</title>
      <g fill="none" stroke="var(--art-rule-strong)" strokeWidth="2" strokeDasharray="4 6" strokeLinecap="round">
        <path d="M40 150H520" />
        <path d="M120 150V70M260 150V100M400 150V60" />
        <circle cx="120" cy="60" r="10" /><circle cx="260" cy="90" r="10" /><circle cx="400" cy="50" r="10" />
      </g>
      <text x="40" y="190">time or price</text>
      <text x="520" y="190" textAnchor="end">each run: your approval</text>
      <text x="280" y="30" textAnchor="middle" className="t-strong">planned: nothing here runs today</text>
    </svg>
  );
}
