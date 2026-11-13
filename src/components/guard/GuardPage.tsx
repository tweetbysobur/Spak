"use client";
import { useCallback, useState } from "react";
import { Button, Card, Spinner, Toast } from "@/components/ui";
import { Notice } from "@/components/status";
import { getNetwork } from "@/spak-in/registries/networks";
import { STATE_TEXT, guardState, type GuardView } from "@/lib/guard";
import { useGuard } from "./useGuard";
import { StatusDot } from "./parts";
import { Limits } from "./Limits";
import { Assets, Networks, Protection } from "./Permissions";
import { Recipients } from "./Recipients";
import { Emergency } from "./Emergency";
import { History } from "./History";

/** SPak Guard: the user's own settings, read from and saved to the server. */
export function GuardPage() {
  const [toast, setToast] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const onSaved = useCallback((m: string) => { setToast(m); setHistoryKey((k) => k + 1); }, []);
  const { view, state, load, run } = useGuard(onSaved);

  if (state === "loading") return <Card><Spinner label="Loading your Guard settings" /></Card>;
  if (!view) {
    const s = STATE_TEXT.UNAVAILABLE;
    return (
      <div data-guard-state={state === "unavailable" ? "UNAVAILABLE" : "ERROR"}>
        <Notice role="warning" title={state === "unavailable" ? s.title : "Guard settings could not be loaded"}>
          <p>{s.body}</p>
          <Button className="mt-3" size="sm" variant="ghost" onClick={() => load()}>Try again</Button>
        </Notice>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <StatusPanel view={view} />
      <Limits view={view} run={run} />
      <Protection view={view} run={run} />
      <Recipients view={view} run={run} />
      <Networks view={view} run={run} />
      <Assets view={view} run={run} />
      <Emergency view={view} run={run} />
      <History refreshKey={historyKey} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function StatusPanel({ view }: { view: GuardView }) {
  const s = guardState(view);
  const t = STATE_TEXT[s];
  return (
    <section data-guard-state={s} aria-live="polite" className="rounded-panel border border-line bg-elevated p-5 sm:p-6 dark:bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <StatusDot role={t.role}>Guard: {t.title}</StatusDot>
        <p className="type-caption text-fg-2">Version {view.policy.version} · updated {new Date(view.policy.updatedAt).toLocaleString()}</p>
      </div>
      <p className="type-body mt-2 max-w-2xl text-fg-2">{t.body}</p>
      {!!view.unconfiguredNetworks.length && (
        <p className="type-body-sm mt-2 text-fg-2">Needs a decision: {view.unconfiguredNetworks.map((n) => getNetwork(n)?.name ?? n).join(", ")}. Set them under Networks.</p>
      )}
      <p className="type-caption mt-3 text-fg-2">Every transfer still needs your approval in your wallet. Guard never approves for you.</p>
    </section>
  );
}
