/**
 * Crisis parity vectors: whole games of "You are the chair" played by the TypeScript engine with random moves (legal
 * and illegal ones), every day recorded. contracts/crisis-core/tests/parity.rs replays them in Rust and requires the
 * same days, ending and score, so the contract scores a leaderboard claim exactly as every browser does.
 *   npm run vectors   -> also writes contracts/crisis-core/tests/crisis-vectors.json
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Rng, createCrisis, crisisResult, dailyCrisis, encodeMoves, playEpoch, type Move } from "../src";

const LEVERS = ["none", "rate", "target", "mint", "gate"] as const;

function randomMove(rng: Rng, c: ReturnType<typeof createCrisis>): Move {
  const a = rng.int(3) as 0 | 1 | 2;
  const lever = LEVERS[rng.int(5)];
  const p = c.w.bank.policy, supply = Number(c.w.bank.supply);
  const wild = rng.chance(250);
  let v = 0;
  if (lever === "rate") v = wild ? rng.int(400) : Math.max(0, Number(p.rate) + rng.int(151) - 75);
  if (lever === "target") v = wild ? rng.int(1000) : Math.min(800, Math.max(100, Number(p.target) + rng.int(301) - 150));
  if (lever === "mint") v = wild ? rng.int(Math.floor(supply / 2) + 1) : rng.int(Math.floor(supply / 20) + 1);
  if (lever === "gate") v = wild ? rng.int(100) : rng.pick([0, 100, 300, 1000, 5000]);
  return { a, lever, v };
}

const out: unknown[] = [];
const seeds: number[] = [];
for (let d = 1; d <= 40; d++) seeds.push(dailyCrisis(Date.UTC(2026, 10, 12 + d)).seed);
for (let s = 1; s <= 160; s++) seeds.push((s * 2654435761) >>> 0);
let games = 0;
for (const seed of seeds) {
  for (let g = 0; g < 4; g++) {
    const rng = new Rng(seed ^ (g * 0x45d9f3b) || 1);
    const c = createCrisis(seed);
    // game 0: candid and still; game 3: prints the most the contract allows every day; the others: random moves
    const printer = (): Move => ({ a: rng.int(3) as 0 | 1 | 2, lever: "mint", v: Math.floor((Number(c.w.bank.supply) * 50) / 1000) });
    while (!c.ending) playEpoch(c, g === 0 ? { a: 1, lever: "none", v: 0 } : g === 3 ? printer() : randomMove(rng, c));
    const r = crisisResult(c);
    out.push({
      seed, moves: encodeMoves(c.moves),
      days: c.log.map((l) => ({ card: l.cardId, rejected: !!l.rejected, ran: l.ran, avg_panic: l.avgPanic, reserve_permille: l.reservePermille, credibility: l.credibility, collapsed: l.collapsed })),
      result: { ending: r.ending, epochs: r.epochs, score: r.score, kept: r.kept, of: r.of, credibility: r.credibility, printed_permille: r.printedPermille },
    });
    games++;
  }
}
const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/crisis-core/tests/crisis-vectors.json");
writeFileSync(file, JSON.stringify(out));
const endings: Record<string, number> = {};
for (const g of out as Array<{ result: { ending: string } }>) endings[g.result.ending] = (endings[g.result.ending] ?? 0) + 1;
console.log(`wrote ${games} crisis games to ${file}; endings ${JSON.stringify(endings)}`);
