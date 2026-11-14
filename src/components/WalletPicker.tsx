"use client";
import { useEffect, useState } from "react";
import { watchEvmWallets, type EvmWalletInfo } from "@/wallets/evm";
import { watchSolanaWallets, type SolanaWalletInfo } from "@/wallets/solana";
import { discoverNearWallets, type NearWalletInfo } from "@/wallets/near";
import { complete, needsSecondClick, prepare, type Prepared, type Purpose, type WalletChoice } from "@/wallets/flow";
import { classifyWalletError } from "@/wallets/errors";
import { Button, Card, ErrorText, Spinner } from "./ui";
import { Icon } from "./icons";

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
  const FAMILY = { evm: "EVM · Ethereum, Base, Arbitrum and 5 more", solana: "Solana", near: "NEAR" } as const;
  const row = (key: string, name: string, icon: string | undefined, family: keyof typeof FAMILY, choice: WalletChoice) => {
    const working = stage.kind === "working" && stage.key === key;
    const ready = stage.kind === "ready" && stage.key === key;
    return (
      <li key={key}>
        <button disabled={busy} onClick={() => start(key, choice)} aria-describedby={`${key}-family`}
          className="group flex min-h-14 w-full items-center gap-3 rounded-card border border-line bg-bg px-3 py-2.5 text-left transition-colors duration-150 hover:border-primary focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-elevated">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {icon ? <img src={icon} alt="" className="h-8 w-8 shrink-0 rounded-control" /> : <Icon name="wallet" size={20} className="mx-1.5 shrink-0 text-fg-2" />}
          <span className="min-w-0 flex-1">
            <span className="type-body block truncate text-fg">{name}</span>
            <span id={`${key}-family`} className="type-caption block truncate text-fg-2">{FAMILY[family]}</span>
          </span>
          {working ? <Spinner label={stage.label} /> : <Icon name="arrow" size={16} className="shrink-0 text-fg-3 transition-colors duration-150 group-hover:text-primary" />}
        </button>
        {ready && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={() => sign(stage.prepared, key)}>Open {name} to sign</Button>
            <Button variant="ghost" onClick={() => setStage({ kind: "idle" })}>Cancel</Button>
          </div>
        )}
      </li>
    );
  };

  const installed = [
    ...evm.map((w) => row(`evm:${w.id}`, w.name, w.icon, "evm", { family: "evm", info: w })),
    ...sol.map((w) => row(`sol:${w.id}`, w.name, w.icon, "solana", { family: "solana", info: w })),
    ...(near ?? []).filter((w) => w.available).map((w) => row(`near:${w.id}`, w.name, w.icon, "near", { family: "near", id: w.id, name: w.name })),
  ];
  const missing = [
    !evm.length && "No EVM wallet found. Install MetaMask, Rabby or another EVM wallet extension.",
    !sol.length && "No Solana wallet found. Install Phantom or another Wallet Standard wallet.",
    near !== null && !near.some((w) => w.available) && "No NEAR wallet found. Install Meteor Wallet.",
  ].filter(Boolean) as string[];

  return (
    <Card className="!border-primary lg:sticky lg:top-8">
      <h2 className="type-app-heading text-fg">{purpose === "SIGN_IN" ? "Sign in with a wallet" : "Link another wallet"}</h2>
      <p className="type-body-sm mt-1 text-fg-2">{purpose === "SIGN_IN" ? "Choose a wallet installed in this browser." : "Choose the wallet to add to your SPak account."}</p>

      {installed.length > 0 && <ul className="mt-5 flex flex-col gap-2" aria-label="Wallets in this browser">{installed}</ul>}
      {near === null && <div className="mt-5"><Spinner label="Looking for wallets" /></div>}
      {near !== null && installed.length === 0 && <p className="type-body mt-5 text-fg">No wallet found in this browser.</p>}

      {missing.length > 0 && near !== null && (
        <ul className={`flex flex-col gap-1.5 ${installed.length ? "mt-5 border-t border-line pt-4" : "mt-2"}`}>
          {missing.map((m) => <li key={m} className="type-body-sm text-fg-2">{m}</li>)}
        </ul>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      <div className="mt-5 border-t border-line pt-4">
        <label className="type-body-sm flex min-h-11 items-center gap-2 text-fg-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--spak-primary)]" checked={pickAccount} onChange={(e) => setPickAccount(e.target.checked)} />
          Choose a different account in my wallet
        </label>
        <p className="type-caption mt-2 text-fg-2">Signing is free and gives SPak no access to your funds.</p>
      </div>
    </Card>
  );
}
