/**
 * AI depositors in one local town: a few of the sixty are driven by a NEAR AI Cloud model, the rest by their rule.
 * Prints what each AI depositor decided each day and why, and saves the whole run to data/minds-runs/.
 * No chain, no transactions: only model completions (one small one per AI depositor per day).
 *
 *   NEAR_AI_API_KEY=... npm run minds                  3 AI depositors, 8 days, the rule-based chair (free)
 *   NEAR_AI_API_KEY=... AI_DEPOSITORS=5 DAYS=10 SEED=7 PERSONA=hawk npm run minds
 *
 * Without a key every "AI" depositor falls back to its rule and the output says so.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { character, createWorld, fallbackChair, observe, stepEpoch, valueOf, type MindMove, type Persona, type PlayerAction } from "@chair/sim";
import { askDepositors, configFromEnv, nearAiCallsMade, pickDepositors } from "@chair/chair";

async function main() {
  const int = (v: string | undefined, d: number, max: number) => { const x = Number(v); return Number.isInteger(x) && x > 0 ? Math.min(x, max) : d; };
  const seed = int(process.env.SEED, 7, 1e9), days = int(process.env.DAYS, 8, 40), n = int(process.env.AI_DEPOSITORS, 3, 12);
  const persona = (["dove", "hawk", "populist"].includes(process.env.PERSONA ?? "") ? process.env.PERSONA : "hawk") as Persona;
  const cfg = { ...configFromEnv(), maxCalls: Math.max(configFromEnv().maxCalls, days * n) };
  const w = createWorld(seed, persona), who = pickDepositors(n, w.agents.length);
  console.log(`town seed ${seed}, chair ${persona} (rule-based), ${days} days; AI depositors (${cfg.apiKey ? cfg.model : "NO KEY: rule fallback"}):`);
  for (const i of who) console.log(`  ${w.agents[i].name} (${w.agents[i].id}): ${character(w.agents[i])}`);
  const log: unknown[] = [];
  for (let day = 0; day < days; day++) {
    if (w.bank.collapsed) { stepEpoch(w); console.log(`\n-- the bank fell; bailout, a new round opens`); log.push({ day, bailout: true }); continue; }
    const chair = fallbackChair(observe(w), w.persona);
    const minds = await askDepositors(w, who, chair, cfg);
    const says: PlayerAction[] = [...minds].filter(([, m]) => m.source === "model" && m.say).map(([id, m]) => ({ t: "lobby", who: id, text: m.say }));
    const before = new Map(who.map((i) => [w.agents[i].id, Number(valueOf(w.bank, w.agents[i].id))]));
    const vault = Number(w.bank.reserve), owed = Number(valueOf(w.bank, w.agents[0].id)) >= 0 ? Number((w.bank.totalShares * w.bank.index) / 10n ** 12n) : 0;
    stepEpoch(w, says, chair, "", [], minds);
    const h = w.history[w.history.length - 1] as { ran?: number } | undefined;
    console.log(`\n-- round ${w.press[w.press.length - 1].round + 1} day ${w.press[w.press.length - 1].epoch + 1}: chair (${chair.tone}) "${chair.statement}"`);
    console.log(`   vault ${vault} of ${owed} owed; ${h?.ran ?? "?"} depositors ran today${w.bank.collapsed ? "; THE BANK FELL" : ""}`);
    const moves: Array<{ id: string; name: string } & MindMove & { depositBefore: number }> = [];
    for (const i of who) {
      const a = w.agents[i], m = a.mind!;
      console.log(`   ${a.name}: ${m.choice.toUpperCase()} [${m.source}] ${m.why}${m.say ? `\n      says: "${m.say}"` : ""}`);
      moves.push({ id: a.id, name: a.name, ...m, depositBefore: before.get(a.id) ?? 0 });
    }
    log.push({ day, round: w.press[w.press.length - 1].round, epoch: w.press[w.press.length - 1].epoch, chair: { tone: chair.tone, statement: chair.statement }, vault, owed, ran: h?.ran ?? null, fell: w.bank.collapsed, moves });
  }
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "minds-runs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `minds-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ seed, persona, days, model: cfg.apiKey ? cfg.model : null, depositors: who.map((i) => ({ id: w.agents[i].id, name: w.agents[i].name, character: character(w.agents[i]) })), paidCompletions: nearAiCallsMade(), log }, null, 2) + "\n");
  console.log(`\n${nearAiCallsMade()} paid completions; saved ${path.relative(process.cwd(), file)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
