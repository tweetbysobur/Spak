import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ExecutionError } from "@/execution";

/**
 * Reviewer authentication, separate from user sessions: a server-side bearer token (SPAK_ADMIN_TOKEN, 32+ chars)
 * plus a reviewer name for the audit trail. A user session cookie never grants review access. Fails closed.
 */
export function adminAuth(req: Request): { reviewer: string } | Response {
  const token = process.env.SPAK_ADMIN_TOKEN;
  if (!token || token.length < 32) return NextResponse.json({ error: { code: "ADMIN_NOT_CONFIGURED" } }, { status: 503 });
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const h = (s: string) => createHash("sha256").update(s).digest();
  if (!got || !timingSafeEqual(h(got), h(token))) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  const reviewer = req.headers.get("x-spak-reviewer") ?? "";
  if (!/^[A-Za-z0-9._@-]{2,64}$/.test(reviewer)) return NextResponse.json({ error: { code: "REVIEWER_REQUIRED", message: "Send X-SPak-Reviewer with your name." } }, { status: 400 });
  return { reviewer };
}

export async function adminHandle(req: Request, fn: (reviewer: string) => Promise<Response>): Promise<Response> {
  const a = adminAuth(req);
  if (a instanceof Response) return a;
  try { return await fn(a.reviewer); } catch (e) {
    if (e instanceof ExecutionError) return NextResponse.json({ error: e.toJSON() }, { status: e.status });
    if (e instanceof ZodError || e instanceof SyntaxError) return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
    console.error("[spak-admin]", (e as Error).message);
    return NextResponse.json({ error: { code: "INTERNAL" } }, { status: 500 });
  }
}
