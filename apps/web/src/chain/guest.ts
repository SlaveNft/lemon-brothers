/**
 * The invisible guest account: how a player puts a result on chain without ever seeing a wallet, a seed phrase or
 * a gas prompt.
 *
 * THIS IS A THROWAWAY TESTNET ACCOUNT. Its private key is generated in this browser, kept in this browser's
 * localStorage (`chair.guest`) in the clear, and never sent anywhere. It holds only faucet testnet NEAR, which is
 * worth nothing; anyone with access to this browser profile can use it, and clearing site data loses it. Do not
 * copy this scheme to mainnet or to anything of value.
 *
 * The account is created by the NEAR testnet helper (the same endpoint and payload as `helperAccount` in
 * scripts/testnet/common.mjs), which funds it enough for many `submit_run` calls.
 *
 * This module pulls in near-api-js, so it is only ever loaded with a dynamic `import()` (see ChairGame); the first
 * screen does not pay for it. Every network call goes through `GuestNet`, so the logic is tested with fakes.
 */
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, baseEncode, type KeyPairString, type Provider } from "near-api-js";
import { tr } from "../lang";
import { CONTRACT, RPC_URLS, rpc } from "./rpc";
import { GUEST_EVENT, GUEST_STORAGE_KEY, PUBLIC_GUEST, isGuestId } from "./bankView";

/** The official testnet account helper: POST { newAccountId, newAccountPublicKey } creates and funds the account. */
export const HELPER_URL = "https://helper.testnet.near.org/account";
export const GUEST_KEY = GUEST_STORAGE_KEY; // "chair.guest"
export const SUBMIT_GAS = 30_000_000_000_000n; // 30 Tgas
/** Gas for an ordinary call on the bank. */
export const DEFAULT_GAS = SUBMIT_GAS;
/** Gas for the two calls that may settle every depositor at once (a collapse): `advance_epoch` and `withdraw_all`. */
export const HEAVY_GAS = 100_000_000_000_000n; // 100 Tgas
export const gasFor = (method: string): bigint => (method === "advance_epoch" || method === "withdraw_all" ? HEAVY_GAS : DEFAULT_GAS);
/**
 * How long a send waits. EXECUTED_OPTIMISTIC: the transaction is in a block and its receipts have run, so the
 * answer carries the outcome (SuccessValue or the contract's panic), but the block is not final yet. That is two or
 * three seconds instead of the extra blocks FINAL waits for. Of the values near-api-js 7.5.2 accepts, the faster
 * ones (NONE, INCLUDED, INCLUDED_FINAL) return before the call has executed, with no outcome to show.
 */
export const WAIT_UNTIL = "EXECUTED_OPTIMISTIC" as const;

export interface Guest { accountId: string; secretKey: string }
export type RunEnding = "survived" | "run" | "impeached" | "hyperinflation";
export interface RunResult { seed: number; moves: string; score: number; ending: RunEnding }

/** The network, as the guest logic sees it. */
export interface GuestNet {
  /** Ask the helper for a new funded account. Resolves with the HTTP answer; rejects when no answer came (offline, CORS, timeout). */
  createAccount(accountId: string, publicKey: string): Promise<{ status: number; text: string }>;
  /** Is the account on chain? Rejects when the RPC cannot be reached. */
  accountExists(accountId: string): Promise<boolean>;
  /** Sign a function call on the bank with the guest's key, send it and wait for the outcome (its `status` object). Gas defaults to `gasFor(method)`. */
  call(guest: Guest, method: string, args: object, gas?: bigint): Promise<{ txHash: string; status: unknown }>;
}
export interface GuestEnv {
  net: GuestNet;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  newKey(): { secretKey: string; publicKey: string };
  /** Eight hex digits for the account name. */
  suffix(): string;
  sleep(ms: number): Promise<void>;
  /** The shared public guest to fall back on when the faucet will not make a personal account (see bankView.ts). */
  publicGuest?: Guest | null;
}

export type GuestErrorCode =
  | "helper-unreachable" | "helper-busy" | "helper-failed" | "name-taken"
  | "not-ready" | "rpc-timeout" | "rpc" | "no-funds" | "contract" | "bad-result" | "gone";

/** A failure with a code (for tests and the UI) and a sentence a player can read. */
export class GuestError extends Error {
  constructor(readonly code: GuestErrorCode, readonly detail = "", readonly txHash?: string) { super(describe(code, detail)); }
}

function describe(code: GuestErrorCode, detail: string): string {
  const d = detail ? ` (${detail})` : "";
  switch (code) {
    case "helper-unreachable": return tr(`The testnet account service could not be reached${d}. Check the connection, or try again in a minute.`, `Сервис тестовых аккаунтов недоступен${d}. Проверь соединение или попробуй через минуту.`);
    case "helper-busy": return tr("The testnet account service is rate-limiting new accounts right now. Try again in a few minutes.", "Сервис тестовых аккаунтов сейчас ограничивает создание новых. Попробуй через несколько минут.");
    case "helper-failed": return tr(`The testnet account service refused to create a guest account${d}.`, `Сервис тестовых аккаунтов отказался создать гостевой аккаунт${d}.`);
    case "name-taken": return tr("Two guest account names in a row were already taken. Try again.", "Два имени гостевого аккаунта подряд оказались заняты. Попробуй ещё раз.");
    case "not-ready": return tr("The new guest account is not visible on the network yet. Try again in a few seconds.", "Новый гостевой аккаунт ещё не виден в сети. Попробуй через несколько секунд.");
    case "rpc-timeout": return tr("The testnet RPC did not answer in time. The result may or may not have landed; try again.", "RPC testnet не ответил вовремя. Результат мог записаться, а мог и нет; попробуй ещё раз.");
    case "no-funds": return tr("The guest account has run out of testnet NEAR for gas.", "У гостевого аккаунта кончились тестовые NEAR на газ.");
    case "contract": return tr(`The contract refused: ${detail}`, `Контракт отказал: ${detail}`);
    case "bad-result": return tr(`This result cannot be sent${d}.`, `Этот результат нельзя отправить${d}.`);
    case "gone": return tr("The guest account kept in this browser is no longer on testnet (it was deleted, the network was reset, or site data was cleared). Open a new one.", "Гостевого аккаунта из этого браузера больше нет в testnet (его удалили, сеть сбросили или данные сайта очищены). Открой новый.");
    default: return tr(`The testnet RPC failed${d}.`, `Ошибка RPC testnet${d}.`);
  }
}

// ------------------------------------------------------------------ storage

export function loadGuest(storage: GuestEnv["storage"]): Guest | null {
  try {
    const v = JSON.parse(storage?.getItem(GUEST_KEY) ?? "null") as Partial<Guest> | null;
    if (v && typeof v.accountId === "string" && isGuestId(v.accountId) && typeof v.secretKey === "string" && v.secretKey.startsWith("ed25519:")) {
      return { accountId: v.accountId, secretKey: v.secretKey };
    }
  } catch { /* storage blocked or not JSON: no guest */ }
  return null;
}
function announce() {
  try { if (typeof window !== "undefined") window.dispatchEvent(new Event(GUEST_EVENT)); } catch { /* no events here (tests, old browsers) */ }
}
function saveGuest(storage: GuestEnv["storage"], g: Guest) {
  try { storage?.setItem(GUEST_KEY, JSON.stringify(g)); } catch { /* storage blocked: the guest lives for this page only */ }
  announce();
}
function forgetGuest(storage: GuestEnv["storage"]) {
  try { storage?.removeItem(GUEST_KEY); } catch { /* storage blocked */ }
  announce();
}

// ------------------------------------------------------------------ the account

/** What the helper is sent: exactly the body `helperAccount` posts. */
export const helperPayload = (accountId: string, publicKey: string) => ({ newAccountId: accountId, newAccountPublicKey: publicKey });

/** Create, fund and store a new guest account. A taken name is retried once with another suffix. */
export async function createGuest(env: GuestEnv): Promise<Guest> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const accountId = `lemon-guest-${env.suffix()}.testnet`;
    const key = env.newKey();
    let r: { status: number; text: string };
    try { r = await env.net.createAccount(accountId, key.publicKey); }
    catch (e) { return sharedGuest(env) ?? fail(new GuestError("helper-unreachable", short(e))); }
    if (r.status >= 200 && r.status < 300) {
      const guest = { accountId, secretKey: key.secretKey };
      saveGuest(env.storage, guest);
      // the helper answers before every RPC node has seen the account: give it a few seconds (best effort)
      for (let i = 0; i < 8; i++) {
        try { if (await env.net.accountExists(accountId)) break; } catch { /* the RPC hiccuped: keep waiting */ }
        await env.sleep(1500);
      }
      return guest;
    }
    if (/exist/i.test(r.text)) continue; // the name is taken: another suffix
    // the faucet allows a few accounts per address and then says "retry in 2 hours": play on the shared guest instead
    if (r.status === 429 || /rate.?limit|too many/i.test(r.text)) return sharedGuest(env) ?? fail(new GuestError("helper-busy"));
    return sharedGuest(env) ?? fail(new GuestError("helper-failed", `HTTP ${r.status} ${r.text.slice(0, 160)}`.trim()));
  }
  return sharedGuest(env) ?? fail(new GuestError("name-taken"));
}

const fail = (e: GuestError): never => { throw e; };
/** Store and return the shared public guest, if this deployment has one. */
function sharedGuest(env: GuestEnv): Guest | null {
  if (!env.publicGuest) return null;
  const g = { accountId: env.publicGuest.accountId, secretKey: env.publicGuest.secretKey };
  saveGuest(env.storage, g);
  return g;
}

/** The stored guest account, or a new one. */
export async function ensureGuest(env: GuestEnv = browserEnv()): Promise<Guest> {
  return loadGuest(env.storage) ?? createGuest(env);
}

// ------------------------------------------------------------------ the claim

/** The arguments of `submit_run`, or a GuestError if the result is not one the contract could take. */
export function submitArgs(r: RunResult): { seed: number; moves: string; score: number; ending: RunEnding } {
  if (!Number.isSafeInteger(r.seed) || r.seed <= 0) throw new GuestError("bad-result", "seed");
  if (!Number.isInteger(r.score) || r.score < 0 || r.score > 100) throw new GuestError("bad-result", "score");
  if (typeof r.moves !== "string" || !/^[0-9nrtmg.]{1,200}$/.test(r.moves)) throw new GuestError("bad-result", "moves");
  if (!["survived", "run", "impeached", "hyperinflation"].includes(r.ending)) throw new GuestError("bad-result", "ending");
  return { seed: r.seed, moves: r.moves, score: r.score, ending: r.ending };
}

const GONE = /does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist|SignerDoesNotExist|UNKNOWN_ACCESS_KEY|AccessKeyDoesNotExist|AccessKeyNotFound|InvalidAccessKey/i;
const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

/** The contract's panic text out of a transaction failure, else the failure as JSON. */
export function failureText(failure: unknown): string {
  const exec = (failure as { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: unknown } } } })?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  if (typeof exec === "string") return exec.replace(/^Smart contract panicked: /, "");
  const found = /Smart contract panicked: ([^"\\]+)/.exec(typeof failure === "string" ? failure : JSON.stringify(failure) ?? "");
  return found ? found[1] : (typeof failure === "string" ? failure : JSON.stringify(failure) ?? "unknown failure").slice(0, 300);
}

/** A thrown send error as a GuestError. */
export function sendError(e: unknown): GuestError {
  if (e instanceof GuestError) return e;
  const m = String((e as Error)?.message ?? e);
  if (/Smart contract panicked/.test(m)) return new GuestError("contract", failureText(m));
  if (/timed? ?out|TimeoutError|TIMEOUT_ERROR|aborted/i.test(m)) return new GuestError("rpc-timeout");
  if (/NotEnoughBalance|LackBalance/i.test(m)) return new GuestError("no-funds");
  return new GuestError("rpc", m.slice(0, 160));
}

export type SubmitStage = "guest" | "sending";
export type SubmitOutcome =
  /** `accepted` is what `submit_run` returned: false means the claim was recorded as not good enough for the board. */
  | { ok: true; txHash: string; accountId: string; accepted: boolean }
  | { ok: false; error: string; code: GuestErrorCode; txHash?: string };

export type CallOutcome =
  /** `value` is what the method returned (its SuccessValue as JSON); absent when it returned nothing. */
  | { ok: true; txHash: string; accountId: string; value?: unknown }
  /** `error` is a sentence for the player; for code "contract" it carries the contract's own panic text. */
  | { ok: false; error: string; code: GuestErrorCode; txHash?: string };
export interface CallOptions {
  env?: GuestEnv;
  onStage?: (s: SubmitStage) => void;
  /** Gas to attach; default `gasFor(method)`: 30 Tgas, 100 Tgas for `advance_epoch` and `withdraw_all`. */
  gas?: bigint;
  /**
   * May this call make a guest account (through the faucet) when there is none, or replace a stored one that is
   * gone from the chain? Default true. With false both cases are the error "gone" and nothing new is created.
   */
  create?: boolean;
}

/** A transaction outcome's SuccessValue (base64 of the method's JSON return) as a value; undefined when empty or not JSON. */
export function successValue(v: unknown): unknown {
  if (typeof v !== "string" || !v) return undefined;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0)))); } catch { return undefined; }
}

/** Has the transaction run to an outcome (success or failure)? A status like "Started" or "NotStarted" has not. */
export const isSettled = (status: unknown): boolean =>
  status !== null && typeof status === "object" && ("SuccessValue" in status || "Failure" in status);

/**
 * One function call on the bank from the guest account: make the account if there is none, sign, send, wait for
 * the outcome. Never throws. A stored guest whose account is gone from the chain (testnet was reset, or the account
 * was deleted) is replaced once, unless `create` is false.
 */
export async function callBank(method: string, args: object = {}, opts: CallOptions = {}): Promise<CallOutcome> {
  const env = opts.env ?? browserEnv(), stage = opts.onStage ?? (() => {});
  const gas = opts.gas ?? gasFor(method), create = opts.create !== false;
  try {
    stage("guest");
    let guest = loadGuest(env.storage), fresh = false;
    if (!guest) {
      if (!create) throw new GuestError("gone");
      guest = await createGuest(env); fresh = true;
    }
    stage("sending");
    let out: { txHash: string; status: unknown };
    for (;;) {
      try { out = await env.net.call(guest, method, args, gas); break; }
      catch (e) {
        if (!GONE.test(String((e as Error)?.message ?? e))) throw sendError(e);
        if (fresh) throw new GuestError("not-ready");
        if (!create) throw new GuestError("gone");
        forgetGuest(env.storage);
        stage("guest");
        guest = await createGuest(env); fresh = true;
        stage("sending");
      }
    }
    const st = out.status as { SuccessValue?: unknown; Failure?: unknown } | null;
    if (st && typeof st === "object" && "Failure" in st) throw new GuestError("contract", failureText(st.Failure), out.txHash);
    const value = successValue(st?.SuccessValue);
    return { ok: true, txHash: out.txHash, accountId: guest.accountId, ...(value !== undefined ? { value } : {}) };
  } catch (e) {
    const g = sendError(e);
    return { ok: false, error: g.message, code: g.code, ...(g.txHash ? { txHash: g.txHash } : {}) };
  }
}

/**
 * Put a finished crisis on chain from the guest account (`submit_run` through `callBank`). Never throws.
 * `submit_run` returns a JSON boolean: only an explicit `false` counts as "did not make the board".
 */
export async function submitRun(result: RunResult, opts: { env?: GuestEnv; onStage?: (s: SubmitStage) => void } = {}): Promise<SubmitOutcome> {
  let args: ReturnType<typeof submitArgs>;
  try { args = submitArgs(result); }
  catch (e) { const g = sendError(e); return { ok: false, error: g.message, code: g.code }; }
  const out = await callBank("submit_run", args, { env: opts.env, onStage: opts.onStage });
  return out.ok ? { ok: true, txHash: out.txHash, accountId: out.accountId, accepted: out.value !== false } : out;
}

// ------------------------------------------------------------------ the real network

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

// the network will never take these signed bytes: do not send them again
const REFUSED = /InvalidTx|InvalidAccessKey|NotEnoughBalance|AccessKeyDoesNotExist|does not exist|UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|Expired/i;

/** Browser implementation: `fetch` to the helper, the page's RPC list for reads, near-api-js for signing and sending. */
export function browserNet(): GuestNet {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const providers: Provider[] = RPC_URLS.map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 400, backoff: 1.5 }));
  return {
    async createAccount(accountId, publicKey) {
      const r = await fetch(HELPER_URL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(helperPayload(accountId, publicKey)),
        signal: AbortSignal.timeout(30_000),
      });
      return { status: r.status, text: r.ok ? "" : await r.text().catch(() => "") };
    },
    async accountExists(accountId) {
      try { await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId }); return true; }
      catch (e) { if (/UNKNOWN_ACCOUNT|does not exist/i.test(String((e as Error).message))) return false; throw e; }
    },
    async call(guest, method, args, gas) {
      const signer = KeyPairSigner.fromSecretKey(guest.secretKey as KeyPairString);
      const action = actions.functionCall(method, args, gas ?? gasFor(method), 0n);
      // sign once (the nonce and a recent block come from whichever endpoint answers first) ...
      let signed, last: unknown;
      for (const p of providers) {
        try { signed = await withTimeout(new Account(guest.accountId, p, signer).createSignedTransaction({ receiverId: CONTRACT, actions: [action] }), 15_000, "preparing the transaction"); break; }
        catch (e) { last = e; if (GONE.test(String((e as Error)?.message ?? e))) throw e; }
      }
      if (!signed) throw last instanceof Error ? last : new Error(String(last));
      const txHash = baseEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", signed.transaction.encode() as BufferSource)));
      // ... then send the same bytes until an endpoint reports the outcome; a lost answer is looked up by hash, so
      // the call is never sent twice under two nonces. WAIT_UNTIL answers as soon as the call has executed.
      for (let i = 0; i < 3; i++) {
        const p = providers[i % providers.length];
        try {
          const status = (await withTimeout(p.sendTransactionUntil(signed, WAIT_UNTIL), 45_000, "sending the transaction")).status;
          if (isSettled(status)) return { txHash, status };
          throw new Error("the endpoint answered before the transaction had executed");
        } catch (e) {
          last = e;
          const msg = String((e as Error)?.message ?? e);
          if (i === 0 && REFUSED.test(msg) && !/InvalidNonce/i.test(msg)) throw e;
          try {
            const status = (await withTimeout(p.viewTransactionStatus({ txHash, accountId: guest.accountId, waitUntil: WAIT_UNTIL }), 15_000, "looking the transaction up")).status;
            if (isSettled(status)) return { txHash, status };
          } catch { /* not on chain (yet) */ }
          await sleep(1000 * 2 ** i);
        }
      }
      throw new Error(`sending the transaction timed out (${short(last)})`);
    },
  };
}

let shared: GuestEnv | null = null;
export function browserEnv(): GuestEnv {
  if (shared) return shared;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* blocked */ }
  return (shared = {
    net: browserNet(), storage,
    newKey: randomKey,
    suffix: () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join(""),
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    publicGuest: PUBLIC_GUEST,
  });
}

/** A fresh ed25519 key pair in NEAR's text form ("ed25519:<base58>"). */
export function randomKey(): { secretKey: string; publicKey: string } {
  const kp = KeyPair.fromRandom("ed25519");
  return { secretKey: kp.toString(), publicKey: kp.getPublicKey().toString() };
}
