#!/usr/bin/env node
/**
 * Deploy the Lemon Brothers bank to NEAR testnet. Run only with the project owner's go-ahead.
 *
 *   npm run build:contract && npm run testnet:deploy
 *   LEMON_DEPLOY=deploy-v2.json node scripts/testnet/deploy.mjs --agents 12 --epoch 3300 --chair lemonchair-76bb5b35.testnet
 *
 * --chair <account>  use an account of ours (full key in .testnet/) as the chair instead of a new helper account
 * --crowd <LEMON>    the crowd omnibus's genesis LEMON (default 120000)
 * --update           the bank exists: deploy the freshly built code over it (same state layout only; possible only
 *                    while the contract account still has its key, i.e. before harden.mjs --lock)
 *
 * Creates (all keys in .testnet/, gitignored):
 *   lemonbank-<id>.testnet           the contract (token + bank); also the owner until a Sputnik DAO takes over
 *   lemonchair-<id>.testnet          the chair; its keeper key is a function-call key that can call ONLY
 *                                    open_question / set_policy / set_policy_attested on the bank, with a 0.25 NEAR gas allowance
 *   agent-01..NN.lemonbank-<id>      depositor agents that sign their own deposits and withdrawals
 *   crowd.lemonbank-<id>             omnibus account for the simulated rest of the town (labelled as such)
 * Then deploys the wasm and calls new(owner, chair, genesis, epoch_seconds).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { KeyPair, actions } from "near-api-js";
import { CHAIR_METHODS, NEAR, ROOT, TGAS, account, helperAccount, readState, saveKey, sendTx, view, writeState } from "./common.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const AGENTS = Number(arg("agents", 12));
const EPOCH = Number(arg("epoch", 30));
const CROWD = String(arg("crowd", 120_000));
const WASM = path.join(ROOT, "contracts/target/wasm32-unknown-unknown/release/lemon_bank.wasm");

const st = readState() ?? {};
const wasm = readFileSync(WASM);
console.log(`wasm ${wasm.length} bytes`);

if (!st.contract) { st.contract = (await helperAccount("lemonbank")).accountId; writeState(st); }
if (!st.chair) { st.chair = arg("chair", null) ?? (await helperAccount("lemonchair")).accountId; writeState(st); }
// the chair's keeper key for this bank (a chair account can hold one for each bank it has served)
st.policyLabel ??= `policy.${st.contract}`;
console.log(`contract ${st.contract}\nchair    ${st.chair}`);
const bank = account(st.contract);
const chair = account(st.chair);

// the code takes about a NEAR per 100 KB of storage: top the new account up from a funder first (--fund NEAR)
const FUND = Number(arg("fund", 0));
if (FUND > 0 && !st.fundTx) {
  const r = await sendTx(account(st.fundFrom ?? st.funders[0]), st.contract, [actions.transfer(BigInt(Math.round(FUND * 1000)) * (NEAR / 1000n))], "fund the bank account");
  st.fundTx = r.hash; writeState(st);
  console.log(`funded ${st.contract} with ${FUND} NEAR: tx ${r.hash}`);
}

// sub-accounts for the agents and the crowd, funded from the contract account
st.agents ??= [];
for (let i = st.agents.length; i < AGENTS + 1; i++) {
  const id = i < AGENTS ? `agent-${String(i + 1).padStart(2, "0")}.${st.contract}` : `crowd.${st.contract}`;
  const kp = KeyPair.fromRandom("ed25519");
  await sendTx(bank, id, [actions.createAccount(), actions.transfer(NEAR / 4n), actions.addFullAccessKey(kp.getPublicKey())], `create ${id}`);
  saveKey(id, kp.toString(), kp.getPublicKey().toString());
  st.agents.push(id);
  writeState(st);
  console.log(`created ${id}`);
}

if (!st.deployed) {
  await sendTx(bank, st.contract, [actions.deployContract(wasm)], "deploy");
  // genesis: each real agent 500..5000 LEMON, the crowd omnibus holds the simulated town's money
  const genesis = st.agents.map((id, i) => [id, String(id.startsWith("crowd.") ? CROWD : 500 + ((i * 7919) % 4501))]);
  await sendTx(bank, st.contract, [actions.functionCall("new", { owner_id: st.contract, chair_id: st.chair, genesis, epoch_seconds: EPOCH }, 100n * TGAS, 0n)], "new");
  st.deployed = true;
  writeState(st);
}

// the chair's keeper key: function-call only, this contract, the chair's methods (CHAIR_METHODS)
if (!st.chairKey) {
  const kp = KeyPair.fromRandom("ed25519");
  await sendTx(chair, st.chair, [actions.addFunctionCallAccessKey(kp.getPublicKey(), st.contract, CHAIR_METHODS, NEAR / 4n)], "add chair function-call key");
  saveKey(st.chair, kp.toString(), kp.getPublicKey().toString(), st.policyLabel);
  st.chairKey = kp.getPublicKey().toString();
  writeState(st);
}

const sha = (await import("node:crypto")).createHash("sha256").update(wasm).digest("hex");
if (process.argv.includes("--update") && st.deployed && st.wasmSha256 !== sha) {
  const r = await sendTx(bank, st.contract, [actions.deployContract(wasm)], "deploy the new code");
  console.log(`code ${st.wasmSha256?.slice(0, 12)}… -> ${sha.slice(0, 12)}…: tx ${r.hash}`);
  st.codeUpdates = [...(st.codeUpdates ?? []), { tx: r.hash, from: st.wasmSha256, to: sha, at: new Date().toISOString() }];
}
const s = await view(bank, st.contract, "get_state");
st.wasmSha256 = sha;
writeState(st);
console.log(`bank live: supply ${s.supply}, chair ${s.chair}, owner ${s.owner}, epoch ${s.epoch_ms / 1000}s`);
console.log(`explorer: https://testnet.nearblocks.io/address/${st.contract}`);
console.log("next: npm run testnet:keeper");
