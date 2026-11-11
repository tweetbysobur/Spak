/**
 * SPak font loading (Phase 6.4). Not imported by the app yet: nothing downloads until the typography system is applied.
 *
 * next/font self-hosts the files at build time (no request to Google at runtime), sets font-display: swap, and
 * generates size-adjusted fallback faces so text does not shift when the web font arrives.
 *
 * Kept small on purpose:
 * - Inter and JetBrains Mono are variable fonts: one file each covers every weight.
 * - Sora loads only 600 (the only display weight).
 * - Instrument Serif loads 400 italic only, and is not preloaded (marketing accent, optional).
 * - Latin subset only.
 *
 * Usage when applied: put the four `.variable` class names on <html>, then use the CSS variables
 * (--font-inter, --font-sora, --font-jetbrains-mono, --font-instrument-serif) from typography.json stacks.
 */
import { Instrument_Serif, Inter, JetBrains_Mono, Sora } from "next/font/google";

export const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const sora = Sora({ subsets: ["latin"], weight: ["600"], display: "swap", variable: "--font-sora", preload: false });

export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains-mono", preload: false });

export const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], display: "swap", variable: "--font-instrument-serif", preload: false });

/** All four variables, for <html className={fontVariables}>. */
export const fontVariables = [inter.variable, sora.variable, jetbrainsMono.variable, instrumentSerif.variable].join(" ");
