import { NextResponse } from "next/server";
import { interpret, type WalletContext } from "@/lib/spak-in";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: string; context?: WalletContext } | null;
  if (!body?.text || typeof body.text !== "string" || body.text.length > 500) {
    return NextResponse.json({ error: "Send { text } under 500 characters." }, { status: 400 });
  }
  const started = performance.now();
  const result = interpret(body.text, body.context ?? {});
  return NextResponse.json({ ...result, ms: Math.round((performance.now() - started) * 100) / 100 });
}
