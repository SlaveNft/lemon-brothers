/**
 * The pure part of the "use the real bank" block: what to send for each action (the exact JSON arguments the
 * contract's methods take) and what to show from `get_account` and `get_state`.
 *
 * No near-api-js here: this module is part of the first screen, the signing module (guest.ts) is loaded on a click.
 * `?contract=` and `?rpc=` let the page read any account through any endpoint, so nothing is trusted to have the
 * bank's shape: a missing or odd field reads as zero / unknown, never as a crash.
 */
import publicGuest from "./publicGuest.json";
import { CONTRACT } from "./rpc";

/** Where guest.ts keeps the guest account in localStorage (its GUEST_KEY). */
export const GUEST_STORAGE_KEY = "chair.guest";
/** Fired on `window` by guest.ts when the stored guest account changes, so every block that shows it follows. */
export const GUEST_EVENT = "chair:guest";
const GUEST_ID = /^lemon-guest-[0-9a-f]{8}\.testnet$/;
/**
 * The shared public guest (scripts/testnet/public-guest.mjs): an account with no full-access key whose only key, a
 * function-call key limited to the bank's player methods, is published in the repository on purpose. The page uses it
 * when the testnet faucet refuses to make a personal guest account. Only for the project's own deployment.
 */
export const PUBLIC_GUEST: { accountId: string; secretKey: string } | null =
  publicGuest.contract === CONTRACT && typeof publicGuest.accountId === "string" && typeof publicGuest.secretKey === "string" && publicGuest.secretKey.startsWith("ed25519:")
    ? { accountId: publicGuest.accountId, secretKey: publicGuest.secretKey } : null;
export const isPublicGuest = (accountId: string | null | undefined): boolean => !!accountId && accountId === PUBLIC_GUEST?.accountId;
/** An account this page may sign for: a personal faucet guest or the shared public one. */
export const isGuestId = (accountId: string): boolean => GUEST_ID.test(accountId) || isPublicGuest(accountId);

/** The guest account this browser already has, if any: read without loading the signing module. */
export function storedGuestId(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  try {
    const v = JSON.parse(storage?.getItem(GUEST_STORAGE_KEY) ?? "null") as { accountId?: unknown; secretKey?: unknown } | null;
    return v && typeof v.accountId === "string" && isGuestId(v.accountId) && typeof v.secretKey === "string" ? v.accountId : null;
  } catch { return null; } // storage blocked or not JSON: no guest
}

// ------------------------------------------------------------------ the contract's numbers (bank-core)

export const AIRDROP_LEMON = 1000;
export const LOBBY_FEE = 10;
export const RUMOR_FEE = 25;
export const INSURE_PREMIUM = "50";
export const DEFAULT_DEPOSIT = "500";
export const MAX_SPEECH_BYTES = 280;
export const RUMOR_KINDS = ["vault_empty", "chair_resigning", "bailout_coming"] as const;
export type RumorKind = (typeof RUMOR_KINDS)[number];

const U128_MAX = (1n << 128n) - 1n;

/** What the contract counts for a speech: UTF-8 bytes, not characters (a Cyrillic letter is two). */
export const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/**
 * What a person typed as an amount, as the contract's U128 argument (a string of digits), or null if it is not a
 * positive whole number that fits u128. Spaces and thousands separators are dropped: "1 000" and "1,000" are "1000".
 */
export function amountArg(input: string): string | null {
  const s = String(input ?? "").replace(/[\s,_  ]/g, "");
  if (!/^\d{1,39}$/.test(s)) return null;
  const v = BigInt(s);
  return v > 0n && v <= U128_MAX ? v.toString() : null;
}

/** A speech as the contract takes it (trimmed), or null when it is empty or longer than 280 bytes. */
export function speechArg(input: string): string | null {
  const s = String(input ?? "").trim();
  const n = byteLength(s);
  return n >= 1 && n <= MAX_SPEECH_BYTES ? s : null;
}

/**
 * The JSON arguments of each public method, exactly as lemon-bank/src/lib.rs declares them: amounts are U128
 * (strings of digits), methods without parameters take `{}`.
 */
export const bankArgs = {
  airdrop: () => ({}),
  deposit: (amount: string) => ({ amount }),
  withdraw: (amount: string) => ({ amount }),
  withdraw_all: () => ({}),
  lobby: (text: string) => ({ text }),
  rumor: (kind: RumorKind) => ({ kind }),
  insure: (premium: string) => ({ premium }),
  advance_epoch: () => ({}),
} as const;

// ------------------------------------------------------------------ the view model

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** An amount as the contract writes it (a string of digits) or a plain non-negative whole number; anything else is 0. */
export function lemon(v: unknown): bigint {
  if (typeof v === "string" && /^\d{1,39}$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return BigInt(Math.floor(v));
  return 0n;
}

/** "1,234,567" for any u128. */
export const fmtLemon = (x: bigint): string => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Whole seconds until `advance_epoch` may be called (0 = due now), or null when the bank's clock is unknown.
 * The contract compares the block's time with `next_epoch_ms` (`last_epoch_ms + epoch_ms` in `get_state`).
 */
export function secondsToEpoch(nextEpochMs: unknown, nowMs: number): number | null {
  if (typeof nextEpochMs !== "number" || !Number.isFinite(nextEpochMs) || nextEpochMs <= 0 || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.ceil((nextEpochMs - nowMs) / 1000));
}

export interface BankView {
  /** The bank has a record for this account (`get_account` returned an object, not null). */
  registered: boolean;
  /** LEMON in the wallet, the deposit's value today, and the insurance bought this round. */
  wallet: bigint; deposit: bigint; insured: bigint;
  /** The 1,000 LEMON airdrop has not been claimed: there is no record, or its `airdropped` is not true. */
  airdropAvailable: boolean;
  /** Nothing to act with yet: no LEMON anywhere. */
  empty: boolean;
  /** `get_state` was readable enough to tell the time. */
  stateKnown: boolean;
  /** `advance_epoch` would be accepted now. */
  epochDue: boolean;
  /** Seconds until it is due; null when unknown. */
  epochInSec: number | null;
  /** The bank has fallen and is closed until the bailout (deposits and insurance are refused). */
  collapsed: boolean;
  /** Taking money out now pays the early-withdrawal fee (the latest deposit was made in the previous bank day). */
  earlyFee: boolean;
}

/** "45 s", "12 min", "1 h 5 min" for a wait in whole seconds. */
export function waitText(sec: number, ru: boolean): string {
  if (sec < 120) return ru ? `${sec} с` : `${sec} s`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return ru ? `${min} мин` : `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return ru ? `${h} ч${m ? ` ${m} мин` : ""}` : `${h} h${m ? ` ${m} min` : ""}`;
}

/**
 * What the block shows, from the raw JSON of `get_account` (null = the bank has no such account) and `get_state`
 * (null = not read yet) at `nowMs`.
 */
export function bankView(account: unknown, state: unknown, nowMs: number): BankView {
  const a = isObj(account) ? account : null;
  const s = isObj(state) ? state : null;
  const wallet = lemon(a?.wallet), deposit = lemon(a?.deposit_value), insured = lemon(a?.insured);
  const epochInSec = s ? secondsToEpoch(s.next_epoch_ms, nowMs) : null;
  return {
    registered: a !== null,
    wallet, deposit, insured,
    airdropAvailable: a === null || a.airdropped !== true,
    empty: wallet === 0n && deposit === 0n && insured === 0n,
    stateKnown: epochInSec !== null,
    epochDue: epochInSec === 0,
    epochInSec,
    collapsed: s?.collapsed === true,
    earlyFee: a?.early_fee_now === true,
  };
}
