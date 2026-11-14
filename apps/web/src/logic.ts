/** Small pure pieces of the town page, kept out of the component so they can be tested. */

/** A whole positive amount typed by the player, or null if the text is not one. */
export function parseAmount(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,12}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** Where the player's round score is counted from. */
export interface RoundMark { seed: number; round: number; net: number; fallen: number }
/** How the stretch before the current round went for the player and the bank. */
export interface RoundResult { rounds: number; score: number; fell: number }

/**
 * Keep the round score honest across polls. While the round is the same, the mark stays. When the round moves on
 * (possibly several rounds at once after a fast-forward), the finished stretch becomes `last`: the player's gain
 * since the mark and how many times the bank fell meanwhile. A different town (new seed, or a restarted runner whose
 * round went back) starts clean.
 */
export function trackRound(mark: RoundMark | null, last: RoundResult | null, now: { seed: number; round: number; roundsFallen: number }, net: number): { mark: RoundMark; last: RoundResult | null } {
  const fresh: RoundMark = { seed: now.seed, round: now.round, net, fallen: now.roundsFallen };
  if (!mark || mark.seed !== now.seed || now.round < mark.round) return { mark: fresh, last: null };
  if (now.round === mark.round) return { mark, last };
  return { mark: fresh, last: { rounds: now.round - mark.round, score: net - mark.net, fell: Math.max(0, now.roundsFallen - mark.fallen) } };
}

/** Share of the epoch that has passed, 0..100, for the tick bar; null when the clock is paused or unknown. */
export function tickPercent(nextTickMs: number | null, epochMs: number | null): number | null {
  if (nextTickMs === null || !epochMs || epochMs <= 0) return null;
  return Math.max(0, Math.min(100, 100 - (nextTickMs / epochMs) * 100));
}

/**
 * The order the three answers are shown in. The deck always writes them calm, careful, reckless; shown in that
 * order the third is "the wrong one" before it is read. The shuffle is display only (a move still stores the
 * deck's index, so links and the leaderboard replay as before) and fixed per crisis and day.
 */
const ORDERS: (0 | 1 | 2)[][] = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2], [2, 1, 0]];
export function answerOrder(seed: number, day: number): (0 | 1 | 2)[] {
  let h = (Math.imul(seed | 0, 2654435761) ^ Math.imul(day + 1, 40503)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  // ^ leaves a signed 32-bit value: back to unsigned before the modulo, or a negative index has no order
  return ORDERS[(h >>> 0) % ORDERS.length];
}
