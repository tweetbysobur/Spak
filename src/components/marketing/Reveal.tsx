"use client";

import { useEffect } from "react";

/**
 * Scroll reveal for elements marked data-reveal. Content is visible without JavaScript and when the visitor
 * prefers reduced motion: the hidden start state exists only under the .js-reveal class this component adds.
 */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.1 });
    // Elements already on screen are shown at once, so nothing visible flashes out and back.
    for (const el of els) { if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("is-in"); else io.observe(el); }
    document.documentElement.classList.add("js-reveal");
    return () => { io.disconnect(); document.documentElement.classList.remove("js-reveal"); };
  }, []);
  return null;
}
