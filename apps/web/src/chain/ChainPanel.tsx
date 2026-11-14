/**
 * The real bank on NEAR testnet, read live from public RPC: the contract's state, the chair's last signed policy,
 * what the holders' DAO pinned, and the transactions that prove the story (refusals included).
 * This file only reads. The one block that sends transactions is "Your $LEMON" (Wallet.tsx), from the visitor's
 * guest account; after each of them the shared read of the bank (live.ts) is taken again.
 */
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { RU, plural, tr } from "../lang";
import { rumorLabel, toneLabel } from "../ruText";
import { CONTRACT, EXPLORER, OVERRIDES, isMethodMissing, viewCall, type ChainState } from "./rpc";
import { memoLabel, parseStats, parseSupplyLog, supplySteps, type BankStats, type SupplyEntry } from "./board";
import { secondsToEpoch } from "./bankView";
import { useBank, useNow } from "./live";
import { LeoClock } from "./LeoClock";
import evidence from "./evidence.json";

const n = (x: string | number | undefined) => Number(x ?? 0);
const fmt = (x: string | number) => Math.round(n(x)).toLocaleString("en-US");
const short = (h: string, k = 10) => (h.length > 2 * k + 1 ? `${h.slice(0, k)}…${h.slice(-4)}` : h);
const acct = (id: string) => <a href={`${EXPLORER}/address/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">{id}</a>;
const txLink = (h: string) => <a className="mono" href={`${EXPLORER}/txns/${encodeURIComponent(h)}`} target="_blank" rel="noreferrer">{short(h, 8)}</a>;

/** `listed: false` keeps a transaction in the file for `npm run verify:chain` (the README cites it) and off the page. */
interface Evidence { label: string; label_ru?: string; tx: string; note?: string; note_ru?: string; ok: boolean; listed?: boolean }

/**
 * Whatever goes wrong while drawing the testnet panel (an RPC or contract from the address bar that answers with
 * something unexpected) stays inside the panel: the rest of the page keeps working.
 */
class ChainBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as Error)?.message ?? e) }; }
  componentDidCatch(e: unknown, info: ErrorInfo) { console.warn("testnet panel failed", e, info.componentStack); }
  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <section className="card chain" id="testnet" role="alert">
        <div className="eyebrow">{tr("The real bank · NEAR testnet", "Настоящий банк · NEAR testnet")}</div>
        <CustomSource />
        <p className="muted">{tr("The testnet panel could not be shown", "Панель testnet не удалось показать")}: {this.state.error}</p>
        <button onClick={() => this.setState({ error: null })}>{tr("Try again", "Попробовать снова")}</button>
      </section>
    );
  }
}

/** A visible warning when the address bar points the panel at another contract or RPC endpoint. */
function CustomSource() {
  if (!OVERRIDES.contract && !OVERRIDES.rpc) return null;
  return (
    <div className="chain-custom" role="note">
      {OVERRIDES.rpc && OVERRIDES.contract ? tr("Custom RPC and contract (not the project default)", "Свои RPC и контракт (не по умолчанию для проекта)")
        : OVERRIDES.rpc ? tr("Custom RPC (not the project default)", "Свой RPC (не по умолчанию для проекта)")
        : tr("Custom contract (not the project default)", "Свой контракт (не по умолчанию для проекта)")}
      {OVERRIDES.rpc && <> · RPC <span className="mono">{OVERRIDES.rpc}</span></>}
      {OVERRIDES.contract && <> · {tr("contract", "контракт")} <span className="mono">{OVERRIDES.contract}</span></>}
    </div>
  );
}

export function ChainPanel() {
  return <ChainBoundary><ChainPanelInner /></ChainBoundary>;
}

function ChainPanelInner() {
  // the bank's state is read once for the whole page (chain/live.ts): the top bar and "Your $LEMON" show the same read
  const { s, block, err } = useBank();
  const now = useNow();

  const ev = (evidence as { items: Evidence[] }).items.filter((e) => e.listed !== false);

  return (
    <section className="card chain" id="testnet">
      <h2 className="sec-title">{tr("The real bank, live on NEAR testnet", "Настоящий банк — вживую в NEAR testnet")}</h2>
      <div className="eyebrow">
        {tr("Read just now from the NEAR test network · reading only, nothing here sends anything", "Только что прочитано из тестовой сети NEAR · здесь только чтение, ничего не отправляется")}
        {block > 0 && <> · {tr("block", "блок")} {block.toLocaleString("en-US")}</>}
      </div>
      <CustomSource />
      {!s ? <p className="muted">{err ? tr(`Could not read the bank from testnet (${err}); retrying…`, `Не удалось прочитать банк из testnet (${err}); пробуем ещё…`) : tr("Reading the contract…", "Читаем контракт…")}</p> : <ChainBody s={s} now={now} err={err} />}
      <SupplyRecord />
      {ev.length > 0 && (
        <details className="evidence-fold">
          <summary>{tr(`Proof on chain: ${ev.length} transactions anyone can open`, `Доказательства в сети: ${ev.length} операций, каждую можно открыть`)}</summary>
          <ul className="evidence">{ev.map((e) => (
            <li key={e.tx}><span className={`chip ${e.ok ? "ok" : "bad"}`}>{e.ok ? tr("done", "прошло") : tr("refused", "отказ")}</span> {tr(e.label, e.label_ru ?? e.label)} {txLink(e.tx)}
              {e.note && <div className="small muted">{tr(e.note, e.note_ru ?? e.note)}</div>}</li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}

function ChainBody({ s, now, err }: { s: ChainState; now: number; err: string | null }) {
  const liab = Math.max(1, n(s.liabilities));
  const share = Math.min(1, n(s.reserve) / liab);
  const left = secondsToEpoch(s.next_epoch_ms, now) ?? 0; // the same clock the "advance the epoch" button goes by
  const answered = s.policy_set_epoch_id === s.epoch_id;
  const roundCap = Math.floor((n(s.round_start_supply) * 150) / 1000);
  const epochCap = Math.floor((n(s.supply) * 50) / 1000);
  const ceiling = s.max_supply ? n(s.max_supply) : null, room = ceiling === null ? Infinity : Math.max(0, ceiling - n(s.supply));
  return (
    <div className="chain-grid">
      <div>
        <div className="chain-head">
          <b>{tr("Round", "Раунд")} {s.round + 1}</b> · {tr("bank day", "банковский день")} {s.epoch + 1} {tr("of", "из")} 10 · №{s.epoch_id} {tr("since the start", "с начала")}
          {s.collapsed && <span className="chip bad">{tr("COLLAPSED — bailout next epoch", "РУХНУЛ — спасение в следующую эпоху")}</span>}
        </div>
        <div className="vault-bar"><i style={{ width: `${share * 100}%` }} className={n(s.reserve_permille) < 100 ? "low" : ""} /></div>
        <div className="vault-legend"><span>{tr("in the vault", "в хранилище")} <b>{fmt(s.reserve)}</b></span><span>{tr("owed to depositors", "должен вкладчикам")} <b>{fmt(s.liabilities)}</b></span></div>
        <dl>
          <dt>{tr("Lent out", "В кредитах")}</dt><dd>{fmt(s.loans)}</dd>
          <dt>{tr("LEMON in existence", "Всего LEMON")}</dt><dd>{fmt(s.supply)}</dd>
          <dt>{tr("Withdrawn this bank day", "Снято за этот банковский день")}</dt><dd>{fmt(s.outflow)}</dd>
          <dt>{tr("Chair may print", "Председатель может напечатать")}</dt><dd>{fmt(Math.max(0, Math.min(epochCap, roundCap - n(s.minted_this_round), room)))} <span className="muted small">({tr("5% a bank day, 15% a round", "5% за банковский день, 15% за раунд")}{ceiling !== null && tr(", never past the ceiling", ", и не выше потолка")})</span></dd>
          {ceiling !== null && <><dt>{tr("Ceiling: the most LEMON that may ever exist", "Потолок: больше монет не будет никогда")}</dt><dd>{fmt(ceiling)} <span className="muted small">({tr(`${fmt(room)} can still be printed`, `ещё можно напечатать ${fmt(room)}`)})</span></dd></>}
          <dt>{tr("Next bank day", "Следующий банковский день")}</dt><dd>{left > 0 ? tr(`in ${left} s`, `через ${left} с`) : <a href="#coins">{tr("due: anyone may start it →", "пора: начать его может любой →")}</a>}</dd>
        </dl>
        {err && <p className="small muted">{tr("last refresh failed, showing the previous read", "последнее обновление не удалось, показано прошлое")}</p>}
      </div>
      <div>
        <blockquote className={`chain-quote tone-${/^[a-z]+$/.test(s.policy.tone) ? s.policy.tone : "calm"}`}>“{s.policy.statement || tr("(no statement yet)", "(заявлений пока нет)")}”</blockquote>
        <div className="chips">
          <span className={`tone tone-${s.policy.tone}`}>{toneLabel(s.policy.tone)}</span>
          <span>{tr("rate", "ставка")} {(n(s.policy.rate) / 100).toFixed(2)}%</span>
          <span>{tr("reserve target", "цель резерва")} {(n(s.policy.target) / 10).toFixed(1)}%</span>
          {n(s.policy.gate) > 0 && <span className="bad">{tr("gate", "лимит")} {fmt(s.policy.gate)}</span>}
          {n(s.policy.mint) > 0 && <span className="warn">{tr("printed", "напечатано")} {fmt(s.policy.mint)}</span>}
          <span className={answered ? "" : "warn"}>{answered ? tr("set this bank day", "задана в этот банковский день")
            : !s.policy.attestation && !s.policy.statement ? tr("default policy: the chair has not spoken this round", "политика по умолчанию: председатель ещё не выступал в этом раунде")
            : tr(`from bank day ${s.policy_set_epoch_id}`, `с банковского дня №${s.policy_set_epoch_id}`)}</span>
        </div>
        <LeoClock s={s} now={now} />
        <dl className="trust">
          <dt>{tr("Chair account", "Аккаунт председателя")}</dt><dd>{acct(s.chair)}</dd>
          <dt>{tr("Owner (impeaches)", "Владелец (импичмент)")}</dt><dd>{acct(s.owner)}</dd>
          <dt>{tr("Model", "Модель")}</dt><dd className="mono">{s.chair_model || "—"}</dd>
          <dt>{tr("Pinned TEE key", "Закреплённый ключ TEE")}</dt><dd className="mono" title={s.chair_signer ?? ""}>{s.chair_signer ? short(s.chair_signer) : tr("none (unsigned mode)", "нет (без подписи)")}</dd>
          <dt>{tr("Pinned prompt sha256", "sha256 закреплённого промпта")}</dt><dd className="mono" title={s.chair_prompt_sha256 ?? ""}>{s.chair_prompt_sha256 ? short(s.chair_prompt_sha256) : "—"}</dd>
          <dt>{tr("Last signature", "Последняя подпись")}</dt><dd className="mono" title={s.policy.attestation}>{s.policy.attestation ? short(s.policy.attestation, 16) : "—"}</dd>
        </dl>
        {(s.speeches.length > 0 || s.rumors.length > 0) && <ul className="speeches">
          {s.speeches.map((x, i) => <li key={`s${i}`}><b>{x.who}</b> {x.text}</li>)}
          {s.rumors.map((x, i) => <li key={`r${i}`}><b>{x.who}</b> {tr("spread a rumour", "пустил слух")}: {rumorLabel(x.kind)}</li>)}
        </ul>}
        <p className="small muted">
          {tr("Contract", "Контракт")} {acct(CONTRACT)} · {tr("only signed NEAR AI answers to the pinned prompt can set policy; the contract caps every field.", "политику задают только подписанные ответы NEAR AI на закреплённый промпт; каждое поле ограничено контрактом.")}
        </p>
      </div>
    </div>
  );
}

/** One optional view: its value, or that this contract does not have the method, or why the read failed. */
type Opt<T> = { state: "loading" } | { state: "missing" } | { state: "error"; error: string } | { state: "ok"; value: T };

/**
 * The bank's record since the upgrade (`get_stats`) and every mint and burn it has logged (`get_supply_log`).
 * Both views are newer than the first deployment, so each one may be absent: the block then says so and the rest
 * of the panel is unaffected.
 */
function SupplyRecord() {
  const [stats, setStats] = useState<Opt<BankStats>>({ state: "loading" });
  const [log, setLog] = useState<Opt<SupplyEntry[]>>({ state: "loading" });
  const [supply, setSupply] = useState<number | null>(null);

  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    async function read<T>(method: string, parse: (v: unknown) => T, prev: Opt<T>): Promise<Opt<T>> {
      try { return { state: "ok", value: parse((await viewCall<unknown>(method)).value) }; }
      catch (e) {
        if (isMethodMissing(e)) return { state: "missing" };
        return prev.state === "ok" ? prev : { state: "error", error: (e as Error).message }; // a failed refresh keeps the last read
      }
    }
    let s: Opt<BankStats> = { state: "loading" }, l: Opt<SupplyEntry[]> = { state: "loading" };
    const poll = async () => {
      if (!document.hidden) {
        [s, l] = await Promise.all([read("get_stats", parseStats, s), read("get_supply_log", parseSupplyLog, l)]);
        if (!live) return;
        setStats(s); setLog(l);
        try { const n = Number((await viewCall<string>("ft_total_supply")).value); if (live && Number.isFinite(n)) setSupply(n); } catch { /* the chart waits for the next read */ }
      }
      // an older deployment has neither method: look again only now and then
      timer = setTimeout(poll, s.state === "missing" && l.state === "missing" ? 180_000 : 30_000);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  const absent = (o: Opt<unknown>, what: string, whatRu: string) =>
    o.state === "loading" ? <p className="muted small">{tr("Reading…", "Читаем…")}</p>
      : o.state === "missing" ? <p className="muted small">{tr(`${what} not available on this contract yet.`, `${whatRu} на этом контракте пока нет.`)}</p>
      : o.state === "error" ? <p className="muted small">{tr(`Could not read it (${o.error}); retrying…`, `Не удалось прочитать (${o.error}); пробуем ещё…`)}</p>
      : null;
  const since = stats.state === "ok" && stats.value.sinceMs > 0 ? new Date(stats.value.sinceMs).toLocaleDateString(RU ? "ru-RU" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <>
      <div className="eyebrow chain-sub">{tr("The bank's record", "Рекорд банка")}{since && <> · {tr(`since the upgrade, ${since}`, `с обновления, ${since}`)}</>}</div>
      {absent(stats, "The record is", "Рекорда")}
      {stats.state === "ok" && (
        <div className="record">
          <span className="hi">{tr("longest streak", "лучшая серия")} <b>{stats.value.longestStreak}</b> {tr(stats.value.longestStreak === 1 ? "round survived in a row" : "rounds survived in a row", `${plural(stats.value.longestStreak, "раунд", "раунда", "раундов")} подряд без краха`)}</span>
          <span>{tr("current streak", "текущая серия")} <b>{stats.value.currentStreak}</b></span>
          <span>{tr("rounds survived", "выстоял раундов")} <b>{stats.value.roundsSurvived}</b></span>
          <span>{tr("rounds fallen", "рухнул раундов")} <b>{stats.value.roundsFallen}</b></span>
          <span>{tr("minted", "напечатано")} <b>{fmt(stats.value.totalMinted)}</b> LEMON</span>
          <span>{tr("burned", "сожжено")} <b>{fmt(stats.value.totalBurned)}</b> LEMON</span>
        </div>
      )}
      <div className="eyebrow chain-sub">{tr("Every mint and burn", "Каждая эмиссия и каждое сжигание")}{log.state === "ok" && log.value.length > 0 && <> · {tr(`last ${log.value.length}, newest first`, `последние ${log.value.length}, сначала новые`)}</>}</div>
      {absent(log, "The mint and burn log is", "Журнала эмиссии и сжигания")}
      {log.state === "ok" && (log.value.length === 0
        ? <p className="muted small">{tr("No mints or burns since the upgrade yet.", "С обновления ещё не было ни эмиссии, ни сжигания.")}</p>
        : (
          <>
          {supply !== null && <SupplyChart log={log.value} supply={supply} />}
          <div className="supply-scroll" tabIndex={0} role="region" aria-label={tr("Mint and burn log", "Журнал эмиссии и сжигания")}>
            <table className="supply">
              <thead><tr><th>{tr("Bank day", "День банка")}</th><th>{tr("Kind", "Тип")}</th><th className="num">LEMON</th><th>{tr("Why", "Причина")}</th></tr></thead>
              <tbody>{log.value.map((e, i) => (
                <tr key={`${e.epochId}-${i}`}>
                  <td className="num" title={tr(`round ${e.round + 1}`, `раунд ${e.round + 1}`)}>{e.epochId}</td>
                  <td><span className={`chip ${e.kind}`}>{e.kind === "mint" ? tr("mint", "эмиссия") : tr("burn", "сжигание")}</span></td>
                  <td className="num">{e.kind === "mint" ? "+" : "−"}{fmt(e.amount)}</td>
                  <td className="memo">{memoLabel(e.memo, RU)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          </>
        ))}
    </>
  );
}

/**
 * The supply's story as a picture: one bar per epoch, printed above the line and burned below it, to one scale.
 * It is drawn from the same log as the table under it, so every bar can be checked against a row.
 */
function SupplyChart({ log, supply }: { log: SupplyEntry[]; supply: number }) {
  const steps = supplySteps(log, supply);
  if (steps.length < 2) return null;
  const W = 24, H = 132, mid = H / 2, max = Math.max(1, ...steps.map((s) => Math.max(s.minted, s.burned)));
  const h = (n: number) => (n <= 0 ? 0 : Math.max(2, (n / max) * (mid - 6)));
  const first = steps[0], last = steps[steps.length - 1], before = first.after - first.minted + first.burned;
  const top = (kind: "mint" | "burn") => log.filter((e) => e.kind === kind).sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  const bigBurn = top("burn"), bigMint = top("mint");
  return (
    <figure className="supply-chart">
      <svg viewBox={`0 0 ${steps.length * W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={tr(`Mints and burns by epoch, epochs ${first.epochId} to ${last.epochId}`, `Эмиссия и сжигание по эпохам, эпохи ${first.epochId}–${last.epochId}`)}>
        {steps.map((s, i) => (
          <g key={s.epochId}>
            <title>{tr(`epoch ${s.epochId}: +${fmt(s.minted)} printed, −${fmt(s.burned)} burned, ${fmt(s.after)} LEMON after`, `эпоха ${s.epochId}: +${fmt(s.minted)} напечатано, −${fmt(s.burned)} сожжено, после — ${fmt(s.after)} LEMON`)}</title>
            <rect className="hit" x={i * W} y={0} width={W} height={H} />
            {s.minted > 0 && <rect className="mint" x={i * W + 4} y={mid - h(s.minted)} width={W - 8} height={h(s.minted)} rx={2} />}
            {s.burned > 0 && <rect className="burn" x={i * W + 4} y={mid} width={W - 8} height={h(s.burned)} rx={2} />}
          </g>
        ))}
        <line x1={0} x2={steps.length * W} y1={mid} y2={mid} />
      </svg>
      <div className="supply-axis"><span>{tr("epoch", "эпоха")} {first.epochId}</span><span>{tr("printed above the line, burned below", "над линией напечатано, под линией сожжено")}</span><span>{tr("epoch", "эпоха")} {last.epochId}</span></div>
      <figcaption>
        {tr(`Over these ${steps.length} epochs the supply went from ${fmt(before)} to ${fmt(last.after)} LEMON.`, `За эти ${steps.length} ${plural(steps.length, "эпоху", "эпохи", "эпох")} предложение изменилось с ${fmt(before)} до ${fmt(last.after)} LEMON.`)}
        {bigBurn && <> {tr("Largest burn", "Самое большое сжигание")}: <b className="burn">−{fmt(bigBurn.amount)}</b> ({memoLabel(bigBurn.memo, RU)}, {tr("epoch", "эпоха")} {bigBurn.epochId}).</>}
        {bigMint && <> {tr("Largest print", "Самая большая эмиссия")}: <b className="mint">+{fmt(bigMint.amount)}</b> ({memoLabel(bigMint.memo, RU)}, {tr("epoch", "эпоха")} {bigMint.epochId}).</>}
      </figcaption>
    </figure>
  );
}
