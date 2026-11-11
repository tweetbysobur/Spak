"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Choice = "system" | "light" | "dark";
const NEXT: Record<Choice, Choice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Choice, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

/** Cycles system, light, dark. "system" removes data-theme so the OS setting applies (see layout THEME_SCRIPT). */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");
  useEffect(() => {
    try { const s = localStorage.getItem("spak-theme"); if (s === "light" || s === "dark") setChoice(s); } catch { /* storage blocked */ }
  }, []);
  const apply = (c: Choice) => {
    setChoice(c);
    if (c === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = c;
    try { if (c === "system") localStorage.removeItem("spak-theme"); else localStorage.setItem("spak-theme", c); } catch { /* storage blocked */ }
  };
  return (
    <button type="button" onClick={() => apply(NEXT[choice])} aria-label={`${LABEL[choice]}. Change theme`} title={LABEL[choice]}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-fg-2 hover:bg-secondary hover:text-fg dark:hover:bg-elevated">
      <Icon name={choice === "dark" ? "moon" : choice === "light" ? "sun" : "neutral"} size={18} />
      <span className="sr-only">{LABEL[choice]}</span>
    </button>
  );
}
