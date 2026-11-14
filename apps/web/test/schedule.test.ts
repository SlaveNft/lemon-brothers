import { describe, expect, it } from "vitest";
import { conferenceMs, lastConference, missed, nextConference, onAir, parseSchedule, waitText, SCHEDULE } from "../src/chain/schedule";

const every3 = { active: true, everyMinutes: 180, bankDays: 10 };
const utc = (s: string) => Date.parse(s);

describe("when the chair speaks", () => {
  it("names the next press conference: the next UTC hour divisible by the step", () => {
    expect(nextConference(utc("2026-11-14T12:02:00Z"), every3)).toBe(utc("2026-11-14T15:00:00Z"));
    expect(nextConference(utc("2026-11-14T14:59:59Z"), every3)).toBe(utc("2026-11-14T15:00:00Z"));
    // exactly on the hour the conference has started: the next one is a step later
    expect(nextConference(utc("2026-11-14T15:00:00Z"), every3)).toBe(utc("2026-11-14T18:00:00Z"));
    expect(nextConference(utc("2026-11-14T23:30:00Z"), every3)).toBe(utc("2026-11-15T00:00:00Z"));
    expect(lastConference(utc("2026-11-14T12:02:00Z"), every3)).toBe(utc("2026-11-14T12:00:00Z"));
  });

  it("counts shorter steps from midnight UTC, so the times are the same every day", () => {
    const s = { ...every3, everyMinutes: 30 };
    expect(nextConference(utc("2026-11-14T12:02:00Z"), s)).toBe(utc("2026-11-14T12:30:00Z"));
    expect(nextConference(utc("2026-11-14T12:31:00Z"), s)).toBe(utc("2026-11-14T13:00:00Z"));
    expect(nextConference(utc("2026-11-14T23:59:00Z"), s)).toBe(utc("2026-11-15T00:00:00Z"));
  });

  it("lasts one statement per bank day", () => {
    expect(conferenceMs(30_000, every3)).toBe(300_000);
  });

  it("promises nothing from a schedule file that does not make sense", () => {
    expect(parseSchedule({ active: true, everyMinutes: 7, bankDays: 10 }).active).toBe(false); // a day is not a multiple of 7 minutes
    expect(parseSchedule({ active: true, everyMinutes: 2, bankDays: 10 }).active).toBe(false); // shorter than a press conference could be
    expect(parseSchedule({ active: true, everyMinutes: 30, bankDays: 0 }).active).toBe(false);
    expect(parseSchedule(null).active).toBe(false);
    expect(parseSchedule({ active: true, everyMinutes: 180, bankDays: 10 })).toEqual(every3);
    expect(typeof SCHEDULE.active).toBe("boolean");
  });

  it("notices a missed schedule from the chain, so the page stops promising the next one", () => {
    const now = 1_000_000_000_000, s = { active: true, everyMinutes: 30, bankDays: 10 };
    const st = { next_epoch_ms: now - 10 * 60_000, epoch_ms: 30_000 };
    expect(missed(st, now, s)).toBe(false); // the bank was run ten minutes ago: between two press conferences
    expect(missed({ ...st, next_epoch_ms: now - 36 * 60_000 }, now, s)).toBe(true); // a whole step and a conference with nobody at the bank
    expect(missed(null, now, s)).toBe(false);
  });

  it("reads \"on air\" from the chain, not from the clock", () => {
    const now = 1_000_000_000_000;
    const st = { epoch_id: 45, policy_set_epoch_id: 45, next_epoch_ms: now + 10_000, epoch_ms: 30_000 };
    expect(onAir(st, now)).toBe(true);
    expect(onAir({ ...st, policy_set_epoch_id: 44 }, now)).toBe(true); // the day has just turned, the statement is on its way
    expect(onAir({ ...st, policy_set_epoch_id: 36 }, now)).toBe(false); // he last spoke nine bank days ago
    expect(onAir({ ...st, next_epoch_ms: now - 70 * 60_000 }, now)).toBe(false); // the bank day ended long ago: nobody is running it
    expect(onAir(null, now)).toBe(false);
  });

  it("says a wait in words", () => {
    expect(waitText(40_000, false)).toBe("40 s");
    expect(waitText(4 * 60_000, true)).toBe("4 мин");
    expect(waitText(125 * 60_000, true)).toBe("2 ч 05 мин");
    expect(waitText(-5, false)).toBe("0 s");
  });
});
