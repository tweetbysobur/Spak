import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import "@fontsource/sora/600.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import T from "./timeline.json";
import VO from "./voice.json";
import { Box, C, Caption, F, Kinetic, Label, NETS, Shot, Window, ease, nodePos, out, prog, sec } from "./lib";

const S = Object.fromEntries(T.scenes.map((s) => [s.id, { from: sec(s.from), dur: sec(s.to) - sec(s.from) }])) as Record<string, { from: number; dur: number }>;
const APP_LABEL = "Real product · preview build of the SPak app · simulated wallet, no funds";

// ============================================================================================ 1. The problem
const FRICTION = ["Which bridge?", "Wrong network", "Token not supported", "Gas on the source chain?", "Copy the deposit address", "Compare fees", "Switch wallets", "Did it arrive?"];
const SCATTER = [[310, 300], [720, 210], [1180, 250], [1600, 330], [1650, 700], [1250, 860], [720, 820], [330, 720], [1010, 960], [960, 540]];
function Problem() {
  const f = useCurrentFrame();
  const collapse = prog(f, 318, 356, ease);
  const shake = (i: number) => (f > 200 && f < 318 ? Math.sin((f + i * 7) * 0.9) * 3 : 0);
  return (
    <AbsoluteFill style={{ background: C.white }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {SCATTER.map(([x, y], i) => SCATTER.slice(i + 1).filter((_, j) => (i + j) % 3 === 0).map(([x2, y2], j) => {
          const p = prog(f, 14 + i * 3, 50 + i * 3);
          const mx = (x + x2) / 2 + (i % 2 ? 160 : -160), my = (y + y2) / 2 + (j % 2 ? -120 : 120);
          const cx = 960 + (x - 960) * (1 - collapse), cy = 540 + (y - 540) * (1 - collapse);
          const cx2 = 960 + (x2 - 960) * (1 - collapse), cy2 = 540 + (y2 - 540) * (1 - collapse);
          return <path key={`${i}-${j}`} d={`M${cx},${cy} Q${960 + (mx - 960) * (1 - collapse)},${540 + (my - 540) * (1 - collapse)} ${cx2},${cy2}`} fill="none" stroke={f > 200 ? "#B9C4BA" : C.sage} strokeWidth={2} strokeDasharray="1400" strokeDashoffset={1400 * (1 - p)} opacity={0.9 - collapse * 0.9} />;
        }))}
      </svg>
      {NETS.concat([{ id: "near", name: "NEAR", a: 0 }]).map((n, i) => {
        const [x, y] = SCATTER[i];
        const p = prog(f, 8 + i * 4, 30 + i * 4);
        const cx = 960 + (x - 960) * (1 - collapse), cy = 540 + (y - 540) * (1 - collapse);
        return (
          <div key={n.id} style={{ position: "absolute", left: cx, top: cy, transform: `translate(-50%,-50%) scale(${p * (1 - collapse)})`, padding: "12px 22px", borderRadius: 999, background: C.paper,
            border: `1.5px solid ${n.id === "near" ? C.green : "#D6DBD3"}`, fontFamily: F.text, fontSize: 24, fontWeight: 600, color: C.graphite, boxShadow: "0 10px 30px rgba(34,39,36,0.08)" }}>{n.name}</div>
        );
      })}
      {FRICTION.map((t, i) => {
        const p = prog(f, 112 + i * 13, 128 + i * 13);
        const [x, y] = [[500, 420], [1300, 420], [430, 600], [1340, 600], [760, 330], [1150, 740], [680, 680], [1030, 360]][i];
        const cx = 960 + (x - 960) * (1 - collapse), cy = 540 + (y - 540) * (1 - collapse);
        return (
          <div key={t} style={{ position: "absolute", left: cx + shake(i), top: cy, transform: `translate(-50%,-50%) scale(${p * (1 - collapse)}) rotate(${(i % 2 ? 1 : -1) * 2}deg)`, padding: "14px 22px", borderRadius: 12,
            background: C.graphite, color: C.white, fontFamily: F.text, fontSize: 26, fontWeight: 600, boxShadow: "0 18px 40px rgba(34,39,36,0.25)" }}>{t}</div>
        );
      })}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: 1 - prog(f, 58, 72) }}>
        <div style={{ transform: `translateY(${-prog(f, 58, 72) * 40}px)` }}><Kinetic text="DeFi is connected." at={4} size={132} stagger={5} highlight={["connected"]} /></div>
      </AbsoluteFill>
      <div style={{ position: "absolute", top: 90, left: 0, right: 0, opacity: 1 - collapse }}>
        <Kinetic text="But moving assets across chains is still hard." at={80} size={70} stagger={2} highlight={["hard"]} />
      </div>
    </AbsoluteFill>
  );
}

// ============================================================================================ 2. Meet SPak
function Intro() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const r = interpolate(f, [0, 16], [0, 1500], { extrapolateRight: "clamp", easing: out });
  const logo = spring({ frame: f - 6, fps, config: { damping: 14, mass: 0.7 } });
  const reveal = prog(f, 22, 46);
  const leave = prog(f, 182, 198, ease);
  return (
    <AbsoluteFill style={{ background: C.white }}>
      <AbsoluteFill style={{ background: C.green, clipPath: `circle(${r}px at 960px 540px)`, transform: `translateY(${-leave * 1080}px)` }}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40, transform: "translateY(-50px)" }}>
          <div style={{ position: "relative", height: 150, width: 640, transform: `scale(${0.6 + 0.4 * logo})` }}>
            <Img src={staticFile("brand/spak-logo-horizontal-mono-white.svg")} style={{ position: "absolute", inset: 0, height: 150, margin: "0 auto", clipPath: `inset(0 ${(1 - reveal) * 72}% 0 0)` }} />
          </div>
          <div style={{ opacity: prog(f, 18, 30) }}><Kinetic text="Meet SPak." at={20} size={44} color={C.light} weight={600} /></div>
          <Kinetic text="Intelligent execution across chains." at={62} size={76} color={C.white} stagger={3} />
          <div style={{ opacity: prog(f, 118, 132), transform: `translateY(${(1 - prog(f, 118, 132)) * 16}px)`, display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", borderRadius: 999, border: "1.5px solid rgba(232,239,233,0.4)", color: C.soft, fontFamily: F.text, fontSize: 26, fontWeight: 600 }}>
            Built on NEAR · non-custodial · you sign every transfer
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ============================================================================================ 3. How SPak works
const PIPE = [
  { name: "SPak-in", note: "Plain words → exact plan", at: 66 },
  { name: "SPak Intelligence", note: "Knows what you hold", at: 149 },
  { name: "SPak Guard", note: "Your limits, enforced", at: 240 },
  { name: "SPak Execution", note: "Signed quote · your wallet signs", at: 314 },
  { name: "NEAR Intents", note: "Routes and settles", at: 360, near: true },
  { name: "Delivery verified", note: "Checked on the destination chain", at: 435, done: true },
];
function How() {
  const f = useCurrentFrame();
  const intent = "Move 100 USDC from Base to NEAR";
  const typed = intent.slice(0, Math.floor(interpolate(f, [12, 58], [0, intent.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const plan = prog(f, 66, 92);
  const X = (i: number) => 175 + i * 314;
  const tokenT = interpolate(f, [70, 470], [0, PIPE.length - 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const zoom = prog(f, 528, 570, ease);
  return (
    <AbsoluteFill style={{ background: C.white, transform: `scale(${1 + zoom * 2.4})`, transformOrigin: `${X(3)}px 760px`, opacity: 1 - prog(f, 556, 570) }}>
      <div style={{ position: "absolute", top: 70, left: 0, right: 0 }}><Kinetic text="How SPak works" at={0} size={34} color={C.deepSage} weight={600} font={F.text} /></div>
      {/* intent pill morphs into the structured plan */}
      <div style={{ position: "absolute", left: 960, top: 300, transform: "translate(-50%,-50%)", width: 640 + plan * 260, padding: plan > 0.5 ? "28px 36px" : "24px 36px", borderRadius: plan > 0.5 ? 22 : 999,
        background: plan > 0.5 ? C.graphite : C.paper, border: `1.5px solid ${plan > 0.5 ? C.graphite : C.green}`, boxShadow: "0 30px 70px rgba(23,71,52,0.14)", fontFamily: plan > 0.5 ? F.mono : F.text, color: plan > 0.5 ? C.white : C.graphite }}>
        {plan <= 0.5 ? (
          <div style={{ fontSize: 40, fontWeight: 600 }}>“{typed}<span style={{ opacity: f % 30 < 15 ? 1 : 0, color: C.green }}>|</span>”</div>
        ) : (
          <div style={{ fontSize: 27, lineHeight: 1.55 }}>
            {[["intent", "BRIDGE"], ["amount", "100 USDC"], ["from", "base:USDC"], ["to", "near:USDC"], ["recipient", "your NEAR wallet"], ["approval", "required · wallet signs"]].map(([k, v], i) => (
              <div key={k} style={{ opacity: prog(f, 80 + i * 5, 92 + i * 5), transform: `translateX(${(1 - prog(f, 80 + i * 5, 92 + i * 5)) * 20}px)` }}>
                <span style={{ color: C.sage }}>{k}</span><span style={{ color: "#6F7F72" }}>: </span><span style={{ color: C.light }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* pipeline */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <line x1={X(0)} y1={760} x2={X(PIPE.length - 1)} y2={760} stroke="#DCE2DA" strokeWidth={4} />
        <line x1={X(0)} y1={760} x2={X(0) + tokenT * 314} y2={760} stroke={C.green} strokeWidth={4} />
        <path d={`M960,${300 + 120} C960,560 ${X(0)},600 ${X(0)},${760 - 60}`} fill="none" stroke={C.green} strokeWidth={3} strokeDasharray="700" strokeDashoffset={700 * (1 - prog(f, 60, 90))} />
      </svg>
      {PIPE.map((p, i) => {
        const on = prog(f, p.at, p.at + 14);
        const big = p.near ? 1.18 : 1;
        return (
          <div key={p.name} style={{ position: "absolute", left: X(i), top: 760, transform: `translate(-50%,-50%) scale(${(0.85 + 0.15 * on) * big})`, width: 250, textAlign: "center" }}>
            <div style={{ margin: "0 auto", width: 112, height: 112, borderRadius: p.near ? 30 : 56, display: "flex", alignItems: "center", justifyContent: "center",
              background: on > 0.5 ? (p.near ? C.green : p.done ? C.green : C.paper) : C.paper, border: `3px solid ${on > 0.5 ? C.green : "#DCE2DA"}`, transition: "none",
              boxShadow: on > 0.5 ? "0 16px 40px rgba(23,71,52,0.22)" : "none" }}>
              {p.done ? <svg width={52} height={52} viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke={on > 0.5 ? C.white : C.sage} strokeWidth={2.6} strokeDasharray="24" strokeDashoffset={24 * (1 - on)} strokeLinecap="round" /></svg>
                : p.near ? <span style={{ fontFamily: F.display, fontSize: 30, fontWeight: 600, color: on > 0.5 ? C.white : C.sage }}>NEAR</span>
                : <span style={{ fontFamily: F.display, fontSize: 38, fontWeight: 600, color: on > 0.5 ? C.green : C.sage }}>{i + 1}</span>}
            </div>
            <div style={{ marginTop: 22, fontFamily: F.display, fontSize: 27, fontWeight: 600, color: on > 0.3 ? C.graphite : C.sage }}>{p.name}</div>
            <div style={{ marginTop: 6, fontFamily: F.text, fontSize: 20, color: C.deepSage, opacity: on }}>{p.note}</div>
          </div>
        );
      })}
      {/* the moving token */}
      <div style={{ position: "absolute", left: X(0) + tokenT * 314, top: 760 - 92, transform: "translate(-50%,-50%)", opacity: prog(f, 70, 80) * (1 - prog(f, 470, 490)),
        padding: "8px 16px", borderRadius: 999, background: C.green, color: C.white, fontFamily: F.text, fontSize: 20, fontWeight: 700 }}>100 USDC</div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, textAlign: "center", fontFamily: F.text, fontSize: 24, color: C.deepSage, opacity: prog(f, 470, 490) }}>
        Non-custodial: SPak prepares and verifies. Your wallet signs. NEAR Intents settles.
      </div>
    </AbsoluteFill>
  );
}

// ============================================================================================ 4. The real product
const TYPE_FRAMES = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34];
function Seg({ from, dur, children }: { from: number; dur: number; children: React.ReactNode }) {
  return <Sequence from={from} durationInFrames={dur}><Cut dur={dur}>{children}</Cut></Sequence>;
}
/** Each product segment enters with a fast mask wipe and leaves with a short scale-down. */
function Cut({ dur, children }: { dur: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const inP = prog(f, 0, 10), outP = prog(f, dur - 6, dur, ease);
  return <AbsoluteFill style={{ clipPath: `inset(${(1 - inP) * 50}% 0 ${(1 - inP) * 50}% 0)`, opacity: 1 - outP * 0.6, transform: `scale(${1 - outP * 0.03})` }}>{children}</AbsoluteFill>;
}
function Typing() {
  const f = useCurrentFrame();
  const i = Math.min(TYPE_FRAMES.length - 1, Math.floor(interpolate(f, [6, 92], [0, TYPE_FRAMES.length - 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  return <Shot src={`shots/type-${String(TYPE_FRAMES[i]).padStart(2, "0")}.png`} cam={[{ t: 0, x: 0.42, y: 0.36, s: 1.6 }, { t: 100, x: 0.42, y: 0.39, s: 2.3 }, { t: 140, x: 0.45, y: 0.37, s: 2.0 }]} drift={0} />;
}
function Demo() {
  return (
    <AbsoluteFill style={{ background: C.soft }}>
      <Seg from={0} dur={78}>
        <Window url="usespak.vercel.app" at={0} from={1.12}>
          <Shot src="shots/site-01-hero.png" cam={[{ t: 0, x: 0.5, y: 0.5, s: 1 }, { t: 40, x: 0.5, y: 0.45, s: 1.12 }, { t: 74, x: 0.765, y: 0.05, s: 2.6 }]} drift={0} />
        </Window>
        <Label at={8} style={{ left: 64, top: 40 }}>Live website · usespak.vercel.app</Label>
      </Seg>
      <Seg from={78} dur={30}>
        <Window url="SPak app · preview build" from={1.0}><Shot src="shots/app-01-signin.png" cam={[{ t: 0, x: 0.75, y: 0.4, s: 1.6 }, { t: 30, x: 0.72, y: 0.42, s: 1.25 }]} drift={0} /></Window>
        <Label at={2} dark style={{ left: 64, top: 40 }}>{APP_LABEL}</Label>
      </Seg>
      <Seg from={108} dur={140}>
        <Window url="SPak app · preview build" from={1.0}><Typing /></Window>
        <Label at={0} dark style={{ left: 64, top: 40 }}>{APP_LABEL}</Label>
        <Caption kicker="Intent" title="Say it in plain words." at={30} x={96} y={830} w={560} />
      </Seg>
      <Seg from={248} dur={152}>
        <Window url="SPak app · preview build" from={1.0}>
          <Shot src="shots/app-07-interpreted.png" cam={[{ t: 0, x: 0.42, y: 0.4, s: 1.45 }, { t: 55, x: 0.42, y: 0.38, s: 1.45 }, { t: 85, x: 0.71, y: 0.3, s: 1.7 }, { t: 150, x: 0.71, y: 0.33, s: 1.6 }]}>
            <Box x={29.4} y={30.8} w={23.2} h={15.3} at={14} />
            <Box x={58.3} y={22.5} w={25.3} h={13.9} at={92} />
          </Shot>
        </Window>
        <Label at={0} dark style={{ left: 64, top: 40 }}>{APP_LABEL}</Label>
        <Caption kicker="SPak-in" title="Read in 10.8 ms with fixed rules. No guesswork." at={88} x={96} y={830} w={720} />
        <Caption kicker="Balance check" title="Flagged before the quote: this demo wallet is empty." at={14} x={1180} y={830} w={640} />
      </Seg>
      <Seg from={400} dur={146}>
        <Window url="SPak app · preview build" from={1.0}>
          <Shot src="shots/app-08-review.png" cam={[{ t: 0, x: 0.42, y: 0.3, s: 1.9 }, { t: 70, x: 0.42, y: 0.33, s: 2.1 }, { t: 110, x: 0.42, y: 0.66, s: 1.7 }, { t: 146, x: 0.42, y: 0.7, s: 1.75 }]}>
            <Box x={29.4} y={22.6} w={25.2} h={19.7} at={10} />
            <Box x={29.4} y={60.5} w={25.2} h={16.4} at={104} />
          </Shot>
        </Window>
        <Label at={0} dark style={{ left: 64, top: 40 }}>{APP_LABEL}</Label>
        <Caption kicker="Signed NEAR Intents quote" title="What you send, what you receive, every fee." at={16} x={1160} y={760} w={660} />
      </Seg>
      <Seg from={546} dur={104}>
        <Window url="SPak app · preview build" from={1.0}>
          <Shot src="shots/app-10-confirm-progress.png" cam={[{ t: 0, x: 0.4, y: 0.75, s: 1.5 }, { t: 60, x: 0.36, y: 0.93, s: 2.2 }, { t: 104, x: 0.36, y: 0.94, s: 2.3 }]}>
            <Box x={29.2} y={88.6} w={10.5} h={10.8} at={30} />
          </Shot>
        </Window>
        <Label at={0} dark style={{ left: 64, top: 40 }}>{APP_LABEL}</Label>
        <Caption kicker="One confirm" title="Firm quote, approval, deposit. Your wallet signs." at={12} x={1110} y={760} w={720} />
      </Seg>
      <Seg from={650} dur={150}>
        <Window url="SPak app · preview build" from={1.0}>
          <Shot src="shots/app-11-transfer-tracking.png" cam={[{ t: 0, x: 0.56, y: 0.24, s: 1.7 }, { t: 70, x: 0.56, y: 0.5, s: 1.55 }, { t: 150, x: 0.56, y: 0.75, s: 1.45 }]}>
            <Box x={36.4} y={13.1} w={40} h={21} at={8} />
            <Box x={36.4} y={36} w={40} h={33.5} at={64} />
          </Shot>
        </Window>
        <Label at={0} dark style={{ left: 64, top: 40 }}>{APP_LABEL}</Label>
        <Caption kicker="Tracking" title="Complete only when the destination chain proves it." at={20} x={96} y={830} w={760} />
        <Label at={70} style={{ right: 64, bottom: 56 }}>Demo wallet holds no funds: SPak stopped before any signature. Nothing moved.</Label>
      </Seg>
      <Seg from={800} dur={56}>
        <Window url="SPak app · preview build" from={1.0}><Shot src="shots/app-14-manual-review-route.png" cam={[{ t: 0, x: 0.42, y: 0.5, s: 1.7 }, { t: 56, x: 0.42, y: 0.52, s: 1.85 }]} /></Window>
        <Caption kicker="Honest routing" title="Some routes are reviewed by hand. SPak says so first." at={6} x={1100} y={800} w={720} />
      </Seg>
      <Seg from={856} dur={50}>
        <Window url="SPak app · preview build" from={1.0}><Shot src="shots/app-16-guard.png" cam={[{ t: 0, x: 0.55, y: 0.35, s: 1.3 }, { t: 50, x: 0.55, y: 0.4, s: 1.45 }]} /></Window>
        <Caption kicker="SPak Guard" title="Your limits, checked before the quote and the deposit." at={4} x={96} y={830} w={760} />
      </Seg>
    </AbsoluteFill>
  );
}

// ============================================================================================ 5. Intelligence and the vision
const STATUS = [
  { h: "Live", tone: C.green, items: ["Natural-language intents (SPak-in)", "Signed NEAR Intents quotes, wallet-signed deposits", "SPak Guard limits and policies", "Delivery verification on 45 routes", "Portfolio across 10 networks"] },
  { h: "In progress", tone: "#8A6D1F", items: ["First verified mainnet settlement", "Portfolio-aware intents (balance checks live)", "SPak Agent identity (cannot move funds)"] },
  { h: "Next", tone: C.deepSage, items: ["Conditional and scheduled execution", "Advanced Agents", "Developer APIs and SDKs", "Rebalancing"] },
];
function Intel() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.soft }}>
      <Seg from={0} dur={130}>
        <Window url="SPak app · preview build" from={1.08}><Shot src="shots/app-18-intelligence.png" cam={[{ t: 0, x: 0.45, y: 0.2, s: 1.6 }, { t: 130, x: 0.5, y: 0.35, s: 1.25 }]} /></Window>
        <Label at={4} dark style={{ left: 64, top: 40 }}>SPak Intelligence · data: live read of public mainnet wallets (the demo wallet is empty)</Label>
        <Caption kicker="SPak Intelligence" title="Your balances across 10 networks, independently priced." at={22} x={96} y={830} w={820} />
      </Seg>
      <Seg from={130} dur={100}>
        <Window url="SPak app · preview build" from={1.0}><Shot src="shots/app-19-intelligence-insights.png" cam={[{ t: 0, x: 0.5, y: 0.3, s: 1.5 }, { t: 100, x: 0.5, y: 0.45, s: 1.6 }]} /></Window>
        <Label at={0} dark style={{ left: 64, top: 40 }}>SPak Intelligence · data: live read of public mainnet wallets</Label>
      </Seg>
      <Seg from={230} dur={104}>
        <Window url="SPak app · preview build" from={1.0}>
          <Shot src="shots/app-20-intelligence-routes.png" cam={[{ t: 0, x: 0.55, y: 0.45, s: 1.5 }, { t: 104, x: 0.5, y: 0.57, s: 1.9 }]}>
            <Box x={30.1} y={47.8} w={52.6} h={18.6} at={14} />
          </Shot>
        </Window>
        <Label at={0} dark style={{ left: 64, top: 40 }}>Live NEAR Intents quotes · signature checked · nothing moves</Label>
        <Caption kicker="Route intelligence" title="Compare live routes for any holding." at={10} x={96} y={840} w={640} />
      </Seg>
      <Sequence from={334}>
        <AbsoluteFill style={{ background: C.white, clipPath: `inset(0 0 0 ${(1 - prog(f - 334, 0, 18)) * 100}%)` }}>
          <div style={{ position: "absolute", top: 90, left: 0, right: 0 }}><Kinetic text="What is live, and what is next." at={6} size={64} stagger={2} highlight={["live,", "live"]} /></div>
          <div style={{ position: "absolute", top: 260, left: 120, right: 120, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 40 }}>
            {STATUS.map((col, c) => (
              <div key={col.h} style={{ borderRadius: 24, padding: "30px 32px", background: c === 0 ? C.paper : "transparent", border: `1.5px solid ${c === 0 ? C.green : "#D6DBD3"}`, borderStyle: c === 2 ? "dashed" : "solid",
                opacity: prog(f - 334, 16 + c * 10, 34 + c * 10), transform: `translateY(${(1 - prog(f - 334, 16 + c * 10, 34 + c * 10)) * 40}px)` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: F.display, fontSize: 34, fontWeight: 600, color: col.tone }}>
                  <span style={{ width: 14, height: 14, borderRadius: 7, background: c === 2 ? "transparent" : col.tone, border: `2px solid ${col.tone}` }} />{col.h}
                </div>
                <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                  {col.items.map((it, i) => (
                    <div key={it} style={{ fontFamily: F.text, fontSize: 25, lineHeight: 1.3, color: C.graphite, opacity: prog(f - 334, 30 + c * 10 + i * 6, 44 + c * 10 + i * 6) }}>{it}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ position: "absolute", bottom: 60, left: 0, right: 0, textAlign: "center", fontFamily: F.text, fontSize: 22, color: C.deepSage, opacity: prog(f - 334, 80, 100) }}>
            No verified SPak mainnet settlement yet. The first controlled transfer is being prepared.
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
}

// ============================================================================================ 6. Final reveal
function Outro() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const conv = prog(f, 4, 40, ease);
  const fill = interpolate(f, [178, 194], [0, 1500], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: out });
  const logo = spring({ frame: f - 186, fps, config: { damping: 16 } });
  const lines = ["Your intent.", "Cross-chain execution.", "One intelligent interface."];
  return (
    <AbsoluteFill style={{ background: C.white }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: 1 - prog(f, 150, 178) }}>
        {NETS.map((n, i) => {
          const p = nodePos(n.a, 520 - conv * 140, 1340, 540);
          const t = ((f + i * 9) % 60) / 60;
          return (
            <g key={n.id}>
              <line x1={p.x} y1={p.y} x2={1340} y2={540} stroke={C.sage} strokeWidth={2} strokeDasharray="600" strokeDashoffset={600 * (1 - prog(f, 6 + i * 2, 40 + i * 2))} />
              <circle cx={p.x + (1340 - p.x) * t} cy={p.y + (540 - p.y) * t} r={6} fill={C.green} opacity={prog(f, 40, 50)} />
              <circle cx={p.x} cy={p.y} r={10} fill={C.paper} stroke={C.green} strokeWidth={3} opacity={prog(f, 2 + i * 2, 16 + i * 2)} />
              <text x={p.x} y={p.y - 24} textAnchor="middle" fontFamily="Inter Variable, Inter" fontSize={22} fontWeight={600} fill={C.graphite} opacity={prog(f, 8 + i * 2, 22 + i * 2)}>{n.name}</text>
            </g>
          );
        })}
        <circle cx={1340} cy={540} r={64 + 6 * Math.sin(f / 8)} fill={C.green} />
        <text x={1340} y={550} textAnchor="middle" fontFamily="Sora" fontSize={30} fontWeight={600} fill={C.white}>NEAR</text>
      </svg>
      <div style={{ position: "absolute", left: 140, top: 330, display: "flex", flexDirection: "column", gap: 10, opacity: 1 - prog(f, 150, 176) }}>
        {lines.map((l, i) => <Kinetic key={l} text={l} at={36 + i * 34} size={76} align="left" stagger={3} highlight={i === 2 ? ["intelligent"] : []} />)}
      </div>
      <AbsoluteFill style={{ background: C.green, clipPath: `circle(${fill}px at 1340px 540px)` }}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34 }}>
          <Img src={staticFile("brand/spak-logo-horizontal-mono-white.svg")} style={{ height: 170, transform: `scale(${0.7 + 0.3 * logo})`, opacity: logo }} />
          <div style={{ opacity: prog(f, 206, 222) }}><Kinetic text="Intelligent execution across chains." at={206} size={54} color={C.soft} stagger={2} /></div>
          <div style={{ marginTop: 20, opacity: prog(f, 232, 246), padding: "14px 30px", borderRadius: 999, border: "1.5px solid rgba(232,239,233,0.45)", fontFamily: F.text, fontSize: 30, fontWeight: 600, color: C.white }}>usespak.vercel.app</div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ============================================================================================ film
export function Film() {
  return (
    <AbsoluteFill style={{ background: C.white }}>
      <Sequence from={S.problem.from} durationInFrames={S.problem.dur}><Problem /></Sequence>
      <Sequence from={S.intro.from} durationInFrames={S.intro.dur}><Intro /></Sequence>
      <Sequence from={S.how.from} durationInFrames={S.how.dur}><How /></Sequence>
      <Sequence from={S.demo.from} durationInFrames={S.demo.dur}><Demo /></Sequence>
      <Sequence from={S.intel.from} durationInFrames={S.intel.dur}><Intel /></Sequence>
      <Sequence from={S.outro.from} durationInFrames={S.outro.dur}><Outro /></Sequence>
      <Audio src={staticFile("audio/score.wav")} volume={0.75} />
      {Object.entries(T.vo).map(([id, at]) => (
        <Sequence key={id} from={sec(at)}><Audio src={staticFile((VO as Record<string, { path: string }>)[id].path.replace("public/", ""))} volume={1} /></Sequence>
      ))}
    </AbsoluteFill>
  );
}
