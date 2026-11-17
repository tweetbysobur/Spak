import { NextResponse } from "next/server";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/**
 * GET  /api/payments/requests  The signed-in payee's payment requests (paid status refreshed from verified deliveries).
 * POST /api/payments/requests  Create one: amount, token and network, paid to one of the payee's own verified wallets.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "requests-read", 60, 60_000, u.userId);
    return NextResponse.json({ requests: await (await spak()).requests.list(u.userId) }, { headers: { "cache-control": "no-store" } });
  });
}
export async function POST(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    await rateLimit(req, "requests-write", 20, 60_000, u.userId);
    return NextResponse.json(await (await spak()).requests.create(u.userId, await req.json()), { status: 201 });
  });
}
