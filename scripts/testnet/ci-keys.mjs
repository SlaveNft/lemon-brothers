#!/usr/bin/env node
/**
 * The keeper's keys for a CI runner, as one secret. Testnet only; never prints a key.
 *
 *   LEMON_DEPLOY=deploy-v2.json node scripts/testnet/ci-keys.mjs --export
 *       writes .testnet/ci-secret.txt (gitignored): base64 of the deployment file and of the keys the keeper signs
 *       with: the crowd and the agent sub-accounts (they hold only test NEAR and test LEMON) and the chair's
 *       function-call key (it can only call open_question / set_policy / set_policy_attested on the bank). No funder, DAO or bank key.
 *       Then: gh secret set LEMON_TESTNET_KEYS < .testnet/ci-secret.txt
 *   node scripts/testnet/ci-keys.mjs --import
 *       on the runner: reads LEMON_TESTNET_KEYS and writes the files back into .testnet/
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STATE_DIR, STATE_FILE, readState } from "./common.mjs";

if (process.argv.includes("--export")) {
  const st = readState();
  if (!st?.deployed) throw new Error("no deployment");
  const files = { [STATE_FILE]: JSON.stringify({ ...st, publicGuest: undefined }) };
  const label = st.policyLabel ?? "policy";
  for (const id of st.agents) files[`${id}.full.json`] = readFileSync(path.join(STATE_DIR, `${id}.full.json`), "utf8");
  files[`${st.chair}.${label}.json`] = readFileSync(path.join(STATE_DIR, `${st.chair}.${label}.json`), "utf8");
  const out = path.join(STATE_DIR, "ci-secret.txt");
  writeFileSync(out, Buffer.from(JSON.stringify(files)).toString("base64"));
  chmodSync(out, 0o600);
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${Object.keys(files).length} files (deployment, ${st.agents.length} town accounts, the chair's function-call key)`);
} else if (process.argv.includes("--import")) {
  const raw = process.env.LEMON_TESTNET_KEYS;
  if (!raw) throw new Error("LEMON_TESTNET_KEYS is not set");
  const files = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  mkdirSync(STATE_DIR, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    if (!/^[a-z0-9._-]+\.json$/.test(name)) throw new Error(`unexpected file name ${name}`);
    writeFileSync(path.join(STATE_DIR, name), text);
    chmodSync(path.join(STATE_DIR, name), 0o600);
  }
  console.log(`restored ${Object.keys(files).length} files into .testnet/`);
} else {
  console.log("use --export (on the deployer's machine) or --import (on the runner)");
}
