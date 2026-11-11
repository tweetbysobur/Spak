import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ExecutionError } from "@/execution";
import { parseReviewers, resolveReviewer, type Reviewer } from "./reviewers";

/**
 * Reviewer authentication, separate from user sessions. Identity comes only from the credential:
 * Authorization: Bearer <personal reviewer token>. Any reviewer name in headers or bodies is ignored.
 * Fails closed when no reviewer is configured.
 */
export function adminAuth(req: Request): Reviewer | Response {
  const reviewers = parseReviewers(process.env.SPAK_REVIEWERS, process.env.SPAK_ADMIN_TOKEN);
  if (!reviewers.length) return NextResponse.json({ error: { code: "ADMIN_NOT_CONFIGURED" } }, { status: 503 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const who = resolveReviewer(token, reviewers);
  if (!who) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  return who;
}

export async function adminHandle(req: Request, fn: (reviewer: Reviewer) => Promise<Response>): Promise<Response> {
  const a = adminAuth(req);
  if (a instanceof Response) return a;
  try { return await fn(a); } catch (e) {
    if (e instanceof ExecutionError) return NextResponse.json({ error: e.toJSON() }, { status: e.status });
    if (e instanceof ZodError || e instanceof SyntaxError) return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
    console.error("[spak-admin]", (e as Error).message);
    return NextResponse.json({ error: { code: "INTERNAL" } }, { status: 500 });
  }
}
