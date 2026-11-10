import { NextResponse } from "next/server";
import { z } from "zod";
import { WALLET_FAMILIES } from "@/auth/types";
import { appOrigin, authService, currentUser, rateLimit, route } from "@/server/auth";

const body = z.object({
  family: z.enum(WALLET_FAMILIES),
  address: z.string().min(2).max(100),
  purpose: z.enum(["SIGN_IN", "LINK"]).default("SIGN_IN"),
  chainId: z.number().int().positive().max(2 ** 31).optional(),
});

/** POST /api/auth/challenge  Issue a one-time message for the wallet to sign. LINK needs a session. */
export async function POST(req: Request) {
  return route(req, async () => {
    rateLimit(req, "auth-challenge", 10);
    const b = body.parse(await req.json());
    const user = b.purpose === "LINK" ? await currentUser(req) : null;
    const origin = appOrigin(req);
    const c = await (await authService()).createChallenge({ ...b, userId: user?.userId ?? null, domain: origin.host, uri: origin.origin });
    return NextResponse.json(c);
  });
}
