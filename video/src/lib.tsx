import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const C = { green: "#174734", white: "#F7F6F0", graphite: "#222724", sage: "#A7B7A9", soft: "#E8EFE9", deepSage: "#5A6D5C", light: "#9CD7BF", paper: "#FFFFFF" };
export const F = { display: "Sora, sans-serif", text: "'Inter Variable', Inter, sans-serif", mono: "'JetBrains Mono Variable', monospace" };
export const ease = Easing.bezier(0.65, 0, 0.35, 1);
export const out = Easing.bezier(0.16, 1, 0.3, 1);
export const sec = (s: number) => Math.round(s * 30);

/** 0..1 progress between two frames with an easing curve, clamped. */
export const prog = (f: number, a: number, b: number, e = out) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });

/** Kinetic headline: words rise out of a mask one after another. */
export function Kinetic({ text, at = 0, size = 96, color = C.graphite, weight = 600, stagger = 3, font = F.display, align = "center", highlight }: {
  text: string; at?: number; size?: number; color?: string; weight?: number; stagger?: number; font?: string; align?: "center" | "left"; highlight?: string[];
}) {
  const f = useCurrentFrame();
  const words = text.split(" ");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", gap: `0 ${size * 0.26}px`, fontFamily: font, fontSize: size, fontWeight: weight, letterSpacing: -size * 0.03, lineHeight: 1.08, color }}>
      {words.map((w, i) => {
        const p = prog(f, at + i * stagger, at + i * stagger + 14);
        const hi = highlight?.includes(w.replace(/[.,]/g, ""));
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.12 }}>
            <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 110}%)`, color: hi ? C.green : undefined }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Small provenance label, always visible on product footage. */
export function Label({ children, at = 0, dark = false, style }: { children: React.ReactNode; at?: number; dark?: boolean; style?: React.CSSProperties }) {
  const f = useCurrentFrame();
  const p = prog(f, at, at + 12);
  return (
    <div style={{ position: "absolute", display: "inline-flex", alignItems: "center", gap: 10, padding: "9px 16px", borderRadius: 999, fontFamily: F.text, fontSize: 21, fontWeight: 500,
      background: dark ? "rgba(34,39,36,0.86)" : "rgba(247,246,240,0.94)", color: dark ? C.white : C.graphite, border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(23,71,52,0.22)"}`,
      opacity: p, transform: `translateY(${(1 - p) * 10}px)`, ...style }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: dark ? C.light : C.green }} />{children}
    </div>
  );
}

/** Caption block over footage: a short line, optionally with a kicker. */
export function Caption({ kicker, title, at, x = 96, y = 820, w = 760 }: { kicker?: string; title: string; at: number; x?: number; y?: number; w?: number }) {
  const f = useCurrentFrame();
  const p = prog(f, at, at + 14);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, padding: "22px 28px", borderRadius: 18, background: C.graphite, color: C.white, boxShadow: "0 24px 60px rgba(34,39,36,0.28)",
      opacity: p, transform: `translateY(${(1 - p) * 24}px)`, clipPath: `inset(0 ${(1 - p) * 100}% 0 0 round 18px)` }}>
      {kicker && <div style={{ fontFamily: F.text, fontSize: 19, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: C.light, marginBottom: 8 }}>{kicker}</div>}
      <div style={{ fontFamily: F.display, fontSize: 36, fontWeight: 600, letterSpacing: -0.6, lineHeight: 1.18 }}>{title}</div>
    </div>
  );
}

export type Cam = { t: number; x: number; y: number; s: number };
/** Interpolated camera over a 3840x2160 capture shown in a 1920x1080 window. x,y: focal point (0..1); s: zoom. */
function camAt(keys: Cam[], f: number) {
  if (f <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (f <= b.t) { const p = interpolate(f, [a.t, b.t], [0, 1], { easing: ease }); return { t: f, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, s: a.s + (b.s - a.s) * p }; }
  }
  return keys[keys.length - 1];
}

/**
 * A real product capture with a camera. Children are laid out in capture coordinates (percent of the frame), so
 * highlights move with the camera. `drift` adds a slow push so a still never sits dead.
 */
export function Shot({ src, cam, children, W = 1920, H = 1080, drift = 0.015, radius = 0 }: { src: string; cam: Cam[]; children?: React.ReactNode; W?: number; H?: number; drift?: number; radius?: number }) {
  const f = useCurrentFrame();
  const c = camAt(cam, f);
  const s = Math.max(1, c.s * (1 + drift * (f / 300)));
  const tx = Math.min(0, Math.max(W - W * s, W / 2 - c.x * W * s));
  const ty = Math.min(0, Math.max(H - H * s, H / 2 - c.y * H * s));
  return (
    <div style={{ position: "absolute", inset: 0, width: W, height: H, overflow: "hidden", borderRadius: radius, background: C.white }}>
      <div style={{ position: "absolute", width: W, height: H, transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: "0 0" }}>
        <Img src={staticFile(src)} style={{ width: W, height: H, display: "block" }} />
        {children}
      </div>
    </div>
  );
}

/** Outline drawn around a region of a capture (percent coordinates), traced on. */
export function Box({ x, y, w, h, at, color = C.green, r = 10 }: { x: number; y: number; w: number; h: number; at: number; color?: string; r?: number }) {
  const f = useCurrentFrame();
  const p = prog(f, at, at + 16);
  const per = 2 * (w * 19.2 + h * 10.8);
  return (
    <svg style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, overflow: "visible" }} viewBox={`0 0 ${w * 19.2} ${h * 10.8}`} preserveAspectRatio="none">
      <rect x={-4} y={-4} width={w * 19.2 + 8} height={h * 10.8 + 8} rx={r} fill="none" stroke={color} strokeWidth={4} strokeDasharray={per + 40} strokeDashoffset={(1 - p) * (per + 40)} />
    </svg>
  );
}

/** A browser window around footage, with the real URL in the bar. */
export function Window({ url, children, scale = 0.86, at = 0, from = 1.06 }: { url: string; children: React.ReactNode; scale?: number; at?: number; from?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sp = spring({ frame: f - at, fps, config: { damping: 200, mass: 0.9 } });
  const s = scale * (from + (1 - from) * sp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 1920, height: 1080 + 56, transform: `scale(${s})`, borderRadius: 22, overflow: "hidden", boxShadow: "0 50px 120px rgba(23,71,52,0.22), 0 0 0 1px rgba(23,71,52,0.12)", background: C.paper, opacity: Math.min(1, sp * 1.6) }}>
        <div style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 22px", background: "#EFEEE7", borderBottom: "1px solid #E1E0D8" }}>
          {["#E8E7DF", "#E8E7DF", "#E8E7DF"].map((c, i) => <span key={i} style={{ width: 14, height: 14, borderRadius: 7, background: c, border: "1px solid #D5D4CC" }} />)}
          <div style={{ marginLeft: 18, flex: 1, maxWidth: 760, height: 34, borderRadius: 17, background: C.paper, border: "1px solid #E1E0D8", display: "flex", alignItems: "center", padding: "0 18px", fontFamily: F.text, fontSize: 19, color: C.deepSage }}>{url}</div>
        </div>
        <div style={{ position: "relative", width: 1920, height: 1080 }}>{children}</div>
      </div>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------------------------------------ network map
export const NETS = [
  { id: "ethereum", name: "Ethereum", a: -150 }, { id: "base", name: "Base", a: -110 }, { id: "arbitrum", name: "Arbitrum", a: -70 },
  { id: "optimism", name: "Optimism", a: -30 }, { id: "polygon", name: "Polygon", a: 10 }, { id: "bsc", name: "BNB Chain", a: 50 },
  { id: "avalanche", name: "Avalanche", a: 90 }, { id: "gnosis", name: "Gnosis", a: 130 }, { id: "solana", name: "Solana", a: 170 },
];
export const nodePos = (a: number, r: number, cx = 960, cy = 540) => ({ x: cx + Math.cos((a * Math.PI) / 180) * r, y: cy + Math.sin((a * Math.PI) / 180) * r * 0.78 });
