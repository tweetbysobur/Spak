import type { Metadata, Viewport } from "next";
import "./globals.css";
import { fontVariables } from "@/design/fonts";
import { themeColor, tokenCss } from "@/design/css";

export const metadata: Metadata = {
  title: { default: "SPak", template: "%s · SPak" },
  description: "Intelligent execution across chains. Turn intentions into verified actions across blockchain networks.",
  applicationName: "SPak",
  icons: {
    // /favicon.ico (16, 32, 48) is added by Next.js from src/app/favicon.ico (the approved brand favicon).
    icon: [{ url: "/brand/icons/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/brand/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: themeColor.light },
    { media: "(prefers-color-scheme: dark)", color: themeColor.dark },
  ],
};

/**
 * Applies the saved theme before first paint (no flash). "system" (or nothing saved) follows the OS setting.
 * Storage can be unavailable (private mode, blocked): then the system setting applies.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("spak-theme");if(s==="light"||s==="dark"){document.documentElement.dataset.theme=s;}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <style id="spak-tokens" dangerouslySetInnerHTML={{ __html: tokenCss() }} />
      </head>
      <body className="min-h-dvh bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
