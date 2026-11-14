/**
 * "You are the chair": the player holds the chair of Lemon Brothers for one crisis (ten press conferences).
 * All rules live in @chair/sim (crisis.ts); this file only shows them. The whole crisis runs in the browser and is
 * deterministic, so a result link (seed + moves) replays to the same score on anyone's machine.
 */
import { useMemo, useRef, useState } from "react";
import {
  aiCrisis, checkMove, createCrisis, crisisResult, CRISIS, dailyCrisis, decodeMoves, encodeMoves, fillText, observe, playEpoch,
  POLICY_BOUNDS, PROMISES, replayCrisis, view, DECK,
  type Crisis, type CrisisResult, type Ending, type EpochReport, type Lever, type Move, type WorldView,
} from "@chair/sim";
import { RU, tr } from "./lang";
import { TopBar, SimTag, RealTag } from "./TopBar";
import { Wallet } from "./chain/Wallet";
import { Scene } from "./town/Scene";
import { play, setSound, soundOn } from "./sfx";
import { answerOrder } from "./logic";
import { Home } from "./Home";
import { useTab } from "./tabs";
import { ChainPanel } from "./chain/ChainPanel";
import { Leaderboard } from "./chain/Leaderboard";
import { EXPLORER } from "./chain/rpc";
import { ruText } from "./ruText";

const L = RU ? 1 : 0;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pc = (permille: number) => `${(permille / 10).toFixed(1).replace(/\.0$/, "")}%`;
const TONE: Record<string, [string, string]> = { calm: ["calm", "спокойно"], confident: ["confident", "уверенно"], cautious: ["cautious", "осторожно"], alarming: ["alarming", "тревожно"] };

const ENDING: Record<Ending, { title: [string, string]; epitaph: [string, string] }> = {
  survived: { title: ["THE BANK STANDS", "БАНК ВЫСТОЯЛ"], epitaph: ["The week is over and the doors are still open. Nobody will thank you, which in banking counts as applause.", "Неделя кончилась, двери всё ещё открыты. Спасибо никто не скажет — в банковском деле это и есть овация."] },
  run: { title: ["BANK RUN", "ВКЛАДЧИКИ ОПУСТОШИЛИ БАНК"], epitaph: ["The vault ran out before the queue did. A bailout is being printed, and your portrait is coming down.", "Хранилище кончилось раньше, чем очередь. Спасение уже печатают, ваш портрет снимают со стены."] },
  impeached: { title: ["IMPEACHED", "ИМПИЧМЕНТ"], epitaph: ["The holders stopped believing you and voted on chain. The chair goes back to the machine.", "Держатели перестали вам верить и проголосовали в блокчейне. Кресло возвращается машине."] },
  hyperinflation: { title: ["HYPERINFLATION", "ГИПЕРИНФЛЯЦИЯ"], epitaph: ["You saved the deposits by printing the money they are counted in. The holders are at the door with lemons.", "Вы спасли вклады, напечатав деньги, в которых их считают. Держатели стоят у дверей с лимонами."] },
};

/** Putting the result on chain: idle, then the two waiting stages, then the transaction or the reason it failed. */
type Submit =
  | { s: "idle" } | { s: "guest" } | { s: "sending" }
  | { s: "done"; txHash: string; accountId: string; accepted: boolean }
  | { s: "error"; error: string; txHash?: string };
/** The guest account this browser already has, if any (read without loading the signing module). */
function storedGuestId(): string | null {
  try { const v = JSON.parse(localStorage.getItem("chair.guest") ?? "null"); return typeof v?.accountId === "string" ? v.accountId : null; } catch { return null; }
}

const pip = (r: EpochReport) => (r.collapsed ? "💥" : r.ran === 0 ? "🟩" : r.ran <= 3 ? "🟨" : "🟥");

interface Start { seed: number; day: number | null; replay: Move[] | null }
function startFromUrl(): Start {
  const q = new URLSearchParams(location.search), seed = Number(q.get("seed"));
  if (Number.isSafeInteger(seed) && seed > 0) return { seed, day: null, replay: q.get("moves") ? decodeMoves(q.get("moves")!) : null };
  const d = dailyCrisis();
  return { seed: d.seed, day: d.day, replay: null };
}

/** The lever buttons: a few steps inside the contract's limits and one past them, so the wall can be felt. */
function leverChoices(c: Crisis, lever: Lever): Array<{ v: number; label: string }> {
  const o = observe(c.w), B = POLICY_BOUNDS, bps = (x: number) => `${(x / 100).toFixed(2)}%`;
  const uniq = (xs: number[]) => [...new Set(xs.filter((x) => x >= 0))];
  switch (lever) {
    case "rate": return uniq([o.policy.rate - 75, o.policy.rate - 25, o.policy.rate + 25, o.policy.rate + 50, o.policy.rate + 75, o.policy.rate + 150]).filter((v) => v !== o.policy.rate).map((v) => ({ v, label: bps(v) }));
    case "target": return uniq([o.policy.target - 150, o.policy.target + 75, o.policy.target + 150, o.policy.target + 300]).filter((v) => v !== o.policy.target && v >= Number(B.targetMin) - 50).map((v) => ({ v, label: pc(v) }));
    case "mint": return uniq([Math.round(o.supply * 0.01), Math.round(o.supply * 0.03), o.mintRoom, Math.round(o.supply * 0.5)]).filter((v) => v > 0).map((v) => ({ v, label: `${fmt(v)} LEMON` }));
    case "gate": return (o.policy.gate > 0 ? [0, 50, 100, 500] : [50, 100, 500]).filter((v) => v !== o.policy.gate).map((v) => ({ v, label: v === 0 ? tr("off", "снять") : `${v} LEMON` }));
    default: return [];
  }
}

const LEVERS: Array<{ id: Lever; name: [string, string]; hint: (c: Crisis) => string }> = [
  { id: "none", name: ["Touch nothing", "Ничего не трогать"], hint: () => tr("Words only today.", "Сегодня только слова.") },
  { id: "rate", name: ["Deposit rate", "Ставка по вкладам"], hint: (c) => tr(`Now ${(Number(c.w.bank.policy.rate) / 100).toFixed(2)}% per epoch. The contract allows 0..3.00%, at most 0.75 up or down a day. A big hike looks desperate; a rate above 0.60% pays out more than the loans earn.`, `Сейчас ${(Number(c.w.bank.policy.rate) / 100).toFixed(2)}% за эпоху. Контракт разрешает 0..3,00%, не больше 0,75 вверх или вниз за день. Резкое повышение выглядит как отчаяние; ставка выше 0,60% платит больше, чем приносят кредиты.`) },
  { id: "target", name: ["Reserve target", "Цель резерва"], hint: (c) => tr(`Now ${pc(Number(c.w.bank.policy.target))} of deposits kept in the vault. The contract allows 10%..80%, at most 15 points a day. A higher target stops new lending; it does not call loans back.`, `Сейчас в хранилище держат ${pc(Number(c.w.bank.policy.target))} вкладов. Контракт разрешает 10%..80%, не больше 15 пунктов за день. Высокая цель останавливает новые кредиты, но старые не отзывает.`) },
  { id: "mint", name: ["Print money", "Напечатать деньги"], hint: (c) => tr(`New LEMON straight into the vault. The contract allows at most ${fmt(observe(c.w).mintRoom)} today (5% of supply a day, 15% a week). Print ${CRISIS.hyperPermille / 10}% in one week and the holders revolt.`, `Новые LEMON прямо в хранилище. Контракт разрешает сегодня не больше ${fmt(observe(c.w).mintRoom)} (5% эмиссии в день, 15% за неделю). Напечатаешь ${CRISIS.hyperPermille / 10}% за неделю — держатели взбунтуются.`) },
  { id: "gate", name: ["Withdrawal limit", "Лимит снятия"], hint: () => tr("Cap what one account may take out per day. The contract allows off, or at least 100 LEMON. It stops a run and frightens everyone.", "Ограничить, сколько один счёт может снять за день. Контракт разрешает: выключен или не меньше 100 LEMON. Останавливает бегство вкладчиков и пугает всех.") },
];

export default function ChairGame() {
  const tab = useTab();
  const start = useMemo(startFromUrl, []);
  const game = useRef<Crisis | null>(null);
  const [, bump] = useState(0);
  const replayed = useRef(false);
  if (!game.current) {
    const r = start.replay ? replayCrisis(start.seed, start.replay) : null;
    game.current = r ? r.crisis : resumeCrisis(start.seed);
    replayed.current = !!r;
  }
  const c = game.current;
  const [answer, setAnswer] = useState<0 | 1 | 2 | null>(null);
  const [lever, setLever] = useState<Lever>("none");
  const [value, setValue] = useState<number | null>(null);
  const [ran, setRan] = useState<Array<{ name: string; why: string }>>([]);
  const [copied, setCopied] = useState(false);
  const [submit, setSubmit] = useState<Submit>({ s: "idle" });
  const [boardTick, setBoardTick] = useState(0);
  const [sound, setSoundState] = useState(soundOn());
  const [guestId, setGuestId] = useState<string | null>(storedGuestId);
  const ai = useMemo(() => aiCrisis(c.seed), [c.seed]);
  const last = c.log[c.log.length - 1] as EpochReport | undefined;

  const s: WorldView = useMemo(() => {
    const v = view(c.w, { players: [], chairMode: "human chair" });
    v.personaTitle = tr("You, the Chair", "Ты, председатель");
    const p = v.press[v.press.length - 1];
    if (p && last && last.answer >= 0 && RU) p.decision = { ...p.decision, statement: fillText(DECK[last.cardId].answers[last.answer].ru, last.ctx, 1) };
    return v;
    // the crisis object is mutated in place; its log length is the version
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, c.log.length]);

  const move: Move | null = answer === null ? null : { a: answer, lever, v: lever === "none" ? 0 : value ?? -1 };
  const ready = move !== null && (lever === "none" || value !== null);
  const refusal = ready && lever !== "none" ? checkMove(c, move!) : null;

  function speak() {
    if (!ready || c.ending) return;
    const id = c.w.bank.epochId;
    playEpoch(c, move!);
    setRan(c.w.agents.filter((a) => a.ranAt === id).map((a) => ({ name: a.name, why: a.why[0]?.why ?? "" })));
    setAnswer(null); setLever("none"); setValue(null); setCopied(false);
    saveProgress(c);
    if (c.ending) saveBest(start, crisisResult(c));
    // each ending has its own sound
    if (c.ending === "survived") play("cheer"); else if (c.ending === "impeached" || c.ending === "hyperinflation") play("siren", 0.6);
    bump((x) => x + 1);
    // stacked layout: the picture is pinned on top, so bring the next card up under it instead of leaving the
    // player at the bottom of an answered one
    requestAnimationFrame(() => {
      if (!matchMedia("(max-width: 999px)").matches) return;
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.querySelector(".chairgame .question, .chairgame .ending")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    });
  }
  /** Send the finished crisis to the contract from the invisible guest account (chain/guest.ts, loaded only now). */
  async function putOnChain() {
    if (!c.ending || submit.s === "guest" || submit.s === "sending") return;
    const r = crisisResult(c);
    setSubmit({ s: "guest" });
    try {
      const guest = await import("./chain/guest");
      const out = await guest.submitRun({ seed: c.seed, moves: encodeMoves(c.moves), score: r.score, ending: r.ending }, { onStage: (s) => setSubmit({ s }) });
      setGuestId(storedGuestId());
      if (out.ok) { setSubmit({ s: "done", txHash: out.txHash, accountId: out.accountId, accepted: out.accepted }); setBoardTick((x) => x + 1); }
      else setSubmit({ s: "error", error: out.error, txHash: out.txHash });
    } catch (e) {
      setSubmit({ s: "error", error: tr(`The signing module could not be loaded (${(e as Error).message}). Check the connection.`, `Не удалось загрузить модуль подписи (${(e as Error).message}). Проверь соединение.`) });
    }
  }
  function restart(seed: number | null) {
    clearProgress(c.seed);
    const u = new URL(location.href);
    u.searchParams.delete("moves");
    if (seed === null) u.searchParams.delete("seed"); else u.searchParams.set("seed", String(seed));
    location.assign(u.toString());
  }

  const result = c.ending ? crisisResult(c) : null;
  const avgPanic = s.agents.reduce((x, a) => x + a.panic, 0) / s.agents.length;
  const printed = Math.round((c.minted * 1000) / c.supply0);
  const promises = c.promises;
  const mood = useMemo(() => townMood(s), [s]);
  const title = start.day !== null ? tr(`Crisis of the day #${start.day}`, `Кризис дня №${start.day}`) : tr(`Crisis ${c.seed}`, `Кризис ${c.seed}`);
  const best = start.day !== null ? loadBest(start.day) : null;
  // the contract takes only today's crisis, and only a game played here goes up under this browser's guest account
  const canSubmit = !!c.ending && !replayed.current && c.seed === dailyCrisis().seed;

  return (
    <div className="app chairgame">
      <TopBar tab={tab} />

      {tab === "what" && <Home />}
      {tab === "coins" && <Wallet />}
      {tab === "bank" && <>
        <ChainPanel />
        <p className="more-links">
          {tr("More to look at", "Ещё посмотреть")}:{" "}
          <a href="?mode=town">{tr("a town of sixty depositors living in your browser", "город из шестидесяти вкладчиков, живущий в твоём браузере")}</a>{" · "}
          <a href="?mode=town&replay=minds">{tr("a recorded run with three AI depositors", "запись прогона с тремя ИИ-вкладчиками")}</a>
        </p>
      </>}

      {tab === "play" && <>

      {/* scene, meters and the town on the left; the question card on the right stays on screen (styles.css, "play layout") */}
      <div className="play-head" id="play">
        <h2>{title}</h2>
        <span className="day">{tr("day", "день")} {Math.min(10, c.log.length + (c.ending ? 0 : 1))} {tr("of", "из")} 10
          <span className="pips" aria-label={tr("Days so far", "Прошедшие дни")}>{c.log.map((r, i) => <span key={i} title={tr(`day ${i + 1}: ${r.ran} ran`, `день ${i + 1}: сбежало ${r.ran}`)}>{pip(r)}</span>)}</span>
        </span>
        <span className="rival">{tr(`The machine got ${ai.score}/100 on this crisis. Beat it.`, `Машина набрала в этом кризисе ${ai.score}/100. Обойди её.`)}</span>
        {best !== null && <span className="best">{tr("Your best today", "Твой лучший счёт сегодня")}: {best}/100</span>}
        <button className="ghost sound" aria-pressed={sound} onClick={() => { setSound(!sound); setSoundState(!sound); }}>{sound ? tr("Sound on", "Звук включён") : tr("Sound off", "Звук выключен")}</button>
      </div>
      <p className="play-note"><SimTag>{tr("a game · simulation", "игра · симуляция")}</SimTag>{" "}
        {tr("You sit in Leo's chair. Each day: pick an answer for the journalist and press \"Say it\". The goal: keep the bank standing for ten days, so the depositors do not all run. The game runs in your browser on a copy of the bank and does not touch the real coin.",
          "Ты в кресле Лео. Каждый день: выбери ответ журналисту и нажми «Сказать это». Цель — продержать банк десять дней, чтобы вкладчики не разбежались. Игра идёт в твоём браузере на копии банка и настоящую монету не трогает.")}{" "}
        {tr(`The copy is a town of its own: ${fmt(c.supply0)} LEMON on day one, ceiling ${fmt(Number(c.w.bank.maxSupply))}.`,
          `У копии свой город: в первый день ${fmt(c.supply0)} LEMON, потолок ${fmt(Number(c.w.bank.maxSupply))}.`)}</p>
      <div className="play">
      <Scene s={s} idle={tr("The press is waiting for your first answer.", "Журналисты ждут твоего первого ответа.")} />

      <div className="meters" role="group" aria-label={tr("The bank at a glance", "Банк одним взглядом")}>
        {/* a fallen bank owes nothing, so the ratio reads 100%: show the empty vault it is */}
        <Meter name={tr("Vault", "Хранилище")} value={s.collapsed ? tr("empty", "пусто") : pc(s.reservePermille)} fill={s.collapsed ? 0 : Math.min(1, s.reservePermille / 500)} bad={s.collapsed || s.reservePermille < 100} hint={s.collapsed ? tr("the queue took the last coin; the bank is closed", "очередь забрала последнюю монету; банк закрыт") : tr("cash on hand against deposits; under 10% the town panics", "наличные против вкладов; ниже 10% город паникует")} />
        <Meter name={tr("Panic", "Паника")} value={pc(avgPanic)} fill={avgPanic / 600} bad={avgPanic > 350} hint={tr("average across 60 depositors; each has its own breaking point", "средняя по 60 вкладчикам; у каждого свой порог")} />
        <Meter name={tr("Trust", "Доверие")} value={pc(s.credibility)} fill={s.credibility / 1000} bad={s.credibility < 600} good hint={tr(`how much your words still weigh; under ${CRISIS.impeachBelow / 10}% the holders impeach you`, `сколько ещё весят твои слова; ниже ${CRISIS.impeachBelow / 10}% держатели объявят импичмент`)} />
        <Meter name={tr("Printed", "Напечатано")} value={pc(printed)} fill={printed / CRISIS.hyperPermille} bad={printed > CRISIS.hyperPermille * 0.6} hint={tr(`of all LEMON; at ${CRISIS.hyperPermille / 10}% the holders revolt`, `от всех LEMON; на ${CRISIS.hyperPermille / 10}% держатели взбунтуются`)} />
      </div>

      <main>
        {result ? (
          <section className={`card ending end-${result.ending}`} aria-live="polite">
            <div className="eyebrow">{title} · {tr("result of the simulation", "итог симуляции")}{replayed.current ? ` · ${tr("replayed from the link, move by move", "переиграно по ссылке, ход за ходом")}` : ""}</div>
            <h2>{ENDING[result.ending].title[L]}</h2>
            <p className="epitaph">{ENDING[result.ending].epitaph[L]}</p>
            <div className="scoreline"><b>{result.score}</b><span>/ 100</span><span className="pips big">{c.log.map(pip).join("")}</span></div>
            <dl>
              <dt>{result.ending === "run" ? tr("Depositors who never ran (the fall took their money too)", "Вкладчики, которые не побежали (крах забрал и их деньги)") : tr("Depositors who never ran", "Вкладчики, которые не сбежали")}</dt><dd>{result.kept} / {result.of}</dd>
              <dt>{tr("Trust at the end", "Доверие в конце")}</dt><dd>{pc(result.credibility)}</dd>
              <dt>{tr("Printed", "Напечатано")}</dt><dd>{pc(result.printedPermille)}</dd>
              <dt>{tr("Promises kept / broken", "Обещаний сдержано / нарушено")}</dt><dd>{promises.filter((p) => p.brokenAt === null).length} / {promises.filter((p) => p.brokenAt !== null).length}</dd>
            </dl>
            {c.aftermath && <p>{c.aftermath === "held"
              ? tr("The machine took the chair and held the bank to the end of the week.", "Машина заняла кресло и удержала банк до конца недели.")
              : tr("The machine took the chair. It lost the bank anyway.", "Машина заняла кресло. Банк всё равно рухнул.")}</p>}
            <div className={`versus ${result.score > ai.score ? "win" : result.score < ai.score ? "lose" : ""}`}>
              <b>{result.score > ai.score ? tr("You beat the machine.", "Ты лучше машины.") : result.score < ai.score ? tr("The machine did better.", "Машина справилась лучше.") : tr("A draw with the machine.", "Ничья с машиной.")}</b>{" "}
              {tr(`Chairman Dovish (the rule-based chair) on the same crisis: ${ai.score}/100, ${endingWord(ai)}.`, `Chairman Dovish (председатель по правилам) в том же кризисе: ${ai.score}/100, ${endingWord(ai)}.`)}
              <small>{tr("On testnet the chair is a NEAR AI model in a TEE whose signed answers the contract verifies; see the panel below.", "В testnet председатель — модель NEAR AI в TEE, её подписанные ответы проверяет контракт; см. панель ниже.")}</small>
            </div>
            <div className="row">
              <button className="primary" onClick={async () => { await copy(shareText(title, c, result)); setCopied(true); }}>{copied ? tr("Copied", "Скопировано") : tr("Copy result and replay link", "Скопировать итог и ссылку на повтор")}</button>
              <a className="btn" href={`https://x.com/intent/post?text=${encodeURIComponent(shareText(title, c, result))}`} target="_blank" rel="noreferrer">{tr("Share on X", "Поделиться в X")}</a>
              <button onClick={() => restart(start.day !== null ? null : c.seed)}>{tr("Try this crisis again", "Сыграть этот кризис ещё раз")}</button>
              <button onClick={() => restart(1 + Math.floor(Math.random() * 999_999))}>{tr("Another crisis", "Другой кризис")}</button>
              {start.day === null && <button className="ghost" onClick={() => restart(null)}>{tr("Crisis of the day", "Кризис дня")}</button>}
            </div>
            {canSubmit && (
              <div className="onchain" aria-live="polite">
                {submit.s === "done" ? (
                  <p className={submit.accepted ? "onchain-done" : "onchain-done warn"}>
                    <RealTag>{tr("done · real operation on NEAR testnet", "прошло · настоящая операция в NEAR testnet")}</RealTag>{" "}<b>{submit.accepted ? tr("Your score is on the public board.", "Твой счёт записан в общую таблицу.") : tr("The transaction went through, but the contract says this claim did not make the board.", "Транзакция прошла, но контракт сообщил, что эта заявка в таблицу не попала.")}</b>{" "}
                    <a href={`${EXPLORER}/txns/${encodeURIComponent(submit.txHash)}`} target="_blank" rel="noreferrer">{tr("See the record in the explorer", "Посмотреть запись в обозревателе")} ↗</a>
                    {" · "}{tr("your account", "твой счёт")} <a className="mono" href={`${EXPLORER}/address/${encodeURIComponent(submit.accountId)}`} target="_blank" rel="noreferrer">{submit.accountId}</a>
                    {" · "}<a href="#leaderboard">{tr("leaderboard ↓", "таблица лидеров ↓")}</a>
                  </p>
                ) : (
                  <div className="row">
                    <RealTag />
                    <button className="primary" disabled={submit.s === "guest" || submit.s === "sending"} onClick={putOnChain}>
                      {submit.s === "guest" ? tr("Creating a guest account…", "Создаём гостевой аккаунт…")
                        : submit.s === "sending" ? tr("Sending…", "Отправляем…")
                        : submit.s === "error" ? tr("Try again", "Попробовать снова")
                        : tr("Put my score on the public board", "Записать мой счёт в общую таблицу")}
                    </button>
                    {(submit.s === "guest" || submit.s === "sending") && <span className="small muted">{tr("This takes a few seconds: the network has to confirm it.", "Это займёт несколько секунд: сеть должна подтвердить.")}</span>}
                  </div>
                )}
                {submit.s === "error" && <p className="onchain-err" role="alert">{tr("Not recorded", "Не записано")}: {submit.error}{submit.txHash && <> <a href={`${EXPLORER}/txns/${encodeURIComponent(submit.txHash)}`} target="_blank" rel="noreferrer">{tr("See the transaction", "Посмотреть транзакцию")}</a></>}</p>}
                <p className="small muted">{tr("The game above was a simulation; this button is the one real step. It sends your score to the bank's program on NEAR testnet, where it appears in the leaderboard below with a link to the record in the explorer. You need nothing: no wallet, no money. The page opens a test account for you, and its key lives in this browser only.", "Игра выше была симуляцией; эта кнопка — единственный настоящий шаг. Она отправит твой счёт в программу банка в NEAR testnet: он появится в таблице лидеров ниже со ссылкой на запись в обозревателе. Ничего не нужно: ни кошелька, ни денег. Страница сама откроет для тебя тестовый счёт, ключ от него хранится только в этом браузере.")}{guestId && submit.s !== "done" && <> {tr("Your guest account", "Твой гостевой аккаунт")}: <span className="mono">{guestId}</span>.</>}</p>
              </div>
            )}
            <p className="small muted">{tr("The link holds the seed and your ten moves. Anyone who opens it replays the same crisis in their browser and gets the same score: nothing to trust, nothing to fake.", "В ссылке — сид и твои десять ходов. Любой, кто её откроет, переиграет тот же кризис у себя в браузере и получит тот же счёт: верить на слово не нужно, подделать нельзя.")}{best !== null && ` ${tr("Your best today", "Твой лучший счёт сегодня")}: ${best}.`}</p>
          </section>
        ) : (
          <section className="card question">
            <div className="eyebrow">{tr("Press conference", "Пресс-конференция")} · {c.card.card.src[L]}</div>
            <blockquote className="ask">{fillText(c.card.card.q[L], c.card.ctx, L)}</blockquote>
            <div className="answers" role="radiogroup" aria-label={tr("Your answer", "Твой ответ")}>
              {answerOrder(c.seed, c.log.length).map((i) => { const a = c.card.card.answers[i]; return (
                <button key={i} role="radio" aria-checked={answer === i} className={`answer ${answer === i ? "on" : ""}`} onClick={() => { play("tick"); setAnswer(i as 0 | 1 | 2); }}>
                  <span className="say">“{fillText(RU ? a.ru : a.en, c.card.ctx, L)}”</span>
                  <span className="tags">
                    <span className={`tone tone-${a.tone}`}>{TONE[a.tone][L]}</span>
                    {a.promise && <span className="promise">{tr("promise", "обещание")}: {PROMISES[a.promise][L]}</span>}
                  </span>
                </button>
              ); })}
            </div>
            <div className="eyebrow lever-title">{tr("One lever a day", "Один рычаг в день")}</div>
            <div className="levers" role="tablist">
              {LEVERS.map((l) => <button key={l.id} role="tab" aria-selected={lever === l.id} className={lever === l.id ? "on" : "ghost"} onClick={() => { play("lever", 0.7); setLever(l.id); setValue(null); }}>{l.name[L]}</button>)}
            </div>
            <p className="small muted lever-hint">{LEVERS.find((l) => l.id === lever)!.hint(c)}</p>
            {lever !== "none" && <div className="row">{leverChoices(c, lever).map((o) => <button key={o.v} className={value === o.v ? "on" : "ghost"} aria-pressed={value === o.v} onClick={() => { play("lever"); setValue(o.v); }}>{o.label}</button>)}</div>}
            {refusal && <p className="warnline">{tr("This is past the contract's limits. You can still give the order and see what the contract says.", "Это за пределами лимитов контракта. Приказ всё равно можно отдать и посмотреть, что ответит контракт.")}</p>}
            <div className="row">
              <button className="primary" disabled={!ready} onClick={speak}>{tr("Say it", "Сказать это")}</button>
              {ready && <SimTag />}
              {!ready && <span className="small muted">{answer === null ? tr("Pick an answer first.", "Сначала выбери ответ.") : tr("Pick a value for the lever, or touch nothing.", "Выбери значение рычага или ничего не трогай.")}</span>}
            </div>
          </section>
        )}

        <section className="card reaction">
          <div className="eyebrow">{tr("The town", "Город")} · {s.collapsed && result
            ? tr(`bank closed · ${result.kept} of ${result.of} never ran`, `банк закрыт · ${result.kept} из ${result.of} не побежали`)
            : `${s.agents.filter((a) => a.deposit > 0).length}/${s.agents.length} ${tr("still in the bank", "ещё в банке")}`}</div>
          {!last && <p className="muted">{tr("You hold the chair of Lemon Brothers for one week: ten press conferences. Answer the press, move one lever a day, and keep the town from running. The contract caps you exactly as it caps the AI chair: try to go past it and see.", "Ты неделю сидишь в кресле председателя Lemon Brothers: десять пресс-конференций. Отвечай журналистам, двигай один рычаг в день и не дай городу побежать. Контракт ограничивает тебя точно так же, как ИИ-председателя: попробуй выйти за лимит и увидишь.")}</p>}
          {last && <>
            {last.rejected && <div className="rejected"><b>{tr("REJECTED BY THE CONTRACT", "ОТКЛОНЕНО КОНТРАКТОМ")}</b> {last.rejected}<small>{tr("The order did not go through; nothing changed. The town heard that you tried.", "Приказ не прошёл, ничего не изменилось. Город узнал, что ты пытался.")}</small></div>}
            {last.broken.map((k) => <div key={k} className="broken">{tr("Promise broken", "Обещание нарушено")}: {PROMISES[k][L]}</div>)}
            <p className={last.ran > 3 ? "ranline bad" : "ranline"}>{last.ran === 0
              ? tr(`Day ${last.epoch + 1}: nobody ran.`, `День ${last.epoch + 1}: никто не сбежал.`)
              : tr(`Day ${last.epoch + 1}: ${last.ran} ran.`, `День ${last.epoch + 1}: сбежало ${last.ran}.`)}</p>
            {ran.length > 0 && <ul className="ranlist">{ran.slice(0, 6).map((r, i) => <li key={i}><b>{r.name}</b> {r.why && <span className="muted">— {ruText(r.why)}</span>}</li>)}{ran.length > 6 && <li className="muted">{tr(`and ${ran.length - 6} more`, `и ещё ${ran.length - 6}`)}</li>}</ul>}
            <div className="mood">
              <div className="small muted">{tr("What moved the town today (sum over all depositors)", "Что сегодня двигало городом (сумма по всем вкладчикам)")}</div>
              {mood.map((m) => <div key={m.why} className="moodrow"><span className={m.delta > 0 ? "up" : "down"}>{m.delta > 0 ? "+" : ""}{m.delta}</span> {ruText(m.why)}</div>)}
            </div>
          </>}
          <div className="dots" aria-hidden="true">
            {s.agents.map((a) => {
              const gone = a.deposit === 0, heat = Math.min(1, a.panic / Math.max(1, a.threshold));
              return <i key={a.id} className={gone ? "ran" : ""} style={{ background: gone ? "transparent" : `hsl(${120 - heat * 120} 70% 50%)` }} title={`${a.name}: ${tr("panic", "паника")} ${Math.round(a.panic / 10)}% / ${Math.round(a.threshold / 10)}%\n${a.why.map((w) => `${w.delta > 0 ? "+" : ""}${w.delta} ${ruText(w.why)}`).join("\n")}`} />;
            })}
          </div>
          <div className="promises">
            <div className="eyebrow">{tr("Your promises", "Твои обещания")}</div>
            {promises.length === 0 ? <p className="small muted">{tr("None yet. A promise calms the town today and binds you for the rest of the week.", "Пока нет. Обещание успокаивает город сегодня и связывает тебя до конца недели.")}</p>
              : <ul>{promises.map((p, i) => <li key={i} className={p.brokenAt === null ? "kept" : "brk"}>{PROMISES[p.kind][L]} <span className="small muted">({tr("day", "день")} {p.epoch + 1}{p.brokenAt !== null ? `, ${tr("broken on day", "нарушено в день")} ${p.brokenAt + 1}` : ""})</span></li>)}</ul>}
          </div>
          <dl>
            <dt>{tr("In the vault", "В хранилище")}</dt><dd>{fmt(s.reserve)}</dd>
            <dt>{tr("Owed to depositors", "Должен вкладчикам")}</dt><dd>{fmt(s.liabilities)}</dd>
            <dt>{tr("Lent out", "В кредитах")}</dt><dd>{fmt(s.loans)}</dd>
            <dt>{tr("Policy", "Политика")}</dt><dd>{tr("rate", "ставка")} {(s.policy.rate / 100).toFixed(2)}% · {tr("target", "цель")} {pc(s.policy.target)}{s.policy.gate > 0 ? ` · ${tr("limit", "лимит")} ${s.policy.gate}` : ""}</dd>
          </dl>
        </section>
      </main>
      </div>

      <Leaderboard refresh={boardTick} me={guestId} />
      </>}
      <footer className="credits">
        {tr("Lemon Brothers is a parody bank on a test network: no real money, no real bank. Characters and drawings: the Lemon Brothers team.", "Lemon Brothers — пародийный банк в тестовой сети: ни настоящих денег, ни настоящего банка. Персонажи и рисунки: команда Lemon Brothers.")}
      </footer>
    </div>
  );
}

function Meter({ name, value, fill, bad, good, hint }: { name: string; value: string; fill: number; bad: boolean; good?: boolean; hint: string }) {
  return (
    <div className={`meter ${bad ? "bad" : ""} ${good ? "good" : ""}`} title={hint}>
      <div className="meter-top"><span>{name}</span><b>{value}</b></div>
      <div className="meter-bar"><i style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }} /></div>
      <div className="meter-hint">{hint}</div>
    </div>
  );
}

/** The reasons behind today's panic, summed over the town: the three biggest pushes and the two biggest calms. */
function townMood(s: WorldView): Array<{ why: string; delta: number }> {
  const sum = new Map<string, number>();
  for (const a of s.agents) for (const w of a.why) {
    const key = w.why.replace(/^\d+ friends? ran$/, "friends ran");
    sum.set(key, (sum.get(key) ?? 0) + w.delta);
  }
  const all = [...sum.entries()].map(([why, delta]) => ({ why, delta })).filter((x) => x.why !== "time passes" && x.why !== "the news and the neighbours");
  const up = all.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const down = all.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2);
  return [...up, ...down];
}

const endingWord = (r: CrisisResult) => ({
  survived: tr("the bank stood", "банк выстоял"), run: tr(`a bank run on day ${r.epochs}`, `банк рухнул в день ${r.epochs}`),
  impeached: tr(`impeached on day ${r.epochs}`, `импичмент в день ${r.epochs}`), hyperinflation: tr(`hyperinflation on day ${r.epochs}`, `гиперинфляция в день ${r.epochs}`),
}[r.ending]);

function shareText(title: string, c: Crisis, r: CrisisResult): string {
  const u = new URL(location.href);
  u.search = ""; u.hash = "";
  u.searchParams.set("seed", String(c.seed)); u.searchParams.set("moves", encodeMoves(c.moves));
  return `Lemon Brothers · ${title}\n${c.log.map(pip).join("")} ${ENDING[r.ending].title[L]} · ${r.score}/100 · ${tr("kept", "удержал")} ${r.kept}/${r.of}\n${u.toString()}`;
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { window.prompt(tr("Copy the result:", "Скопируй итог:"), text); }
}

const bestKey = (day: number) => `chair.best.${day}`;
function loadBest(day: number): number | null { try { const v = localStorage.getItem(bestKey(day)); return v === null ? null : Number(v); } catch { return null; } }
/** A reload must not throw the week away: the moves so far are kept for this tab and replayed on load. */
const progressKey = (seed: number) => `chair.game.${seed}`;
function saveProgress(c: Crisis) { try { sessionStorage.setItem(progressKey(c.seed), encodeMoves(c.moves)); } catch { /* storage blocked: no resume */ } }
function clearProgress(seed: number) { try { sessionStorage.removeItem(progressKey(seed)); } catch { /* nothing to clear */ } }
function resumeCrisis(seed: number): Crisis {
  const c = createCrisis(seed);
  try {
    const moves = decodeMoves(sessionStorage.getItem(progressKey(seed)) ?? "") ?? [];
    for (const m of moves) { if (c.ending) break; playEpoch(c, m); }
  } catch { return createCrisis(seed); }
  return c;
}

function saveBest(start: Start, r: CrisisResult) {
  if (start.day === null) return;
  try { const b = loadBest(start.day); if (b === null || r.score > b) localStorage.setItem(bestKey(start.day), String(r.score)); } catch { /* storage blocked: no best score */ }
}
