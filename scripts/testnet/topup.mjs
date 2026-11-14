#!/usr/bin/env node
/**
 * Top up the testnet NEAR (gas money) of the accounts the keeper signs with, from the project's funder accounts
 * (`funders` in .testnet/deploy.json, made by fund.mjs). The crowd account sends `advance_epoch` and the crowd's
 * deposits and withdrawals every bank day (about 0.003 NEAR a day), so a long schedule drains it first.
 * Run only with the project owner's go-ahead. Testnet only; never prints keys.
 *
 *   node scripts/testnet/topup.mjs                 show the balances, send nothing
 *   node scripts/testnet/topup.mjs --send          bring the crowd to 8 NEAR and every agent to 0.6 NEAR
 *   node scripts/testnet/topup.mjs --send --crowd 12 --agent 1
 *   node scripts/testnet/topup.mjs --send --bank 3   also keep 3 NEAR free for storage on the bank's own account
 *                                                   (new accounts, side records and a larger code are paid from it)
 */
import { actions } from "near-api-js";
import { NEAR, account, readState, sendTx, sleep } from "./common.mjs";

const st = readState();
if (!st?.deployed) throw new Error("deploy first: npm run testnet:deploy");
const args = process.argv.slice(2), send = args.includes("--send");
const num = (flag, def) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : def);
const want = { crowd: num("--crowd", 8), agent: num("--agent", 0.6) };
const yocto = (near) => BigInt(Math.round(near * 1000)) * (NEAR / 1000n);
const fmt = (y) => (Number((y * 1000n) / NEAR) / 1000).toFixed(3);
const balance = async (id) => BigInt((await account(id).provider.viewAccount({ accountId: id })).amount);

const funders = [];
for (const id of st.funders ?? []) { try { funders.push({ id, left: await balance(id) }); } catch { /* a funder that is gone */ } await sleep(300); }
console.log(`funders: ${funders.map((f) => `${f.id} ${fmt(f.left)}`).join(", ") || "none"}`);
let sent = 0n;
for (const id of st.agents) {
  const target = yocto(id.startsWith("crowd.") ? want.crowd : want.agent), has = await balance(id);
  await sleep(300);
  if (has >= target) { console.log(`${id}: ${fmt(has)} NEAR, enough`); continue; }
  const need = target - has;
  if (!send) { console.log(`${id}: ${fmt(has)} NEAR, needs ${fmt(need)} more`); continue; }
  // keep one NEAR in each funder for its own storage and gas
  const from = funders.find((f) => f.left - yocto(1) >= need);
  if (!from) { console.log(`${id}: needs ${fmt(need)} NEAR, no funder has that much left`); continue; }
  const { hash } = await sendTx(account(from.id), id, [actions.transfer(need)], `top up ${id}`);
  from.left -= need; sent += need;
  console.log(`${id}: ${fmt(has)} -> ${fmt(target)} NEAR from ${from.id}  tx ${hash}`);
}
if (args.includes("--bank")) {
  const id = st.contract, want = yocto(num("--bank", 3));
  const a = await account(id).provider.viewAccount({ accountId: id });
  const free = BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n;
  if (free >= want) console.log(`${id}: ${fmt(free)} NEAR free for storage, enough`);
  else if (!send) console.log(`${id}: ${fmt(free)} NEAR free for storage, needs ${fmt(want - free)} more`);
  else {
    const need = want - free, from = funders.find((f) => f.left - yocto(1) >= need);
    if (!from) console.log(`${id}: needs ${fmt(need)} NEAR, no funder has that much left`);
    else {
      const { hash } = await sendTx(account(from.id), id, [actions.transfer(need)], `top up ${id}`);
      from.left -= need; sent += need;
      console.log(`${id}: ${fmt(free)} -> ${fmt(want)} NEAR free for storage, from ${from.id}  tx ${hash}`);
    }
  }
}
console.log(send ? `sent ${fmt(sent)} testnet NEAR` : "nothing was sent. To top up: node scripts/testnet/topup.mjs --send");
