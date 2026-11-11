"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { NAV, SITE } from "@/marketing/content";

/** Navigation for small screens: a disclosure button and a panel under the header. Closes on Escape and on navigation. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="md:hidden">
      <button ref={button} type="button" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((v) => !v)}
        className="type-nav inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong px-3 text-fg">
        {open ? <Icon name="close" size={18} /> : null}{open ? "Close" : "Menu"}
      </button>
      <nav id="site-menu" aria-label="Main" hidden={!open} className="absolute inset-x-0 top-16 border-b border-line bg-bg">
        <ul className="mkt-wrap flex flex-col py-3">
          {NAV.map((n) => <li key={n.href}><Link href={n.href} onClick={() => setOpen(false)} className="type-nav flex min-h-12 items-center border-b border-line text-fg">{n.label}</Link></li>)}
          <li className="pt-4 pb-2"><Link href={SITE.appPath} onClick={() => setOpen(false)} className="type-cta flex min-h-12 items-center justify-center rounded-control bg-primary text-on-primary">Launch App</Link></li>
        </ul>
      </nav>
    </div>
  );
}
