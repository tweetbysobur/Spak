/**
 * Structured operational logging. One JSON line per event on stdout or stderr, for the host's log drain. Values under
 * sensitive keys are replaced, and token-shaped strings are masked wherever they appear, so a private key, access token,
 * cookie or signature can never reach a log line through this function.
 */
export type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY = /(secret|token|password|passphrase|private|seed|mnemonic|cookie|authorization|api[-_]?key|jwt|signature|session)/i;
const SENSITIVE_VALUE = [
  /dp\.(st|pt|sa|ct|scim)\.[A-Za-z0-9._-]{8,}/g, // Doppler tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bed25519:[1-9A-HJ-NP-Za-km-z]{80,}/g, // ed25519 secret keys (public keys are 43-44 chars and stay)
  /\bspak_session=[^;\s]+/gi,
];

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof v === "string") return SENSITIVE_VALUE.reduce((s, re) => s.replace(re, "[redacted]"), v).slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(x, depth + 1);
    return out;
  }
  return typeof v === "bigint" ? v.toString() : v;
}

export interface LogSink { (line: string, level: LogLevel): void }
let sink: LogSink = (line, level) => (level === "info" ? console.log(line) : console.error(line));
/** Tests capture lines here. */
export function setLogSink(s: LogSink) { const prev = sink; sink = s; return prev; }

export function logEvent(level: LogLevel, event: string, data: Record<string, unknown> = {}) {
  try { sink(JSON.stringify({ at: new Date().toISOString(), level, service: "spak", event, ...(redact(data) as object) }), level); } catch { /* logging never breaks a request */ }
}
