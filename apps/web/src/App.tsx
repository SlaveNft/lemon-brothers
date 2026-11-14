import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT, PERSONAS, RUMORS, feedTail, speechStance, type Persona, type WorldView } from "@chair/sim";

const STAKE_FULL = AGENT.speechStakeFull;
import { pickDriver, type Act, type Driver } from "./driver";
import { tr } from "./lang";
import { TopBar, SimTag } from "./TopBar";
import { Scene } from "./town/Scene";
import { parseAmount, tickPercent, trackRound, type RoundMark, type RoundResult } from "./logic";
import { personaBlurb, personaTitle, ruText, rumorLabel, toneLabel } from "./ruText";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (permille: number) => `${(permille / 10).toFixed(1)}%`;
/** Poll failures in a row before the page says the runner is gone (polls are 700 ms apart). */
const STALE_AFTER = 4;

function playerId(): string {
  try {
    const k = "chair.player";
    let id = localStorage.getItem(k);
    if (!id) { id = "player-" + Math.random().toString(36).slice(2, 6); localStorage.setItem(k, id); }
    return id;
  } catch { return "player-" + Math.random().toString(36).slice(2, 6); }
}

export default function App() {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [s, setS] = useState<(WorldView & { lastChair?: unknown }) | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [speech, setSpeech] = useState("");
  // the amount as typed: it may be empty or half-written while the player edits it, and is read on click
  const [amount, setAmount] = useState("500");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [stale, setStale] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const me = useMemo(playerId, []);
  const roundMark = useRef<RoundMark | null>(null);
  const lastRound = useRef<RoundResult | null>(null);

  // pick the town and join it; a failed join is shown with a retry, and a driver that lost the race (StrictMode
  // mounts twice) or is being replaced is disposed, so no timer keeps a second town running
  useEffect(() => {
    let dead = false, mine: Driver | null = null;
    setJoinErr(null);
    (async () => {
      try {
        const d = await pickDriver();
        if (dead) { d.dispose(); return; }
        mine = d;
        const err = await d.join(me);
        if (dead) return;
        if (err) { setJoinErr(err); return; }
        setDriver(d);
      } catch (e) {
        if (!dead) setJoinErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => { dead = true; mine?.dispose(); setDriver(null); };
  }, [me, attempt]);

  useEffect(() => {
    if (!driver) return;
    let live = true, failures = 0, rejoining = false;
    const poll = async () => {
      try {
        const v = await driver.state();
        if (!live) return;
        failures = 0; setStale(false); setS(v);
        // a restarted runner has a new town that does not know this player: join again
        if (!rejoining && !v.players.some((p) => p.id === me)) {
          rejoining = true;
          void driver.join(me).then((err) => { if (live && err) setMsg(`✕ ${err}`); }).finally(() => { rejoining = false; });
        }
      } catch {
        if (live && ++failures >= STALE_AFTER) setStale(true);
      }
    };
    void poll();
    const t = setInterval(poll, 700);
    return () => { live = false; clearInterval(t); setStale(false); };
  }, [driver, me]);

  const mine = s?.players.find((p) => p.id === me);
  const net = mine ? mine.wallet + mine.deposit : 0;
  const voice = Math.min(100, Math.round(((mine?.deposit ?? 0) * 100) / STAKE_FULL));
  // the score counts from the start of the round; when the round moves on, the finished one is kept as "last round"
  if (s && mine) {
    const t = trackRound(roundMark.current, lastRound.current, s, net);
    roundMark.current = t.mark; lastRound.current = t.last;
  }
  const score = roundMark.current ? net - roundMark.current.net : 0;
  const lastR = lastRound.current;

  async function act(a: Act, ok: string) {
    if (!driver) return;
    try {
      const err = await driver.act(me, a);
      setMsg(err ? `✕ ${err}` : `✓ ${ok} · ${tr("simulation", "симуляция")}`);
    } catch (e) { setMsg(`✕ ${String((e as Error)?.message ?? e)}`); }
  }

  /** Fast-forward; the runner may refuse (an epoch is running, too many epochs) and the player should see why. */
  async function ff(epochs: number) {
    if (!driver) return;
    try {
      const err = await driver.ff(epochs);
      // success leaves the last message alone, except an earlier fast-forward error, which no longer holds
      setMsg((m) => (err ? `✕ ${tr("fast-forward", "перемотка")}: ${err}` : m?.startsWith(`✕ ${tr("fast-forward", "перемотка")}`) ? null : m));
    } catch (e) { setMsg(`✕ ${tr("fast-forward", "перемотка")}: ${String((e as Error)?.message ?? e)}`); }
  }

  function deposit() {
    const n = parseAmount(amount);
    if (n === null) { setMsg(`✕ ${tr("enter a whole amount of LEMON, 1 or more", "введи целую сумму в LEMON, от 1")}`); return; }
    void act({ t: "deposit", amount: n }, tr("deposited", "положил"));
  }

  /** A speech goes to the chair and to the town; tell the player how the town will hear it. */
  function say(text: string) {
    const st = speechStance(text), insured = (mine?.insured ?? 0) > 0;
    const heard = !st ? tr("the chair reads it; the town hears no call to stay or run", "председатель прочтёт; город не услышит призыва ни остаться, ни бежать")
      : st === "alarm" ? tr("the town hears: get out", "город слышит: бегите")
      : insured ? tr("the town hears 'stay calm' from someone insured against the bank: it backfires", "город слышит «спокойно» от застрахованного против банка: станет только хуже")
      : tr("the town hears: stay calm (its weight is your deposit, shown next to the speech)", "город слышит: спокойно (вес — твой вклад, он виден рядом с речью)");
    void act({ t: "lobby", text }, heard);
  }

  if (joinErr) return (
    <div className="loading" role="alert">
      <p>{tr("Could not join the town", "Не удалось войти в город")}: {joinErr}</p>
      <button onClick={() => setAttempt((x) => x + 1)}>{tr("Try again", "Попробовать снова")}</button>
    </div>
  );
  if (!s || !driver) return (
    <div className="loading" role="status">
      {tr("Opening the bank…", "Открываем банк…")}
      {stale && <p className="stale">{tr("The runner is not answering. Still trying…", "Раннер не отвечает. Пробуем ещё…")}</p>}
    </div>
  );

  const last = s.press[s.press.length - 1];
  const liab = Math.max(1, s.liabilities);
  const reserveShare = Math.min(1, s.reserve / liab);
  const fallen = s.collapsed;
  const avgPanic = s.agents.reduce((x, a) => x + a.panic, 0) / s.agents.length;
  const tickPct = tickPercent(s.nextTickMs, s.epochMs ?? null);
  // the chair speaks when the bank day ends: seconds until then, or null while the clock is paused or unknown
  const nextSay = s.nextTickMs !== null && s.epochMs ? Math.max(0, Math.ceil(s.nextTickMs / 1000)) : null;
  const title = personaTitle(s.persona, s.personaTitle);
  const sel = s.agents.find((a) => a.id === picked) ?? null;
  // depositors driven by a language model in a live town (the runner with a NEAR AI key); none in the browser town
  const minds = s.agents.filter((a) => a.mind?.source === "model");
  const ranNow = s.agents.filter((a) => a.ranAt >= 0 && (a.ranAt === s.epochId - 1 || a.ranAt === s.epochId)).length;

  return (
    <div className="app">
      <TopBar>
        <div className="clock">
          <b>{tr("Round", "Раунд")} {s.round + 1}</b> · {tr("bank day", "банковский день")} {s.epoch + 1} {tr("of", "из")} {s.epochsPerRound}
          {tickPct !== null && <span className="tick" role="progressbar" aria-label={tr("Time to the next bank day", "Время до следующего банковского дня")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(tickPct)}><i style={{ width: `${tickPct}%` }} /></span>}
          <span className="mode-tag" title={ruText(s.chairMode)}>{driver.mode === "live" ? tr("LIVE town", "ЖИВОЙ город") : tr("Town in the browser", "Город в браузере")}</span>
        </div>
      </TopBar>

      {stale && <div className="stale banner" role="alert">{tr("The runner is not answering: the town below is the last state received. Still trying…", "Раннер не отвечает: город ниже — последнее полученное состояние. Пробуем ещё…")}</div>}

      {driver.replay ? (
        <div className="replay-bar" role="status">
          <p>
            <b>{tr("A real run, played back.", "Настоящий прогон, в записи.")}</b>{" "}
            {tr(`Recorded on 14 November 2026: a town of sixty with a rule-based ${driver.replay.run.persona} chair, where ${driver.replay.run.depositors.length} depositors were driven by a NEAR AI model. Their choices and words below are the recorded ones; the page rebuilds each day from them.`,
              `Записан 14 ноября 2026: город из шестидесяти с председателем по правилам, где ${driver.replay.run.depositors.length} вкладчиков вела модель NEAR AI. Их решения и слова ниже — записанные; страница восстанавливает по ним каждый день.`)}{" "}
            <span className="replay-day">{tr("Day", "День")} {Math.min(driver.replay.day(), driver.replay.days)} {tr("of", "из")} {driver.replay.days}</span>
          </p>
          <button onClick={() => driver.replay!.restart()}>{tr("Play again", "Сыграть заново")}</button>
        </div>
      ) : (
        <div className="town-intro">
          <h1>{tr("The town: sixty depositors, live in your browser", "Город: шестьдесят вкладчиков, вживую в твоём браузере")}</h1>
          <p><SimTag>{tr("simulation", "симуляция")}</SimTag>{" "}{tr("An extra for the curious: here you are one of the depositors, with play money, next to sixty programs. A bank day lasts a few seconds. The real coin and the real bank are on the main page.", "Дополнение для любопытных: здесь ты один из вкладчиков, с игровыми монетами, рядом с шестьюдесятью программами. Банковский день длится несколько секунд. Настоящая монета и настоящий банк — на главной странице.")}{" "}
            <a href="./#what">{tr("← Back to the main page", "← На главную")}</a></p>
        </div>
      )}

      <Scene s={s} />

      <p className="goal">
        {tr(
          "The bank lends out most of what you deposit. Stay and earn interest, or run before everyone else does: if too many withdraw, the last ones lose. The AI chair sets the rules every bank day, the contract caps what it can do, and 60 depositor agents decide whether to panic.",
          "Банк раздаёт в кредит почти всё, что ты положил. Останься и получай проценты — или беги раньше всех: если снимут слишком многие, последние потеряют деньги. ИИ-председатель каждый банковский день меняет правила, контракт ограничивает, что он может, а 60 агентов-вкладчиков решают, паниковать ли.",
        )}
      </p>

      <main>
        <section className="card press">
          <div className="eyebrow">{tr("Press conference", "Пресс-конференция")} · {title}</div>
          <p className="leo-when">{nextSay === null
            ? tr("The chair makes one statement at the end of each bank day. The clock is paused: use the fast-forward buttons below.", "Председатель делает одно заявление в конце каждого банковского дня. Часы на паузе: перематывай кнопками внизу.")
            : tr(`The chair makes one statement at the end of each bank day. Next statement in ${nextSay} s.`, `Председатель делает одно заявление в конце каждого банковского дня. Следующее заявление через ${nextSay} с.`)}</p>
          {last ? <>
            <blockquote className={`tone-${last.decision.tone}`}>“{ruText(last.decision.statement)}”</blockquote>
            <div className="chips">
              <span className={`tone tone-${last.decision.tone}`}>{toneLabel(last.decision.tone)}</span>
              <span>{tr("rate", "ставка")} {(s.policy.rate / 100).toFixed(2)}%</span>
              <span>{tr("reserve target", "цель резерва")} {pct(s.policy.target)}</span>
              {s.policy.gate > 0 && <span className="bad">{tr("withdrawal gate", "лимит снятия")} {fmt(s.policy.gate)}</span>}
              {last.decision.mint > 0 && !last.rejected && <span className="warn">{tr("printed", "напечатано")} {fmt(last.decision.mint)}</span>}
            </div>
            {last.rejected && <div className="rejected"><b>{tr("REJECTED BY THE CONTRACT", "ОТКЛОНЕНО КОНТРАКТОМ")}</b> {last.rejected}<small>{tr("The chair tried it; the policy did not change.", "Председатель попытался — политика не изменилась.")}</small></div>}
            <details><summary>{tr("Why (the chair's reasoning)", "Почему (логика председателя)")}</summary><p>{ruText(last.decision.reasoning)}</p>
              {s.policy.attestation && <p className="mono small">{tr("TEE signature", "Подпись TEE")}: {s.policy.attestation}</p>}
              <p className="small">{tr("Chair", "Председатель")}: {ruText(s.chairMode)} · {tr("credibility", "доверие")} {Math.round(s.credibility / 10)}%</p>
            </details>
          </> : <p className="muted">{tr("The chair speaks at the end of the first bank day.", "Председатель выступит в конце первого банковского дня.")}</p>}
        </section>

        <section className="card bank">
          <div className="eyebrow">{tr("The bank", "Банк")}</div>
          {fallen ? <div className="fallen">{tr("THE BANK HAS FALLEN. It is rescued on the next bank day.", "БАНК РУХНУЛ. В следующий банковский день его спасут.")}</div> : null}
          <div className="vault" title={tr("Cash in the vault vs what the bank owes depositors", "Наличные в хранилище против того, что банк должен вкладчикам")}>
            <div className="vault-bar"><i style={{ width: `${reserveShare * 100}%` }} className={s.reservePermille < 100 ? "low" : ""} /></div>
            <div className="vault-legend"><span>{tr("in the vault", "в хранилище")} <b>{fmt(s.reserve)}</b></span><span>{tr("owed to depositors", "должен вкладчикам")} <b>{fmt(s.liabilities)}</b></span></div>
          </div>
          <dl>
            <dt>{tr("Lent out", "В кредитах")}</dt><dd>{fmt(s.loans)}</dd>
            <dt>{tr("LEMON in existence", "Всего LEMON")}</dt><dd>{fmt(s.supply)}</dd>
            <dt>{tr("Town panic", "Паника в городе")}</dt><dd>{Math.round(avgPanic / 10)}%</dd>
            <dt>{tr("Rounds survived / fallen", "Раундов выстоял / рухнул")}</dt><dd>{s.roundsSurvived} / {s.roundsFallen}</dd>
          </dl>
          <Spark s={s} />
        </section>

        <section className="card town">
          <div className="eyebrow">{tr("Depositors (agents)", "Вкладчики (агенты)")} · {ranNow > 0 ? tr(`${ranNow} ran this bank day`, `за этот банковский день сбежали ${ranNow}`) : tr("nobody ran this bank day", "за этот банковский день никто не сбежал")}</div>
          <div className="dots" role="group" aria-label={tr("Depositors: choose one to see why its panic moved", "Вкладчики: выбери любого, чтобы увидеть, почему изменилась его паника")}>
            {s.agents.map((a) => {
              const ran = a.deposit === 0;
              const heat = Math.min(1, a.panic / Math.max(1, a.threshold));
              const label = `${a.name}: ${ran ? tr("out of the bank", "вне банка") : `${tr("panic", "паника")} ${Math.round(a.panic / 10)}%, ${tr("runs at", "бежит при")} ${Math.round(a.threshold / 10)}%`}`;
              return (
                <i key={a.id} role="button" tabIndex={0} aria-label={label} aria-pressed={picked === a.id} title={label}
                  className={`${ran ? "ran" : ""}${picked === a.id ? " sel" : ""}${a.mind?.source === "model" ? " ai" : ""}`} style={{ background: ran ? "transparent" : `hsl(${120 - heat * 120} 70% 50%)` }}
                  onClick={() => setPicked(a.id)} onFocus={() => setPicked(a.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(a.id); } }} />
              );
            })}
          </div>
          {minds.length > 0 && (
            <div className="minds" aria-live="polite">
              <div className="eyebrow">{tr(`AI depositors · ${minds.length} of ${s.agents.length} think with a model`, `ИИ-вкладчики · ${minds.length} из ${s.agents.length} думают моделью`)} · <span className="mono">{minds[0].mind!.model}</span></div>
              <ul>{minds.map((a) => (
                <li key={a.id}>
                  <button className="ghost" onClick={() => setPicked(a.id)}><b>{a.name}</b></button>{" "}
                  <span className={`chip ${a.mind!.choice === "run" ? "bad" : a.mind!.choice === "deposit" ? "ok" : ""}`}>{a.mind!.choice === "run" ? tr("runs", "бежит") : a.mind!.choice === "deposit" ? tr("deposits", "вносит") : tr("holds", "остаётся")}</span>{" "}
                  <span className="mind-why">{a.mind!.why}</span>
                  {a.mind!.say && <span className="mind-say">{tr("says", "говорит")}: “{a.mind!.say}”</span>}
                </li>
              ))}</ul>
              <p className="muted small">{tr("Their words are the model's own, as it wrote them. The other depositors are programs; with no key every depositor is.", "Их слова — собственные слова модели, как она их написала. Остальные вкладчики — программы; без ключа программами остаются все.")}</p>
            </div>
          )}
          <div className="agent-panel" role="status" aria-live="polite">
            {sel ? <>
              <div className="agent-head">
                <b>{sel.name}</b>
                <span>{tr("panic", "паника")} {Math.round(sel.panic / 10)}% / {tr("runs at", "бежит при")} {Math.round(sel.threshold / 10)}%</span>
                <span>{tr("deposit", "вклад")} {fmt(sel.deposit)} · {tr("wallet", "кошелёк")} {fmt(sel.wallet)}</span>
                <button className="ghost close" aria-label={tr("Close", "Закрыть")} onClick={() => setPicked(null)}>×</button>
              </div>
              {sel.why.length > 0
                ? <ul>{sel.why.map((c, i) => <li key={i}><span className={c.delta > 0 ? "down" : "up"}><b>{c.delta > 0 ? "+" : "−"}{Math.abs(Math.round(c.delta / 10))}</b></span> {ruText(c.why)}</li>)}</ul>
                : <p className="muted small">{tr("Nothing has moved this depositor's panic yet.", "Пока ничто не изменило панику этого вкладчика.")}</p>}
            </> : <p className="muted small">{tr("Green calm, red about to run, hollow already gone. Click, tap or tab to a dot: every agent logs why its panic moved.", "Зелёный — спокоен, красный — вот-вот побежит, пустой — уже ушёл. Нажми на точку или перейди к ней клавишей Tab: каждый агент пишет, почему изменилась его паника.")}</p>}
          </div>
          <ul className="feed" aria-label={tr("Latest events", "Последние события")}>{feedTail(s.feed, 7).reverse().map((f, i) => <li key={i} className={/^(Round over|COLLAPSE|Bailout)/.test(f) ? "outcome" : undefined}>{ruText(f)}</li>)}</ul>
        </section>

        <section className="card you">
          <div className="eyebrow">{tr("You", "Ты")} · {me}</div>
          <p className="sim-note"><SimTag>{tr("simulation", "симуляция")}</SimTag>{" "}{driver.mode === "live"
            ? tr("This town runs on the project's own server: the coins in this card are play money, not $LEMON from the network. Nothing here is a blockchain transaction.", "Этот город работает на сервере проекта: монеты в этой карточке игровые, это не $LEMON из сети. Ни одно действие здесь не является операцией в блокчейне.")
            : tr("This town lives in your browser: the coins in this card are play money, not $LEMON from the network. Nothing here is sent anywhere.", "Этот город живёт в твоём браузере: монеты в этой карточке игровые, это не $LEMON из сети. Отсюда ничего никуда не отправляется.")}{" "}
            <a href="./#coins">{tr("Real $LEMON are on \"My coins\" →", "Настоящие $LEMON — на экране «Мои монеты» →")}</a></p>
          <div className="me">
            <span>{tr("wallet", "кошелёк")} <b>{fmt(mine?.wallet ?? 0)}</b></span>
            <span>{tr("in the bank", "в банке")} <b>{fmt(mine?.deposit ?? 0)}</b></span>
            <span>{tr("insured", "застраховано")} <b>{fmt(mine?.insured ?? 0)}</b></span>
            <span className={score >= 0 ? "up" : "down"}>{tr("this round", "за раунд")} <b>{score >= 0 ? "+" : ""}{fmt(score)}</b></span>
            {lastR && <span className={`last-round ${lastR.score >= 0 ? "up" : "down"}`}>
              {lastR.rounds === 1 ? tr("last round", "прошлый раунд") : tr(`last ${lastR.rounds} rounds`, `прошлые раунды (${lastR.rounds})`)} <b>{lastR.score >= 0 ? "+" : ""}{fmt(lastR.score)}</b>
              {" · "}{lastR.fell === 0 ? tr("the bank survived", "банк выстоял") : lastR.rounds === 1 ? tr("the bank fell", "банк рухнул") : tr(`the bank fell ${lastR.fell}×`, `банк рухнул ${lastR.fell}×`)}
            </span>}
          </div>
          <div className="row">
            <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={amount} aria-label={tr("Amount to deposit, LEMON", "Сумма вклада, LEMON")} aria-invalid={parseAmount(amount) === null}
              onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") deposit(); }} />
            <button onClick={deposit}>{tr("Deposit", "Положить")}</button>
            <button className="run" onClick={() => act({ t: "withdrawAll" }, tr("you ran", "ты сбежал"))}>{tr("RUN (withdraw all)", "БЕЖАТЬ (снять всё)")}</button>
          </div>
          <div className="row">
            {[100, 50].map((p) => (
              <button key={p} onClick={() => act({ t: "insure", premium: p }, tr(`insured ${p}: pays ${p * 3} if the bank falls this round`, `застраховал ${p}: выплата ${p * 3}, если банк рухнет в этом раунде`))} title={tr("Pays 3x if the bank collapses this round. The premium goes into the very bank you bet against.", "Платит 3x, если банк рухнет в этом раунде. Премия идёт в тот самый банк, против которого ставишь.")}>{tr(`Insure ${p}`, `Застраховать ${p}`)}</button>
            ))}
            {RUMORS.map((k) => <button key={k} className="ghost" onClick={() => act({ t: "rumor", kind: k }, tr("rumour spread (25 burned)", "слух пущен (25 сожжено)"))}>{rumorLabel(k)}</button>)}
          </div>
          <div className="voice" title={tr("The town reads your deposit and your insurance on chain. Words weigh as much as the money behind them.", "Город видит твой вклад и страховку в контракте. Слова весят столько, сколько денег за ними.")}>
            {tr("Your voice in town", "Твой голос в городе")}: <b>{voice}%</b>{" "}
            <span className="muted small">{(mine?.insured ?? 0) > 0
              ? tr("· you insured against the bank: your calming words will backfire", "· ты застраховался против банка: твоим успокоениям не поверят, станет хуже")
              : voice < 100 ? tr(`· keep ${fmt(STAKE_FULL)} LEMON in the bank to be fully believed`, `· держи ${fmt(STAKE_FULL)} LEMON в банке, чтобы тебе верили полностью`) : tr("· the town believes you", "· город тебе верит")}</span>
          </div>
          <div className="row">
            <button onClick={() => say(tr("Stay calm. My savings stay in Lemon Brothers.", "Спокойно. Мои сбережения остаются в Lemon Brothers."))}>{tr("“Stay calm, my money is here”", "«Спокойно, мои деньги здесь»")}</button>
            <button className="ghost" onClick={() => say(tr("Get out while you can. Withdraw everything.", "Забирайте деньги, пока не поздно."))}>{tr("“Get out while you can”", "«Забирайте, пока не поздно»")}</button>
          </div>
          <div className="row">
            <input className="grow" maxLength={280} value={speech} aria-label={tr("Your speech to the chair and the town", "Твоя речь председателю и городу")} placeholder={tr("Speak to the chair and the town (10 LEMON, burned)…", "Речь председателю и городу (10 LEMON сжигаются)…")} onChange={(e) => setSpeech(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && speech.trim()) { say(speech.trim()); setSpeech(""); } }} />
            <button onClick={() => { if (speech.trim()) { say(speech.trim()); setSpeech(""); } }}>{tr("Speak", "Сказать")}</button>
          </div>
          {s.speeches.length > 0 && <ul className="speeches">{s.speeches.map((x, i) => (
            <li key={i}>
              {x.stance && <span className={`chip ${x.stance === "calm" && !x.insured ? "ok" : "bad"}`}>{x.stance === "calm" ? (x.insured ? tr("calm, but insured", "успокаивает, но застрахован") : tr(`calm · weight ${Math.round(x.weight * 100)}%`, `успокаивает · вес ${Math.round(x.weight * 100)}%`)) : tr("alarm", "паника")}</span>}{" "}
              <b>{x.who}</b> {x.text}
            </li>
          ))}</ul>}
          <div className="row impeach">
            <span>{tr("Impeach the chair:", "Импичмент председателю:")}</span>
            {(Object.keys(PERSONAS) as Persona[]).filter((p) => p !== s.persona).map((p) => (
              <button key={p} className="ghost" title={personaBlurb(p, PERSONAS[p].blurb)} onClick={async () => {
                const who = personaTitle(p, PERSONAS[p].title);
                try {
                  const r = await driver.impeach(me, p);
                  setMsg(typeof r === "string" ? `✕ ${r}` : r.passed ? tr(`Impeached. ${who} takes the chair.`, `Импичмент прошёл. Кресло занимает ${who}.`) : tr(`Vote failed (yes ${fmt(r.yes)} / no ${fmt(r.no)})`, `Голосование провалилось (за ${fmt(r.yes)} / против ${fmt(r.no)})`));
                } catch (e) { setMsg(`✕ ${String((e as Error)?.message ?? e)}`); }
              }}>{personaTitle(p, PERSONAS[p].title)}</button>
            ))}
          </div>
          {msg && <p className="msg" role="status" aria-live="polite">{msg}</p>}
        </section>
      </main>


      <footer>
        <span>{tr("Fast-forward", "Перемотка")}:</span>
        <button onClick={() => ff(1)}>+1 {tr("bank day", "день")}</button>
        <button onClick={() => ff(Math.max(1, s.epochsPerRound - s.epoch))}>{tr("to the end of the round", "до конца раунда")}</button>
        <button onClick={() => ff(30)} aria-label={tr("Fast-forward 30 bank days", "Перемотать на 30 банковских дней")}>+30</button>
        {driver.setEpochSeconds && <><span>{tr("A bank day lasts", "Банковский день длится")}:</span>{[30, 10, 3].map((x) => <button key={x} className="ghost" onClick={() => driver.setEpochSeconds!(x)}>{x}s</button>)}<button className="ghost" onClick={() => driver.setEpochSeconds!(0)}>{tr("pause", "пауза")}</button></>}
        <span className="muted small">{ruText(s.chairMode)}</span>
        {msg && msg.startsWith("✕") && <span className="msg foot" role="alert">{msg}</span>}
      </footer>
    </div>
  );
}

/** Reserve ratio and average panic over the last epochs. */
function Spark({ s }: { s: WorldView }) {
  const h = s.history.slice(-60);
  if (h.length < 2) return null;
  const W = 300, H = 70;
  const x = (i: number) => (i / (h.length - 1)) * W;
  const reserve = h.map((p, i) => `${x(i)},${H - Math.min(1, p.reserve / Math.max(1, p.liabilities)) * H}`).join(" ");
  const panic = h.map((p, i) => `${x(i)},${H - (p.avgPanic / 1000) * H}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {h.map((p, i) => p.collapsed ? <rect key={i} x={x(i) - 2} y={0} width={4} height={H} className="crash" /> : null)}
      <polyline points={reserve} className="l-reserve" />
      <polyline points={panic} className="l-panic" />
      <text x={4} y={12} className="lbl-r">{tr("vault / owed", "хранилище / долг")}</text>
      <text x={4} y={24} className="lbl-p">{tr("town panic", "паника")}</text>
    </svg>
  );
}
