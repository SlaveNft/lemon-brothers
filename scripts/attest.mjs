#!/usr/bin/env node
/**
 * Check, without trusting NEAR AI's word or this repository's, that the key the bank pins belongs to a TEE.
 *
 *   node scripts/attest.mjs            fresh report from NEAR AI Cloud with our own nonce + the bank's state from testnet
 *   node scripts/attest.mjs --file     the report saved in data/attestation-report.json (offline; freshness not checked)
 *
 * The contract verifies ed25519 signatures against a pinned public key (`chair_signer`). This script closes the gap
 * between "a key" and "a key inside an enclave": for every model report it
 *
 *   1. parses the Intel TDX quote (v4) and verifies its signature chain with node:crypto only:
 *      quote signed by the attestation key; attestation key bound into the Quoting Enclave report; that report
 *      signed by the PCK certificate; PCK chain up to a self-signed "Intel SGX Root CA" (compared with the root
 *      certificate Intel publishes, when the network is available);
 *   2. reads report data from that verified quote: first 32 bytes = the ed25519 signing key, last 32 = our nonce;
 *   3. checks that the TD is not in debug mode, that MRCONFIGID commits to the published `app_compose`, and replays the
 *      RTMR3 event log to the value in the quote (rules: docs.near.ai/cloud/verification/reference/quote-nonce-signer);
 *   4. compares the signing key and model with what the bank on testnet has pinned.
 *
 * Not checked, and said so in the output: Intel's TCB level and revocation lists (needs Intel's collateral service and
 * a policy), the NVIDIA GPU evidence (needs NVIDIA's NRAS), and whether the measured images are the ones NEAR AI
 * publishes (image provenance). No dependencies, no keys, read-only.
 */
import { createHash, createPublicKey, verify, X509Certificate, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.NEAR_AI_MODEL || "Qwen/Qwen3.6-35B-A3B-FP8";
const CONTRACT = process.env.CONTRACT || "lemonbank-96b0974e.testnet";
const RPCS = ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
const INTEL_ROOT = "https://certificates.trustedservices.intel.com/Intel_SGX_Provisioning_Certification_RootCA.cer";
const offline = process.argv.includes("--file");

const sha = (alg, ...parts) => { const h = createHash(alg); for (const p of parts) h.update(p); return h.digest(); };
const hex = (b) => Buffer.from(b).toString("hex");
const p256 = (raw) => createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(0, 32).toString("base64url"), y: raw.subarray(32, 64).toString("base64url") }, format: "jwk" });
const ecdsaOk = (key, data, sig) => verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, sig);

let failed = 0, skipped = 0;
const ok = (cond, what, detail = "") => { if (!cond) failed++; console.log(`   ${cond ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`); return cond; };
const skip = (what, why) => { skipped++; console.log(`   skip ${what}: ${why}`); };

/** Intel TDX quote v4: 48-byte header, 584-byte TD report body, then the signature data. */
function parseQuote(quoteHex) {
  const q = Buffer.from(quoteHex, "hex");
  const version = q.readUInt16LE(0), teeType = q.readUInt32LE(4);
  if (version !== 4 || teeType !== 0x81) throw new Error(`not a TDX v4 quote (version ${version}, tee type 0x${teeType.toString(16)})`);
  const body = q.subarray(48, 632), at = (off, len) => body.subarray(off, off + len);
  let o = 632;
  const sigLen = q.readUInt32LE(o); o += 4;
  const sigData = q.subarray(o, o + sigLen);
  const quoteSig = sigData.subarray(0, 64), attKey = sigData.subarray(64, 128);
  let p = 128;
  const outerType = sigData.readUInt16LE(p), outerSize = sigData.readUInt32LE(p + 2); p += 6;
  if (outerType !== 6) throw new Error(`unexpected certification data type ${outerType}`);
  const outer = sigData.subarray(p, p + outerSize);
  const qeReport = outer.subarray(0, 384), qeSig = outer.subarray(384, 448);
  const authLen = outer.readUInt16LE(448), qeAuth = outer.subarray(450, 450 + authLen);
  let c = 450 + authLen;
  const certType = outer.readUInt16LE(c), certSize = outer.readUInt32LE(c + 2); c += 6;
  if (certType !== 5) throw new Error(`unexpected PCK certification data type ${certType}`);
  const pem = outer.subarray(c, c + certSize).toString("latin1");
  const certs = [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map((m) => new X509Certificate(m[0]));
  return {
    signed: q.subarray(0, 632), quoteSig, attKey, qeReport, qeSig, qeAuth, certs,
    tdAttributes: at(120, 8), mrtd: at(136, 48), mrConfigId: at(184, 48), rtmr: [0, 1, 2, 3].map((i) => at(328 + 48 * i, 48)), reportData: at(520, 64),
  };
}

function replayRtmr3(eventLog) {
  let rtmr = Buffer.alloc(48);
  for (const e of typeof eventLog === "string" ? JSON.parse(eventLog) : eventLog) {
    if (e.imr !== 3) continue;
    const type = Buffer.alloc(4); type.writeUInt32LE(e.event_type >>> 0);
    const digest = sha("sha384", type, ":", Buffer.from(e.event, "utf8"), ":", Buffer.from(e.event_payload || "", "hex"));
    if (e.digest && e.digest.toLowerCase() !== hex(digest)) throw new Error(`event ${e.event}: digest does not match its payload`);
    rtmr = sha("sha384", rtmr, digest);
  }
  return rtmr;
}

async function intelRoot() {
  try {
    const r = await fetch(INTEL_ROOT, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const der = Buffer.from(await r.arrayBuffer());
    return new X509Certificate(der.subarray(0, 5).toString().startsWith("-----") ? der.toString() : der);
  } catch (e) { return String(e.message ?? e); }
}

function checkReport(name, rep, nonce, root) {
  console.log(`\n${name}: signing key ${rep.signing_address} (${rep.signing_algo})`);
  let q;
  try { q = parseQuote(rep.intel_quote); } catch (e) { ok(false, "parse the TDX quote", String(e.message)); return null; }

  // 1. the quote's signature chain
  ok(ecdsaOk(p256(q.attKey), q.signed, q.quoteSig), "quote header + TD report signed by the attestation key");
  ok(sha("sha256", q.attKey, q.qeAuth).equals(q.qeReport.subarray(320, 352)), "attestation key is bound into the Quoting Enclave report");
  const [pck, inter, top] = q.certs;
  ok(q.certs.length >= 3 && ecdsaOk(pck.publicKey, q.qeReport, q.qeSig), "Quoting Enclave report signed by the PCK certificate", pck?.subject.replace(/\n/g, ", "));
  ok(!!top && pck.verify(inter.publicKey) && inter.verify(top.publicKey) && top.verify(top.publicKey), "PCK certificate chain verifies up to a self-signed root", top?.subject.replace(/\n/g, ", "));
  const now = Date.now();
  ok(q.certs.every((c) => Date.parse(c.validFrom) <= now && now <= Date.parse(c.validTo)), "every certificate in the chain is inside its validity period");
  if (root instanceof X509Certificate) ok(top?.fingerprint256 === root.fingerprint256, "the root is the Intel SGX Root CA that Intel publishes", root.fingerprint256.replace(/:/g, "").toLowerCase().slice(0, 16) + "…");
  else skip("compare the root with Intel's published root certificate", `could not fetch it (${root})`);

  // 2. what the verified quote binds
  const id = Buffer.from(rep.signing_address.replace(/^0x/, ""), "hex");
  ok(rep.signing_algo === "ed25519" && id.length === 32 && q.reportData.subarray(0, 32).equals(id), "report data binds the ed25519 signing key");
  if (nonce) ok(hex(q.reportData.subarray(32)) === nonce && rep.request_nonce === nonce, "report data carries OUR nonce: the quote was made for this request", nonce.slice(0, 16) + "…");
  else ok(hex(q.reportData.subarray(32)) === rep.request_nonce, "report data carries the report's nonce (saved report: freshness not checked)");

  // 3. the environment
  ok((q.tdAttributes[0] & 1) === 0, "the TD is not in debug mode");
  const tcb = typeof rep.info?.tcb_info === "string" ? JSON.parse(rep.info.tcb_info) : rep.info?.tcb_info;
  if (tcb?.app_compose) {
    const want = Buffer.concat([Buffer.from([1]), sha("sha256", Buffer.from(tcb.app_compose, "utf8")), Buffer.alloc(15)]);
    ok(q.mrConfigId.equals(want), "MRCONFIGID commits to the published app_compose", hex(want).slice(2, 18) + "…");
    ok(hex(q.mrtd) === tcb.mrtd && [0, 1, 2, 3].every((i) => hex(q.rtmr[i]) === tcb[`rtmr${i}`]), "MRTD and RTMR0..3 in the quote equal the reported measurements");
  } else ok(false, "tcb_info.app_compose present");
  try { ok(replayRtmr3(rep.event_log).equals(q.rtmr[3]), "the event log replays to RTMR3 in the quote"); } catch (e) { ok(false, "replay the event log", String(e.message)); }
  if (rep.nvidia_payload) skip("NVIDIA GPU evidence", "needs NVIDIA's attestation service (NRAS); not sent");
  return rep.signing_address.toLowerCase();
}

async function bankState() {
  const args = Buffer.from("{}").toString("base64");
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: "get_state", args_base64: args } }) });
      const j = await r.json();
      if (j.result?.result) return JSON.parse(Buffer.from(j.result.result).toString());
    } catch { /* next endpoint */ }
  }
  return null;
}

let report, nonce = null;
if (offline) {
  report = JSON.parse(readFileSync(path.join(ROOT, "data/attestation-report.json"), "utf8"));
  console.log("report: data/attestation-report.json (saved; its nonce was chosen by whoever saved it)");
} else {
  nonce = randomBytes(32).toString("hex");
  const u = `https://cloud-api.near.ai/v1/attestation/report?${new URLSearchParams({ model: MODEL, provider: "near", signing_algo: "ed25519", include_tls_fingerprint: "false", nonce })}`;
  const r = await fetch(u, { headers: { accept: "application/json", "x-no-aliasing": "true" }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) { console.error(`attestation report: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); process.exit(2); }
  report = await r.json();
  console.log(`report: fresh from cloud-api.near.ai for ${MODEL}, nonce ${nonce.slice(0, 16)}… (ours)`);
}

const root = offline ? "offline run" : await intelRoot();
const keys = [];
const models = (report.model_attestations ?? []).filter((m) => m.model_name === MODEL);
if (!ok(models.length > 0, `the report has a model attestation for ${MODEL}`)) process.exit(1);
models.forEach((m, i) => { const k = checkReport(`model report ${i + 1} of ${models.length}`, m, nonce, root); if (k) keys.push(k); });
if (report.gateway_attestation) checkReport("gateway report", report.gateway_attestation, nonce, root);

console.log(`\nthe bank on testnet (${CONTRACT})`);
const st = offline ? null : await bankState();
if (st) {
  ok(keys.includes(String(st.chair_signer ?? "").toLowerCase()), "the key the bank pins is a model key attested above", String(st.chair_signer).slice(0, 16) + "…");
  ok(st.chair_model === MODEL, "the bank pins the same model", st.chair_model);
  console.log(`   info pinned system prompt sha256 ${String(st.chair_prompt_sha256).slice(0, 16)}…, chair ${st.chair}, owner ${st.owner}`);
} else skip("compare with the key the bank pins", offline ? "offline run (attested keys: " + keys.map((k) => k.slice(0, 12) + "…").join(", ") + ")" : "testnet RPC did not answer");

console.log(`\nnot checked: Intel TCB level and revocation lists, NVIDIA GPU evidence, image provenance of the measured configuration.`);
console.log(failed === 0 ? `all checks passed${skipped ? ` (${skipped} skipped, listed above)` : ""}` : `${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
