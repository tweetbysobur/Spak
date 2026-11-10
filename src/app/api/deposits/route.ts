import { NextResponse } from "next/server";
import { z } from "zod";
import { executionContext, idSchema } from "@/server/execution";
import { handle, spak } from "@/server/spak";

/** GET /api/deposits?executionId=&limit=  Deposit history, newest first. */
export async function GET(req: Request) {
  return handle(req, async () => {
    const c = await executionContext(req);
    const u = new URL(req.url);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), executionId: idSchema("exe").optional() })
      .parse({ limit: u.searchParams.get("limit") ?? undefined, executionId: u.searchParams.get("executionId") ?? undefined });
    return NextResponse.json({ items: await (await spak()).deposits.list(c.userId, q) });
  });
}
