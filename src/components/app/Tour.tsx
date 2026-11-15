"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { PROVIDER_LABEL } from "@/environment";
import type { View } from "./Shell";

/**
 * First-run guided tour. Shown once per account after sign-in, replayable from the account menu.
 * Each step opens the real screen and outlines its real navigation item; the copy describes only what is live.
 * Dialog semantics, keyboard (Esc, arrows), focus on the card, and no motion when reduced motion is requested.
 */
type Step = { view: View | null; anchor: string | null; title: string; body: string };

const STEPS: Step[] = [
  { view: null, anchor: null, title: "Welcome to SPak", body: `SPak turns a sentence into a cross-chain transfer through ${PROVIDER_LABEL}. You review every quote and your wallet signs every deposit. This tour takes about a minute.` },
  { view: "overview", anchor: "overview", title: "Overview", body: "Your starting point: recent transfers, their status, and quick ways to start a new one." },
  { view: "execute", anchor: "execute", title: "Execute", body: "Describe a transfer in plain words, for example “Move 20 USDC from Base to NEAR”. SPak checks your balance, gets a signed quote, and shows the exact amounts before anything moves." },
  { view: "activity", anchor: "activity", title: "Activity", body: "Every transfer with its live status. SPak checks delivery on the destination chain itself before marking a transfer complete, and tracks refunds the same way." },
  { view: "portfolio", anchor: "portfolio", title: "Intelligence", body: "Your balances on 10 networks, valued with independent prices. Ask questions like “How much USDC do I have?” and compare live routes for any holding." },
  { view: "guard", anchor: "guard", title: "SPak Guard", body: "Your own limits: per-transfer and daily spend, allowed networks, assets and recipients. Guard checks every transfer before a quote and again before the deposit." },
  { view: "agent", anchor: "agent", title: "Agent", body: "Set up a SPak Agent identity on NEAR. In this release you approve every transfer yourself; Agents cannot move funds." },
  { view: "settings", anchor: "settings", title: "Settings and wallets", body: "Link more wallets (EVM, Solana, NEAR) to use them as sources and destinations, and choose which networks each one is used on." },
  { view: null, anchor: "account", title: "Your account", body: "Your signed-in wallet, sign-out, and this tour if you want it again." },
  { view: "execute", anchor: null, title: "You are ready", body: "Start with a small transfer you know well. SPak will show the full review before your wallet asks you to sign." },
];

const KEY = (userId: string) => `spak.tour.v1.${userId}`;
const seen = (userId: string) => { try { return localStorage.getItem(KEY(userId)) === "done"; } catch { return true; } };
const markSeen = (userId: string) => { try { localStorage.setItem(KEY(userId), "done"); } catch { /* private mode: shown again next time */ } };
/** Opens the tour from anywhere (the account menu uses it). */
export const startTour = () => window.dispatchEvent(new Event("spak:tour"));

function visibleAnchor(id: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)].filter((e) => e.offsetParent !== null);
  return all[0] ?? (id !== "account" ? visibleAnchor("account") : null);
}

export function Tour({ userId, onSelect }: { userId: string; onSelect: (v: View) => void }) {
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!seen(userId)) setI(0); }, [userId]);
  useEffect(() => { const open = () => setI(0); window.addEventListener("spak:tour", open); return () => window.removeEventListener("spak:tour", open); }, []);

  const step = i === null ? null : STEPS[i];
  const close = useCallback((goExecute = false) => { markSeen(userId); setI(null); if (goExecute) onSelect("execute"); }, [userId, onSelect]);

  // Open the step's screen, then measure its anchor once it has rendered.
  useLayoutEffect(() => {
    if (!step) return;
    if (step.view) onSelect(step.view);
    const measure = () => { const el = step.anchor ? visibleAnchor(step.anchor) : null; setRect(el ? el.getBoundingClientRect() : null); };
    measure();
    const t = setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [step, onSelect]);
  useEffect(() => { if (step) card.current?.focus(); }, [step]);
  useEffect(() => {
    if (i === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && i < STEPS.length - 1) setI(i + 1);
      if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [i, close]);

  if (!step || i === null) return null;
  const last = i === STEPS.length - 1;
  // Card placement: beside a sidebar item, above a bottom-bar item, below the header, or centred.
  const W = 340, pad = 12;
  let style: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect && typeof window !== "undefined") {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (rect.right + pad + W < vw && rect.left < vw / 3) style = { left: rect.right + pad, top: Math.min(Math.max(rect.top - 8, pad), vh - 260) };
    else if (rect.top > vh / 2) style = { left: Math.min(Math.max(rect.left + rect.width / 2 - W / 2, pad), vw - W - pad), bottom: vh - rect.top + pad };
    else style = { left: Math.min(Math.max(rect.right - W, pad), vw - W - pad), top: rect.bottom + pad };
  }

  return (
    <div className="fixed inset-0 z-50" aria-hidden={false}>
      {/* Dim everything except the outlined item (a ring with a wide shadow); no blur. */}
      {rect ? (
        <div aria-hidden className="pointer-events-none fixed rounded-control ring-2 ring-primary ring-offset-2 ring-offset-bg motion-safe:transition-all motion-safe:duration-200"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: "0 0 0 9999px rgb(34 39 36 / 0.45)" }} />
      ) : <div aria-hidden className="fixed inset-0 bg-[rgb(34_39_36/0.45)]" />}
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1}
        className="fixed w-[min(340px,calc(100vw-24px))] rounded-panel border border-primary bg-elevated p-5 shadow-overlay outline-none dark:bg-surface motion-safe:animate-[tourIn_160ms_ease-out]"
        style={style}>
        <p className="type-caption text-fg-2">{i + 1} of {STEPS.length}</p>
        <h2 id="tour-title" className="type-app-heading mt-1 text-fg">{step.title}</h2>
        <p id="tour-body" className="type-body-sm mt-2 text-fg-2">{step.body}</p>
        <div className="mt-4 h-1 rounded-full bg-surface dark:bg-bg" aria-hidden><div className="h-1 rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-200" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></div>
        <div className="mt-4 flex items-center gap-2">
          {!last && <button onClick={() => close()} className="type-button-sm min-h-9 px-1 text-fg-2 underline-offset-2 hover:text-fg hover:underline">Skip tour</button>}
          <span className="flex-1" />
          {i > 0 && <Button variant="ghost" size="sm" onClick={() => setI(i - 1)}>Back</Button>}
          {last ? <Button size="sm" onClick={() => close(true)}>Make your first transfer</Button> : <Button size="sm" onClick={() => setI(i + 1)}>{i === 0 ? "Start" : "Next"}</Button>}
        </div>
      </div>
    </div>
  );
}
