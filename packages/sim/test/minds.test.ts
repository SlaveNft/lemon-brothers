import { describe, expect, it } from "vitest";
import { character, createWorld, depositorPrompt, fallbackChair, observe, parseMindMove, ruleMove, stepEpoch, valueOf, view, type MindMove } from "../src";

const move = (choice: MindMove["choice"], say = ""): MindMove => ({ choice, why: "test reason", say, model: "test-model", source: "model" });
const fingerprint = (w: ReturnType<typeof createWorld>) => JSON.stringify(view(w), (_k, v) => (typeof v === "bigint" ? String(v) : v));

describe("depositors with an outside mind", () => {
  it("without minds the town is exactly what it was: the rule decides and the seed fixes everything", () => {
    const a = createWorld(42, "hawk"), b = createWorld(42, "hawk");
    for (let i = 0; i < 12; i++) { stepEpoch(a); stepEpoch(b, [], undefined, "", [], new Map()); }
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.agents.every((x) => x.mind === undefined)).toBe(true);
  });

  it("a mind's move replaces the rule: a calm depositor told to run takes everything out", () => {
    const w = createWorld(42, "dove"), a = w.agents[5];
    expect(valueOf(w.bank, a.id)).toBeGreaterThan(0n);
    expect(a.panic).toBeLessThan(a.threshold); // its own rule would stay
    stepEpoch(w, [], undefined, "", [], new Map([[a.id, move("run")]]));
    expect(valueOf(w.bank, a.id)).toBe(0n);
    expect(a.ranAt).toBeGreaterThanOrEqual(0);
    expect(a.mind).toMatchObject({ choice: "run", source: "model", model: "test-model", why: "test reason" });
    expect(view(w).agents[5].mind?.choice).toBe("run");
    expect(view(w).agents[6].mind).toBeUndefined();
  });

  it("a move the depositor cannot make is a hold, and the record says what was wanted", () => {
    const w = createWorld(42, "dove"), a = w.agents[5];
    stepEpoch(w, [], undefined, "", [], new Map([[a.id, move("run")]]));
    stepEpoch(w, [], undefined, "", [], new Map([[a.id, move("run")]]));
    expect(a.mind?.choice).toBe("hold");
    expect(a.mind?.why).toMatch(/wanted to run, but has nothing left in the bank/);
  });

  it("the prompt shows what a depositor can see and nothing private to others", () => {
    const w = createWorld(42, "hawk"), chair = fallbackChair(observe(w), w.persona);
    const { system, user } = depositorPrompt(w, 5, chair);
    expect(system).toContain(w.agents[5].name);
    expect(system).toContain(character(w.agents[5]));
    expect(system).toMatch(/"choice":"hold"\|"run"\|"deposit"/);
    expect(user).toContain(`Your deposit: ${valueOf(w.bank, w.agents[5].id)} LEMON`);
    expect(user).toContain(chair.statement);
    // no other depositor's balance, threshold or panic number is in it
    expect(user).not.toMatch(/threshold|panic/i);
    for (const other of w.agents.filter((_, i) => i !== 5)) expect(user).not.toContain(`${valueOf(w.bank, other.id)} LEMON. Your wallet`);
  });

  it("reads a mind's answer strictly: one of three moves, short strings, nothing else trusted", () => {
    expect(parseMindMove('{"choice":"run","why":"vault is thin","say":"I am out."}')).toEqual({ choice: "run", why: "vault is thin", say: "I am out." });
    expect(parseMindMove('Sure! {"choice":"hold","why":"fine"} ')).toEqual({ choice: "hold", why: "fine", say: "" });
    expect(parseMindMove('{"choice":"print","why":"x"}')).toMatch(/not hold, run or deposit/);
    expect(parseMindMove("no json here")).toMatch(/no JSON/);
    expect(parseMindMove('{"choice":"run","why":' + JSON.stringify("x".repeat(500)) + "}")).toMatchObject({ choice: "run" });
    expect((parseMindMove('{"choice":"run","why":' + JSON.stringify("x".repeat(500)) + "}") as { why: string }).why.length).toBeLessThanOrEqual(200);
  });

  it("when the mind does not answer, the depositor's own rule decides and says so", () => {
    const w = createWorld(42, "dove");
    const m = ruleMove(w, 5, "some-model", "model unavailable");
    expect(m).toMatchObject({ source: "rule", model: "some-model", say: "" });
    expect(["hold", "run", "deposit"]).toContain(m.choice);
  });
});
