import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ChairGame from "./ChairGame";
import "./styles.css";
import { LANG } from "./lang";

document.documentElement.lang = LANG;
// The first screen is the game: you hold the chair. The town (be a depositor; the live runner) is the second mode;
// links that name a chair persona or the local simulation belong to it.
const q = new URLSearchParams(window.location.search);
const town = q.get("mode") === "town" || q.has("chair") || q.has("local");
createRoot(document.getElementById("root")!).render(<React.StrictMode>{town ? <App /> : <ChairGame />}</React.StrictMode>);
