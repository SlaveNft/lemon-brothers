#!/usr/bin/env node
/**
 * Create funded top-level testnet accounts through the testnet helper (each starts with the helper's grant, ~10 NEAR)
 * and list them in .testnet/deploy.json as `funders`, so other scripts can pay for storage and DAO deposits.
 * Keys go to .testnet/ (gitignored, mode 0600) and are never printed. Testnet only.
 *
 *   node scripts/testnet/fund.mjs [count=3] [prefix=lemonfund]
 */
import { NEAR, account, helperAccount, readState, sleep, writeState } from "./common.mjs";

const count = Number(process.argv[2] ?? 3), prefix = process.argv[3] ?? "lemonfund";
if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("count must be 1..10");
const st = readState() ?? {};
st.funders ??= [];
for (let i = 0; i < count; i++) {
  try {
    const { accountId } = await helperAccount(prefix);
    st.funders.push(accountId);
    writeState(st);
    await sleep(1500); // the helper and the RPC rate-limit
    const bal = await account(accountId).provider.viewAccount({ accountId }).catch(() => null);
    console.log(`${accountId}: ${bal ? (Number(BigInt(bal.amount) * 1000n / NEAR) / 1000).toFixed(3) : "?"} NEAR`);
  } catch (e) {
    console.log(`account ${i + 1}: ${String(e.message ?? e).slice(0, 200)}`);
    break;
  }
}
console.log(`funders: ${st.funders.length}`);
