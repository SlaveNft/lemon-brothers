import { describe, expect, it } from "vitest";
import { dailyCrisis, decodeMoves, encodeMoves, replayCrisis, type Move } from "@chair/sim";
import { amount, count, memoLabel, parseRuns, parseStats, parseSupplyLog, supplySteps, verifyRun, verifyRuns, type RunClaim } from "../src/chain/board";
import { isMethodMissing } from "../src/chain/rpc";

const seed = dailyCrisis(Date.UTC(2026, 10, 14)).seed;
const quiet: Move[] = Array.from({ length: 10 }, () => ({ a: 0, lever: "none", v: 0 }));
const other: Move[] = quiet.map((m, i) => ({ ...m, a: (i % 3) as 0 | 1 | 2 }));
/** An honest claim: what the engine really gives for these moves. */
function honest(account: string, moves: Move[]): RunClaim {
  const r = replayCrisis(seed, moves)!.result;
  return { account, moves: encodeMoves(moves), score: r.score, ending: r.ending, atMs: 1 };
}

describe("leaderboard: verify by replay", () => {
  it("a claim that states what the replay gives is verified", () => {
    const v = verifyRun(seed, honest("a.testnet", quiet));
    expect(v.verified).toBe(true);
    expect(v.got).toEqual({ score: v.score, ending: v.ending });
  });

  it("a tampered score is flagged and the real score is reported", () => {
    const h = honest("a.testnet", quiet);
    const v = verifyRun(seed, { ...h, score: h.score === 100 ? 99 : 100 });
    expect(v.verified).toBe(false);
    expect(v.got?.score).toBe(h.score);
  });

  it("a tampered ending is flagged", () => {
    const h = honest("a.testnet", quiet);
    expect(verifyRun(seed, { ...h, ending: h.ending === "survived" ? "run" : "survived" }).verified).toBe(false);
  });

  it("tampered moves are flagged: another crisis was played than the one the score belongs to", () => {
    const a = honest("a.testnet", quiet), b = honest("b.testnet", other);
    expect(a.score !== b.score || a.ending !== b.ending, "the two move lists must differ in outcome for this test").toBe(true);
    expect(verifyRun(seed, { ...a, moves: b.moves }).verified).toBe(false);
    // the right moves under another seed do not verify either
    const elsewhere = verifyRun(seed + 1, a);
    expect(elsewhere.verified).toBe(replayCrisis(seed + 1, quiet)!.result.score === a.score && replayCrisis(seed + 1, quiet)!.result.ending === a.ending);
  });

  it("garbage never throws and never verifies", () => {
    const h = honest("a.testnet", quiet);
    for (const moves of ["", "garbage", "0n0", "9z9.9z9", "0n0.".repeat(40), "0n0.0n0.0n0", "💥", "0m999999999.".repeat(10), "x".repeat(10_000)]) {
      const v = verifyRun(seed, { ...h, moves });
      expect(v.verified, moves.slice(0, 20)).toBe(false);
    }
    for (const s of [0, -1, NaN, Infinity, 1.5, 2 ** 60]) expect(verifyRun(s, h).verified, String(s)).toBe(false);
    // too few moves: nothing to compare with
    expect(verifyRun(seed, { ...h, moves: "0n0" }).got).toBeNull();
  });

  it("sorts verified runs best first with ranks, and sends the ones that do not replay to the bottom", () => {
    const a = honest("a.testnet", quiet), b = honest("b.testnet", other);
    const liar: RunClaim = { ...a, account: "liar.testnet", score: 100, ending: "survived" };
    const isLie = !(a.score === 100 && a.ending === "survived");
    const rows = verifyRuns(seed, [liar, a, b]);
    expect(rows.map((r) => r.account).pop()).toBe(isLie ? "liar.testnet" : rows[rows.length - 1].account);
    const good = rows.filter((r) => r.verified);
    expect(good.map((r) => r.rank)).toEqual(good.map((_, i) => i + 1));
    for (let i = 1; i < good.length; i++) expect(good[i - 1].score).toBeGreaterThanOrEqual(good[i].score);
    if (isLie) { expect(rows[rows.length - 1].rank).toBeNull(); expect(rows[rows.length - 1].got?.score).toBe(a.score); }
    expect(verifyRuns(seed, [])).toEqual([]);
  });

  it("the move text round-trips", () => {
    expect(decodeMoves(encodeMoves(quiet))).toEqual(quiet);
  });
});

describe("leaderboard: the contract's answer", () => {
  it("accepts numbers and digit strings for u64 fields", () => {
    const r = parseRuns({ day: "2", seed: String(seed), today: true, runs: [{ account: "a.testnet", moves: "0n0", score: "71", ending: "survived", at_ms: "1763000000000" }, { account: "b.testnet", moves: "0n0", score: 5, ending: "run", at_ms: 7 }] });
    expect(r).toEqual({ day: 2, seed, runs: [{ account: "a.testnet", moves: "0n0", score: 71, ending: "survived", atMs: 1763000000000 }, { account: "b.testnet", moves: "0n0", score: 5, ending: "run", atMs: 7 }] });
    expect(count("12")).toBe(12); expect(count(12)).toBe(12);
    for (const bad of [-1, NaN, "1.5", "abc", null, undefined, {}, ""]) expect(count(bad)).toBeNull();
    expect(amount("340282366920938463463374607431768211455")).toBe("340282366920938463463374607431768211455");
    expect(amount(15)).toBe("15"); expect(amount("-1")).toBeNull();
  });

  it("refuses what is not a board and drops rows that are not claims", () => {
    for (const bad of [null, [], "x", {}, { day: 1, seed: 2 }, { day: 1, seed: 2, runs: {} }, { seed: 1, runs: [] }]) expect(() => parseRuns(bad)).toThrow();
    const r = parseRuns({ day: 1, seed: 2, runs: [null, 5, { account: 7, score: 1 }, { account: "", score: 1 }, { account: "ok.testnet" }, { account: "ok.testnet", score: 3, moves: 9, ending: null }] });
    expect(r.runs).toEqual([{ account: "ok.testnet", moves: "", score: 3, ending: "", atMs: 0 }]);
    expect(parseRuns({ day: 1, seed: 2, runs: [] }).runs).toEqual([]);
  });

  it("tells a contract without the method from other failures", () => {
    expect(isMethodMissing(new Error("wasm execution failed with error: MethodResolveError(MethodNotFound)"))).toBe(true);
    expect(isMethodMissing(new Error("https://rpc HTTP 429"))).toBe(false);
    expect(isMethodMissing(new Error("UNKNOWN_ACCOUNT"))).toBe(false);
  });
});

describe("the bank's record and the supply log", () => {
  it("reads stats with numbers or strings", () => {
    expect(parseStats({ rounds_survived: "4", rounds_fallen: 1, current_streak: 2, longest_streak: "3", total_minted: "1200", total_burned: 30, since_ms: "1763000000000" }))
      .toEqual({ roundsSurvived: 4, roundsFallen: 1, currentStreak: 2, longestStreak: 3, totalMinted: "1200", totalBurned: "30", sinceMs: 1763000000000 });
    expect(() => parseStats({ rounds_survived: 1 })).toThrow();
    expect(() => parseStats(null)).toThrow();
  });

  it("shows the log newest first and drops what is not a mint or a burn", () => {
    const log = parseSupplyLog([
      { epoch_id: 1, round: 0, kind: "mint", amount: "500", memo: "bailout", at_ms: 1 },
      { epoch_id: "2", round: "0", kind: "burn", amount: "20", memo: "lobby fee", at_ms: "2" },
      { epoch_id: 3, round: 0, kind: "transfer", amount: "1", memo: "x", at_ms: 3 },
      { epoch_id: 3, round: 0, kind: "mint", amount: "oops", memo: "x", at_ms: 3 },
      "junk",
    ]);
    expect(log.map((e) => [e.epochId, e.kind, e.amount, e.memo])).toEqual([[2, "burn", "20", "lobby fee"], [1, "mint", "500", "bailout"]]);
    expect(parseSupplyLog([])).toEqual([]);
    expect(() => parseSupplyLog({})).toThrow();
  });

  it("translates the known memos and passes unknown ones through", () => {
    expect(memoLabel("bailout", true)).toBe("спасение банка");
    expect(memoLabel("bailout", false)).toBe("bailout");
    expect(memoLabel("something new", true)).toBe("something new");
  });

  it("folds the log into one step per epoch and walks the supply back from what it is now", () => {
    const log = parseSupplyLog([
      { epoch_id: 30, round: 5, kind: "burn", amount: "4222", memo: "fire sale haircut", at_ms: 1 },
      { epoch_id: 30, round: 5, kind: "mint", amount: "69", memo: "loan yield", at_ms: 2 },
      { epoch_id: 32, round: 5, kind: "mint", amount: "1196", memo: "bailout", at_ms: 3 },
    ]);
    const steps = supplySteps(log, 100_000);
    expect(steps.map((s) => s.epochId)).toEqual([30, 32]);
    expect(steps[1]).toEqual({ epochId: 32, minted: 1196, burned: 0, after: 100_000 });
    expect(steps[0]).toEqual({ epochId: 30, minted: 69, burned: 4222, after: 98_804 });
    // before epoch 30 there were 98,804 - 69 + 4,222 coins: nothing is lost on the way back
    expect(steps[0].after - steps[0].minted + steps[0].burned).toBe(102_957);
    expect(supplySteps([], 5)).toEqual([]);
  });
});
