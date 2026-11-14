/**
 * The top bar of every screen: the name (it leads home), which network this is, the three other screens, your coin, the language.
 * The network label and the coin stay in view, so "which network am I on?" and "where is my balance?" never need
 * a scroll.
 */
import type { ReactNode } from "react";
import { LANG, setLang, tr } from "./lang";
import { CONTRACT, EXPLORER } from "./chain/rpc";
import { WalletChip } from "./chain/Wallet";
import type { Tab } from "./tabs";

const NAMES: Array<[Tab, [string, string], [string, string]]> = [
  ["play", ["Play", "Играть"], ["Play", "Играть"]],
  ["coins", ["My coins", "Мои монеты"], ["Coins", "Монеты"]],
  ["bank", ["The bank, live", "Банк вживую"], ["Bank", "Банк"]],
];

/** `tab`: the screen that is open; absent on the town page, whose links lead back to the four screens. */
export function TopBar({ tab, children }: { tab?: Tab; children?: ReactNode }) {
  const L = tr(0, 1);
  // from the town page (`?mode=town`) the screens are on the main page: leave the query behind
  const to = (t: Tab) => (tab ? `#${t}` : `./#${t}`);
  return (
    <header className="topbar">
      <a className="brand" href={to("what")}><span className="lemon" />Lemon Brothers</a>
      <a className="net" href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer"
        title={tr(`The real bank is a program on the test network of the NEAR blockchain: ${CONTRACT}. Its coins are test coins with no price. Opens the program's page in the explorer.`, `Настоящий банк — программа в тестовой сети блокчейна NEAR: ${CONTRACT}. Её монеты тестовые и цены не имеют. Откроется страница программы в обозревателе.`)}>
        <i aria-hidden="true" />NEAR testnet<small>{tr("test network · no real money", "тестовая сеть · без настоящих денег")}</small>
      </a>
      {children}
      <nav className="tabs" aria-label={tr("Screens", "Экраны")}>
        {tab && tab !== "what" && <a className="tab back" href={to("what")}>← {tr("Home", "Главная")}</a>}
        {NAMES.map(([t, long, short]) => (
          <a key={t} className={`tab${tab === t ? " on" : ""}`} href={to(t)} aria-current={tab === t ? "page" : undefined}>
            <span className="wide">{long[L]}</span><span className="narrow">{short[L]}</span>
          </a>
        ))}
      </nav>
      <WalletChip href={to("coins")} />
      <span className="lang" role="group" aria-label={tr("Language", "Язык")}>{(["ru", "en"] as const).map((l) => <button key={l} lang={l} aria-pressed={LANG === l} aria-label={l === "ru" ? "Русский" : "English"} className={LANG === l ? "on" : ""} onClick={() => LANG !== l && setLang(l)}>{l.toUpperCase()}</button>)}</span>
    </header>
  );
}

/** A label next to an action or a result that happens only in this browser: nothing is sent to the network. */
export function SimTag({ children }: { children?: ReactNode }) {
  return <span className="chip sim">{children ?? tr("simulation · nothing is sent to the network", "симуляция · в сеть ничего не отправляется")}</span>;
}
/** A label next to an action or a result that is a real transaction on the test network. */
export function RealTag({ children }: { children?: ReactNode }) {
  return <span className="chip real">{children ?? tr("real · NEAR testnet", "настоящее · NEAR testnet")}</span>;
}
