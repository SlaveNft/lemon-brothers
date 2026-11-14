/**
 * When the chair of the real bank speaks, in three lines: the rule (one statement per bank day), whether he is on
 * air right now (read from the chain), and when the next press conference starts in the visitor's own time
 * (schedule.ts). With no schedule switched on, it says that none is set and what the bank does meanwhile.
 */
import { RU, span, tr } from "../lang";
import type { ChainState } from "./rpc";
import { SCHEDULE, conferenceMs, missed, nextConference, onAir, waitText } from "./schedule";

const clock = (ms: number) => new Date(ms).toLocaleTimeString(RU ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit" });
const dayWord = (ms: number, now: number) => {
  const a = new Date(ms), b = new Date(now);
  return a.toDateString() === b.toDateString() ? tr("today", "сегодня") : tr("tomorrow", "завтра");
};

export function LeoClock({ s, now }: { s: ChainState | null; now: number }) {
  if (!s) return null;
  const air = onAir(s, now), secs = Math.round(s.epoch_ms / 1000);
  const next = nextConference(now), lasts = Math.round(conferenceMs(s.epoch_ms) / 60_000);
  const late = SCHEDULE.active && !air && missed(s, now);
  const every = SCHEDULE.everyMinutes % 60 === 0
    ? (SCHEDULE.everyMinutes === 60 ? tr("every hour", "каждый час") : tr(`every ${SCHEDULE.everyMinutes / 60} h`, `каждые ${SCHEDULE.everyMinutes / 60} ч`))
    : tr(`every ${SCHEDULE.everyMinutes} minutes`, `каждые ${SCHEDULE.everyMinutes} минут`);
  const spoke = s.policy_set_epoch_id > 0 && (s.policy.statement || s.policy.attestation);
  return (
    <div className={`leoclock${air ? " air" : ""}`} role="note" aria-label={tr("When the chair speaks", "Когда говорит председатель")}>
      <div className="lc-head">
        <span className={`lc-dot${air ? " on" : ""}`} aria-hidden="true" />
        <b>{air ? tr("Leo is on air now", "Лео сейчас в эфире") : tr("Leo is off air now", "Лео сейчас не в эфире")}</b>
      </div>
      <p>
        {tr(`The rule: Leo, the AI chair, makes one statement at the start of each bank day. A bank day here is ${span(secs)}.`,
          `Правило: Лео, ИИ-председатель, делает одно заявление в начале каждого банковского дня. Банковский день здесь — ${span(secs)}.`)}{" "}
        {spoke
          ? air
            ? tr(`His latest statement is for bank day ${s.policy_set_epoch_id}.`, `Последнее заявление — к банковскому дню №${s.policy_set_epoch_id}.`)
            : tr(`His last statement was on bank day ${s.policy_set_epoch_id}; the bank is now on day ${s.epoch_id}.`, `Последний раз он выступал в банковский день №${s.policy_set_epoch_id}; сейчас идёт день №${s.epoch_id}.`)
          : tr("He has not spoken at this bank yet.", "В этом банке он ещё не выступал.")}
      </p>
      <p className="lc-next">
        {late
          ? <>
              <b>{tr("The press conferences are paused right now.", "Пресс-конференции сейчас на паузе.")}</b>{" "}
              {tr(`They are scheduled ${every}, but the last one did not take place. The bank lives by his last rules: interest accrues each bank day, and a deposit can be taken out at any time.`,
                `По расписанию они идут ${every}, но последняя не состоялась. Банк живёт по его последним правилам: проценты начисляются каждый банковский день, а вклад можно забрать в любой момент.`)}
            </>
          : SCHEDULE.active
          ? <>
              <b>{tr("Next press conference", "Следующая пресс-конференция")}: {dayWord(next, now)} {tr("at", "в")} {clock(next)}</b>{" "}
              {tr(`your time (in ${waitText(next - now, false)}), then ${every}, around the clock.`, `по твоему времени (через ${waitText(next - now, true)}), и дальше ${every}, круглые сутки.`)}{" "}
              {SCHEDULE.bankDays === 1
                ? tr("Each time the bank moves one bank day forward and Leo makes one statement.", "Каждый раз банк проживает один банковский день, и Лео делает одно заявление.")
                : tr(`It lasts about ${lasts} minutes: ${SCHEDULE.bankDays} bank days, one statement each.`, `Идёт около ${lasts} минут: ${SCHEDULE.bankDays} банковских дней, по одному заявлению в каждый.`)}
            </>
          : <>
              <b>{tr("No press conference is scheduled yet.", "Следующая пресс-конференция пока не назначена.")}</b>{" "}
              {tr("Leo is an AI model, and he does not come out by himself: the project's program asks the model and carries its signed answer to the bank, and that program is not running right now. Until it is, the bank lives by his last rules: interest accrues each bank day, and a deposit can be taken out at any time.",
                "Лео — ИИ-модель, и сам по себе он не выходит: программа проекта спрашивает модель и относит её подписанный ответ в банк, а сейчас эта программа не запущена. Пока так, банк живёт по его последним правилам: проценты начисляются каждый банковский день, а вклад можно забрать в любой момент.")}
            </>}
      </p>
    </div>
  );
}
