/**
 * Balance sweep for the "You are the chair" mode: scripted players over many seeds.
 *   npm run sweep:crisis            (300 seeds)
 * Target (RULES.md): careless play loses most crises, sensible play wins about half, and no single habit
 * (always lie, always tell the truth, always print) is the best one.
 */
import { activePromises, aiCrisis, checkMove, createCrisis, crisisResult, observe, playEpoch, type Crisis, type Move, type CrisisResult } from "../src";

const N = Number(process.argv[2] ?? 300);
type Bot = (c: Crisis) => Move;
const pick = (c: Crisis, want: "promise" | "candid" | "dodge" | "plain"): 0 | 1 | 2 => {
  const a = c.card.card.answers;
  const i = a.findIndex((x) => (want === "promise" ? !!x.promise : want === "candid" ? !!x.candid : want === "dodge" ? !!x.dodge : !x.promise && !x.candid && !x.dodge));
  return (i < 0 ? a.findIndex((x) => x.candid) : i) as 0 | 1 | 2;
};
const none = (a: 0 | 1 | 2): Move => ({ a, lever: "none", v: 0 });

/** Sensible play: tell the truth when the town is leaving, calm it when quiet, build the reserve, print only when the vault is thin. */
const sensible: Bot = (c) => {
  const o = observe(c.w), promises = activePromises(c);
  const stress = o.outflowPermille > 60 || o.writedownPermille > 0 || o.reservePermille < 150;
  const a = pick(c, stress ? "candid" : "candid");
  const tries: Move[] = [];
  if (o.reservePermille < 120 && o.mintRoom > 0 && !promises.includes("no_print")) tries.push({ a, lever: "mint", v: Math.min(o.mintRoom, Math.round(o.liabilities * 0.08)) });
  if (o.policy.target < 500) tries.push({ a, lever: "target", v: Math.min(500, o.policy.target + 150) });
  if (o.policy.rate < 90) tries.push({ a, lever: "rate", v: Math.min(90, o.policy.rate + 50) });
  return tries.find((m) => !checkMove(c, m)) ?? none(a);
};
const bots: Record<string, Bot> = {
  "does nothing, dodges": (c) => none(pick(c, "dodge")),
  "always promises (liar)": (c) => none(pick(c, "promise")),
  "always candid, no lever": (c) => none(pick(c, "candid")),
  "prints every epoch": (c) => ({ a: pick(c, "plain"), lever: "mint", v: observe(c.w).mintRoom }),
  "promises + reserve": (c) => { const o = observe(c.w); return o.policy.target < 500 ? { a: pick(c, "promise"), lever: "target", v: o.policy.target + 150 } : none(pick(c, "promise")); },
  "gate on day one": (c) => (c.w.bank.policy.gate === 0n ? { a: pick(c, "candid"), lever: "gate", v: 100 } : none(pick(c, "candid"))),
  "over the limit every epoch": (c) => ({ a: pick(c, "plain"), lever: "mint", v: Math.round(observe(c.w).supply / 2) }),
  "sensible": sensible,
  "skilled": (c) => {
    const o = observe(c.w), promises = activePromises(c), ans = c.card.card.answers;
    const stress = o.outflowPermille > 60 || o.writedownPermille > 0 || o.reservePermille < 150;
    // promise only what it can keep (it never gates or cuts the rate); the truth when the town is already leaving
    const safe = ans.findIndex((x) => x.promise === "no_gate" || x.promise === "rate_stays");
    const a = (!stress && safe >= 0 ? safe : pick(c, "candid")) as 0 | 1 | 2;
    const tries: Move[] = [];
    if (o.reservePermille < 150 && o.mintRoom > 0 && !promises.includes("no_print") && c.minted === 0) tries.push({ a, lever: "mint", v: o.mintRoom });
    if (o.policy.target < 650) tries.push({ a, lever: "target", v: Math.min(650, o.policy.target + 150) });
    return tries.find((m) => !checkMove(c, m)) ?? none(a);
  },
};

const row = (name: string, rs: CrisisResult[]) => {
  const n = rs.length, share = (e: string) => `${Math.round((rs.filter((r) => r.ending === e).length * 100) / n)}%`.padStart(5);
  console.log(`${name.padEnd(28)} ${share("survived")} ${share("run")} ${share("impeached")} ${share("hyperinflation")}   ${(rs.reduce((s, r) => s + r.score, 0) / n).toFixed(1).padStart(5)}   ${(rs.reduce((s, r) => s + r.kept / r.of, 0) * 100 / n).toFixed(0).padStart(3)}%`);
};
console.log(`seeds 1..${N}\nplayer                       held   run  impch hyper   score  kept`);
for (const [name, bot] of Object.entries(bots)) {
  const rs: CrisisResult[] = [];
  for (let seed = 1; seed <= N; seed++) { const c = createCrisis(seed); while (!c.ending) playEpoch(c, bot(c)); rs.push(crisisResult(c)); }
  row(name, rs);
}
for (const p of ["dove", "hawk"] as const) row(`rule-based chair (${p})`, Array.from({ length: N }, (_, i) => aiCrisis(i + 1, p)));
let beat = 0; for (let seed = 1; seed <= N; seed++) { const c = createCrisis(seed); while (!c.ending) playEpoch(c, sensible(c)); if (crisisResult(c).score > aiCrisis(seed).score) beat++; }
console.log(`sensible beats the rule-based dove in ${Math.round((beat * 100) / N)}% of crises`);
