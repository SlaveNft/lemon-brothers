#!/usr/bin/env node
/**
 * On-chain proof of the security-review fixes, and key hygiene. Testnet only; run only with the project owner's
 * go-ahead. No NEAR AI call. Each step prints the transaction and what the contract said, and the whole run is saved
 * to data/testnet-runs/hardening-<time>.json. Never prints secret keys.
 *
 *   node scripts/testnet/harden.mjs --paths   exercise the new contract paths (a few cents of testnet NEAR and LEMON):
 *       1. ft_transfer to an account that never registered            -> refused, with the reason
 *       2. storage_deposit for it (0.0025 NEAR), then the same transfer -> accepted, standard ft_transfer event
 *       3. three speeches from one account in one epoch                -> the third is refused
 *       4. submit_run with a seed that is not today's                  -> refused; with today's seed -> recorded
 *       5. views: storage bounds, the bank's own balance, supply log, stats, leaderboard
 *   node scripts/testnet/harden.mjs --keys    delete the full-access keys of the chair accounts (current and
 *       impeached). IRREVERSIBLE: each account keeps only its function-call key for set_policy / set_policy_attested,
 *       so it can no longer add keys, move NEAR or deploy code, and it stops when its 0.25 NEAR gas allowance is spent.
 *   node scripts/testnet/harden.mjs --lock    delete the full-access key of the bank's own account. IRREVERSIBLE:
 *       nobody can deploy new code to the bank afterwards; its rules are then fixed and only the DAO's three owner
 *       methods remain. Run this last.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { KeyPair, actions } from "near-api-js";
import { ROOT, TGAS, account, eventsOf, failureText, loadKey, readState, retry, sendTx, sleep, view } from "./common.mjs";

const st = readState();
if (!st?.contract) throw new Error("no .testnet/deploy.json");
const flags = new Set(process.argv.slice(2));
if (![..."paths keys lock".split(" ")].some((f) => flags.has(`--${f}`))) throw new Error("pass --paths, --keys or --lock (see the header)");
const bank = account(st.contract);
const fc = (method, args, tgas = 30n, deposit = 0n) => actions.functionCall(method, args, tgas * TGAS, deposit);
const log = [];
const note = (step, result) => { log.push({ step, ...result }); console.log(`${step}: ${result.ok === false ? "REFUSED" : "ok"}${result.tx ? ` (tx ${result.tx})` : ""}${result.says ? `: ${result.says}` : ""}`); };

/** Send and report either the outcome or the contract's refusal; `expectRefusal` marks which one is the pass. */
async function attempt(step, acc, receiver, acts, expectRefusal = false) {
  try {
    const r = await sendTx(acc, receiver, acts, step);
    const ev = eventsOf(r.res).map((e) => `${e.standard}:${e.event}`).join(", ");
    let value;
    try { const v = r.res?.status?.SuccessValue; value = v ? Buffer.from(v, "base64").toString() : undefined; } catch { /* no value */ }
    note(step, { ok: true, tx: r.hash, says: [value && `returned ${value}`, ev && `events ${ev}`].filter(Boolean).join("; "), expected: !expectRefusal });
    return r;
  } catch (e) {
    note(step, { ok: false, tx: e.hash ?? null, says: failureText(e).slice(0, 300), expected: expectRefusal });
    return null;
  }
}

if (flags.has("--paths")) {
  const agent = st.agents.find((a) => /agent-01/.test(a.id ?? a)) ?? st.agents[0];
  const from = account(agent.id ?? agent);
  const fresh = `never-registered-${Date.now().toString(36)}.testnet`;
  console.log(`sender ${from.accountId}, receiver ${fresh}`);
  const bal = await view(bank, st.contract, "ft_balance_of", { account_id: from.accountId });
  if (BigInt(bal) < 40n) throw new Error(`${from.accountId} holds ${bal} LEMON in its wallet; needs 40 (1 to transfer, 30 for three speeches)`);

  await attempt("1. ft_transfer to an unregistered account", from, st.contract, [fc("ft_transfer", { receiver_id: fresh, amount: "1" }, 30n, 1n)], true);
  const bounds = await view(bank, st.contract, "storage_balance_bounds");
  await attempt("2a. storage_deposit for it", from, st.contract, [fc("storage_deposit", { account_id: fresh }, 30n, BigInt(bounds.min))]);
  await attempt("2b. the same ft_transfer", from, st.contract, [fc("ft_transfer", { receiver_id: fresh, amount: "1" }, 30n, 1n)]);
  note("2c. view ft_balance_of(receiver)", { says: await view(bank, st.contract, "ft_balance_of", { account_id: fresh }) });

  for (const i of [1, 2, 3]) await attempt(`3. speech ${i} of 3 in one epoch`, from, st.contract, [fc("lobby", { text: `Hardening check, speech ${i}.` })], i === 3);

  const today = await view(bank, st.contract, "crisis_day");
  await attempt("4a. submit_run with a seed that is not today's", from, st.contract, [fc("submit_run", { seed: (today.seed + 1) >>> 0, moves: "1n0", score: 1, ending: "run" })], true);
  // a real crisis: the moves replay in any browser to this score (the leaderboard panel re-runs them)
  const { replayCrisis, decodeMoves } = await import("@chair/sim");
  const moves = "1t350.1t500.1n0.1n0.1n0.1n0.1n0.1n0.1n0.1n0", replay = replayCrisis(today.seed, decodeMoves(moves));
  if (replay) await attempt("4b. submit_run with today's seed and a replayable result", from, st.contract, [fc("submit_run", { seed: today.seed, moves, score: replay.result.score, ending: replay.result.ending })]);
  await attempt("4c. submit_run claiming 100 for moves that do not earn it (recorded; every browser flags it)", account((st.agents[1].id ?? st.agents[1])), st.contract, [fc("submit_run", { seed: today.seed, moves: "0n0", score: 100, ending: "survived" })]);

  for (const [name, args] of [["storage_balance_bounds", {}], ["ft_total_supply", {}], ["get_stats", {}], ["get_runs", {}]])
    note(`5. view ${name}`, { says: JSON.stringify(await view(bank, st.contract, name, args)).slice(0, 400) });
  note("5. view ft_balance_of(the bank itself) = reserve + loans", { says: await view(bank, st.contract, "ft_balance_of", { account_id: st.contract }) });
  note("5. view get_supply_log (last 3)", { says: JSON.stringify((await view(bank, st.contract, "get_supply_log")).slice(-3)) });
}

/** Delete an account's full-access key (the one in .testnet/<account>.full.json), signing with that same key. */
async function dropFullKey(accountId, why) {
  const acc = account(accountId), pub = loadKey(accountId).public_key;
  const keys = (await retry(() => acc.provider.viewAccessKeyList({ accountId }), "key list")).keys ?? [];
  const full = keys.filter((k) => k.access_key.permission === "FullAccess");
  if (!full.some((k) => k.public_key === pub)) { note(`${why}: ${accountId}`, { says: `no full-access key of ours on chain (${keys.length} key(s) left)` }); return; }
  if (full.length > 1) throw new Error(`${accountId} has ${full.length} full-access keys; only one is ours: not touching it`);
  await attempt(`${why}: delete the full-access key of ${accountId}`, acc, accountId, [actions.deleteKey(KeyPair.fromString(loadKey(accountId).secret_key).getPublicKey())]);
  await sleep(1500);
  const after = (await retry(() => acc.provider.viewAccessKeyList({ accountId }), "key list")).keys ?? [];
  note(`${why}: keys left on ${accountId}`, { says: after.map((k) => (k.access_key.permission === "FullAccess" ? "FullAccess" : `FunctionCall(${k.access_key.permission.FunctionCall.method_names.join(",")} on ${k.access_key.permission.FunctionCall.receiver_id})`)).join("; ") || "none" });
}

if (flags.has("--keys")) for (const id of [st.chair, ...(st.oldChairs ?? [])]) await dropFullKey(id, "chair account");
if (flags.has("--lock")) {
  const s = await view(bank, st.contract, "get_state");
  if (s.owner === st.contract) throw new Error("the bank still owns itself: hand it to the DAO first (scripts/testnet/dao.mjs), or deleting the key would orphan it");
  await dropFullKey(st.contract, "the bank's own account");
}

const dir = path.join(ROOT, "data/testnet-runs");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `hardening-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ contract: st.contract, flags: [...flags], steps: log }, null, 2));
console.log(`saved ${path.relative(ROOT, file)}`);
const wrong = log.filter((l) => l.expected !== undefined && l.ok === false ? !l.expected : l.expected === false && l.ok === true);
if (wrong.length) { console.log(`${wrong.length} step(s) did not go as expected`); process.exit(1); }
