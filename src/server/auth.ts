import "server-only";
import { RateLimiter, trustedClientIp } from "@/ops/rate-limit";
import { logEvent } from "@/ops/log";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthService } from "@/auth/service";
import { AuthError } from "@/auth/types";
import { getDb } from "@/database";

const g = globalThis as unknown as { __spakAuth?: Promise<AuthService> };
export const authService = () => (g.__spakAuth ??= getDb().then((db) => new AuthService(db)));

// ------------------------------------------------------------------ origin and cookies

/**
 * The app's public origin. It goes into every sign-in message, so it must not come from request headers in
 * production: a phishing site could request a challenge naming its own domain, have the victim sign it there
 * (the wallet sees a matching domain and shows no warning) and relay the signature here.
 * Production requires SPAK_APP_ORIGIN. Development uses the Host header.
 */
export function appOrigin(req: Request): URL {
  if (process.env.SPAK_APP_ORIGIN) return new URL(process.env.SPAK_APP_ORIGIN);
  if (process.env.NODE_ENV === "production") throw new Error("SPAK_APP_ORIGIN must be set in production.");
  const u = new URL(req.url);
  return new URL(`${u.protocol}//${req.headers.get("host") ?? u.host}`);
}

const secureOrigin = (req: Request) => appOrigin(req).protocol === "https:";
/** __Host- prefix forces Secure, Path=/ and no Domain in browsers. Plain name only for http://localhost. */
export const cookieName = (req: Request) => (secureOrigin(req) ? "__Host-spak_session" : "spak_session");

export function sessionToken(req: Request): string | null {
  const name = cookieName(req);
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function setSessionCookie(res: NextResponse, req: Request, token: string, expiresAt: string) {
  res.cookies.set({
    name: cookieName(req), value: token, httpOnly: true, secure: secureOrigin(req), sameSite: "lax", path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(res: NextResponse, req: Request) {
  res.cookies.set({ name: cookieName(req), value: "", httpOnly: true, secure: secureOrigin(req), sameSite: "lax", path: "/", maxAge: 0 });
}

// ------------------------------------------------------------------ CSRF

/**
 * CSRF defence for state-changing requests, on top of SameSite=Lax cookies:
 * the Origin header must be this app. Requests with no Origin must be same-origin per Sec-Fetch-Site.
 */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== appOrigin(req).origin) throw new AuthError("CSRF", "Cross-site request refused.");
    return;
  }
  if (req.headers.get("sec-fetch-site") !== "same-origin") throw new AuthError("CSRF", "Cross-site request refused.");
}

// ------------------------------------------------------------------ rate limiting

/**
 * S-10: shared rate limiting (PostgreSQL, see src/ops/rate-limit.ts). Authenticated requests are limited per user;
 * unauthenticated ones per trusted client address (never a spoofable header unless the deployment says it is
 * overwritten by its proxy) and at half the limit. If the counter store cannot be reached the request is refused (503):
 * expensive provider and chain calls never run unmetered.
 */
export async function rateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000, key?: string): Promise<void> {
  const subject = key ? `u:${key}` : `ip:${trustedClientIp(req) ?? "unidentified"}`;
  const effective = key ? limit : Math.max(1, Math.ceil(limit / 2));
  let r;
  try {
    r = await new RateLimiter(await getDb()).hit(bucket, subject, effective, windowMs);
  } catch (e) {
    logEvent("error", "rate_limit.store_unavailable", { bucket, error: (e as Error).message });
    throw new AuthError("RATE_LIMIT_UNAVAILABLE", "SPak cannot check request limits right now. Try again shortly.");
  }
  if (!r.allowed) {
    logEvent("warn", "rate_limit.exceeded", { bucket, authenticated: !!key, count: r.count, limit: r.limit });
    throw new AuthError("RATE_LIMITED", "Too many requests. Wait a minute and try again.");
  }
}

// ------------------------------------------------------------------ guards

export async function currentUser(req: Request) {
  return (await authService()).validateSession(sessionToken(req));
}

/** Protected routes call this first. Throws 401 when there is no valid session. */
export async function requireUser(req: Request) {
  const u = await currentUser(req);
  if (!u) throw new AuthError("UNAUTHENTICATED", "Sign in with a wallet first.");
  return u;
}

/** Route wrapper: CSRF check, then the handler, with errors mapped to JSON. */
export async function route(req: Request, fn: () => Promise<Response>): Promise<Response> {
  try {
    assertSameOrigin(req);
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    if (e instanceof ZodError) return NextResponse.json({ error: { code: "BAD_REQUEST", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } }, { status: 400 });
    if (e instanceof SyntaxError) return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Body must be JSON." } }, { status: 400 });
    throw e;
  }
}
