#!/usr/bin/env bash
# Rebuild the bank contract from this repository and compare it, byte for byte, with the code deployed on NEAR
# testnet. Read-only: no keys, no transactions.
#
#   npm run verify:deployed [-- <account id>]        (default: lemonbank-96b0974e.testnet)
#
# Why the extra flags. A release wasm keeps the source paths of its dependencies in its panic messages, and those
# paths start with the cargo home of whoever built it (the script prints the deployer's as "deployed from"). The same
# source built under another cargo home therefore differs in those strings and in its hash. The build below maps this
# machine's crate directory onto the deployer's with `--remap-path-prefix` and uses the toolchain pinned in
# contracts/rust-toolchain.toml, so the same source gives the same bytes under any cargo home. It builds into
# contracts/target/repro and leaves the normal build alone.
#
# The host matters too. Cargo mixes the compiler's host triple into the hashes that name and order the functions of a
# crate, so a build on Linux or on an Intel Mac is the same program laid out differently, with another hash. The
# deployed code was built on macOS on Apple silicon (aarch64-apple-darwin): the comparison is byte for byte on that
# host (GitHub's macos-latest runner is one; .github/workflows/chain.yml runs this script there every hour). On any
# other host the script says so instead of reporting a mismatch as a failure of the source.
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT="${1:-lemonbank-96b0974e.testnet}"

CHAIN="$(ACCOUNT="$ACCOUNT" node --input-type=module -e '
import { createHash } from "node:crypto";
const rpcs = (process.env.NEAR_RPC_URLS || "https://rpc.testnet.near.org,https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com,https://near-testnet.drpc.org").split(",");
const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query",
  params: { request_type: "view_code", finality: "final", account_id: process.env.ACCOUNT } });
for (let i = 0; i < 3 * rpcs.length; i++) {
  try {
    const r = await fetch(rpcs[i % rpcs.length], { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (!j.result) throw new Error(JSON.stringify(j.error ?? j).slice(0, 200));
    const code = Buffer.from(j.result.code_base64, "base64");
    const m = code.toString("latin1").match(/\/[A-Za-z0-9_.\/-]+?\/registry\/src\/index\.crates\.io-[0-9a-f]+/);
    console.log(createHash("sha256").update(code).digest("hex") + " " + (m ? m[0] : "-"));
    process.exit(0);
  } catch (e) { await new Promise((ok) => setTimeout(ok, 1000 * (1 + Math.floor(i / rpcs.length)))); }
}
console.error("verify:deployed: no RPC endpoint answered"); process.exit(2);
')"
ONCHAIN="${CHAIN%% *}"
DEPLOYED_SRC="${CHAIN#* }"

# --cfg near is what contracts/.cargo/config.toml sets for this target; RUSTFLAGS replaces it, so repeat it.
FLAGS="--cfg near"
if [ "$DEPLOYED_SRC" != "-" ]; then
  LOCAL_SRC="${CARGO_HOME:-$HOME/.cargo}/registry/src/${DEPLOYED_SRC##*/}"
  FLAGS="$FLAGS --remap-path-prefix=$LOCAL_SRC=$DEPLOYED_SRC"
fi

cd contracts
if command -v rustup >/dev/null 2>&1; then rustup toolchain install >/dev/null 2>&1 || true; fi
HOST="$(rustc -vV | sed -n 's/^host: //p')"
BUILD_HOST="aarch64-apple-darwin"
echo "toolchain     $(rustc --version), host $HOST"
echo "deployed from ${DEPLOYED_SRC%/registry/*}"
RUSTFLAGS="$FLAGS" CARGO_TARGET_DIR=target/repro cargo build --locked --quiet -p lemon-bank --target wasm32-unknown-unknown --release
BUILT="$(node -e 'const c=require("crypto");console.log(c.createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' target/repro/wasm32-unknown-unknown/release/lemon_bank.wasm)"
echo "built         $BUILT (contracts/lemon-bank)"
echo "on chain      $ONCHAIN ($ACCOUNT)"
if [ "$BUILT" != "$ONCHAIN" ] && [ "$HOST" != "$BUILD_HOST" ]; then
  echo "verify:deployed: NOT COMPARABLE HERE: the deployed code was built on $BUILD_HOST and this host is $HOST."
  echo "Cargo mixes the host into the hashes that order a crate's functions, so the bytes differ between hosts even"
  echo "for identical source. Run this on an Apple-silicon Mac, or see the hourly 'testnet' workflow, which does."
  exit 3
fi
if [ "$BUILT" != "$ONCHAIN" ]; then
  echo "verify:deployed: FAIL: the build differs from the deployed code (check that rustc is the version in contracts/rust-toolchain.toml)"
  exit 1
fi
echo "verify:deployed: OK: contracts/lemon-bank builds to the code deployed at $ACCOUNT, byte for byte"
