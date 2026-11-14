/**
 * The one page a visitor lands on, meant to be understood at a glance:
 *
 *   1. what the coin is, and the bank drawn next to it: move a slider, "how many of the sixty run today?", and
 *      watch depositors leave, the vault empty and coins burn (the bank's real arithmetic, runView.ts);
 *   2. the three rules in one row;
 *   3. the coin as it is on the network right now;
 *   4. the two things a visitor can do, each on a screen of its own (tabs.ts);
 *   5. the questions a newcomer asks.
 *
 * Nothing here sends anything.
 */
import { useEffect, useMemo, useState } from "react";
import { runCurve } from "@chair/sim";
import { RU, plural, tr } from "./lang";
import { viewCall } from "./chain/rpc";
import { parseStats, type BankStats } from "./chain/board";
import { FAQ, PITCH, STEPS } from "./homeText";
import { runView, zoneOf } from "./runView";
import { Town2D } from "./town/Town2D";
import "./home.css";

const fmt = (v: string | number) => { const s = Number(v).toLocaleString("en-US"); return RU ? s.replace(/,/g, " ") : s; };
type Coin = { supply: string; stats: BankStats; at: number; ceiling: string | null } | "wait" | "none";
/** How often the page asks the network for the coin's numbers again while it is open and visible. */
const REFRESH_MS = 30_000;

/**
 * The coin as it is on chain: read from the bank's own views (`ft_total_supply`, `get_stats`) when the page opens
 * and again every 30 seconds while it is visible. The contract does not recount on a timer: it keeps one total and
 * changes it in the same transaction that prints or burns, so the number moves only when something happens.
 */
function useCoin(): Coin {
  const [now, setNow] = useState<Coin>("wait");
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (!document.hidden) {
        try {
          const [supply, stats, state] = await Promise.all([viewCall<string>("ft_total_supply"), viewCall<unknown>("get_stats"), viewCall<{ max_supply?: unknown }>("get_state").catch(() => null)]);
          if (!live) return;
          // the ceiling is shown only if the bank itself reports one
          const max = state?.value?.max_supply, ceiling = typeof max === "string" && /^\d+$/.test(max) ? max : null;
          if (/^\d+$/.test(String(supply.value))) setNow({ supply: String(supply.value), stats: parseStats(stats.value), at: Date.now(), ceiling });
          else setNow((p) => (typeof p === "object" ? p : "none"));
        } catch { if (live) setNow((p) => (typeof p === "object" ? p : "none")); /* no network: keep the last read, or say so */ }
      }
      if (live) timer = setTimeout(read, REFRESH_MS);
    };
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  return now;
}

export function Home() {
  const L = tr(0, 1) as 0 | 1;
  const coin = useCoin();
  const ok = typeof coin === "object", st = ok ? coin.stats : null;
  const lead = PITCH.lead[L], cut = lead.startsWith("$LEMON") ? "$LEMON".length : 0;

  // one day at the bank, by the number of depositors who run
  const curve = useMemo(() => runCurve(), []);
  const N = curve.length - 1, top = curve[0].supplyBefore;
  const firstBurn = curve.findIndex((r) => r.burned > 0), fallAt = curve.findIndex((r) => r.fell);
  const [n, setN] = useState(0);
  const r = curve[n], zone = zoneOf(r);
  const picture = useMemo(() => runView(r, L, tr("Leo, head of the bank", "Лео, глава банка")), [r, L]);
  const lost = N - r.paidInFull;
  const people = (k: number) => tr(k === 1 ? "person" : "people", plural(k, "человек", "человека", "человек"));
  const story = zone === "vault"
    ? (n === 0
      ? tr("Nobody runs. Everyone earns interest and not one coin burns.", "Никто не бежит. Все получают проценты, ни одна монета не сгорает.")
      : tr(`${n} run. The vault has enough: the bank pays them all and nothing burns.`, `Бегут ${n}. В сейфе денег хватает: банк платит всем, ничего не сгорает.`))
    : zone === "sale"
      ? tr(`${n} run. The vault is empty, so the bank sells its loans in a hurry at 60% of their worth. ${fmt(r.burned)} coins are gone for good.`,
        `Бегут ${n}. Сейф опустел, и банк срочно продаёт долги за 60% цены. ${fmt(r.burned)} монет сгорело навсегда.`)
      : tr(`Runner number ${fallAt} broke the bank. ${r.paidInFull} ${people(r.paidInFull)} got everything out; the other ${lost} got ${fmt(r.lateGot)} out of ${fmt(r.owedEach)} each. ${fmt(r.burned)} coins burned, and ${fmt(r.printed)} were printed to open the bank again.`,
        `Бегущий №${fallAt} обрушил банк. ${r.paidInFull} ${people(r.paidInFull)} успели забрать всё; остальные ${lost} получили по ${fmt(r.lateGot)} из ${fmt(r.owedEach)}. Сгорело ${fmt(r.burned)} монет, а чтобы открыть банк снова, напечатали ${fmt(r.printed)}.`);
  const presets: Array<[number, string]> = [
    [0, tr("Nobody runs", "Никто не бежит")],
    [Math.round((firstBurn + fallAt) / 2), tr("A nervous day", "Нервный день")],
    [Math.min(N, fallAt + 4), tr("Everyone panics", "Паника")],
  ];
  const readAt = ok ? new Date(coin.at).toLocaleTimeString(RU ? "ru-RU" : "en-GB") : "";
  const ceilingLine = ok && coin.ceiling ? tr(` And there is a ceiling: this bank can never have more than ${fmt(coin.ceiling)} LEMON in existence, whoever prints and for whatever reason. Past it, new coins can only replace coins that burned.`, ` И есть потолок: в этом банке никогда не будет больше ${fmt(coin.ceiling)} LEMON, кто бы и зачем ни печатал. Дальше новые монеты могут только заменять сгоревшие.`) : "";
  const supplyLine = ok ? tr(`Right now there are ${fmt(coin.supply)} LEMON in the world: the page read this number from the network at ${readAt} and reads it again every 30 seconds. `, `Прямо сейчас в мире ${fmt(coin.supply)} LEMON: страница прочитала это число из сети в ${readAt} и перечитывает его каждые 30 секунд. `) : "";

  return (
    <div className="home">
      <section className={`first z-${zone}`} aria-label={tr("What is this?", "Что это такое?")}>
        <div className="first-head">
          <p className="kicker">{tr("A memecoin · NEAR test network", "Мемкойн · тестовая сеть NEAR")}</p>
          <h1>{cut > 0 && <span className="hl">{lead.slice(0, cut)}</span>}{lead.slice(cut)}</h1>
          <p className="lede">{PITCH.rest[L]}</p>
        </div>
        <div className="try">
            <label className="try-q" htmlFor="try-n">{tr("Try it. How many of the 60 depositors run today?", "Проверь сам. Сколько из 60 вкладчиков побегут сегодня?")}</label>
            <div className="try-slider">
              <input id="try-n" type="range" min={0} max={N} value={n} onChange={(e) => setN(Number(e.target.value))} aria-valuetext={tr(`${n} of ${N} run`, `бегут ${n} из ${N}`)} />
              <b className="try-n">{n}</b>
            </div>
            <div className="try-presets">
              {presets.map(([v, label]) => <button key={label} className={n === v ? "on" : "ghost"} onClick={() => setN(v)}>{label}</button>)}
            </div>
            <p className="try-story" aria-live="polite">{story}</p>
        </div>
        <div className="first-pic">
          <Town2D s={picture} />
          <div className="try-result" aria-live="polite">
            <dl className="try-out">
              <div><dt>{tr("Coins left in the world", "Осталось монет в мире")}</dt><dd>{fmt(r.supplyAfter)}</dd></div>
              <div><dt>{tr("Burned for good", "Сгорело навсегда")}</dt><dd className="burn">−{fmt(r.burned)}</dd></div>
              <div><dt>{tr("Printed by the rescue", "Напечатано при спасении")}</dt><dd className="mint">+{fmt(r.printed)}</dd></div>
            </dl>
            <div className="try-bar" role="img" aria-label={tr(`${fmt(r.supplyAfter)} of ${fmt(top)} coins are left`, `Осталось ${fmt(r.supplyAfter)} из ${fmt(top)} монет`)}><i style={{ width: `${(r.supplyAfter / top) * 100}%` }} /></div>
          </div>
        </div>
      </section>

      <section className="rules" aria-label={tr("How it works", "Как это работает")}>
        <ol>
          {STEPS.map((x, i) => (
            <li key={i}><span className="rule-n">{i + 1}</span><div><h3>{x.title[L]}</h3><p>{x.body[L]}</p></div></li>
          ))}
        </ol>
      </section>

      <section className="live" aria-label={tr("$LEMON right now", "$LEMON прямо сейчас")}>
        <div className="live-head">
          <h2>{tr("The coin is real, and it is alive", "Монета настоящая, и она живёт")}</h2>
          <span className={ok ? "coin-live" : "coin-live off"}><i />{ok ? tr(`read from NEAR testnet at ${readAt} · again every 30 s`, `прочитано из сети NEAR testnet в ${readAt} · обновляется каждые 30 с`) : coin === "wait" ? tr("reading the network…", "читаем сеть…") : tr("the network did not answer", "сеть не ответила")}</span>
        </div>
        <dl className="live-nums">
          <div><dd>{ok ? fmt(coin.supply) : "—"}</dd><dt>{ok && coin.ceiling ? tr(`LEMON exist in the world, of at most ${fmt(coin.ceiling)} ever`, `LEMON существует в мире; больше ${fmt(coin.ceiling)} не будет никогда`) : tr("LEMON exist in the world", "LEMON существует в мире")}</dt></div>
          <div><dd className="burn">{st ? `−${fmt(st.totalBurned)}` : "—"}</dd><dt>{tr("burned in panics and fees", "сгорело в паниках и на комиссиях")}</dt></div>
          <div><dd className="mint">{st ? `+${fmt(st.totalMinted)}` : "—"}</dd><dt>{tr("printed by rescues and interest", "напечатано при спасениях и процентами")}</dt></div>
          <div><dd>{st ? st.roundsFallen : "—"}</dd><dt>{tr("times the bank has fallen", "раза банк уже рушился")}</dt></div>
        </dl>
        <p className="live-more">{tr("The picture above is an example with round numbers. These are the real ones.", "Картинка выше — пример с круглыми числами. А это настоящие.")}{" "}
          <a href="#bank">{tr("The bank, live: what Leo says and every coin printed or burned →", "Банк вживую: что говорит Лео и каждая напечатанная и сгоревшая монета →")}</a></p>
      </section>

      <section className="next" aria-label={tr("What you can do", "Что можно сделать")}>
        <h2>{tr("What you can do", "Что можно сделать")}</h2>
        <div className="next-two">
          <a className="next-card main" href="#play">
            <span className="chip sim">{tr("a game · nothing needed", "игра · ничего не нужно")}</span>
            <h3>{tr("Run the bank as Leo", "Побудь банкиром Лео")}</h3>
            <p>{tr("Ten days in his chair. Journalists ask, you answer, and the sixty depositors decide whether to run. Three minutes.", "Десять дней в его кресле. Журналисты спрашивают, ты отвечаешь, а шестьдесят вкладчиков решают, бежать или нет. Три минуты.")}</p>
            <b>{tr("Play →", "Играть →")}</b>
          </a>
          <a className="next-card" href="#coins">
            <span className="chip real">{tr("real · NEAR testnet", "настоящее · NEAR testnet")}</span>
            <h3>{tr("Get the coin and be a depositor", "Возьми монету и стань вкладчиком")}</h3>
            <p>{tr("The bank gives you 1,000 test LEMON. Put them in the real bank and decide: stay, or take them out. Free, no wallet.", "Банк выдаст тебе 1 000 тестовых LEMON. Положи их в настоящий банк и решай: остаться или забрать. Бесплатно, без кошелька.")}</p>
            <b>{tr("My coins →", "Мои монеты →")}</b>
          </a>
        </div>
      </section>

      <section className="faq" id="faq" aria-label={tr("Questions", "Вопросы")}>
        <h2>{tr("What a newcomer asks", "Что спрашивает новичок")}</h2>
        <dl>
          {FAQ.map((x) => (
            <div key={x.q[0]}>
              <dt>{x.q[L]}</dt>
              <dd>{x.a[L].replace("{supply}", supplyLine).replace("{ceiling}", ceilingLine)}{x.link && <> <a href={x.link.href} target="_blank" rel="noreferrer">{x.link.text[L]} ↗</a></>}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
