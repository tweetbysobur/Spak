"use client";
import { useState } from "react";
import { FIELD_PROMPTS, type InterpretResult } from "@/lib/spak-in";
import { NETWORKS } from "@/lib/spak-in/catalog";
import { postJSON, type QuoteRequest, type QuoteView } from "@/lib/client";
import { Button, Card, inputCls } from "./ui";

interface Msg { from: "you" | "spak"; text: string; detail?: string[] }

const EXAMPLES = ["Swap 50 USDC on Base to SOL on Solana", "Bridge 0.1 ETH from Ethereum to Base", "Send 25 USDC on Base to 0x… on Arbitrum"];

export function Chat({ addresses, onQuote }: { addresses: Record<string, string>; onQuote: (r: QuoteRequest, q: QuoteView) => void }) {
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const input = text.trim();
    setText(""); setBusy(true);
    const add = (m: Msg) => setMsgs((p) => [...p, m]);
    add({ from: "you", text: input });
    try {
      const r = await postJSON<InterpretResult & { ms: number }>("/api/intent", { text: input, context: { addresses } });
      if (r.status === "rejected") add({ from: "spak", text: "I can't run this.", detail: r.issues });
      else if (r.status === "needs_info") {
        add({ from: "spak", text: "I need a bit more before I can quote this.", detail: [...r.issues, ...r.missing.map((m) => FIELD_PROMPTS[m]), ...(r.missing.some((m) => m === "recipient" || m === "refundTo") ? ["Tip: add your addresses under Your addresses, or include one in the instruction."] : [])] });
      } else {
        const i = r.intent;
        add({ from: "spak", text: `Understood in ${r.ms}ms: ${i.amount} ${i.sourceToken} on ${NETWORKS[i.sourceNetwork].name} → ${i.destToken} on ${NETWORKS[i.destNetwork].name}. Getting a NEAR Intents quote.`, detail: r.assumptions });
        const req: QuoteRequest = { ...i, slippageBps: r.plan.slippageBps };
        const q = await postJSON<QuoteView>("/api/quote", req);
        add({ from: "spak", text: `Quote ready: about ${q.amountOutFormatted} ${q.destination.symbol}. Review it below.` });
        onQuote(req, q);
      }
    } catch (err) {
      add({ from: "spak", text: `Quote failed: ${(err as Error).message}` });
    } finally { setBusy(false); }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex max-h-80 min-h-32 flex-col gap-3 overflow-y-auto">
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
            {m.detail && m.detail.length > 0 && (
              <ul className="mt-1.5 list-disc pl-4 text-xs text-white/60">{m.detail.map((d) => <li key={d}>{d}</li>)}</ul>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell SPak what to do" className={`${inputCls} flex-1`} />
        <Button type="submit" disabled={busy || !text.trim()}>{busy ? "Working" : "Send"}</Button>
      </form>
    </Card>
  );
}
