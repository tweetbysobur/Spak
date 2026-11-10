/** Timezone helpers on Intl only. No date library. */

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(instant: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday: wd };
}

/** UTC instant for a wall-clock time in a zone. Handles DST by one correction pass. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = zonedParts(new Date(guess), tz);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
  const first = guess - offset;
  const p2 = zonedParts(new Date(first), tz);
  const offset2 = Date.UTC(p2.y, p2.m - 1, p2.d, p2.h, p2.min) - first;
  return new Date(guess - offset2);
}

/** Parse "9am", "9:30", "21:00", "9:30pm", "noon", "midnight". Returns "HH:MM" or undefined. Bare "9" is ambiguous. */
export function parseClock(words: string[]): { time: string; used: number } | { ambiguous: true; used: number } | undefined {
  const [a, b] = words;
  if (!a) return undefined;
  if (a === "noon" || a === "midday") return { time: "12:00", used: 1 };
  if (a === "midnight") return { time: "00:00", used: 1 };
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(a);
  if (!m) return undefined;
  let used = 1;
  let ampm = m[3];
  if (!ampm && (b === "am" || b === "pm")) { ampm = b; used = 2; }
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59 || h > 23) return undefined;
  if (ampm) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (ampm === "pm" ? 12 : 0);
  } else if (!m[2] && h <= 12) {
    return { ambiguous: true, used };
  }
  return { time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, used };
}
