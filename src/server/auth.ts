import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthService } from "@/auth/service";
import { AuthError } from "@/auth/types";
import { getDb } from "@/database";

const g = globalThis as unknown as { __spakAuth?: Promise<AuthService> };
export const authService = () => (g.__spakAuth ??= getDb().then((db) => new AuthService(db)));

// ------------------------------------------------------------------ origin and cookies

/** The app's public origin. Set SPAK_APP_ORIGIN in production; otherwise derived from the request. */
export function appOrigin(req: Request): URL {
  if (process.env.SPAK_APP_ORIGIN) return new URL(process.env.SPAK_APP_ORIGIN);
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return new URL(`${proto}://${host}`);
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
 * Fixed-window limiter in process memory. Good for one instance and for slowing brute force;
 * use a shared store (Redis, Postgres) when running several instances.
 */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000, key?: string) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const k = `${bucket}:${key ?? ip}`;
  const now = Date.now();
  const w = windows.get(k);
  if (!w || now - w.start >= windowMs) {
    windows.set(k, { start: now, count: 1 });
    if (windows.size > 50_000) for (const [kk, v] of windows) if (now - v.start >= windowMs) windows.delete(kk);
    return;
  }
  if (++w.count > limit) throw new AuthError("RATE_LIMITED", "Too many requests. Wait a minute and try again.");
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
