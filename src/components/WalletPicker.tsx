"use client";
import { useEffect, useState } from "react";
import { discoverEvmWallets, type EvmWalletInfo } from "@/wallets/evm";
import { discoverSolanaWallets, type SolanaWalletInfo } from "@/wallets/solana";
import { discoverNearWallets, type NearWalletInfo } from "@/wallets/near";
import { connectAndVerify, type Purpose, type WalletChoice } from "@/wallets/flow";
import { Card } from "./ui";

const FRIENDLY: Record<string, string> = {
  "4001": "You rejected the request in your wallet.",
  "-32002": "Your wallet already has a pending request. Open it to continue.",
};

function message(e: unknown): string {
  const code = String((e as { code?: unknown }).code ?? "");
  return FRIENDLY[code] ?? (e as Error).message ?? "Something went wrong.";
}

/** Lists the wallets this browser has and runs connect → sign → verify. */
export function WalletPicker({ purpose, onDone }: { purpose: Purpose; onDone: () => void }) {
  const [evm, setEvm] = useState<EvmWalletInfo[]>([]);
  const [sol, setSol] = useState<SolanaWalletInfo[]>([]);
  const [near, setNear] = useState<NearWalletInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    discoverEvmWallets().then(setEvm);
    setSol(discoverSolanaWallets());
    discoverNearWallets().then(setNear).catch(() => setNear([]));
  }, []);

  async function go(key: string, choice: WalletChoice) {
    setBusy(key); setError(undefined);
    try {
      const r = await connectAndVerify(choice, purpose);
      if (r) onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(null); }
  }

  const row = (key: string, name: string, icon: string | undefined, choice: WalletChoice, disabled = false) => (
    <button key={key} disabled={!!busy || disabled} onClick={() => go(key, choice)}
      className="flex w-full items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-left text-sm hover:bg-white/5 disabled:opacity-40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {icon ? <img src={icon} alt="" className="h-6 w-6 rounded" /> : <span className="h-6 w-6 rounded bg-white/10" />}
      <span className="flex-1">{name}</span>
      {busy === key && <span className="text-xs text-white/50">Check your wallet</span>}
    </button>
  );

  return (
    <Card>
      <h3 className="mb-1 font-semibold">{purpose === "SIGN_IN" ? "Sign in with a wallet" : "Link another wallet"}</h3>
      <p className="mb-4 text-xs text-white/50">You sign a text message to prove you own the wallet. It is not a transaction and costs no gas. SPak never asks for your seed phrase or private key.</p>
      <div className="flex flex-col gap-4">
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Ethereum, Base, Arbitrum, Optimism, Polygon</p>
          <div className="flex flex-col gap-2">
            {evm.length ? evm.map((w) => row(`evm:${w.id}`, w.name, w.icon, { family: "evm", info: w })) : <p className="text-xs text-white/40">No EVM wallet found in this browser.</p>}
          </div>
        </section>
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Solana</p>
          <div className="flex flex-col gap-2">
            {sol.length ? sol.map((w) => row(`sol:${w.id}`, w.name, w.icon, { family: "solana", info: w })) : <p className="text-xs text-white/40">No Solana wallet found in this browser.</p>}
          </div>
        </section>
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-white/40">NEAR</p>
          <div className="flex flex-col gap-2">
            {near.length ? near.map((w) => row(`near:${w.id}`, w.name, w.icon, { family: "near", id: w.id }, !w.available)) : <p className="text-xs text-white/40">Loading NEAR wallets…</p>}
          </div>
        </section>
      </div>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </Card>
  );
}
