import { describe, expect, it } from "vitest";
import { airdrop, createWorld, createAgents, playRound, speechEffect, speechStance, valueOf, Rng, type PlayerAction, type World } from "../src";

describe("the town hears players' speeches", () => {
  it("reads the stance in English and Russian; 'don't panic' is calming", () => {
    expect(speechStance("Stay calm. My savings stay here.")).toBe("calm");
    expect(speechStance("Don't panic, the vault is fine")).toBe("calm");
    expect(speechStance("Get out while you can. Withdraw everything.")).toBe("alarm");
    expect(speechStance("Спокойно, мои деньги здесь")).toBe("calm");
    expect(speechStance("Забирайте деньги, пока не поздно")).toBe("alarm");
    expect(speechStance("Set the rate to 60 please")).toBeNull();
  });

  it("words weigh as much as the money behind them; insurance makes calm words backfire", () => {
    const [a] = createAgents(new Rng(1));
    const none = speechEffect({ who: "p", stance: "calm", stake: 0, insured: false }, a).delta;
    const half = speechEffect({ who: "p", stance: "calm", stake: 500, insured: false }, a).delta;
    const full = speechEffect({ who: "p", stance: "calm", stake: 1000, insured: false }, a).delta;
    const more = speechEffect({ who: "p", stance: "calm", stake: 50_000, insured: false }, a).delta;
    expect(Math.abs(none)).toBe(0);
    expect(half).toBeLessThan(0);
    expect(full).toBeLessThan(half);
    expect(more).toBe(full); // a whale is believed no more than a full stake
    expect(speechEffect({ who: "p", stance: "calm", stake: 1000, insured: true }, a).delta).toBeGreaterThan(0);
  });

  it("a defender with money in the bank makes collapses rarer; talk without a stake does not", () => {
    const CALM = "Stay calm. I keep my savings in Lemon Brothers.";
    const worried = (w: World) => w.lastOutflowPermille > 20 || w.lastWritedownPermille > 0;
    const run = (act: (w: World) => PlayerAction[], stake: boolean) => {
      let fell = 0;
      for (let seed = 1; seed <= 80; seed++) {
        const w = createWorld(seed, "dove", ["p"]);
        airdrop(w.bank, "p");
        if (!playRound(w, (x) => [...(stake && x.bank.epoch === 0 && valueOf(x.bank, "p") === 0n ? [{ t: "deposit", who: "p", amount: 900 } as PlayerAction] : []), ...act(x)])) fell++;
      }
      return fell;
    };
    const talk = (w: World): PlayerAction[] => (worried(w) ? [{ t: "lobby", who: "p", text: CALM }] : []);
    const base = run(() => [], false), noStake = run(talk, false), defended = run(talk, true);
    expect(noStake).toBe(base);
    expect(defended).toBeLessThan(base * 0.75);
  });
});
