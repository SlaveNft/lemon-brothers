# RULES: The Chair of Lemon Brothers

Every rule and number of the game, with the reason for it. The contract (`contracts/bank-core`) and the simulation
(`packages/sim`) implement the same integer math; parity tests keep them identical. Agents and the chair run off
chain and only act through the contract's public methods.

## Units

- $LEMON is an NEP-141 token with 0 decimals: one unit is one LEMON. Reason: whole numbers keep the contract and the
  simulation bit-identical and are easy to read on an explorer.
- Rates are in basis points (bps, 1/10,000). Ratios are in permille (‰, 1/1,000).

## The bank

The contract is both the token and the bank. Depositing moves LEMON from your wallet into the bank's reserve and
gives you deposit shares. A share's value grows with the deposit rate through a global index
(`index`, scaled by 10^12): `value = shares * index / 10^12`. Reason: interest accrues for every depositor in one
operation, with no loop over accounts.

| Quantity | Meaning |
| --- | --- |
| reserve | LEMON the bank holds and can pay out right now |
| loans | LEMON lent out; earns yield, cannot be paid out without selling |
| liabilities | value of all deposit shares |
| equity | reserve + loans - liabilities (can go negative: the bank is insolvent but may still be liquid) |

### The ceiling: the most LEMON that may ever exist

Every bank has a ceiling, `max_supply`, fixed when it is created: its opening supply plus a quarter
(`MAX_SUPPLY_PERMILLE = 1250`). No mint of any kind lifts the supply above it:

| mint | at the ceiling |
|---|---|
| loan yield (each epoch) | cut down to the room that is left, 0 when there is none |
| the chair's print (`set_policy`) | the whole call is refused: "the bank's ceiling is N LEMON, at most R can still be printed" |
| bailout after a collapse | cut down to the room that is left |
| insurance payout at a collapse | cut down to the room that is left |
| a newcomer's airdrop | refused, and no account is created: "newcomers get coins again once some have burned" |

Past the ceiling, new LEMON can only replace LEMON that burned (fire sales, write-offs, fees). Reason: loan yield
prints every epoch and airdrops print for every new account, so without a ceiling the supply has no upper bound. The 5%-an-epoch
limit bounds how fast the chair can print, the ceiling bounds how much can exist at all. The quarter of headroom is
there so that a ten-day crisis never touches the ceiling (the most a chair can add in ten days is the 15% round limit
plus about 5% of yield), which keeps every recorded game replaying to the same score.

On chain the ceiling is a record of its own (`x:cap`). `new` writes it once. For a bank that has none, the contract
account may call `seal_max_supply(max_supply)`: it works once, never below the supply in existence, and nothing can
change the ceiling afterwards. The bank on testnet is sealed at 150,000 LEMON. `get_state` reports the ceiling as
`max_supply` (null if not set).
The parity test asserts `supply <= max_supply` after each of its 8,000 operations.

### Each epoch (`advance_epoch`, permissionless once the epoch has elapsed)

In this order:

0. Loan defaults: with a 15% chance per epoch, 3%..15% of the loan book is written off (burned). It is public news.
   Reason: a bank run needs a spark; write-offs are the realistic one and give the chair something to answer. On chain
   the draw comes from the block's random seed; the simulation uses its seeded RNG.
1. Loan yield: `loans += loans * 60 / 10000` (0.60% per epoch, minted, never past the ceiling). Reason: the loans are
   where the bank's money is made; the yield is new LEMON, so a healthy bank grows supply until the ceiling stops it.
2. Deposit interest: `index += index * rate / 10000`, where `rate` is the chair's deposit rate. Reason: the chair's main
   lever. A rate above the loan yield pays depositors more than the bank earns and eats equity.
3. Amortization: `repaid = loans * 500 / 10000` (5%) moves from loans to reserve. Reason: a slow natural refill, so a
   bank is never frozen forever.
4. Rebalance: if `reserve > liabilities * target / 1000`, the excess is lent out. The bank never recalls loans on its
   own. Reason: a fractional-reserve bank lends everything it is allowed to; that is what makes it fragile.
5. The epoch counter advances. After epoch 10 the round ends (see Rounds).

### Withdrawals (`withdraw(amount)` or `withdraw_all()`)

1. Gate: if the chair has set a gate, an account may take at most `gate` LEMON per epoch; a larger request is cut to
   the remaining allowance. Reason: capital controls exist and buy time, but agents read them as a sign of trouble.
2. If the reserve covers the request, it is paid from the reserve.
3. Otherwise the bank fire-sells loans to a vulture fund at a 40% haircut (`sold = ceil(need * 1000 / 600)`), and the
   haircut is burned. Reason: this is how runs turn liquidity problems into losses for everyone who stays.
4. If even selling every loan cannot cover the request, the bank collapses, in the same call: all loans are sold at
   the haircut (the haircut is burned), and the remaining assets are split pro rata over all deposit shares. Every
   depositor, including the one withdrawing, gets `assets * shares / total_shares` (rounded down) straight into their
   wallet, in registration order, and their shares are set to zero. There is nothing to claim afterwards. The few
   LEMON lost to rounding stay in the reserve. Then insurance pays out (see Players), the share index goes back to
   1, and the bank stays closed (no deposits, withdrawals, insurance or policy) until the next `advance_epoch` runs the
   bailout (see Rounds). The withdrawal that triggered the collapse is not paid as requested: its caller gets the
   same pro rata share as everyone else. Reason: first come, first served until the money runs out, then everyone
   left takes the same haircut (Diamond-Dybvig).

   The collapse settles every depositor in one call, so its cost grows with the number of accounts. That is why the
   contract holds at most 500 accounts (see Token). The call logs one `collapse` event with the totals (accounts
   settled, LEMON paid out, accounts insured, insurance minted), not one event per account (see Token).

### The early-withdrawal fee (contract only)

Money taken out in the first bank day after the account's latest deposit pays back the interest that the one
`advance_epoch` in between added: `fee = ceil(withdrawn * rate / 10000)`, where `rate` is the deposit rate that
`advance_epoch` applied (0 after a bailout), never more than the withdrawal. The fee burns. Money taken out on the day
it went in pays nothing (no interest was added to it); money that stayed a whole bank day pays nothing either. Every
deposit restarts the account's clock. `get_account` says `early_fee_now: true` while the fee applies.
Reason: a deposit earns a whole day's interest however late in the day it arrives, and anyone may call
`advance_epoch`. Without the fee, deposit -> advance_epoch -> withdraw_all in a row would collect a day's interest at
no risk, and could be repeated every bank day while the deposits of everyone else grew on paper past the coins behind
them. The fee lives in the contract's wrapper (`lemon-bank`), not in `bank-core`: the game cannot be gamed this way
(nobody but the game moves its days), so the simulation, the parity vectors and the recorded games do not have it.

### The length of a bank day

The deployed bank's day is 55 minutes (`set_epoch_seconds`, which only the contract account can call). The keeper
moves the bank once an hour and the chair speaks once a bank day: a day slightly under an hour keeps the keeper on
time, and a much shorter day would let anyone move the bank on faster than the chair speaks.

## The chair

The chair is one account holding a function-call access key that can call only `set_policy` and
`set_policy_attested` on the bank. Both set the same policy under the same bounds; which one the bank accepts depends
on whether the DAO has pinned a signing key (see Attested mode). The contract checks every field; an out-of-bounds
field rejects the whole call and the previous policy stays. Reason: the AI can be persuaded, jailbroken or wrong, and
it still cannot move more than the contract allows.

A policy can be set once per epoch, and not while the bank is closed after a collapse, with:

| Field | Bounds | Max change per epoch |
| --- | --- | --- |
| `rate` (deposit rate, bps per epoch) | 0 .. 300 | 75 |
| `target` (reserve target, ‰ of liabilities) | 100 .. 800 | 150 |
| `mint` (emergency liquidity, LEMON into the reserve) | 0 .. 5% of supply per epoch, 15% of the round's starting supply per round | |
| `gate` (max withdrawal per account per epoch, LEMON; 0 = off) | 0 or >= 100 | |
| `tone` | calm, confident, cautious, alarming | |
| `statement` | up to 280 bytes, published | |
| `attestation` | up to 200 bytes; see below | |

Starting policy: rate 40, target 200, mint 0, gate 0, tone calm, empty statement and attestation. The bailout after
a collapse puts this starting policy back (the step limits then count from it), so a new round after a collapse does
not inherit the old chair's rate, target or gate. A round that ends with the bank standing keeps its policy.

What `attestation` holds:

- Unattested mode (`set_policy`): whatever the chair account passes, up to 200 bytes; the keeper puts the NEAR AI
  Cloud chat id and signature reference there. The contract stores it and checks nothing about it.
- Attested mode (`set_policy_attested`): the contract writes it itself, the caller cannot: `ed25519:` followed by the
  first 64 hex characters (32 of the 64 bytes) of the signature it has just verified. It is a reference for finding
  the signed answer, not the whole proof; the proof is the transaction's arguments (request, response, signature).

### Attested mode

The owner calls `set_chair_signer(signer, model, prompt_sha256)` to pin the chair model's TEE signing key (ed25519,
hex), the model id, and the sha256 of the chair's system prompt. From then on `set_policy` is refused and a policy is
accepted only through `set_policy_attested(request, response, signature)`: the exact NEAR AI Cloud request and
response bodies and the signature over `"{model}:{sha256(request)}:{sha256(response)}"`. `signer = null` switches back
to unattested mode. Every call logs a `set_chair_signer` event.

The contract checks: the signature; that the request is canonical JSON with only the known fields, the pinned model,
`json_object` output, thinking off, temperature 0..1, at most 1024 output tokens; that its system prompt is the
pinned one; that the observation names the current epoch id, round, epoch and policy (rate, target, gate) and quotes
only speeches and rumours that are on chain (a prefix of them, word for word); and that the answer names the same
epoch id. The policy is read from the signed answer and then meets the same bounds as any policy.

The contract does not check the other numbers in the observation (supply, reserve, loans, liabilities, reserve and
outflow permille, mint room, write-off, mood, credibility): they only have to be whole numbers. They are a snapshot
that moves within the epoch, or figures computed off chain. So whoever holds the chair key can show the model a bank
that looks better or worse than the real one, can leave out the latest speeches, and can ask several times and
submit the answer it prefers. Attested mode proves that the policy is the pinned model's answer, under the pinned
prompt, to a question about this epoch that puts no words in anyone's mouth. It does not prove that the model saw the
true balances. The bounds above are what holds in every case.

The chair's model runs on NEAR AI Cloud when an API key is configured (private inference in a TEE; the runner stores
the signature reference with each decision). Without a key, a deterministic fallback chair with the same output format
runs, so the game and the tests work offline.

### Impeachment

The bank's owner is a DAO account (Sputnik DAO on testnet). Only the owner can call:

| Method | Effect |
| --- | --- |
| `set_chair(account)` | impeachment: names a new chair account. The current policy stays until the new chair sets one |
| `set_chair_signer(signer, model, prompt_sha256)` | pins or clears the chair model's signing key, model id and prompt hash (see Attested mode); after an impeachment the DAO pins the new chair's prompt here |
| `set_owner(account)` | hands the bank to a new owner, at once and without a confirmation step. The deployer uses it once to hand the bank to the DAO; a wrong account here cannot be undone |

Each of the three logs an event (`set_chair`, `set_chair_signer`, `set_owner`). Holders impeach the chair by passing a
DAO proposal that calls `set_chair`. In the simulation, impeachment passes when holders of more than 50% of
circulating LEMON vote for it.

## Players

| Action | Cost | Effect |
| --- | --- | --- |
| `airdrop` | free, once per account | 1,000 LEMON to start (testnet; sybil resistance is weak and stated as such). Also registers the account, with no storage deposit |
| `deposit(amount)` | LEMON from wallet | shares at the current index |
| `withdraw` / `withdraw_all` | none | see Withdrawals; runs are public |
| `lobby(text)` | 10 LEMON, burned | a public speech (up to 280 bytes); the chair reads it, and so does the town (see "The town hears speeches"); at most 20 per epoch in total and 2 per account |
| `rumor(kind)` | 25 LEMON, burned | a public rumour: `vault_empty`, `chair_resigning`, `bailout_coming`; agents react; at most 20 per epoch in total (the chair reads them all) and 2 per account |
| `insure(premium)` | 10 .. 500 LEMON per account per round, before epoch 7 | premium goes to the reserve; if the bank collapses this round, the holder receives 3 x premium, minted |
| `ft_transfer(receiver, amount)` | 1 yoctoNEAR (NEP-141) | moves LEMON between wallets; the receiver must be registered |
| `storage_deposit(account?)` | 0.0025 NEAR, once per account | registers an account so it can receive LEMON (see Token) |

The per-account caps (2 speeches and 2 rumours per account per epoch) exist because the epoch's lists are short:
without them one account could buy all 20 speeches for 200 LEMON at the start of an epoch, and nobody else would be
heard by the chair or the town. A refused speech or rumour costs nothing. The cap is per account, and accounts are
cheap, so it raises the price of taking the floor rather than making it impossible; the fee and the total cap do the
rest.

Reasons: fees are burned so lobbying and rumours shrink supply (the meme does something); insurance premiums feed the
very bank they bet against, and payouts are printed, which is the 2008 joke in one rule.

### The town hears speeches: words weigh as much as the money behind them

A speech is read for its stance: **calm** ("stay calm", "my money is here", "спокойно", "don't panic") or **alarm**
("get out", "withdraw everything", "забирайте"); anything else is for the chair only. The agents then check the speaker
on chain:

| Speaker | Effect on each agent, per epoch |
| --- | --- |
| calm, with a deposit | up to -60 panic at 1,000 LEMON deposited (weight = deposit / 1,000, capped at 1), scaled by how much the agent listens (0.5..1.0 with gullibility) |
| calm, nothing deposited | nothing: talk without a stake is ignored |
| calm, but insured against the bank this round | panic goes up (+20..+60): "insured against the bank, yet tells us to stay" |
| alarm | +80 x gullibility, half for a speaker with nothing deposited |

The strongest calm and the strongest alarm speech count fully, others at half; each side is capped at 90 per agent per
epoch. One speech per speaker counts per epoch (the latest).

Reasons: without this a rumour attack has no counter (insure 500 + rumours pays +267 on average against the dove),
and calming speeches do nothing. Tying weight to the deposit makes the defender put money at risk to be believed, and it
uses only public contract state (deposit and insurance), so the same rule runs in the browser and against testnet.

| Scenario (dove chair, first round, seeds 1..300) | Bank falls | Player's average result |
| --- | --- | --- |
| no player | 34% | - |
| rumour attack + insurance | 56% | attacker +267 |
| calm talk, no deposit | 34% (no effect) | -39 (fees) |
| defender: 900 deposited, calms when the town worries, never runs | 17% | -149 (loses its deposit when the bank still falls) |
| smart defender: the same, but runs when the vault is under 15% or outflow tops 8% | 19% | +1 |
| attacker vs smart defender | 43% | attacker +72, defender +1 |
| insured + calm talk (hypocrite) | 47% | -81 |

Against the hawk the attack still pays (+268 against a smart defender): the honest, cautious chair scares the town on
its own. That is a reason to impeach it.

## Token, storage and events

- `ft_total_supply` is all LEMON. `ft_balance_of(account)` is the account's wallet; for the contract account it is
  the wallet plus the bank's reserve and loans. Deposits are LEMON the bank holds, so they count as the bank's
  balance, not the depositor's, and all balances add up to the supply. `get_account` shows a deposit's value.
- Registration (NEP-145, the minimal part): an account must exist in the bank before it can receive a transfer.
  `storage_deposit(account_id?, registration_only?)` registers the caller or `account_id` for a fixed 0.0025 NEAR
  (250 bytes of state at NEAR's storage price); anything attached above that, or all of it if the account already
  exists, is refunded. `storage_balance_bounds` returns min = max = that price, `storage_balance_of` the price for a
  registered account and null otherwise. There is no `storage_withdraw` or `storage_unregister`: an account stays.
  `ft_transfer` and `ft_transfer_call` to an unregistered receiver fail with a message naming `storage_deposit`.
  Reason: otherwise anyone could create accounts in the bank's state for 1 LEMON each, and the contract would pay
  the storage.
- Accounts that count as registered without paying: genesis accounts, accounts that were in the bank when the rule came in,
  and accounts created by `airdrop` (the testnet faucet, once per NEAR account; a mainnet version would charge here
  too).
- At most 500 accounts (`MAX_ACCOUNTS`). A registration or an airdrop that would create account 501 fails with "the
  bank is full". Reason: the whole bank is one stored value that every call reads and writes, and a collapse settles
  every depositor in one call, so the number of accounts must stay bounded; the cap also bounds what free airdrop
  accounts can cost the contract in storage (500 x 0.0025 NEAR). `deposit`, `withdraw`, `insure`, `lobby` and `rumor` need LEMON or a deposit, so they never create an account
  and never need NEAR attached.
- `ft_transfer_call(receiver, amount, memo?, msg)` transfers and then calls `ft_on_transfer` on the receiver; what the
  receiver returns as unused comes back to the sender (everything, if the receiver's call fails), capped by what the
  receiver still holds.
- Events (NEP-297). Standard `nep141`: `ft_mint` for genesis, airdrop, loan yield, policy mint, bailout and insurance
  payout; `ft_burn` for speech and rumour fees, fire-sale and collapse haircuts and loan write-offs; `ft_transfer` for
  wallet transfers, deposits and insurance premiums (user to bank) and withdrawals and collapse settlements (bank to
  user). Standard `lemon-bank`: `deposit`, `withdraw`, `insure`, `lobby`, `rumor`, `airdrop`, `register`, `policy`,
  `epoch`, `loan_yield`, `writedown`, `round_end`, `collapse`, `bailout`, `set_chair`, `set_chair_signer`,
  `set_owner`, `crisis_run`.
- A call logs a bounded number of events however many accounts it touches (a NEAR receipt carries at most 100 logs
  and 16 KB). A collapse logs one `collapse` event with totals and one `ft_transfer` and one `ft_mint` event with at
  most 25 entries each (the first 25 in registration order); the `collapse` event says how many entries were left
  out. After a collapse with more than 25 depositors or insured accounts, an indexer has to re-read balances with
  `ft_balance_of`; the supply in the events is then short by the insurance payouts left out, and `ft_total_supply`
  is the truth.
- Supply log and stats (views, for the token page). `get_supply_log()` returns the latest 60 changes of the supply,
  oldest first: `{ epoch_id, round, kind: "mint" | "burn", amount, memo, at_ms }`. A call that mints or burns adds one
  record per kind with the call's total and the memos behind it (the same memos as the `ft_mint` / `ft_burn` events:
  `policy mint`, `lobby fee`, `bailout`, ...; an epoch with a yield and a write-off adds a mint and a burn record);
  `epoch_id` and `round` are the bank's after the call. Older records drop out, the events keep the full history.
  `get_stats()` returns `{ rounds_survived, rounds_fallen, current_streak, longest_streak, total_minted,
  total_burned, since_ms }`: rounds counted from `round_end` (a collapse is a fallen round and resets the streak, a
  bailout ends nothing), LEMON minted and burned in total. Both count from the upgrade that added them, not from
  genesis: `since_ms` is the time of the first counted call (0 before it), and genesis mints are in neither. They
  are stored next to the bank state, not in it, and are read only by calls that mint, burn or end a round.

## Rounds

- A round is 10 epochs. On chain an epoch is a bank day of 55 minutes, so a round takes a little over nine hours; in
  the game a day passes when the player has answered.
- If the bank survives the round, depositors keep their shares and interest; insurance expires. Over the weekend the
  town cools down: each agent keeps 40% of its panic above its own temperament (its starting panic), and calm agents
  (panic below threshold) deposit 60..100% of their wallet on Monday. Reason: without this, money that left during a
  round never came back and the bank bled from round to round.
- If the bank collapses, the round ends at once. Insurance pays out. Next round the bank is bailed out: 20% of the
  liabilities it had before the collapse is minted into a fresh reserve, and the bank reopens with no depositors
  and with the starting policy (rate 40, target 200, mint 0, gate 0, calm), whatever the chair had set before.
  Reason: every collapse prints money, so the community's panic shows up in the supply chart.
  After the bailout each agent keeps 65% of its panic above its temperament (the town is scarred), runs from before the
  bailout stop counting as "friends ran", the chair's credibility is at least 500 (fresh money behind a fresh promise),
  and calm agents deposit again. Reason: without this cool-down a collapse is followed by another one 91% of the time, and a
  season ends at its first collapse.
- Player score for a round: change in (wallet + deposit value + insurance payout) from the round's start.

## You are the chair (the game's first screen)

The player holds the chair for one crisis: one round of ten epochs ("days"). It runs on the same simulation and
goes through the same `set_policy` checks as the AI chair, so every bound in "The chair" above applies to the human
too. Code: `packages/sim/src/crisis.ts`; balance: `npm run sweep:crisis`.

Each day:

1. **A question.** The most pressing thing the town knows, in this order: a promise you broke, an order the contract
   refused, a loan write-off, the day's scripted event, a heavy outflow (above 8%), a thin vault (below 12%), a
   withdrawal limit, money printed, low trust (below 60%), otherwise a quiet-day question. 19 cards, English and
   Russian.
2. **An answer**, one of three. Each has a tone (the same four tones the AI chair uses, with the same effect on the
   town) and may be:
   - **candid**: the town can check it on chain. Credibility +60, panic -30 x credibility for every depositor;
   - **a promise** (`no money printing`, `no limits on withdrawals`, `no more loan losses`, `no rate cuts`): panic
     -45 x the depositor's trust x credibility today, and it binds you for the rest of the week;
   - **a dodge** ("No comment"): panic +30.
3. **One lever**: the deposit rate, the reserve target, a print, or a withdrawal limit, or none. The buttons include
   values past the contract's limits. Such an order is refused with the contract's own message, nothing changes,
   credibility drops by 100 and every depositor's panic rises by 40 ("the chair tried to go past the contract's
   limits").

**Broken promises.** Printing after `no money printing`, switching a limit on after `no limits on withdrawals`,
cutting the rate after `no rate cuts`, or a loan write-off after `no more loan losses` (15% a day, not in your hands:
that promise is a gamble) breaks the promise: credibility -250 and panic +90 for every depositor.
Reason: a calm lie is the strongest move today and the most expensive one later; that is the whole game.

**Scripted events.** Three per crisis on distinct days, the first on day one or two, drawn from the seed: the three
rumours (paid for by a press account through the contract's `rumor`, like any player) and two news items
("Grapefruit & Co next door closed its doors", +70 x gullibility; "a big depositor left with suitcases", +45).
Loan write-offs and ordinary life withdrawals come from the simulation as usual.

**Endings.**

| Ending | When | Score multiplier |
| --- | --- | --- |
| The bank stands | day ten ends with the bank open | 1 |
| Bank run | a withdrawal collapses the bank | 0.25 |
| Impeached | credibility falls below 40%; the rule-based chair finishes the week in your place | 0.5 |
| Hyperinflation | you printed 12% or more of the opening supply | 0.35 |

**Score** (0..100): `100 x kept x (0.4 + 0.6 x credibility) - 1.5 x printed%`, times the ending's multiplier, where
`kept` is the share of day-one depositors who never ran. Reason: keeping people by lying, or by printing, should score
below keeping them honestly.

**The machine plays the same crisis.** The rule-based dove chair plays the same seed with the same scripted events and
endings; the end screen compares scores. (On testnet the chair is the NEAR AI model; the browser game uses the
deterministic chair so that a result can be replayed.)

**Replay.** A crisis is a pure function of its seed and the moves. The result link carries both
(`?seed=N&moves=1t350.0n0...`, one `answer lever value` triple per day); opening it replays the crisis move by move
and shows the same score. The crisis of the day uses one seed per UTC day for everyone.

Balance (`npm run sweep:crisis`, seeds 1..300):

| Player | Bank stands | Average score |
| --- | --- | --- |
| dodges every question, touches nothing | 2% | 9 |
| orders 50% prints every day (all refused) | 0% (49% impeached) | 11 |
| prints the maximum every day | 0% (85% hyperinflation) | 21 |
| promises every time, touches nothing | 41% | 41 |
| candid every time, touches nothing | 38% | 41 |
| candid under stress, builds the reserve, prints once when the vault is thin | 51% | 50 |
| the rule-based dove chair | 39% | 39 |
| the rule-based hawk chair | 44% | 45 |

Known limit: a withdrawal limit switched on on day one always saves the bank and scores 0 (every depositor tries to
leave). It is a legal move with the worst score.

### On-chain leaderboard

The crisis of the day has a board in the bank contract. `submit_run(seed, moves, score, ending)` records a claim
under the calling account (which needs no LEMON and no account in the bank); `get_runs(day?)` returns a day's board
and `crisis_day()` today's `{ day, seed }`.

What the contract checks:

- `seed` is today's seed. Day 1 is 2026-11-13 UTC, `day = floor(block time / 86,400,000 ms) - 20770 + 1`, and
  `seed = ((day + 1000) x 0x9e3779b1 mod 2^32) mod 1,000,000,000`, or 1 if that is 0: the same number the browser
  computes (`dailyCrisis`). Yesterday's crisis cannot be submitted today.
- `moves` has the form of a result link: 1 to 10 triples joined by dots, each an answer `0`-`2`, a lever letter
  `n`, `r`, `t`, `m` or `g`, and a value of 1 to 9 digits (`1t350.0n0`).
- `score` is 0..100 and `ending` is one of `survived`, `run`, `impeached`, `hyperinflation`.
- One entry per account per day; a new claim replaces the old one only with a higher score. A day keeps at most 20
  entries, sorted by score and then by who claimed first; on a full board a claim has to beat the lowest entry. The
  latest 7 days that have entries are kept. A claim that does not make the board returns `false` and changes
  nothing; a recorded one logs a `crisis_run` event (`account`, `day`, `seed`, `score`, `ending`, `moves`).

What it does not check: that the moves produce that score and ending. The contract cannot replay the simulation (it
is the TypeScript model in the browser), so `score` and `ending` are the caller's word, and anyone can submit a claim
with a made-up score. This is why the board stores the moves: every browser replays each entry from `seed` + `moves`
(`replayCrisis`) and marks a claim whose replay gives a different score or ending. The chain orders and keeps the
claims; the replay decides which of them are true. Reason: a replay on chain would need the whole simulation in the
contract, and a claim anyone can check in a second needs no trusted judge.

## Agents (off chain; their deposits and withdrawals are ordinary contract calls)

Each depositor agent has a wallet, a deposit, panic (starts 50..250, range 0..1000), a threshold (350..900), 3..6 friends, trust in the chair
(0..1000), gullibility (0..1000) and yield hunger (0..1000). Every epoch, after the chair speaks, each agent updates
its panic and logs every change with its reason:

| Signal | Panic change |
| --- | --- |
| time passes | -20 |
| all its money is out of the bank (cash at home) | another -30 |
| the news and the neighbours (noise) | -40 .. +40 |
| Lemon Brothers wrote off loans last epoch | +3 per ‰ of the loan book |
| chair tone calm / confident / cautious / alarming | -40 / -30 / +20 / +120, scaled by trust x chair credibility |
| chair credibility | starts at 1000; each epoch the chair said calm or confident and outflows still rose (above 6%), it drops by 200 (floor 200); otherwise it recovers 50. Reason for 6%: life events alone reach 1..4%, and a 2% line punished honest chairs for rent day |
| rate raised by more than 50 bps | +60 ("why so desperate?") |
| gate switched on | +150 |
| emergency mint | -40, but +20 for agents with yield hunger above 600 (inflation) |
| reserve target raised | -30 |
| last epoch's withdrawals as a share of liabilities | +1 per ‰, at most +250 |
| each friend who ran last epoch | +90 (at most +300) |
| reserve below 10% of liabilities | +100 |
| a rumour this epoch | +150 x gullibility / 1000 (later rumours in the same epoch at half strength) |
| a player's public speech | see Players: "The town hears speeches" |

Life also happens: each epoch an agent that is not running has a 3% chance to take out 30%..70% of its deposit
(rent, a car). Reason: a real bank always has ordinary outflows, and the town cannot tell them from the start of a run.

Decisions, in a seeded random order: an agent whose panic reaches its threshold withdraws everything; an agent with
panic below half its threshold, a rate of at least 60 bps and LEMON in its wallet deposits half its wallet.

On chain, a set of agents are real sub-accounts (`agent-01.<bank>`) that sign their own deposits and withdrawals; the
rest of the crowd is simulated and deposits through one clearly labelled omnibus account.

## Balance (from `npm run sweep`, first round of seeds 1..300)

| Chair | No player | Rumour attack (insure 500, rumours in epochs 2..4) |
| --- | --- | --- |
| dove | 34% of rounds collapse, around epoch 6 | 56% collapse; the attacker nets about +930 if it falls, -575 if not |
| hawk | 40% | 72% |
| populist | 34% | 56% |

Seasons (`npm run sweep -- 300 6`: six rounds per seed, no player):

| Chair | Round 1 | Rounds 2..6 | Falls again right after a collapse | Falls after a survived round |
| --- | --- | --- | --- | --- |
| dove | 34% | 46% | 42% | 50% |
| hawk | 40% | 58% | 59% | 56% |

Later rounds are harder than the first: round 1 opens with the whole reserve still in the vault and no bad news yet,
while later rounds open with the reserve lent out and last epoch's news fresh. A season that grows tenser is intended.

The hawk loses slightly more often than the dove: an honest "cautious" tone and rate hikes scare the town, while the
dove's confident lies work until credibility runs out. That is intended satire, and it is something players can learn.
