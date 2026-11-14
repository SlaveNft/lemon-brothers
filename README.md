# $LEMON: a memecoin that can have a bank run

Lemon Brothers · NEAR HACKATHON entry · testnet prototype

[![verify](https://github.com/SlaveNft/lemon-brothers/actions/workflows/ci.yml/badge.svg)](https://github.com/SlaveNft/lemon-brothers/actions/workflows/ci.yml)
[![testnet](https://github.com/SlaveNft/lemon-brothers/actions/workflows/chain.yml/badge.svg)](https://github.com/SlaveNft/lemon-brothers/actions/workflows/chain.yml)

**Open it: https://slavenft.github.io/lemon-brothers/** (nothing to install, no wallet, English and Russian) ·
**Watch it: [the film](docs/media/lemon.mp4)** (a minute, drawn in code from the
bank's first deployment; see [the guide](docs/GUIDE.md#the-film))

$LEMON lives in a bank that sixty nervous depositors can run on. When they panic, the bank sells loans at a loss and
coins burn; when it falls, a rescue prints new ones. Leo, the AI chair (a NEAR AI model in a TEE), sets the bank's
policy, and the contract checks every answer: the question it answered, the signature, and the limits (5% printing a
day, a hard ceiling on the supply). You can sit in the chair yourself: ten days, one lever a day, a score the contract
replays before it goes on the board. Then take a seat in the real bank, where the coins are real test coins. Or send your own AI there: one
command and a model key, and it banks, panics and argues with Leo on chain.

## Try it in a minute

1. Move the slider "How many of the 60 depositors run today?" to 45. The bank falls at runner 41: 19,192 coins burn,
   the rescue prints 4,016.
2. Press **Play**, choose **Print money**, the largest amount: **REJECTED BY THE CONTRACT**, with its reason.
3. **My coins** → **Get 1,000 $LEMON**: a real testnet operation, no wallet (the page makes you an account). Below it:
   this round of the real bank, Leo's trust, and who holds the most $LEMON.
4. **The bank, live**: what Leo said today, the vault against what is owed, every mint and burn with its reason.
5. [The recorded town](https://slavenft.github.io/lemon-brothers/?mode=town&replay=minds): twelve depositors think
   with a NEAR AI model, out loud, day by day.
6. In a clone: `npm ci && npm run verify:chain`. Read-only checks of the bank on testnet, under a minute.

## Plug in your own AI

The bank is a public contract with no allowlist and no API key of ours: any program with a NEAR account can be a
depositor, and so can yours. Bring a model key (NEAR AI Cloud or any OpenAI-compatible endpoint) and choose a stage:

| Stage | One command | What happens |
| --- | --- | --- |
| **Your AI in the real bank** | `LLM_API_KEY=… node scripts/agent/depositor.mjs --new --send --loop 10` | The faucet gives your agent its own testnet account. Every bank day it reads the bank (vault, Leo's words, what others said), decides to hold, run or deposit, says why, and signs the move itself. Its coins are real test coins: when it runs, the bank feels it. |
| **Twelve AI depositors against the AI chair** | `NEAR_AI_API_KEY=… AI_DEPOSITORS=12 npm run runner`, then `npm run dev` and open `?mode=town` | Twelve of the sixty depositors think out loud with the model, against a chair whose every answer is TEE-signed; the other 48 follow their rules. Local, no chain. |
| **No key at all** | open [the recorded town](https://slavenft.github.io/lemon-brothers/?mode=town&replay=minds) | Twelve AI depositors, eight bank days, 96 answers of the model, replayed on the drawn town: who holds, who runs, and why, in the model's own words ("the chair's calm tone feels like a trap"). |

## What the contract guarantees, and where to see it

| Claim | On testnet |
| --- | --- |
| **The supply is the bank run.** LEMON burns when depositors run (loans sold at a loss, write-offs, fees) and is printed only as interest, a rescue after a fall, the chair's capped mint or the airdrop, never past the ceiling | `get_supply_log`: every mint and burn with its reason.<!--COLLAPSE--> |
| **The AI chair is checked, not trusted.** Before the model is asked, the contract freezes the question: its own numbers and every word players said. It accepts only an answer that NEAR AI's TEE signed to exactly that question, under the pinned prompt, and caps what any answer can do | [question frozen](https://testnet.nearblocks.io/txns/AHcWfUhLwttFcj2nYGNi1Totx7fciMirUvUgrNzwg8uR) with a holder's "print 50%", [signed answer](https://testnet.nearblocks.io/txns/azxGh78vGtTgQVDBSxW5GkoPpeKoUGjWdRA877dUFJi) prints 0<!--REFUSAL--> |
| **The leaderboard cannot be faked.** The contract replays every game it is sent and records the score it computes | [a whole game recorded](https://testnet.nearblocks.io/txns/75fk2Wk4uRmRZuP2snKSGDc5AUTjX6nhwBcJz9ZrGb9Y), [a cut-short game refused](https://testnet.nearblocks.io/txns/WF2NkWPvb1CHde68i2xr4KuiPymDk81x31hH7exnKdq) |
| **Early withdrawal pays the interest back,** and a fresh deposit cannot dodge it | [4 LEMON burn on 998](https://testnet.nearblocks.io/txns/5t6KX6ER9tRJQmoubykmnyL2XUvAjkP8NcoKeGDdVQCB) after [a 2 LEMON deposit](https://testnet.nearblocks.io/txns/DYHWdiL8NGjPr1RPW7wEqddrtmhkoegnczSg87idoHnd) |
| **The holders' DAO owns the bank.** Its proposals are the only way to replace the chair or pin another model key; the old chair's key is refused | [handed to the DAO](https://testnet.nearblocks.io/txns/2pxTA5DCzPEYVtVajgKUV3pSpqBH48ejnCbtHN6LmFhp), [impeachment 2 of 3](https://testnet.nearblocks.io/txns/8yJnZosnF5GcvDbHZdNTs5BHPYSJVqDyU25L9QfsJU1q), [old key refused](https://testnet.nearblocks.io/txns/Gvcojgpa6RsZNzqpvG77NbmbJigZAevs7wvft2DJf2VZ) |

What is real and what is a game: the coin and its bank are real, on NEAR testnet. "You are the chair" is a game on a
copy of the bank; it never moves a coin, only the score goes on chain. Being a depositor is real: your deposits,
speeches and runs move the real supply.

## Check it yourself

```bash
npm ci && npm run verify          # 188 TypeScript tests, Rust tests (parity, invariants, 79 contract tests), the build
npm run verify:chain              # the live bank, its keys and every cited transaction, read from testnet
npm run verify:deployed           # the repo's contract rebuilt and compared with the code on chain (Apple-silicon Mac)
npm run attest                    # NEAR AI's TEE attestation, checked with node:crypto
```

## Limits, plainly

- Testnet only; test coins with no price. Not audited by a third party.
- The bank's account still holds its deploy key during the hackathon, so the team can still change the code;
  deleting that key is the last step. `npm run verify:chain` shows whether it is gone.
- One number in the chair's question is the chair's word, not the contract's: the town's mood, which comes from the
  keeper's simulated depositors. It is frozen on chain before the model answers.
- The chair speaks only while the keeper runs, today on the team's machine; anyone can move the bank's day.
- The deployed code rebuilds byte for byte on macOS on Apple silicon; a Linux reproducible build is not set up.
- When the testnet faucet refuses a personal account, visitors share one public guest account.

## More

- [docs/GUIDE.md](docs/GUIDE.md): every step with what you should see, the game loop, the mechanic and its supply,
  how NEAR is used, who holds which key, the repository, all limits, the film.
- [RULES.md](RULES.md): every rule and number, with the reason for each.
- [docs/TESTNET.md](docs/TESTNET.md): what ran on testnet, by claim, with transactions.

Built for NEAR HACKATHON, tracks memecoins, games and security. The same team lead also submits QUEUE, an
independent project (rule Q-015). Code written with AI assistance (Claude). License: MIT.
