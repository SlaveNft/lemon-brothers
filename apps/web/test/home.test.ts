import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BANK, POLICY_BOUNDS, runCurve } from "@chair/sim";
import { FAQ, PITCH, STEPS } from "../src/homeText";
import { leaveOrder, runView, zoneOf } from "../src/runView";
import { tabOf } from "../src/tabs";
import { span } from "../src/lang";

const all = [...PITCH.lead, ...PITCH.rest, ...STEPS.flatMap((s) => [...s.title, ...s.body]), ...FAQ.flatMap((x) => [...x.q, ...x.a])];

describe("the one landing page: its words", () => {
  it("is in two languages, and each text is in its own", () => {
    for (const pair of [PITCH.lead, PITCH.rest, ...STEPS.flatMap((s) => [s.title, s.body]), ...FAQ.flatMap((x) => [x.q, x.a])]) {
      expect(pair[0].trim().length).toBeGreaterThan(3);
      expect(pair[0]).not.toMatch(/[а-яё]/i);
      expect(pair[1]).toMatch(/[а-яё]/i);
    }
  });

  it("is about the coin first", () => {
    expect(PITCH.lead[0]).toMatch(/^\$LEMON is a memecoin/);
    expect(PITCH.lead[1]).toMatch(/^\$LEMON — мемкойн/);
  });

  it("says what happens in everyday Russian instead of translating \"bank run\"", () => {
    expect(PITCH.lead[1]).toMatch(/сгорает, когда в его банке паника/);
    expect(all.filter((_, i) => i % 2 === 1).join(" ")).not.toMatch(/набег/i);
  });

  it("speaks plainly: no jargon a newcomer would trip on", () => {
    expect(all.join(" ")).not.toMatch(/smart contract|NEP-|TEE|attest|epoch|permille|bps|DAO|смарт-контракт|эпох|аттест/i);
  });

  it("is short: three steps, and every answer fits a glance", () => {
    expect(STEPS).toHaveLength(3);
    for (const s of STEPS) for (const b of s.body) expect(b.length).toBeLessThan(230);
    for (const x of FAQ) for (const a of x.a) expect(a.length).toBeLessThan(330);
  });

  it("answers what a newcomer asks: do the coins exist, can they be bought, why are they free, what is real", () => {
    const q = FAQ.map((x) => x.q[0]).join(" | ");
    expect(q).toMatch(/already exist/);
    expect(q).toMatch(/where do I buy/);
    expect(q).toMatch(/why is it free/);
    expect(q).toMatch(/what is real/);
    const free = FAQ.find((x) => /why is it free/.test(x.q[0]))!;
    // the handout is new coins printed by the bank's program, not a gift from someone's pocket: say so
    expect(free.a[0]).toMatch(/program prints those coins/);
    expect(free.a[1]).toMatch(/программа банка печатает/);
    const buy = FAQ.find((x) => /where do I buy/.test(x.q[0]))!;
    expect(buy.a[0]).toMatch(/cannot be bought or sold/);
  });

  it("states the printing rules as the bank has them: a rescue prints a fifth of the debt, the chair 5% a day", () => {
    // a rescue is not held to the chair's 5%: the two limits are different rules and the card names both
    expect(Number(BANK.bailoutPermille)).toBe(200);
    expect(Number(POLICY_BOUNDS.mintEpochPermille)).toBe(50);
    const rescue = STEPS[2].body;
    expect(rescue[0]).toMatch(/a fifth of what the bank still owed/);
    expect(rescue[0]).toMatch(/Leo can add at most 5% a day/);
    expect(rescue[0]).toMatch(/ceiling/);
    expect(rescue[1]).toMatch(/пятую часть/);
    expect(rescue[1]).toMatch(/не больше 5% в день/);
    expect(rescue[1]).toMatch(/потолка/);
    // the example on the same screen agrees: the rescue after a fall prints a fifth of what was still owed
    const fall = runCurve().find((r) => r.fell)!;
    const owed = (fall.depositors - fall.paidInFull) * fall.owedEach;
    expect(fall.printed).toBe(Math.floor(owed / 5));
  });

  it("says a bank day in minutes when it is whole minutes", () => {
    expect(span(3300)).toMatch(/^55 (minutes|минут)$/);
    expect(span(30)).toMatch(/^30 (seconds|секунд)$/);
    expect(span(60)).toMatch(/^1 (minute|минута)$/);
  });

  it("cites in the README only transactions that `npm run verify:chain` fetches (evidence.json)", () => {
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    const listed = (JSON.parse(readFileSync(new URL("../src/chain/evidence.json", import.meta.url), "utf8")) as { items: Array<{ tx: string }> }).items.map((i) => i.tx);
    const full = [...readme.matchAll(/txns\/([1-9A-HJ-NP-Za-km-z]{43,44})/g)].map((m) => m[1]);
    const short = [...readme.matchAll(/`([1-9A-HJ-NP-Za-km-z]{8})…`/g)].map((m) => m[1]);
    expect(full.length + short.length).toBeGreaterThan(20);
    for (const tx of full) expect(listed, `README links ${tx}`).toContain(tx);
    for (const tx of short) expect(listed.some((t) => t.startsWith(tx)), `README cites ${tx}…`).toBe(true);
  });

  it("links the printer's limit to the refusal that is documented on chain", () => {
    const lock = FAQ.find((x) => x.link)!;
    const tx = lock.link!.href.split("/").pop()!;
    expect(tx).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(readFileSync(new URL("../../../docs/TESTNET.md", import.meta.url), "utf8")).toContain(tx);
  });
});

describe("the picture that follows the slider", () => {
  const curve = runCurve();
  const fallAt = curve.findIndex((r) => r.fell), firstBurn = curve.findIndex((r) => r.burned > 0);

  it("lets depositors leave one by one, each exactly once", () => {
    const order = leaveOrder(60);
    expect(new Set(order).size).toBe(60);
    expect(leaveOrder(60).slice(0, 10)).toEqual(order.slice(0, 10)); // the same people for the same number
  });

  it("shows as many gone as the slider says, and the bank shut only once it has fallen", () => {
    for (const n of [0, 5, firstBurn, fallAt - 1, fallAt, 60]) {
      const v = runView(curve[n], 0, "Leo");
      expect(v.agents).toHaveLength(60);
      expect(v.agents.filter((a) => a.deposit === 0)).toHaveLength(n);
      expect(v.collapsed).toBe(curve[n].fell);
      expect(v.supply).toBe(curve[n].supplyAfter);
      // the label over the vault is what burned that day: the same number as under the picture
      expect(v.history[0].supply - v.history[1].supply).toBe(curve[n].burned);
    }
  });

  it("goes from a calm room to a worried one to a panic, and the chair's words follow", () => {
    expect(zoneOf(curve[0])).toBe("vault");
    expect(zoneOf(curve[firstBurn])).toBe("sale");
    expect(zoneOf(curve[fallAt])).toBe("fall");
    const calm = runView(curve[0], 1, "Лео"), sale = runView(curve[firstBurn], 1, "Лео"), fall = runView(curve[fallAt], 1, "Лео");
    expect(calm.press[0].decision.tone).toBe("calm");
    expect(sale.press[0].decision.tone).toBe("cautious");
    expect(fall.press[0].decision.statement).toMatch(/Банк закрыт/);
    expect(calm.reservePermille).toBeGreaterThan(sale.reservePermille);
    expect(fall.reservePermille).toBe(0);
  });
});

describe("four screens, one thing on each", () => {
  it("opens the landing page by default and the named screen otherwise", () => {
    expect(tabOf("")).toBe("what");
    expect(tabOf("#play")).toBe("play");
    expect(tabOf("#coins")).toBe("coins");
    expect(tabOf("#bank")).toBe("bank");
    expect(tabOf("#nonsense")).toBe("what");
  });

  it("keeps older links working: each part lives on one screen", () => {
    expect(tabOf("#leaderboard")).toBe("play");
    expect(tabOf("#realbank")).toBe("coins");
    expect(tabOf("#testnet")).toBe("bank");
  });

  it("opens a result link on the game, since it is a game to replay", () => {
    expect(tabOf("", "?seed=7&moves=1n0")).toBe("play");
    expect(tabOf("#bank", "?seed=7")).toBe("bank");
  });
});
