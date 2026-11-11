"use client";
import { useCallback, useEffect, useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import type { DepositTransaction } from "@/deposits/builder";
import type { DepositView } from "@/deposits/service";
import { api, formatUnits, type ExecutionView } from "@/lib/client";
import { watchEvmWallets, type EvmWalletInfo } from "@/wallets/evm";
import { watchSolanaWallets, type SolanaWalletInfo } from "@/wallets/solana";
import { checkEvmWallet, checkSolanaWallet, requestEvmAccounts, requestEvmNetwork, sendEvmDeposit, sendSolanaDeposit } from "@/wallets/deposit";
import { classifyWalletError } from "@/wallets/errors";
import { Amount, Button, ErrorText, Mono, Panel, Row, inputCls } from "./ui";
import { DEPOSIT_LABEL, Notice, StatusBadge } from "./status";
import { Icon } from "./icons";

interface Prepared { deposit: DepositView; transaction: DepositTransaction; balance: { balance: string | null; sufficient: boolean | null } }
const LIVE = ["SUBMITTED", "VERIFICATION_PENDING", "CONFIRMED"];

/**
 * Steps 3 to 7: confirm wallet details, authorize the deposit in the wallet, submit the transaction reference,
 * and follow the server's on-chain verification. Nothing here claims funds moved until the server confirms.
 */
export function DepositPanel({ execution }: { execution: ExecutionView }) {
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [dep, setDep] = useState<DepositView | null>(null);
  const [evm, setEvm] = useState<EvmWalletInfo[]>([]);
  const [sol, setSol] = useState<SolanaWalletInfo[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [check, setCheck] = useState<{ accountOk: boolean; networkOk: boolean; account: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState("");
  const family = getNetwork(execution.source.network)?.family;
  const network = getNetwork(execution.source.network)?.name ?? execution.source.network;

  useEffect(() => {
    api<{ deposits: DepositView[] }>(`/api/executions/${execution.id}/deposits`).then((r) => setDep(r.deposits.find((d) => LIVE.includes(d.state)) ?? null)).catch(() => {});
    const a = watchEvmWallets(setEvm), b = watchSolanaWallets(setSol);
    return () => { a(); b(); };
  }, [execution.id]);

  // Step 6: follow server-side verification until a final answer.
  useEffect(() => {
    if (!dep || !["SUBMITTED", "VERIFICATION_PENDING"].includes(dep.state)) return;
    const t = setInterval(async () => { try { setDep(await api<DepositView>(`/api/deposits/${dep.id}/verify`, {})); } catch { /* retry next tick */ } }, 5000);
    return () => clearInterval(t);
  }, [dep]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(undefined);
    try { await fn(); } catch (e) { setError(classifyWalletError(e).message); } finally { setBusy(null); }
  };
  const prepare = () => run("prepare", async () => { const p = await api<Prepared>(`/api/executions/${execution.id}/deposits`, {}); setPrep(p); setCheck(null); });

  const evmWallet = evm.find((w) => w.id === picked), solWallet = sol.find((w) => w.id === picked);
  const recheck = useCallback(async () => {
    if (!prep) return;
    if (prep.transaction.family === "evm" && evmWallet) setCheck(await checkEvmWallet(evmWallet, prep.transaction));
    if (prep.transaction.family === "solana" && solWallet) { const c = checkSolanaWallet(solWallet, prep.transaction, prep.deposit.sender); setCheck({ accountOk: c.accountOk, networkOk: c.chainOk && c.canSend, account: c.account }); }
  }, [prep, evmWallet, solWallet]);
  useEffect(() => { recheck().catch(() => setCheck(null)); }, [recheck]);

  // Steps 4 and 5: the wallet signs and broadcasts; the reference goes to the server for verification.
  const send = () => run("send", async () => {
    if (!prep) return;
    let txHash: string;
    try {
      if (prep.transaction.family === "evm" && evmWallet) txHash = await sendEvmDeposit(evmWallet, prep.transaction);
      else if (prep.transaction.family === "solana" && solWallet) txHash = await sendSolanaDeposit(solWallet, prep.transaction, prep.deposit.sender);
      else throw new Error("Choose a wallet first.");
    } catch (e) {
      if (classifyWalletError(e).kind === "CANCELLED") await api(`/api/deposits/${prep.deposit.id}/reject`, { reason: "Rejected in the wallet" }).catch(() => {});
      setPrep(null);
      throw e;
    }
    setDep(await api<DepositView>(`/api/deposits/${prep.deposit.id}/submit`, { txHash }));
    setPrep(null);
  });
  const submitManual = () => run("manual", async () => { setDep(await api<DepositView>(`/api/executions/${execution.id}/deposits/manual`, { txHash: manual.trim() })); setPrep(null); });

  if (dep && LIVE.includes(dep.state)) {
    return (
      <Panel className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="type-label text-fg-2">Step {dep.state === "CONFIRMED" ? "7" : "6"} of 7</p>
          <StatusBadge kind="deposit" state={dep.state} />
        </div>
        <Row k="Transaction" v={<Mono value={dep.txHash ?? ""} full />} />
        {dep.confirmations !== null && <Row k="Confirmations" v={<span className="type-amount">{dep.confirmations}</span>} />}
        {dep.reason && dep.state !== "CONFIRMED" && <Row k="Note" v={dep.reason} />}
        <p className="type-body-sm mt-3 text-fg-2">
          {dep.state === "CONFIRMED"
            ? `The deposit is confirmed on ${network}. The cross-chain transfer is a separate step; its status is below.`
            : "SPak only reports a deposit once the source chain confirms it. Do not send it again."}
        </p>
      </Panel>
    );
  }

  const tx = prep?.transaction;
  const wallets = family === "evm" ? evm.map((w) => ({ id: w.id, name: w.name })) : family === "solana" ? sol.map((w) => ({ id: w.id, name: w.name })) : [];
  const ok = (good: boolean, text: string) => (
    <p className="type-body-sm flex items-start gap-2" style={{ color: `var(--spak-status-${good ? "success" : "error"}-foreground)` }}>
      <Icon name={good ? "success" : "error"} size={16} className="mt-0.5 shrink-0" />{text}
    </p>
  );
  return (
    <div className="mb-5 rounded-card border p-4 sm:p-5" style={{ borderColor: "var(--spak-status-pending-border)", background: "var(--spak-status-pending-background)" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="type-app-subheading text-fg">Step 3 of 7: send the deposit</p>
        <StatusBadge state="AWAITING_DEPOSIT" />
      </div>
      <div className="rounded-card border border-line bg-elevated px-4 py-1 dark:bg-bg">
        <Row k="Send exactly" v={<Amount value={formatUnits(execution.source.amountIn, execution.source.assetId)} size="amount-total" />} />
        <Row k="On" v={network} />
        {execution.deposit && <Row k="To deposit address" v={<Mono value={execution.deposit.address} full />} />}
        {execution.deposit?.memo && <Row k="Memo (required)" v={<Mono value={execution.deposit.memo} full />} />}
        {execution.deposit?.deadline && <Row k="Before" v={new Date(execution.deposit.deadline).toLocaleString()} />}
        <Row k="From your verified wallet" v={<Mono value={execution.refundAddress} full />} />
      </div>
      {dep && ["REJECTED", "FAILED", "EXPIRED"].includes(dep.state) && (
        <Notice role={dep.state === "EXPIRED" ? "neutral" : "error"} title={`Last attempt: ${DEPOSIT_LABEL[dep.state]}`} className="mt-3">{dep.reason ?? undefined}</Notice>
      )}

      {!tx && family !== "near" && <Button className="mt-4 w-full sm:w-auto" onClick={prepare} disabled={!!busy}>{busy === "prepare" ? "Preparing" : "Prepare deposit"}</Button>}

      {tx && tx.family !== "near" && (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <p className="type-label text-fg-2">Your wallet will be asked to</p>
            <ul className="type-body-sm mt-1 list-disc pl-5 text-fg">{tx.steps.map((s) => <li key={s.action}><b>{s.action}</b>: {s.detail}</li>)}</ul>
          </div>
          <p className="type-body-sm text-fg-2">No token allowance (approve) is requested. Balance: {prep?.balance.balance !== null ? <span className="type-amount-fee text-fg">{formatUnits(prep!.balance.balance!, execution.source.assetId)}</span> : "could not be read; the wallet will check"}.</p>
          <p className="type-label text-fg-2">Step 4: choose the wallet that holds <span className="type-address text-fg">{execution.refundAddress.slice(0, 8)}…</span></p>
          <div className="flex flex-wrap gap-2">
            {wallets.length ? wallets.map((w) => <Button key={w.id} variant={picked === w.id ? "primary" : "ghost"} aria-pressed={picked === w.id} onClick={() => setPicked(w.id)}>{w.name}</Button>)
              : <span className="type-body-sm text-fg-2">No {family === "evm" ? "EVM" : "Solana"} wallet found in this browser.</span>}
          </div>
          {picked && check && (
            <div className="flex flex-col gap-1">
              {ok(check.accountOk, `Account: ${check.accountOk ? "matches your verified wallet" : `wallet shows ${check.account ?? "no account"}; switch to ${execution.refundAddress} in the wallet`}`)}
              {tx.family === "evm" && ok(check.networkOk, `Network: ${check.networkOk ? network : `wallet is on a different network; ${network} is required`}`)}
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {picked && evmWallet && check && !check.account && <Button variant="ghost" onClick={() => run("acct", async () => { await requestEvmAccounts(evmWallet); await recheck(); })}>Connect account in wallet</Button>}
            {picked && evmWallet && tx.family === "evm" && check && !check.networkOk && (
              <Button variant="ghost" onClick={() => run("net", async () => { await requestEvmNetwork(evmWallet, tx.chainId); await recheck(); })}>Ask wallet to switch to {network}</Button>
            )}
            <Button onClick={send} disabled={!!busy || !picked || !check?.accountOk || (tx.family === "evm" && !check?.networkOk)}>{busy === "send" ? "Confirm in your wallet" : "Send deposit with wallet"}</Button>
          </div>
        </div>
      )}

      {(family === "near" || tx) && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="type-body-sm mb-2 text-fg-2">{family === "near" ? "NEAR deposits are sent from your NEAR wallet. Paste the transaction hash; SPak verifies it on chain." : "Sent it another way? Paste the transaction hash; SPak verifies it on chain."}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor={`manual-${execution.id}`}>Transaction hash</label>
            <input id={`manual-${execution.id}`} className={`${inputCls} type-address flex-1`} placeholder="Transaction hash" value={manual} onChange={(e) => setManual(e.target.value)} />
            <Button variant="secondary" onClick={submitManual} disabled={!!busy || manual.trim().length < 10}>Submit</Button>
          </div>
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
