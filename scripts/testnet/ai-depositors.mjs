#!/usr/bin/env node
/**
 * AI depositors at the real bank: three of the bank's own depositor accounts are handed to the reference agent
 * (scripts/agent/depositor.mjs, the same file anyone can run for their own account) for a few epochs. Each epoch every
 * agent reads the bank, asks the model and makes its move with a real transaction; then the epoch is advanced.
 * Run only with the project owner's go-ahead (testnet transactions and NEAR AI completions).
 *
 *   NEAR_AI_API_KEY=... node scripts/testnet/ai-depositors.mjs            3 agents, 3 epochs
 *   NEAR_AI_API_KEY=... EPOCHS=4 node scripts/testnet/ai-depositors.mjs
 *   DRY=1 NEAR_AI_API_KEY=... node scripts/testnet/ai-depositors.mjs      ask the model, send nothing
 *   SETUP_DEPOSIT=1 ...                                                   first each of the three puts half of its wallet
 *                                                                         into the bank (a scripted setup step, recorded
 *                                                                         as such), so that "run" has something to take out
 *
 * Keys stay in .testnet/ and are passed to the child process in its environment, never printed. The whole run is
 * saved to data/testnet-runs/ai-depositors-<time>.json.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { actions } from "near-api-js";
import { ROOT, TGAS, account, failureText, loadKey, readState, sendTx, sleep, view } from "./common.mjs";

const st = readState();
if (!st?.contract) throw new Error("no .testnet/deploy.json");
if (!process.env.NEAR_AI_API_KEY) throw new Error("NEAR_AI_API_KEY is not set");
const DRY = !!process.env.DRY, EPOCHS = Math.max(1, Math.min(10, Number(process.env.EPOCHS) || 3));
const CHARACTERS = [
  "nervous by nature, does not trust what officials say, watches what the neighbours do",
  "hard to scare, tends to believe the bank's chair, makes up their own mind",
  "likes the interest, stays calm while the vault looks full, leaves the moment it looks thin",
];
const keeper = account(st.funders[0]);
const bankState = () => view(keeper, st.contract, "get_state");
const brief = (s) => ({ round: s.round, epoch: s.epoch, epochId: s.epoch_id, collapsed: s.collapsed, supply: s.supply, reserve: s.reserve, liabilities: s.liabilities, reservePermille: s.reserve_permille, tone: s.policy.tone });

// the three named depositor accounts with the most money in the bank (the last agent is the pooled crowd account)
const named = st.agents.slice(0, -1);
const balances = await Promise.all(named.map(async (id) => ({ id, a: await view(keeper, st.contract, "get_account", { account_id: id }) })));
const picked = balances.sort((x, y) => Number(y.a.deposit_value) + Number(y.a.wallet) - (Number(x.a.deposit_value) + Number(x.a.wallet))).slice(0, 3);
console.log(`${DRY ? "DRY RUN: " : ""}AI depositors at ${st.contract} for ${EPOCHS} epochs:`);
picked.forEach((p, i) => console.log(`  ${p.id}: deposit ${p.a.deposit_value}, wallet ${p.a.wallet}; character: ${CHARACTERS[i]}`));

function runAgent(id, character) {
  return new Promise((resolve) => {
    const env = { ...process.env, AGENT_ACCOUNT_ID: id, AGENT_PRIVATE_KEY: loadKey(id).secret_key, AGENT_CHARACTER: character, BANK_CONTRACT: st.contract, AGENT_JSON: "1" };
    const child = spawn(process.execPath, [path.join(ROOT, "scripts/agent/depositor.mjs"), ...(DRY ? [] : ["--send"])], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      process.stdout.write(out.split("\n").filter((l) => l && !l.startsWith("RESULT ")).map((l) => `  ${l}`).join("\n") + "\n");
      resolve(line ? JSON.parse(line.slice(7)) : { account: id, error: (err || out).trim().split("\n").filter((l) => !/Deprecation|trace-deprecation/.test(l)).slice(-2).join(" ").slice(0, 300) || `exit ${code}` });
    });
  });
}

async function advance() {
  let s = await bankState();
  const wait = Number(s.next_epoch_ms) - Date.now();
  if (wait > 0) { console.log(`  waiting ${Math.ceil(wait / 1000)} s for the epoch to end`); await sleep(wait + 1500); }
  try {
    const r = await sendTx(keeper, st.contract, [actions.functionCall("advance_epoch", {}, 100n * TGAS, 0n)], "advance_epoch");
    console.log(`  advance_epoch: tx ${r.hash}`);
    return { tx: r.hash };
  } catch (e) { console.log(`  advance_epoch refused: ${failureText(e).slice(0, 160)}`); return { refused: failureText(e).slice(0, 200), tx: e?.hash ?? null }; }
}

const setup = [];
if (process.env.SETUP_DEPOSIT && !DRY) {
  for (const p of picked) {
    if (Number(p.a.deposit_value) > 0 || Number(p.a.wallet) < 2) continue;
    const amount = String(Math.floor(Number(p.a.wallet) / 2));
    try {
      const r = await sendTx(account(p.id), st.contract, [actions.functionCall("deposit", { amount }, 30n * TGAS, 0n)], "setup deposit");
      console.log(`  setup (script, not the model): ${p.id} deposits ${amount} LEMON: tx ${r.hash}`);
      setup.push({ account: p.id, amount, tx: r.hash });
    } catch (e) { console.log(`  setup deposit for ${p.id} refused: ${failureText(e).slice(0, 160)}`); setup.push({ account: p.id, amount, refused: failureText(e).slice(0, 200) }); }
  }
}
const run = { setup, contract: st.contract, startedAt: new Date().toISOString(), dry: DRY, model: process.env.LLM_MODEL ?? "Qwen/Qwen3.6-35B-A3B-FP8", depositors: picked.map((p, i) => ({ account: p.id, character: CHARACTERS[i] })), epochs: [] };
for (let e = 0; e < EPOCHS; e++) {
  let s = await bankState();
  const entry = { before: brief(s), moves: [], advance: null, after: null };
  console.log(`\n-- round ${s.round + 1} epoch ${s.epoch + 1} (id ${s.epoch_id}): vault ${(Number(s.reserve_permille) / 10).toFixed(1)}%, ${s.collapsed ? "THE BANK IS CLOSED" : `chair (${s.policy.tone})`}`);
  if (!s.collapsed) for (let i = 0; i < picked.length; i++) { entry.moves.push(await runAgent(picked[i].id, CHARACTERS[i])); await sleep(800); }
  if (!DRY) entry.advance = await advance();
  s = await bankState();
  entry.after = brief(s);
  console.log(`  after: round ${s.round + 1} epoch ${s.epoch + 1}, supply ${s.supply}, vault ${s.reserve} of ${s.liabilities} owed${s.collapsed ? "; THE BANK FELL" : ""}`);
  run.epochs.push(entry);
  if (DRY) break;
}
const dir = path.join(ROOT, "data/testnet-runs");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `ai-depositors-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
console.log(`\nsaved ${path.relative(ROOT, file)}`);
process.exit(0); // the failover provider keeps timers alive
