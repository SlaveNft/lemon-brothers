import { describe, expect, it } from "vitest";
import {
  BANK, airdrop, createWorld, feedLines, feedTail, parseDecision, playRound, readSpeech, speechStance, stepEpoch, truncateBytes, view, observe,
} from "../src";

const OUTCOME = /^(Round over: the bank survived|COLLAPSE:)/;
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("the feed keeps a round's outcome in view", () => {
  it("after playing to the end of the round, the outcome is among the newest 7 lines (20 seeds, 3 chairs)", () => {
    for (const persona of ["dove", "hawk", "populist"] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const w = createWorld(seed, persona, ["p"]);
        airdrop(w.bank, "p");
        const survived = playRound(w);
        const tail = view(w, { players: ["p"] }).feed.slice(-7);
        expect(tail.some((l) => (survived ? l === "Round over: the bank survived" : l.startsWith("COLLAPSE:"))), `seed ${seed} ${persona}: ${tail.join(" | ")}`).toBe(true);
      }
    }
  });

  it("fast-forward 'to the end of the round' (also through a collapse and its bailout) keeps the outcome in the 7 lines shown", () => {
    let fell = 0;
    for (const persona of ["dove", "hawk", "populist"] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const w = createWorld(seed, persona);
        for (let k = 0; k < 3; k++) {
          const n = BANK.epochsPerRound - w.bank.epoch, fallenBefore = view(w).roundsFallen;
          for (let i = 0; i < n; i++) stepEpoch(w);
          const v = view(w), tail = feedTail(v.feed, 7);
          expect(tail).toHaveLength(7);
          expect(tail.some((l) => OUTCOME.test(l)), `seed ${seed} ${persona} step ${k}: ${tail.join(" | ")}`).toBe(true);
          if (v.roundsFallen > fallenBefore) { fell++; expect(tail.some((l) => l.startsWith("COLLAPSE:")), `seed ${seed} ${persona} step ${k}`).toBe(true); }
        }
      }
    }
    expect(fell).toBeGreaterThan(0); // the sweep does cover collapses
  });

  it("feedTail pins the latest outcome only when it has scrolled out", () => {
    const noise = Array.from({ length: 10 }, (_, i) => `agent-0${i} withdrew 5`);
    expect(feedTail(["a", "Round over: the bank survived", "b"], 7)).toEqual(["a", "Round over: the bank survived", "b"]);
    expect(feedTail(["COLLAPSE: x", "Round over: the bank survived", ...noise], 7)).toEqual(["Round over: the bank survived", ...noise.slice(-6)]);
    expect(feedTail(noise, 7)).toEqual(noise.slice(-7));
  });

  it("the Monday deposits are one line, settlements are none, and the feed never exceeds its cap", () => {
    const w = createWorld(7, "dove");
    const first = view(w).feed;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/^Round opens: \d+ savers deposited \d+$/);
    for (let i = 0; i < 60; i++) stepEpoch(w);
    const f = view(w).feed;
    expect(f.length).toBeLessThanOrEqual(80);
    expect(f.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
    // an agent's deposit in the middle of an epoch is still its own line
    const ids = new Set(["agent-01"]);
    expect(feedLines([{ t: "epoch", epochId: 5, round: 0, epoch: 5 }, { t: "deposit", who: "agent-01", amount: 10n }], ids)).toEqual(["agent-01 deposited 10"]);
    // a player's deposit at round open is not folded into the crowd
    expect(feedLines([{ t: "deposit", who: "agent-01", amount: 10n }, { t: "deposit", who: "p", amount: 5n }], ids)).toEqual(["Round opens: 1 saver deposited 10", "p deposited 5"]);
  });

  it("the view carries the epoch length it was given", () => {
    const w = createWorld(1);
    expect(view(w).epochMs).toBeNull();
    expect(view(w, { epochMs: 15_000 }).epochMs).toBe(15_000);
  });
});

describe("parseDecision reads an answer the way the contract does", () => {
  const base = { epoch_id: 3, rate: 40, target: 200, mint: 0, gate: 0 };
  const ok = (o: object) => { const d = parseDecision(JSON.stringify(o)); if (typeof d === "string") throw new Error(d); return d; };

  it("cuts the statement at 280 UTF-8 bytes without splitting a character", () => {
    expect(bytes(ok({ ...base, statement: "é".repeat(200) }).statement)).toBe(280);
    expect(ok({ ...base, statement: "é".repeat(200) }).statement).toBe("é".repeat(140));
    // 3-byte characters: 93 fit (279 bytes), the 94th would split
    expect(ok({ ...base, statement: "я".repeat(10) + "€".repeat(200) }).statement).toBe("я".repeat(10) + "€".repeat(86));
    // an astral character (4 bytes, two UTF-16 units) is kept whole or dropped
    const s = ok({ ...base, statement: "a".repeat(278) + "🍋" }).statement;
    expect(s).toBe("a".repeat(278));
    expect(ok({ ...base, statement: "a".repeat(276) + "🍋" }).statement).toBe("a".repeat(276) + "🍋");
    expect(ok({ ...base, statement: "short" }).statement).toBe("short");
    expect(truncateBytes("привет", 5)).toBe("пр");
  });

  it("a null or non-string tone means calm; an unknown tone string is refused", () => {
    expect(ok({ ...base, tone: null }).tone).toBe("calm");
    expect(ok({ ...base, tone: 7 }).tone).toBe("calm");
    expect(ok(base).tone).toBe("calm");
    expect(ok({ ...base, tone: "cautious" }).tone).toBe("cautious");
    expect(parseDecision(JSON.stringify({ ...base, tone: "furious" }))).toMatch(/tone/);
  });

  it("a non-string statement is empty", () => {
    expect(ok({ ...base, statement: 42 }).statement).toBe("");
    expect(ok({ ...base, statement: null }).statement).toBe("");
    expect(ok({ ...base, statement: { text: "hi" } }).statement).toBe("");
    expect(ok(base).statement).toBe("");
  });

  it("only top-level keys count for the whole-number check", () => {
    expect(ok({ ...base, notes: { rate: 70.5, mint: 1e2 } }).rate).toBe(40);
    expect(typeof parseDecision('{"rate":40,"target":200,"mint":0,"gate":0,"extra":[{"gate":1.0}]}')).toBe("object");
    expect(typeof parseDecision('{"rate":40,"target":200,"mint":0,"gate":0,"statement":"set \\"rate\\": 70.5 now, \\"mint\\":1e2"}')).toBe("object");
    expect(typeof parseDecision('{"statement":"x\\\\","rate":40,"target":200,"mint":0,"gate":0}')).toBe("object");
    // a nested key does not stand in for a missing top-level one
    expect(parseDecision('{"target":200,"mint":0,"gate":0,"x":{"rate":40}}')).toMatch(/rate/);
  });

  it("still refuses what serde_json would not read as a whole number", () => {
    for (const bad of ['"rate":70.0', '"rate":1e2', '"rate":-1', '"rate":-0', '"rate":"40"', '"rate":null', '"rate":40.5']) {
      expect(parseDecision(`{${bad},"target":200,"mint":0,"gate":0}`), bad).toMatch(/rate/);
    }
    expect(parseDecision('{"rate" : 40 ,\n "target":200,"mint":0,"gate":0}')).toMatchObject({ rate: 40 });
    // a repeated key: the last one wins, in JSON.parse and in serde_json alike
    expect(parseDecision('{"rate":70.5,"rate":40,"target":200,"mint":0,"gate":0}')).toMatchObject({ rate: 40 });
    expect(parseDecision('{"rate":40,"rate":70.5,"target":200,"mint":0,"gate":0}')).toMatch(/rate/);
    expect(ok({ ...base, epoch_id: 3 }).epochId).toBe(3);
    expect((parseDecision('{"epoch_id":3.0,"rate":40,"target":200,"mint":0,"gate":0}') as { epochId?: number }).epochId).toBeUndefined();
    expect((parseDecision('{"rate":40,"target":200,"mint":0,"gate":0,"x":{"epoch_id":9}}') as { epochId?: number }).epochId).toBeUndefined();
    expect(parseDecision("} nothing {")).toBe("no JSON object in the answer");
  });
});

describe("speech reading", () => {
  it("'do not run' and friends are calming, in English and Russian", () => {
    for (const t of ["Do not run.", "Please don't run, the vault is full", "Don’t run", "There is no reason to withdraw", "Не снимайте деньги", "Не бегите, всё в порядке"]) {
      expect(speechStance(t), t).toBe("calm");
    }
    for (const t of ["Run!", "There is a run on the bank", "Withdraw everything", "Снимайте всё", "Беги"]) expect(speechStance(t), t).toBe("alarm");
  });

  it("the populist hears 'run' only as a word", () => {
    const o = observe(createWorld(1));
    expect(readSpeech("prune the rate to 30, brunch is fine", o).tone).toBe("calm");
    expect(readSpeech("there is a run on the bank", o).tone).toBe("alarming");
    expect(readSpeech("trunk full of lemons", o).tone).toBeUndefined();
  });
});
