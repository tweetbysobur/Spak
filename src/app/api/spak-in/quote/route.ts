import { NextResponse } from "next/server";
import { errorResponse, handle, spak } from "@/server/spak";

/** POST /api/spak-in/quote  { plan } -> provider quote. Dry run: no deposit address, nothing moves. */
export async function POST(req: Request) {
  return handle(async () => {
    const { plan } = await req.json();
    const r = await spak().coordinator.quote(plan);
    return r.ok ? NextResponse.json(r.value) : errorResponse(r.error);
  });
}
