import "server-only";
import { z } from "zod";
import type { VerifiedWallet } from "@/execution";
import { authService, requireUser } from "./auth";

/**
 * Execution API Controller helpers. Identity and wallets always come from the server-side session and the
 * user's verified wallets; nothing about ownership is read from the request body.
 */
export async function executionContext(req: Request) {
  const user = await requireUser(req);
  const wallets = (await (await authService()).listWallets(user.userId)).map((w): VerifiedWallet => ({ family: w.family, address: w.address, networks: w.networks }));
  return { userId: user.userId, wallets };
}

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, "Idempotency-Key must be 8-128 characters of letters, digits, _ . : -");
export const idSchema = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{24}$`), "invalid id");

export const createBody = z.object({
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const approveBody = z.object({
  quoteId: idSchema("qte"),
  approval: z.object({
    planHash: z.string().regex(/^[0-9a-f]{64}$/),
    approvedAt: z.string().datetime(),
    allowDuplicate: z.boolean().optional(),
  }),
});
