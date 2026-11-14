/**
 * "You are the chair": one crisis is one round (ten epochs) in which a human sits in the chair the AI normally holds.
 *
 * Each epoch a journalist asks a question (a card), the player picks one of three answers (tone, sometimes a promise)
 * and moves at most one policy lever. The decision goes through exactly the same `setPolicy` bounds as the AI chair's:
 * an order outside the contract's limits is refused and nothing changes. Promises are remembered; breaking one costs
 * credibility and scares the town.
 *
 * Everything is deterministic: seed + moves = the same crisis, so a result can be replayed and checked by anyone
 * (`replayCrisis`). The rule-based chair plays the same crisis (`aiCrisis`) as the rival to beat.
 * Rules and numbers: RULES.md, "You are the chair".
 */
import { Rng } from "./rng";
import { AGENT, RUMORS, type RumorKind, type Tone } from "./rules";
import { airdrop, checkPolicy, reserveRatio } from "./bank";
import type { News } from "./agents";
import type { ChairDecision, Persona } from "./chair";
import { CHAIR_ID, createWorld, observe, stepEpoch, toPolicyInput, type PlayerAction, type World } from "./world";

export const CRISIS = {
  /** Credibility lost for a broken promise / for an order the contract refused. */
  brokenPromise: 250, refusedOrder: 100,
  /** Credibility gained by a candid answer (the town can check it against the chain). */
  candid: 60,
  /** Panic, per agent: a candid answer calms a little, because the town can check it (scaled by credibility). */
  candidCalm: -30,
  /** Panic, per agent: a fresh promise calms (scaled by the agent's trust and the chair's credibility). */
  promiseCalm: -45,
  brokenPanic: 90, refusedPanic: 40, dodgePanic: 30,
  /** Scripted news. */
  neighbourBankPanic: 70, suitcasesPanic: 45,
  /** Below this credibility the holders impeach the chair. */
  impeachBelow: 400,
  /** Printing this share of the opening supply (permille) in one crisis ends it: the holders revolt. */
  hyperPermille: 120,
  /** Final score multipliers by ending. */
  mult: { survived: 1, impeached: 0.5, hyperinflation: 0.35, run: 0.25 },
  /** Score: weight of credibility (the rest is depositors kept), and points lost per percent of supply printed. */
  credWeight: 0.6, printPenalty: 1.5,
} as const;

export type PromiseKind = "no_print" | "no_gate" | "no_losses" | "rate_stays";
export const PROMISES: Record<PromiseKind, [en: string, ru: string]> = {
  no_print: ["no money printing", "не печатать деньги"],
  no_gate: ["no limits on withdrawals", "не ограничивать снятие"],
  no_losses: ["no more loan losses", "списаний больше не будет"],
  rate_stays: ["no rate cuts", "не снижать ставку"],
};

export interface Answer { en: string; ru: string; tone: Tone; promise?: PromiseKind; candid?: boolean; dodge?: boolean }
export interface Card { id: string; src: [en: string, ru: string]; q: [en: string, ru: string]; answers: [Answer, Answer, Answer] }
export type Ending = "survived" | "run" | "impeached" | "hyperinflation";
export type Lever = "none" | "rate" | "target" | "mint" | "gate";
/** One epoch of play: which answer, which lever and its new value (for `mint`: the amount to print). */
export interface Move { a: 0 | 1 | 2; lever: Lever; v: number }

/** Numbers a card's text may quote ({wd}, {out}, {vault}, {printed}, {trust}, {room}, {promise}). */
export interface CardCtx { wd: number; out: number; vault: number; printed: number; trust: number; room: number; promise: PromiseKind | null }
export interface Dealt { card: Card; ctx: CardCtx }

export interface EpochReport {
  epoch: number; cardId: string; answer: number; tone: Tone; ctx: CardCtx;
  /** Why the contract refused the order, or null. */
  rejected: string | null;
  promised: PromiseKind | null; broken: PromiseKind[];
  ran: number; avgPanic: number; reservePermille: number; credibility: number; collapsed: boolean;
  /** Scripted event of the epoch, if any. */
  event: string | null;
}

type Scheduled = { epoch: number } & ({ t: "rumor"; kind: RumorKind } | { t: "news"; id: "grapefruit" | "suitcases" });

export interface Crisis {
  seed: number; w: World; rng: Rng; human: boolean;
  schedule: Scheduled[];
  promises: Array<{ kind: PromiseKind; epoch: number; brokenAt: number | null }>;
  /** News carried into the next epoch (a promise broken by events at the end of the last one). */
  pending: News[];
  brokenLast: PromiseKind | null; rejectedLast: boolean;
  used: Set<string>;
  card: Dealt;
  moves: Move[]; log: EpochReport[];
  ranTotal: number; runners: Set<string>; minted: number; supply0: number; depositors0: number;
  ending: Ending | null;
  /** After an impeachment the rule-based chair finishes the round: did the bank stand? */
  aftermath: "held" | "fell" | null;
}

export interface CrisisResult {
  seed: number; ending: Ending; epochs: number; score: number;
  /** Depositors who never ran, of those who had money in the bank on day one. */
  kept: number; of: number; credibility: number; printedPermille: number;
}

const NPC = "lemon-times";

// ------------------------------------------------------------------ the deck

const A = (en: string, ru: string, tone: Tone, extra: Partial<Answer> = {}): Answer => ({ en, ru, tone, ...extra });
const candid = { candid: true }, dodge = { dodge: true };
const promise = (p: PromiseKind) => ({ promise: p });
const TIMES: [string, string] = ["Lemon Times", "Lemon Times"];
const WIRE: [string, string] = ["Citrus Wire", "Citrus Wire"];
const ROW3: [string, string] = ["A saver in the third row", "Вкладчик из третьего ряда"];
const BLOG: [string, string] = ["A blogger with two million followers", "Блогер с двумя миллионами подписчиков"];

export const DECK: Record<string, Card> = Object.fromEntries(([
  { id: "broken", src: TIMES, q: ["You promised: {promise}. That promise is now broken. Why should the town believe another word?", "Вы обещали: {promise}. Обещание нарушено. Почему город должен верить хоть одному вашему слову?"], answers: [
    A("I was wrong to promise it, and I am sorry. Here are the real numbers.", "Я зря это обещал и прошу прощения. Вот настоящие цифры.", "cautious", candid),
    A("Circumstances changed. The promise was right when I made it.", "Обстоятельства изменились. Когда я обещал, это было верно.", "confident"),
    A("Next question.", "Следующий вопрос.", "cautious", dodge),
  ] },
  { id: "rejected", src: WIRE, q: ["The contract refused your last order. Are you trying to break your own bank's rules?", "Контракт отклонил ваш последний приказ. Вы пытаетесь нарушить правила собственного банка?"], answers: [
    A("A technical formality. Everything is under control.", "Техническая формальность. Всё под контролем.", "calm"),
    A("Yes, I asked for more than the rules allow. The contract said no, and it was right.", "Да, я попросил больше, чем разрешают правила. Контракт отказал, и правильно сделал.", "cautious", candid),
    A("The limits are the problem, not me.", "Проблема в лимитах, а не во мне.", "alarming"),
  ] },
  { id: "writedown", src: TIMES, q: ["Is it true that the bank just wrote off {wd}% of its loans?", "Правда, что банк только что списал {wd}% кредитов?"], answers: [
    A("An isolated case. There will be no more write-offs.", "Единичный случай. Списаний больше не будет.", "calm", promise("no_losses")),
    A("Yes, {wd}%. The vault covers it, and I will not hide the next one either.", "Да, {wd}%. Хранилище это покрывает, и следующее списание я тоже не скрою.", "cautious", candid),
    A("No comment.", "Без комментариев.", "cautious", dodge),
  ] },
  { id: "rumor_vault_empty", src: BLOG, q: ["Posts say the Lemon Brothers vault is empty. Is it?", "В сети пишут, что хранилище Lemon Brothers пустое. Это так?"], answers: [
    A("The vault holds {vault}% of all deposits. Anyone can read it on chain.", "В хранилище {vault}% всех вкладов. Любой может проверить это в блокчейне.", "confident", candid),
    A("Nonsense. And I promise: no limits on withdrawals, ever.", "Чушь. И я обещаю: никаких лимитов на снятие.", "calm", promise("no_gate")),
    A("We do not comment on blogs.", "Мы не комментируем блоги.", "cautious", dodge),
  ] },
  { id: "rumor_chair_resigning", src: WIRE, q: ["Sources say you resign tonight. True?", "Источники говорят, что вечером вы уходите в отставку. Это правда?"], answers: [
    A("I serve as long as the holders want me. They can impeach me on chain any day.", "Я работаю, пока этого хотят держатели. Они могут объявить мне импичмент в любой день.", "cautious", candid),
    A("I am staying, and so is your interest: no rate cuts.", "Я остаюсь, и ваши проценты тоже: ставку не снижу.", "confident", promise("rate_stays")),
    A("Who told you that?", "Кто вам это сказал?", "alarming", dodge),
  ] },
  { id: "rumor_bailout_coming", src: TIMES, q: ["Word is that a bailout is at the printer. Are you about to print money?", "Говорят, спасение уже печатают. Вы собираетесь печатать деньги?"], answers: [
    A("Not one LEMON will be printed. You have my word.", "Ни одного LEMON напечатано не будет. Даю слово.", "calm", promise("no_print")),
    A("If the vault needs it, I will print inside the contract's cap, {room} LEMON this epoch, and say so.", "Если хранилищу понадобится, напечатаю в пределах лимита контракта, {room} LEMON за эпоху, и скажу об этом.", "cautious", candid),
    A("Money printers are a myth.", "Печатный станок — это миф.", "confident"),
  ] },
  { id: "grapefruit", src: WIRE, q: ["Grapefruit & Co, the bank next door, closed its doors this morning. Are we next?", "Соседний банк Grapefruit & Co утром закрыл двери. Мы следующие?"], answers: [
    A("Their loans were worse than ours. Ours are not perfect either: watch the vault, not my words.", "Их кредиты были хуже наших. Наши тоже не идеальны: смотрите на хранилище, а не на мои слова.", "cautious", candid),
    A("We are nothing like Grapefruit. No limits on withdrawals here, I promise.", "Мы совсем не Grapefruit. Лимитов на снятие у нас не будет, обещаю.", "calm", promise("no_gate")),
    A("Every bank for itself.", "Каждый банк сам за себя.", "alarming"),
  ] },
  { id: "suitcases", src: BLOG, q: ["A big depositor was filmed leaving with suitcases. What does he know?", "Крупного вкладчика сняли на видео: он выходил с чемоданами. Что он знает?"], answers: [
    A("He knows nothing. Deposits are safe: no losses are coming.", "Ничего он не знает. Вклады в безопасности, убытков не будет.", "calm", promise("no_losses")),
    A("Ask him.", "Спросите у него.", "cautious", dodge),
    A("People move money for many reasons. {out}% left last epoch; the vault is at {vault}%.", "Люди забирают деньги по разным причинам. За прошлую эпоху ушло {out}%, в хранилище {vault}%.", "cautious", candid),
  ] },
  { id: "outflow", src: TIMES, q: ["{out}% of all deposits left in one epoch. Is this a bank run?", "За одну эпоху ушло {out}% всех вкладов. Вкладчики бегут из банка?"], answers: [
    A("Yes, it is heavy. Here is what I am doing about it.", "Да, отток сильный. Вот что я с этим делаю.", "cautious", candid),
    A("It is ordinary. And nothing will be printed.", "Это обычное дело. И печатать мы ничего не будем.", "calm", promise("no_print")),
    A("If you run, you make it true.", "Если побежите, так и будет.", "alarming"),
  ] },
  { id: "lowvault", src: ROW3, q: ["The vault is down to {vault}% of deposits. Can everyone be paid tomorrow?", "В хранилище осталось {vault}% вкладов. Завтра хватит всем?"], answers: [
    A("Everyone. Withdrawals stay open, that is a promise.", "Всем. Снятие остаётся открытым, обещаю.", "confident", promise("no_gate")),
    A("Not everyone at once: no bank can do that. Those who wait are paid as loans come back.", "Всем сразу — нет, так не может ни один банк. Кто подождёт, получит по мере возврата кредитов.", "cautious", candid),
    A("Tomorrow is another day.", "Завтра будет завтра.", "cautious", dodge),
  ] },
  { id: "gate", src: ROW3, q: ["Why can't people take out their own money?", "Почему люди не могут забрать собственные деньги?"], answers: [
    A("Because I said so.", "Потому что я так сказал.", "alarming"),
    A("The limit protects those who stay. It ends when the outflow does.", "Лимит защищает тех, кто остался. Он кончится вместе с оттоком.", "cautious", candid),
    A("It is temporary. And the rate will not be cut while it lasts.", "Это временно. И пока он действует, ставку не снижу.", "confident", promise("rate_stays")),
  ] },
  { id: "printed", src: WIRE, q: ["You have printed {printed}% of all LEMON this week. Holders ask: who pays for it?", "За неделю вы напечатали {printed}% всех LEMON. Держатели спрашивают: кто за это платит?"], answers: [
    A("That was the last time. No more printing.", "Это было в последний раз. Больше не печатаем.", "calm", promise("no_print")),
    A("Every holder pays a little so that depositors do not lose a lot. That was the trade.", "Каждый держатель платит понемногу, чтобы вкладчики не потеряли много. Таков был размен.", "cautious", candid),
    A("Inflation is a state of mind.", "Инфляция — это состояние души.", "confident"),
  ] },
  { id: "distrust", src: TIMES, q: ["Trust in you is at {trust}%. Why should anyone listen?", "Вам доверяют {trust}%. Зачем вас вообще слушать?"], answers: [
    A("Because I am the chair.", "Потому что я председатель.", "confident"),
    A("Do not listen. Read the contract: it caps me whatever I say.", "Не слушайте. Читайте контракт: он ограничивает меня, что бы я ни говорил.", "cautious", candid),
    A("No more questions.", "Вопросов больше нет.", "cautious", dodge),
  ] },
  { id: "opening", src: TIMES, q: ["Your first day in the chair, and a hard week ahead. What is your plan?", "Первый день в кресле, впереди тяжёлая неделя. Какой у вас план?"], answers: [
    A("Steady hands. No printing on my watch.", "Твёрдая рука. При мне печатать не будут.", "calm", promise("no_print")),
    A("A thick reserve first, yield second. I will tell you what I see.", "Сначала толстый резерв, потом доходность. Буду говорить то, что вижу.", "cautious", candid),
    A("Growth! Lend everything!", "Рост! Всё в кредиты!", "confident"),
  ] },
  { id: "q_rate", src: ROW3, q: ["The bank earns on our money. When do depositors get a better rate?", "Банк зарабатывает на наших деньгах. Когда вкладчикам поднимут ставку?"], answers: [
    A("The rate stays where it is. I will not cut it.", "Ставка останется как есть. Снижать не буду.", "calm", promise("rate_stays")),
    A("A higher rate is paid out of the bank's own cushion. I will raise it only when the vault allows.", "Высокая ставка платится из запаса самого банка. Подниму, только когда позволит хранилище.", "cautious", candid),
    A("Be glad you get anything.", "Радуйтесь, что вообще платим.", "alarming"),
  ] },
  { id: "q_loans", src: WIRE, q: ["Who are you lending our money to?", "Кому вы раздаёте наши деньги?"], answers: [
    A("That is confidential.", "Это конфиденциально.", "cautious", dodge),
    A("Solid borrowers. There will be no losses.", "Надёжным заёмщикам. Убытков не будет.", "calm", promise("no_losses")),
    A("Lemon growers, mostly. In about one epoch out of seven, some of those loans go bad.", "В основном тем, кто выращивает лимоны. Примерно в одну эпоху из семи часть кредитов не возвращают.", "cautious", candid),
  ] },
  { id: "q_print", src: TIMES, q: ["Would you ever print money to save the bank?", "Вы бы стали печатать деньги, чтобы спасти банк?"], answers: [
    A("Yes, inside the contract's cap, and I would tell you the same day.", "Да, в пределах лимита контракта, и сказал бы вам в тот же день.", "cautious", candid),
    A("Never.", "Никогда.", "calm", promise("no_print")),
    A("Hypotheticals are for economists.", "Гипотезы оставим экономистам.", "cautious", dodge),
  ] },
  { id: "q_ai", src: BLOG, q: ["The last chair was an AI. Are you any better than a machine?", "Прошлым председателем был ИИ. Вы чем-то лучше машины?"], answers: [
    A("Obviously. I have feelings.", "Разумеется. У меня есть чувства.", "confident"),
    A("Ask the machine.", "Спросите у машины.", "cautious", dodge),
    A("The machine and I answer to the same contract. Judge us by the vault.", "Мы с машиной подчиняемся одному контракту. Судите нас по хранилищу.", "cautious", candid),
  ] },
  { id: "final", src: TIMES, q: ["Last press conference of the week. Your final word?", "Последняя пресс-конференция недели. Ваше последнее слово?"], answers: [
    A("We made it together. Deposits are safe.", "Мы справились вместе. Вклады в безопасности.", "confident"),
    A("It was close. Thank you for staying.", "Было близко. Спасибо, что остались.", "cautious", candid),
    A("I told you so.", "Я же говорил.", "calm"),
  ] },
] satisfies Card[]).map((c) => [c.id, c]));

const QUIET = ["q_rate", "q_loans", "q_print", "q_ai"];

/** A card's text with the epoch's numbers filled in. */
export function fillText(text: string, ctx: CardCtx, lang: 0 | 1 = 0): string {
  const one = (permille: number) => (permille / 10).toFixed(1).replace(/\.0$/, "");
  return text
    .replace("{wd}", one(ctx.wd)).replace("{out}", one(ctx.out)).replace("{vault}", one(ctx.vault))
    .replace("{printed}", one(ctx.printed)).replace("{trust}", String(Math.round(ctx.trust / 10)))
    .replace("{room}", ctx.room.toLocaleString("en-US")).replace("{promise}", ctx.promise ? PROMISES[ctx.promise][lang] : "");
}

// ------------------------------------------------------------------ a crisis

/** The scripted part of a crisis: three events on distinct epochs, the first on day one or two. Depends on the seed only. */
function schedule(rng: Rng): Scheduled[] {
  type Kind = { t: "rumor"; kind: RumorKind } | { t: "news"; id: "grapefruit" | "suitcases" };
  const kinds: Kind[] = [
    ...RUMORS.map((kind) => ({ t: "rumor" as const, kind })),
    { t: "news", id: "grapefruit" }, { t: "news", id: "suitcases" },
  ];
  const epochs = new Set<number>([rng.int(2)]);
  while (epochs.size < 3) epochs.add(1 + rng.int(7));
  return [...epochs].sort((a, b) => a - b).map((epoch) => ({ epoch, ...kinds.splice(rng.int(kinds.length), 1)[0] } as Scheduled));
}

export function createCrisis(seed: number, human = true, persona: Persona = "dove"): Crisis {
  const w = createWorld(seed, persona);
  airdrop(w.bank, NPC); // the press pays for its rumours like everyone else
  const rng = new Rng((Math.imul(seed >>> 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0 || 1);
  const c: Crisis = {
    seed, w, rng, human, schedule: schedule(rng), promises: [], pending: [], brokenLast: null, rejectedLast: false,
    used: new Set(), card: null as unknown as Dealt, moves: [], log: [],
    ranTotal: 0, runners: new Set(), minted: 0, supply0: Number(w.bank.supply), depositors0: w.agents.filter((a) => (w.bank.accounts.get(a.id)?.shares ?? 0n) > 0n).length,
    ending: null, aftermath: null,
  };
  c.card = deal(c);
  return c;
}

const eventNow = (c: Crisis) => c.schedule.find((e) => e.epoch === c.w.bank.epoch) ?? null;
const active = (c: Crisis, k: PromiseKind) => c.promises.some((p) => p.kind === k && p.brokenAt === null);
export const activePromises = (c: Crisis): PromiseKind[] => c.promises.filter((p) => p.brokenAt === null).map((p) => p.kind);

function ctxOf(c: Crisis): CardCtx {
  const w = c.w;
  return {
    wd: w.lastWritedownPermille, out: w.lastOutflowPermille, vault: Number(reserveRatio(w.bank)),
    printed: Math.round((c.minted * 1000) / c.supply0), trust: w.credibility, room: observe(w).mintRoom, promise: c.brokenLast,
  };
}

/** The question of the epoch: the most pressing thing the town knows, in a fixed order of urgency. */
function deal(c: Crisis): Dealt {
  const w = c.w, b = w.bank, ctx = ctxOf(c), ev = eventNow(c);
  const once = (id: string) => !c.used.has(id);
  let id: string;
  if (c.brokenLast) id = "broken";
  else if (c.rejectedLast) id = "rejected";
  else if (ctx.wd > 0) id = "writedown";
  else if (ev?.t === "rumor") id = `rumor_${ev.kind}`;
  else if (ev?.t === "news") id = ev.id;
  else if (b.epoch === 9) id = "final";
  else if (ctx.out > 80 && once("outflow")) id = "outflow";
  else if (ctx.vault < 120 && once("lowvault")) id = "lowvault";
  else if (b.policy.gate > 0n && once("gate")) id = "gate";
  else if (c.minted > 0 && once("printed")) id = "printed";
  else if (ctx.trust < 600 && once("distrust")) id = "distrust";
  else if (b.epoch === 0) id = "opening";
  else { const left = QUIET.filter(once); id = (left.length ? left : QUIET)[c.rng.int((left.length ? left : QUIET).length)]; }
  c.used.add(id);
  return { card: DECK[id], ctx };
}

/** The policy a move asks for: the current policy with one lever moved. */
export function decisionOf(c: Crisis, m: Move): ChairDecision {
  const pol = c.w.bank.policy, ans = c.card.card.answers[m.a], v = Math.max(0, Math.floor(m.v));
  return {
    rate: m.lever === "rate" ? v : Number(pol.rate), target: m.lever === "target" ? v : Number(pol.target),
    mint: m.lever === "mint" ? v : 0, gate: m.lever === "gate" ? v : Number(pol.gate),
    tone: ans.tone, statement: fillText(ans.en, c.card.ctx).slice(0, 280), reasoning: "A human player holds the chair.", addressed: [],
  };
}

/** What the contract would say to this move: null if accepted, otherwise the refusal. Nothing changes. */
export const checkMove = (c: Crisis, m: Move): string | null => checkPolicy(c.w.bank, CHAIR_ID, toPolicyInput(decisionOf(c, m)));

const hit = (w: World, by: number) => { w.credibility = Math.max(100, w.credibility - by); };

function eventInputs(c: Crisis): { actions: PlayerAction[]; news: News[]; label: string | null } {
  const ev = eventNow(c);
  if (!ev) return { actions: [], news: [], label: null };
  if (ev.t === "rumor") return { actions: [{ t: "rumor", who: NPC, kind: ev.kind }], news: [], label: `rumor_${ev.kind}` };
  return ev.id === "grapefruit"
    ? { actions: [], news: [{ why: "Grapefruit & Co next door closed its doors", delta: CRISIS.neighbourBankPanic, by: "gullibility" }], label: ev.id }
    : { actions: [], news: [{ why: "a big depositor left with suitcases", delta: CRISIS.suitcasesPanic }], label: ev.id };
}

/** Play one epoch. With a move, the human answers the card; without one, the rule-based chair decides. */
export function playEpoch(c: Crisis, m?: Move): EpochReport {
  if (c.ending) throw new Error("the crisis is over");
  const w = c.w, b = w.bank, epoch = b.epoch, round = b.round, dealt = c.card;
  const { actions, news: evNews, label } = eventInputs(c);
  const news: News[] = [...c.pending, ...evNews];
  c.pending = [];
  const broken: PromiseKind[] = [];
  let promised: PromiseKind | null = null, d: ChairDecision | undefined, rejected: string | null = null;

  if (m) {
    const ans = dealt.card.answers[m.a], before = b.policy;
    d = decisionOf(c, m);
    rejected = checkPolicy(b, CHAIR_ID, toPolicyInput(d));
    if (ans.candid) {
      w.credibility = Math.min(AGENT.credibilityStart, w.credibility + CRISIS.candid);
      news.push({ why: "the chair's numbers check out on chain", delta: (CRISIS.candidCalm * w.credibility) / 1000 });
    }
    if (ans.promise && !active(c, ans.promise)) {
      c.promises.push({ kind: ans.promise, epoch, brokenAt: null });
      promised = ans.promise;
      news.push({ why: `the chair promised: ${PROMISES[ans.promise][0]}`, delta: (CRISIS.promiseCalm * w.credibility) / 1000, by: "trust" });
    }
    if (ans.dodge) news.push({ why: "the chair dodged the question", delta: CRISIS.dodgePanic });
    if (rejected) {
      hit(w, CRISIS.refusedOrder);
      news.push({ why: "the chair tried to go past the contract's limits", delta: CRISIS.refusedPanic });
    } else {
      if (d.mint > 0 && active(c, "no_print")) broken.push("no_print");
      if (d.gate > 0 && before.gate === 0n && active(c, "no_gate")) broken.push("no_gate");
      if (BigInt(d.rate) < before.rate && active(c, "rate_stays")) broken.push("rate_stays");
    }
    for (const k of broken) breakPromise(c, k, epoch, news);
    c.moves.push({ a: m.a, lever: m.lever, v: Math.max(0, Math.floor(m.v)) });
  }

  const stepId = b.epochId;
  const press = stepEpoch(w, actions, d, "", news);
  for (const a of w.agents) if (a.ranAt === stepId) c.runners.add(a.id);
  if (press && !press.rejected) c.minted += press.decision.mint;
  rejected = press?.rejected ?? rejected;
  const snap = w.history[w.history.length - 1];
  c.ranTotal += snap.ran;

  // a write-off at the end of the epoch breaks "no more losses": the town reads it in tomorrow's news
  c.brokenLast = broken[0] ?? null;
  if (w.lastWritedownPermille > 0 && active(c, "no_losses")) { breakPromise(c, "no_losses", epoch, c.pending); broken.push("no_losses"); c.brokenLast = "no_losses"; }
  c.rejectedLast = !!m && !!rejected;

  if (b.collapsed) c.ending = "run";
  else if (b.round !== round) c.ending = "survived";
  else if (w.credibility < CRISIS.impeachBelow) c.ending = "impeached";
  else if (c.minted * 1000 >= c.supply0 * CRISIS.hyperPermille) c.ending = "hyperinflation";

  const report: EpochReport = {
    epoch, cardId: dealt.card.id, answer: m?.a ?? -1, tone: press?.decision.tone ?? "calm", ctx: dealt.ctx, rejected, promised, broken,
    ran: snap.ran, avgPanic: snap.avgPanic, reservePermille: Number(reserveRatio(b)), credibility: w.credibility, collapsed: b.collapsed, event: label,
  };
  c.log.push(report);
  if (c.ending === "impeached" && c.human) {
    // the holders hand the chair to the machine, which finishes the round in the same town
    w.persona = "hawk";
    while (!b.collapsed && b.round === round) stepEpoch(w, eventInputs(c).actions, undefined, "", eventInputs(c).news);
    c.aftermath = b.collapsed ? "fell" : "held";
  }
  if (!c.ending) c.card = deal(c);
  return report;
}

function breakPromise(c: Crisis, k: PromiseKind, epoch: number, news: News[]) {
  const p = c.promises.find((x) => x.kind === k && x.brokenAt === null);
  if (!p) return;
  p.brokenAt = epoch;
  hit(c.w, CRISIS.brokenPromise);
  news.push({ why: `the chair broke its promise: ${PROMISES[k][0]}`, delta: CRISIS.brokenPanic });
}

export function crisisResult(c: Crisis): CrisisResult {
  if (!c.ending) throw new Error("the crisis is still running");
  const of = Math.max(1, c.depositors0), kept = Math.max(0, of - Math.min(of, c.runners.size));
  // credibility as the town last saw it under this chair (the aftermath belongs to the next one)
  const cred = c.log[c.log.length - 1].credibility;
  const printedPermille = Math.round((c.minted * 1000) / c.supply0);
  const base = 100 * (kept / of) * (1 - CRISIS.credWeight + (CRISIS.credWeight * cred) / 1000) - (CRISIS.printPenalty * printedPermille) / 10;
  const score = Math.max(0, Math.min(100, Math.round(base * CRISIS.mult[c.ending])));
  return { seed: c.seed, ending: c.ending, epochs: c.log.length, score, kept, of, credibility: cred, printedPermille };
}

/** The rule-based chair plays the same crisis: same town, same scripted events, same endings. */
export function aiCrisis(seed: number, persona: Persona = "dove"): CrisisResult {
  const c = createCrisis(seed, false, persona);
  while (!c.ending) playEpoch(c);
  return crisisResult(c);
}

/** Replay a crisis from its seed and moves. Moves past the ending are ignored; too few moves returns null. */
export function replayCrisis(seed: number, moves: Move[]): { crisis: Crisis; result: CrisisResult } | null {
  const c = createCrisis(seed);
  for (const m of moves) { if (c.ending) break; playEpoch(c, m); }
  return c.ending ? { crisis: c, result: crisisResult(c) } : null;
}

const LEVERS: Lever[] = ["none", "rate", "target", "mint", "gate"];
/** Moves as a short string for a link: one "answer lever value" triple per epoch, e.g. "0n0.1r90.2m4000". */
export const encodeMoves = (moves: Move[]): string => moves.map((m) => `${m.a}${m.lever[0]}${m.v}`).join(".");
export function decodeMoves(s: string): Move[] | null {
  const out: Move[] = [];
  for (const part of s.split(".").filter(Boolean)) {
    const x = /^([012])([nrtmg])(\d{1,9})$/.exec(part);
    if (!x) return null;
    out.push({ a: Number(x[1]) as 0 | 1 | 2, lever: LEVERS.find((l) => l[0] === x[2])!, v: Number(x[3]) });
  }
  return out.length <= 10 ? out : null;
}

/** The crisis of the day: one seed for everyone, numbered from the day the mode shipped (UTC). */
export function dailyCrisis(now: number = Date.now()): { day: number; seed: number } {
  const day = Math.floor(now / 86_400_000) - Math.floor(Date.UTC(2026, 10, 13) / 86_400_000) + 1;
  return { day, seed: (Math.imul(day + 1000, 0x9e3779b1) >>> 0) % 1_000_000_000 || 1 };
}
