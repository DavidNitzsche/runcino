# faff.run — UX Simplification Doctrine

**Locked 2026-08-31. Companion to `docs/PRODUCT_COACHING_DOCTRINE.md` and its
briefs — those define the engine underneath; this defines what the runner is
actually allowed to see.**

## The risk this exists to prevent

faff becomes impressive internally but exhausting externally. The product
should feel like a coach, not a dashboard for the coaching engine.

## The one rule

**Only surface information that changes what the runner should understand or
do next. Everything else stays underneath.**

## The four questions the product actually needs to answer

For the runner, almost everything collapses into: **What am I doing today?
How should it feel? How did it go? Is anything changing because of it?**
Everything else is secondary.

## Product hierarchy

| Surface | What it should answer |
|---|---|
| Today | What am I running and why? |
| Plan | What's coming and how does it build me toward the goal? |
| After Run | What happened, what did we learn, does anything change? |
| Progress | Am I getting fitter and is my goal realistic? |
| Race | What could I likely run right now? |

That's probably enough. Navigation should push toward something like **Today
· Plan · Progress**, with Profile/More tucked away, race prediction living
inside Progress, past runs in Plan/history or a simple activity feed,
insights appearing contextually rather than an "Insights" graveyard. The
watch is even simpler: what to do → what matters now → next segment → done.

## What demotes to "internal, surfaced only in context"

Cadence, ground contact time, vertical oscillation, raw HR zones, fitness
sub-scores, workout-compliance percentages, detailed load charts, multiple
prediction numbers, readiness scores, confidence decimals, evidence counts —
these can exist internally without deserving permanent UI. If one becomes
relevant, surface it IN CONTEXT, not as a permanent section.

Not a permanent "Heat Adjustment" section — after a warm run: "Heart rate ran
higher than usual today. The heat likely contributed, so nothing changes."

Not a permanent "Durability Score" — "You're holding quality later in long
runs better than you were six weeks ago."

## No giant fitness dashboard

A Progress screen is fine; exposing the entire model is not:

```
Current fitness
  Half-marathon equivalent: ~1:34-1:37
What's improving
  Threshold fitness · Long-run durability
Current limiter
  Holding that fitness over marathon distance
Goal
  3:15 marathon — aggressive but still plausible
```

That's more useful than six charts and three proprietary scores. **The model
can know 50 things. The runner should see four.**

## Post-run analysis — the pattern everywhere

The engine might internally do pause detection, segment reconstruction, HR
artifact rejection, weather context, pace/power stability, evidence routing,
durability weighting, confidence update, readiness impact, adaptation check.
The runner gets:

> **Good easy miles.** Pace stayed controlled. HR climbed later, but it was
> warm and the effort still felt easy, so we're not treating that as a
> fitness issue. Plan: No change.

Then maybe a small "Why?" affordance for people who want to see more. **The
UX pattern everywhere: simple answer first, depth on demand.**

## The plan itself gets simpler too

Runners don't need to understand training taxonomy — whether something is
internally "aerobic durability" vs "threshold development" vs "lactate
clearance" vs "high-intensity capacity" vs "fatigue resistance." They need:

> **50 min easy.** Keep it relaxed.

or:

> **3 × 10 min strong.** Controlled, comfortably hard. Don't race the reps.
> This builds the pace you can sustain for a long time.

That's enough.

## Adaptation almost disappears as a "feature"

Not a constant "ADAPTATION EVENT" surface. Most of the time faff quietly
keeps the plan stable. When something meaningful happens:

> "Your recent threshold work has been consistently stronger than expected.
> I recommend moving those targets slightly faster."

or:

> "You've had a heavy week. I'm recommending an easy day tomorrow instead of
> intervals."

**That's the product. The adaptation engine can be extremely sophisticated
without having an "Adaptation" tab.**

## The feature-cutting test

For every screen, card, metric or feature: **what decision does this help
the runner make?** A vague answer ("it helps them understand their
running") is bloat. A legitimate answer: "helps them know whether to slow
down today," "helps them understand why tomorrow changed," "helps them
decide whether their race goal is realistic," "helps them see that training
is working." If it doesn't do one of those, remove it or put it behind
detail.

## Three layers — the mistake is letting Layer 3 leak into Layer 1

- **Layer 1 — Coach.** What the runner sees. Extremely simple.
- **Layer 2 — Explanation.** Available on "why?"
- **Layer 3 — Engine.** Everything built tonight — evidence, anchors,
  uncertainty, context, inference. **This must never leak directly into
  Layer 1.** Sophistication should be felt through better decisions, not
  through more UI.

## The north star

The app should feel almost suspiciously simple:

> **Today — 50 min easy.** Keep it conversational. It's warm, so ignore
> pace if effort starts creeping up.
>
> *(runner runs)*
>
> **Good run.** Effort stayed controlled despite higher HR in the heat.
> Nothing needs changing.
>
> *(a few weeks later)*
>
> **You're improving.** Your sustained pace is getting faster and you're
> carrying it later into long runs. Your race outlook has moved from
> 1:36-1:39 to 1:33-1:36.

Behind those three screens can be a monster of an engine. That is probably
the product.

## The next pass — the bloat audit

**Every current faff screen, card, metric and interaction gets marked KEEP
/ MERGE / HIDE / DELETE**, using the rule: does this materially improve a
coaching decision? See `docs/audits/ux-bloat-audit-2026-08-31.md` for the
first pass.
