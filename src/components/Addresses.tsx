"use client";
import { useState } from "react";
import { NETWORKS, isValidAddressFor } from "@/lib/spak-in";
import { Button, Card, inputCls } from "./ui";

const SHOWN = ["base", "eth", "arb", "op", "pol", "bsc", "sol", "near", "btc"];

export function Addresses({ value, onSave }: { value: Record<string, string>; onSave: (v: Record<string, string>) => void }) {
  const [draft, setDraft] = useState(value);
  const bad = Object.entries(draft).filter(([n, a]) => a && isValidAddressFor(n, a) === false).map(([n]) => n);
  return (
    <Card>
      <p className="mb-4 text-sm text-white/60">SPak uses these as default recipient and refund addresses. They are stored only in this browser. SPak never asks for keys.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SHOWN.map((n) => (
          <label key={n} className="flex flex-col gap-1 text-xs text-white/60">
            {NETWORKS[n].name}
            <input className={`${inputCls} font-mono ${bad.includes(n) ? "border-red-400/60" : ""}`} value={draft[n] ?? ""} onChange={(e) => setDraft({ ...draft, [n]: e.target.value.trim() })} />
          </label>
        ))}
      </div>
      {bad.length > 0 && <p className="mt-3 text-sm text-red-400">Invalid address for {bad.map((n) => NETWORKS[n].name).join(", ")}.</p>}
      <Button className="mt-4" disabled={bad.length > 0} onClick={() => onSave(Object.fromEntries(Object.entries(draft).filter(([, a]) => a)))}>Save addresses</Button>
    </Card>
  );
}
