import { NextResponse } from "next/server";
import { getStatus } from "@/lib/execution/oneclick";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const depositAddress = url.searchParams.get("depositAddress");
  if (!depositAddress) return NextResponse.json({ error: "depositAddress is required." }, { status: 400 });
  try {
    return NextResponse.json(await getStatus(depositAddress, url.searchParams.get("deadline") ?? undefined));
  } catch (e) {
    return NextResponse.json({ state: "unknown", error: (e as Error).message }, { status: 502 });
  }
}
