"use client";
import { api } from "@/lib/client";

export interface WalletView {
  id: string;
  family: "evm" | "solana" | "near";
  address: string;
  label: string | null;
  active: boolean;
  networks: { id: string; enabled: boolean }[];
}

export interface Session {
  authenticated: true;
  userId: string;
  expiresAt: string;
  activeSessions: number;
  wallets: WalletView[];
  agent: { status: "LINKED" | "NOT_LINKED"; nearAccountId: string | null };
}

export async function loadSession(): Promise<Session | null> {
  const s = await api<Session | { authenticated: false }>("/api/auth/session");
  return s.authenticated ? s : null;
}
