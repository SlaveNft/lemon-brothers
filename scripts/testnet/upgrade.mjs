#!/usr/bin/env node
/**
 * Upgrade the deployed bank in place and (re)pin what the chair's signed answers must match. Run only with the
 * project owner's go-ahead. Run it with tsx (it reads the chair's prompt from the TypeScript sim):
 *
 *   npm run build:contract
 *   PERSONA=dove npx tsx scripts/testnet/upgrade.mjs --migrate --pin   # deploy + migrate + pin, in ONE transaction
 *   npx tsx scripts/testnet/upgrade.mjs                                 # deploy new code (same state layout)
 *   PERSONA=populist npx tsx scripts/testnet/upgrade.mjs --pin          # only re-pin (e.g. another chair persona)
 *   npx tsx scripts/testnet/upgrade.mjs --seal 150000                   # deploy + set the bank's ceiling, in ONE transaction
 *   npx tsx scripts/testnet/upgrade.mjs --seal 150000 --epoch-seconds 3300   # ... and make a bank day 55 minutes
 *
 * --migrate  call `migrate` (needed once, from the layout without `chair_prompt`, wasm 1b0f25c3…). The script reads
 *            the chain first and refuses a deploy onto the old layout without it, and --migrate on the new layout.
 * --seal N   seal_max_supply(N): the most LEMON this bank may ever have. Only for a bank deployed before the rule
 *            (its state has no ceiling); it can be set once, never below the supply in existence, and never changed.
 * --epoch-seconds N   set_epoch_seconds(N): the length of a bank day (the deployed bank was created with 30 s while its
 *            keeper moves it once an hour). Only the contract account can call it; the script then checks on chain
 *            that another account cannot.
 * --pin      set_chair_signer(NEAR AI's model signing key, model, sha256 of the PERSONA's system prompt). The bank's
 *            owner must sign it: today that is the contract account itself (no Sputnik DAO yet, see docs/TESTNET.md).
 *
 * All actions go into one batch transaction, so a failed migrate or pin rolls the code deploy back too.
 * Whether code is deployed is decided from the account's on-chain code hash, not from local notes.
 * The signing key comes from model_attestations[].signing_address in NEAR AI's public attestation report (free; the
 * gateway key is excluded). The report's hardware quotes are saved, not verified here: pinning trusts the report.
 * Never prints secret keys.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { actions, baseEncode } from "near-api-js";
import { chairSystemPrompt } from "@chair/sim";
import { ROOT, TGAS, account, failureText, readState, writeState, sendTx, view } from "./common.mjs";

const st = readState();
if (!st?.contract) throw new Error("no .testnet/deploy.json: deploy first");
const bank = account(st.contract);
const wasmPath = path.join(ROOT, "contracts/target/wasm32-unknown-unknown/release/lemon_bank.wasm");
const wasm = readFileSync(wasmPath);
const sha = createHash("sha256").update(wasm).digest("hex");
const migrate = process.argv.includes("--migrate"), pin = process.argv.includes("--pin");
const sealAt = process.argv.indexOf("--seal"), seal = sealAt > 0 ? process.argv[sealAt + 1] : null;
if (seal !== null && !/^[1-9]\d{0,30}$/.test(seal ?? "")) throw new Error("--seal needs a whole number of LEMON, e.g. --seal 150000");
const epAt = process.argv.indexOf("--epoch-seconds"), epochSeconds = epAt > 0 ? Number(process.argv[epAt + 1]) : null;
if (epochSeconds !== null && !(Number.isInteger(epochSeconds) && epochSeconds >= 5 && epochSeconds <= 86400)) throw new Error("--epoch-seconds needs 5..86400");
const persona = process.env.PERSONA || "dove";
const model = process.env.NEAR_AI_MODEL || "Qwen/Qwen3.6-35B-A3B-FP8";

// what is on chain now: the code hash, and whether the state already has the chair_prompt field
const onChain = await bank.provider.viewAccount({ accountId: st.contract });
const deployed = String(onChain.code_hash ?? onChain.codeHash) === baseEncode(Buffer.from(sha, "hex"));
let layout = "unknown";
try { layout = "chair_prompt_sha256" in (await view(bank, st.contract, "get_state")) ? "new" : "old"; }
catch { layout = "unreadable"; } // new code over old state: only migrate can fix it
console.log(`on chain: code ${deployed ? "matches" : "differs from"} ${sha.slice(0, 12)}…, state layout ${layout}`);
if (layout === "new" && migrate) throw new Error("state already has chair_prompt: drop --migrate");
if (layout !== "new" && !migrate) throw new Error(`state layout is ${layout}: this code needs --migrate (in the same transaction as the deploy)`);

const acts = [], why = [];
if (!deployed) { acts.push(actions.deployContract(wasm)); why.push(`deploy ${sha.slice(0, 12)}…`); }
if (migrate) { acts.push(actions.functionCall("migrate", {}, 50n * TGAS, 0n)); why.push("migrate"); }

if (seal !== null) {
  const now = await view(bank, st.contract, "get_state").catch(() => null);
  if (now?.max_supply) throw new Error(`the ceiling is already set (${now.max_supply} LEMON) and cannot be changed`);
  if (now && BigInt(seal) < BigInt(now.supply)) throw new Error(`the ceiling ${seal} is below the supply in existence (${now.supply})`);
  acts.push(actions.functionCall("seal_max_supply", { max_supply: seal }, 30n * TGAS, 0n));
  why.push(`seal the ceiling at ${seal} LEMON`);
}

if (epochSeconds !== null) {
  acts.push(actions.functionCall("set_epoch_seconds", { epoch_seconds: epochSeconds }, 30n * TGAS, 0n));
  why.push(`bank day ${epochSeconds} s`);
}

let pinned;
if (pin) {
  const owner = (await view(bank, st.contract, "get_state").catch(() => ({}))).owner;
  if (owner && owner !== st.contract) throw new Error(`the bank's owner is ${owner}: pinning now goes through a DAO proposal (scripts/testnet/dao.mjs)`);
  const r = await fetch(`https://cloud-api.near.ai/v1/attestation/report?${new URLSearchParams({ model, signing_algo: "ed25519" })}`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`attestation report ${r.status}`);
  const report = await r.json();
  const key = (report.model_attestations ?? []).find((m) => m.model_name === model && /^[0-9a-f]{64}$/i.test(m.signing_address ?? ""))?.signing_address;
  if (!key) throw new Error(`no model signing key for ${model} in the report`);
  mkdirSync(path.join(ROOT, "data"), { recursive: true });
  writeFileSync(path.join(ROOT, "data/attestation-report.json"), JSON.stringify(report, null, 2));
  const prompt = createHash("sha256").update(chairSystemPrompt(persona)).digest("hex");
  pinned = { signer: key.toLowerCase(), model, prompt_sha256: prompt, persona };
  acts.push(actions.functionCall("set_chair_signer", { signer: pinned.signer, model, prompt_sha256: prompt }, 30n * TGAS, 0n));
  why.push(`pin ${key.slice(0, 12)}… + ${persona} prompt ${prompt.slice(0, 12)}…`);
}

if (acts.length) {
  let hash;
  try { hash = (await sendTx(bank, st.contract, acts, why.join(" + "))).hash; }
  catch (e) { throw new Error(`${why.join(" + ")} failed${e.hash ? ` (tx ${e.hash})` : ""}: ${failureText(e)}`); }
  const at = new Date().toISOString();
  if (!deployed) {
    st.upgrades = [...(st.upgrades ?? []), { at, tx: hash, from: st.wasmSha256 ?? null, to: sha, why: why.join(" + ") }];
    st.wasmSha256 = sha;
  }
  if (seal !== null) { st.maxSupply = seal; st.sealTx = hash; }
  if (pinned) { st.chairSigner = pinned.signer; st.chairModel = pinned.model; st.chairPrompt = pinned.prompt_sha256; st.chairPersona = pinned.persona; st.pinTx = hash; }
  writeState(st);
  console.log(`${why.join(" + ")}: tx ${hash}`);
}
let s;
try { s = await view(bank, st.contract, "get_state"); }
catch (e) { throw new Error(`get_state failed after the upgrade: ${failureText(e)}`); }
console.log(`max_supply=${s.max_supply ?? "not set"} supply=${s.supply} epoch_ms=${s.epoch_ms} max_accounts=${s.max_accounts ?? "-"}`);
if (epochSeconds !== null) {
  // set_epoch_seconds is #[private]: any other account must be refused by the contract itself
  const other = account(st.agents[0]);
  try { const r = await sendTx(other, st.contract, [actions.functionCall("set_epoch_seconds", { epoch_seconds: 5 }, 30n * TGAS, 0n)], "set_epoch_seconds by an agent"); throw new Error(`UNEXPECTED: an agent changed the bank day (tx ${r.hash})`); }
  catch (e) { if (String(e.message).startsWith("UNEXPECTED")) throw e; console.log(`set_epoch_seconds by ${other.accountId}: refused${e.hash ? ` (tx ${e.hash})` : ""}: ${failureText(e).slice(0, 160)}`); }
}
console.log(`chair_signer=${s.chair_signer ?? "none"} prompt=${s.chair_prompt_sha256 ?? "none"} model=${s.chair_model} epoch_id=${s.epoch_id} collapsed=${s.collapsed}`);
