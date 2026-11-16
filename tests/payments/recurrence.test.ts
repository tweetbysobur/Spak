import { describe, expect, it } from "vitest";
import { addMonthsClamped, describe as describeR, dueNow, firstSeqOnOrAfter, localDate, occurrenceDate, parseDate, validateRecurrence, type Recurrence } from "@/payments/recurrence";

const r = (o: Partial<Recurrence>): Recurrence => ({ frequency: "WEEKLY", intervalDays: null, startDate: "2026-11-16", endDate: null, maxOccurrences: null, ...o });
const dates = (x: Recurrence, n: number) => Array.from({ length: n }, (_, i) => occurrenceDate(x, i));

describe("intervals", () => {
  it("daily, weekly, every two weeks and every N days step from the start date", () => {
    expect(dates(r({ frequency: "DAILY" }), 3)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(dates(r({ frequency: "WEEKLY" }), 3)).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(dates(r({ frequency: "BIWEEKLY" }), 3)).toEqual(["2026-11-16", "2026-11-30", "2026-12-14"]);
    expect(dates(r({ frequency: "EVERY_N_DAYS", intervalDays: 10 }), 3)).toEqual(["2026-11-16", "2026-11-26", "2026-12-06"]);
  });
  it("weekly across a year end and a daylight-saving change keeps the weekday", () => {
    const x = r({ frequency: "WEEKLY", startDate: "2026-12-28" });
    expect(dates(x, 3)).toEqual(["2026-12-28", "2027-01-04", "2027-01-11"]);
    const dst = dates(r({ frequency: "WEEKLY", startDate: "2027-03-08" }), 2);
    expect(dst.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay())).toEqual([1, 1]);
  });
});

describe("monthly dates on the 29th, 30th and 31st", () => {
  it("the 31st clamps to each month's last day and returns to the 31st, without drifting", () => {
    expect(dates(r({ frequency: "MONTHLY", startDate: "2027-01-31" }), 5)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  });
  it("the 29th and 30th in February, including a leap year", () => {
    expect(dates(r({ frequency: "MONTHLY", startDate: "2027-01-29" }), 3)).toEqual(["2027-01-29", "2027-02-28", "2027-03-29"]);
    expect(dates(r({ frequency: "MONTHLY", startDate: "2028-01-30" }), 3)).toEqual(["2028-01-30", "2028-02-29", "2028-03-30"]);
    expect(addMonthsClamped("2027-12-31", 2)).toBe("2028-02-29");
  });
  it("the first of the month stays on the first", () => {
    expect(dates(r({ frequency: "MONTHLY", startDate: "2026-12-01" }), 3)).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
  });
});

describe("ends", () => {
  it("stops after the maximum number of payments, or after the end date (inclusive)", () => {
    expect(dates(r({ frequency: "DAILY", maxOccurrences: 2 }), 3)).toEqual(["2026-11-16", "2026-11-17", null]);
    expect(dates(r({ frequency: "WEEKLY", endDate: "2026-11-30" }), 4)).toEqual(["2026-11-16", "2026-11-23", "2026-11-30", null]);
  });
});

describe("timezone and date boundaries", () => {
  it("today is the owner's local date, not UTC", () => {
    const t = new Date("2026-11-15T23:30:00Z");
    expect(localDate(t, "UTC")).toBe("2026-11-15");
    expect(localDate(t, "Pacific/Auckland")).toBe("2026-11-16");
    expect(localDate(new Date("2026-11-16T05:00:00Z"), "America/Los_Angeles")).toBe("2026-11-15");
  });
  it("an occurrence is due from the start of its date in the owner's timezone", () => {
    const x = r({ frequency: "WEEKLY", startDate: "2026-11-16" });
    const at = (iso: string, tz: string) => dueNow(x, 0, localDate(new Date(iso), tz)).prepare?.date ?? null;
    expect(at("2026-11-15T10:59:00Z", "Pacific/Auckland")).toBeNull(); // 23:59 on the 15th in Auckland
    expect(at("2026-11-15T11:00:00Z", "Pacific/Auckland")).toBe("2026-11-16"); // midnight on the 16th
    expect(at("2026-11-16T07:59:00Z", "America/Los_Angeles")).toBeNull(); // still the 15th in Los Angeles
    expect(at("2026-11-16T08:00:00Z", "America/Los_Angeles")).toBe("2026-11-16");
  });
  it("strict dates: 30 February and malformed strings are refused", () => {
    expect(parseDate("2027-02-30")).toBeNull();
    expect(parseDate("2027-2-3")).toBeNull();
    expect(parseDate("2027-02-28")).not.toBeNull();
  });
});

describe("missed dates", () => {
  it("one due date is prepared; several passed dates prepare only the latest and mark the rest missed", () => {
    const x = r({ frequency: "DAILY" });
    expect(dueNow(x, 0, "2026-11-15")).toMatchObject({ prepare: null, missed: [], nextSeq: 0 });
    expect(dueNow(x, 0, "2026-11-16")).toMatchObject({ prepare: { seq: 0 }, missed: [], nextSeq: 1 });
    const late = dueNow(x, 0, "2026-11-19");
    expect(late.prepare).toEqual({ seq: 3, date: "2026-11-19" });
    expect(late.missed.map((m) => m.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(late.nextSeq).toBe(4);
  });
  it("finished is reported once the last occurrence has been taken", () => {
    const x = r({ frequency: "DAILY", maxOccurrences: 2 });
    expect(dueNow(x, 0, "2026-11-16").finished).toBe(false);
    expect(dueNow(x, 1, "2026-11-17")).toMatchObject({ finished: true, nextSeq: 2 });
  });
  it("resuming skips dates that passed while paused", () => {
    const x = r({ frequency: "WEEKLY" });
    expect(firstSeqOnOrAfter(x, 1, "2026-12-01")).toBe(3); // 23 Nov and 30 Nov passed; next is 7 Dec
    expect(occurrenceDate(x, 3)).toBe("2026-12-07");
  });
});

describe("validation", () => {
  const today = "2026-11-15";
  const ok = { frequency: "WEEKLY", startDate: "2026-11-16" };
  it("accepts every supported frequency", () => {
    for (const f of ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]) expect(validateRecurrence({ ...ok, frequency: f }, today).ok).toBe(true);
    expect(validateRecurrence({ ...ok, frequency: "EVERY_N_DAYS", intervalDays: 3 }, today).ok).toBe(true);
  });
  it("refuses unknown frequencies, bad intervals, past or far starts, bad ends and counts", () => {
    for (const bad of [
      { ...ok, frequency: "HOURLY" }, { ...ok, frequency: "EVERY_N_DAYS" }, { ...ok, frequency: "EVERY_N_DAYS", intervalDays: 0 }, { ...ok, frequency: "EVERY_N_DAYS", intervalDays: 366 },
      { ...ok, startDate: "2026-11-14" }, { ...ok, startDate: "2028-01-01" }, { ...ok, startDate: "2026-02-30" },
      { ...ok, endDate: "2026-11-15" }, { ...ok, endDate: "2033-01-01" }, { ...ok, maxOccurrences: 0 }, { ...ok, maxOccurrences: 521 },
    ]) expect(validateRecurrence(bad, today).ok, JSON.stringify(bad)).toBe(false);
  });
  it("today is a valid start", () => expect(validateRecurrence({ ...ok, startDate: today }, today).ok).toBe(true));
  it("describes the schedule in plain words", () => {
    expect(describeR(r({ frequency: "MONTHLY", startDate: "2027-01-31", maxOccurrences: 12 }))).toBe("Every month on day 31 (or the month's last day), from 2027-01-31, 12 payments");
    expect(describeR(r({ frequency: "BIWEEKLY" }))).toBe("Every two weeks, from 2026-11-16, until you cancel");
  });
});
