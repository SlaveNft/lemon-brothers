/**
 * Read-only access to the deployed bank on NEAR testnet through public JSON-RPC (no wallet, no keys, no runner).
 * Public endpoints rate-limit, so calls rotate through a list and back off on failure.
 *
 *   ?contract=<account>   read another deployment (default: the Lemon Brothers bank on testnet)
 *   ?rpc=<url>            use one RPC endpoint
 */
const DEFAULT_CONTRACT = "lemonbank-587f5c93.testnet";
// Five public endpoints from four operators (checked 2026-11-13: all answer with CORS open). Each rate-limits per
// address, so a refused call moves on to the next one.
const DEFAULT_RPCS = ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://test.rpc.fastnear.com", "https://near-testnet.gateway.tatum.io", "https://rpc.testnet.near.org"];
// `location` is absent under the unit tests (node): the defaults apply there
const query = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const CONTRACT = query.get("contract") || DEFAULT_CONTRACT;
const custom = query.get("rpc");
const RPCS = custom ? [custom] : DEFAULT_RPCS;
/** The endpoints in use, in order of preference; the guest account signs against the same list. */
export const RPC_URLS: readonly string[] = RPCS;
/** What the address bar overrode, so the panel can say that this is not the project's own deployment or endpoint. */
export const OVERRIDES = { contract: CONTRACT !== DEFAULT_CONTRACT ? CONTRACT : null, rpc: custom || null };
export const EXPLORER = "https://testnet.nearblocks.io";

let preferred = 0;

/** One JSON-RPC request, tried on each endpoint in turn. An RPC-level error is thrown with its cause name as the message. */
export async function rpc<T>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (let i = 0; i < RPCS.length; i++) {
    const url = RPCS[(preferred + i) % RPCS.length];
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "chair", method, params }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error?.cause?.name ?? j.error?.message ?? "rpc error");
      preferred = (preferred + i) % RPCS.length;
      return j.result as T;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

/**
 * A view call on the bank; returns the method's JSON result and the block it was read at. `optimistic` reads the
 * newest block instead of the last final one: used right after a transaction of ours was executed, so the page
 * shows its effect without waiting two more blocks for finality.
 */
export async function viewCall<T>(method: string, args: object = {}, finality: "final" | "optimistic" = "final"): Promise<{ value: T; block: number }> {
  const res = await rpc<{ result: number[]; block_height: number }>("query", {
    request_type: "call_function", finality, account_id: CONTRACT, method_name: method, args_base64: b64(JSON.stringify(args)),
  });
  // a view that the contract refuses (a panic, a method it does not have) arrives as a result with an `error` text
  const refused = (res as { error?: unknown } | null)?.error;
  if (typeof refused === "string") throw new Error(refused);
  if (!res || !Array.isArray(res.result)) throw new Error("the RPC answer carries no result bytes");
  const text = new TextDecoder().decode(new Uint8Array(res.result));
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("the contract's answer is not JSON"); }
  return { value: value as T, block: Number(res.block_height) || 0 };
}

/** True when a view failed because this contract has no such method (an older deployment). */
export const isMethodMissing = (e: unknown): boolean => /MethodNotFound|method not found|MethodResolveError/i.test(String((e as Error)?.message ?? e));

/** The bank's state as `get_state` returns it (u128 amounts as strings). */
export interface ChainState {
  supply: string; reserve: string; loans: string; liabilities: string; reserve_permille: string;
  collapsed: boolean; epoch: number; round: number; epoch_id: number;
  policy: { rate: string; target: string; mint: string; gate: string; tone: string; statement: string; attestation: string };
  policy_set_epoch_id: number; minted_this_round: string; round_start_supply: string; outflow: string;
  chair: string; owner: string;
  speeches: Array<{ who: string; text: string }>; rumors: Array<{ who: string; kind: string }>;
  epoch_ms: number; next_epoch_ms: number;
  chair_signer: string | null; chair_model: string; chair_prompt_sha256?: string | null;
  accounts: number;
  /** The most LEMON that may ever exist; absent or null on a bank whose ceiling has not been set. */
  max_supply?: string | null;
}
