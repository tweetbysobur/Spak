/**
 * Original SPak compositions (brand guidelines, section 5). Geometry comes from the approved symbol:
 * diagonals at 51.8 degrees (dx/dy 0.786), flat-topped bands, and the concave leaf. Palette tokens only.
 * These are illustrations of the visual language. None of them is a logo.
 */
import { STEPS } from "@/marketing/content";

/** dx per unit of dy for the symbol's 51.8 degree diagonal. */
export const K = 0.786;
/** The leaf from the approved symbol path (symbol units, 113.6 x 100). Flat edge at x 59.73, tip at 81.61, 51.47. */
const LEAF = "M59.73 36.48C59.73 41.57 67.87 51.47 81.61 51.47C65.49 51.47 59.73 63.46 59.73 66.06Z";
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Flat-topped parallelogram leaning like the symbol's bands. */
export function band(x: number, y: number, w: number, h: number): string {
  return `${r1(x)},${y} ${r1(x + w)},${y} ${r1(x + w - K * h)},${y + h} ${r1(x - K * h)},${y + h}`;
}
/** The leaf scaled by s with its tip at (tx, ty). */
function leafTransform(tx: number, ty: number, s: number) {
  return `translate(${r1(tx - 81.61 * s)} ${r1(ty - 51.47 * s)}) scale(${s})`;
}

/** Halftone field: 12 px grid, radius 0.4 to 4.6, growing along the 51.8 degree direction. */
function Halftone({ x, y, cols, rows, flip = false, fill = "var(--art-rule-strong)" }: { x: number; y: number; cols: number; rows: number; flip?: boolean; fill?: string }) {
  const dots: React.ReactNode[] = [];
  const max = cols + rows * K;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const t = (i + (rows - j) * K) / max;
    const u = flip ? 1 - t : t;
    const r = r1(0.4 + 4.2 * u * u);
    if (r >= 0.5) dots.push(<circle key={`${i}-${j}`} cx={x + i * 12} cy={y + j * 12} r={r} />);
  }
  return <g fill={fill}>{dots}</g>;
}

/**
 * Hero. One path from an intent to a verified delivery. It stops at the leaf, the single point where the user
 * approves, then crosses onto the destination band.
 */
export function HeroComposition({ className = "" }: { className?: string }) {
  const a = band(430, 30, 190, 150);
  const before = "M30 410H140L257.9 260H285";
  const after = "M381.3 260H400L502.2 130H566";
  const k = { ["--k" as string]: K };
  return (
    <svg viewBox="0 0 640 520" className={`mkt-art mkt-art-lg ${className}`} role="img" aria-labelledby="hero-art-title hero-art-desc">
      <title id="hero-art-title">One path from intent to verified delivery</title>
      <desc id="hero-art-desc">A line starts at a point labelled intent, rises to a leaf shape labelled you approve, and continues across a green band to a point labelled delivery verified.</desc>
      <defs><clipPath id="hero-band-a"><polygon points={a} /></clipPath></defs>
      <g className="hero-fade" style={{ ["--d" as string]: "900ms" }}><Halftone x={446} y={338} cols={16} rows={14} /></g>
      <polygon className="hero-band" style={{ ...k, ["--d" as string]: "0ms" }} points={band(190, 300, 330, 190)} fill="var(--art-soft)" />
      <polygon className="hero-band" style={{ ...k, ["--d" as string]: "120ms" }} points={band(205, 80, 56, 170)} fill="var(--art-sage)" />
      <g className="hero-band" style={{ ...k, ["--d" as string]: "240ms" }}>
        <polygon points={a} fill="var(--art-forest)" />
        <polygon points={band(575, 30, 45, 150)} fill="var(--art-tone)" />
      </g>
      <g fill="none" strokeWidth="2" strokeLinejoin="round">
        <path className="hero-path" pathLength={1} d={before} stroke="var(--art-line)" />
        <path className="hero-path" pathLength={1} d={after} stroke="var(--art-line)" />
        <path className="hero-path" pathLength={1} d={after} stroke="var(--art-on-forest)" clipPath="url(#hero-band-a)" />
      </g>
      <path className="hero-fade" style={{ ["--d" as string]: "1300ms" }} d={LEAF} transform={leafTransform(381.3, 260, 4.4)} fill="var(--art-line)" />
      <g className="hero-fade" style={{ ["--d" as string]: "500ms" }}>
        <circle cx="30" cy="410" r="6" fill="var(--art-paper)" stroke="var(--art-line)" strokeWidth="2" />
        <text x="20" y="442">intent</text>
      </g>
      <g className="hero-fade" style={{ ["--d" as string]: "1500ms" }}>
        <text x="92" y="394" textAnchor="middle">plan</text>
        <text x="333" y="350" textAnchor="middle" className="t-strong">you approve</text>
      </g>
      <g className="hero-fade" style={{ ["--d" as string]: "2000ms" }}>
        <circle cx="566" cy="130" r="6" fill="var(--art-line)" />
        <text x="636" y="162" textAnchor="end" className="t-strong">delivery</text>
        <text x="636" y="182" textAnchor="end" className="t-strong">verified</text>
      </g>
      <circle className="hero-runner" r="4" fill="var(--art-line)" style={{ offsetPath: `path("${before}H381.3${after.slice(after.indexOf("H"))}")` }} />
    </svg>
  );
}

/**
 * How SPak works, as a lane diagram: who acts at each step. The line is dashed while nothing has moved and
 * solid once the user has approved and signed. Step order and actors come from STEPS.
 */
export function ExecutionLanes({ className = "" }: { className?: string }) {
  const lanes = [{ name: "You", y: 56 }, { name: "SPak", y: 146 }, { name: "NEAR Intents", y: 236 }];
  const y = (lane: string) => lanes.find((l) => l.name === lane)!.y;
  // Nodes sit at the left edge of the five text columns below the diagram (column plus gap = 20.56% of the width).
  const pts = STEPS.map((s, i) => ({ ...s, x: 8 + i * 205.6, y: y(s.lane) }));
  const seg = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = Math.abs(to.y - from.y) * K;
    const mid = (from.x + to.x) / 2;
    return `M${from.x} ${from.y}H${r1(mid - dx / 2)}L${r1(mid + dx / 2)} ${to.y}H${to.x}`;
  };
  return (
    <svg viewBox="0 0 1000 292" className={`mkt-art ${className}`} aria-hidden="true" focusable="false">
      {lanes.map((l) => (
        <g key={l.name}>
          <line x1="0" x2="1000" y1={l.y} y2={l.y} stroke="var(--art-rule)" strokeWidth="1" />
          <text x="1000" y={l.y - 12} textAnchor="end">{l.name}</text>
        </g>
      ))}
      <g fill="none" stroke="var(--art-line)" strokeWidth="2" strokeLinejoin="round">
        {pts.slice(0, -1).map((p, i) => <path key={p.id} d={seg(p, pts[i + 1])} strokeDasharray={pts[i + 1].moves ? undefined : "2 7"} strokeLinecap={pts[i + 1].moves ? undefined : "round"} />)}
      </g>
      {pts.map((p) => p.id === "approval"
        ? <g key={p.id}><circle cx={p.x} cy={p.y} r="26" fill="var(--art-paper)" /><path d={LEAF} transform={leafTransform(p.x + 20, p.y, 1.9)} fill="var(--art-line)" /></g>
        : <circle key={p.id} cx={p.x} cy={p.y} r="6" fill={p.moves ? "var(--art-line)" : "var(--art-paper)"} stroke="var(--art-line)" strokeWidth="2" />)}
      <text x="0" y="282">dotted: nothing has moved · solid: after your approval and signature</text>
    </svg>
  );
}

/**
 * Cross-chain route. One solid path: your wallet, the deposit address, the recipient. One dotted path: the refund
 * route, which returns to the wallet that sent the deposit (docs/SPAK-FAILURE-REFUNDS.md).
 */
export function RouteDiagram({ className = "" }: { className?: string }) {
  const dest = band(246, 232, 150, 96);
  return (
    <svg viewBox="0 0 400 350" className={`mkt-art ${className}`} role="img" aria-labelledby="route-title route-desc">
      <title id="route-title">Route of a cross-chain transfer</title>
      <desc id="route-desc">A solid line runs from your wallet on the source network to a deposit address held by NEAR Intents, then to the recipient on the destination network. A dotted line shows the refund route from the deposit address back to your wallet.</desc>
      <defs><clipPath id="route-dest"><polygon points={dest} /></clipPath></defs>
      <polygon points={band(96, 12, 150, 96)} fill="var(--art-soft)" />
      <polygon points={dest} fill="var(--art-forest)" />
      <path d="M206.5 170H136.5L50 60" fill="none" stroke="var(--art-line)" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
      <path d="M50 60H120L206.5 170H226L312.5 280H336" fill="none" stroke="var(--art-line)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 60H120L206.5 170H226L312.5 280H336" fill="none" stroke="var(--art-on-forest)" strokeWidth="2" strokeLinejoin="round" clipPath="url(#route-dest)" />
      <circle cx="50" cy="60" r="6" fill="var(--art-paper)" stroke="var(--art-line)" strokeWidth="2" />
      <circle cx="206.5" cy="170" r="6" fill="var(--art-paper)" stroke="var(--art-line)" strokeWidth="2" />
      <circle cx="336" cy="280" r="6" fill="var(--art-on-forest)" />
      <text x="40" y="34" className="t-strong">your wallet</text>
      <text x="150" y="52">source network</text>
      <text x="224" y="152" className="t-strong">deposit address</text>
      <text x="224" y="134">NEAR Intents</text>
      <text x="40" y="196">refund route</text>
      <text x="330" y="310" textAnchor="end" className="t-on-forest">recipient</text>
      <text x="246" y="346" textAnchor="middle">destination network</text>
    </svg>
  );
}

/** Halftone field around the leaf: what SPak has read on chain (dense) fading to what it has not (sparse). */
export function EvidenceField({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 360" className={`mkt-art ${className}`} aria-hidden="true" focusable="false">
      <Halftone x={6} y={6} cols={30} rows={30} fill="var(--art-ink)" />
      <path d={LEAF} transform={leafTransform(300, 180, 9)} fill="var(--art-paper)" stroke="var(--art-paper)" strokeWidth="2.6" />
      <path d={LEAF} transform={leafTransform(300, 180, 9)} fill="var(--art-line)" />
    </svg>
  );
}

/** Diagonal band field for the Forest Green block (two close greens, per the guidelines). */
export function BandField({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 320" className={className} aria-hidden="true" focusable="false" preserveAspectRatio="xMaxYMid slice">
      {[0, 1, 2, 3, 4].map((i) => <polygon key={i} points={band(250 + i * 110, 0, 60, 320)} fill="var(--art-tone)" />)}
    </svg>
  );
}
