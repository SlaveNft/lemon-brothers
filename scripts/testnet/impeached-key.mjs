#!/usr/bin/env node
/**
 * After an impeachment, the old chair's keeper key tries to open the day's question (the first step of every policy):
 * the contract must refuse it ("only the chair opens the day's question"). Testnet, gas only, no NEAR AI call. Prints the transaction; never prints keys.
 *
 *   LEMON_DEPLOY=deploy-v2.json node scripts/testnet/impeached-key.mjs
 */
import { actions } from "near-api-js";
import { TGAS, account, failureText, readState, sendTx } from "./common.mjs";

const st = readState();
const old = (st.oldChairs ?? []).at(-1);
if (!old) throw new Error("no impeached chair in the deploy state (scripts/testnet/dao.mjs records it)");
const key = account(old, st.policyLabel ?? "policy");
try {
  const r = await sendTx(key, st.contract, [actions.functionCall("open_question", { mood_permille: 0 }, 30n * TGAS, 0n)], "impeached chair opens the question");
  console.log(`ACCEPTED (wrong): tx ${r.hash}`);
  process.exit(1);
} catch (e) {
  console.log(`refused as expected: ${failureText(e).slice(0, 200)}${e?.hash ? `  tx ${e.hash}` : ""}`);
}
