/**
 * Recurrence rules for scheduled payments. Pure and deterministic: no clock, no I/O.
 *
 * Dates are calendar dates (YYYY-MM-DD) in the schedule owner's IANA timezone. An occurrence is due from the start of
 * its date in that timezone. The n-th occurrence is always computed from the start date, never chained from the
 * previous one, so a clamped month (31 Jan -> 28 Feb) does not drift the following months (-> 31 Mar).
 */
export const FREQUENCIES = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "EVERY_N_DAYS"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface Recurrence {
  frequency: Frequency;
  /** Days between payments, only for EVERY_N_DAYS (1 to 365). */
  intervalDays: number | null;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
}

export const MAX_OCCURRENCES = 520;
export const MAX_INTERVAL_DAYS = 365;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse YYYY-MM-DD strictly (rejects 2026-02-30). Returns UTC midnight milliseconds for arithmetic. */
export function parseDate(s: string): number | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Same day-of-month as `start`, n months later, clamped to the month's last day. */
export function addMonthsClamped(start: string, n: number): string {
  const t = parseDate(start);
  if (t === null) throw new Error(`Invalid date: ${start}`);
  const d = new Date(t);
  const total = d.getUTCMonth() + n;
  const y = d.getUTCFullYear() + Math.floor(total / 12);
  const m0 = ((total % 12) + 12) % 12;
  return fmt(Date.UTC(y, m0, Math.min(d.getUTCDate(), daysInMonth(y, m0))));
}
export function addDays(date: string, n: number): string {
  const t = parseDate(date);
  if (t === null) throw new Error(`Invalid date: ${date}`);
  return fmt(t + n * 86_400_000);
}

const stepDays = (r: Recurrence) => (r.frequency === "DAILY" ? 1 : r.frequency === "WEEKLY" ? 7 : r.frequency === "BIWEEKLY" ? 14 : r.intervalDays ?? 0);

/** Date of occurrence `seq` (0-based), or null when the schedule has no such occurrence (past its end or count). */
export function occurrenceDate(r: Recurrence, seq: number): string | null {
  if (seq < 0 || !Number.isInteger(seq)) return null;
  if (r.maxOccurrences !== null && seq >= r.maxOccurrences) return null;
  if (seq >= MAX_OCCURRENCES) return null;
  const d = r.frequency === "MONTHLY" ? addMonthsClamped(r.startDate, seq) : addDays(r.startDate, seq * stepDays(r));
  if (r.endDate !== null && d > r.endDate) return null;
  return d;
}

/** Today's calendar date in an IANA timezone. */
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function isTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz.length <= 64; } catch { return false; }
}

/**
 * Which occurrences are due now, from `nextSeq` on. Missed-payment rule: when several dates have passed unseen,
 * only the latest is prepared; the earlier ones are recorded as MISSED (visible, recoverable one by one), never
 * prepared together.
 */
export function dueNow(r: Recurrence, nextSeq: number, today: string): { missed: { seq: number; date: string }[]; prepare: { seq: number; date: string } | null; nextSeq: number; finished: boolean } {
  const due: { seq: number; date: string }[] = [];
  let seq = nextSeq;
  for (;;) {
    const d = occurrenceDate(r, seq);
    if (d === null || d > today) break;
    due.push({ seq, date: d });
    seq++;
  }
  const finished = occurrenceDate(r, seq) === null;
  if (!due.length) return { missed: [], prepare: null, nextSeq, finished };
  return { missed: due.slice(0, -1), prepare: due[due.length - 1], nextSeq: seq, finished };
}

/** First occurrence on or after `today` (used when resuming: dates passed while paused are not created). */
export function firstSeqOnOrAfter(r: Recurrence, fromSeq: number, today: string): number {
  let seq = fromSeq;
  for (;;) {
    const d = occurrenceDate(r, seq);
    if (d === null || d >= today) return seq;
    seq++;
  }
}

export interface RecurrenceInput { frequency: string; intervalDays?: number | null; startDate: string; endDate?: string | null; maxOccurrences?: number | null }

/** Validate a recurrence. `today` is the owner's local date; the start may not be in the past or more than a year ahead. */
export function validateRecurrence(i: RecurrenceInput, today: string): { ok: true; value: Recurrence } | { ok: false; error: string } {
  if (!(FREQUENCIES as readonly string[]).includes(i.frequency)) return { ok: false, error: "Choose daily, weekly, every two weeks, monthly or every N days." };
  const frequency = i.frequency as Frequency;
  const intervalDays = frequency === "EVERY_N_DAYS" ? i.intervalDays ?? null : null;
  if (frequency === "EVERY_N_DAYS" && (intervalDays === null || !Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > MAX_INTERVAL_DAYS)) return { ok: false, error: `Every N days needs a whole number of days from 1 to ${MAX_INTERVAL_DAYS}.` };
  if (parseDate(i.startDate) === null) return { ok: false, error: "The start date is not a valid date." };
  if (i.startDate < today) return { ok: false, error: "The start date is in the past." };
  if (i.startDate > addDays(today, 366)) return { ok: false, error: "The start date must be within a year." };
  const endDate = i.endDate ?? null;
  if (endDate !== null && (parseDate(endDate) === null || endDate < i.startDate)) return { ok: false, error: "The end date must be a valid date on or after the start date." };
  if (endDate !== null && endDate > addDays(i.startDate, 5 * 366)) return { ok: false, error: "The end date must be within five years of the start." };
  const maxOccurrences = i.maxOccurrences ?? null;
  if (maxOccurrences !== null && (!Number.isInteger(maxOccurrences) || maxOccurrences < 1 || maxOccurrences > MAX_OCCURRENCES)) return { ok: false, error: `The number of payments must be from 1 to ${MAX_OCCURRENCES}.` };
  return { ok: true, value: { frequency, intervalDays, startDate: i.startDate, endDate, maxOccurrences } };
}

/** Plain-words description, for the summary and the list. */
export function describe(r: Recurrence, date: (d: string) => string = (d) => d): string {
  const every = r.frequency === "DAILY" ? "Every day" : r.frequency === "WEEKLY" ? "Every week" : r.frequency === "BIWEEKLY" ? "Every two weeks"
    : r.frequency === "MONTHLY" ? `Every month on day ${Number(r.startDate.slice(8))}${Number(r.startDate.slice(8)) > 28 ? " (or the month's last day)" : ""}` : `Every ${r.intervalDays} days`;
  const end = r.maxOccurrences !== null && r.endDate !== null ? `, ${r.maxOccurrences} payments at most, until ${date(r.endDate)}` : r.maxOccurrences !== null ? `, ${r.maxOccurrences} payments` : r.endDate !== null ? `, until ${date(r.endDate)}` : ", until you cancel";
  return `${every}, from ${date(r.startDate)}${end}`;
}
