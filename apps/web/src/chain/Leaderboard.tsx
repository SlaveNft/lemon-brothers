/**
 * Crisis of the day: the on-chain leaderboard. The contract only records claims ("this account says seed + moves
 * scored N"); this component reads them and re-runs every crisis in the browser (board.ts), so the badge next to a
 * row is this machine's own check, not the contract's word. Read-only: nothing here signs anything.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RU, tr } from "../lang";
import { CONTRACT, EXPLORER, isMethodMissing, viewCall } from "./rpc";
import { parseRuns, verifyRuns, type RunsAnswer } from "./board";

const ENDING: Record<string, [string, string]> = {
  survived: ["the bank stood", "банк выстоял"], run: ["the bank fell", "банк рухнул"],
  impeached: ["impeached", "импичмент"], hyperinflation: ["hyperinflation", "гиперинфляция"],
};
const endingLabel = (e: string) => (ENDING[e] ? ENDING[e][RU ? 1 : 0] : e || "?");

/** The replay link of a claim: the game's own `?seed=…&moves=…` format, keeping a custom contract or RPC. */
function watchHref(seed: number, moves: string): string {
  const u = new URL(location.href), keep = new URLSearchParams();
  for (const k of ["contract", "rpc"]) { const v = u.searchParams.get(k); if (v) keep.set(k, v); }
  keep.set("seed", String(seed)); keep.set("moves", moves);
  return `?${keep.toString()}`;
}

type Load = { state: "loading" } | { state: "missing" } | { state: "error"; error: string } | { state: "ok" };

export function Leaderboard({ refresh = 0, me = null }: { refresh?: number; me?: string | null }) {
  const [data, setData] = useState<RunsAnswer | null>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [nonce, setNonce] = useState(0);
  /** The latest earlier day that has a board (the contract keeps seven): shown under today's, so a visitor on a
   *  quiet day still sees claims being checked, the ones that do not replay included. */
  const [past, setPast] = useState<RunsAnswer | null>(null);
  const earlier = useRef<{ forDay: number; board: RunsAnswer | null } | null>(null);

  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let next = 30_000;
      if (typeof document === "undefined" || !document.hidden) {
        try {
          const r = await viewCall<unknown>("get_runs", {});
          if (!live) return;
          const now = parseRuns(r.value);
          if (now.day > 1 && earlier.current?.forDay !== now.day) {
            earlier.current = { forDay: now.day, board: null };
            for (let d = now.day - 1; d >= Math.max(1, now.day - 6); d--) {
              const before = parseRuns((await viewCall<unknown>("get_runs", { day: d })).value);
              if (!live) return;
              if (before.runs.length) { earlier.current.board = before; break; }
            }
          }
          setData(now); setPast(earlier.current?.board ?? null); setLoad({ state: "ok" });
        } catch (e) {
          if (!live) return;
          if (isMethodMissing(e)) { setData(null); setLoad({ state: "missing" }); next = 120_000; } // an older deployment: look again rarely
          else setLoad({ state: "error", error: (e as Error).message });
        }
      }
      if (live) timer = setTimeout(poll, next);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [refresh, nonce]);

  // the replay is the expensive part (a full crisis per row): redo it only when the claims change
  const key = data ? JSON.stringify(data) : "";
  const rows = useMemo(() => (data ? verifyRuns(data.seed, data.runs) : []), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const pastKey = past ? JSON.stringify(past) : "";
  const pastRows = useMemo(() => (past ? verifyRuns(past.seed, past.runs) : []), [pastKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = rows.filter((r) => !r.verified).length, pastBad = pastRows.filter((r) => !r.verified).length;
  const list = (seed: number, rs: typeof rows) => (
    <ol className="board-list">
      {rs.map((r, i) => (
        <li key={`${r.account}-${i}`} className={`board-row${r.verified ? "" : " fake"}${me && r.account === me ? " mine" : ""}`}>
          <span className="board-rank">{r.rank ?? "—"}</span>
          <a className="board-acct" href={`${EXPLORER}/address/${encodeURIComponent(r.account)}`} target="_blank" rel="noreferrer" title={r.account}>{r.account}</a>
          <span className="board-score"><b>{r.score}</b><span className="muted">/100</span></span>
          <span className="board-meta">
            <span className="board-ending">{endingLabel(r.ending)}</span>
            {me && r.account === me && <span className="chip">{tr("you", "это ты")}</span>}
            {r.verified
              ? <span className="chip ok">{tr("verified by replay", "проверено повтором")}</span>
              : <span className="chip bad">{r.got
                ? tr(`does not replay: this browser got ${r.got.score} (${endingLabel(r.got.ending)})`, `не воспроизводится: в этом браузере вышло ${r.got.score} (${endingLabel(r.got.ending)})`)
                : tr("does not replay: the moves do not make a finished crisis", "не воспроизводится: из этих ходов не получается законченный кризис")}</span>}
            {r.got && <a href={watchHref(seed, r.moves)}>{tr("watch", "смотреть")}</a>}
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <section className="card chain board" id="leaderboard" aria-live="polite">
      <h2 className="sec-title">{tr("Today's leaderboard, kept on chain", "Таблица лидеров дня — в блокчейне")}</h2>
      <div className="eyebrow">
        {tr("Crisis of the day — on-chain leaderboard", "Кризис дня — таблица лидеров в блокчейне")}
        {data && <> · {tr(`crisis #${data.day}`, `кризис №${data.day}`)}</>} · NEAR testnet
      </div>
      <p className="small muted board-why">
        {tr("The contract records claims: an account, its ten moves and the score it says it got. Your browser has just re-run each crisis move by move, so nobody has to trust the board, the contract, or us.",
          "Контракт записывает заявки: аккаунт, его десять ходов и счёт, который он себе приписал. Твой браузер только что переиграл каждый кризис ход за ходом — так что верить на слово не нужно ни таблице, ни контракту, ни нам.")}
      </p>

      {load.state === "missing" && <p className="muted">{tr("The leaderboard is not available on this contract yet.", "На этом контракте таблицы лидеров пока нет.")}</p>}
      {load.state === "loading" && !data && <p className="muted">{tr("Reading the leaderboard from the contract…", "Читаем таблицу лидеров из контракта…")}</p>}
      {load.state === "error" && (
        <p className={data ? "small muted" : "muted"} role="status">
          {data ? tr(`The last refresh failed (${load.error}); showing the previous read.`, `Последнее обновление не удалось (${load.error}); показано прошлое чтение.`)
            : tr(`Could not read the leaderboard (${load.error}).`, `Не удалось прочитать таблицу лидеров (${load.error}).`)}{" "}
          <button className="ghost board-retry" onClick={() => { setLoad(data ? load : { state: "loading" }); setNonce((x) => x + 1); }}>{tr("Try again", "Попробовать снова")}</button>
        </p>
      )}

      {data && rows.length === 0 && <p className="muted">{tr("Nobody has put a result on chain today. Finish today's crisis and be the first.", "Сегодня ещё никто не записал результат в блокчейн. Пройди сегодняшний кризис и будь первым.")}</p>}
      {data && rows.length > 0 && list(data.seed, rows)}
      {data && rows.length > 0 && (
        <p className="small muted">
          {bad === 0
            ? tr(`All ${rows.length} claims replayed to the score they state.`, `Все заявки (${rows.length}) при повторе дали заявленный счёт.`)
            : tr(`${bad} of ${rows.length} claims do not replay to what they state; they are struck through and carry no rank.`, `Заявок, которые не воспроизводятся: ${bad} из ${rows.length}. Они зачёркнуты и не получают места.`)}
        </p>
      )}
      {past && pastRows.length > 0 && (
        <>
          <div className="eyebrow board-past">{tr(`An earlier board · crisis #${past.day}`, `Прошлая таблица · кризис №${past.day}`)}</div>
          {list(past.seed, pastRows)}
          <p className="small muted">
            {pastBad === 0
              ? tr(`All ${pastRows.length} claims replayed to the score they state.`, `Все заявки (${pastRows.length}) при повторе дали заявленный счёт.`)
              : tr(`${pastBad} of ${pastRows.length} claims do not replay to what they state; they are struck through and carry no rank.`, `Заявок, которые не воспроизводятся: ${pastBad} из ${pastRows.length}. Они зачёркнуты и не получают места.`)}
          </p>
        </>
      )}
      {data && (
        <p className="small muted">
          {tr("Contract", "Контракт")} <a href={`${EXPLORER}/address/${encodeURIComponent(CONTRACT)}`} target="_blank" rel="noreferrer">{CONTRACT}</a> · {tr("refreshes every 30 s", "обновляется каждые 30 с")}
        </p>
      )}
    </section>
  );
}
