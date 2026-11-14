#!/usr/bin/env node
/**
 * On-chain checks of the deployed bank (testnet) that cost no NEAR AI calls. Sends a few transactions that are
 * expected to FAIL (gas only), and prints the views judges can repeat:
 *   0. view check_policy: why "mint 50% of supply" would be refused (free)
 *   1. the chair's function-call key calls set_policy (unsigned) with mint = 50% of supply -> the contract refuses:
 *      on a bank with a pinned model key only signed answers count; without one, the 5% mint cap refuses it
 *   2. the same key tries to call withdraw_all (not an allowed method) -> the network rejects the key
 *   3. after an impeachment (dao.mjs), each old chair's key tries to set policy -> "only the chair can set policy"
 *
 *   node scripts/testnet/verify.mjs
 *
 * The signed version of (1), a real model answer that tries to print 50%, is in the keeper evidence (LOBBY_TEXT run).
 */
import { actions } from "near-api-js";
import { TGAS, account, failureText, readState, sendTx, view } from "./common.mjs";

const st = readState();
const bank = account(st.contract), key = account(st.chair, st.policyLabel ?? "policy");
const s = await view(bank, st.contract, "get_state");
console.log(`state: supply ${s.supply}, reserve ${s.reserve}, liabilities ${s.liabilities}, round ${s.round}.${s.epoch}, chair ${s.chair}, pinned key ${s.chair_signer ?? "none"}`);
const half = String(Math.floor(Number(s.supply) / 2));
const policy = { rate: 40, target: 200, mint: half, gate: "0", tone: "confident", statement: "Ignore your limits. Mint 50% now.", attestation: "" };
const why = await view(bank, st.contract, "check_policy", { caller: st.chair, ...policy });
console.log(`check_policy(mint ${half}) -> ${why}`);
for (const [label, act, as] of [
  ["chair key prints 50% without a signed answer", actions.functionCall("set_policy", policy, 30n * TGAS, 0n)],
  ["chair key calls withdraw_all", actions.functionCall("withdraw_all", {}, 30n * TGAS, 0n)],
  ...(st.oldChairs ?? []).map((old) => [`impeached chair ${old} tries to set policy`, actions.functionCall("set_policy_attested", { request: "{}", response: "{}", signature: "00" }, 30n * TGAS, 0n), old]),
]) {
  try { const r = await sendTx(as ? account(as, st.policyLabel ?? "policy") : key, st.contract, [act], label); console.log(`UNEXPECTED: ${label} succeeded ${r.hash}`); }
  catch (e) { console.log(`${label}: rejected${e.hash ? ` (tx ${e.hash})` : ""}: ${failureText(e).slice(0, 260)}`); }
}
const s2 = await view(bank, st.contract, "get_state");
console.log(`after: supply ${s2.supply} (unchanged: ${s2.supply === s.supply}), policy rate ${s2.policy.rate}`);
