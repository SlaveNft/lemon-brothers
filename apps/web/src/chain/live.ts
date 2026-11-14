/**
 * What the page knows about the real bank right now, read once and shared: the bank's state (`get_state`) and the
 * visitor's own account in it (`get_account`). The top bar, "Your $LEMON" and the testnet panel all show the same
 * numbers, so they read them from here instead of each polling the public RPC, which rate-limits per address.
 *
 * Reads only. Polling runs while something on the page is subscribed and the tab is visible.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { rpc, viewCall, type ChainState } from "./rpc";
import { asChainState } from "./validate";
import { GUEST_EVENT, storedGuestId } from "./bankView";

type Listener = () => void;

/** A tiny store: a value, subscribers, and a start/stop pair run with the first and the last subscriber. */
function store<T>(initial: T, run: (set: (next: T | ((prev: T) => T)) => void, get: () => T) => () => void) {
  let value = initial, stop: (() => void) | null = null;
  const subs = new Set<Listener>();
  const get = () => value;
  const set = (next: T | ((prev: T) => T)) => {
    value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
    subs.forEach((f) => f());
  };
  const subscribe = (f: Listener) => {
    subs.add(f);
    if (subs.size === 1) stop = run(set, get);
    return () => { subs.delete(f); if (subs.size === 0) { stop?.(); stop = null; } };
  };
  return { get, set, subscribe };
}

// ------------------------------------------------------------------ the bank

export interface BankLive { s: ChainState | null; block: number; err: string | null }
let pollBank: (now?: boolean) => void = () => {};

const bank = store<BankLive>({ s: null, block: 0, err: null }, (set) => {
  // one read every 10 s while the tab is visible, none while it is hidden; failures back off to a minute
  let live = true, timer: ReturnType<typeof setTimeout>, delay = 10_000, run = 0, shown = 0;
  const poll = async (now = false) => {
    const mine = ++run;
    clearTimeout(timer);
    if (document.hidden && !now) { timer = setTimeout(() => void poll(), 5000); return; }
    try {
      // `now`: the newest block rather than the last final one, asked for right after a transaction from this page
      const r = await viewCall<unknown>("get_state", {}, now ? "optimistic" : "final");
      if (!live) return;
      const st = asChainState(r.value); // an answer that is not a bank state is an error to show, never to render
      // a final read older than the optimistic one already on screen would roll the page back: skip it
      if (r.block >= shown) { shown = r.block; set({ s: st, block: r.block, err: null }); }
      else set((p) => ({ ...p, err: null }));
      delay = 10_000;
    } catch (e) {
      if (!live) return;
      set((p) => ({ ...p, err: String((e as Error)?.message ?? e) }));
      delay = Math.min(60_000, delay * 2);
    }
    if (live && mine === run) timer = setTimeout(() => void poll(), delay);
  };
  pollBank = (now) => { if (live) void poll(now); };
  void poll();
  return () => { live = false; clearTimeout(timer); pollBank = () => {}; };
});

/** The bank's state, re-read every 10 s. */
export const useBank = (): BankLive => useSyncExternalStore(bank.subscribe, bank.get, bank.get);
/** Read the bank again now, at the newest block (after a transaction sent from this page). */
export const refreshBank = () => pollBank(true);

// ------------------------------------------------------------------ the visitor's account

export interface MeLive {
  /** The guest account kept in this browser, if any. */
  guestId: string | null;
  /** That account is not on chain any more (testnet was reset, or the account was deleted). */
  gone: boolean;
  /** The last `get_account` answer (`value` null = the bank has no record of it); null = not read yet. */
  acct: { value: unknown } | null;
  err: string | null;
}
const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
let readMe: (fresh?: boolean) => void = () => {};

const me = store<MeLive>({ guestId: typeof window === "undefined" ? null : storedGuestId(storage()), gone: false, acct: null, err: null }, (set, get) => {
  let live = true, timer: ReturnType<typeof setTimeout>, run = 0, shown = 0, checked: string | null = null;
  const read = async (fresh = false) => {
    const mine = ++run;
    clearTimeout(timer);
    const { guestId, gone } = get();
    if (guestId && !gone && (!document.hidden || fresh)) {
      try {
        const r = await viewCall<unknown>("get_account", { account_id: guestId }, fresh ? "optimistic" : "final");
        if (!live || get().guestId !== guestId) return;
        if (r.block >= shown) { shown = r.block; set((p) => ({ ...p, acct: { value: r.value }, err: null })); }
        else set((p) => ({ ...p, err: null }));
      } catch (e) {
        if (!live) return;
        set((p) => ({ ...p, err: String((e as Error)?.message ?? e) }));
      }
    }
    if (live && mine === run) timer = setTimeout(() => void read(), 30_000);
  };
  // a guest kept from an earlier visit: is its account still on chain?
  const check = (id: string | null) => {
    if (!id || checked === id) return;
    checked = id;
    rpc("query", { request_type: "view_account", finality: "final", account_id: id })
      .catch((e) => { if (live && get().guestId === id && /UNKNOWN_ACCOUNT|does not exist/i.test(String((e as Error)?.message ?? e))) set((p) => ({ ...p, gone: true })); });
  };
  // the guest account is made on a click somewhere on the page, or in another tab
  const sync = () => {
    const id = storedGuestId(storage());
    if (id === get().guestId) return;
    shown = 0;
    set({ guestId: id, gone: false, acct: null, err: null });
    checked = id; // an account this page has just made exists
    void read(true);
  };
  readMe = (fresh = true) => { if (live) void read(fresh); };
  window.addEventListener(GUEST_EVENT, sync);
  window.addEventListener("storage", sync);
  check(get().guestId);
  void read();
  return () => { live = false; clearTimeout(timer); readMe = () => {}; window.removeEventListener(GUEST_EVENT, sync); window.removeEventListener("storage", sync); };
});

/** The visitor's guest account and what the bank holds for it, re-read every 30 s and after each action. */
export const useMe = (): MeLive => useSyncExternalStore(me.subscribe, me.get, me.get);
/** Read the account again now, at the newest block. */
export const refreshMe = () => readMe(true);
export const setGone = (gone: boolean) => me.set((p) => (p.gone === gone ? p : { ...p, gone, acct: gone ? null : p.acct }));

/** A clock that ticks once a second, for countdowns. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}
