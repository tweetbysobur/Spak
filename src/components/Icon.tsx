"use client";
import { useEffect, useRef } from "react";

// Animated icons drawn with the Kubai Icons engine (public/kubai/spak-icons.js).
// The icon morphs while its closest button or [data-icon-hover] parent is hovered or
// focused. `active` holds the hover pose, used for the selected tab.
export type IconName = "chat" | "swap" | "history" | "addresses" | "approve" | "deposit" | "delivery" | "crosschain";

type Inst = { hover: number; pin?: boolean };
type Api = {
  mount: (name: IconName, host: HTMLElement) => Inst | null;
  set: (inst: Inst | null, o: Partial<Inst>) => void;
  stop: (inst: Inst | null) => void;
};
declare global { interface Window { SpakIcons?: Api } }

export function Icon({ name, size = 20, active = false, className = "" }: { name: IconName; size?: number; active?: boolean; className?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const inst = useRef<Inst | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let off = () => {};
    const start = () => {
      const api = window.SpakIcons;
      if (!api || inst.current) return;
      inst.current = api.mount(name, el);
      api.set(inst.current, { pin: activeRef.current });
      const target = el.closest<HTMLElement>("button, a, [data-icon-hover]") ?? el;
      const set = (d: number) => () => { const i = inst.current; if (i) api.set(i, { hover: Math.max(0, i.hover + d) }); };
      const enter = set(1), leave = set(-1);
      const pe = (e: PointerEvent) => { if (e.pointerType === "mouse") enter(); };
      const pl = (e: PointerEvent) => { if (e.pointerType === "mouse") leave(); };
      target.addEventListener("pointerenter", pe);
      target.addEventListener("pointerleave", pl);
      target.addEventListener("focus", enter);
      target.addEventListener("blur", leave);
      off = () => {
        target.removeEventListener("pointerenter", pe);
        target.removeEventListener("pointerleave", pl);
        target.removeEventListener("focus", enter);
        target.removeEventListener("blur", leave);
        api.stop(inst.current);
        inst.current = null;
      };
    };
    if (window.SpakIcons) start();
    else window.addEventListener("spakicons:ready", start, { once: true });
    return () => { window.removeEventListener("spakicons:ready", start); off(); };
  }, [name]);

  useEffect(() => { window.SpakIcons?.set(inst.current, { pin: active }); }, [active]);

  return <span ref={host} aria-hidden="true" className={`kubai inline-block shrink-0 ${className}`} style={{ width: size, height: size * 29 / 31 }} />;
}
