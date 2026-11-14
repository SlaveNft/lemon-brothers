/**
 * Shared testnet helpers: keys in .testnet/ (gitignored, mode 0600, never printed), RPC reads with retry,
 * transactions that survive a lost RPC response, and the faucet helper for new funded accounts.
 *
 * Env: NEAR_RPC_URL (one endpoint; default: fail over across four public testnet endpoints, because each of them
 * rate-limits per address), NEAR_HELPER_URL (default the official helper).
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, baseEncode } from "near-api-js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const STATE_DIR = path.join(ROOT, ".testnet");
export const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com";
const RPC_URLS = process.env.NEAR_RPC_URL ? [process.env.NEAR_RPC_URL] : [RPC_URL, "https://near-testnet.drpc.org", "https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
/** One provider for every account: a rate-limited or failing endpoint hands the call to the next one. */
export const PROVIDER = RPC_URLS.length === 1 ? new JsonRpcProvider({ url: RPC_URLS[0] }) : new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url })));
export const HELPER_URL = process.env.NEAR_HELPER_URL ?? "https://helper.testnet.near.org/account";
export const TGAS = 10n ** 12n;
export const NEAR = 10n ** 24n;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function saveKey(accountId, secretKey, publicKey, label = "full") {
  mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${accountId}.${label}.json`);
  writeFileSync(file, JSON.stringify({ account_id: accountId, public_key: publicKey, secret_key: secretKey }, null, 2));
  chmodSync(file, 0o600);
  return file;
}

export function loadKey(accountId, label = "full") {
  const file = path.join(STATE_DIR, `${accountId}.${label}.json`);
  if (!existsSync(file)) throw new Error(`no ${label} key for ${accountId} in .testnet/`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function account(accountId, label = "full") {
  return new Account(accountId, PROVIDER, KeyPairSigner.fromSecretKey(loadKey(accountId, label).secret_key));
}

export function readState() {
  const f = path.join(STATE_DIR, "deploy.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}
export function writeState(s) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(path.join(STATE_DIR, "deploy.json"), JSON.stringify(s, null, 2));
}

export async function retry(fn, label, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await sleep(500 * 2 ** i); }
  }
  throw new Error(`${label}: ${last?.message ?? last}`);
}

/** Create a funded top-level testnet account through the helper; returns its key pair (saved to .testnet/). */
export async function helperAccount(prefix) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const accountId = `${prefix}-${Math.random().toString(16).slice(2, 10)}.testnet`;
    const kp = KeyPair.fromRandom("ed25519");
    const publicKey = kp.getPublicKey().toString();
    const r = await fetch(HELPER_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
      signal: AbortSignal.timeout(30_000),
    });
    if (r.ok) { saveKey(accountId, kp.toString(), publicKey); return { accountId, publicKey }; }
    const t = await r.text();
    if (!/exist/i.test(t)) throw new Error(`helper could not create ${accountId}: HTTP ${r.status} ${t.slice(0, 300)}`);
  }
  throw new Error(`helper could not create a ${prefix} account`);
}

export async function view(acc, contractId, method, args = {}) {
  return retry(() => withTimeout(acc.provider.callFunction({ contractId, method, args }), 20_000, `view ${method}`), `view ${method}`);
}

/** Reject after `ms` so a stuck RPC connection cannot hang the keeper (the tx is then looked up by hash). */
function withTimeout(p, ms, what) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

// the network refused the transaction before it could land (the same signed bytes will never land)
const REFUSED = /requires full access|InvalidTx|MethodNameMismatch|ReceiverMismatch|InvalidAccessKey|NotEnoughAllowance|RequiresFullAccess|NotEnoughBalance|does not allow method|AccessKeyDoesNotExist|does not exist while viewing|Expired/i;
// "InvalidNonce" arrives wrapped in InvalidTxError, so REFUSED matches it too; but after a lost response it usually
// means an earlier broadcast of this very transaction landed, so it is never taken as a refusal without a lookup
const NONCE = /InvalidNonce|invalid nonce|nonce .*(must be|larger|greater|too (small|large))/i;

/**
 * What to do with a broadcast error. `attempt` is 0 for the first broadcast.
 *  - "refused": the network will never take these bytes and nothing was sent before, so nothing can have landed
 *  - "lookup-then-refused": look the hash up; if it is not on chain, it was refused
 *  - "lookup-then-retry": look the hash up; if it is not on chain (yet), wait and broadcast again
 */
export function broadcastErrorPlan(message, attempt) {
  const nonce = NONCE.test(message), refused = REFUSED.test(message) || nonce;
  if (!refused) return "lookup-then-retry";
  if (nonce) return attempt === 0 ? "lookup-then-refused" : "lookup-then-retry";
  return attempt === 0 ? "refused" : "lookup-then-refused";
}

/**
 * Sign once and send; if a response is lost, look the transaction up by hash before trying again, so a transaction
 * is never applied twice (a re-broadcast of the same signed bytes is also refused by its nonce). Throws with `hash`
 * set when the transaction landed and failed, and with `refused` when the network never accepted it.
 */
export async function sendTx(acc, receiverId, actions, label) {
  const signed = await retry(() => acc.createSignedTransaction({ receiverId, actions }), `${label}: prepare`);
  const hash = baseEncode(createHash("sha256").update(signed.transaction.encode()).digest());
  let res, lastErr;
  const dbg = (...m) => { if (process.env.NEAR_TX_DEBUG) console.error(`[sendTx ${label}]`, ...m); };
  for (let i = 0; i < 5 && !res; i++) {
    try {
      dbg(`broadcast ${i + 1}`, hash);
      res = await withTimeout(acc.provider.sendTransactionUntil(signed, "FINAL"), 60_000, "broadcast");
    } catch (e) {
      lastErr = e;
      dbg("broadcast error:", String(e?.message ?? e).slice(0, 300));
      const msg = String(e?.message ?? e), plan = broadcastErrorPlan(msg, i);
      const refuse = () => {
        const err = new Error(`${label} refused by the network: ${msg.slice(0, 300)}`);
        err.refused = true;
        return err;
      };
      if (plan === "refused") throw refuse();
      // lost response, rate limit, or an error that an earlier broadcast of the same bytes would also cause: did it
      // land? (an unknown hash can block, hence the timeout)
      try { res = await withTimeout(acc.provider.viewTransactionStatus({ txHash: hash, accountId: acc.accountId, waitUntil: "FINAL" }), 15_000, "lookup"); break; }
      catch (l) { dbg("lookup error:", String(l?.message ?? l).slice(0, 200)); /* not on chain (yet) */ }
      if (plan === "lookup-then-refused") throw refuse();
      await sleep(1000 * 2 ** i); // 1, 2, 4, 8 s: the public RPC rate-limits
    }
  }
  if (!res) throw new Error(`${label}: broadcast failed (${String(lastErr?.message ?? lastErr).slice(0, 200)}), tx ${hash} not found`);
  const st = res?.status;
  if (st && typeof st === "object" && "Failure" in st) {
    const err = new Error(`${label} failed: ${JSON.stringify(st.Failure).slice(0, 400)}`);
    err.failure = st.Failure; err.hash = hash;
    throw err;
  }
  return { hash, res };
}

/** The contract's own refusal text when there is one (a panic's message), else the error message. */
export function failureText(e) {
  const f = e?.failure;
  const exec = f?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  if (typeof exec === "string") return exec.replace(/^Smart contract panicked: /, "");
  if (f) return JSON.stringify(f);
  return String(e?.message ?? e);
}

/** Logged EVENT_JSON entries of a transaction outcome. */
export function eventsOf(res) {
  const out = [];
  for (const o of [res?.transaction_outcome, ...(res?.receipts_outcome ?? [])]) {
    for (const l of o?.outcome?.logs ?? []) if (l.startsWith("EVENT_JSON:")) { try { out.push(JSON.parse(l.slice(11))); } catch { /* not json */ } }
  }
  return out;
}
