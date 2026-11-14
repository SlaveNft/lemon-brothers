/**
 * Local keeper and API for one live town (no dependencies beyond the workspace).
 *
 *   npm run runner                      (from chair/)
 *   EPOCH_SECONDS=30 SEED=42 PERSONA=dove PORT=8797 NEAR_AI_API_KEY=... AI_DEPOSITORS=3 NEAR_AI_MAX_CALLS=200 npm run runner
 *
 * Every epoch: the chair (NEAR AI Cloud if a key is set, otherwise the deterministic fallback) answers, the policy goes
 * through the bank's bounds, the agents react, the epoch advances. Players act at any time through the API.
 *
 *   GET  /api/state                       the WorldView (same shape the browser builds offline)
 *   POST /api/join      {who}             airdrop 1,000 LEMON to a new player (joining again is a no-op)
 *   POST /api/act       {who, t, ...}     deposit | withdraw | withdrawAll | lobby | rumor | insure
 *   POST /api/impeach   {who, persona, vote}
 *   POST /api/ff        {epochs}          fast-forward with the fallback chair (for judges), 1..100
 *
 * POST bodies must be `application/json` and are checked field by field (src/validate.ts). CORS is open only to the
 * page's dev origins. A model answer's signature is attached to the policy only when it verified locally.
 *
 * Testnet mode (the same loop against the deployed contract) is in scripts/testnet/; it is not run without the
 * owner's explicit go-ahead.
 */
import http from "node:http";
import { applyPlayer, airdrop, createWorld, fallbackChair, impeachmentVote, observe, stepEpoch, view, type MindMove, type PlayerAction } from "@chair/sim";
import { askChair, askDepositors, configFromEnv, pickDepositors, type ChairAnswer } from "@chair/chair";
import { attestationFor, chairModeText, checkRequest, corsHeaders, isJsonContentType, readEnv } from "./validate";

const ENV = readEnv(process.env);
for (const warning of ENV.warnings) console.warn(`runner: ${warning}`);
const { port: PORT, epochMs: EPOCH_MS, seed: SEED } = ENV;
const cfg = configFromEnv();

const w = createWorld(SEED, ENV.persona);
// AI depositors: with a key, AI_DEPOSITORS of the sixty (default 3, at most 12) are driven by the model, one small
// completion each per epoch out of the same NEAR_AI_MAX_CALLS budget; the rest stay programs. 0 turns them off.
const aiWanted = Number(process.env.AI_DEPOSITORS ?? 3);
const AI_DEPOSITORS = cfg.apiKey ? pickDepositors(Number.isInteger(aiWanted) && aiWanted >= 0 ? Math.min(aiWanted, 12) : 3, w.agents.length) : [];
const players = new Set<string>();
let nextTick = Date.now() + EPOCH_MS;
let busy = false;
let lastChair: (Pick<ChairAnswer, "source" | "fallbackReason" | "proofProblems" | "chatId"> & { unverified: string[] }) | null = null;
let tickError: string | null = null;

async function tick(fast = false) {
  busy = true;
  try {
    let ans: ChairAnswer | null = null;
    const epochId = w.bank.epochId;
    if (!w.bank.collapsed && !fast) ans = await askChair(observe(w), w.persona, cfg);
    // signed only if the proof verified and the answer is for this epoch; otherwise the decision is applied unsigned
    const { attestation, unverified } = attestationFor(ans, epochId);
    // the AI depositors hear what the chair has just announced, then decide; a public sentence is a paid speech
    let minds: Map<string, MindMove> | undefined;
    const says: PlayerAction[] = [];
    if (AI_DEPOSITORS.length && !w.bank.collapsed && !fast) {
      minds = await askDepositors(w, AI_DEPOSITORS, ans?.decision ?? fallbackChair(observe(w), w.persona), cfg);
      for (const [who, m] of minds) if (m.source === "model" && m.say) says.push({ t: "lobby", who, text: m.say });
    }
    stepEpoch(w, says, ans?.decision, attestation, [], minds);
    if (ans) lastChair = { source: ans.source, fallbackReason: ans.fallbackReason, proofProblems: ans.proofProblems, chatId: ans.chatId, unverified };
    tickError = null;
  } finally {
    busy = false;
    nextTick = Date.now() + EPOCH_MS;
  }
}

// an epoch that throws must not take the process down: log it, show it in the chair line, try again next epoch
setInterval(() => {
  if (busy || Date.now() < nextTick) return;
  tick().catch((e) => {
    tickError = String((e as Error)?.message ?? e).slice(0, 200);
    console.error("runner: epoch failed:", e);
  });
}, 250);

const chairMode = () => chairModeText({
  hasKey: !!cfg.apiKey, model: cfg.model,
  fellBack: lastChair?.source === "fallback" ? lastChair.fallbackReason ?? "unknown reason" : null,
  unverified: lastChair?.unverified, tickError,
}) + (AI_DEPOSITORS.length ? `; ${AI_DEPOSITORS.length} AI depositors (${cfg.model})` : "");

function send(req: http.IncomingMessage, res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
  res.end(code === 204 ? undefined : JSON.stringify(body));
}

/** The body as JSON; throws a message for the client when it is too large or not JSON. */
async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) throw new Error("body too large"); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("body is not valid JSON"); }
}

http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(req, res, 204, {});
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/api/state") {
      return send(req, res, 200, { ...view(w, { players: [...players], chairMode: chairMode(), nextTickMs: nextTick - Date.now(), epochMs: EPOCH_MS }), lastChair });
    }
    if (req.method !== "POST") return send(req, res, 404, { error: "not found" });
    if (!isJsonContentType(req.headers["content-type"])) return send(req, res, 415, { error: "content-type must be application/json" });
    let body: unknown;
    try { body = await readJson(req); } catch (e) { return send(req, res, 400, { error: (e as Error).message }); }
    const checked = checkRequest(url.pathname, body);
    if (!("ok" in checked)) return send(req, res, checked.status, { error: checked.error });
    const r = checked.ok;
    switch (r.route) {
      case "join": {
        // joining twice (a page reload) is fine: the airdrop is paid once
        const err = players.has(r.who) ? null : airdrop(w.bank, r.who);
        if (!err) players.add(r.who);
        return send(req, res, err ? 400 : 200, { ok: !err, error: err });
      }
      case "act": {
        if (!players.has(r.action.who)) return send(req, res, 400, { error: "join first" });
        const err = applyPlayer(w, r.action);
        return send(req, res, err ? 400 : 200, { ok: !err, error: err });
      }
      case "impeach": {
        if (!players.has(r.who)) return send(req, res, 400, { error: "join first" });
        if (r.persona === w.persona) return send(req, res, 400, { error: "pick a different chair: dove, hawk or populist" });
        return send(req, res, 200, impeachmentVote(w, r.persona, { [r.who]: r.vote }));
      }
      case "ff": {
        if (busy) return send(req, res, 409, { error: "an epoch is running, try again" });
        for (let i = 0; i < r.epochs; i++) await tick(true);
        return send(req, res, 200, { ok: true, epochs: r.epochs });
      }
    }
  } catch (e) {
    console.error("runner: request failed:", e);
    if (!res.headersSent) send(req, res, 500, { error: String((e as Error)?.message ?? e).slice(0, 200) });
    else res.end();
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Lemon Brothers runner on http://127.0.0.1:${PORT}  seed ${SEED}  epoch ${EPOCH_MS / 1000}s  chair: ${chairMode()}`);
});
