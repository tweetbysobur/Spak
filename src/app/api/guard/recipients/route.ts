import { NextResponse } from "next/server";
import { rateLimit, requireUser } from "@/server/auth";
import { handle, spak } from "@/server/spak";

/** POST /api/guard/recipients  { version, network, address, label? }  Approve a recipient on one network. */
export async function POST(req: Request) {
  return handle(req, async () => {
    const u = await requireUser(req);
    rateLimit(req, "guard-write", 30, 60_000, u.userId);
    return NextResponse.json(await (await spak()).guard.addRecipient(u.userId, await req.json()), { status: 201 });
  });
}
