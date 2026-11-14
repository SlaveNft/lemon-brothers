/**
 * The site is four short screens, one thing on each, chosen by the address after "#":
 *
 *   what   what the coin is, how it works, the questions a newcomer asks
 *   play   the game: you are the chair for ten days (a simulation), and its leaderboard
 *   coins  your $LEMON at the real bank: get it, put it in, watch and decide
 *   bank   the real bank as it is on NEAR testnet right now, and the proofs
 *
 * Older links and the links inside the page ("#leaderboard", "#testnet", "#realbank") keep working: each names the
 * screen it lives on, and the page scrolls to it there.
 */
import { useEffect, useState } from "react";

export type Tab = "what" | "play" | "coins" | "bank";
export const TABS: Tab[] = ["what", "play", "coins", "bank"];

const HOME: Record<string, Tab> = {
  what: "what", how: "what", faq: "what",
  play: "play", leaderboard: "play",
  coins: "coins", realbank: "coins",
  bank: "bank", testnet: "bank",
};

/** The screen an address opens. A result link (`?seed=...`) with no "#" is a game to replay, so it opens the game. */
export function tabOf(hash: string, search = ""): Tab {
  const id = hash.replace(/^#/, "");
  if (id && HOME[id]) return HOME[id];
  return new URLSearchParams(search).has("seed") ? "play" : "what";
}

/** The current screen; follows the address bar. Opening a screen starts at its top, or at the part the link names. */
export function useTab(): Tab {
  const [tab, setTab] = useState<Tab>(() => tabOf(location.hash, location.search));
  useEffect(() => {
    const go = () => {
      setTab(tabOf(location.hash, location.search));
      const id = location.hash.replace(/^#/, "");
      // after the screen has been drawn: to the named part if it is one, else to the top
      requestAnimationFrame(() => {
        const part = id && !TABS.includes(id as Tab) ? document.getElementById(id) : null;
        if (part) part.scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
      });
    };
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  return tab;
}
