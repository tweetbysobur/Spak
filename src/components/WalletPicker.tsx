"use client";
import { useEffect, useState } from "react";
import { watchEvmWallets, type EvmWalletInfo } from "@/wallets/evm";
import { watchSolanaWallets, type SolanaWalletInfo } from "@/wallets/solana";
import { discoverNearWallets, type NearWalletInfo } from "@/wallets/near";
import { complete, needsSecondClick, prepare, type Prepared, type Purpose, type WalletChoice } from "@/wallets/flow";
import { classifyWalletError } from "@/wallets/errors";
import { Button, Card, ErrorText, SectionTitle, Spinner } from "./ui";

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
        className="type-body flex min-h-12 w-full items-center gap-3 rounded-card border border-line-strong bg-elevated px-3 py-2 text-left text-fg hover:bg-surface disabled:cursor-not-allowed disabled:border-disabled-line disabled:bg-disabled disabled:text-disabled-fg dark:bg-bg dark:hover:bg-elevated">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {icon ? <img src={icon} alt="" className="h-7 w-7 rounded-control" /> : <span className="h-7 w-7 rounded-control bg-surface" />}
        <span className="flex-1">{name}{disabled ? " (not installed)" : ""}</span>
        {stage.kind === "working" && stage.key === key && <Spinner label={stage.label} />}
      </button>
      {stage.kind === "ready" && stage.key === key && (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          <Button onClick={() => sign(stage.prepared, key)}>Open {name} to sign</Button>
          <Button variant="ghost" onClick={() => setStage({ kind: "idle" })}>Cancel</Button>
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <SectionTitle sub="You sign a text message to prove you own the wallet. It is not a transaction and costs no gas. SPak never asks for your seed phrase or private key.">
        {purpose === "SIGN_IN" ? "Sign in with a wallet" : "Link another wallet"}
      </SectionTitle>
      <div className="flex flex-col gap-5">
        <section>
          <p className="type-label mb-2 text-fg-2">Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche, Gnosis</p>
          <div className="flex flex-col gap-2">
            {evm.length ? evm.map((w) => row(`evm:${w.id}`, w.name, w.icon, { family: "evm", info: w })) : <p className="type-body-sm text-fg-2">No EVM wallet found. Install MetaMask or another EVM wallet extension.</p>}
          </div>
        </section>
        <section>
          <p className="type-label mb-2 text-fg-2">Solana</p>
          <div className="flex flex-col gap-2">
            {sol.length ? sol.map((w) => row(`sol:${w.id}`, w.name, w.icon, { family: "solana", info: w })) : <p className="type-body-sm text-fg-2">No Solana wallet found. Install Phantom or another Wallet Standard wallet.</p>}
          </div>
        </section>
        <section>
          <p className="type-label mb-2 text-fg-2">NEAR</p>
          <div className="flex flex-col gap-2">
            {near === null ? <p className="type-body-sm text-fg-2">Loading NEAR wallets…</p>
              : near.map((w) => row(`near:${w.id}`, w.name, w.icon, { family: "near", id: w.id, name: w.name }, !w.available))}
          </div>
        </section>
      </div>
      <label className="type-body-sm mt-5 flex min-h-11 items-center gap-2 text-fg-2">
        <input type="checkbox" className="h-4 w-4 accent-[var(--spak-primary)]" checked={pickAccount} onChange={(e) => setPickAccount(e.target.checked)} />
        Let me choose a different account (EVM and Solana)
      </label>
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
