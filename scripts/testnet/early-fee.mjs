#!/usr/bin/env node
/**
 * The early-withdrawal fee, on chain: the shared public guest deposits LEMON, waits for the next bank day (the keeper
 * starts it on the hour), and takes it straight out. The contract must charge the day's interest back and burn it.
 * Uses only the public guest's published function-call key (apps/web/src/chain/publicGuest.json). Gas only.
 *
 *   node scripts/testnet/early-fee.mjs [amount]      default 100 LEMON; waits up to 70 minutes for the bank day
 *
 * Writes data/testnet-runs/early-fee-<time>.json with both transactions and the fee the contract logged.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { PROVIDER, ROOT, TGAS, eventsOf, failureText, sendTx, sleep, view } from "./common.mjs";

const g = JSON.parse(readFileSync(path.join(ROOT, "apps/web/src/chain/publicGuest.json"), "utf8"));
const guest = new Account(g.accountId, PROVIDER, KeyPairSigner.fromSecretKey(g.secretKey));
const amount = String(Number(process.argv[2] ?? 100));
const out = { started: new Date().toISOString(), account: g.accountId, amount };

const s0 = await view(guest, g.contract, "get_state");
const a0 = await view(guest, g.contract, "get_account", { account_id: g.accountId });
console.log(`bank day ${s0.epoch_id}; guest wallet ${a0?.wallet}, deposit ${a0?.deposit_value}`);
if (BigInt(a0?.wallet ?? 0) < BigInt(amount)) throw new Error(`the guest holds ${a0?.wallet ?? 0} LEMON, less than ${amount}`);
const dep = await sendTx(guest, g.contract, [actions.functionCall("deposit", { amount }, 30n * TGAS, 0n)], "guest deposits");
out.deposit = { tx: dep.hash, epoch_id: s0.epoch_id };
console.log(`deposited ${amount} in bank day ${s0.epoch_id}: tx ${dep.hash}`);

const until = Date.now() + 70 * 60_000;
let s = s0;
while (Number(s.epoch_id) === Number(s0.epoch_id) && Date.now() < until) { await sleep(60_000); s = await view(guest, g.contract, "get_state"); }
if (Number(s.epoch_id) === Number(s0.epoch_id)) throw new Error("no new bank day within 70 minutes (is the keeper running?)");
const a1 = await view(guest, g.contract, "get_account", { account_id: g.accountId });
console.log(`bank day ${s.epoch_id} (rate added ${s.last_rate_bps} bps); early_fee_now ${a1.early_fee_now}; deposit ${a1.deposit_value}`);
try {
  const w = await sendTx(guest, g.contract, [actions.functionCall("withdraw_all", {}, 100n * TGAS, 0n)], "guest withdraws");
  const fee = eventsOf(w.res).find((e) => e.event === "early_withdrawal_fee")?.data?.[0] ?? null;
  const a2 = await view(guest, g.contract, "get_account", { account_id: g.accountId });
  out.withdraw = { tx: w.hash, epoch_id: s.epoch_id, rate_bps: s.last_rate_bps, fee, wallet_before: a1.wallet, wallet_after: a2.wallet };
  const net = BigInt(a2.wallet) - BigInt(a1.wallet) - BigInt(amount);
  console.log(`withdrew: fee ${fee ? `${fee.fee} LEMON of ${fee.withdrawn}` : "none"}; net gain of the round trip ${net} LEMON  tx ${w.hash}`);
  out.netGain = String(net);
} catch (e) { out.withdraw = { refused: failureText(e).slice(0, 200), tx: e?.hash ?? null }; console.log(`withdraw refused: ${failureText(e).slice(0, 200)}`); }
mkdirSync(path.join(ROOT, "data/testnet-runs"), { recursive: true });
const file = path.join(ROOT, "data/testnet-runs", `early-fee-${out.started.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`saved ${path.relative(ROOT, file)}`);
