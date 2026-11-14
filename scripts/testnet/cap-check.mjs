#!/usr/bin/env node
/**
 * The mint cap, refused on chain with the contract's own words. Works only while the contract account owns the bank
 * (before dao.mjs handed it to the DAO); it was run then, see docs/TESTNET.md. No NEAR AI call; gas only. Run only with the project
 * owner's go-ahead.
 *
 *   node scripts/testnet/cap-check.mjs
 *
 * A signed model answer can only reach the cap if the model agrees to print; in the evidence run even the populist
 * chair declined a "print 50%" speech. So this shows the cap on the unsigned path, which the attested path shares
 * (`bank-core::check_policy` runs after the signature checks):
 *   1. if the epoch has elapsed, advance it (anyone may), so no policy is set yet this epoch
 *   2. the owner unpins the chair (set_chair_signer(None)): the bank briefly accepts unsigned policies
 *   3. the chair's function-call key asks for mint = 50% of supply -> refused by the 5% cap
 *   4. the owner pins the same key, model and prompt hash again (always, even if a step failed)
 */
import { actions } from "near-api-js";
import { TGAS, account, failureText, readState, sendTx, view } from "./common.mjs";

const st = readState();
if (!st?.chairSigner || !st?.chairPrompt) throw new Error("deploy.json has no pinned signer/prompt to restore; run upgrade.mjs --pin first");
if (st.owner && st.owner !== st.contract) throw new Error(`the bank's owner is ${st.owner}: unpinning now takes a DAO proposal, so this check cannot run from here`);
const bank = account(st.contract), crowd = account(st.agents[st.agents.length - 1]), key = account(st.chair, "policy");
const fc = (method, args) => [actions.functionCall(method, args, 30n * TGAS, 0n)];
const out = {};

let s = await view(bank, st.contract, "get_state");
if (s.policy_set_epoch_id === s.epoch_id || s.collapsed) {
  if (Date.now() < s.next_epoch_ms + 1500) throw new Error(`policy already set (or bank closed) in epoch ${s.epoch_id}; wait ${Math.ceil((s.next_epoch_ms - Date.now()) / 1000)}s`);
  out.advance = (await sendTx(crowd, st.contract, fc("advance_epoch", {}), "advance_epoch")).hash;
  s = await view(bank, st.contract, "get_state");
}
const half = String(Math.floor(Number(s.supply) / 2));
console.log(`epoch ${s.epoch_id} (round ${s.round}.${s.epoch}), supply ${s.supply}, policy ${s.policy.rate}/${s.policy.target}; asking to mint ${half}`);
try {
  out.unpin = (await sendTx(bank, st.contract, fc("set_chair_signer", { signer: null, model: st.chairModel, prompt_sha256: null }), "unpin")).hash;
  try {
    const r = await sendTx(key, st.contract, fc("set_policy", { rate: Number(s.policy.rate), target: Number(s.policy.target), mint: half, gate: "0", tone: "confident", statement: "The loudest holder asked for 50%. Printing it.", attestation: "" }), "mint 50%");
    out.unexpected = r.hash;
  } catch (e) { out.refused = { tx: e.hash ?? null, why: failureText(e) }; }
} finally {
  out.repin = (await sendTx(bank, st.contract, fc("set_chair_signer", { signer: st.chairSigner, model: st.chairModel, prompt_sha256: st.chairPrompt }), "re-pin")).hash;
}
const after = await view(bank, st.contract, "get_state");
console.log(JSON.stringify(out, null, 2));
console.log(`after: supply ${after.supply} (asked to mint ${half}), pinned ${after.chair_signer?.slice(0, 12)}… prompt ${after.chair_prompt_sha256?.slice(0, 12)}…`);
if (out.unexpected) process.exit(1);
