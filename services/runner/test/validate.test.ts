import { describe, expect, it } from "vitest";
import { ALLOWED_ORIGINS, MAX_AMOUNT, attestationFor, chairModeText, checkRequest, corsHeaders, isJsonContentType, readEnv } from "../src/validate";

const ok = (path: string, body: unknown) => { const r = checkRequest(path, body); if (!("ok" in r)) throw new Error(r.error); return r.ok; };
const err = (path: string, body: unknown) => { const r = checkRequest(path, body); if ("ok" in r) throw new Error(`accepted ${JSON.stringify(body)}`); return r; };

describe("POST bodies", () => {
  it("accepts every action the page sends and passes on only known fields", () => {
    expect(ok("/api/join", { who: "Player-1a" })).toEqual({ route: "join", who: "player-1a" });
    expect(ok("/api/act", { who: "p1", t: "deposit", amount: 500, extra: "x", __proto__: { a: 1 } })).toEqual({ route: "act", action: { t: "deposit", who: "p1", amount: 500 } });
    expect(ok("/api/act", { who: "p1", t: "withdraw", amount: 1 })).toEqual({ route: "act", action: { t: "withdraw", who: "p1", amount: 1 } });
    expect(ok("/api/act", { who: "p1", t: "withdrawAll" })).toEqual({ route: "act", action: { t: "withdrawAll", who: "p1" } });
    expect(ok("/api/act", { who: "p1", t: "insure", premium: 50 })).toEqual({ route: "act", action: { t: "insure", who: "p1", premium: 50 } });
    expect(ok("/api/act", { who: "p1", t: "lobby", text: "  Stay calm.  " })).toEqual({ route: "act", action: { t: "lobby", who: "p1", text: "Stay calm." } });
    expect(ok("/api/act", { who: "p1", t: "rumor", kind: "vault_empty" })).toEqual({ route: "act", action: { t: "rumor", who: "p1", kind: "vault_empty" } });
    expect(ok("/api/impeach", { who: "p1", persona: "hawk" })).toEqual({ route: "impeach", who: "p1", persona: "hawk", vote: true });
    expect(ok("/api/impeach", { who: "p1", persona: "hawk", vote: false })).toMatchObject({ vote: false });
    expect(ok("/api/ff", { epochs: 100 })).toEqual({ route: "ff", epochs: 100 });
    expect(ok("/api/ff", {})).toEqual({ route: "ff", epochs: 10 });
  });

  it("an unknown action is a 400 that names it", () => {
    const r = err("/api/act", { who: "p1", t: "mint" });
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/unknown action "mint"/);
    expect(err("/api/act", { who: "p1" }).error).toMatch(/unknown action/);
    expect(err("/api/act", { who: "p1", t: ["deposit"] }).status).toBe(400);
    expect(err("/api/act", { who: "p1", t: "constructor" }).status).toBe(400);
  });

  it("amounts must be whole, positive, finite and within bounds", () => {
    for (const amount of [0, -5, 1.5, NaN, Infinity, "500", null, undefined, [500], MAX_AMOUNT + 1, 1e300]) {
      expect(err("/api/act", { who: "p1", t: "deposit", amount }).error, String(amount)).toMatch(/amount/);
      expect(err("/api/act", { who: "p1", t: "withdraw", amount }).error, String(amount)).toMatch(/amount/);
      expect(err("/api/act", { who: "p1", t: "insure", premium: amount }).error, String(amount)).toMatch(/premium/);
    }
    expect(ok("/api/act", { who: "p1", t: "deposit", amount: MAX_AMOUNT })).toBeTruthy();
  });

  it("text must be a string, names and personas must be known shapes", () => {
    for (const text of [undefined, null, 5, {}, ["a"], "", "   ", "x".repeat(281)]) expect(err("/api/act", { who: "p1", t: "lobby", text }).error).toMatch(/text/);
    for (const who of [undefined, null, 5, {}, "a", "has space", "x".repeat(33), "agent-01", "chair", "holders-dao", "CHAIR"]) expect(err("/api/join", { who }).status).toBe(400);
    for (const persona of [undefined, "owl", 3, null, "toString"]) expect(err("/api/impeach", { who: "p1", persona }).error).toMatch(/persona/);
    expect(err("/api/impeach", { who: "p1", persona: "hawk", vote: "yes" }).error).toMatch(/vote/);
    for (const kind of [undefined, "moon", 1]) expect(err("/api/act", { who: "p1", t: "rumor", kind }).error).toMatch(/kind/);
  });

  it("fast-forward takes a whole number of epochs from 1 to 100", () => {
    for (const epochs of [0, -1, 101, 1.5, "10", null, NaN, Infinity, 1e9]) expect(err("/api/ff", { epochs }).error, String(epochs)).toMatch(/epochs/);
  });

  it("the body must be an object and the route must exist", () => {
    for (const body of [null, [], "x", 5, undefined]) expect(err("/api/act", body).error).toMatch(/JSON object/);
    expect(err("/api/nope", {}).status).toBe(404);
  });
});

describe("headers", () => {
  it("only application/json is a JSON body", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("Application/JSON; charset=utf-8")).toBe(true);
    for (const h of [undefined, "", "text/plain", "application/x-www-form-urlencoded", "application/jsonp", ["application/json"]]) expect(isJsonContentType(h as string)).toBe(false);
  });
  it("CORS is for the dev origins only", () => {
    for (const o of ALLOWED_ORIGINS) expect(corsHeaders(o)["Access-Control-Allow-Origin"]).toBe(o);
    for (const o of [undefined, "null", "https://evil.example", "http://127.0.0.1:5191", "http://localhost:5190.evil.example", "*"]) expect(corsHeaders(o)).toEqual({});
  });
});

describe("environment", () => {
  it("defaults", () => {
    expect(readEnv({}, () => 7)).toEqual({ port: 8797, epochMs: 30_000, seed: 7, persona: "dove", warnings: [] });
    expect(readEnv({ PORT: "9000", EPOCH_SECONDS: "3", SEED: "42", PERSONA: "hawk" })).toEqual({ port: 9000, epochMs: 3000, seed: 42, persona: "hawk", warnings: [] });
  });
  it("an invalid EPOCH_SECONDS or PERSONA falls back with a warning", () => {
    for (const v of ["abc", "0", "-3", "NaN", "Infinity", "1e9"]) {
      const e = readEnv({ EPOCH_SECONDS: v }, () => 1);
      expect(e.epochMs, v).toBe(30_000);
      expect(e.warnings.join(" "), v).toMatch(/EPOCH_SECONDS/);
    }
    const e = readEnv({ PERSONA: "owl", SEED: "x", PORT: "99999" }, () => 5);
    expect(e).toMatchObject({ persona: "dove", seed: 5, port: 8797 });
    expect(e.warnings).toHaveLength(3);
  });
});

describe("attestation", () => {
  const sig = "AB".repeat(64);
  const proof = { model: "m", requestBody: "{}", responseBody: "{}", sig: { text: "t", signature: sig, signing_address: "00", signing_algo: "ed25519" } };
  const decision = { rate: 1, target: 200, mint: 0, gate: 0, tone: "calm" as const, statement: "", reasoning: "", addressed: [], epochId: 7 };

  it("a verified answer for this epoch is signed", () => {
    expect(attestationFor({ source: "near-ai", decision, proof, proofProblems: [] }, 7)).toEqual({ attestation: `ed25519:${"ab".repeat(32)}`, unverified: [] });
    expect(attestationFor({ source: "near-ai", decision, proof: { ...proof, sig: { ...proof.sig, signature: "0x" + sig } }, proofProblems: [] }, 7).attestation).toBe(`ed25519:${"ab".repeat(32)}`);
  });
  it("proof problems, a missing proof, a bad signature or another epoch leave it unsigned, with reasons", () => {
    const a = attestationFor({ source: "near-ai", decision, proof, proofProblems: ["ed25519 signature does not verify"] }, 7);
    expect(a).toEqual({ attestation: "", unverified: ["ed25519 signature does not verify"] });
    expect(attestationFor({ source: "near-ai", decision, proofProblems: ["signature endpoint answered 404"] }, 7)).toEqual({ attestation: "", unverified: ["signature endpoint answered 404"] });
    expect(attestationFor({ source: "near-ai", decision }, 7).unverified).toEqual(["no signature was returned for this answer"]);
    expect(attestationFor({ source: "near-ai", decision, proof, proofProblems: [] }, 8).unverified.join(" ")).toMatch(/names epoch 7, the bank is in epoch 8/);
    expect(attestationFor({ source: "near-ai", decision: { ...decision, epochId: undefined }, proof, proofProblems: [] }, 7).attestation).toBe("");
    expect(attestationFor({ source: "near-ai", decision, proof: { ...proof, sig: { ...proof.sig, signature: "zz" } }, proofProblems: [] }, 7).unverified.join(" ")).toMatch(/64 bytes/);
    expect(attestationFor({ source: "near-ai", decision, proof: { ...proof, sig: null as never }, proofProblems: [] }, 7).attestation).toBe("");
  });
  it("the fallback chair is never signed and has nothing to verify", () => {
    expect(attestationFor(null, 7)).toEqual({ attestation: "", unverified: [] });
    expect(attestationFor({ source: "fallback", decision, proof }, 7)).toEqual({ attestation: "", unverified: [] });
  });
  it("the chair line says so", () => {
    expect(chairModeText({ hasKey: false, model: "m" })).toBe("fallback (no NEAR_AI_API_KEY)");
    expect(chairModeText({ hasKey: true, model: "m" })).toBe("near-ai:m");
    expect(chairModeText({ hasKey: true, model: "m", fellBack: "timeout" })).toBe("near-ai:m (fell back: timeout)");
    expect(chairModeText({ hasKey: true, model: "m", unverified: ["a", "b"] })).toBe("near-ai:m · signature not verified: a; b");
    expect(chairModeText({ hasKey: false, model: "m", tickError: "boom" })).toBe("fallback (no NEAR_AI_API_KEY) · last epoch failed: boom");
  });
});
