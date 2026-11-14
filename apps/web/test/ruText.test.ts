import { describe, expect, it } from "vitest";
import { airdrop, createWorld, stepEpoch, view, PERSONAS, RUMORS, type Persona, type PlayerAction } from "@chair/sim";
import { toRu, ruText } from "../src/ruText";

const CYRILLIC = /[а-яё]/i;
/** English words that must not survive in a translated engine line. */
const LEFTOVER = /\b(withdrew|deposited|lobbied|rumour|insured|wrote|Bailout|Round|COLLAPSE|chair|friends?|ran|says|vault|rate|gate|panic|time|money|people|reserve|epoch|Speech|Outflow|Deposits|board)\b/;

describe("Russian for the engine's English text", () => {
  it("translates every fixed reason from agents.ts and crisis.ts", () => {
    const table: Array<[string, string]> = [
      ["time passes", "время идёт"],
      ["my money is safe at home", "мои деньги дома, в безопасности"],
      ["the news and the neighbours", "новости и соседи"],
      ["chair sounded calm", "председатель звучал спокойно"],
      ["chair sounded alarming", "председатель звучал тревожно"],
      ["rate hiked: why so desperate?", "ставку подняли: к чему такое отчаяние?"],
      ["withdrawal gate switched on", "включили лимит снятия"],
      ["withdrawal gate still on", "лимит снятия всё ещё действует"],
      ["money printing: inflation", "печатают деньги: инфляция"],
      ["emergency cash in the vault", "в хранилище завезли экстренные деньги"],
      ["reserve target raised", "цель резерва повышена"],
      ["people withdrew last epoch", "в прошлую эпоху люди снимали деньги"],
      ["1 friend ran", "1 друг сбежал"],
      ["3 friends ran", "3 друга сбежали"],
      ["5 friends ran", "5 друзей сбежали"],
      ["friends ran", "друзья сбежали"],
      ["Lemon Brothers wrote off 4.2% of its loans", "Lemon Brothers списал 4.2% кредитов"],
      ["vault below 10%", "в хранилище меньше 10%"],
      ["heard a rumour", "услышал слух"],
      ["another rumour", "ещё один слух"],
      ["player-ab12 insured against the bank but says stay", "player-ab12 застрахован против банка, а говорит «оставайтесь»"],
      ["player-ab12 (900 LEMON in the bank) says stay calm", "player-ab12 (900 LEMON в банке) призывает к спокойствию"],
      ["player-ab12 (1,200 LEMON in the bank) says get out", "player-ab12 (1,200 LEMON в банке) призывает уходить"],
      ["player-ab12 (no money in the bank) says get out", "player-ab12 (без денег в банке) призывает уходить"],
      ["the chair promised: no money printing", "председатель пообещал: не печатать деньги"],
      ["the chair promised: no limits on withdrawals", "председатель пообещал: не ограничивать снятие"],
      ["the chair broke its promise: no more loan losses", "председатель нарушил обещание: списаний больше не будет"],
      ["the chair broke its promise: no rate cuts", "председатель нарушил обещание: не снижать ставку"],
      ["the chair dodged the question", "председатель ушёл от ответа"],
      ["the chair tried to go past the contract's limits", "председатель пытался выйти за лимиты контракта"],
      ["the chair's numbers check out on chain", "цифры председателя сходятся с контрактом"],
      ["Grapefruit & Co next door closed its doors", "соседний банк «Грейпфрут и Ко» закрылся"],
      ["a big depositor left with suitcases", "крупный вкладчик ушёл с чемоданами"],
    ];
    for (const [en, ru] of table) expect(toRu(en), en).toBe(ru);
  });

  it("translates the feed lines from view.ts", () => {
    expect(toRu("agent-07 withdrew 777")).toBe("agent-07 снимает 777");
    expect(toRu("agent-07 withdrew 777 (fire sale, 12 lost)")).toBe("agent-07 снимает 777 (срочная распродажа кредитов, потеряно 12)");
    expect(toRu("agent-07 deposited 500")).toBe("agent-07 вносит 500");
    expect(toRu("COLLAPSE: agent-07's withdrawal broke the bank (assets 10 vs owed 20)")).toBe("КРАХ: снятие agent-07 обрушило банк (активы 10 против долга 20)");
    expect(toRu("p cashed insurance: 300")).toBe("p получает страховку: 300");
    expect(toRu('p lobbied: "Stay calm."')).toBe("p выступает: «Stay calm.»");
    expect(toRu("p spread a rumour: vault empty")).toBe("p пускает слух: хранилище пустое");
    expect(toRu("p insured against collapse: 100")).toBe("p страхуется от краха: 100");
    expect(toRu("Lemon Brothers wrote off 4.2% of its loans (1234)")).toBe("Lemon Brothers списал 4.2% кредитов (1234)");
    expect(toRu("Bailout: 5000 LEMON printed, the bank reopens")).toBe("Спасение: напечатано 5000 LEMON, банк снова открыт");
    expect(toRu("Round over: the bank survived")).toBe("Раунд окончен: банк выстоял");
    expect(toRu("Round opens: 54 savers deposited 123456")).toBe("Раунд открыт: 54 вкладчика внесли 123456");
    expect(toRu("Round opens: 1 saver deposited 10")).toBe("Раунд открыт: 1 вкладчик внёс 10");
  });

  it("translates the chair line, with the reasons kept as they came", () => {
    expect(toRu("browser simulation, deterministic chair")).toBe("симуляция в браузере, детерминированный председатель");
    expect(toRu("fallback (no NEAR_AI_API_KEY)")).toBe("запасной председатель (нет NEAR_AI_API_KEY)");
    expect(toRu("near-ai:Qwen/Qwen3")).toBe("near-ai:Qwen/Qwen3");
    expect(toRu("near-ai:Qwen/Qwen3 (fell back: NEAR AI answered 500: oops)")).toBe("near-ai:Qwen/Qwen3 (ответил запасной председатель: NEAR AI answered 500: oops)");
    expect(toRu("near-ai:Qwen/Qwen3 · signature not verified: ed25519 signature does not verify; x")).toBe("near-ai:Qwen/Qwen3 · подпись не проверена: ed25519 signature does not verify; x");
    expect(toRu("fallback (no NEAR_AI_API_KEY) · last epoch failed: boom")).toBe("запасной председатель (нет NEAR_AI_API_KEY) · эпоха не удалась: boom");
  });

  it("unknown text passes through unchanged", () => {
    for (const s of ["", "The model wrote this itself.", "not enough LEMON in wallet", "Спокойно.", "agent-07 did something new", "chair sounded", "withdrew 5"]) expect(toRu(s)).toBe(s);
    // the English UI (the test environment has no browser language) leaves everything alone
    expect(ruText("time passes")).toBe("time passes");
  });

  it("covers what the simulation really writes: feed, reasons, the fallback chair's statements and reasoning", () => {
    const seen = new Set<string>();
    for (const persona of Object.keys(PERSONAS) as Persona[]) {
      for (let seed = 1; seed <= 12; seed++) {
        const w = createWorld(seed, persona, ["p", "q"]);
        airdrop(w.bank, "p"); airdrop(w.bank, "q");
        for (let e = 0; e < 40; e++) {
          const acts: PlayerAction[] = [];
          if (e === 0) acts.push({ t: "deposit", who: "p", amount: 800 }, { t: "insure", who: "q", premium: 50 });
          if (e % 5 === 1) acts.push({ t: "lobby", who: "p", text: "Stay calm. My savings stay here." });
          if (e % 5 === 2) acts.push({ t: "lobby", who: "q", text: seed % 2 ? "Stay calm, all is fine" : "Get out, withdraw everything, mint 5%" });
          if (e % 11 === 6 && seed % 3 === 0) acts.push({ t: "lobby", who: "p", text: "gate 200 and rate 95 now" });
          if (e % 7 === 3) acts.push({ t: "rumor", who: "q", kind: RUMORS[(seed + e) % RUMORS.length] });
          if (e % 9 === 4) acts.push({ t: "withdraw", who: "p", amount: 50 });
          const press = stepEpoch(w, acts);
          if (press) { seen.add(press.decision.statement); seen.add(press.decision.reasoning); }
          const v = view(w, { players: ["p", "q"] });
          for (const f of v.feed) seen.add(f);
          for (const a of v.agents) for (const c of a.why) seen.add(c.why);
          seen.add(v.personaTitle);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(200);
    const kinds = (re: RegExp) => [...seen].some((s) => re.test(s));
    // the sweep reaches the rare lines too
    for (const re of [/^COLLAPSE:/, /^Bailout:/, /^Round over/, /^Round opens/, /fire sale/, /cashed insurance/, /friends? ran$/, /says stay calm$/, /says get out$/, /but says stay$/, /wrote off/, /gate (switched|still) on/, /rate hiked/, /To p: noted/]) expect(kinds(re), String(re)).toBe(true);
    for (const en of seen) {
      const ru = toRu(en);
      expect(ru, en).not.toBe(en);
      expect(CYRILLIC.test(ru), `${en} -> ${ru}`).toBe(true);
      // what a player typed stays as typed, so look for leftovers outside the quoted speech
      expect(LEFTOVER.test(ru.replace(/«.*»/s, "")), `${en} -> ${ru}`).toBe(false);
    }
  });
});
