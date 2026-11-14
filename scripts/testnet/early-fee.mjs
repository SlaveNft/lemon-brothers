#!/usr/bin/env node
/**
 * The early-withdrawal fee, on chain, with the move that tries to dodge it: the shared public guest deposits 4,990
 * LEMON, waits for the next bank day (the keeper starts it), deposits 2 LEMON more, and takes 1,000 out. The 2 LEMON
 * of today come out first and pay nothing; the other 998 went in yesterday and got a day's interest, so the contract
 * charges that interest back on them and burns it (RULES.md, "The early-withdrawal fee"). A new deposit does not make
 * the older money look new. Uses only the public guest's published function-call key
 * (apps/web/src/chain/publicGuest.json). Gas only.
 *
 *   node scripts/testnet/early-fee.mjs [deposit] [dust] [withdraw]      default 4990 2 1000; waits up to 70 minutes
 *   RESUME=1 node scripts/testnet/early-fee.mjs 0 [dust] [withdraw]     the guest already deposited in the previous
 *       bank day (a run stopped after its first step): skip the deposit and the wait, do the dust and the withdrawal now
 *
 * Writes data/testnet-runs/early-fee-<time>.json with the three transactions and the fee the contract logged.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { PROVIDER, ROOT, TGAS, eventsOf, failureText, sendTx, sleep, view } from "./common.mjs";

const g = JSON.parse(readFileSync(path.join(ROOT, "apps/web/src/chain/publicGuest.json"), "utf8"));
const guest = new Account(g.accountId, PROVIDER, KeyPairSigner.fromSecretKey(g.secretKey));
const [amount, dust, take] = [process.argv[2] ?? "4990", process.argv[3] ?? "2", process.argv[4] ?? "1000"].map((x) => String(Number(x)));
const out = { started: new Date().toISOString(), contract: g.contract, account: g.accountId, amount, dust, take };
const call = (method, args, label) => sendTx(guest, g.contract, [actions.functionCall(method, args, 100n * TGAS, 0n)], label);

const s0 = await view(guest, g.contract, "get_state");
const a0 = await view(guest, g.contract, "get_account", { account_id: g.accountId });
console.log(`bank day ${s0.epoch_id}; guest wallet ${a0?.wallet}, deposit ${a0?.deposit_value}`);
const resume = process.env.RESUME === "1";
if (BigInt(a0?.wallet ?? 0) < (resume ? 0n : BigInt(amount)) + BigInt(dust)) throw new Error(`the guest holds ${a0?.wallet ?? 0} LEMON, less than ${amount} + ${dust}`);
let s = s0;
if (resume) {
  if (BigInt(a0?.deposit_value ?? 0) < BigInt(take)) throw new Error(`RESUME=1 but the guest has only ${a0?.deposit_value ?? 0} LEMON deposited`);
  out.deposit = { resumed: true, deposit_value: a0.deposit_value, epoch_id: s0.epoch_id };
  console.log(`resuming: ${a0.deposit_value} LEMON already deposited before bank day ${s0.epoch_id}`);
} else {
  const dep = await call("deposit", { amount }, "guest deposits");
  out.deposit = { tx: dep.hash, epoch_id: s0.epoch_id };
  console.log(`deposited ${amount} in bank day ${s0.epoch_id}: tx ${dep.hash}`);
  const until = Date.now() + 70 * 60_000;
  while (Number(s.epoch_id) === Number(s0.epoch_id) && Date.now() < until) { await sleep(60_000); s = await view(guest, g.contract, "get_state"); }
  if (Number(s.epoch_id) === Number(s0.epoch_id)) throw new Error("no new bank day within 70 minutes (is the keeper running?)");
}
const d2 = await call("deposit", { amount: dust }, "guest deposits dust");
const a1 = await view(guest, g.contract, "get_account", { account_id: g.accountId });
out.dust = { tx: d2.hash, epoch_id: s.epoch_id, fee_free_now: a1.fee_free_now, early_fee_on: a1.early_fee_on };
console.log(`bank day ${s.epoch_id} (rate added ${s.last_rate_bps} bps): deposited ${dust} more (tx ${d2.hash}); free first ${a1.fee_free_now}, pays the fee ${a1.early_fee_on}`);
try {
  const w = await call("withdraw", { amount: take }, "guest withdraws");
  const fee = eventsOf(w.res).find((e) => e.event === "early_withdrawal_fee")?.data?.[0] ?? null;
  const a2 = await view(guest, g.contract, "get_account", { account_id: g.accountId });
  out.withdraw = { tx: w.hash, epoch_id: s.epoch_id, rate_bps: s.last_rate_bps, fee, wallet_before: a1.wallet, wallet_after: a2.wallet };
  console.log(`withdrew ${take}: ${fee ? `fee ${fee.fee} LEMON on the ${fee.fresh} deposited yesterday` : "NO FEE"}  tx ${w.hash}`);
} catch (e) { out.withdraw = { refused: failureText(e).slice(0, 200), tx: e?.hash ?? null }; console.log(`withdraw refused: ${failureText(e).slice(0, 200)}`); }
mkdirSync(path.join(ROOT, "data/testnet-runs"), { recursive: true });
const file = path.join(ROOT, "data/testnet-runs", `early-fee-${out.started.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`saved ${path.relative(ROOT, file)}`);
