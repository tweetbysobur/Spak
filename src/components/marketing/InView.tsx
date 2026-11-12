"use client";

import { useEffect, useRef } from "react";

/**
 * Sets data-inview="true" while the element is on screen, "false" when it leaves. CSS uses it to play an entrance
 * once (.is-in, kept) and to run looping motion only while visible. Without JavaScript nothing is hidden.
 */
export function InView({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    el.dataset.armed = "true";
    const io = new IntersectionObserver(([e]) => {
      el.dataset.inview = String(e.isIntersecting);
      if (e.isIntersecting) el.classList.add("is-in");
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
