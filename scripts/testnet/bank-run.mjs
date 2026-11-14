#!/usr/bin/env node
/**
 * A bank run on the real bank, on NEAR testnet: the crowd's omnibus account and then the agents take everything out
 * in one bank day, until a withdrawal the vault and the loan book cannot cover breaks the bank. Each withdrawal past
 * the vault sells loans at a 40% loss and those coins burn; the one that breaks it sells every loan and closes the
 * bank until the next bank day's rescue (the keeper's advance_epoch prints 20% of what the bank owed).
 * Testnet only, gas only, no NEAR AI call. Run only with the project owner's go-ahead.
 *
 *   LEMON_DEPLOY=deploy-v2.json node scripts/testnet/bank-run.mjs
 *
 * Writes data/testnet-runs/bank-run-<time>.json with every transaction and the events the contract emitted.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { actions } from "near-api-js";
import { ROOT, TGAS, account, eventsOf, failureText, readState, sendTx, view } from "./common.mjs";

const st = readState();
const bank = account(st.contract);
const order = [st.agents.at(-1), ...st.agents.slice(0, -1)]; // the crowd's omnibus first: it holds most of the money
const out = { started: new Date().toISOString(), contract: st.contract, steps: [] };
const s0 = await view(bank, st.contract, "get_state");
console.log(`bank day ${s0.epoch_id}: vault ${s0.reserve}, loans ${s0.loans}, owed ${s0.liabilities}, supply ${s0.supply}${s0.collapsed ? " (CLOSED)" : ""}`);
if (s0.collapsed) throw new Error("the bank is already closed until the rescue");
out.before = { reserve: s0.reserve, loans: s0.loans, liabilities: s0.liabilities, supply: s0.supply, epoch_id: s0.epoch_id };

for (const id of order) {
  const a = await view(bank, st.contract, "get_account", { account_id: id });
  if (!a || BigInt(a.deposit_value ?? 0) === 0n) continue;
  try {
    const r = await sendTx(account(id), st.contract, [actions.functionCall("withdraw_all", {}, 100n * TGAS, 0n)], `${id} runs`);
    const evs = eventsOf(r.res);
    const w = evs.find((e) => e.event === "withdraw")?.data?.[0] ?? {};
    const fell = evs.some((e) => e.event === "collapse");
    out.steps.push({ who: id, tx: r.hash, events: evs.map((e) => e.event), withdraw: w, collapse: evs.find((e) => e.event === "collapse")?.data?.[0] ?? null });
    console.log(`${id}: took ${w.amount ?? "?"} (loans sold ${w.fire_sold ?? 0}, burned ${w.burned ?? 0})${fell ? "  THE BANK FELL" : ""}  tx ${r.hash}`);
    if (fell) break;
  } catch (e) {
    out.steps.push({ who: id, tx: e?.hash ?? null, refused: failureText(e).slice(0, 200) });
    console.log(`${id}: refused: ${failureText(e).slice(0, 160)}`);
    if (/closed/.test(failureText(e))) break;
  }
}
const s1 = await view(bank, st.contract, "get_state");
out.after = { reserve: s1.reserve, loans: s1.loans, liabilities: s1.liabilities, supply: s1.supply, collapsed: s1.collapsed };
console.log(`after: vault ${s1.reserve}, loans ${s1.loans}, owed ${s1.liabilities}, supply ${s1.supply} (${Number(s0.supply) - Number(s1.supply)} burned)${s1.collapsed ? ", CLOSED until the rescue" : ""}`);
const dir = path.join(ROOT, "data/testnet-runs");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `bank-run-${out.started.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`saved ${path.relative(ROOT, file)}`);
