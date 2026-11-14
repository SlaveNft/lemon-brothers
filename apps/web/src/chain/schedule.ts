/**
 * When the chair speaks. One rule everywhere: the chair makes one statement per bank day, at its start.
 *   - in the game a bank day passes when the player answers;
 *   - in the browser town a bank day is a fixed number of seconds, counted down on the page;
 *   - at the real bank the chair comes out for a press conference at fixed clock times, one round long, and the
 *     page shows the next one in the visitor's own time. The times live in schedule.json and are kept by
 *     scripts/testnet/onair.mjs; with `active` false nothing is promised.
 */
import raw from "./schedule.json";

export interface Schedule { active: boolean; everyMinutes: number; bankDays: number }

/** The schedule file as a schedule, or an inactive one if the file does not make sense. */
export function parseSchedule(v: unknown): Schedule {
  const o = (v ?? {}) as Record<string, unknown>;
  const everyMinutes = Number(o.everyMinutes), bankDays = Number(o.bankDays);
  // the step has to divide a day, so the press conferences fall on the same clock times every day
  const ok = Number.isInteger(everyMinutes) && everyMinutes >= 5 && everyMinutes <= 1440 && 1440 % everyMinutes === 0 && Number.isInteger(bankDays) && bankDays >= 1;
  return ok ? { active: o.active === true, everyMinutes, bankDays } : { active: false, everyMinutes: 1440, bankDays: 10 };
}
export const SCHEDULE: Schedule = parseSchedule(raw);

/** The first press conference that starts after `nowMs`: every `everyMinutes`, counted from midnight UTC. */
export function nextConference(nowMs: number, s: Schedule = SCHEDULE): number {
  const step = s.everyMinutes * 60_000;
  return Math.floor(nowMs / step) * step + step;
}
/** The press conference that started most recently at or before `nowMs`. */
export const lastConference = (nowMs: number, s: Schedule = SCHEDULE): number => nextConference(nowMs, s) - s.everyMinutes * 60_000;

/**
 * Has the schedule been missed? The bank day on chain ended longer ago than one whole step plus a press conference:
 * nobody has run the bank since before the last scheduled one, so the page must not promise the next.
 */
export function missed(st: { next_epoch_ms: number; epoch_ms: number } | null, nowMs: number, s: Schedule = SCHEDULE): boolean {
  if (!st || !(st.epoch_ms > 0)) return false;
  return nowMs - st.next_epoch_ms > s.everyMinutes * 60_000 + conferenceMs(st.epoch_ms, s);
}

/** How long one press conference lasts: one statement per bank day. */
export const conferenceMs = (epochMs: number, s: Schedule = SCHEDULE): number => s.bankDays * epochMs;

/**
 * Is the chair speaking at the real bank right now? Read from the chain, not from the clock: its policy was set
 * for the bank day that is running (or the one before), and that day has not been over for longer than a day.
 */
export function onAir(st: { epoch_id: number; policy_set_epoch_id: number; next_epoch_ms: number; epoch_ms: number } | null, nowMs: number): boolean {
  if (!st || !(st.epoch_ms > 0)) return false;
  return st.policy_set_epoch_id >= st.epoch_id - 1 && nowMs - st.next_epoch_ms < st.epoch_ms;
}

/** "2 h 05 min", "4 min", "40 s": a wait in words. */
export function waitText(ms: number, ru: boolean): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return ru ? `${s} с` : `${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return ru ? `${m} мин` : `${m} min`;
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0");
  return ru ? `${h} ч ${mm} мин` : `${h} h ${mm} min`;
}
