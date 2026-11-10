"use client";
import { useRef, useState } from "react";
import { getNetwork } from "@/spak-in/registries/networks";
import { api, type IntentResult, type ProviderQuote } from "@/lib/client";
import { Button, Card, inputCls } from "./ui";

interface Msg { from: "you" | "spak"; text: string; detail?: string[]; options?: string[] }

const EXAMPLES = ["Swap 50 USDC on Base to SOL on Solana", "Bridge 0.5 ETH from Ethereum to NEAR", "Transfer 50 USDC from Base to Arbitrum"];
const net = (id: string | null) => (id ? getNetwork(id)?.name ?? id : "?");

export function Chat({ addresses, timezone, onReady }: {
  addresses: Record<string, string>; timezone: string;
  onReady: (intent: IntentResult, quote: ProviderQuote) => void;
}) {
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const sessionId = useRef(`ses_${Math.random().toString(36).slice(2, 14)}`);

  async function send(input: string) {
    if (!input.trim() || busy) return;
    setText(""); setBusy(true);
    const add = (m: Msg) => setMsgs((p) => [...p, m]);
    add({ from: "you", text: input });
    try {
      const r = await api<IntentResult>("/api/spak-in/interpret", { text: input, sessionId: sessionId.current, wallets: addresses, timezone });
      const errs = [...r.errors.map((e) => e.message), ...(r.policy?.violations.map((v) => v.message) ?? [])];
      if (r.status === "NEEDS_CLARIFICATION") {
        add({ from: "spak", text: "I need a bit more before I can do this.", detail: [...errs, ...r.clarifications.map((c) => c.question)], options: r.clarifications.find((c) => c.options?.length)?.options?.slice(0, 6) });
      } else if (r.status !== "VALIDATED") {
        add({ from: "spak", text: r.status === "POLICY_REJECTED" ? "Your Guard settings block this." : r.status === "UNSUPPORTED" ? "SPak cannot do this yet." : "This instruction has a problem.", detail: errs });
      } else if (!r.plan?.executable) {
        add({ from: "spak", text: `Understood: ${r.intentType.replaceAll("_", " ").toLowerCase()}. This needs ${r.plan?.requires.join(", ").toLowerCase() || "features"} that are not live yet, so nothing will run.`, detail: r.plan?.steps.map((s) => s.description) });
      } else {
        add({ from: "spak", text: `Understood in ${r.meta.processingMs}ms. Getting a NEAR Intents quote for ${net(r.source.network)} → ${net(r.destination.network)}.`, detail: r.assumptions });
        const q = await api<ProviderQuote>("/api/spak-in/quote", { plan: r.plan });
        add({ from: "spak", text: `Quote ready: about ${q.amountOut} ${r.destination.asset?.symbol}. Review it below.` });
        onReady(r, q);
      }
    } catch (err) {
      add({ from: "spak", text: `Something failed: ${(err as Error).message}` });
    } finally { setBusy(false); }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex max-h-96 min-h-32 flex-col gap-3 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((x) => (
              <button key={x} onClick={() => setText(x)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5">{x}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm ${m.from === "you" ? "self-end bg-emerald-400/15" : "self-start bg-white/5"}`}>
            <p>{m.text}</p>
            {!!m.detail?.length && <ul className="mt-1.5 list-disc pl-4 text-xs text-white/60">{m.detail.map((d) => <li key={d}>{d}</li>)}</ul>}
            {!!m.options?.length && i === msgs.length - 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.options.map((o) => (
                  <button key={o} onClick={() => send(getNetwork(o) ? `on ${getNetwork(o)!.name}` : o)} className="rounded-full border border-white/15 px-2.5 py-1 text-xs hover:bg-white/10">{getNetwork(o)?.name ?? o}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(text.trim()); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell SPak what to do" className={`${inputCls} flex-1`} />
        <Button type="submit" disabled={busy || !text.trim()}>{busy ? "Working" : "Send"}</Button>
      </form>
    </Card>
  );
}
