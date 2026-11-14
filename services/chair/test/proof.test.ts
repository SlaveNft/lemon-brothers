import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chairSystemPrompt } from "@chair/sim";
import { attestedArgs, checkProof, ed25519Verify, sha256hex } from "../src/proof";

const fx = JSON.parse(readFileSync(new URL("../../../contracts/lemon-bank/src/test_proof.json", import.meta.url), "utf8"));
const proof = (c = fx.cases.ok) => ({ model: fx.model, requestBody: c.request, responseBody: c.response, sig: { text: c.text, signature: c.signature, signing_address: fx.signer, signing_algo: "ed25519" } });

describe("NEAR AI response signatures", () => {
  it("a genuine signed answer checks out, including the pinned prompt", () => {
    expect(ed25519Verify(fx.signer, fx.cases.ok.text, fx.cases.ok.signature)).toBe(true);
    expect(checkProof(proof(), fx.signer, fx.prompt_sha256)).toEqual([]);
  });
  it("the fixture pins the prompt the keeper actually sends", () => {
    expect(fx.prompt_sha256).toBe(sha256hex(chairSystemPrompt(fx.persona)));
  });
  it("an edited answer is caught", () => {
    const p = proof();
    p.responseBody = p.responseBody.replace('\\"mint\\":0', '\\"mint\\":999999');
    expect(p.responseBody).not.toBe(fx.cases.ok.response);
    expect(checkProof(p).join(" ")).toMatch(/does not match/);
  });
  it("a different key is caught", () => {
    expect(checkProof(proof(), "00".repeat(32)).join(" ")).toMatch(/not pinned/);
  });
  it("a signed answer to another system prompt is caught", () => {
    expect(checkProof(proof(fx.cases.rogue), fx.signer)).toEqual([]);
    expect(checkProof(proof(fx.cases.rogue), fx.signer, fx.prompt_sha256).join(" ")).toMatch(/not the one the DAO pinned/);
  });
  it("a malformed signature response is a problem, never an exception", () => {
    const broken: unknown[] = [
      undefined, null, "oops", 42, [], {},
      { signature: fx.cases.ok.signature, signing_address: fx.signer, signing_algo: "ed25519" }, // no text
      { text: 5, signature: fx.cases.ok.signature, signing_address: fx.signer, signing_algo: "ed25519" },
      { text: fx.cases.ok.text, signature: null, signing_address: fx.signer, signing_algo: "ed25519" },
      { text: fx.cases.ok.text, signature: fx.cases.ok.signature, signing_address: { hex: fx.signer }, signing_algo: "ed25519" },
      { text: fx.cases.ok.text, signature: fx.cases.ok.signature, signing_address: fx.signer },
      { error: "not ready" },
    ];
    for (const sig of broken) {
      const p = { ...proof(), sig } as unknown as Parameters<typeof checkProof>[0];
      let problems: string[] = [];
      expect(() => { problems = checkProof(p, fx.signer, fx.prompt_sha256); }, JSON.stringify(sig)).not.toThrow();
      expect(problems.length, JSON.stringify(sig)).toBeGreaterThan(0);
      expect(problems.join(" ")).toMatch(/signature response/);
    }
    expect(checkProof({ ...proof(), requestBody: undefined } as unknown as Parameters<typeof checkProof>[0]).join(" ")).toMatch(/incomplete/);
    // well-formed strings that are simply wrong still go through the normal checks
    expect(checkProof({ ...proof(), sig: { text: "", signature: "zz", signing_address: "", signing_algo: "" } }).length).toBeGreaterThan(1);
    // a request whose system message is not a string cannot match the pinned prompt
    const odd = proof(); odd.requestBody = JSON.stringify({ messages: [{ role: "system", content: { a: 1 } }] });
    expect(() => checkProof(odd, fx.signer, fx.prompt_sha256)).not.toThrow();
  });
  it("contract arguments carry the exact bodies", () => {
    const a = attestedArgs(proof());
    expect(a).toEqual({ request: fx.cases.ok.request, response: fx.cases.ok.response, signature: fx.cases.ok.signature });
  });
});
