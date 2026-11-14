#!/usr/bin/env node
/**
 * Pin what the chair's signed answers must match: NEAR AI's model signing key, the model id and the sha256 of the
 * PERSONA's system prompt (`set_chair_signer`). Run only with the project owner's go-ahead (one testnet transaction).
 * Run it with tsx (it reads the chair's prompt from the TypeScript sim):
 *
 *   LEMON_DEPLOY=deploy-v2.json PERSONA=populist npx tsx scripts/testnet/pin.mjs
 *
 * The bank's owner must sign: right after `deploy.mjs` that is the contract account itself; once the holders' DAO
 * owns the bank, pinning is a DAO proposal (scripts/testnet/dao.mjs) and this script refuses.
 * The signing key comes from model_attestations[].signing_address in NEAR AI's public attestation report (free; the
 * gateway key is excluded). The report is saved to data/attestation-report.json; `npm run attest` checks it.
 * Never prints secret keys.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { actions } from "near-api-js";
import { chairSystemPrompt } from "@chair/sim";
import { ROOT, TGAS, account, failureText, readState, writeState, sendTx, view } from "./common.mjs";

const st = readState();
if (!st?.contract) throw new Error("no deployment state in .testnet/: deploy first (scripts/testnet/deploy.mjs)");
const bank = account(st.contract);
const persona = process.env.PERSONA || "dove";
const model = process.env.NEAR_AI_MODEL || "Qwen/Qwen3.6-35B-A3B-FP8";

const owner = (await view(bank, st.contract, "get_state")).owner;
if (owner !== st.contract) throw new Error(`the bank's owner is ${owner}: pinning now goes through a DAO proposal (scripts/testnet/dao.mjs)`);
const r = await fetch(`https://cloud-api.near.ai/v1/attestation/report?${new URLSearchParams({ model, signing_algo: "ed25519" })}`, { signal: AbortSignal.timeout(30_000) });
if (!r.ok) throw new Error(`attestation report ${r.status}`);
const report = await r.json();
const key = (report.model_attestations ?? []).find((m) => m.model_name === model && /^[0-9a-f]{64}$/i.test(m.signing_address ?? ""))?.signing_address;
if (!key) throw new Error(`no model signing key for ${model} in the report`);
mkdirSync(path.join(ROOT, "data"), { recursive: true });
writeFileSync(path.join(ROOT, "data/attestation-report.json"), JSON.stringify(report, null, 2));
const prompt = createHash("sha256").update(chairSystemPrompt(persona)).digest("hex");
const signer = key.toLowerCase();

let hash;
try { hash = (await sendTx(bank, st.contract, [actions.functionCall("set_chair_signer", { signer, model, prompt_sha256: prompt }, 30n * TGAS, 0n)], "set_chair_signer")).hash; }
catch (e) { throw new Error(`set_chair_signer failed${e.hash ? ` (tx ${e.hash})` : ""}: ${failureText(e)}`); }
Object.assign(st, { chairSigner: signer, chairModel: model, chairPrompt: prompt, chairPersona: persona, pinTx: hash });
writeState(st);
const s = await view(bank, st.contract, "get_state");
console.log(`pinned ${signer.slice(0, 12)}… + ${persona} prompt ${prompt.slice(0, 12)}…: tx ${hash}`);
console.log(`on chain: chair_signer=${s.chair_signer} prompt=${s.chair_prompt_sha256} model=${s.chair_model}`);
