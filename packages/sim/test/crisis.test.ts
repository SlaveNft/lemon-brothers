import { describe, expect, it } from "vitest";
import {
  activePromises, aiCrisis, checkMove, createCrisis, crisisResult, dailyCrisis, decodeMoves, DECK, encodeMoves, observe, playEpoch, replayCrisis,
  sumWallets, type Crisis, type Move,
} from "../src";

const answer = (c: Crisis, want: (a: (typeof c.card.card.answers)[number]) => boolean): 0 | 1 | 2 => Math.max(0, c.card.card.answers.findIndex(want)) as 0 | 1 | 2;
const candid = (c: Crisis): Move => ({ a: answer(c, (a) => !!a.candid), lever: "none", v: 0 });
const play = (seed: number, bot: (c: Crisis) => Move) => { const c = createCrisis(seed); while (!c.ending) playEpoch(c, bot(c)); return c; };

describe("you are the chair", () => {
  it("every card has three answers in both languages, and exactly the placeholders it can fill", () => {
    for (const card of Object.values(DECK)) {
      expect(card.answers).toHaveLength(3);
      for (const t of [...card.q, ...card.answers.flatMap((a) => [a.en, a.ru])]) {
        expect(t.length).toBeGreaterThan(0);
        expect(t.replace(/\{(wd|out|vault|printed|trust|room|promise)\}/g, "")).not.toMatch(/[{}]/);
      }
      // a card always offers a way to tell the truth or at least a plain answer next to a promise
      expect(card.answers.filter((a) => a.promise).length).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic: seed + moves replay to the same result", () => {
    for (const seed of [1, 7, 42, 2026]) {
      const c = play(seed, candid);
      const again = replayCrisis(seed, decodeMoves(encodeMoves(c.moves))!)!;
      expect(again.result).toEqual(crisisResult(c));
      expect(again.crisis.log).toEqual(c.log);
    }
    expect(replayCrisis(1, [])).toBeNull();
    expect(decodeMoves("0n0.9x1")).toBeNull();
  });

  it("the contract refuses an order past its limits for a human chair too; nothing changes, the town hears of it", () => {
    const c = createCrisis(5), before = { ...c.w.bank.policy }, supply = c.w.bank.supply, cred = c.w.credibility;
    const half = Math.round(Number(supply) / 2);
    const m: Move = { a: 0, lever: "mint", v: half };
    expect(checkMove(c, m)).toMatch(/refused: above 5% of supply/);
    const r = playEpoch(c, m);
    expect(r.rejected).toMatch(/refused/);
    expect(c.minted).toBe(0);
    expect(c.w.bank.policy.rate).toBe(before.rate);
    expect(c.w.credibility).toBeLessThan(cred);
    expect(c.w.agents.some((a) => a.why.some((x) => x.why.includes("contract's limits")))).toBe(true);
    if (!c.ending) expect(c.card.card.id).toBe("rejected");
  });

  it("a broken promise costs credibility and scares the town", () => {
    // find a crisis whose first card offers "no printing", promise it, then print
    for (let seed = 1; seed < 200; seed++) {
      const c = createCrisis(seed);
      const i = c.card.card.answers.findIndex((a) => a.promise === "no_print");
      if (i < 0) continue;
      playEpoch(c, { a: i as 0 | 1 | 2, lever: "none", v: 0 });
      if (c.ending) continue;
      expect(activePromises(c)).toContain("no_print");
      const cred = c.w.credibility;
      const r = playEpoch(c, { a: 0, lever: "mint", v: Math.min(1000, observe(c.w).mintRoom) });
      expect(r.broken).toContain("no_print");
      expect(activePromises(c)).not.toContain("no_print");
      expect(c.w.credibility).toBeLessThan(cred - 100);
      expect(c.w.agents.some((a) => a.why.some((x) => x.why.includes("broke its promise")))).toBe(true);
      return;
    }
    throw new Error("no crisis opened with a no-print promise");
  });

  it("conserves supply and ends every crisis within ten epochs", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const c = createCrisis(seed);
      while (!c.ending) {
        playEpoch(c, { a: (seed % 3) as 0 | 1 | 2, lever: seed % 2 ? "target" : "none", v: 350 });
        expect(c.w.bank.supply).toBe(sumWallets(c.w.bank) + c.w.bank.reserve + c.w.bank.loans);
      }
      const r = crisisResult(c);
      expect(r.epochs).toBeLessThanOrEqual(10);
      expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("balance: dodging loses, telling the truth and building the reserve wins far more often, the machine is beatable", () => {
    let dodge = 0, careful = 0, ai = 0;
    const N = 120;
    for (let seed = 1; seed <= N; seed++) {
      if (play(seed, (c) => ({ a: answer(c, (a) => !!a.dodge), lever: "none", v: 0 })).ending === "survived") dodge++;
      if (play(seed, (c) => { const o = observe(c.w); const m: Move = { ...candid(c), lever: "target", v: Math.min(650, o.policy.target + 150) }; return o.policy.target < 650 && !checkMove(c, m) ? m : candid(c); }).ending === "survived") careful++;
      if (aiCrisis(seed).ending === "survived") ai++;
    }
    expect(dodge).toBeLessThan(N * 0.15);
    expect(careful).toBeGreaterThan(N * 0.35);
    expect(careful).toBeLessThan(N * 0.8);
    expect(ai).toBeGreaterThan(N * 0.15);
  });

  it("the README's example link replays to the result it quotes", () => {
    const r = replayCrisis(7, decodeMoves("1t350.1t500.1n0.1n0.1n0.1n0.1n0.1n0.1n0.1n0")!)!.result;
    expect([r.ending, r.score, r.kept, r.of]).toEqual(["run", 4, 17, 60]);
  });

  it("the daily crisis is one seed per UTC day", () => {
    const a = dailyCrisis(Date.UTC(2026, 10, 14, 1)), b = dailyCrisis(Date.UTC(2026, 10, 14, 23)), n = dailyCrisis(Date.UTC(2026, 10, 15, 0));
    expect(a).toEqual(b); expect(a.day).toBe(2); expect(n.day).toBe(3); expect(n.seed).not.toBe(a.seed);
  });
});
