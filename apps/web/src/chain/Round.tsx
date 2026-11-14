/**
 * "This round of the real bank": the live bank played as a season. Which round and day it is, how a round ends, how
 * far the town believes Leo (the same Trust as in the game, kept by the contract), and who holds the most $LEMON at
 * the bank right now, the visitor included. Reads only: `get_state` (shared, live.ts) and `get_depositors` once a
 * minute while the card is on screen.
 */
import { useEffect, useState } from "react";
import { tr } from "../lang";
import { CONTRACT, EXPLORER, viewCall } from "./rpc";
import { useBank, useMe } from "./live";
import { DAYS_PER_ROUND, rankHolders, roundInfo, type Board, type DepositorRow } from "./season";

const PAGE = 200, MAX_PAGES = 5;
const fmt = (x: bigint) => Number(x).toLocaleString("en-US");

async function readHolders(): Promise<DepositorRow[]> {
  const rows: DepositorRow[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = (await viewCall<DepositorRow[]>("get_depositors", { from_index: p * PAGE, limit: PAGE })).value;
    if (!Array.isArray(page)) break;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export function RoundCard() {
  const { s } = useBank();
  const { guestId } = useMe();
  const [rows, setRows] = useState<DepositorRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) {
        try { const r = await readHolders(); if (live) { setRows(r); setErr(null); } }
        catch (e) { if (live) setErr(String((e as Error)?.message ?? e)); }
      }
      if (live) timer = setTimeout(() => void poll(), 60_000);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  if (!s) return null;
  const r = roundInfo(s);
  const board: Board | null = rows ? rankHolders(rows, CONTRACT, guestId) : null;
  return (
    <section className="card round" aria-labelledby="round-title">
      <div className="eyebrow">{tr("This round of the real bank · NEAR testnet", "Этот раунд настоящего банка · NEAR testnet")}</div>
      <h2 className="sec-title" id="round-title">
        {r.collapsed ? tr(`Round ${r.round}: the bank has fallen`, `Раунд ${r.round}: банк рухнул`) : tr(`Round ${r.round} · day ${r.day} of ${DAYS_PER_ROUND}`, `Раунд ${r.round} · день ${r.day} из ${DAYS_PER_ROUND}`)}
      </h2>
      <div className="round-days" aria-hidden="true">
        {Array.from({ length: DAYS_PER_ROUND }, (_, i) => <span key={i} className={i < r.day - 1 ? "past" : i === r.day - 1 ? (r.collapsed ? "fell" : "now") : ""} />)}
      </div>
      <p className="round-rule">
        {r.collapsed
          ? tr("Everyone who was still inside shares what was left; the next bank day a rescue prints a new vault and round " + (r.round + 1) + " begins. Take your share with any action, or anyone can settle it for you.",
            "Все, кто оставался внутри, делят то, что осталось; в следующий банковский день спасение напечатает новый сейф, и начнётся раунд " + (r.round + 1) + ". Свою долю получишь любым действием, или кто угодно рассчитает её за тебя.")
          : tr(`A round is ${DAYS_PER_ROUND} bank days. If the bank still stands after day ${DAYS_PER_ROUND}, everyone inside has kept every day's interest, and a new round starts. If too many run first, the bank falls: those who left early got everything, those still inside share what is left. ${r.left === 0 ? "This is the last day." : `${r.left} ${r.left === 1 ? "day" : "days"} to go.`}`,
            `Раунд — ${DAYS_PER_ROUND} банковских дней. Если после ${DAYS_PER_ROUND}-го дня банк стоит, все, кто внутри, сохранили проценты за каждый день, и начинается новый раунд. Если раньше побегут слишком многие, банк рухнет: ушедшие рано получили всё, оставшиеся делят остаток. ${r.left === 0 ? "Сегодня последний день." : `Осталось дней: ${r.left}.`}`)}
      </p>
      {r.trust !== null && (
        <div className="meter round-trust">
          <div className="meter-top">{tr("Trust in Leo", "Доверие к Лео")} <b>{Math.round(r.trust / 10)}%</b></div>
          <div className="meter-bar"><i style={{ width: `${r.trust / 10}%` }} /></div>
          <p className="small muted">{tr("Kept by the contract, by the game's rule: calm words followed by a run cost him trust; quiet days win it back. The town hears him through it.", "Считает контракт, по правилу из игры: спокойные слова, за которыми последовал отток, стоят ему доверия; тихие дни его возвращают. Город слышит его через это доверие.")}</p>
        </div>
      )}
      <h3 className="round-sub">{tr("Who holds the most $LEMON at the bank", "У кого больше всего $LEMON в банке")}</h3>
      {!board ? <p className="muted small">{err ? tr(`Could not read the holders (${err}); retrying in a minute.`, `Не удалось прочитать держателей (${err}); попробуем через минуту.`) : tr("Reading the holders…", "Читаем держателей…")}</p> : (
        <>
          <ol className="board-list">
            {board.top.map((h, i) => (
              <li key={h.id} className={`board-row${h.kind === "you" ? " me" : ""}`}>
                <span className="board-rank">{i + 1}</span>
                <span className="board-acct"><a href={`${EXPLORER}/address/${encodeURIComponent(h.id)}`} target="_blank" rel="noreferrer">{h.id}</a>
                  {h.kind === "agent" && <span className="tag small">{tr("the bank's agent", "агент банка")}</span>}
                  {h.kind === "you" && <span className="tag small">{tr("you", "ты")}</span>}</span>
                <span className="board-score">{fmt(h.total)} <small className="muted">{tr(`${fmt(h.deposit)} in the bank`, `${fmt(h.deposit)} в банке`)}</small></span>
              </li>
            ))}
          </ol>
          <p className="small muted">
            {board.you
              ? board.you.rank > board.top.length
                ? tr(`You: number ${board.you.rank} of ${board.players}, ${fmt(board.you.holder.total)} LEMON.`, `Ты: ${board.you.rank}-й из ${board.players}, ${fmt(board.you.holder.total)} LEMON.`)
                : tr(`You are number ${board.you.rank} of ${board.players}.`, `Ты ${board.you.rank}-й из ${board.players}.`)
              : tr(`${board.players} holders. Get your 1,000 $LEMON below to join them; whoever reads the town best ends the round with the most.`, `Держателей: ${board.players}. Возьми свои 1000 $LEMON ниже и присоединяйся; кто лучше читает город, закончит раунд с наибольшей суммой.`)}
            {" "}{tr("Wallet, deposit and anything a collapse still owes, as the contract reports them; the simulated crowd's omnibus account is left out.", "Кошелёк, вклад и то, что ещё должен крах, — как их показывает контракт; общий счёт симулированной толпы не учитывается.")}
          </p>
        </>
      )}
    </section>
  );
}
