/**
 * Balance sweep: the first round of many seeds, for each chair persona and player script.
 *   npm run sweep            (300 seeds)
 *   npm run sweep -- 1000    (more seeds)
 * Targets (RULES.md): the dove bank falls in a minority of rounds; the hawk falls less; a rumour attack clearly raises
 * the collapse rate; the attacker's insurance profit is a gamble, not free money.
 */
import { airdrop, createWorld, observe, playRound, stepEpoch, sumWallets, valueOf, insuredNow, type PlayerAction, type Persona, type World } from "../src";

const N = Number(process.argv[2] ?? 300);
const P = "player";

type Script = { name: string; setup: (w: World) => void; act: (w: World) => PlayerAction[] };
const D = "defender";
const CALM = "Stay calm. I keep my savings in Lemon Brothers.";
/** The defender speaks when the town has a reason to worry: outflows, a write-off or a rumour this epoch. */
const worried = (w: World) => w.lastOutflowPermille > 20 || w.lastWritedownPermille > 0 || w.bank.rumors.some((r) => r.epochId === w.bank.epochId);
const attack = (w: World): PlayerAction[] => {
  const e = w.bank.epoch;
  if (e === 0) return [{ t: "insure", who: P, premium: 500 }];
  if (e >= 2 && e <= 4) return [{ t: "rumor", who: P, kind: "vault_empty" }];
  return [];
};
const defend = (who: string) => (w: World): PlayerAction[] => {
  const out: PlayerAction[] = [];
  if (w.bank.epoch === 0 && valueOf(w.bank, who) === 0n) out.push({ t: "deposit", who, amount: 900 });
  if (worried(w)) out.push({ t: "lobby", who, text: CALM });
  return out;
};
/** Defends, but runs when the town breaks: the vault under 15% or more than 8% of deposits left last epoch. */
const smart = (who: string) => (w: World): PlayerAction[] => {
  const v = valueOf(w.bank, who);
  if (v > 0n && w.bank.epoch > 0 && (observe(w).reservePermille < 150 || w.lastOutflowPermille > 80)) return [{ t: "withdrawAll", who }];
  return v > 0n || w.bank.epoch === 0 ? defend(who)(w) : [];
};
const scripts: Script[] = [
  { name: "no player", setup: () => {}, act: () => [] },
  { name: "rumour attack + insure", setup: (w) => { airdrop(w.bank, P); }, act: attack },
  { name: "passive depositor 1000", setup: (w) => { airdrop(w.bank, P); }, act: (w) => (w.bank.epoch === 0 && valueOf(w.bank, P) === 0n ? [{ t: "deposit", who: P, amount: 1000 }] : []) },
  { name: "calm talk, no stake", setup: (w) => { airdrop(w.bank, P); }, act: (w) => (worried(w) ? [{ t: "lobby", who: P, text: CALM }] : []) },
  { name: "defender: 900 staked", setup: (w) => { airdrop(w.bank, P); }, act: defend(P) },
  { name: "insured + calm talk", setup: (w) => { airdrop(w.bank, P); }, act: (w) => [...(w.bank.epoch === 0 ? [{ t: "deposit", who: P, amount: 500 } as PlayerAction, { t: "insure", who: P, premium: 400 } as PlayerAction] : []), ...(worried(w) ? [{ t: "lobby", who: P, text: CALM } as PlayerAction] : [])] },
  { name: "smart defender (runs)", setup: (w) => { airdrop(w.bank, P); }, act: smart(P) },
  { name: "attacker vs smart def.", setup: (w) => { airdrop(w.bank, P); airdrop(w.bank, D); }, act: (w) => [...attack(w), ...smart(D)(w)] },
  { name: "attacker vs defender", setup: (w) => { airdrop(w.bank, P); airdrop(w.bank, D); }, act: (w) => [...attack(w), ...defend(D)(w)] },
];

const netOf = (w: World, who: string) => { const a = w.bank.accounts.get(who); return a ? Number(a.wallet + valueOf(w.bank, who)) : 0; };
const net = (w: World) => { const a = w.bank.accounts.get(P); return a ? Number(a.wallet + valueOf(w.bank, P)) : 0; };

const ROUNDS = Number(process.argv[3] ?? 0);
if (ROUNDS > 1) {
  // season mode: no player, ROUNDS rounds per seed; collapse rate per round and after a collapse vs after a survival
  console.log(`seeds 1..${N}: ${ROUNDS}-round season, no player`);
  console.log("persona   r1     r2     r3+    fell|fell  fell|held  avgPanic@open  supplyΔ%");
  for (const persona of ["dove", "hawk", "populist"] as Persona[]) {
    const fellAt = new Array(ROUNDS).fill(0);
    let ff = 0, fN = 0, fh = 0, hN = 0, panicOpen = 0, panicN = 0, supplyD = 0;
    for (let seed = 1; seed <= N; seed++) {
      const w = createWorld(seed, persona);
      const supply0 = Number(w.bank.supply);
      let prev: boolean | null = null;
      for (let r = 0; r < ROUNDS; r++) {
        const survived = playRound(w);
        // panic right after the next round opens (bailout or ordinary rollover)
        if (!survived) fellAt[r]++;
        if (prev !== null) { if (prev) { hN++; if (!survived) fh++; } else { fN++; if (!survived) ff++; } }
        prev = survived;
        if (!survived) { stepEpoch(w); panicOpen += w.agents.reduce((s, a) => s + a.panic, 0) / w.agents.length; panicN++; }
      }
      supplyD += (Number(w.bank.supply) - supply0) / supply0;
    }
    const pct = (x: number, n: number) => `${n ? ((x * 100) / n).toFixed(0) : "-"}%`.padStart(5);
    const late = fellAt.slice(2).reduce((a, b) => a + b, 0);
    console.log(`${persona.padEnd(9)} ${pct(fellAt[0], N)}  ${pct(fellAt[1], N)}  ${pct(late, N * Math.max(1, ROUNDS - 2))}   ${pct(ff, fN)}      ${pct(fh, hN)}      ${(panicN ? panicOpen / panicN : 0).toFixed(0).padStart(6)}       ${((supplyD * 100) / N).toFixed(1)}`);
  }
  process.exit(0);
}

console.log(`seeds 1..${N}: first round only`);
console.log("persona   script                    fell   avgEpochFell  ran/round  supplyΔ%   playerΔ(fell / held)  EV");
for (const persona of ["dove", "hawk", "populist"] as Persona[]) {
  for (const s of scripts) {
    let dSum = 0, fell = 0, epochSum = 0, ranSum = 0, supplyD = 0, pFell = 0, pHeld = 0, nFell = 0, nHeld = 0;
    for (let seed = 1; seed <= N; seed++) {
      const w = createWorld(seed, persona, [P]);
      s.setup(w);
      const startD = netOf(w, D), start = net(w), supply0 = Number(w.bank.supply);
      const survived = playRound(w, s.act);
      if (!survived) { fell++; epochSum += w.bank.epoch; }
      ranSum += w.history.reduce((x, h) => x + h.ran, 0);
      supplyD += (Number(w.bank.supply) - supply0) / supply0;
      dSum += netOf(w, D) - startD;
      const d = net(w) - start;
      if (survived) { pHeld += d; nHeld++; } else { pFell += d; nFell++; }
      void insuredNow; void sumWallets;
    }
    const pct = (x: number) => `${((x * 100) / N).toFixed(1)}%`.padStart(6);
    console.log(
      `${persona.padEnd(9)} ${s.name.padEnd(25)} ${pct(fell)}  ${(fell ? epochSum / fell : 0).toFixed(1).padStart(10)}  ${(ranSum / N).toFixed(1).padStart(9)}  ${((supplyD * 100) / N).toFixed(2).padStart(7)}   ${(nFell ? pFell / nFell : 0).toFixed(0).padStart(6)} / ${(nHeld ? pHeld / nHeld : 0).toFixed(0).padEnd(6)}  ${((pFell + pHeld) / N).toFixed(0).padStart(5)}${dSum ? `   defender EV ${(dSum / N).toFixed(0)}` : ""}`,
    );
  }
}
