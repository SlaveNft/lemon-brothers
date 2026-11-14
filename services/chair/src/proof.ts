/**
 * Response signatures from NEAR AI Cloud, checked the same way the contract checks them.
 *
 * NEAR AI Cloud signs every chat completion inside its TEE. `GET /v1/signature/{chat_id}?model=..&signing_algo=ed25519`
 * returns `text` = "{model}:{sha256(request body)}:{sha256(response body)}" (provider TEE; the form the contract
 * accepts) or "{sha256(request)}:{sha256(response)}" (gateway), an ed25519 `signature` over the UTF-8 bytes of `text`, and the
 * `signing_address` (the 32-byte public key, hex). The signing key itself is bound to the TEE by
 * `GET /v1/attestation/report` (checked once, off chain, before the holders' DAO pins it in the contract).
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

export interface ResponseSignature {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: string;
}

export interface ChairProof {
  model: string;
  /** Exact bytes sent and received, as strings. */
  requestBody: string;
  responseBody: string;
  sig: ResponseSignature;
}

export const sha256hex = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const strip0x = (h: string) => h.replace(/^0x/i, "").toLowerCase();

/** ed25519 verify with a raw 32-byte public key (hex). */
export function ed25519Verify(pubHex: string, message: string, sigHex: string): boolean {
  try {
    const raw = Buffer.from(strip0x(pubHex), "hex");
    if (raw.length !== 32) return false;
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return edVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(strip0x(sigHex), "hex"));
  } catch {
    return false;
  }
}

/**
 * The signature checks the contract makes, run locally before paying gas. Empty list = the signature will verify.
 * With `pinnedPromptSha256`, also the contract's check that the request used the DAO-pinned system prompt.
 */
export function checkProof(p: ChairProof, pinnedKey?: string, pinnedPromptSha256?: string): string[] {
  // the signature endpoint's answer is outside our control: a missing or mistyped field is a problem, not a crash
  const sig = (p as { sig?: unknown } | null)?.sig as Record<string, unknown> | null | undefined;
  if (!p || typeof p.requestBody !== "string" || typeof p.responseBody !== "string" || typeof p.model !== "string") return ["proof is incomplete: model, request or response body missing"];
  if (!sig || typeof sig !== "object" || Array.isArray(sig)) return ["signature response is not a JSON object"];
  const bad = ["text", "signature", "signing_address", "signing_algo"].filter((k) => typeof sig[k] !== "string");
  if (bad.length) return [`signature response is malformed: ${bad.join(", ")} missing or not a string`];
  const problems: string[] = [];
  const req = sha256hex(p.requestBody), res = sha256hex(p.responseBody);
  // the contract verifies the provider-TEE form, which names the model
  if (p.sig.text !== `${p.model}:${req}:${res}`) problems.push(`signed text does not match "{model}:{sha256(request)}:{sha256(response)}" (got ${p.sig.text.slice(0, 80)})`);
  if (p.sig.signing_algo !== "ed25519") problems.push(`signing_algo is ${p.sig.signing_algo}, the contract expects ed25519`);
  if (!ed25519Verify(p.sig.signing_address, p.sig.text, p.sig.signature)) problems.push("ed25519 signature does not verify");
  if (pinnedKey && strip0x(pinnedKey) !== strip0x(p.sig.signing_address)) problems.push("signed by a key the DAO has not pinned");
  if (pinnedPromptSha256) {
    let system = "";
    try { system = JSON.parse(p.requestBody).messages?.[0]?.content ?? ""; } catch { /* reported below */ }
    if (typeof system !== "string" || sha256hex(system) !== strip0x(pinnedPromptSha256)) problems.push("system prompt is not the one the DAO pinned");
  }
  return problems;
}

/** Arguments for the contract's `set_policy_attested` call: the exact bodies (the contract hashes them) and the signature. */
export function attestedArgs(p: ChairProof) {
  return { request: p.requestBody, response: p.responseBody, signature: strip0x(p.sig.signature) };
}
