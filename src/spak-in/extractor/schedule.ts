import { err, type SpakError } from "../errors/codes";
import type { Schedule } from "../schemas/intent";
import type { Token } from "../tokenizer/tokenize";
import { MONTHS, WEEKDAYS } from "./lexicon";
import { isValidTimeZone, parseClock, zonedParts, zonedToUtc } from "./time";

export interface ScheduleExtraction {
  schedule: Schedule | null;
  consumed: Set<number>;
  issues: SpakError[];
  /** Fields the user must supply before the schedule is usable. */
  missing: string[];
}

const UNIT: Record<string, Schedule["frequency"]> = {
  hour: "HOURLY", hours: "HOURLY", day: "DAILY", days: "DAILY", week: "WEEKLY", weeks: "WEEKLY", month: "MONTHLY", months: "MONTHLY",
};
const ADVERB: Record<string, { f: NonNullable<Schedule["frequency"]>; interval: number }> = {
  hourly: { f: "HOURLY", interval: 1 }, daily: { f: "DAILY", interval: 1 }, everyday: { f: "DAILY", interval: 1 },
  weekly: { f: "WEEKLY", interval: 1 }, biweekly: { f: "WEEKLY", interval: 2 }, fortnightly: { f: "WEEKLY", interval: 2 }, monthly: { f: "MONTHLY", interval: 1 },
};
const ORDINAL = /^(\d{1,2})(st|nd|rd|th)?$/;

export function extractSchedule(tokens: Token[], opts: { now: Date; timezone?: string }): ScheduleExtraction {
  const consumed = new Set<number>();
  const issues: SpakError[] = [];
  const w = tokens.map((t) => t.lower);
  let type: Schedule["type"] | null = null;
  let frequency: Schedule["frequency"] = null;
  let interval = 1;
  const days = new Set<number>();
  let dayOfMonth: number | null = null;
  let time: string | null = null;
  let date: { y: number; m: number; d: number } | null = null;
  let relativeMs: number | null = null;
  const take = (...idx: number[]) => idx.forEach((i) => consumed.add(i));

  const readDays = (i: number): number => {
    // weekday list: "monday and friday", "mon, wed"
    let j = i;
    while (j < w.length) {
      if (WEEKDAYS[w[j]] !== undefined) { days.add(WEEKDAYS[w[j]]); take(j); j++; continue; }
      if ((w[j] === "and" || w[j] === ",") && WEEKDAYS[w[j + 1]] !== undefined) { take(j); j++; continue; }
      break;
    }
    return j;
  };

  for (let i = 0; i < w.length; i++) {
    const word = w[i];
    if (word === "every" || word === "each") {
      type = "RECURRING"; take(i);
      let j = i + 1;
      if (w[j] === "other") { interval = 2; take(j); j++; }
      if (tokens[j]?.kind === "number" && /^\d+$/.test(w[j]) && UNIT[w[j + 1]]) { interval = Number(w[j]); take(j); j++; }
      if (UNIT[w[j]]) { frequency = UNIT[w[j]]; take(j); continue; }
      if (w[j] === "weekday" || w[j] === "weekdays") { frequency = "WEEKLY"; [1, 2, 3, 4, 5].forEach((d) => days.add(d)); take(j); continue; }
      if (w[j] === "weekend" || w[j] === "weekends") { frequency = "WEEKLY"; [0, 6].forEach((d) => days.add(d)); take(j); continue; }
      if (WEEKDAYS[w[j]] !== undefined) { frequency = "WEEKLY"; readDays(j); continue; }
      issues.push(err("INVALID_SCHEDULE", `"${word}" needs a period, like "every Monday" or "every 2 weeks".`, "schedule"));
      continue;
    }
    if (ADVERB[word]) { type = "RECURRING"; frequency = ADVERB[word].f; interval = ADVERB[word].interval; take(i); continue; }
    if (WEEKDAYS[word] !== undefined && /s$/.test(word) && word !== "tues" && word !== "thurs") {
      type = "RECURRING"; frequency = "WEEKLY"; readDays(i); if (w[i - 1] === "on") take(i - 1); continue;
    }
    if (word === "on" && WEEKDAYS[w[i + 1]] !== undefined) {
      take(i); readDays(i + 1);
      if (type !== "RECURRING") type = "ONCE";
      continue;
    }
    if (word === "next" && WEEKDAYS[w[i + 1]] !== undefined) { type = type ?? "ONCE"; take(i); readDays(i + 1); continue; }
    if ((word === "on" && w[i + 1] === "the" && ORDINAL.test(w[i + 2] ?? "")) || (word === "on" && w[i + 1] === "day" && /^\d+$/.test(w[i + 2] ?? ""))) {
      const n = Number(ORDINAL.exec(w[i + 2])?.[1] ?? w[i + 2]);
      if (n >= 1 && n <= 31) { dayOfMonth = n; frequency = frequency ?? "MONTHLY"; take(i, i + 1, i + 2); continue; }
    }
    if (word === "tomorrow" || word === "today" || word === "tonight") {
      type = type ?? "ONCE"; take(i);
      const base = opts.timezone && isValidTimeZone(opts.timezone) ? zonedParts(opts.now, opts.timezone) : null;
      if (base) {
        const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + (word === "tomorrow" ? 1 : 0)));
        date = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
      } else date = { y: 0, m: 0, d: word === "tomorrow" ? 1 : 0 }; // placeholder until timezone is known
      continue;
    }
    if (word === "in" && tokens[i + 1]?.kind === "number" && /^(minutes?|mins?|hours?|hrs?|days?)$/.test(w[i + 2] ?? "")) {
      const n = Number(w[i + 1]);
      const unit = w[i + 2].startsWith("m") ? 60_000 : w[i + 2].startsWith("h") ? 3_600_000 : 86_400_000;
      relativeMs = n * unit; type = type ?? "ONCE"; take(i, i + 1, i + 2); continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word))) {
      date = { y: +m[1], m: +m[2], d: +m[3] }; type = type ?? "ONCE"; take(i); if (w[i - 1] === "on") take(i - 1); continue;
    }
    if (MONTHS[word] && ORDINAL.test(w[i + 1] ?? "") && (w[i - 1] === "on" || w[i - 1] === "by")) {
      const d = Number(ORDINAL.exec(w[i + 1])![1]);
      const base = zonedParts(opts.now, opts.timezone && isValidTimeZone(opts.timezone) ? opts.timezone : "UTC");
      let y = base.y;
      if (MONTHS[word] < base.m || (MONTHS[word] === base.m && d < base.d)) y += 1;
      date = { y, m: MONTHS[word], d }; type = type ?? "ONCE"; take(i - 1, i, i + 1); continue;
    }
    if (word === "at" || (type && /^\d{1,2}(:\d{2})?(am|pm)$/.test(word))) {
      const start = word === "at" ? i + 1 : i;
      const c = parseClock(w.slice(start, start + 2));
      if (c && "time" in c) { time = c.time; take(...(word === "at" ? [i] : []), ...Array.from({ length: c.used }, (_, k) => start + k)); continue; }
      if (c && "ambiguous" in c && type) {
        take(...(word === "at" ? [i] : []), start);
        issues.push(err("INVALID_SCHEDULE", `Is ${w[start]} in the morning or evening? Say ${w[start]}am or ${w[start]}pm.`, "schedule.time"));
        continue;
      }
    }
  }

  if (!type && days.size === 0 && dayOfMonth === null && !time) return { schedule: null, consumed, issues, missing: [] };
  if (!type) type = "ONCE";
  if (type === "RECURRING" && !frequency) frequency = days.size ? "WEEKLY" : dayOfMonth ? "MONTHLY" : null;
  if (type === "ONCE" && days.size && !date) {
    // "on monday" / "next monday": the next such day in the user's zone
    if (opts.timezone && isValidTimeZone(opts.timezone)) {
      const p = zonedParts(opts.now, opts.timezone);
      const target = [...days][0];
      let delta = (target - p.weekday + 7) % 7;
      if (delta === 0) delta = 7;
      const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + delta));
      date = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    } else date = { y: 0, m: 0, d: 0 };
  }

  const missing: string[] = [];
  const needsZone = type === "RECURRING" ? frequency !== "HOURLY" : relativeMs === null;
  const tz = opts.timezone && isValidTimeZone(opts.timezone) ? opts.timezone : null;
  if (opts.timezone && !tz) issues.push(err("INVALID_SCHEDULE", `Unknown time zone "${opts.timezone}".`, "schedule.timezone"));
  if (needsZone && !tz) missing.push("schedule.timezone");
  if (type === "RECURRING" && frequency && frequency !== "HOURLY" && !time) missing.push("schedule.time");
  if (type === "ONCE" && relativeMs === null && !time) missing.push("schedule.time");
  if (type === "RECURRING" && !frequency) missing.push("schedule.frequency");

  let startAt: string | null = null;
  if (relativeMs !== null) startAt = new Date(opts.now.getTime() + relativeMs).toISOString();
  else if (type === "ONCE" && date && date.y > 0 && time && tz) {
    const [h, mi] = time.split(":").map(Number);
    const at = zonedToUtc(date.y, date.m, date.d, h, mi, tz);
    if (at.getTime() <= opts.now.getTime()) issues.push(err("INVALID_SCHEDULE", "That time has already passed.", "schedule.startAt"));
    startAt = at.toISOString();
  }

  return {
    schedule: {
      type, frequency: type === "RECURRING" ? frequency : null, interval,
      daysOfWeek: [...days].sort(), dayOfMonth, time, startAt, timezone: tz,
      raw: tokens.filter((t) => consumed.has(t.index)).map((t) => t.raw).join(" "),
    },
    consumed, issues, missing,
  };
}
