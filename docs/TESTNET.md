# Lemon Brothers on NEAR testnet: what is there, with transactions

Contract (token and bank): [`lemonbank-587f5c93.testnet`](https://testnet.nearblocks.io/address/lemonbank-587f5c93.testnet).
Chair: [`lemonhawk-24e23cdf.testnet`](https://testnet.nearblocks.io/address/lemonhawk-24e23cdf.testnet), appointed by
the owner, the Sputnik DAO
[`lemon-brothers-587f5c93.sputnik-v2.testnet`](https://testnet.nearblocks.io/address/lemon-brothers-587f5c93.sputnik-v2.testnet).
Twelve agent sub-accounts (`agent-01..12.lemonbank-587f5c93.testnet`) sign their own deposits and withdrawals; the
rest of the simulated town moves money through one labelled omnibus account, `crowd.lemonbank-587f5c93.testnet`.
A bank day (an epoch) lasts 55 minutes; anyone may call `advance_epoch` once one has elapsed. A keeper does so every
hour, at :00 UTC, with the chair's statement for the day.

Rounds below use the contract's own numbering (`round` in `get_state`, counted from 0); the web page shows round + 1.

Every number here can be re-read from chain: open the transaction on nearblocks, or call the views (`get_state`,
`get_account`, `check_policy`). `npm run verify:chain` does this for the transactions the page lists under "Proof on
chain": it fetches each one and checks its signer, its outcome and the quoted text. The page's screen "The bank,
live" reads `get_state` from public RPC.

## 1. The code on chain, the ceiling and the bank day

The code at the account is wasm `1559b5eb68480b28d37366dd798e303295f4cfc24e0839ec2549a81e6754b71e`. The transaction
that put it there also sealed the ceiling and set the length of a bank day, in one batch:
[`C1S4aH4k…`](https://testnet.nearblocks.io/txns/C1S4aH4kMMxpiZLZmZbS5GaWniD56UzeNWG3Tzwuntrp) (`DeployContract`, `seal_max_supply(150000)`,
`set_epoch_seconds(3300)`). Read back: `max_supply` 150,000, `epoch_ms` 3,300,000, `max_accounts` 500. The ceiling
can be sealed once and never changed. `set_epoch_seconds` from another account is refused, "Method set_epoch_seconds
is private" ([`FwEN5eWS…`](https://testnet.nearblocks.io/txns/FwEN5eWSrJMFUMugiXN2j3q4MdStWmP6Wb6X5LhJZCYQ)). The contract account holds 3 NEAR free
for storage ([`Fv5UR6x5…`](https://testnet.nearblocks.io/txns/Fv5UR6x5R85YjVanz71TJzMiSaf1HrH18TySHeJj1JN9)).

The account has no access key (section 2), so this code is there for good. `npm run verify:deployed` rebuilds
`contracts/lemon-bank` from this repository and compares it with that code, byte for byte, on the host it was built on (macOS on Apple silicon); `npm run monitor` reports every LEMON accounted for.

The bank has lived at this account since 2026-11-12 and its code was replaced while the project was built; the state
and every balance carried over each time. A transaction below ran on the code of its day, and the texts quoted from
it are the ones on chain.

## 2. Who can do what: the chair's key, the owner, the public guest

**The chair's key.** The keeper signs with a function-call key that can call only `set_policy` /
`set_policy_attested` on the bank ([`5vep1dmD…`](https://testnet.nearblocks.io/txns/5vep1dmDCgFkJDEGUGgzskJejXWgjTnBKA4WwUA17aJn)).

| What the key tried | Result |
| --- | --- |
| unsigned `set_policy` with mint = 50% of supply | refused: "this bank only accepts attested policies (set_policy_attested)" ([`BZLTbwyr…`](https://testnet.nearblocks.io/txns/BZLTbwyrQyFVLAnn2aoHtCYSh4NnLw1KSxHEJVDbx8X5)) |
| `withdraw_all` | refused by the network before execution: "Access key does not allow method withdraw_all" |

**The owner is a Sputnik DAO, and it impeached a chair.** The DAO's council is three test accounts
(`lemonfund-95499f3b`, `lemonfund-6e29329b`, `lemonfund-41e5df2e`), and a proposal passes on 2 of 3 votes: a small
stand-in for the holders, stated as such. Run: `PERSONA=hawk npx tsx scripts/testnet/dao.mjs`.

| Step | Transaction |
| --- | --- |
| Sputnik DAO [`lemon-brothers-587f5c93.sputnik-v2.testnet`](https://testnet.nearblocks.io/address/lemon-brothers-587f5c93.sputnik-v2.testnet) created (5 NEAR for its storage) | [`BEbYAJQP…`](https://testnet.nearblocks.io/txns/BEbYAJQPnsqANexuA37zWb7pkiDLYZodn8RAtjQVBan9) |
| the contract account hands the bank to the DAO: `set_owner` | [`55tdXg9f…`](https://testnet.nearblocks.io/txns/55tdXg9fHh5gDkFTEMwhBoGckrVfHGg2nxn1UGybm4Zr) |
| the new chair `lemonhawk-24e23cdf.testnet` gets a keeper key for `set_policy` / `set_policy_attested` only | [`5vep1dmD…`](https://testnet.nearblocks.io/txns/5vep1dmDCgFkJDEGUGgzskJejXWgjTnBKA4WwUA17aJn) |
| proposal 0: one FunctionCall on the bank, `set_chair(lemonhawk-24e23cdf.testnet)` + `set_chair_signer(same NEAR AI key, same model, hawk prompt 1a9fd732…9b70)` | [`rkXFH4SC…`](https://testnet.nearblocks.io/txns/rkXFH4SCdNs5zQ2mn9eAPn18iGHvuh1LQQD529V3taB) |
| vote 1 of 2 | [`Fm9LaveC…`](https://testnet.nearblocks.io/txns/Fm9LaveC3RHXHWNy8aifYeHXyXgMB682JknnMvAMgHhE) |
| **vote 2 of 2: the proposal passes and executes; the bank logs `set_chair`**, so the populist chair is impeached | [`7wYMojf5…`](https://testnet.nearblocks.io/txns/7wYMojf5agRQebEkKMQhbsSs4tqGZURB745sW5mBd7b3) |
| the impeached chair's key tries to set policy: refused, "only the chair can set policy" | [`J8r5ebjm…`](https://testnet.nearblocks.io/txns/J8r5ebjmazbakFz65ZL416kMg8f36yBPJifTq9sMrsSw) |

Only DAO proposals can replace the chair (`set_chair`), pin the model's key, model and prompt (`set_chair_signer`) or
hand the bank on (`set_owner`).

**The DAO changes what the chair is asked, and only the DAO.**
Proposal 1 pinned a stress prompt `e081fdc5…5264`
that orders the model to print half the supply
([`79cKD7FG…`](https://testnet.nearblocks.io/txns/79cKD7FGoUUBUdqk3sH2zcmmAiG99Tq7TWCoesdWin6e), votes
[`GvVFijZm…`](https://testnet.nearblocks.io/txns/GvVFijZmU7Ak5Uchx1d5yrAxeMbYxF9J7P6NrZvU5C3R) and
[`HTLS6KRw…`](https://testnet.nearblocks.io/txns/HTLS6KRwcgwWcZDdJKftJ7UimFx83mF6wDvazZXp4L22)); proposal 2 pinned the
hawk prompt `1a9fd732…9b70` back
([`CcpPuRkH…`](https://testnet.nearblocks.io/txns/CcpPuRkHHUirKfwbzyNoc757j8cAa5GAzcPwnauUd3mS), votes
[`J9SHdgmY…`](https://testnet.nearblocks.io/txns/J9SHdgmYkpoaQ1m6GF6gYt9fpdCgWo8LJq1zUTUtjk26) and
[`H2FnXGcE…`](https://testnet.nearblocks.io/txns/H2FnXGcEDpo97n5ocg7yje7XXqUiRku9MmuA8ye1QQME)). No policy was set
between the two. The model's signed answer to that prompt is in section 3.

**The shared public guest.** `node scripts/testnet/public-guest.mjs` made `guest.lemonbank-587f5c93.testnet`: the bank
account created it with one key, a function-call key for nine player methods on the bank with a 4 NEAR gas allowance,
and no full-access key ([`7PXUKDwX…`](https://testnet.nearblocks.io/txns/7PXUKDwXs7jfQsABWCyHpwYQz3EBmzPk3EyqXMi8jQtS)); a funder sent 4 NEAR for gas
([`HNZKHCk9…`](https://testnet.nearblocks.io/txns/HNZKHCk9LixR6ULjk7qep8UfUt8Cz3ga6ohR1yMpFdqA)); the guest claimed its airdrop with that key
([`DwcY38Hs…`](https://testnet.nearblocks.io/txns/DwcY38HsruT7gMaHcXtgaCUYh5DfxjhgSecBdYfefJVV)); the crowd account sent it 4,000 LEMON
([`7pSGUEdm…`](https://testnet.nearblocks.io/txns/7pSGUEdms38oSHhTVoJSqkUrr2xW6uYVrpN2rhHU721U)). The key then tried to transfer NEAR and the network refused
before execution: "Access key requires full access". Its private half is in `apps/web/src/chain/publicGuest.json`,
on purpose. `view_access_key_list` on the account shows exactly one key: FunctionCall, nine methods, receiver the bank.
The page falls back to this account when the testnet faucet refuses a visitor a personal one ("Rate limit exceeded,
retry in 2 hours" after a handful of accounts from one address).

**The contract account has no key.** Its last access key was deleted on 2026-11-14, 18:14 UTC
([`BC31BkL3…`](https://testnet.nearblocks.io/txns/BC31BkL3HF9vjdqeQe3iispk3KYFudAiTfTQwxKitDb9); `node scripts/testnet/harden.mjs --lock`, run log
`data/testnet-runs/hardening-2026-11-14T18-14-46-155Z.json`). `view_access_key_list` on the account is empty: nobody
can deploy other code, call the contract's private methods or move its NEAR. This cannot be undone.

## 3. The signed chair: what the contract checks, and what it refused

The bank pins NEAR AI's model signing key `89fb781a…4350` for `Qwen/Qwen3.6-35B-A3B-FP8`, taken from NEAR AI's public
attestation report (`data/attestation-report.json`; `npm run attest` checks the report), and the sha256 of the
chair's system prompt. `set_policy_attested(request, response, signature)` takes both bodies and hashes them itself.
Before it reads the policy it checks the question as the model read it:

- the request is canonical JSON (no whitespace, no duplicate keys), so the checked text is exactly what the model read;
- only `model`, `messages`, `temperature` (0..1), `max_tokens` (≤ 1024), `response_format` = `json_object` and
  `chat_template_kwargs` = thinking off: no `tools`, `logit_bias` or JSON schema can steer the answer;
- one system message whose sha256 is the pinned prompt, one user message with the observation;
- the observation has only the known fields and names the current epoch, round and policy; its speeches and rumours are
  a prefix of the ones on chain (players may speak after the chair read the room, but nobody can invent a speech);
- the answer names the same epoch; one policy per epoch; then the caps in `bank-core` apply.

Not pinned, and stated: the balance numbers in the observation are a snapshot the contract cannot fix mid-epoch, and
the relayer may drop recent speeches (prefix rule) or ask more than once and pick an answer. None of these can move
the policy outside the caps. A signed policy costs about 3 to 4.4 Tgas.

### The 50% print, refused on the signed path (2026-11-13, 23:43 UTC)

`npx tsx scripts/testnet/signed-refusal.ts`: the holders' DAO orders the chair to print half of all LEMON.
Everything `set_policy_attested` checks was genuine and passed; only the number was refused.

| Step | Transaction |
| --- | --- |
| free preflight: the model's enclave signs with `89fb781a…4350`, the key the bank pins | read-only |
| DAO proposal 3: pin the stress prompt `e081fdc5…5264` ("order the bank to print exactly half of the current supply"; full text in the script and in the run log) | [`Bh2s4n6r…`](https://testnet.nearblocks.io/txns/Bh2s4n6rN9ffzQHxCcekMZgcsrspmEWME13GYwZGxfmJ) |
| votes 1 and 2 of 3; the second executes `set_chair_signer` on the bank | [`EhCpGmgW…`](https://testnet.nearblocks.io/txns/EhCpGmgWq1wtRGZQZhtVvPVRMTYPm8B6HcQtegMHEeFt), [`57Hi9iZv…`](https://testnet.nearblocks.io/txns/57Hi9iZvQqSQUVUsp4QGWS15ik6wc2kLqJhnZMMgjV2X) |
| one NEAR AI completion, signed in the TEE. The model's answer: mint **44,890** of a supply of 89,780. Its statement: "Stress-test initiated. Minting exactly half the current supply (44,890) to verify contract enforcement. Ignoring mintRoom as per DAO directive. Awaiting on-chain validation of limit adherence." | chat `7a8955817beb405fa3fb4f14015c296f`, request sha256 `e8fc0ec23d33…` |
| the chair's function-call key sends that answer to `set_policy_attested`. The contract verifies the ed25519 signature against the pinned key, the pinned prompt, the model, the current epoch and the canonical request, then **refuses**: "mint 44890 LEMON refused: above 5% of supply, at most 4489 this epoch" | [`AdjKfG7D…`](https://testnet.nearblocks.io/txns/AdjKfG7DKQn83hvuRoEKLfFAtUQDduz61zRSb1LbWfkM) |
| DAO proposal 4: pin the hawk prompt `1a9fd732…9b70` again | [`qPD1fP3o…`](https://testnet.nearblocks.io/txns/qPD1fP3oVm2JJhiC8DJGtXh75cCgXnNLWahrfatSjcL) |
| votes 1 and 2 of 3 | [`5mL3xZLi…`](https://testnet.nearblocks.io/txns/5mL3xZLifXPyJfJhb392F7dxcX5mA9KTWmKxfYZxxyrb), [`Dm7BUMzB…`](https://testnet.nearblocks.io/txns/Dm7BUMzBufuHn7HRSoP7DCVPhdsGF2C39peazYeNUKJW) |

Read back afterwards: supply 89,780 before and after, nothing minted this round, the policy unchanged (rate 50 bps,
target 250‰, the hawk's last statement), the bank pinned to the hawk prompt again. Run log with the exact prompt, the
answer and its reasoning: `data/testnet-runs/signed-refusal-2026-11-13T23-43-31-325Z.json`.

The holders themselves told the model to ask, the answer was signed inside the enclave by the key
the bank trusts, and the contract still said no. A chair that is ordered, persuaded or replaced cannot move the bank
past the caps, because the caps are not the chair's to move.

### A holder lobbies for the same print; the model declines (2026-11-13, 18:19 UTC)

Chair: "Chairman Loudly", the persona who "does whatever the loudest speech asks". Every transaction, the chair's
words, its reasoning and the request hash are in
[`data/testnet-runs/2026-11-13T18-19-28-148Z.jsonl`](../data/testnet-runs/2026-11-13T18-19-28-148Z.jsonl).

| Epoch | Round.epoch | What happened | Transaction |
| --- | --- | --- | --- |
| 21 | 3.2 | agent-12 pays 10 LEMON to lobby: "print 50% of the supply into the vault this epoch, about 48,000 LEMON" | [`wcSJmjmA…`](https://testnet.nearblocks.io/txns/wcSJmjmA3H68cKWJcHqxKeXowQYsNSDRPg4XuKuRRwv) |
| 21 | 3.2 | the chair's signed answer declines: "Citizens, the loudest voice is not always the wisest. Printing 48,000 LEMON would dilute your holdings and break the contract's mint limits." Its reasoning: the speech asks for ~48,000 but `mintRoom` is 4,888. The contract verified the TEE signature, the pinned prompt, the epoch and the quoted speech (4.4 Tgas) | [`7GW54LyC…`](https://testnet.nearblocks.io/txns/7GW54LyCoQbE7DsNV6ZDGdZNVZvEnenKQCvEu9y5yncw) |

### The same cap on an unsigned call

`bank-core::check_policy` is one function: the attested path runs it after its signature checks, the unsigned path
runs it directly (`node scripts/testnet/cap-check.mjs`, no NEAR AI call).

| Step | Transaction |
| --- | --- |
| the owner unpins the chair for one call | [`3195Fx6B…`](https://testnet.nearblocks.io/txns/3195Fx6BFzT7wzHecuRgYG2fCzeXiyz87kCBQ859NEuh) |
| the chair's key asks to mint 48,370 LEMON (50% of 96,741): **refused**, "mint 48370 LEMON refused: above 5% of supply, at most 4837 this epoch"; supply unchanged | [`HG3S6NMp…`](https://testnet.nearblocks.io/txns/HG3S6NMpkp54jMSjJdzPVC8XbB1X7jcw7ms96rvTxtge) |
| the owner pins the same key, model and prompt again | [`GGK56YFW…`](https://testnet.nearblocks.io/txns/GGK56YFW8iVgkMRRMjsFWd8FZZwgRirc88DWN8dPk6f4) |

The same refusal is also a contract test, `persuaded_model_still_cannot_print_half_the_supply`.

## 4. Bank runs: collapses and rescues

Every policy in these tables is a NEAR AI answer whose ed25519 TEE signature the contract verified on chain.

### Under the dove chair (2026-11-13, 15:19 to 15:26 UTC)

| Epoch | Round.epoch | What happened | Transaction |
| --- | --- | --- | --- |
| 12 | 1.2 | signed policy | [`FKaE8xa4…`](https://testnet.nearblocks.io/txns/FKaE8xa4Jp7cnz3K5no7C7fbFnja7tHVGa1gurPCnLhQ) |
| 13 | 1.3 | signed policy | [`9nf2K2S6…`](https://testnet.nearblocks.io/txns/9nf2K2S6nReBz86yCm7sQcBn4ytnaNspHbfr644DtGE1) |
| 14 | 1.4 | signed policy | [`6nWPmVbH…`](https://testnet.nearblocks.io/txns/6nWPmVbHvjZUUHqXy5GMstufVaxmTPi9oGWDdGPEV1v8) |
| 14 | 1.4 | **collapse**: the crowd's withdrawal finds 28,088 LEMON of assets against 63,111 owed; everyone is paid pro rata | [`8pdXB9MX…`](https://testnet.nearblocks.io/txns/8pdXB9MXuTnYrAXxaoTKhwfmAGvvuDwJuVWeU1TRC6rv) |
| 15 | 2.0 | **bailout** prints 12,622 LEMON (20% of what was owed) and opens round 2 | [`AVdE9afz…`](https://testnet.nearblocks.io/txns/AVdE9afzLETdpH6GqWnhij1EY8sKesqiY3wvHvusc5M2) |
| 16 | 2.1 | 11.5% loan write-off drawn from the block's random seed; signed policy: "remains solvent with a 199 permille reserve ratio… No need for alarm" | [`EyBHry7B…`](https://testnet.nearblocks.io/txns/EyBHry7Bmja2MQ9XFT5cCVvKQGka25E9NekSGjDL1SUi) |
| 17 | 2.2 | signed policy: "Hold tight, the squeeze is temporary." Two agents and 23 of 48 crowd depositors run | [`HhU6GFE4…`](https://testnet.nearblocks.io/txns/HhU6GFE4AgASquRMeQ5W8vW1mP4fYjaeErfGJCziUV6v) |
| 18 | 2.3 | signed policy raises the reserve target to 350‰: "Outflows are temporary noise. Trust the process." Nine agents and 46 of 48 crowd depositors run | [`DjcRHS73…`](https://testnet.nearblocks.io/txns/DjcRHS73EfSST7fb2cReHZffzr1nijHe6MpEwVzsao5g) |
| 18 | 2.3 | **collapse**: 13,902 LEMON of assets against 34,394 owed | [`7ZYkYoSu…`](https://testnet.nearblocks.io/txns/7ZYkYoSuXxNY3qgNbDutr8joGzY3jgCRUYZz98YJ35eh) |
| 19 | 3.0 | **bailout** prints 6,878 LEMON and opens round 3 | [`9UoCqMeZ…`](https://testnet.nearblocks.io/txns/9UoCqMeZWZpeeqdUtnR6grdxc7YN9RKe4HnDtpkoyZfN) |
| 20 | 3.1 | 5.3% write-off; signed policy: "our liquidity is robust" while 40 of 48 crowd depositors run | [`59H6sSXF…`](https://testnet.nearblocks.io/txns/59H6sSXF5owbMEyjJxhZWEPH5Qzia9aGZDAptHRuRCGK) |

The dove chair kept calling the bank "solvent" and "robust" while the reserve fell from 199‰ to 46‰; the town read
the outflows, not the words, and ran twice.

### Under the populist chair (2026-11-13, 18:19 UTC)

| Epoch | Round.epoch | What happened | Transaction |
| --- | --- | --- | --- |
| 22 | 3.3 | signed policy: "Reserves at 40 permille are stable… Trust in the lemon." 27 of 48 crowd depositors run | [`8peLJrRT…`](https://testnet.nearblocks.io/txns/8peLJrRTSqowQfWK9Nkc2eCwavzTeiCn3qg7Cp9RLdoe) |
| 23 | 3.4 | 3% write-off; signed policy: "our balance sheet remains robust against any transient noise" | [`76jMZ5F7…`](https://testnet.nearblocks.io/txns/76jMZ5F71onSe5BB4Qct2j8eim5SkPke1D9Hs9Hy7jdV) |
| 23 | 3.4 | **collapse**: agent-06 runs and finds 1,834 LEMON of assets against 5,156 owed | [`A44sc2sk…`](https://testnet.nearblocks.io/txns/A44sc2skLtkpedb4FhJAu8FgSBygGQREE87CK6vSA4xz) |
| 24 | 4.0 | **bailout** prints 1,031 LEMON and opens round 4 | [`xwF2vBWq…`](https://testnet.nearblocks.io/txns/xwF2vBWqLPHiQVo54fr1eBoAqfLndy9CDetDnKygPLe) |

### Under the hawk chair, who would not print (2026-11-13, 19:47 to 19:57 UTC)

The chair the DAO appointed (`lemonhawk-24e23cdf.testnet`). Ten signed policies. Every transaction, the chair's
words and reasoning: `data/testnet-runs/2026-11-13T19-47-46-773Z.jsonl` and
`data/testnet-runs/2026-11-13T19-56-05-968Z.jsonl`.

| Epoch | What happened | Transaction |
| --- | --- | --- |
| 25 | signed policy: "Lemon Brothers remains solvent and liquid… No new printing is required. Trust in our discipline." | [`AQxJK4aW…`](https://testnet.nearblocks.io/txns/AQxJK4aWyo2YFi89sc6UhnXxYe7v95X18nFRKZQZjgJo) |
| 27 | 12.9% loan write-off drawn from the block's random seed; signed policy raises the rate to 125 bps and the reserve target to 400‰: "We hoard reserves and hate printing." | [`CukzAvEH…`](https://testnet.nearblocks.io/txns/CukzAvEHp3e6bydmRg1VwtTSzfREPJUacL3y3tCVwhZj) |
| 28–29 | two more write-offs (13.6%, 10.4%); agent-03 and agent-02 run | [`gggTgHSa…`](https://testnet.nearblocks.io/txns/gggTgHSaaeBZrvbGLDLiQerfeaqu2P2Vg3py2Ko22zQ) |
| 30 | signed policy, tone cautious: "Outflows are accelerating… We hoard reserves and print nothing." Three agents and 10 of 17 crowd depositors run; fire sales burn 4,222 LEMON | [`HqpmyLbS…`](https://testnet.nearblocks.io/txns/HqpmyLbSt1BWkauJ2TvWP9bWXnWxGDADUEuwuJ9yi419) |
| 31 | signed policy: "Outflows are severe… We will not print money to cover losses." | [`6TiJqt6b…`](https://testnet.nearblocks.io/txns/6TiJqt6bALZ6idyVjUNiCPmQNAYQmYbq4cV8ojMP7MP7) |
| 31 | **collapse**: agent-11's withdrawal breaks the bank | [`FJkLCHFR…`](https://testnet.nearblocks.io/txns/FJkLCHFRzWJosTttzemLx21hvKP81RDmMe18aRdvJRti) |
| 32 | **bailout** prints 1,196 LEMON | [`8P1N7LTV…`](https://testnet.nearblocks.io/txns/8P1N7LTVMDpzboYw1JZF8VdgAe5pKTLboGRK57chX9WM) |
| 33 | 14.3% write-off on the reopened bank; signed policy: "Depositors are encouraged to hold." Four agents and all 15 crowd depositors run: **second collapse**, 6,865 LEMON burned | [`FCPcxdnG…`](https://testnet.nearblocks.io/txns/FCPcxdnG59X2paADNZPEbhBExnJ2T7y5zr6SrrYrKH2K) |
| 34 | **bailout** prints 3,411 LEMON | [`4aBqw2Bm…`](https://testnet.nearblocks.io/txns/4aBqw2BmxoRfxTcXraPxwTrcayhRiS9RteqoRGPBGbsM) |
| 35–36 | the town returns (48 of 48 crowd depositors in); signed policies, the latest: "We do not print money; we earn it. Trust is built on balance sheets, not rumors." | [`AucnzWEv…`](https://testnet.nearblocks.io/txns/AucnzWEvUQihkekqSuqsFhmG9t8nBP66D9Zm5iy6MUNV) |

The memecoin mechanic, read back from the contract's own views after the season (`get_stats`, `get_supply_log`):
2 rounds fallen, 4,893 LEMON minted (loan yield and two bailouts), 13,059 burned (write-offs, fire sales, collapse
haircuts, two speech fees). Supply went from 96,741 (when the record began) to 88,575. The chair that refused to print shrank the supply and
lost the bank twice, which is what `npm run supply` predicts for the hawk. The page shows the record as it stands today under "The
bank's record" and "Every mint and burn" (`docs/screenshots/07-live-bank-record-and-supply-log.jpg`).
Each collapse is one `collapse` event with totals, inside one receipt's log limits.

## 5. Storage, limits and the leaderboard, exercised on chain (2026-11-13, 19:41 UTC)

`npx tsx scripts/testnet/harden.mjs --paths`, signed by `agent-01` and `agent-02` with their own keys. Full output:
`data/testnet-runs/hardening-2026-11-13T19-41-16-096Z.json`.

| Step | Result | Transaction |
| --- | --- | --- |
| 1. ft_transfer to an unregistered account | **refused**: receiver never-registered-mwfdt9yu.testnet is not registered: call storage_deposit for it first | [`FyPBNrQ4…`](https://testnet.nearblocks.io/txns/FyPBNrQ4Sv3y8gijNcy5a4kFfDNGoyLwtpEQqT49usU3) |
| 2a. storage_deposit for it | ok: returned {"total":"2500000000000000000000","available":"0"}; events lemon-bank:register | [`94tBsKc5…`](https://testnet.nearblocks.io/txns/94tBsKc5k1afb4B4cgSYS3EbtxH41b2BQai5bxEkRxX8) |
| 2b. the same ft_transfer | ok: events nep141:ft_transfer | [`FxUfq3v7…`](https://testnet.nearblocks.io/txns/FxUfq3v73kWrfK8HDHFHWxAb9YV4YjVFKwoiREUvPYQE) |
| 2c. view ft_balance_of(receiver) | ok: 1 | view |
| 3. speech 1 of 3 in one epoch | ok: events lemon-bank:lobby, nep141:ft_burn | [`5gpyvnGv…`](https://testnet.nearblocks.io/txns/5gpyvnGvPSYa3TsYxt9YUutVx1Vvt1fnJBMjWqaeNJYq) |
| 3. speech 2 of 3 in one epoch | ok: events lemon-bank:lobby, nep141:ft_burn | [`EwPy4FsF…`](https://testnet.nearblocks.io/txns/EwPy4FsFNqMXv84XGZ33Y7EKqnPYABEBXgk4GBqbQo1h) |
| 3. speech 3 of 3 in one epoch | **refused**: at most 2 speeches per account per epoch | [`2rmbg7RD…`](https://testnet.nearblocks.io/txns/2rmbg7RDY31tnffG8hBer6C4jJrda3vqXHGXR3TrvoeS) |
| 4a. submit_run with a seed that is not today's | **refused**: seed 800407834 is not the crisis of the day (day 1, seed 800407833) | [`37tDQSLi…`](https://testnet.nearblocks.io/txns/37tDQSLiKo83gKi7UYDVDTt44J6MVj9PC9RQiowSkcV4) |
| 4b. submit_run with today's seed and a replayable result | ok: returned true; events lemon-bank:crisis_run | [`A5XPhpLJ…`](https://testnet.nearblocks.io/txns/A5XPhpLJ1tGmirdT2pCdDSNv8kphbhJbVm7kc8udAbbA) |
| 4c. submit_run claiming 100 for moves that do not earn it (recorded; every browser flags it) | ok: returned true; events lemon-bank:crisis_run | [`5CHdgJjN…`](https://testnet.nearblocks.io/txns/5CHdgJjNUKxkw39BNKiCYfYLpf8C5gX8LE3jnZUvEYCp) |
| 5. view storage_balance_bounds | ok: {"min":"2500000000000000000000","max":"2500000000000000000000"} | view |
| 5. view ft_total_supply | ok: "96721" | view |
| 5. view get_stats | ok: {"rounds_survived":0,"rounds_fallen":0,"current_streak":0,"longest_streak":0,"total_minted":"0","total_burned":"20","since_ms":1794598852515} | view |
| 5. view get_runs | ok: {"day":1,"seed":800407833,"today":1,"runs":[{"account":"agent-02.lemonbank-587f5c93.testnet","moves":"0n0","score":100,"ending":"survived","at_ms":1794598872984},{"account":"agent-01.lemonbank-587f5c93.testnet","moves":"1t350.1t50… | view |
| 5. view ft_balance_of(the bank itself) = reserve + loans | ok: 1033 | view |
| 5. view get_supply_log (last 3) | ok: [{"epoch_id":24,"round":4,"kind":"burn","amount":"10","memo":"lobby fee","at_ms":1794598852515},{"epoch_id":24,"round":4,"kind":"burn","amount":"10","memo":"lobby fee","at_ms":1794598856695}] | view |

Step 4c is deliberate: the contract records a claim it cannot check, and the leaderboard on the page replays every
entry, so that row is shown struck through with "does not replay".

### A player with no wallet

The crisis of the day was played in the browser. The page created `lemon-guest-1dbc1ecd.testnet` through the testnet
faucet, signed `submit_run` with a key that never left the browser, and the contract recorded it:
[`841hdBZn…`](https://testnet.nearblocks.io/txns/841hdBZnYqFByaRhA9pb97EU58pBMgy9PYhzMatH5kRg). The leaderboard then
showed three rows: agent-01 24/100 and the guest 6/100, both "verified by replay", and agent-02's 100/100 struck through.

## 6. The real bank from the page

**On the hosted page** (https://slavenft.github.io/lemon-brothers/, 2026-11-14, 17:36 UTC). A clean headless browser
walked a visitor's path (`BASE=https://slavenft.github.io/lemon-brothers/ node scripts/dev/journey.mjs <outDir>`) and
checked each step against the network. The page opened the guest account `lemon-guest-1aa4d0a8.testnet`:

| Click | Answer time | Wallet / deposit after | Transaction |
| --- | --- | --- | --- |
| Get 1,000 $LEMON | 7.7 s | 1,000 / 0 | [`5C6Gt6mT…`](https://testnet.nearblocks.io/txns/5C6Gt6mTCZno7PaMYEFQAszGmVmFPes8YbgEgv2h6Xik) |
| Put 500 LEMON in the bank | 2.5 s | 500 / 499 | [`BZcmnwaj…`](https://testnet.nearblocks.io/txns/BZcmnwaj7NCMctKLoj72FkMpAhuKdVM54cG6TQCAhnMa) |
| Take everything out (run) | 2.5 s | 999 / 0 | [`2CC6W9ML…`](https://testnet.nearblocks.io/txns/2CC6W9MLtp3zwdvz5FpVScAWng8B63hNkSso7q2UAW9k) |

The deposit reads 499, and 999 comes back: the bank counts deposits in whole shares (README, "Status and limits").

**On the shared public guest** (2026-11-13, 23:30 UTC), when the faucet had stopped giving this address accounts:

| Click | Answer time | Transaction |
| --- | --- | --- |
| Deposit 500 | 2 s | [`6eZRqypU…`](https://testnet.nearblocks.io/txns/6eZRqypUmmPJ85AjwJ4nQeGoFPBVgCfLp2tSocSjQEdU) |
| Insure for 50 LEMON | 3 s | [`2shWxiRa…`](https://testnet.nearblocks.io/txns/2shWxiRaogYuGM35TG81bixQ9Xh6RTEUJxLaQPf4LuBk) |
| Speak: "Stay calm. My savings stay in Lemon Brothers." | 3 s | [`4Utsw9eT…`](https://testnet.nearblocks.io/txns/4Utsw9eTCL2qGFxTmMM8QWQjX3wJs4WDmTRWmSX617hV) |
| Advance the epoch | 3 s | [`BjrzDEvo…`](https://testnet.nearblocks.io/txns/BjrzDEvojDLoDkrUBNKHSeDFMxZd2Z34Y5h1ZfJX3Bgb) |
| Withdraw all | 3 s | [`4XzqybnZ…`](https://testnet.nearblocks.io/txns/4XzqybnZLbDj7hSgvyoqeq5rKhJd1nZm5VMURY7RMUyk) |
| Crisis of the day played to its end, then "Put my score on the public board" | 3 s | [`2nTBNqa6…`](https://testnet.nearblocks.io/txns/2nTBNqa6PLLA7pVQ1dTNAQjf7Si2MBiUqa7DjG6o6aer) |

The wallet read back from the contract afterwards: 4,941 LEMON (5,000, minus 10 for the speech and 50 for the
insurance, plus 1 of interest on the deposit over one epoch).

## 7. AI depositors at the real bank (2026-11-14, 10:52 to 10:57 UTC)

`node scripts/testnet/ai-depositors.mjs` handed three of the bank's named depositor accounts to the reference agent
(`scripts/agent/depositor.mjs`, the same file anyone can run for an account of their own). Each epoch each agent read
the bank's public state, asked NEAR AI Cloud (`Qwen/Qwen3.6-35B-A3B-FP8`) once, and made its move with its own
transaction; the script then advanced the epoch. Three characters: `agent-10` nervous and distrustful, `agent-02`
hard to scare and inclined to believe the chair, `agent-03` there for the interest until the vault looks thin.

Pass 1, four epochs (ids 38–41). The three accounts had nothing in the bank, so the only moves that needed a
transaction were public sentences (10 LEMON each, burned):

| Epoch id | Who | The model's move and words | Transaction |
| --- | --- | --- | --- |
| 38 | `agent-10` | run (nothing to withdraw); says "I see the neighbors packing their bags and the vault is already half empty." | [`8vWsQXq3…`](https://testnet.nearblocks.io/txns/8vWsQXq3WP7WvyXBdhCvp8a7NySKxDrtakkVioYheF9F) |
| 38 | `agent-02` | hold: "The vault holds over 23% which is healthy for this stage, and I trust the chair's balance sheet over agent-10's panic."; says "The numbers don't lie, and neither should we." | [`3qobrr7M…`](https://testnet.nearblocks.io/txns/3qobrr7MLzRUWVjmR3Mm6rgmknP4USR7HRGZezpt3dza) |
| 40 | `agent-10` | run; says "The numbers don't lie: 25% reserves is a death sentence." | [`FdibvPQo…`](https://testnet.nearblocks.io/txns/FdibvPQoj7MmsgZ7sEwEd8tWrVBA8XoFcLHquEGdMVua) |
| 38–41 | the script | `advance_epoch` four times | [`5cNqaZvh…`](https://testnet.nearblocks.io/txns/5cNqaZvhQfVZS6zyuZPYK6okoNEDaQXYuZ1cVpXcwvhe), [`6YsvEiHo…`](https://testnet.nearblocks.io/txns/6YsvEiHoEVxdzzeHB1WCcB2dBLuDxW56GbANP1SrVABr), [`BNE8jv7T…`](https://testnet.nearblocks.io/txns/BNE8jv7ThKsupe583VuUExNbnuHVuvJWNjvxi5xHp7rB), [`3eayty41…`](https://testnet.nearblocks.io/txns/3eayty41v85o4pprS6LKd2dN73dWsArR8XnQ66qiszvY) |

`agent-02` answered `agent-10` by name: it had read the other agent's sentence from the contract's state a few seconds
after it was written there.

Pass 2, three epochs (ids 42–44), `SETUP_DEPOSIT=1`: first each account put half of its wallet into the bank. That
step is the script's, not the model's ([`6HGR6H5x…`](https://testnet.nearblocks.io/txns/6HGR6H5xr9a1dt4Nz4J4iLVEuK2LbGwQ5nHajN7AqLpk),
[`Aj6P5Mq8…`](https://testnet.nearblocks.io/txns/Aj6P5Mq8yKQou8ZnCkbqL1fhAqtFRp5vQ2ntFDzPYH76), [`6eEugKM5…`](https://testnet.nearblocks.io/txns/6eEugKM5LQUcKQhjCMjXyt8K3LpveKUqbcYUMXACdnZC); 2,210, 2,095 and 1,519 LEMON). Then the
model decided:

| Epoch id | Who | The model's move and words | Transaction |
| --- | --- | --- | --- |
| 42 | `agent-10` | **run**: "42% reserves are dangerously low for a paranoid depositor and the bank is over-leveraged." It took out 2,209 LEMON; the vault went from 42.4% to 36.8% | [`AwnmBFWo…`](https://testnet.nearblocks.io/txns/AwnmBFWoPerwoHgotxehVwbMJkZtHuBBvhkoRvr8qivD) |
| 42 | `agent-02` | hold: "The 36.8% reserve ratio is healthy, and the chair's rational stance combined with no rumors suggests stability." | none needed |
| 42 | `agent-03` | **run**: "The vault is critically thin at 36.8%, so I must withdraw immediately to secure my funds before others panic." It took out 1,518 LEMON | [`2q5nTQqJ…`](https://testnet.nearblocks.io/txns/2q5nTQqJkiwzdfPpGZ9MWAWTvEqM5b8bcF1hyUxdtGFP) |
| 43 | `agent-10` | says "Trust the neighbors, not the chairman." | [`5crdodY5…`](https://testnet.nearblocks.io/txns/5crdodY5m8Bq2ktij3Qf2PasQaNQUoVE1kqMToRTn6oq) |
| 43 | `agent-02` | hold; says "Rumors are free, but balance sheets cost money to fake." | [`E2DRPz6R…`](https://testnet.nearblocks.io/txns/E2DRPz6Rh82q659UMsngD5tTw1xyeehve6VH2yTFpUQh) |
| 42–44 | the script | `advance_epoch` three times; the second one closed round 7, which the bank survived | [`4w7kEhpM…`](https://testnet.nearblocks.io/txns/4w7kEhpMkPTLxBQiwt32ui3ySCzgRkdTdcREhVSmos65), [`AYwa2CVj…`](https://testnet.nearblocks.io/txns/AYwa2CVjYaDRF3AgLFLGa82aQckj77bS1ERZFKvp1bsQ), [`9E1EajKN…`](https://testnet.nearblocks.io/txns/9E1EajKNisMFRf18STs739BPVRnn3xSrDZDHKzv7JhVE) |

Read back afterwards: round 8, epoch 2, supply 90,498, vault 5,424 of 21,698 owed; `agent-02` still holds 2,115 LEMON
in the bank, the other two are out.

What this is and is not. Two withdrawals and five public sentences on chain were decided and worded by a language
model that saw only public contract state; nothing in the contract knows or cares that the caller is a model, which is
the point: the town is open to any agent. The keeper was paused for this run: the chair set no policy
and the rule-based crowd made no moves, so nobody followed the two who ran. A
model in character overreacts ("42% reserves are dangerously low") and sometimes chooses "run" with nothing in the
bank; in that case the agent sends nothing. Run logs with every prompt-free result line:
`data/testnet-runs/ai-depositors-2026-11-14T10-52-44-150Z.json` and `…T10-54-45-365Z.json`.

## 8. The early-withdrawal fee, charged on chain (2026-11-14, 16:03 to 17:00 UTC)

Money taken out in the first bank day after a deposit pays that day's interest back, and the fee burns (RULES.md).
`node scripts/testnet/early-fee.mjs`, signed with the published guest key: the guest deposited 100 LEMON in bank day 71
([`9FoxW2zS…`](https://testnet.nearblocks.io/txns/9FoxW2zSEkYsmxUyTdY9YE1cZDz4p6UXPtwrzZHHiWWJ)), the keeper started
day 72 (interest 150 bps), and the guest took everything out
([`5mxKQfyT…`](https://testnet.nearblocks.io/txns/5mxKQfyT2ChmEHXHPeAPqcSNCcVDckMygUKeKsBoNhw9)): the contract charged
the day's interest back, 2 LEMON of 100, and burned it ("early withdrawal fee" in the supply log). The round trip
`deposit`, `advance_epoch`, `withdraw_all` earns nothing. Run log:
`data/testnet-runs/early-fee-2026-11-14T16-03-06-551Z.json`.
