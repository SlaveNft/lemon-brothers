/**
 * The town as a drawing: the chair behind his desk, the vault, the door, and the sixty depositors as cartoon
 * animals whose faces show how they feel. It is drawn from the same `WorldView` as everything else on the page, so
 * it is the state, not a film about it: a depositor who runs walks out of the door, the vault's gauge is the
 * bank's cash, a speech is a bubble. Plain SVG and CSS: it loads with the page and needs no WebGL.
 */
import { useMemo } from "react";
import type { WorldView } from "@chair/sim";
import { tr } from "../lang";
import { personaTitle, ruText, toneLabel } from "../ruText";
import { Chairman, Critter, type Feeling } from "./critters";
import "./town.css";

const W = 1000, H = 610, COLS = 15, DOOR = { x: 925, y: 372 };
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Where depositor `i` stands: four rows in front of the desk, every other row shifted half a step. */
function seat(i: number): { x: number; y: number } {
  const row = Math.floor(i / COLS), col = i % COLS;
  return { x: 62 + col * 54 + (row % 2 ? 27 : 0), y: 408 + row * 62 };
}

export function Town2D({ s, idle }: { s: WorldView; idle?: string }) {
  const last = s.press[s.press.length - 1];
  const tone = last?.decision.tone ?? "calm";
  const quote = last ? ruText(last.decision.statement) : idle ?? tr("The chair speaks at the end of the first epoch.", "Председатель выступит в конце первой эпохи.");
  const cash = s.collapsed ? 0 : Math.min(1, s.reservePermille / 500);
  const low = s.collapsed || s.reservePermille < 100;
  // what the latest day did to the coin: the change of supply between the last two snapshots
  const h = s.history, delta = h.length >= 2 ? h[h.length - 1].supply - h[h.length - 2].supply : 0;
  const inBank = s.agents.filter((a) => a.deposit > 0).length;
  const speakers = useMemo(() => s.agents.map((a, i) => ({ a, i })).filter(({ a }) => a.mind?.source === "model" && a.mind.say && a.mind.epochId >= s.epochId - 1).slice(0, 2), [s]);
  const anyAi = s.agents.some((a) => a.mind?.source === "model");
  // back rows first, so the front row overlaps them
  const order = useMemo(() => s.agents.map((_, i) => i), [s.agents.length]);

  return (
    <section className="pressroom flat" aria-label={tr("The bank, drawn", "Банк в картинке")}>
      <svg className="town2d" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={tr(`${inBank} of ${s.agents.length} depositors are in the bank; cash in the vault ${(s.reservePermille / 10).toFixed(1)}%`, `${inBank} из ${s.agents.length} вкладчиков в банке; в сейфе ${(s.reservePermille / 10).toFixed(1)}%`)}>
        <defs>
          <linearGradient id="t-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8f7fc4" /><stop offset="0.55" stopColor="#f3a06f" /><stop offset="1" stopColor="#ffd38f" /></linearGradient>
          <linearGradient id="t-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#dfe3ea" /><stop offset="1" stopColor="#9aa1ad" /></linearGradient>
          <clipPath id="t-win"><rect x="320" y="24" width="360" height="236" rx="18" /></clipPath>
        </defs>
        {/* the room */}
        <rect width={W} height={H} fill="#f6e9d3" />
        <rect y="318" width={W} height={H - 318} fill="#ead4b2" />
        <rect y="312" width={W} height="10" fill="#b98a5e" />
        <ellipse cx="455" cy="500" rx="455" ry="118" fill="#c9785a" opacity="0.2" />
        {/* the window behind the chair */}
        <g clipPath="url(#t-win)">
          <rect x="320" y="24" width="360" height="236" fill="url(#t-sky)" />
          <circle cx="600" cy="196" r="34" fill="#ffe9b0" opacity="0.9" />
          <path d="M320 260 V190 h26 v-34 h22 v54 h18 v-88 h14 v-22 h12 v22 h14 v70 h22 v-44 h26 v62 h16 v-112 h10 v-26 h8 v26 h10 v96 h24 v-52 h28 v40 h18 v-70 h22 v84 h20 v-36 h30 V260 Z" fill="#4f4374" opacity="0.72" />
        </g>
        <rect x="320" y="24" width="360" height="236" rx="18" fill="none" stroke="#8a5a36" strokeWidth="10" />
        <path d="M500 24 V260 M320 132 H680" stroke="#8a5a36" strokeWidth="6" />
        {/* the vault and its gauge */}
        <g className={low ? "vault low" : "vault"}>
          <rect x="44" y="52" width="232" height="246" rx="16" fill="url(#t-steel)" stroke="#3b2b25" strokeWidth="3" />
          <circle cx="150" cy="176" r="86" fill={s.collapsed ? "#2e2622" : "#c9ced8"} stroke="#3b2b25" strokeWidth="4" />
          {s.collapsed
            ? <text x="150" y="182" textAnchor="middle" className="t-closed">{tr("EMPTY", "ПУСТО")}</text>
            : <g className="wheel"><circle cx="150" cy="176" r="58" fill="none" stroke="#6d7482" strokeWidth="7" />{[0, 1, 2, 3, 4, 5].map((k) => <line key={k} x1="150" y1="176" x2={150 + Math.cos((k * Math.PI) / 3) * 58} y2={176 + Math.sin((k * Math.PI) / 3) * 58} stroke="#6d7482" strokeWidth="7" strokeLinecap="round" />)}<circle cx="150" cy="176" r="15" fill="#e8c56b" stroke="#3b2b25" strokeWidth="3" /></g>}
          <rect x="246" y="74" width="16" height="204" rx="8" fill="#fffdf8" stroke="#3b2b25" strokeWidth="2.5" />
          <rect className="cash" x="248.5" y={76.5 + 199 * (1 - cash)} width="11" height={199 * cash} rx="5.5" />
          <text x="150" y="42" textAnchor="middle" className="t-label">{tr("VAULT", "СЕЙФ")} · {s.collapsed ? tr("empty", "пусто") : `${(s.reservePermille / 10).toFixed(1)}%`}</text>
        </g>
        {/* the door people run through */}
        <g>
          <rect x="868" y="150" width="112" height="230" rx="8" fill="#5a3a26" stroke="#3b2b25" strokeWidth="3" />
          <rect x="880" y="164" width="88" height="216" rx="4" fill="#241a17" />
          <rect x="892" y="118" width="64" height="26" rx="6" fill="#3f9a5f" stroke="#3b2b25" strokeWidth="2.5" />
          <text x="924" y="136.5" textAnchor="middle" className="t-exit">{tr("EXIT", "ВЫХОД")}</text>
        </g>
        {/* the chair and what he just said */}
        <g transform="translate(364 34) scale(1.14)"><Chairman tone={tone} closed={s.collapsed} plate={tr("THE CHAIR", "КРЕСЛО")} /></g>
        <foreignObject x="634" y="28" width="226" height="250">
          <div className={`t-bubble tone-${tone}`}>
            <span className="t-who">{personaTitle(s.persona, s.personaTitle)} · {toneLabel(tone)}</span>
            <span className="t-say">{last ? `“${clip(quote, 150)}”` : quote}</span>
          </div>
        </foreignObject>
        {last?.rejected && <g className="t-stamp" transform="translate(747 170) rotate(-9)"><rect x="-108" y="-34" width="216" height="68" rx="8" /><text y="-6" textAnchor="middle">{tr("REJECTED", "ОТКЛОНЕНО")}</text><text y="19" textAnchor="middle" className="sub">{tr("BY THE CONTRACT", "КОНТРАКТОМ")}</text></g>}
        {s.collapsed && <g className="t-stamp closed" transform="translate(500 330) rotate(-4)"><rect x="-150" y="-30" width="300" height="60" rx="8" /><text y="9" textAnchor="middle">{tr("BANK CLOSED", "БАНК ЗАКРЫТ")}</text></g>}
        {delta !== 0 && <text key={s.epochId} x="150" y="288" textAnchor="middle" className={delta < 0 ? "t-float burn" : "t-float mint"}>{delta < 0 ? `−${fmt(-delta)} ${tr("burned", "сгорело")}` : `+${fmt(delta)} ${tr("printed", "напечатано")}`}</text>}
        {/* the town */}
        {order.map((i) => {
          const a = s.agents[i], home = seat(i), gone = a.deposit === 0;
          const heat = a.panic / Math.max(1, a.threshold);
          const feeling: Feeling = heat >= 0.9 ? "panic" : heat >= 0.55 ? "worried" : "calm";
          const style = gone
            ? { transform: `translate(${DOOR.x}px, ${DOOR.y}px) scale(0.34)`, opacity: 0 }
            : { transform: `translate(${home.x}px, ${home.y}px) scale(0.64)`, opacity: 1 };
          return (
            <g key={a.id} className="seat" style={style}>
              <title>{`${a.name}: ${gone ? tr("out of the bank", "вне банка") : `${tr("panic", "паника")} ${Math.round(a.panic / 10)}% / ${Math.round(a.threshold / 10)}%`}${a.mind?.why ? `\n${a.mind.why}` : ""}`}</title>
              <g className="bob" style={{ animationDelay: `${-((i * 37) % 100) / 30}s` }}>
                <g transform="translate(-50 -130)"><Critter index={i} feeling={feeling} ai={a.mind?.source === "model"} /></g>
              </g>
            </g>
          );
        })}
        {speakers.map(({ a, i }) => {
          const p = seat(i), x = Math.max(8, Math.min(W - 208, p.x - 100));
          return (
            <foreignObject key={a.id} x={x} y={p.y - 168} width="200" height="84">
              <div className="t-bubble small"><span className="t-who">{a.name}</span><span className="t-say">“{clip(a.mind!.say, 90)}”</span></div>
            </foreignObject>
          );
        })}
      </svg>
      <p className="scene-cap">
        <b>{tr(`${inBank} of ${s.agents.length} depositors are in the bank.`, `В банке ${inBank} из ${s.agents.length} вкладчиков.`)}</b>{" "}
        {tr("A smile is calm, a drop of sweat is worry, a red mark means about to run; whoever runs leaves through the door.", "Улыбка — спокоен, капля пота — тревожится, красная метка — вот-вот побежит; кто побежал, уходит в дверь.")}
        {anyAi && <> {tr("The ones marked AI think with a language model.", "С меткой AI — те, кто думает языковой моделью.")}</>}
      </p>
    </section>
  );
}
