import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPak",
  description: "Cross-chain execution agent on NEAR Intents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-[#0a0b0d] text-white antialiased">
        {children}
        <Script src="/kubai/spak-icons.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
