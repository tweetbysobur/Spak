"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui";
import type { FundingView } from "@/agents/funding";

const near = (y: string) => `${(Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} NEAR`;
const RESULT: Record<FundingView["result"], { text: string; role: string }> = {
  FUNDED: { text: "Funded", role: "success" }, UNFUNDED: { text: "Not funded", role: "warning" }, INCONCLUSIVE: { text: "Could not read NEAR", role: "warning" },
};
const REASON: Record<string, string> = {
  BELOW_MINIMUM: "Below the minimum SPak counts as funded.", ACCOUNT_NOT_FOUND: "NEAR does not show this account.",
  NEAR_UNREACHABLE: "NEAR testnet did not answer. Nothing is assumed.", UNREADABLE_BALANCE: "NEAR returned a balance SPak could not read.",
};

/**
 * Funding of the dedicated testnet account (Stage 9). You fund it from your own wallet; SPak sends nothing and holds
 * no key on it. What is shown is what the server last read from NEAR, with the time it read it.
 */
export function AgentFunding({ agentId, accountId }: { agentId: string; accountId: string }) {
  const [f, setF] = useState<FundingView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { api<{ funding: FundingView | null }>(`/api/agents/${agentId}/account/funding`).then((r) => setF(r.funding)).catch(() => setF(null)); }, [agentId]);
  async function check() {
    setBusy(true); setError(undefined);
    try { setF((await api<{ funding: FundingView }>(`/api/agents/${agentId}/account/funding`, {})).funding); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="sm:col-span-2 border-t border-line pt-3" data-agent-funding={f?.result ?? "NONE"}>
      <p className="type-label text-fg-2">Funding</p>
      <p className="type-body-sm mt-1 text-fg-2">To fund it, send testnet NEAR from your own wallet to <span className="type-address text-fg [overflow-wrap:anywhere]">{accountId}</span>. SPak only reads the balance.</p>
      {f ? (
        <ul className="type-body-sm mt-2 flex flex-col gap-0.5">
          <li><span className="type-status" style={{ color: `var(--spak-status-${RESULT[f.result].role}-foreground)` }}>{RESULT[f.result].text}</span>{f.reason ? <span className="text-fg-2"> · {REASON[f.reason] ?? f.reason}</span> : null}</li>
          {f.spendableYocto && <li className="text-fg-2">Spendable: <span className="type-amount text-fg">{near(f.spendableYocto)}</span> (minimum {near(f.minimumYocto)})</li>}
          <li className="type-caption text-fg-2">Read from NEAR {new Date(f.checkedAt).toLocaleString()}</li>
        </ul>
      ) : f === null ? <p className="type-body-sm mt-2 text-fg-2">Not checked yet.</p> : null}
      {error && <p className="type-body-sm mt-2 text-[var(--spak-status-error-foreground)]">{error}</p>}
      <Button className="mt-2" size="sm" variant="ghost" disabled={busy} onClick={check}>{busy ? "Reading NEAR" : "Check balance on NEAR"}</Button>
    </div>
  );
}
