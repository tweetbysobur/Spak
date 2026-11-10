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
import { Button, inputCls, Row } from "./ui";

interface Prepared { deposit: DepositView; transaction: DepositTransaction; balance: { balance: string | null; sufficient: boolean | null } }
const LIVE = ["SUBMITTED", "VERIFICATION_PENDING", "CONFIRMED"];
const DEPOSIT_LABEL: Record<string, string> = {
  WALLET_CONFIRMATION_REQUESTED: "Waiting for your wallet", SUBMITTED: "Submitted, not verified yet", VERIFICATION_PENDING: "Verifying on chain",
  CONFIRMED: "Deposit confirmed on chain", REJECTED: "Deposit rejected", FAILED: "Deposit transaction failed", EXPIRED: "Deposit expired",
};

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
      <div className="mb-4 rounded-xl border border-white/10 p-4 text-sm">
        <p className="mb-2 font-medium">Step {dep.state === "CONFIRMED" ? "7" : "6"} of 7: {DEPOSIT_LABEL[dep.state]}</p>
        <Row k="Transaction" v={dep.txHash} mono />
        {dep.confirmations !== null && <Row k="Confirmations" v={String(dep.confirmations)} />}
        {dep.reason && dep.state !== "CONFIRMED" && <Row k="Note" v={dep.reason} />}
        <p className="mt-2 text-xs text-white/50">
          {dep.state === "CONFIRMED"
            ? `The deposit is confirmed on ${network}. The cross-chain transfer is a separate step; its status is below.`
            : "SPak only reports a deposit once the source chain confirms it. Do not send it again."}
        </p>
      </div>
    );
  }

  const tx = prep?.transaction;
  const wallets = family === "evm" ? evm.map((w) => ({ id: w.id, name: w.name })) : family === "solana" ? sol.map((w) => ({ id: w.id, name: w.name })) : [];
  return (
    <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm">
      <p className="mb-2 font-medium text-amber-200">Step 3 of 7: send the deposit</p>
      <Row k="Send exactly" v={formatUnits(execution.source.amountIn, execution.source.assetId)} />
      <Row k="On" v={network} />
      {execution.deposit && <Row k="To deposit address" v={execution.deposit.address} mono />}
      {execution.deposit?.memo && <Row k="Memo (required)" v={execution.deposit.memo} mono />}
      {execution.deposit?.deadline && <Row k="Before" v={new Date(execution.deposit.deadline).toLocaleString()} />}
      <Row k="From your verified wallet" v={execution.refundAddress} mono />
      {dep && ["REJECTED", "FAILED", "EXPIRED"].includes(dep.state) && <p className="mt-2 text-xs text-red-300">Last attempt: {DEPOSIT_LABEL[dep.state]}{dep.reason ? `. ${dep.reason}` : ""}</p>}

      {!tx && family !== "near" && <Button className="mt-3" onClick={prepare} disabled={!!busy}>{busy === "prepare" ? "Preparing" : "Prepare deposit"}</Button>}

      {tx && tx.family !== "near" && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-white/60">Your wallet will be asked to:</p>
          <ul className="list-disc pl-4 text-xs text-white/70">{tx.steps.map((s) => <li key={s.action}><b>{s.action}</b>: {s.detail}</li>)}</ul>
          <p className="text-xs text-white/50">No token allowance (approve) is requested. Balance: {prep?.balance.balance !== null ? formatUnits(prep!.balance.balance!, execution.source.assetId) : "could not be read; the wallet will check"}.</p>
          <p className="text-xs text-white/60">Step 4: choose the wallet that holds {execution.refundAddress.slice(0, 8)}…</p>
          <div className="flex flex-wrap gap-2">
            {wallets.length ? wallets.map((w) => <Button key={w.id} variant={picked === w.id ? "primary" : "ghost"} onClick={() => setPicked(w.id)}>{w.name}</Button>)
              : <span className="text-xs text-white/50">No {family === "evm" ? "EVM" : "Solana"} wallet found in this browser.</span>}
          </div>
          {picked && check && (
            <div className="text-xs">
              <p className={check.accountOk ? "text-emerald-300" : "text-red-300"}>Account: {check.accountOk ? "matches your verified wallet" : `wallet shows ${check.account ?? "no account"}; switch to ${execution.refundAddress} in the wallet`}</p>
              {tx.family === "evm" && <p className={check.networkOk ? "text-emerald-300" : "text-red-300"}>Network: {check.networkOk ? network : `wallet is on a different network; ${network} is required`}</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {picked && evmWallet && check && !check.account && <Button variant="ghost" onClick={() => run("acct", async () => { await requestEvmAccounts(evmWallet); await recheck(); })}>Connect account in wallet</Button>}
            {picked && evmWallet && tx.family === "evm" && check && !check.networkOk && (
              <Button variant="ghost" onClick={() => run("net", async () => { await requestEvmNetwork(evmWallet, tx.chainId); await recheck(); })}>Ask wallet to switch to {network}</Button>
            )}
            <Button onClick={send} disabled={!!busy || !picked || !check?.accountOk || (tx.family === "evm" && !check?.networkOk)}>{busy === "send" ? "Confirm in your wallet" : "Send deposit with wallet"}</Button>
          </div>
        </div>
      )}

      {(family === "near" || tx) && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="mb-2 text-xs text-white/60">{family === "near" ? "NEAR deposits are sent from your NEAR wallet. Paste the transaction hash; SPak verifies it on chain." : "Sent it another way? Paste the transaction hash; SPak verifies it on chain."}</p>
          <div className="flex gap-2">
            <input className={`${inputCls} flex-1 font-mono`} placeholder="Transaction hash" value={manual} onChange={(e) => setManual(e.target.value)} />
            <Button variant="ghost" onClick={submitManual} disabled={!!busy || manual.trim().length < 10}>Submit</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
