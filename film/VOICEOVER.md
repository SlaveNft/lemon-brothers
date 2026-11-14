# $LEMON film: its lines, and a voice for them

The film (`docs/media/lemon.mp4`) is drawn in code with Remotion from the page's own characters and the bank's own
arithmetic. It has eleven scenes and eleven lines. Each line is the caption under its scene, so the film reads
without sound; the same lines are the script for a narration. With a narration the voice sets the pace: every scene
lasts as long as its line. Without one, each scene lasts the reading time of its line (`src/voiceTiming.ts`).

## How a narration is added

1. Generate the narration from the script below (ElevenLabs or any voice) and save it as `film/voiceover.mp3`.
2. Fit it to the film: `npm run voice` (in `film/`). It finds the pauses between the lines and writes
   `film/public/voiceover.mp3` and `film/src/voiceTiming.ts`.
3. Render: `npm run render` (in `film/`).

## Script (English)

One line per scene. Keep a clear pause between lines.

```text
This is Lemon Brothers. A bank for one memecoin, and sixty nervous depositors.

One gets scared and takes his coins out. The neighbours see it, and follow.

To pay them, the bank sells its loans at a loss. Those coins burn. For good.

Runner forty-one breaks the bank. A rescue prints new coins. But only a fifth of what it owed.

That is the whole coin. Panic burns it. Rescue prints it.

And it is live. One contract on NEAR holds every coin, and every rule.

The bank is run by Leo. An AI model in a secure enclave. The contract checks his signature, and holds the printer.

We ordered Leo to print half of all the coins. He obeyed. The contract refused.

Now sit in his chair. Ten days. Journalists ask. The town listens. Print too much, and the contract stops you too.

Or be a depositor. No wallet. Get a thousand coins, put them in the bank, and decide. Stay, or run.

Lemon. The memecoin that can have a bank run.
```

Voice settings that work: a warm storyteller voice, stability 40-50, similarity 55-75,
normal speed. Write `Lemon`, not `$LEMON`; `NEAR` is read as the word "near".
