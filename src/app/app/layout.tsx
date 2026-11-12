import type { Metadata } from "next";

/** The SPak application (wallet sign-in, chat, review, tracking). The marketing site lives at "/". */
export const metadata: Metadata = {
  title: "App",
  description: "Sign in with your wallet, state a transfer, review the quote, approve and track it.",
  robots: { index: false, follow: true },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
