import { NextResponse } from "next/server";
import { ExecutionError, getQuote } from "@/lib/execution/oneclick";
import { NETWORKS, isValidAddressFor } from "@/lib/spak-in";

const MAX_SLIPPAGE_BPS = 500;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const fields = ["amount", "sourceToken", "sourceNetwork", "destToken", "destNetwork", "recipient", "refundTo"] as const;
  if (!b || fields.some((f) => typeof b[f] !== "string" || !(b[f] as string).trim())) {
    return NextResponse.json({ error: `Required: ${fields.join(", ")}.` }, { status: 400 });
  }
  const s = Object.fromEntries(fields.map((f) => [f, (b[f] as string).trim()])) as Record<(typeof fields)[number], string>;
  const slippageBps = Number(b.slippageBps ?? 100);
  const approved = b.approved === true;

  const problems: string[] = [];
  if (!(Number(s.amount) > 0)) problems.push("Amount must be greater than zero.");
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) problems.push(`Slippage must be 1 to ${MAX_SLIPPAGE_BPS} bps.`);
  for (const [n, addr, label] of [[s.destNetwork, s.recipient, "Recipient"], [s.sourceNetwork, s.refundTo, "Refund address"]] as const) {
    if (!NETWORKS[n]) problems.push(`Unsupported network ${n}.`);
    else if (isValidAddressFor(n, addr) === false) problems.push(`${label} is not a valid ${NETWORKS[n].name} address.`);
  }
  if (problems.length) return NextResponse.json({ error: problems.join(" ") }, { status: 400 });

  try {
    // A non-dry quote creates a real deposit address. Only issue one after explicit approval.
    const quote = await getQuote({ ...s, slippageBps, dry: !approved });
    return NextResponse.json(quote);
  } catch (e) {
    const status = e instanceof ExecutionError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
