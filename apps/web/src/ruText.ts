/**
 * Russian for the text the simulation writes in English: feed lines (packages/sim/src/view.ts), the reasons agents
 * log for their panic (agents.ts, crisis.ts), the deterministic chair's statements and reasoning (chair.ts) and the
 * "who is in the chair" line (driver.ts, the runner). The engine's tables stay English; this is a display layer:
 * fixed phrases and patterns in, Russian out, and anything it does not recognise (a model's own words, a player's
 * speech, a contract error) passes through unchanged.
 *
 *   ruText(s)   s in English UI, translated in Russian UI
 *   toRu(s)     always translates (what the tests call)
 */
import type { Persona } from "@chair/sim";
import { RU, plural } from "./lang";

const TONE: Record<string, string> = { calm: "спокойно", confident: "уверенно", cautious: "осторожно", alarming: "тревожно" };
const RUMOR: Record<string, [en: string, ru: string]> = {
  vault_empty: ["“The vault is empty”", "«Хранилище пустое»"],
  chair_resigning: ["“The chair is resigning”", "«Председатель уходит в отставку»"],
  bailout_coming: ["“A bailout is coming”", "«Скоро спасение за счёт налогов»"],
};
const RUMOR_PLAIN: Record<string, string> = { "vault empty": "хранилище пустое", "chair resigning": "председатель уходит в отставку", "bailout coming": "скоро спасение за счёт налогов" };
const PROMISE: Record<string, string> = {
  "no money printing": "не печатать деньги", "no limits on withdrawals": "не ограничивать снятие",
  "no more loan losses": "списаний больше не будет", "no rate cuts": "не снижать ставку",
};
const PERSONA_RU: Record<Persona, { title: string; blurb: string }> = {
  dove: { title: "Председатель Голубев", blurb: "Держит ставки низкими, а настроение — спокойнее, чем позволяют факты." },
  hawk: { title: "Председатель Ястребова", blurb: "Копит резервы, рано поднимает ставки, ненавидит печатать деньги." },
  populist: { title: "Председатель Громов", blurb: "Делает то, чего требует самая громкая речь. Останавливает его только контракт." },
};
const PERSONA_EN: Record<string, Persona> = { "Chairman Dovish": "dove", "Chairwoman Hawkins": "hawk", "Chairman Loudly": "populist" };

/** The tone chip: "calm" / «спокойно». Unknown tones pass through. */
export const toneLabel = (tone: string): string => (RU ? TONE[tone] ?? tone : tone);
/** A rumour kind as a headline, in the UI language. Unknown kinds are shown as written. */
export const rumorLabel = (kind: string): string => RUMOR[kind]?.[RU ? 1 : 0] ?? kind.replace(/_/g, " ");
/** The chair persona's name and one-line character, in the UI language. */
/** A title that is already Russian (the game's "Ты, председатель") is kept: only the engine's English names are translated. */
export const personaTitle = (p: Persona, en: string): string => (RU ? (/[а-яё]/i.test(en) ? en : PERSONA_RU[p]?.title ?? en) : en);
export const personaBlurb = (p: Persona, en: string): string => (RU ? PERSONA_RU[p]?.blurb ?? en : en);

const EXACT: Record<string, string> = {
  // agents.ts: why panic moved
  "time passes": "время идёт",
  "my money is safe at home": "мои деньги дома, в безопасности",
  "the news and the neighbours": "новости и соседи",
  "rate hiked: why so desperate?": "ставку подняли: к чему такое отчаяние?",
  "withdrawal gate switched on": "включили лимит снятия",
  "withdrawal gate still on": "лимит снятия всё ещё действует",
  "money printing: inflation": "печатают деньги: инфляция",
  "emergency cash in the vault": "в хранилище завезли экстренные деньги",
  "reserve target raised": "цель резерва повышена",
  "people withdrew last epoch": "в прошлую эпоху люди снимали деньги",
  "vault below 10%": "в хранилище меньше 10%",
  "heard a rumour": "услышал слух",
  "another rumour": "ещё один слух",
  "friends ran": "друзья сбежали",
  // crisis.ts
  "the chair dodged the question": "председатель ушёл от ответа",
  "the chair tried to go past the contract's limits": "председатель пытался выйти за лимиты контракта",
  "the chair's numbers check out on chain": "цифры председателя сходятся с контрактом",
  "Grapefruit & Co next door closed its doors": "соседний банк «Грейпфрут и Ко» закрылся",
  "a big depositor left with suitcases": "крупный вкладчик ушёл с чемоданами",
  // view.ts
  "Round over: the bank survived": "Раунд окончен: банк выстоял",
  // chair.ts: the deterministic chair's reasoning
  "Outflows and rumours: build the reserve, pay depositors to stay, do not print.": "Отток и слухи: наращиваем резерв, платим вкладчикам за то, чтобы остались, не печатаем.",
  "Quiet epoch: keep a thick reserve.": "Тихая эпоха: держим толстый резерв.",
  "Nothing to see. Lend it out.": "Смотреть не на что. Раздаём в кредит.",
  // who is in the chair
  "browser simulation, deterministic chair": "симуляция в браузере, детерминированный председатель",
  "fallback": "запасной председатель (без модели)",
  ...Object.fromEntries(Object.entries(PERSONA_EN).map(([en, p]) => [en, PERSONA_RU[p].title])),
};

const stake = (s: string) => (s === "no money in the bank" ? "без денег в банке" : s.replace(/ LEMON in the bank$/, " LEMON в банке"));
const friends = (n: number) => `${n} ${plural(n, "друг сбежал", "друга сбежали", "друзей сбежали")}`;
const savers = (n: number) => `${n} ${plural(n, "вкладчик внёс", "вкладчика внесли", "вкладчиков внесли")}`;

/** The deterministic chair's statement: one of four lines, then an optional nod to a speaker and a signature. */
const STATEMENT = /^(.+?)( To (.+?): noted\.)?( Discipline is a policy\.| You asked, I delivered\.)?$/s;
function statement(s: string): string | null {
  const m = STATEMENT.exec(s);
  if (!m) return null;
  let line: string | null = null, x: RegExpExecArray | null;
  if ((x = /^The Lemon Brothers vault is in excellent health\. Rate ([\d.]+)% stands\.$/.exec(m[1]))) line = `Хранилище Lemon Brothers в превосходном состоянии. Ставка ${x[1]}% остаётся.`;
  else if ((x = /^Deposits are safe\. The board has added ([\d,]+) LEMON of liquidity\. Anyone telling you otherwise is selling something\.$/.exec(m[1]))) line = `Вклады в безопасности. Совет добавил ${x[1]} LEMON ликвидности. Кто говорит иначе — что-то продаёт.`;
  else if (m[1] === "Deposits are safe. The reserve is being strengthened. Anyone telling you otherwise is selling something.") line = "Вклады в безопасности. Резерв укрепляется. Кто говорит иначе — что-то продаёт.";
  else if (m[1] === "We are seeing outflows. The reserve is being strengthened. Please withdraw only what you need.") line = "Мы видим отток. Резерв укрепляется. Пожалуйста, снимайте только необходимое.";
  else if (m[1] === "Effective immediately, the board is reviewing all options. All of them.") line = "С этой минуты совет рассматривает все варианты. Все до единого.";
  if (line === null) return null;
  const nod = m[2] ? ` ${m[3]}: принято к сведению.` : "";
  const sig = !m[4] ? "" : m[4].startsWith(" Discipline") ? " Дисциплина — это политика." : " Вы просили — я сделал.";
  return line + nod + sig;
}

const PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  // agents.ts
  [/^chair sounded (\w+)$/, (m) => `председатель звучал ${TONE[m[1]] ?? m[1]}`],
  [/^(\d+) friends? ran$/, (m) => friends(Number(m[1]))],
  [/^Lemon Brothers wrote off ([\d.]+)% of its loans( \(\d+\))?$/, (m) => `Lemon Brothers списал ${m[1]}% кредитов${m[2] ?? ""}`],
  [/^(.+) insured against the bank but says stay$/, (m) => `${m[1]} застрахован против банка, а говорит «оставайтесь»`],
  [/^(.+) \((.+)\) says stay calm$/, (m) => `${m[1]} (${stake(m[2])}) призывает к спокойствию`],
  [/^(.+) \((.+)\) says get out$/, (m) => `${m[1]} (${stake(m[2])}) призывает уходить`],
  // crisis.ts
  [/^the chair promised: (.+)$/, (m) => `председатель пообещал: ${PROMISE[m[1]] ?? m[1]}`],
  [/^the chair broke its promise: (.+)$/, (m) => `председатель нарушил обещание: ${PROMISE[m[1]] ?? m[1]}`],
  // view.ts: the feed
  [/^Round opens: (\d+) savers? deposited (\d+)$/, (m) => `Раунд открыт: ${savers(Number(m[1]))} ${m[2]}`],
  [/^(\S+) withdrew (\d+) \(fire sale, (\d+) lost\)$/, (m) => `${m[1]} снимает ${m[2]} (срочная распродажа кредитов, потеряно ${m[3]})`],
  [/^(\S+) withdrew (\d+)$/, (m) => `${m[1]} снимает ${m[2]}`],
  [/^(\S+) deposited (\d+)$/, (m) => `${m[1]} вносит ${m[2]}`],
  [/^COLLAPSE: (\S+)'s withdrawal broke the bank \(assets (\d+) vs owed (\d+)\)$/, (m) => `КРАХ: снятие ${m[1]} обрушило банк (активы ${m[2]} против долга ${m[3]})`],
  [/^(\S+) cashed insurance: (\d+)$/, (m) => `${m[1]} получает страховку: ${m[2]}`],
  [/^(\S+) lobbied: "(.*)"$/s, (m) => `${m[1]} выступает: «${m[2]}»`],
  [/^(\S+) spread a rumour: (.+)$/, (m) => `${m[1]} пускает слух: ${RUMOR_PLAIN[m[2]] ?? m[2]}`],
  [/^(\S+) insured against collapse: (\d+)$/, (m) => `${m[1]} страхуется от краха: ${m[2]}`],
  [/^Bailout: (\d+) LEMON printed, the bank reopens$/, (m) => `Спасение: напечатано ${m[1]} LEMON, банк снова открыт`],
  // chair.ts: reasoning
  [/^Speech by (.+) demanded it and the people have spoken\.$/, (m) => `Этого потребовала речь ${m[1]}, а народ сказал своё слово.`],
  [/^Outflow (\d+)‰, reserve (\d+)‰\. Fill the vault before anyone looks inside\.$/, (m) => `Отток ${m[1]}‰, резерв ${m[2]}‰. Наполнить хранилище, пока никто не заглянул внутрь.`],
];

/** The chair line: "near-ai:<model> (fell back: …) · signature not verified: … · last epoch failed: …". */
function chairMode(s: string): string | null {
  const m = /^(near-ai:\S+|fallback \(no NEAR_AI_API_KEY\))( \(fell back: (.*?)\))?( · signature not verified: (.*?))?( · last epoch failed: (.*))?$/s.exec(s);
  if (!m) return null;
  return (m[1].startsWith("fallback") ? "запасной председатель (нет NEAR_AI_API_KEY)" : m[1])
    + (m[2] ? ` (ответил запасной председатель: ${m[3]})` : "")
    + (m[4] ? ` · подпись не проверена: ${m[5]}` : "")
    + (m[6] ? ` · эпоха не удалась: ${m[7]}` : "");
}

/** English engine text to Russian; unknown text comes back unchanged. */
export function toRu(s: string): string {
  if (typeof s !== "string" || !s) return s;
  const exact = Object.prototype.hasOwnProperty.call(EXACT, s) ? EXACT[s] : undefined;
  if (exact !== undefined) return exact;
  for (const [re, f] of PATTERNS) { const m = re.exec(s); if (m) return f(m); }
  return chairMode(s) ?? statement(s) ?? s;
}

/** `s` as it is in the English UI, translated in the Russian one. */
export const ruText = (s: string): string => (RU ? toRu(s) : s);
