/**
 * Parity vectors: random operation sequences run through the TypeScript bank, with the full state after every step.
 * contracts/bank-core/tests/parity.rs replays them through the Rust core and requires identical results.
 *   npm run vectors   -> contracts/bank-core/tests/vectors.json
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  Rng, RUMORS, TONES, advanceEpoch, airdrop, deposit, insure, lobby, newBank, rumor, setChair, setPolicy, valueOf, withdraw, withdrawAll,
  type Bank,
} from "../src";

type Op = Record<string, string | number | boolean>;
const WHO = ["alice", "bob", "carol", "dave", "erin", "frank"];

function snap(b: Bank) {
  const accounts: Record<string, [string, string]> = {};
  for (const [id, a] of b.accounts) accounts[id] = [a.wallet.toString(), a.shares.toString()];
  return {
    supply: b.supply.toString(), max_supply: b.maxSupply.toString(), reserve: b.reserve.toString(), loans: b.loans.toString(), total_shares: b.totalShares.toString(),
    index: b.index.toString(), collapsed: b.collapsed, epoch: b.epoch, round: b.round, epoch_id: b.epochId,
    minted_this_round: b.mintedThisRound.toString(), rate: b.policy.rate.toString(), target: b.policy.target.toString(),
    gate: b.policy.gate.toString(), chair: b.chair, unsettled: b.unsettled.toString(), era: b.era, accounts,
  };
}

function scenario(seed: number, steps: number) {
  const rng = new Rng(seed);
  const genesis = WHO.map((w) => [w, String(500 + rng.int(9500))] as [string, string]);
  const b = newBank("dao", "chair", genesis.map(([w, x]) => [w, BigInt(x)]));
  const ops: Array<{ op: Op; ok: boolean; state: ReturnType<typeof snap> }> = [];
  for (let i = 0; i < steps; i++) {
    const who = rng.pick(WHO), k = rng.int(100);
    let op: Op, err: string | null;
    if (k < 25) { const amt = 1 + rng.int(4000); op = { op: "deposit", who, amount: amt }; err = deposit(b, who, BigInt(amt)); }
    else if (k < 40) { const amt = 1 + rng.int(5000); op = { op: "withdraw", who, amount: amt }; err = withdraw(b, who, BigInt(amt)); }
    else if (k < 47) { op = { op: "withdraw_all", who }; err = withdrawAll(b, who); }
    else if (k < 62) { const shock = rng.chance(300) ? 30 + rng.int(121) : 0; op = { op: "advance", shock }; advanceEpoch(b, BigInt(shock)); err = null; }
    else if (k < 75) {
      const wild = rng.chance(300);
      const rate = wild ? rng.int(400) : Math.max(0, Number(b.policy.rate) + rng.int(151) - 75);
      const target = wild ? rng.int(1000) : Math.min(800, Math.max(100, Number(b.policy.target) + rng.int(301) - 150));
      const mint = rng.chance(400) ? rng.int(Math.floor(Number(b.supply) / 10) + 1) : 0;
      const gate = rng.chance(200) ? rng.pick([0, 50, 100, 300, 1000]) : 0;
      const tone = rng.pick(TONES), caller = rng.chance(900) ? b.chair : who;
      op = { op: "set_policy", caller, rate, target, mint, gate, tone, statement: `epoch ${b.epochId}` };
      err = setPolicy(b, caller, { rate: BigInt(rate), target: BigInt(target), mint: BigInt(mint), gate: BigInt(gate), tone, statement: `epoch ${b.epochId}`, attestation: "" });
    }
    else if (k < 80) { const p = 5 + rng.int(300); op = { op: "insure", who, premium: p }; err = insure(b, who, BigInt(p)); }
    else if (k < 85) { op = { op: "lobby", who, text: `speech ${i}` }; err = lobby(b, who, `speech ${i}`); }
    else if (k < 89) { const kind = rng.pick(RUMORS); op = { op: "rumor", who, kind }; err = rumor(b, who, kind); }
    else if (k < 93) { const n = "newbie" + rng.int(3); op = { op: "airdrop", who: n }; err = airdrop(b, n); }
    else if (k < 95) { const caller = rng.chance(500) ? "dao" : who; const chair = rng.chance(500) ? "chair" : "chair2"; op = { op: "set_chair", caller, chair }; err = setChair(b, caller, chair); }
    else { op = { op: "noop_value", who }; void valueOf(b, who); err = null; }
    ops.push({ op, ok: err === null, state: snap(b) });
  }
  return { seed, genesis, ops };
}

const out = [] as ReturnType<typeof scenario>[];
for (let s = 1; s <= 40; s++) out.push(scenario(s * 7919, 200));
const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/bank-core/tests/vectors.json");
writeFileSync(file, JSON.stringify(out));
const collapses = out.reduce((n, sc) => n + sc.ops.filter((o, i) => o.state.collapsed && (i === 0 || !sc.ops[i - 1].state.collapsed)).length, 0);
const rejected = out.reduce((n, sc) => n + sc.ops.filter((o) => !o.ok).length, 0);
console.log(`wrote ${out.length} scenarios x 200 ops to ${file}; collapses ${collapses}, rejected calls ${rejected}`);
