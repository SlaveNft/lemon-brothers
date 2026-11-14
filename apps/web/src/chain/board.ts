/**
 * What the leaderboard and the supply log do with the contract's answers before anything is drawn: a shape check
 * (the page can be pointed at any contract through `?contract=`), and the replay that makes the board trustless.
 *
 * The contract only records claims: "this account says seed + moves gave this score". `verifyRuns` re-runs every
 * claimed crisis with the same engine the game uses and compares. Pure functions, no network, no DOM.
 */
import { decodeMoves, replayCrisis, type Ending } from "@chair/sim";

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
/** A u64 as the contract may write it: a number or a string of digits. Null if it is neither. */
export function count(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d{1,20}$/.test(v)) return Number(v);
  return null;
}
/** A u128 amount as digits (kept as text: it may not fit a double). Null if it is not an amount. */
export function amount(v: unknown): string | null {
  if (typeof v === "string" && /^\d{1,39}$/.test(v)) return v;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(Math.round(v));
  return null;
}

// ------------------------------------------------------------------ the leaderboard

export const ENDINGS: readonly Ending[] = ["survived", "run", "impeached", "hyperinflation"];
/** One claim as the contract stores it. */
export interface RunClaim { account: string; moves: string; score: number; ending: string; atMs: number }
export interface RunsAnswer { day: number; seed: number; runs: RunClaim[] }

/** The most claims the page will replay (the contract keeps 20). */
export const MAX_RUNS = 40;

/** `get_runs` as the page uses it, or throw with what is wrong. Rows that are not claims are dropped. */
export function parseRuns(v: unknown): RunsAnswer {
  if (!isObj(v)) throw new Error("get_runs did not return an object");
  const day = count(v.day), seed = count(v.seed);
  if (day === null || seed === null) throw new Error("get_runs carries no day or seed");
  if (!Array.isArray(v.runs)) throw new Error("get_runs carries no list of runs");
  const runs: RunClaim[] = [];
  for (const r of v.runs.slice(0, MAX_RUNS)) {
    if (!isObj(r) || typeof r.account !== "string" || !r.account || r.account.length > 64) continue;
    const score = count(r.score);
    if (score === null) continue;
    runs.push({
      account: r.account, moves: typeof r.moves === "string" ? r.moves : "", score,
      ending: typeof r.ending === "string" ? r.ending.slice(0, 24) : "", atMs: count(r.at_ms) ?? 0,
    });
  }
  return { day, seed, runs };
}

export interface VerifiedRun extends RunClaim {
  /** The replay in this browser gave exactly the claimed score and ending. */
  verified: boolean;
  /** What this browser got, or null when the moves cannot be replayed at all. */
  got: { score: number; ending: Ending } | null;
  /** Place among the verified runs (1 = best); null for a claim that does not replay. */
  rank: number | null;
}

/** Replay one claim. Never throws: moves that are garbage, too few or too long simply do not verify. */
export function verifyRun(seed: number, run: RunClaim): Omit<VerifiedRun, "rank"> {
  let got: VerifiedRun["got"] = null;
  try {
    const moves = Number.isSafeInteger(seed) && seed > 0 && run.moves.length <= 200 ? decodeMoves(run.moves) : null;
    const r = moves ? replayCrisis(seed, moves) : null;
    if (r) got = { score: r.result.score, ending: r.result.ending };
  } catch { got = null; }
  return { ...run, got, verified: got !== null && got.score === run.score && got.ending === run.ending };
}

/**
 * Replay every claim of a day. Verified runs come first, best score first (ties keep the contract's order, which is
 * earliest first); claims that do not replay go to the bottom and get no rank.
 */
export function verifyRuns(seed: number, runs: RunClaim[]): VerifiedRun[] {
  const all = runs.map((r, i) => ({ v: verifyRun(seed, r), i }));
  const good = all.filter((x) => x.v.verified).sort((a, b) => b.v.score - a.v.score || a.i - b.i);
  const bad = all.filter((x) => !x.v.verified);
  return [...good.map((x, k) => ({ ...x.v, rank: k + 1 })), ...bad.map((x) => ({ ...x.v, rank: null }))];
}

// ------------------------------------------------------------------ the bank's record and its supply log

export interface BankStats {
  roundsSurvived: number; roundsFallen: number; currentStreak: number; longestStreak: number;
  totalMinted: string; totalBurned: string; sinceMs: number;
}
export function parseStats(v: unknown): BankStats {
  if (!isObj(v)) throw new Error("get_stats did not return an object");
  const c = (k: string) => { const x = count(v[k]); if (x === null) throw new Error(`get_stats: ${k} is not a number`); return x; };
  const a = (k: string) => { const x = amount(v[k]); if (x === null) throw new Error(`get_stats: ${k} is not an amount`); return x; };
  return {
    roundsSurvived: c("rounds_survived"), roundsFallen: c("rounds_fallen"), currentStreak: c("current_streak"), longestStreak: c("longest_streak"),
    totalMinted: a("total_minted"), totalBurned: a("total_burned"), sinceMs: count(v.since_ms) ?? 0,
  };
}

export interface SupplyEntry { epochId: number; round: number; kind: "mint" | "burn"; amount: string; memo: string; atMs: number }
/** `get_supply_log` (oldest first) as the panel shows it: newest first. Entries that are not mints or burns are dropped. */
export function parseSupplyLog(v: unknown): SupplyEntry[] {
  if (!Array.isArray(v)) throw new Error("get_supply_log did not return a list");
  const out: SupplyEntry[] = [];
  for (const e of v.slice(-200)) {
    if (!isObj(e) || (e.kind !== "mint" && e.kind !== "burn")) continue;
    const amt = amount(e.amount), epochId = count(e.epoch_id);
    if (amt === null || epochId === null) continue;
    out.push({ epochId, round: count(e.round) ?? 0, kind: e.kind, amount: amt, memo: typeof e.memo === "string" ? e.memo.slice(0, 80) : "", atMs: count(e.at_ms) ?? 0 });
  }
  return out.reverse();
}

export interface SupplyStep { epochId: number; minted: number; burned: number; after: number }
/**
 * The log (newest first) folded into one step per epoch, oldest first, with the supply after each epoch. The contract
 * logs every mint and burn, so walking back from the supply as it is now gives the supply after every earlier epoch.
 */
export function supplySteps(log: SupplyEntry[], supplyNow: number): SupplyStep[] {
  const by = new Map<number, SupplyStep>();
  for (const e of log) {
    const n = Number(e.amount);
    if (!Number.isFinite(n) || n <= 0) continue;
    const s = by.get(e.epochId) ?? { epochId: e.epochId, minted: 0, burned: 0, after: 0 };
    if (e.kind === "mint") s.minted += n; else s.burned += n;
    by.set(e.epochId, s);
  }
  const steps = [...by.values()].sort((a, b) => b.epochId - a.epochId);
  let cur = supplyNow;
  for (const s of steps) { s.after = cur; cur = cur - s.minted + s.burned; }
  return steps.reverse();
}

/** The memos the contract writes on a mint or a burn, in Russian. Anything else is shown as it came. */
export const MEMO_RU: Record<string, string> = {
  genesis: "начальная эмиссия", airdrop: "раздача новичку", "policy mint": "эмиссия по решению председателя", bailout: "спасение банка",
  "loan yield": "доход по кредитам", "insurance payout": "страховая выплата", "fire sale haircut": "потери при срочной продаже",
  "collapse haircut": "потери при крахе", "loan write-off": "списание кредитов", "lobby fee": "плата за лоббирование", "rumour fee": "плата за слух",
};
export const memoLabel = (memo: string, ru: boolean): string => (ru ? MEMO_RU[memo] ?? memo : memo);
