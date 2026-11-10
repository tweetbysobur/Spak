"use client";
import { useEffect, useState } from "react";
import { watchEvmWallets, type EvmWalletInfo } from "@/wallets/evm";
import { watchSolanaWallets, type SolanaWalletInfo } from "@/wallets/solana";
import { discoverNearWallets, type NearWalletInfo } from "@/wallets/near";
import { complete, needsSecondClick, prepare, type Prepared, type Purpose, type WalletChoice } from "@/wallets/flow";
import { classifyWalletError } from "@/wallets/errors";
import { Button, Card } from "./ui";

type Stage =
  | { kind: "idle" }
  | { kind: "working"; key: string; label: string }
  | { kind: "ready"; key: string; prepared: Prepared };

/** Lists the wallets this browser has and runs connect → challenge → sign → verify. */
export function WalletPicker({ purpose, onDone }: { purpose: Purpose; onDone: () => void }) {
  const [evm, setEvm] = useState<EvmWalletInfo[]>([]);
  const [sol, setSol] = useState<SolanaWalletInfo[]>([]);
  const [near, setNear] = useState<NearWalletInfo[] | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<string>();
  const [pickAccount, setPickAccount] = useState(false);

  useEffect(() => {
    const stopEvm = watchEvmWallets(setEvm);
    const stopSol = watchSolanaWallets(setSol);
    discoverNearWallets().then(setNear).catch(() => setNear([]));
    return () => { stopEvm(); stopSol(); };
  }, []);

  const fail = (e: unknown) => {
    // Keep the raw wallet error in the console for support; show the user a plain message.
    console.warn("[spak] wallet sign-in failed", { code: (e as { code?: unknown })?.code, message: (e as Error)?.message });
    setError(classifyWalletError(e).message);
    setStage({ kind: "idle" });
  };

  async function start(key: string, choice: WalletChoice) {
    setError(undefined);
    setStage({ kind: "working", key, label: choice.family === "near" ? "Preparing" : "Check your wallet" });
    try {
      const p = await prepare(choice, purpose, { pickAccount });
      if (needsSecondClick(choice)) { setStage({ kind: "ready", key, prepared: p }); return; }
      if (await complete(p)) onDone();
      setStage({ kind: "idle" });
    } catch (e) { fail(e); }
  }

  /** Runs inside the click, so a wallet popup is allowed to open. */
  async function sign(p: Prepared, key: string) {
    setError(undefined);
    setStage({ kind: "working", key, label: "Approve in your wallet" });
    try {
      if (await complete(p)) onDone();
      setStage({ kind: "idle" });
    } catch (e) { fail(e); }
  }

  const busy = stage.kind === "working";
  const row = (key: string, name: string, icon: string | undefined, choice: WalletChoice, disabled = false) => (
    <div key={key} className="flex flex-col gap-2">
      <button disabled={busy || disabled} onClick={() => start(key, choice)}
        className="flex w-full items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-left text-sm hover:bg-white/5 disabled:opacity-40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {icon ? <img src={icon} alt="" className="h-6 w-6 rounded" /> : <span className="h-6 w-6 rounded bg-white/10" />}
        <span className="flex-1">{name}{disabled ? " (not installed)" : ""}</span>
        {stage.kind === "working" && stage.key === key && <span className="text-xs text-white/50">{stage.label}</span>}
      </button>
      {stage.kind === "ready" && stage.key === key && (
        <div className="flex items-center gap-2 pl-2">
          <Button onClick={() => sign(stage.prepared, key)}>Open {name} to sign</Button>
          <Button variant="ghost" onClick={() => setStage({ kind: "idle" })}>Cancel</Button>
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <h3 className="mb-1 font-semibold">{purpose === "SIGN_IN" ? "Sign in with a wallet" : "Link another wallet"}</h3>
      <p className="mb-4 text-xs text-white/50">You sign a text message to prove you own the wallet. It is not a transaction and costs no gas. SPak never asks for your seed phrase or private key.</p>
      <div className="flex flex-col gap-4">
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche, Gnosis</p>
          <div className="flex flex-col gap-2">
            {evm.length ? evm.map((w) => row(`evm:${w.id}`, w.name, w.icon, { family: "evm", info: w })) : <p className="text-xs text-white/40">No EVM wallet found. Install MetaMask or another EVM wallet extension.</p>}
          </div>
        </section>
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Solana</p>
          <div className="flex flex-col gap-2">
            {sol.length ? sol.map((w) => row(`sol:${w.id}`, w.name, w.icon, { family: "solana", info: w })) : <p className="text-xs text-white/40">No Solana wallet found. Install Phantom or another Wallet Standard wallet.</p>}
          </div>
        </section>
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-white/40">NEAR</p>
          <div className="flex flex-col gap-2">
            {near === null ? <p className="text-xs text-white/40">Loading NEAR wallets…</p>
              : near.map((w) => row(`near:${w.id}`, w.name, w.icon, { family: "near", id: w.id, name: w.name }, !w.available))}
          </div>
        </section>
      </div>
      <label className="mt-4 flex items-center gap-2 text-xs text-white/60">
        <input type="checkbox" checked={pickAccount} onChange={(e) => setPickAccount(e.target.checked)} />
        Let me choose a different account (EVM and Solana)
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
    </Card>
  );
}
