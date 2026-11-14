import { afterEach, describe, expect, it, vi } from "vitest";
import { answerOrder, parseAmount, tickPercent, trackRound } from "../src/logic";
import { chainStateProblem, asChainState } from "../src/chain/validate";
import { RemoteDriver } from "../src/driver";

describe("the amount field", () => {
  it("reads whole positive amounts and nothing else", () => {
    expect(parseAmount("500")).toBe(500);
    expect(parseAmount(" 90 ")).toBe(90);
    expect(parseAmount("007")).toBe(7);
    for (const bad of ["", " ", "0", "-5", "1.5", "1e3", "abc", "12a", "NaN", "Infinity", "9".repeat(13)]) expect(parseAmount(bad), bad).toBeNull();
  });
});

describe("round score", () => {
  const at = (round: number, roundsFallen = 0, seed = 1) => ({ seed, round, roundsFallen });
  it("keeps the mark within a round and reports the finished round when it changes", () => {
    let t = trackRound(null, null, at(0), 1000);
    expect(t).toEqual({ mark: { seed: 1, round: 0, net: 1000, fallen: 0 }, last: null });
    t = trackRound(t.mark, t.last, at(0), 1040);
    expect(t.mark.net).toBe(1000);
    expect(t.last).toBeNull();
    // fast-forward to the end of the round: the result of round 0 is still there in round 1
    t = trackRound(t.mark, t.last, at(1), 1085);
    expect(t.last).toEqual({ rounds: 1, score: 85, fell: 0 });
    expect(t.mark).toEqual({ seed: 1, round: 1, net: 1085, fallen: 0 });
    t = trackRound(t.mark, t.last, at(1), 1090);
    expect(t.last).toEqual({ rounds: 1, score: 85, fell: 0 });
  });
  it("says when the bank fell, and counts a jump over several rounds", () => {
    const start = trackRound(null, null, at(2, 1), 900);
    expect(trackRound(start.mark, null, at(3, 2), 400).last).toEqual({ rounds: 1, score: -500, fell: 1 });
    expect(trackRound(start.mark, null, at(5, 3), 950).last).toEqual({ rounds: 3, score: 50, fell: 2 });
  });
  it("a new town (another seed, or a round that went back) starts clean", () => {
    const start = trackRound(null, null, at(4, 1), 900);
    expect(trackRound(start.mark, { rounds: 1, score: 5, fell: 0 }, at(0, 0), 1000)).toEqual({ mark: { seed: 1, round: 0, net: 1000, fallen: 0 }, last: null });
    expect(trackRound(start.mark, { rounds: 1, score: 5, fell: 0 }, at(4, 1, 2), 1000).last).toBeNull();
  });
});

describe("the tick bar", () => {
  it("uses the real epoch length", () => {
    expect(tickPercent(15_000, 30_000)).toBe(50);
    expect(tickPercent(1_500, 3_000)).toBe(50);
    expect(tickPercent(0, 10_000)).toBe(100);
    expect(tickPercent(-200, 10_000)).toBe(100);
    expect(tickPercent(20_000, 10_000)).toBe(0);
    expect(tickPercent(null, 10_000)).toBeNull();
    expect(tickPercent(500, null)).toBeNull();
    expect(tickPercent(500, 0)).toBeNull();
  });
});

describe("get_state shape", () => {
  const good = {
    supply: "1000", reserve: "200", loans: "800", liabilities: "900", total_shares: "1", index: "1", reserve_permille: "222",
    collapsed: false, epoch: 1, round: 0, epoch_id: 1,
    policy: { rate: "40", target: "200", mint: "0", gate: "0", tone: "calm", statement: "", attestation: "" },
    policy_set_epoch_id: 0, minted_this_round: "0", round_start_supply: "1000", outflow: "0", chair: "c.testnet", owner: "o.testnet",
    speeches: [{ who: "a", text: "hi" }], rumors: [{ who: "a", kind: "vault_empty" }], epoch_ms: 30000, next_epoch_ms: 1, chair_signer: null, chair_model: "", chair_prompt_sha256: null, accounts: 3,
  };
  it("accepts the bank's own state", () => {
    expect(chainStateProblem(good)).toBeNull();
    expect(asChainState(good)).toBe(good);
  });
  it("names what is wrong with anything else, without throwing while checking", () => {
    const broken: unknown[] = [
      null, undefined, "x", 5, [], {}, { ...good, policy: null }, { ...good, policy: undefined }, { ...good, policy: { ...good.policy, tone: 5 } },
      { ...good, speeches: null }, { ...good, speeches: [null] }, { ...good, speeches: [{ who: 1, text: "x" }] }, { ...good, rumors: "none" }, { ...good, rumors: [{ who: "a" }] },
      { ...good, reserve: {} }, { ...good, supply: "-1" }, { ...good, liabilities: "1e9" }, { ...good, chair: undefined }, { ...good, owner: { id: "x" } },
      { ...good, collapsed: "no" }, { ...good, round: "0" }, { ...good, next_epoch_ms: null }, { ...good, chair_signer: 5 }, { ...good, policy: { ...good.policy, rate: null } },
    ];
    for (const b of broken) {
      expect(typeof chainStateProblem(b), JSON.stringify(b)?.slice(0, 80)).toBe("string");
      expect(() => asChainState(b)).toThrow(/not a Lemon Brothers bank/);
    }
  });
});

describe("the runner driver never throws on a bad answer", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (body: string, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

  it("non-JSON, an empty body and a network error become messages", async () => {
    const d = new RemoteDriver();
    answer("<html>502 Bad Gateway</html>", 502);
    expect(await d.act("p", { t: "withdrawAll" })).toMatch(/502/);
    expect(await d.join("p")).toMatch(/502/);
    expect(await d.ff(3)).toMatch(/502/);
    expect(await d.impeach("p", "hawk")).toMatch(/502/);
    answer("", 200);
    expect(await d.ff(1)).toMatch(/without JSON/);
    answer("[1,2]", 200);
    expect(await d.ff(1)).toMatch(/without JSON/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await d.act("p", { t: "withdrawAll" })).toMatch(/not answering/);
    expect(await d.join("p")).toMatch(/not answering/);
  });

  it("passes the runner's own errors through, including the 409 of a busy fast-forward", async () => {
    const d = new RemoteDriver();
    answer(JSON.stringify({ error: "an epoch is running, try again" }), 409);
    expect(await d.ff(5)).toBe("an epoch is running, try again");
    answer(JSON.stringify({ ok: true, epochs: 5 }));
    expect(await d.ff(5)).toBeNull();
    answer(JSON.stringify({ ok: true }), 500);
    expect(await d.ff(5)).toMatch(/500/);
    answer(JSON.stringify({ passed: true, yes: 10, no: 2, turnout: 0.5 }));
    expect(await d.impeach("p", "hawk")).toEqual({ passed: true, yes: 10, no: 2, turnout: 0.5 });
    answer(JSON.stringify({ ok: true }));
    expect(typeof (await d.impeach("p", "hawk"))).toBe("string");
  });

  it("joins again and repeats the action when a restarted runner says 'join first'", async () => {
    const calls: string[] = [];
    let joined = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/api/join") { joined = true; return new Response(JSON.stringify({ ok: true, error: null })); }
      return joined ? new Response(JSON.stringify({ ok: true, error: null })) : new Response(JSON.stringify({ error: "join first" }), { status: 400 });
    }));
    expect(await new RemoteDriver().act("p", { t: "deposit", amount: 5 })).toBeNull();
    expect(calls).toEqual(["/api/act", "/api/join", "/api/act"]);
  });

  it("state() refuses something that is not a town", async () => {
    answer(JSON.stringify({ hello: "world" }));
    await expect(new RemoteDriver().state()).rejects.toThrow(/not a town/);
    answer("<html>", 200);
    await expect(new RemoteDriver().state()).rejects.toThrow();
  });
});

describe("the order answers are shown in", () => {
  it("is a permutation of the three answers for every crisis and day", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed <= 3000; seed++) for (let day = 0; day < 10; day++) {
      const o = answerOrder(seed, day);
      expect(o, `seed ${seed} day ${day}`).toBeDefined();
      expect([...o].sort()).toEqual([0, 1, 2]);
      seen.add(o.join(""));
    }
    expect(answerOrder(999_999, 9)).toHaveLength(3);
    expect(answerOrder(2 ** 31, 3)).toHaveLength(3);
    // all six orders turn up: no position is "always the reckless one"
    expect(seen.size).toBe(6);
    expect(answerOrder(31, 4)).toEqual(answerOrder(31, 4));
  });
});
