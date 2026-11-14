/**
 * "Your $LEMON": how a visitor gets the coin and what they can do with it at the real bank, one step at a time.
 *
 *   step 1  get 1,000 test LEMON (the page makes a throwaway testnet account; nothing is needed beforehand)
 *   step 2  put some of it into the bank
 *   step 3  you are a depositor: watch the bank, move it one bank day forward, or take everything out
 *
 * Each step has one main button and says three things before it is pressed: what is needed, what will happen, and
 * where the result shows. Every result names the network and links to its record in the explorer. Everything else
 * a depositor may do (speak, spread a rumour, insure) is under "More actions".
 *
 * These are real transactions on NEAR testnet, signed by the invisible guest account (chain/guest.ts, loaded on the
 * first click). One transaction at a time: two signed at once would share a nonce.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RU, span, tr } from "../lang";
import { rumorLabel } from "../ruText";
import { CONTRACT, EXPLORER } from "./rpc";
import {
  AIRDROP_LEMON, DEFAULT_DEPOSIT, INSURE_PREMIUM, LOBBY_FEE, MAX_SPEECH_BYTES, RUMOR_FEE, RUMOR_KINDS,
  amountArg, bankArgs, bankView, byteLength, fmtLemon as fmtPlain, speechArg, storedGuestId, isPublicGuest, waitText,
} from "./bankView";

/** An amount the way the reader's language writes it: 1,000 in English, 1 000 in Russian. */
const fmtLemon = (x: bigint): string => (RU ? fmtPlain(x).replace(/,/g, "\u00a0") : fmtPlain(x));
import { refreshBank, refreshMe, setGone, useBank, useMe, useNow } from "./live";
import { LeoClock } from "./LeoClock";

type Act = "airdrop" | "deposit" | "withdraw_all" | "lobby" | "rumor" | "insure" | "advance_epoch";
interface Snapshot { wallet: bigint; deposit: bigint }
type Result = { act: Act; ok: true; txHash: string; note: string; before: Snapshot | null } | { act: Act; ok: false; error: string; txHash?: string };
interface Busy { act: Act; stage: "guest" | "sending"; creating: boolean; sub?: string }

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const txUrl = (h: string) => `${EXPLORER}/txns/${encodeURIComponent(h)}`;

/** The three things to know before pressing: what is needed, what will happen, where the result shows. */
function Facts({ need, will, see }: { need: ReactNode; will: ReactNode; see: ReactNode }) {
  return (
    <dl className="w-facts">
      <div><dt>{tr("You need", "Что нужно")}</dt><dd>{need}</dd></div>
      <div><dt>{tr("What happens", "Что произойдёт")}</dt><dd>{will}</dd></div>
      <div><dt>{tr("Where to see it", "Где увидеть результат")}</dt><dd>{see}</dd></div>
    </dl>
  );
}

/** Where every action on this block goes: the network and the contract, with the contract's page in the explorer. */
export function NetLine() {
  return (
    <p className="w-net">
      <span className="chip real">{tr("real · NEAR testnet", "настоящее · NEAR testnet")}</span>{" "}
      {tr("Every button here sends a real transaction to the test network of the NEAR blockchain, to the bank's program", "Каждая кнопка здесь отправляет настоящую операцию в тестовую сеть блокчейна NEAR, в программу банка")}{" "}
      <a className="mono" href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}</a>.{" "}
      {tr("Test coins have no price: they cannot be bought or sold.", "Тестовые монеты не имеют цены: их нельзя купить или продать.")}
    </p>
  );
}

export function Wallet() {
  const { s: state } = useBank();
  const { guestId, gone, acct, err: acctErr } = useMe();
  const now = useNow();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [last, setLast] = useState<Result | null>(null);
  const [amount, setAmount] = useState(DEFAULT_DEPOSIT);
  const [speech, setSpeech] = useState("");

  const alive = useRef(true);
  const sending = useRef(false);
  const followUp = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(followUp.current); }; }, []);

  const v = bankView(acct?.value ?? null, state, now);

  /** Sign and send one call from the guest account, then show what came of it and re-read the account and the bank. */
  async function act(a: Act, method: string, args: object, note: string, opts: { create?: boolean; sub?: string; then?: () => void } = {}) {
    if (sending.current) return;
    sending.current = true;
    const creating = opts.create === true;
    const before: Snapshot | null = acct ? { wallet: v.wallet, deposit: v.deposit } : null;
    setBusy({ act: a, stage: "guest", creating, sub: opts.sub });
    setLast(null);
    let res: Result, isGone = false;
    try {
      const guest = await import("./guest");
      const out = await guest.callBank(method, args, { create: creating, onStage: (stage) => { if (alive.current) setBusy({ act: a, stage, creating, sub: opts.sub }); } });
      if (out.ok) res = { act: a, ok: true, txHash: out.txHash, note, before };
      else if (method === "airdrop" && /already claimed/i.test(out.error) && isPublicGuest(storedGuestId(storage()))) {
        // the faucet refused a personal account, so the page fell back to the shared public guest, whose airdrop was
        // claimed when it was set up: the account is open and already holds test LEMON
        res = { act: a, ok: true, txHash: out.txHash ?? "", before: null, note: tr("The testnet faucet is not giving out new accounts right now, so you are on the shared public guest account. It already holds test LEMON.",
          "Кран тестовой сети сейчас не выдаёт новые счета, поэтому ты на общем гостевом счёте. На нём уже есть тестовые LEMON.") };
      }
      else { res = { act: a, ok: false, error: out.error, txHash: out.txHash }; isGone = out.code === "gone"; }
    } catch (e) {
      // the signing module is a separate chunk: offline, or a deploy replaced it under an open page
      const why = String((e as Error)?.message ?? e).slice(0, 160);
      res = { act: a, ok: false, error: tr(`The signing code could not be loaded (${why}). Check the connection and try again.`, `Не удалось загрузить код подписи (${why}). Проверь соединение и попробуй ещё раз.`) };
    }
    sending.current = false;
    if (!alive.current) return;
    setBusy(null);
    setLast(res);
    if (isGone) { setGone(true); return; }
    if (!res.ok) { refreshMe(); return; } // a refusal changes nothing, a lost answer may have: look
    setGone(false);
    opts.then?.();
    // now, and once more when the block has had time to reach every endpoint
    const refresh = () => { refreshMe(); refreshBank(); };
    refresh();
    clearTimeout(followUp.current);
    followUp.current = setTimeout(refresh, 2500);
  }

  const label = (a: Act, idle: string, sub?: string) =>
    busy?.act === a && busy.sub === sub
      ? busy.stage === "guest" && busy.creating ? tr("Creating your account…", "Создаём твой счёт…") : tr("Sending to NEAR testnet…", "Отправляем в NEAR testnet…")
      : idle;
  const off = busy !== null;
  const dep = amountArg(amount);
  const say = speechArg(speech);
  const sayBytes = byteLength(speech.trim());
  const airdropNote = tr(`The bank gave you ${fmtLemon(BigInt(AIRDROP_LEMON))} test LEMON.`, `Банк выдал тебе ${fmtLemon(BigInt(AIRDROP_LEMON))} тестовых LEMON.`);
  const hasAccount = !!guestId && !gone;
  const step: 1 | 2 | 3 = !hasAccount ? 1 : !acct ? 1 : v.airdropAvailable && v.empty ? 1 : v.deposit === 0n ? 2 : 3;
  const reading = hasAccount && !acct && !acctErr;
  const rate = state ? (Number(state.policy.rate) / 100).toFixed(2) : null;
  const daySec = state ? Math.round(state.epoch_ms / 1000) : 30;
  const maxDep = dep !== null && BigInt(dep) > v.wallet;

  const getCoin = () => void act("airdrop", "airdrop", bankArgs.airdrop(), airdropNote, { create: !hasAccount });
  const doDeposit = () => dep && void act("deposit", "deposit", bankArgs.deposit(dep), tr(`${fmtLemon(BigInt(dep))} LEMON moved from your wallet into the bank.`, `${fmtLemon(BigInt(dep))} LEMON перешли из кошелька во вклад.`));
  const doRun = () => void act("withdraw_all", "withdraw_all", bankArgs.withdraw_all(), tr("The bank paid your deposit out to your wallet.", "Банк выплатил вклад тебе в кошелёк."));
  const doDay = () => void act("advance_epoch", "advance_epoch", bankArgs.advance_epoch(), tr("A new bank day began: interest was added to every deposit and the loans were checked.", "Начался новый банковский день: на все вклады начислены проценты, кредиты проверены."));

  const STEPS: Array<[string, string]> = [
    [tr("Get the coin", "Получи монету"), tr("free, one click", "бесплатно, одно нажатие")],
    [tr("Put it in the bank", "Положи в банк"), tr("become a depositor", "стань вкладчиком")],
    [tr("Watch and decide", "Следи и решай"), tr("stay, speak or run", "остаться, говорить или бежать")],
  ];

  return (
    <section className="card wallet" id="realbank" aria-label={tr("Your $LEMON", "Твои $LEMON")}>
      <div className="w-top">
        <h2 className="sec-title">{tr("Your $LEMON", "Твои $LEMON")}</h2>
        <ol className="w-steps" aria-label={tr("Steps", "Шаги")}>
          {STEPS.map(([name, sub], i) => (
            <li key={name} className={i + 1 === step ? "now" : i + 1 < step ? "done" : ""} aria-current={i + 1 === step ? "step" : undefined}>
              <span className="w-n">{i + 1 < step ? "✓" : i + 1}</span><span><b>{name}</b><small>{sub}</small></span>
            </li>
          ))}
        </ol>
      </div>
      <NetLine />

      {hasAccount && (
        <div className="w-bal" aria-live="polite">
          {acct ? (
            <>
              <div><span>{tr("In your wallet", "В кошельке")}</span><b>{fmtLemon(v.wallet)}</b><small>LEMON</small></div>
              <div><span>{tr("In the bank (deposit)", "В банке (вклад)")}</span><b>{fmtLemon(v.deposit)}</b><small>LEMON</small></div>
              {v.insured > 0n && <div><span>{tr("Insured this round", "Застраховано в этом раунде")}</span><b>{fmtLemon(v.insured)}</b><small>LEMON</small></div>}
            </>
          ) : acctErr ? (
            <p className="w-res bad" role="alert">
              {tr(`Could not read your balance from NEAR testnet (${acctErr}).`, `Не удалось прочитать баланс из NEAR testnet (${acctErr}).`)}{" "}
              <button className="board-retry" onClick={() => refreshMe()}>{tr("Try again", "Попробовать снова")}</button>
            </p>
          ) : <p className="muted">{tr("Reading your balance from NEAR testnet…", "Читаем твой баланс из NEAR testnet…")}</p>}
          <p className="w-acct">
            {tr("Your account", "Твой счёт")}: <a className="mono" href={`${EXPLORER}/address/${encodeURIComponent(guestId!)}`} target="_blank" rel="noreferrer">{guestId}</a>{" "}
            {isPublicGuest(guestId) && <span className="chip" title={tr("Its only key is a function-call key limited to the bank's player methods, published in the repository on purpose: it cannot move NEAR, add keys or deploy code. Other visitors may be using the same account.", "Его единственный ключ — ограниченный: он вызывает только методы банка и намеренно опубликован в репозитории. Он не может переводить NEAR, добавлять ключи или менять код. Этим же счётом могут пользоваться другие посетители.")}>{tr("shared guest account: other visitors use it too", "общий гостевой счёт: им пользуются и другие посетители")}</span>}{" "}
            <span className="muted">{tr("· open it in the explorer to see every operation · the key lives only in this browser", "· открой в обозревателе, чтобы увидеть все операции · ключ хранится только в этом браузере")}</span>
            {acct && acctErr && <span className="muted"> · {tr("last refresh failed, showing the previous read", "последнее обновление не удалось, показано прошлое")}</span>}
          </p>
        </div>
      )}

      {last && (
        last.ok ? (
          <div className="w-result" role="status">
            <span className="chip ok">{tr("done · real operation on NEAR testnet", "прошло · настоящая операция в NEAR testnet")}</span>
            <p>{last.note}{" "}
              {last.before && acct && (last.before.wallet !== v.wallet || last.before.deposit !== v.deposit) && (
                <span className="w-delta">
                  {tr("Wallet", "Кошелёк")} {fmtLemon(last.before.wallet)} → <b>{fmtLemon(v.wallet)}</b> · {tr("deposit", "вклад")} {fmtLemon(last.before.deposit)} → <b>{fmtLemon(v.deposit)}</b>
                </span>
              )}
            </p>
            {last.txHash && <a href={txUrl(last.txHash)} target="_blank" rel="noreferrer">{tr("See the record in the explorer", "Посмотреть запись в обозревателе")} ↗</a>}
          </div>
        ) : (
          <div className="w-result bad" role="alert">
            <span className="chip bad">{tr("did not happen", "не прошло")}</span>
            <p>{last.error}</p>
            {last.txHash && <a href={txUrl(last.txHash)} target="_blank" rel="noreferrer">{tr("See the record in the explorer", "Посмотреть запись в обозревателе")} ↗</a>}
          </div>
        )
      )}

      {gone && guestId && (
        <p className="w-res bad" role="alert">
          {tr("The account kept in this browser is no longer on testnet (it was deleted or the network was reset):", "Счёта из этого браузера больше нет в тестовой сети (его удалили или сеть сбросили):")} <span className="mono">{guestId}</span>
        </p>
      )}

      {!reading && step === 1 && (
        <div className="w-step">
          <h3>{tr(`Step 1. Get ${fmtLemon(BigInt(AIRDROP_LEMON))} $LEMON, free`, `Шаг 1. Получи ${fmtLemon(BigInt(AIRDROP_LEMON))} $LEMON бесплатно`)}</h3>
          <Facts
            need={tr("Nothing. No wallet, no sign-up, no money.", "Ничего. Ни кошелька, ни регистрации, ни денег.")}
            will={hasAccount
              ? tr(`The bank's program prints ${fmtLemon(BigInt(AIRDROP_LEMON))} new test LEMON onto your account: that is how a newcomer comes in. It takes a few seconds.`, `Программа банка напечатает на твой счёт ${fmtLemon(BigInt(AIRDROP_LEMON))} новых тестовых LEMON: так в банк входит каждый новичок. Это несколько секунд.`)
              : tr(`This page opens an account for you on NEAR testnet, and the bank's program prints ${fmtLemon(BigInt(AIRDROP_LEMON))} new test LEMON onto it: that is how a newcomer comes in. It takes 5 to 15 seconds.`, `Страница откроет для тебя счёт в тестовой сети NEAR, и программа банка напечатает на него ${fmtLemon(BigInt(AIRDROP_LEMON))} новых тестовых LEMON: так в банк входит каждый новичок. Это 5–15 секунд.`)}
            see={tr("Your balance appears right here and at the top of the page, with a link to the record in the network's explorer.", "Баланс появится прямо здесь и вверху страницы, со ссылкой на запись в обозревателе сети.")}
          />
          <div className="row">
            <button className="primary" disabled={off} onClick={getCoin}>
              {label("airdrop", last && !last.ok && last.act === "airdrop" ? tr("Try again: get the coin", "Попробовать снова: получить монету") : tr(`Get ${fmtLemon(BigInt(AIRDROP_LEMON))} $LEMON`, `Получить ${fmtLemon(BigInt(AIRDROP_LEMON))} $LEMON`))}
            </button>
            <span className="small muted">{tr("once per account", "один раз на счёт")}</span>
          </div>
          <p className="w-buy">
            <b>{tr("Can I buy $LEMON? Why is it free?", "Можно ли купить $LEMON? Почему бесплатно?")}</b>{" "}
            {tr("No, and nobody can. It is a test coin: it has no price, it is not sold anywhere, and we do not sell it. Why is it free, then? Because nothing here is real money: on a test network the bank's program hands every new account the same 1,000 coins, once. With real money the way in would be paid.",
              "Нет, и никто не может. Это тестовая монета: у неё нет цены, она нигде не продаётся, и мы её не продаём. Почему тогда бесплатно? Потому что настоящих денег здесь нет: в тестовой сети программа банка выдаёт каждому новому счёту одну и ту же тысячу монет, один раз. На настоящих деньгах вход был бы платным.")}
          </p>
        </div>
      )}

      {!reading && step === 2 && (
        <div className="w-step">
          <h3>{tr("Step 2. Put your coins in the bank", "Шаг 2. Положи монеты в банк")}</h3>
          <Facts
            need={tr(`LEMON in your wallet. You have ${fmtLemon(v.wallet)}.`, `LEMON в кошельке. У тебя ${fmtLemon(v.wallet)}.`)}
            will={<>
              {tr("The coins move from your wallet into your deposit.", "Монеты перейдут из кошелька во вклад.")}{" "}
              {rate !== null && tr(`The deposit grows by ${rate}% every bank day (${span(daySec)}).`, `Вклад растёт на ${rate}% каждый банковский день (${span(daySec)}).`)}{" "}
              {tr("The bigger your deposit, the more the town believes your words. The risk: if too many depositors take their money at once, the bank falls and those who stayed share what is left.",
                "Чем больше вклад, тем больше город верит твоим словам. Риск: если слишком многие заберут деньги разом, банк рухнет, и оставшиеся поделят то, что осталось.")}
            </>}
            see={tr("The \"In the bank\" number above, and a link to the record in the explorer. The bank counts deposits in shares, so the number may show 1 LEMON less than you put in.", "Число «В банке» выше и ссылка на запись в обозревателе. Банк считает вклады долями, поэтому число может оказаться на 1 LEMON меньше внесённого.")}
          />
          {v.collapsed
            ? <p className="w-res bad">{tr("The bank has fallen and is closed until the next bank day, when it is rescued. Deposits are not accepted right now.", "Банк рухнул и закрыт до следующего банковского дня, когда его спасут. Сейчас вклады не принимаются.")}</p>
            : v.wallet === 0n
              ? <p className="w-res bad">{tr("Your wallet is empty, so there is nothing to deposit.", "Кошелёк пуст, положить нечего.")}</p>
              : (
                <div className="row">
                  <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={dep === null || maxDep}
                    aria-label={tr("Amount to deposit, LEMON", "Сумма вклада, LEMON")} />
                  <button className="primary" disabled={off || dep === null || maxDep} onClick={doDeposit}>
                    {label("deposit", dep !== null ? tr(`Put ${fmtLemon(BigInt(dep))} LEMON in the bank`, `Положить ${fmtLemon(BigInt(dep))} LEMON в банк`) : tr("Put in the bank", "Положить в банк"))}
                  </button>
                  {maxDep && <span className="small muted">{tr(`you have ${fmtLemon(v.wallet)}`, `у тебя ${fmtLemon(v.wallet)}`)}</span>}
                </div>
              )}
        </div>
      )}

      {!reading && step === 3 && (
        <div className="w-step">
          <h3>{tr("Step 3. You are a depositor. Watch the bank and decide", "Шаг 3. Ты вкладчик. Следи за банком и решай")}</h3>
          {state && (
            <p className="w-status">
              {state.collapsed
                ? <b className="bad">{tr("The bank has fallen. It is rescued on the next bank day.", "Банк рухнул. В следующий банковский день его спасут.")}</b>
                : <>{tr("The vault holds", "В сейфе")} <b>{(Number(state.reserve_permille) / 10).toFixed(1)}%</b> {tr("of what the bank owes depositors", "от того, что банк должен вкладчикам")} · {tr("your deposit earns", "твой вклад приносит")} <b>{rate}%</b> {tr("per bank day", "за банковский день")}</>}
              {" · "}{tr("bank day", "банковский день")} <b>№{state.epoch_id}</b>
            </p>
          )}
          <div className="w-choice">
            <div>
              <Facts
                need={v.epochDue ? tr("Nothing: the current bank day is over. Anyone may start the next one.", "Ничего: текущий банковский день закончился. Начать следующий может любой.")
                  : v.epochInSec === null ? tr("The bank's clock.", "Часы банка.") : tr(`To wait ${waitText(v.epochInSec, false)}: the current bank day is still running.`, `Подождать ${waitText(v.epochInSec, true)}: текущий банковский день ещё идёт.`)}
                will={tr("The bank adds interest to every deposit, yours too, and checks its loans.", "Банк начислит проценты на все вклады, в том числе на твой, и проверит свои кредиты.")}
                see={tr("Your deposit above grows; the record is in the explorer.", "Твой вклад выше вырастет; запись — в обозревателе.")}
              />
              <button className="primary" disabled={off || !v.epochDue} onClick={doDay}>
                {label("advance_epoch", v.epochDue || v.epochInSec === null ? tr("Start the next bank day", "Начать следующий банковский день") : tr(`Next bank day in ${waitText(v.epochInSec, false)}`, `Следующий день через ${waitText(v.epochInSec, true)}`))}
              </button>
            </div>
            <div>
              <Facts
                need={tr(`A deposit. You have ${fmtLemon(v.deposit)} LEMON in the bank.`, `Вклад. У тебя в банке ${fmtLemon(v.deposit)} LEMON.`)}
                will={<>{tr("The bank pays your whole deposit back to your wallet (or as much as the chair's daily limit lets out). If the vault runs dry, the bank sells loans at a loss and coins burn.", "Банк вернёт весь вклад тебе в кошелёк (или столько, сколько пропустит дневной лимит председателя). Если в сейфе не хватит, банк продаст кредиты в убыток, и монеты сгорят.")}
                  {" "}{v.earlyFee
                    ? <b>{tr("Your deposit has not stayed a full bank day yet: taking it out now pays back today's interest (the early-withdrawal fee, it burns).", "Вклад ещё не пролежал полный банковский день: если забрать сейчас, вернёшь проценты за этот день (сбор за ранний вывод, он сгорает).")}</b>
                    : tr("Money taken out in the first bank day after a deposit pays back that day's interest.", "Деньги, забранные в первый банковский день после вклада, возвращают проценты за этот день.")}</>}
                see={tr("The wallet number above grows, the deposit becomes 0.", "Число «В кошельке» выше вырастет, вклад станет 0.")}
              />
              <button className="run" disabled={off} onClick={doRun}>{label("withdraw_all", tr("Take everything out (run)", "Забрать всё (бежать)"))}</button>
            </div>
          </div>
          <LeoClock s={state} now={now} />
        </div>
      )}

      {reading && <p className="muted">{tr("Reading your account…", "Читаем твой счёт…")}</p>}
      {off && <p className="small muted" role="status">{tr("Waiting for the network to confirm: a few seconds.", "Ждём подтверждения сети: несколько секунд.")}</p>}

      {!reading && step >= 2 && acct && (
        <details className="w-more">
          <summary>{tr("More actions: speak to the town, spread a rumour, insure", "Ещё действия: обратиться к городу, пустить слух, застраховаться")}</summary>
          <div className="w-act">
            <div className="row">
              <input className="grow" value={speech} onChange={(e) => setSpeech(e.target.value)} aria-invalid={sayBytes > MAX_SPEECH_BYTES}
                placeholder={tr("What the chair and the town should hear", "Что должны услышать председатель и город")}
                aria-label={tr("Your speech", "Твоя речь")} />
              <span className={`rb-count${sayBytes > MAX_SPEECH_BYTES ? " over" : ""}`}>{sayBytes}/{MAX_SPEECH_BYTES}</span>
              <button disabled={off || say === null} onClick={() => say !== null && void act("lobby", "lobby", bankArgs.lobby(say),
                tr("Your words are written on chain; the chair and the other depositors read them from the bank.", "Твои слова записаны в сети; председатель и другие вкладчики читают их из банка."), { then: () => setSpeech("") })}>
                {label("lobby", tr("Speak", "Сказать"))}
              </button>
            </div>
            <p className="small muted">{tr(`Costs ${LOBBY_FEE} LEMON from your wallet (burned). Up to ${MAX_SPEECH_BYTES} bytes, at most 2 per bank day. Everyone sees it in "The real bank" below, next to the chair's statement.`, `Стоит ${LOBBY_FEE} LEMON из кошелька (сгорают). До ${MAX_SPEECH_BYTES} байт, не больше 2 за банковский день. Все видят это в блоке «Настоящий банк» ниже, рядом с заявлением председателя.`)}</p>
          </div>
          <div className="w-act">
            <div className="row">
              <span className="rb-label">{tr("Spread a rumour:", "Пустить слух:")}</span>
              {RUMOR_KINDS.map((kind) => (
                <button key={kind} disabled={off} onClick={() => void act("rumor", "rumor", bankArgs.rumor(kind),
                  tr(`The rumour is out: ${rumorLabel(kind)}.`, `Слух пущен: ${rumorLabel(kind)}.`), { sub: kind })}>
                  {label("rumor", rumorLabel(kind), kind)}
                </button>
              ))}
            </div>
            <p className="small muted">{tr(`Costs ${RUMOR_FEE} LEMON from your wallet (burned). The depositors hear it and may get nervous.`, `Стоит ${RUMOR_FEE} LEMON из кошелька (сгорают). Вкладчики его услышат и могут занервничать.`)}</p>
          </div>
          <div className="w-act">
            <div className="row">
              <button disabled={off || v.collapsed} onClick={() => void act("insure", "insure", bankArgs.insure(INSURE_PREMIUM),
                tr(`You are insured for ${INSURE_PREMIUM} LEMON this round.`, `Ты застрахован на ${INSURE_PREMIUM} LEMON в этом раунде.`))}>
                {label("insure", tr(`Insure for ${INSURE_PREMIUM} LEMON`, `Застраховаться на ${INSURE_PREMIUM} LEMON`))}
              </button>
            </div>
            <p className="small muted">{tr(`Costs ${INSURE_PREMIUM} LEMON from your wallet. Pays three times that if the bank falls before the round ends (a round is 10 bank days); otherwise the premium stays in the bank.`, `Стоит ${INSURE_PREMIUM} LEMON из кошелька. Вернёт втрое больше, если банк рухнет до конца раунда (раунд — 10 банковских дней); иначе взнос остаётся в банке.`)}</p>
          </div>
          {step === 3 && !v.collapsed && v.wallet > 0n && (
            <div className="w-act">
              <div className="row">
                <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={dep === null || maxDep} aria-label={tr("Amount to deposit, LEMON", "Сумма вклада, LEMON")} />
                <button disabled={off || dep === null || maxDep} onClick={doDeposit}>{label("deposit", tr("Add to the deposit", "Довнести во вклад"))}</button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="w-act">
              <div className="row">
                <button disabled={off || !v.epochDue} onClick={doDay}>{label("advance_epoch", tr("Start the next bank day", "Начать следующий банковский день"))}</button>
                <span className="small muted">{v.epochInSec === null ? "" : v.epochDue ? tr("the current one is over: anyone may", "текущий закончился: может любой") : tr(`in ${v.epochInSec} s`, `через ${v.epochInSec} с`)}</span>
              </div>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

/**
 * The visitor's coin in the top bar, once there is one: the balance, on every screen, so "where is my balance?"
 * has an answer at any moment. With no coin yet it shows nothing: the "My coins" screen is one click away.
 */
export function WalletChip({ href = "#coins" }: { href?: string }) {
  const { guestId, gone, acct } = useMe();
  const v = bankView(acct?.value ?? null, null, 0);
  const has = !!guestId && !gone && acct !== null && !(v.airdropAvailable && v.empty);
  if (!has) return null;
  return (
    <a className="wchip has" href={href} title={tr("Your $LEMON at the real bank on NEAR testnet", "Твои $LEMON в настоящем банке, NEAR testnet")}>
      <span className="lemon" />
      <span>{fmtLemon(v.wallet)} <small>{tr("wallet", "кошелёк")}</small> · {fmtLemon(v.deposit)} <small>{tr("in the bank", "в банке")}</small></span>
    </a>
  );
}
