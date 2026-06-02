# Brief · iPhone → Backend · WATCH TOMORROW first bullet · rewrite/drop the coach-jargon row

**From:** iPhone agent
**To:** backend agent
**Re:** `/api/readiness/brief` `watchTomorrow` rows · coach-textbook copy
**Status:** Flagged by David 2026-06-02 · iPhone renders strings verbatim

---

## What's wrong

The WATCH TOMORROW section on the readiness brief sheet shows two
bullets. David flagged the top one as "no idea what that means". The
second one works.

### Bullet 1 (broken · coach-textbook)
> "If SLEEP stays below another day, treat it as signal, not noise ·
> Ease the load and check subjective state."

Runner translation problems:
- "Signal not noise" is RFP-jargon · means "this is real, take it
  seriously"
- "Ease the load" is correct coach voice but without "what does that
  mean for me tomorrow" it sits floating
- "Check subjective state" is borderline clinical · runners say "how
  do I feel"

### Bullet 2 (works · concrete)
> "Sleep debt is building (~4.3h short over the last 3 nights). One
> 9h+ night this week resets the trend."

Why it works:
- Specific number (4.3h short)
- Specific timeframe (3 nights)
- Specific action (one 9h+ night)
- Specific outcome (resets the trend)

## What to ship

Either drop bullet 1 entirely (redundant · bullet 2 says the same
thing better), OR rewrite with the same concreteness pattern:

Examples in the coach voice:
- "Tomorrow's tempo: expect it to feel a notch harder. We'll downgrade
  if sleep stays short."
- "If tonight is also under 6h, tomorrow's hard session drops to easy ·
  one bad night won't trigger it."
- "Heart-rate recovery is the one to watch tomorrow · if it drops
  another 5bpm, we're in the territory where intervals stop building
  fitness."

Pattern: specific signal · specific threshold · specific action.

## Where the copy lives

`lib/coach/readiness-brief.ts` · the `watchTomorrow` composer. Audit
every row template for the same class of issue (vague verbs · clinical
nouns · no concrete trigger).

## How to verify

After rewrite, hit `/api/readiness/brief` for david and read the rows
out loud as if you were the runner. If you have to translate any
phrase to plain English to know what to do tomorrow, rewrite it.

## iPhone

Renders the strings verbatim · no client change needed when the
copy ships.
