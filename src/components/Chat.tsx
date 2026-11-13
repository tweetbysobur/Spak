"use client";
import { useEffect, useRef, useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { api, formatUnits, startExecution, type ExecutionView, type IntentResult, type QuoteView } from "@/lib/client";
import { Button, Card, SectionTitle, inputCls } from "./ui";
import { guardMessage, planBlock } from "@/lib/guard";

interface Msg { from: "you" | "spak"; text: string; detail?: string[]; options?: string[]; guard?: boolean }

const EXAMPLES = ["Swap 100 USDC on Base to ETH on Arbitrum", "Swap 50 USDC on Base to SOL on Solana", "Bridge 0.5 ETH from Ethereum to NEAR"];
const net = (id: string | null) => (id ? getNetwork(id)?.name ?? id : "?");

export function Chat({ timezone, onReady, onInterpret, initial }: {
  timezone: string;
  onReady: (intent: IntentResult, execution: ExecutionView, quote: QuoteView) => void;
  /** Called with every SPak-in result, so the page can show the interpretation in full. */
  onInterpret?: (r: IntentResult) => void;
  /** An instruction handed over from the dashboard. Sent once, on mount. */
  initial?: string;
}) {
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const sessionId = useRef(`chat_${Math.random().toString(36).slice(2, 14)}`);

  async function send(input: string) {
    if (!input.trim() || busy) return;
    setText(""); setBusy(true);
    const add = (m: Msg) => setMsgs((p) => [...p, m]);
    add({ from: "you", text: input });
    try {
      const r = await api<IntentResult>("/api/spak-in/interpret", { text: input, sessionId: sessionId.current, timezone });
      onInterpret?.(r);
      const errs = [...r.errors.map((e) => e.message), ...(r.policy?.violations.map((v) => v.message) ?? [])];
      if (r.status === "NEEDS_CLARIFICATION") {
        add({ from: "spak", text: "I need a bit more before I can do this.", detail: [...errs, ...r.clarifications.map((c) => c.question)], options: r.clarifications.find((c) => c.options?.length)?.options?.slice(0, 6) });
      } else if (r.status !== "VALIDATED") {
        add({ from: "spak", text: r.status === "POLICY_REJECTED" ? "Your Guard settings block this." : r.status === "UNSUPPORTED" ? "SPak cannot do this yet." : "This instruction has a problem.", detail: errs });
      } else if (!r.plan?.executable) {
        add({ from: "spak", text: `Understood: ${r.intentType.replaceAll("_", " ").toLowerCase()}. This needs ${r.plan?.requires.join(", ").toLowerCase() || "features"} that are not live yet, so nothing will run.`, detail: r.plan?.steps.map((s) => s.description) });
      } else if (planBlock(r.guard)) {
        // The server's Guard decision on this plan. Stop here: no execution is created.
        const b = planBlock(r.guard)!;
        add({ from: "spak", text: b.title, detail: [...b.reasons, "Nothing was quoted or created. You can change this in SPak Guard."], guard: true });
      } else {
        add({ from: "spak", text: `Understood in ${r.meta.processingMs}ms. Getting a NEAR Intents quote for ${net(r.source.network)} → ${net(r.destination.network)}.`, detail: r.assumptions });
        const { execution, quote: q } = await startExecution(r.plan.hash);
        add({ from: "spak", text: `Quote ready: about ${formatUnits(q.destination.amountOut, q.destination.assetId)}. Review it below.` });
        onReady(r, execution, q);
      }
    } catch (err) {
      const g = guardMessage(err);
      add(g ? { from: "spak", text: g.title, detail: g.reasons, guard: true } : { from: "spak", text: `Something failed: ${(err as Error).message}` });
    } finally { setBusy(false); }
  }

  const sent = useRef(false);
  useEffect(() => { if (initial && !sent.current) { sent.current = true; send(initial); } });

  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle sub="Describe a transfer in plain words. SPak plans it and gets a quote; nothing moves until you approve it and sign in your wallet.">Ask SPak</SectionTitle>
      <div className="flex max-h-[28rem] min-h-28 flex-col gap-3 overflow-y-auto" aria-live="polite">
        {msgs.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="type-label text-fg-2">Try an example</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((x) => (
                <button key={x} onClick={() => setText(x)} className="type-body-sm min-h-9 rounded-full border border-line-strong px-3 text-fg hover:bg-secondary dark:hover:bg-elevated">{x}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`type-body max-w-[92%] rounded-card [overflow-wrap:anywhere] px-4 py-3 ${m.from === "you" ? "self-end bg-primary text-on-primary" : "self-start border border-line bg-surface text-fg dark:bg-elevated"}`}>
            {m.guard ? <p data-guard-block className="inline-flex items-start gap-2 font-medium"><span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--spak-status-error-icon)]" />{m.text}</p> : <p>{m.text}</p>}
            {m.guard && <a href="#guard" className="type-body-sm mt-1.5 inline-block text-primary underline underline-offset-2">Open SPak Guard</a>}
            {!!m.detail?.length && <ul className={`type-body-sm mt-1.5 list-disc pl-4 ${m.from === "you" ? "" : "text-fg-2"}`}>{m.detail.map((d) => <li key={d}>{d}</li>)}</ul>}
            {!!m.options?.length && i === msgs.length - 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.options.map((o) => (
                  <button key={o} onClick={() => send(getNetwork(o) ? `on ${getNetwork(o)!.name}` : o)} className="type-button-sm min-h-9 rounded-full border border-line-strong bg-elevated px-3 text-fg hover:bg-secondary dark:bg-bg">{getNetwork(o)?.name ?? o}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(text.trim()); }} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="spak-intent">Instruction</label>
        <input id="spak-intent" value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: Swap 50 USDC on Base to SOL on Solana" className={`${inputCls} flex-1`} />
        <Button type="submit" disabled={busy || !text.trim()}>{busy ? "Working" : "Send"}</Button>
      </form>
    </Card>
  );
}
