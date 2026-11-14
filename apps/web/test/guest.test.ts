import { describe, expect, it } from "vitest";
import {
  GUEST_KEY, GuestError, HELPER_URL, createGuest, ensureGuest, failureText, helperPayload, loadGuest, randomKey, sendError, submitArgs, submitRun,
  type Guest, type GuestEnv, type GuestNet, type RunResult,
} from "../src/chain/guest";

/** A Storage stand-in. */
function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const ok = (value: unknown = true) => ({ txHash: "HASH", status: { SuccessValue: b64(value) } });

interface Calls { created: Array<{ accountId: string; publicKey: string }>; sent: Array<{ guest: Guest; method: string; args: object }>; slept: number }
/** A fake network and environment; every network call is recorded and nothing leaves the process. */
function fake(over: Partial<GuestNet> = {}, stored?: Guest) {
  const calls: Calls = { created: [], sent: [], slept: 0 };
  const storage = memory(stored ? { [GUEST_KEY]: JSON.stringify(stored) } : {});
  let n = 0;
  const net: GuestNet = {
    createAccount: async (accountId, publicKey) => { calls.created.push({ accountId, publicKey }); return { status: 200, text: "" }; },
    accountExists: async () => true,
    call: async (guest, method, args) => { calls.sent.push({ guest, method, args }); return ok(); },
    ...over,
  };
  // wrap so overridden functions are recorded too
  const wrapped: GuestNet = {
    createAccount: over.createAccount ? async (a, p) => { calls.created.push({ accountId: a, publicKey: p }); return over.createAccount!(a, p); } : net.createAccount,
    accountExists: net.accountExists,
    call: over.call ? async (g, m, a) => { calls.sent.push({ guest: g, method: m, args: a }); return over.call!(g, m, a); } : net.call,
  };
  const env: GuestEnv = {
    net: wrapped, storage, newKey: randomKey,
    suffix: () => (0xabc00000 + n++).toString(16),
    sleep: async () => { calls.slept++; },
  };
  return { env, calls, storage };
}
const RUN: RunResult = { seed: 123456, moves: "0n0.1r90.2m4000", score: 71, ending: "survived" };
const OLD: Guest = { accountId: "lemon-guest-0badc0de.testnet", secretKey: "ed25519:oldsecret" };

describe("guest account: key and storage", () => {
  it("generates a fresh ed25519 key pair each time, in NEAR's text form", () => {
    const a = randomKey(), b = randomKey();
    expect(a.secretKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}$/);
    expect(a.publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(a.secretKey).not.toBe(b.secretKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it("creates lemon-guest-<8 hex>.testnet through the helper and stores {accountId, secretKey}", async () => {
    const { env, calls, storage } = fake();
    const g = await ensureGuest(env);
    expect(g.accountId).toMatch(/^lemon-guest-[0-9a-f]{8}\.testnet$/);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0].accountId).toBe(g.accountId);
    expect(calls.created[0].publicKey).toMatch(/^ed25519:/);
    expect(JSON.parse(storage.m.get(GUEST_KEY)!)).toEqual({ accountId: g.accountId, secretKey: g.secretKey });
    // the public key sent to the helper belongs to the stored secret key, and the secret key itself is never sent
    expect(JSON.stringify(calls.created)).not.toContain(g.secretKey.slice(8));
  });

  it("returns the stored guest without touching the network", async () => {
    const { env, calls } = fake({}, OLD);
    expect(await ensureGuest(env)).toEqual(OLD);
    expect(calls.created).toHaveLength(0);
  });

  it("ignores a stored value that is not a guest account", () => {
    for (const bad of ["", "null", "{", "[]", JSON.stringify({ accountId: "someone.testnet", secretKey: "ed25519:x" }), JSON.stringify({ accountId: OLD.accountId }), JSON.stringify({ accountId: OLD.accountId, secretKey: 5 })]) {
      expect(loadGuest(memory({ [GUEST_KEY]: bad })), bad).toBeNull();
    }
    expect(loadGuest(null)).toBeNull();
    expect(loadGuest({ getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} })).toBeNull();
  });

  it("still works when storage is blocked (the guest lives for the page only)", async () => {
    const { env } = fake();
    const g = await ensureGuest({ ...env, storage: null });
    expect(g.accountId).toMatch(/^lemon-guest-/);
  });

  it("waits for the new account to become visible, without failing if the RPC hiccups", async () => {
    let asked = 0;
    const { env, calls } = fake({ accountExists: async () => { asked++; if (asked === 1) throw new Error("HTTP 429"); return asked >= 3; } });
    await createGuest(env);
    expect(asked).toBe(3);
    expect(calls.slept).toBe(2);
  });
});

describe("guest account: the helper", () => {
  it("posts exactly what scripts/testnet/common.mjs helperAccount posts", () => {
    expect(HELPER_URL).toBe("https://helper.testnet.near.org/account");
    expect(helperPayload("lemon-guest-00000000.testnet", "ed25519:PUB")).toEqual({ newAccountId: "lemon-guest-00000000.testnet", newAccountPublicKey: "ed25519:PUB" });
  });

  it("retries once with another suffix and another key when the name is taken", async () => {
    let n = 0;
    const { env, calls } = fake({ createAccount: async () => (n++ === 0 ? { status: 400, text: "Account lemon-guest-x.testnet already exists" } : { status: 200, text: "" }) });
    const g = await createGuest(env);
    expect(calls.created).toHaveLength(2);
    expect(calls.created[0].accountId).not.toBe(calls.created[1].accountId);
    expect(calls.created[0].publicKey).not.toBe(calls.created[1].publicKey);
    expect(g.accountId).toBe(calls.created[1].accountId);
  });

  it("gives up after the second taken name", async () => {
    const { env, calls, storage } = fake({ createAccount: async () => ({ status: 400, text: "already exists" }) });
    await expect(createGuest(env)).rejects.toMatchObject({ code: "name-taken" });
    expect(calls.created).toHaveLength(2);
    expect(storage.m.has(GUEST_KEY)).toBe(false);
  });

  it("maps a helper that cannot be reached (offline, CORS, timeout), a rate limit and a refusal", async () => {
    const unreachable = fake({ createAccount: async () => { throw new TypeError("Failed to fetch"); } });
    await expect(createGuest(unreachable.env)).rejects.toMatchObject({ code: "helper-unreachable" });
    expect(unreachable.calls.created).toHaveLength(1); // not hammered

    await expect(createGuest(fake({ createAccount: async () => ({ status: 429, text: "" }) }).env)).rejects.toMatchObject({ code: "helper-busy" });
    await expect(createGuest(fake({ createAccount: async () => ({ status: 500, text: "Too Many Requests" }) }).env)).rejects.toMatchObject({ code: "helper-busy" });

    const refused = createGuest(fake({ createAccount: async () => ({ status: 503, text: "maintenance" }) }).env);
    await expect(refused).rejects.toMatchObject({ code: "helper-failed" });
    await expect(refused).rejects.toThrow(/503 maintenance/);
  });
});

describe("guest account: submit_run", () => {
  it("sends submit_run with { seed, moves, score, ending } from the guest account", async () => {
    const { env, calls } = fake();
    const stages: string[] = [];
    const out = await submitRun(RUN, { env, onStage: (s) => stages.push(s) });
    expect(out).toEqual({ ok: true, txHash: "HASH", accountId: calls.created[0].accountId, accepted: true });
    expect(stages).toEqual(["guest", "sending"]);
    expect(calls.sent).toHaveLength(1);
    expect(calls.sent[0].method).toBe("submit_run");
    expect(calls.sent[0].args).toEqual({ seed: 123456, moves: "0n0.1r90.2m4000", score: 71, ending: "survived" });
    expect(Object.keys(calls.sent[0].args).sort()).toEqual(["ending", "moves", "score", "seed"]);
    expect(calls.sent[0].guest.accountId).toBe(calls.created[0].accountId);
  });

  it("reuses the stored guest: no second account for a second result", async () => {
    const { env, calls } = fake();
    await submitRun(RUN, { env }); await submitRun({ ...RUN, score: 80 }, { env });
    expect(calls.created).toHaveLength(1);
    expect(calls.sent).toHaveLength(2);
    expect(calls.sent[1].guest).toEqual(calls.sent[0].guest);
  });

  it("reports a claim that did not make the board (the contract returned false)", async () => {
    const { env } = fake({ call: async () => ok(false) }, OLD);
    expect(await submitRun(RUN, { env })).toEqual({ ok: true, txHash: "HASH", accountId: OLD.accountId, accepted: false });
  });

  it("refuses a result the contract could not take, before any network call", async () => {
    for (const bad of [{ ...RUN, seed: 0 }, { ...RUN, seed: 1.5 }, { ...RUN, score: 101 }, { ...RUN, score: -1 }, { ...RUN, moves: "" }, { ...RUN, moves: "<script>" }, { ...RUN, ending: "won" as never }]) {
      const { env, calls } = fake();
      const out = await submitRun(bad, { env });
      expect(out).toMatchObject({ ok: false, code: "bad-result" });
      expect(calls.created.length + calls.sent.length).toBe(0);
    }
    expect(() => submitArgs(RUN)).not.toThrow();
  });

  it("shows the contract's panic message when the transaction fails", async () => {
    const failure = { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: seed is not today's crisis" } } } };
    const { env } = fake({ call: async () => ({ txHash: "HASH", status: { Failure: failure } }) }, OLD);
    const out = await submitRun(RUN, { env });
    expect(out).toMatchObject({ ok: false, code: "contract", txHash: "HASH" });
    expect(out.ok === false && out.error).toContain("seed is not today's crisis");
    expect(out.ok === false && out.error).not.toContain("ActionError");
    // the same text when the RPC library throws it instead of returning it
    expect(sendError(new Error(`{"ExecutionError":"Smart contract panicked: seed is not today's crisis"}`)).message).toContain("seed is not today's crisis");
    expect(failureText({ ActionError: { kind: { AccountDoesNotExist: { account_id: "x" } } } })).toContain("AccountDoesNotExist");
  });

  it("maps RPC timeouts, an empty balance and other RPC errors to readable text", async () => {
    const cases: Array<[string, string]> = [
      ["sending the transaction timed out after 45s", "rpc-timeout"], ["TimeoutError: signal timed out", "rpc-timeout"], ["TIMEOUT_ERROR", "rpc-timeout"],
      ["InvalidTxError: NotEnoughBalance", "no-funds"], ["https://rpc HTTP 502", "rpc"],
    ];
    for (const [message, code] of cases) {
      const { env, calls } = fake({ call: async () => { throw new Error(message); } }, OLD);
      const out = await submitRun(RUN, { env });
      expect(out, message).toMatchObject({ ok: false, code });
      expect(out.ok === false && out.error.length).toBeGreaterThan(10);
      expect(calls.sent, "an RPC failure is not blindly re-sent").toHaveLength(1);
      expect(calls.created).toHaveLength(0);
    }
    expect(sendError(new GuestError("helper-busy")).code).toBe("helper-busy");
  });

  it("recreates a stored guest whose account no longer exists, once, and sends from the new one", async () => {
    let n = 0;
    const { env, calls, storage } = fake({ call: async () => { if (n++ === 0) throw new Error("account lemon-guest-0badc0de.testnet does not exist while viewing"); return ok(); } }, OLD);
    const stages: string[] = [];
    const out = await submitRun(RUN, { env, onStage: (s) => stages.push(s) });
    expect(out.ok).toBe(true);
    expect(calls.created).toHaveLength(1);
    expect(calls.sent.map((s) => s.guest.accountId)).toEqual([OLD.accountId, calls.created[0].accountId]);
    expect(JSON.parse(storage.m.get(GUEST_KEY)!).accountId).toBe(calls.created[0].accountId);
    expect(stages).toEqual(["guest", "sending", "guest", "sending"]);
  });

  it("does not recreate twice: a new account that the network does not see yet is an error, not a faucet loop", async () => {
    const { env, calls } = fake({ call: async () => { throw new Error("UNKNOWN_ACCOUNT"); } }, OLD);
    const out = await submitRun(RUN, { env });
    expect(out).toMatchObject({ ok: false, code: "not-ready" });
    expect(calls.created).toHaveLength(1);
    expect(calls.sent).toHaveLength(2);
  });

  it("surfaces a helper failure as the submit error and sends nothing", async () => {
    const { env, calls } = fake({ createAccount: async () => { throw new TypeError("Failed to fetch"); } });
    const out = await submitRun(RUN, { env });
    expect(out).toMatchObject({ ok: false, code: "helper-unreachable" });
    expect(calls.sent).toHaveLength(0);
  });
});
