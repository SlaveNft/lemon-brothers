#!/usr/bin/env node
/**
 * The shared public guest: `guest.<bank>` holds NO full-access key, only one function-call key that can call the
 * bank's player methods, and that key's PRIVATE half is published in the repository
 * (apps/web/src/chain/publicGuest.json) on purpose. Run only with the project owner's go-ahead (testnet NEAR).
 *
 *   node scripts/testnet/public-guest.mjs
 *
 * Why: the page gives every visitor a throwaway account through the testnet faucet, but the faucet allows only a few
 * accounts per address and then answers "retry in 2 hours". When that happens the page falls back to this account,
 * so "no wallet, no seed phrase" still works. What the published key can do: call airdrop, deposit, withdraw,
 * withdraw_all, lobby, rumor, insure, advance_epoch and submit_run on the bank, paying gas out of this account's
 * balance up to the key's allowance. What it cannot do: transfer NEAR, add or delete keys, deploy code, call any other
 * contract, or attach a deposit. The worst a stranger can do with it is spend the account's test LEMON and its gas.
 *
 *   1. the bank account creates guest.<bank> with 0.2 NEAR and the function-call key (no full-access key is added)
 *   2. a funder sends it NEAR for gas; the key's allowance caps what can ever be spent
 *   3. the guest claims the airdrop with its own key (which proves the key works); the crowd account sends it more LEMON
 *   4. the published key tries to move NEAR: the network must refuse
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { NEAR, ROOT, TGAS, account, failureText, readState, retry, sendTx, sleep, view, writeState } from "./common.mjs";

const st = readState();
if (!st?.contract) throw new Error("no .testnet/deploy.json");
const METHODS = ["airdrop", "deposit", "withdraw", "withdraw_all", "lobby", "rumor", "insure", "advance_epoch", "submit_run"];
const ALLOWANCE = 4n * NEAR, FUND = 4n * NEAR, LEMON_TOPUP = 4000n;
const id = `guest.${st.contract}`, file = path.join(ROOT, "apps/web/src/chain/publicGuest.json");
const bank = account(st.contract), funder = account(st.funders[3] ?? st.funders[0]), crowd = account(st.agents[st.agents.length - 1]);
const fc = (method, args, tgas = 30n, deposit = 0n) => actions.functionCall(method, args, tgas * TGAS, deposit);
const exists = async (a) => { try { await retry(() => bank.provider.viewAccount({ accountId: a }), "view account", 2); return true; } catch { return false; } };

let secretKey = st.publicGuest?.secretKey;
if (!(await exists(id))) {
  const kp = KeyPair.fromRandom("ed25519");
  secretKey = kp.toString();
  const r = await sendTx(bank, id, [actions.createAccount(), actions.transfer(NEAR / 5n), actions.addFunctionCallAccessKey(kp.getPublicKey(), st.contract, METHODS, ALLOWANCE)], `create ${id}`);
  // this key is public by design, so it may live in deploy.json and in the repository
  st.publicGuest = { accountId: id, secretKey, createTx: r.hash }; writeState(st);
  console.log(`created ${id} with a function-call key only: tx ${r.hash}`);
  await sleep(1500);
}
if (!secretKey) throw new Error(`${id} exists but its key is not in .testnet/deploy.json`);
const guest = new Account(id, bank.provider, KeyPairSigner.fromSecretKey(secretKey));

const bal = BigInt((await retry(() => bank.provider.viewAccount({ accountId: id }), "view account")).amount);
if (bal < FUND / 2n) {
  const r = await sendTx(funder, id, [actions.transfer(FUND)], "fund the guest's gas");
  st.publicGuest.fundTx = r.hash; writeState(st);
  console.log(`${funder.accountId} sent ${FUND / NEAR} NEAR for gas: tx ${r.hash}`);
}
let a = await view(bank, st.contract, "get_account", { account_id: id });
if (!a?.airdropped) {
  const r = await sendTx(guest, st.contract, [fc("airdrop", {})], "airdrop with the public key");
  st.publicGuest.airdropTx = r.hash; writeState(st);
  console.log(`the guest claimed its airdrop with the published key: tx ${r.hash}`);
  await sleep(1500);
}
a = await view(bank, st.contract, "get_account", { account_id: id });
if (BigInt(a.wallet) + BigInt(a.deposit_value) < LEMON_TOPUP) {
  const r = await sendTx(crowd, st.contract, [fc("ft_transfer", { receiver_id: id, amount: String(LEMON_TOPUP), memo: "float for the shared public guest" }, 30n, 1n)], "LEMON for the guest");
  st.publicGuest.lemonTx = r.hash; writeState(st);
  console.log(`the crowd sent ${LEMON_TOPUP} LEMON: tx ${r.hash}`);
}
// the published key must NOT be able to do anything else: try a transfer of NEAR with it (expected: refused)
try { await sendTx(guest, funder.accountId, [actions.transfer(1n)], "the public key tries to move NEAR"); console.log("UNEXPECTED: the public key moved NEAR"); process.exitCode = 1; }
catch (e) { console.log(`the public key tries to move NEAR: refused (${failureText(e).slice(0, 140)})`); }

const keys = (await retry(() => bank.provider.viewAccessKeyList({ accountId: id }), "key list")).keys ?? [];
const kinds = keys.map((k) => (k.access_key.permission === "FullAccess" ? "FullAccess" : `FunctionCall(${k.access_key.permission.FunctionCall.method_names.length} methods on ${k.access_key.permission.FunctionCall.receiver_id})`));
console.log(`keys on ${id}: ${kinds.join("; ")}`);
if (kinds.some((k) => k === "FullAccess")) throw new Error("the guest has a full-access key: do not publish");
writeFileSync(file, JSON.stringify({
  note: "PUBLIC ON PURPOSE. A NEAR testnet function-call access key: it can only call the listed methods on the bank contract, cannot move NEAR, add keys or deploy code, and the account has no full-access key. The page uses it when the testnet faucet refuses to create a personal guest account. Test tokens only; see scripts/testnet/public-guest.mjs.",
  contract: st.contract, accountId: id, secretKey, methods: METHODS, allowanceNear: Number(ALLOWANCE / NEAR),
}, null, 2) + "\n");
a = await view(bank, st.contract, "get_account", { account_id: id });
console.log(`wrote ${path.relative(ROOT, file)}; the guest holds ${a.wallet} LEMON`);
process.exit(process.exitCode ?? 0); // the failover provider keeps timers alive
