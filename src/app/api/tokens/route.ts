import { NextResponse } from "next/server";
import { getTokens } from "@/lib/execution/oneclick";
import { NETWORKS } from "@/lib/spak-in";

export async function GET() {
  try {
    const tokens = (await getTokens()).filter((t) => NETWORKS[t.blockchain]);
    return NextResponse.json(tokens.map(({ symbol, blockchain, decimals, price }) => ({ symbol, blockchain, decimals, price })));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
