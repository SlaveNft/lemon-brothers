import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAS, GUEST_KEY, HEAVY_GAS, SUBMIT_GAS, WAIT_UNTIL, callBank, gasFor, isSettled, submitRun, successValue,
  type Guest, type GuestEnv, type GuestNet,
} from "../src/chain/guest";
import {
  DEFAULT_DEPOSIT, GUEST_STORAGE_KEY, INSURE_PREMIUM, MAX_SPEECH_BYTES, RUMOR_KINDS,
  amountArg, bankArgs, bankView, byteLength, fmtLemon, lemon, secondsToEpoch, speechArg, storedGuestId, waitText,
} from "../src/chain/bankView";

const TGAS = 1_000_000_000_000n;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const GUEST: Guest = { accountId: "lemon-guest-0badc0de.testnet", secretKey: "ed25519:oldsecret" };

interface Sent { guest: Guest; method: string; args: object; gas?: bigint }
/** A fake network and environment: every call is recorded, nothing leaves the process. */
function fake(opts: { stored?: Guest | null; call?: (n: number) => { txHash: string; status: unknown } } = {}) {
  const sent: Sent[] = [], created: string[] = [];
  const m = new Map<string, string>(opts.stored === null ? [] : [[GUEST_KEY, JSON.stringify(opts.stored ?? GUEST)]]);
  let n = 0;
  const net: GuestNet = {
    createAccount: async (accountId) => { created.push(accountId); return { status: 200, text: "" }; },
    accountExists: async () => true,
    call: async (guest, method, args, gas) => { sent.push({ guest, method, args, gas }); return opts.call ? opts.call(sent.length) : { txHash: "HASH", status: { SuccessValue: "" } }; },
  };
  const env: GuestEnv = {
    net,
    storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) },
    newKey: () => ({ secretKey: `ed25519:secret${n}`, publicKey: `ed25519:public${n}` }),
    suffix: () => (0xabc00000 + n++).toString(16),
    sleep: async () => {},
  };
  return { env, sent, created, m };
}

describe("callBank: what is sent", () => {
  it("sends each public method with the exact JSON arguments the contract declares, from the guest account", async () => {
    const cases: Array<[string, object, object]> = [
      ["airdrop", bankArgs.airdrop(), {}],
      ["deposit", bankArgs.deposit("500"), { amount: "500" }],
      ["withdraw", bankArgs.withdraw("120"), { amount: "120" }],
      ["withdraw_all", bankArgs.withdraw_all(), {}],
      ["lobby", bankArgs.lobby("Lower the rate, the shops are closing"), { text: "Lower the rate, the shops are closing" }],
      ["rumor", bankArgs.rumor("vault_empty"), { kind: "vault_empty" }],
      ["insure", bankArgs.insure("50"), { premium: "50" }],
      ["advance_epoch", bankArgs.advance_epoch(), {}],
    ];
    for (const [method, args, expected] of cases) {
      const { env, sent, created } = fake();
      const out = await callBank(method, args, { env });
      expect(out, method).toEqual({ ok: true, txHash: "HASH", accountId: GUEST.accountId });
      expect(sent, method).toHaveLength(1);
      expect(sent[0].method).toBe(method);
      expect(sent[0].args, method).toEqual(expected);
      expect(JSON.stringify(sent[0].args), method).toBe(JSON.stringify(expected)); // no extra keys, amounts as strings
      expect(sent[0].guest).toEqual(GUEST);
      expect(created, "the stored guest is reused").toHaveLength(0);
    }
  });

  it("attaches 30 Tgas, and 100 Tgas to the two calls that may settle everyone", async () => {
    expect(DEFAULT_GAS).toBe(30n * TGAS);
    expect(SUBMIT_GAS).toBe(30n * TGAS);
    expect(HEAVY_GAS).toBe(100n * TGAS);
    const want: Record<string, bigint> = {
      airdrop: 30n * TGAS, deposit: 30n * TGAS, withdraw: 30n * TGAS, lobby: 30n * TGAS, rumor: 30n * TGAS, insure: 30n * TGAS, submit_run: 30n * TGAS,
      withdraw_all: 100n * TGAS, advance_epoch: 100n * TGAS,
    };
    for (const [method, gas] of Object.entries(want)) {
      expect(gasFor(method), method).toBe(gas);
      const { env, sent } = fake();
      await callBank(method, {}, { env });
      expect(sent[0].gas, method).toBe(gas);
    }
    const { env, sent } = fake();
    await callBank("deposit", { amount: "1" }, { env, gas: 55n * TGAS });
    expect(sent[0].gas).toBe(55n * TGAS);
  });

  it("waits for the call to execute, not for finality", () => {
    expect(WAIT_UNTIL).toBe("EXECUTED_OPTIMISTIC");
  });

  it("the rumour kinds, the default deposit and the premium are the contract's", () => {
    expect([...RUMOR_KINDS]).toEqual(["vault_empty", "chair_resigning", "bailout_coming"]);
    expect(bankArgs.deposit(DEFAULT_DEPOSIT)).toEqual({ amount: "500" });
    expect(bankArgs.insure(INSURE_PREMIUM)).toEqual({ premium: "50" });
    expect(MAX_SPEECH_BYTES).toBe(280);
  });

  it("reports stages and creates the guest through the faucet when there is none", async () => {
    const { env, sent, created, m } = fake({ stored: null });
    const stages: string[] = [];
    const out = await callBank("airdrop", {}, { env, onStage: (s) => stages.push(s) });
    expect(out).toMatchObject({ ok: true, txHash: "HASH" });
    expect(created).toHaveLength(1);
    expect(out.ok && out.accountId).toBe(created[0]);
    expect(sent[0].guest.accountId).toBe(created[0]);
    expect(JSON.parse(m.get(GUEST_KEY)!).accountId).toBe(created[0]);
    expect(stages).toEqual(["guest", "sending"]);
  });
});

describe("callBank: what comes back", () => {
  it("parses the SuccessValue as JSON", async () => {
    for (const v of [true, false, 0, 42, "ok", "слово", { a: [1, "2"] }, null]) {
      const { env } = fake({ call: () => ({ txHash: "HASH", status: { SuccessValue: b64(v) } }) });
      const out = await callBank("deposit", { amount: "1" }, { env });
      expect(out, JSON.stringify(v)).toEqual({ ok: true, txHash: "HASH", accountId: GUEST.accountId, value: v });
    }
    expect(successValue(b64({ n: "1" }))).toEqual({ n: "1" });
  });

  it("has no value when the method returned nothing or something that is not JSON", async () => {
    for (const status of [{ SuccessValue: "" }, { SuccessValue: "!!!not base64" }, { SuccessValue: Buffer.from("not json").toString("base64") }, { SuccessValue: 5 }, {}, null]) {
      const { env } = fake({ call: () => ({ txHash: "HASH", status }) });
      const out = await callBank("airdrop", {}, { env });
      expect(out, JSON.stringify(status)).toEqual({ ok: true, txHash: "HASH", accountId: GUEST.accountId });
      expect("value" in out).toBe(false);
    }
    expect(successValue(undefined)).toBeUndefined();
    expect(successValue("")).toBeUndefined();
  });

  it("turns a refusal into the contract's own words, with the transaction", async () => {
    const panics = ["airdrop already claimed", "not enough LEMON in wallet", "bank is closed until the bailout", "epoch has not elapsed yet",
      "at most 2 speeches per account per epoch", "gate: withdrawal limit for this epoch reached", "too late in the round to insure", "no deposit"];
    for (const text of panics) {
      const failure = { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${text}` } } } };
      const { env, sent } = fake({ call: () => ({ txHash: "TX1", status: { Failure: failure } }) });
      const out = await callBank("deposit", { amount: "500" }, { env });
      expect(out).toMatchObject({ ok: false, code: "contract", txHash: "TX1" });
      expect(out.ok === false && out.error, text).toBe(`The contract refused: ${text}`);
      expect(sent, "a refused call is not sent again").toHaveLength(1);
    }
  });

  it("maps a panic the RPC library throws, a timeout, an empty balance and other RPC errors", async () => {
    const cases: Array<[string, string, RegExp]> = [
      [`{"ExecutionError":"Smart contract panicked: unknown rumour"}`, "contract", /unknown rumour/],
      ["sending the transaction timed out after 45s", "rpc-timeout", /did not answer in time/],
      ["InvalidTxError: NotEnoughBalance", "no-funds", /run out of testnet NEAR/],
      ["https://rpc HTTP 502", "rpc", /HTTP 502/],
    ];
    for (const [message, code, text] of cases) {
      const { env, sent, created } = fake({ call: () => { throw new Error(message); } });
      const out = await callBank("rumor", { kind: "nonsense" }, { env });
      expect(out, message).toMatchObject({ ok: false, code });
      expect(out.ok === false && out.error).toMatch(text);
      expect(out.ok === false && "txHash" in out).toBe(false);
      expect(sent).toHaveLength(1);
      expect(created).toHaveLength(0);
    }
  });

  it("replaces a stored guest whose account is gone, once (the default)", async () => {
    const { env, sent, created, m } = fake({ call: (n) => { if (n === 1) throw new Error("account lemon-guest-0badc0de.testnet does not exist while viewing"); return { txHash: "HASH", status: { SuccessValue: "" } }; } });
    const out = await callBank("airdrop", {}, { env });
    expect(out).toEqual({ ok: true, txHash: "HASH", accountId: created[0] });
    expect(sent.map((s) => s.guest.accountId)).toEqual([GUEST.accountId, created[0]]);
    expect(JSON.parse(m.get(GUEST_KEY)!).accountId).toBe(created[0]);
  });

  it("with create: false makes no account: a missing or vanished guest is the error 'gone'", async () => {
    const none = fake({ stored: null });
    const a = await callBank("deposit", { amount: "500" }, { env: none.env, create: false });
    expect(a).toMatchObject({ ok: false, code: "gone" });
    expect(a.ok === false && a.error.length).toBeGreaterThan(20);
    expect(none.created.length + none.sent.length).toBe(0);

    const vanished = fake({ call: () => { throw new Error("UNKNOWN_ACCOUNT"); } });
    const b = await callBank("deposit", { amount: "500" }, { env: vanished.env, create: false });
    expect(b).toMatchObject({ ok: false, code: "gone" });
    expect(vanished.created).toHaveLength(0);
    expect(vanished.sent).toHaveLength(1);
    expect(vanished.m.has(GUEST_KEY), "the stored guest is left for the block to show").toBe(true);
  });

  it("tells an outcome from a transaction that has not run yet", () => {
    expect(isSettled({ SuccessValue: "" })).toBe(true);
    expect(isSettled({ Failure: { ActionError: {} } })).toBe(true);
    for (const s of [null, undefined, "Started", "NotStarted", { Unknown: null }, {}, 1]) expect(isSettled(s), JSON.stringify(s)).toBe(false);
  });

  it("submitRun goes through the same path: submit_run, 30 Tgas, an explicit false means 'not on the board'", async () => {
    const run = { seed: 123456, moves: "0n0.1r90.2m4000", score: 71, ending: "survived" as const };
    const yes = fake({ call: () => ({ txHash: "HASH", status: { SuccessValue: b64(true) } }) });
    expect(await submitRun(run, { env: yes.env })).toEqual({ ok: true, txHash: "HASH", accountId: GUEST.accountId, accepted: true });
    expect(yes.sent[0]).toMatchObject({ method: "submit_run", args: run, gas: 30n * TGAS });
    const no = fake({ call: () => ({ txHash: "HASH", status: { SuccessValue: b64(false) } }) });
    expect(await submitRun(run, { env: no.env })).toEqual({ ok: true, txHash: "HASH", accountId: GUEST.accountId, accepted: false });
    const empty = fake();
    expect(await submitRun(run, { env: empty.env })).toMatchObject({ ok: true, accepted: true });
  });
});

describe("the block's view model", () => {
  const NOW = 1_800_000_000_000;
  const STATE = { collapsed: false, epoch_ms: 60_000, next_epoch_ms: NOW + 42_000 };
  const ACCOUNT = { wallet: "480", shares: "500000000000000", deposit_value: "503", insured: "50", airdropped: true };

  it("reads the balances get_account returns", () => {
    const v = bankView(ACCOUNT, STATE, NOW);
    expect(v).toEqual({ registered: true, wallet: 480n, deposit: 503n, insured: 50n, airdropAvailable: false, empty: false, stateKnown: true, epochDue: false, epochInSec: 42, collapsed: false, earlyFee: false });
  });

  it("warns about the early-withdrawal fee when the contract says it applies", () => {
    expect(bankView({ ...ACCOUNT, early_fee_now: true }, STATE, NOW).earlyFee).toBe(true);
    expect(bankView({ ...ACCOUNT, early_fee_now: "true" }, STATE, NOW).earlyFee).toBe(false);
  });

  it("writes long waits in minutes and hours", () => {
    expect(waitText(42, false)).toBe("42 s");
    expect(waitText(3300, true)).toBe("55 мин");
    expect(waitText(3900, false)).toBe("1 h 5 min");
  });

  it("offers the airdrop when the bank has no record of the account, or the record never claimed it", () => {
    const none = bankView(null, STATE, NOW);
    expect(none).toMatchObject({ registered: false, wallet: 0n, deposit: 0n, insured: 0n, airdropAvailable: true, empty: true });
    // registered by storage_deposit or by a transfer, never airdropped
    expect(bankView({ ...ACCOUNT, wallet: "7", airdropped: false }, STATE, NOW)).toMatchObject({ registered: true, wallet: 7n, airdropAvailable: true, empty: false });
    // an answer without the flag: the contract decides, the button is offered
    expect(bankView({ wallet: "0" }, STATE, NOW).airdropAvailable).toBe(true);
    expect(bankView({ ...ACCOUNT, airdropped: "yes" }, STATE, NOW).airdropAvailable).toBe(true);
    expect(bankView(ACCOUNT, STATE, NOW).airdropAvailable).toBe(false);
  });

  it("reads missing and odd fields as zero instead of failing", () => {
    for (const odd of [undefined, "not an account", 5, [], [ACCOUNT], true]) {
      expect(bankView(odd, STATE, NOW), JSON.stringify(odd)).toMatchObject({ registered: false, wallet: 0n, deposit: 0n, insured: 0n, airdropAvailable: true, empty: true });
    }
    const v = bankView({ wallet: 1000, deposit_value: "-5", insured: "1e3", shares: null, airdropped: true }, STATE, NOW);
    expect(v).toMatchObject({ registered: true, wallet: 1000n, deposit: 0n, insured: 0n, airdropAvailable: false });
    expect(bankView({ wallet: 12.9, deposit_value: NaN, insured: Infinity }, STATE, NOW)).toMatchObject({ wallet: 12n, deposit: 0n, insured: 0n });
    expect(bankView({ wallet: "340282366920938463463374607431768211455", deposit_value: " 5", insured: "" }, STATE, NOW)).toMatchObject({ wallet: (1n << 128n) - 1n, deposit: 0n, insured: 0n });
    expect(lemon("0012")).toBe(12n);
    expect(lemon({})).toBe(0n);
    expect(lemon(-1)).toBe(0n);
  });

  it("knows when advance_epoch is due", () => {
    expect(bankView(ACCOUNT, { ...STATE, next_epoch_ms: NOW + 1 }, NOW)).toMatchObject({ epochDue: false, epochInSec: 1, stateKnown: true });
    expect(bankView(ACCOUNT, { ...STATE, next_epoch_ms: NOW }, NOW)).toMatchObject({ epochDue: true, epochInSec: 0 });
    expect(bankView(ACCOUNT, { ...STATE, next_epoch_ms: NOW - 3_600_000 }, NOW)).toMatchObject({ epochDue: true, epochInSec: 0 });
    expect(bankView(null, { ...STATE, next_epoch_ms: NOW - 1 }, NOW).epochDue, "anyone can, with or without LEMON").toBe(true);
    expect(secondsToEpoch(NOW + 59_001, NOW)).toBe(60);
    expect(secondsToEpoch(NOW + 60_000, NOW)).toBe(60);
  });

  it("does not call the epoch due when the bank's clock is missing or odd", () => {
    for (const state of [null, undefined, "x", [], {}, { next_epoch_ms: "1800000000000" }, { next_epoch_ms: NaN }, { next_epoch_ms: 0 }, { next_epoch_ms: -5 }, { next_epoch_ms: null }]) {
      expect(bankView(ACCOUNT, state, NOW), JSON.stringify(state)).toMatchObject({ stateKnown: false, epochDue: false, epochInSec: null, collapsed: false });
    }
    expect(secondsToEpoch(NOW, NaN)).toBeNull();
    expect(bankView(ACCOUNT, { ...STATE, collapsed: true }, NOW).collapsed).toBe(true);
    expect(bankView(ACCOUNT, { ...STATE, collapsed: "true" }, NOW).collapsed).toBe(false);
  });

  it("formats any u128", () => {
    expect(fmtLemon(0n)).toBe("0");
    expect(fmtLemon(999n)).toBe("999");
    expect(fmtLemon(1000n)).toBe("1,000");
    expect(fmtLemon(1234567n)).toBe("1,234,567");
    expect(fmtLemon((1n << 128n) - 1n)).toBe("340,282,366,920,938,463,463,374,607,431,768,211,455");
  });
});

describe("the block's inputs", () => {
  it("turns a typed amount into the contract's U128 string, or refuses it", () => {
    expect(amountArg("500")).toBe("500");
    expect(amountArg(" 1 000 ")).toBe("1000");
    expect(amountArg("1,000")).toBe("1000");
    expect(amountArg("007")).toBe("7");
    expect(amountArg("340282366920938463463374607431768211455")).toBe("340282366920938463463374607431768211455");
    for (const bad of ["", "0", "000", "-5", "1.5", "1e3", "abc", "५००", "340282366920938463463374607431768211456", "9".repeat(40)]) expect(amountArg(bad), bad).toBeNull();
  });

  it("counts a speech in bytes, as the contract does", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("банк")).toBe(8);
    expect(speechArg("  Lower the rate  ")).toBe("Lower the rate");
    expect(speechArg("")).toBeNull();
    expect(speechArg("   ")).toBeNull();
    expect(speechArg("a".repeat(280))).toHaveLength(280);
    expect(speechArg("a".repeat(281))).toBeNull();
    expect(speechArg("я".repeat(140))).toHaveLength(140); // 280 bytes
    expect(speechArg("я".repeat(141))).toBeNull(); // 282 bytes
  });

  it("finds the guest account the 'put my result on chain' flow stored, under the same key", () => {
    expect(GUEST_STORAGE_KEY).toBe(GUEST_KEY);
    const store = (v: string | null) => ({ getItem: (k: string) => (k === GUEST_KEY ? v : null) });
    expect(storedGuestId(store(JSON.stringify(GUEST)))).toBe(GUEST.accountId);
    for (const bad of [null, "", "{", "null", "[]", JSON.stringify({ accountId: "someone.testnet", secretKey: "ed25519:x" }), JSON.stringify({ accountId: GUEST.accountId }), JSON.stringify({ accountId: 5, secretKey: "ed25519:x" })]) {
      expect(storedGuestId(store(bad)), String(bad)).toBeNull();
    }
    expect(storedGuestId(null)).toBeNull();
    expect(storedGuestId({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
  });
});
