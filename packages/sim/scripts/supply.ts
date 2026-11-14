/**
 * Supply over time: what the memecoin mechanic does to $LEMON over a 60-round season under a few towns.
 *   npm run supply            (100 seeds, 60 rounds; prints the table, writes docs/supply.svg)
 * Every mint and burn comes from the bank's own events (packages/sim/src/bank.ts, mirrored by the contract):
 * minted = loan yield + the chair's emergency prints + bailouts + insurance payouts; burned = speech and rumour
 * fees + fire-sale haircuts + loan write-offs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { airdrop, createWorld, playRound, valueOf, type Persona, type PlayerAction, type World } from "../src";

const SEEDS = Number(process.argv[2] ?? 100), ROUNDS = Number(process.argv[3] ?? 60), P = "player";
type Scenario = { name: string; persona: Persona; color: string; setup?: (w: World) => void; act?: (w: World) => PlayerAction[] };
const CALM = "Stay calm. I keep my savings in Lemon Brothers.";
const scenarios: Scenario[] = [
  { name: "dove chair, quiet town", persona: "dove", color: "#f3d54e" },
  { name: "hawk chair, quiet town", persona: "hawk", color: "#6aa8ff" },
  { name: "dove chair, a rumour attacker every round", persona: "dove", color: "#ff5a5f", setup: (w) => { airdrop(w.bank, P); },
    act: (w) => (w.bank.epoch >= 2 && w.bank.epoch <= 4 ? [{ t: "rumor", who: P, kind: "vault_empty" }] : []) },
  { name: "dove chair, a staked defender calming the town", persona: "dove", color: "#5fd38d", setup: (w) => { airdrop(w.bank, P); },
    act: (w) => [...(w.bank.epoch === 0 && valueOf(w.bank, P) === 0n ? [{ t: "deposit", who: P, amount: 900 } as PlayerAction] : []),
      ...(w.lastOutflowPermille > 20 || w.lastWritedownPermille > 0 ? [{ t: "lobby", who: P, text: CALM } as PlayerAction] : [])] },
];

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const rows: Array<{ s: Scenario; curve: number[]; fell: number; printed: number; bailouts: number; insurance: number; burned: number; lo: number; hi: number }> = [];
for (const s of scenarios) {
  const curves: number[][] = []; let fell = 0, printed = 0, bailouts = 0, insurance = 0, burned = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const w = createWorld(seed, s.persona, s.setup ? [P] : []);
    s.setup?.(w);
    const supply0 = Number(w.bank.supply), curve = [100];
    for (let r = 0; r < ROUNDS; r++) { if (!playRound(w, s.act ?? (() => []))) fell++; curve.push((Number(w.bank.supply) * 100) / supply0); }
    for (const e of w.bank.events) {
      if (e.t === "policy") printed += Number(e.policy.mint) / supply0;
      else if (e.t === "bailout") bailouts += Number(e.minted) / supply0;
      else if (e.t === "insurance_payout") insurance += Number(e.amount) / supply0;
      else if (e.t === "writedown") burned += Number(e.amount) / supply0;
      else if (e.t === "withdraw") burned += Number(e.burned) / supply0;
    }
    curves.push(curve);
  }
  const curve = Array.from({ length: ROUNDS + 1 }, (_, i) => median(curves.map((c) => c[i])));
  const ends = curves.map((c) => c[ROUNDS]).sort((a, b) => a - b);
  rows.push({ s, curve, fell: fell / SEEDS, printed: (printed * 100) / SEEDS, bailouts: (bailouts * 100) / SEEDS, insurance: (insurance * 100) / SEEDS, burned: (burned * 100) / SEEDS, lo: ends[Math.floor(SEEDS * 0.1)], hi: ends[Math.floor(SEEDS * 0.9)] });
}

console.log(`${SEEDS} seeds, ${ROUNDS} rounds each; supply as % of the opening supply (median), flows as % of the opening supply (mean)`);
console.log("scenario                                          r10   r20   r40   r60  (10%..90%)   collapses  chair prints  bailouts  insurance  burned (write-offs + fire sales)");
for (const r of rows) {
  const at = (i: number) => r.curve[Math.min(i, ROUNDS)].toFixed(0).padStart(5);
  console.log(`${r.s.name.padEnd(48)} ${at(10)} ${at(20)} ${at(40)} ${at(60)}  (${r.lo.toFixed(0)}..${r.hi.toFixed(0)})`.padEnd(88) + `${r.fell.toFixed(1).padStart(6)}  ${r.printed.toFixed(0).padStart(11)}%  ${r.bailouts.toFixed(0).padStart(7)}%  ${r.insurance.toFixed(1).padStart(8)}%  ${r.burned.toFixed(0).padStart(6)}%`);
}

// the chart
const W = 860, H = 380, L = 56, R = 16, T = 20, B = 96;
const max = Math.max(...rows.flatMap((r) => r.curve)), min = Math.min(100, ...rows.flatMap((r) => r.curve));
const top = Math.ceil(max / 50) * 50, bottom = Math.floor(min / 50) * 50;
const x = (i: number) => L + (i / ROUNDS) * (W - L - R), y = (v: number) => T + (1 - (v - bottom) / (top - bottom)) * (H - T - B);
const grid = Array.from({ length: (top - bottom) / 50 + 1 }, (_, i) => bottom + i * 50);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">
<rect width="${W}" height="${H}" fill="#0f1420"/>
${grid.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 100 ? "#8e97a8" : "#2a3449"}" stroke-dasharray="${v === 100 ? "4 4" : "0"}"/><text x="${L - 8}" y="${y(v) + 4}" fill="#8e97a8" text-anchor="end">${v}%</text>`).join("\n")}
${[0, 10, 20, 30, 40, 50, 60].filter((i) => i <= ROUNDS).map((i) => `<text x="${x(i)}" y="${H - B + 18}" fill="#8e97a8" text-anchor="middle">${i}</text>`).join("\n")}
<text x="${(L + W - R) / 2}" y="${H - B + 36}" fill="#8e97a8" text-anchor="middle">rounds (one round = ten epochs)</text>
<text x="${L}" y="14" fill="#e9e4d6">$LEMON supply, % of the opening supply (median of ${SEEDS} seeded towns)</text>
${rows.map((r) => `<polyline fill="none" stroke="${r.s.color}" stroke-width="2.5" points="${r.curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`).join("\n")}
${rows.map((r, i) => `<rect x="${L + (i % 2) * 400}" y="${H - 44 + Math.floor(i / 2) * 20}" width="14" height="4" fill="${r.s.color}"/><text x="${L + 20 + (i % 2) * 400}" y="${H - 38 + Math.floor(i / 2) * 20}" fill="#e9e4d6">${r.s.name}: ${r.curve[ROUNDS].toFixed(0)}%</text>`).join("\n")}
</svg>
`;
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/supply.svg");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`chart: docs/supply.svg`);
