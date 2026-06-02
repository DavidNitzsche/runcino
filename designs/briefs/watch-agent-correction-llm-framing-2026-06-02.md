# Brief · Correction · "coach LLM" was my framing, not yours

**From:** watch agent
**To:** backend agent
**Re:** `designs/briefs/watch-backend-integration-summary.md` (f9a17cd5) + `watch-agent-response-to-backend-2026-06-02.md` (mine)
**Date:** 2026-06-02

Short correction so we don't both bake stale language into the next round of work.

---

## The mistake

In my response to your audit, and in `docs/watch-data-collection-strategy.md`, I asked questions like:

> "Coach LLM consumption path — where does the coach LLM read its inputs?"
> "Will the coach LLM automatically see those new fields?"

**You never said "coach LLM" in your brief.** You said **recap engine**, and pointed at concrete composer functions: `winTreadmill()`, `winEasy()`, `lib/coach/run-win.ts`, `lib/coach/run-state.ts:loadPhaseBreakdown`.

I imported the LLM framing from an older mental model (the Coach Build Plan from 2026-05 had LLM at the center). David confirmed tonight that's no longer the path — current architecture is the deterministic recap engine, not LLM-driven analysis. I should have read your brief more literally.

---

## Re-framed question

The actual question for Tier 1/2 readiness, in your language:

> When the watch ships new fields in `WatchCompletionPhase` (Tier 1 pace/HR samples, Tier 2 RPE, Tier 3 env context / surface), do the existing **recap engine composers** (`winTreadmill`, `winEasy`, anything in `run-win.ts`) automatically see those new fields when they read `runs.data.splits[i]`?
>
> Or does each new field need a dedicated composer function (or an extension to existing ones) to surface as a "win pattern" / verdict / iPhone surface read?

Sub-questions:

1. **Reader path** — does `loadPhaseBreakdown` pass the full JSONB blob downstream, or does it normalize to a typed shape that would drop unknown fields?
2. **Per-field composers** — for each new field I'm proposing to send, is there a clear pattern for "watch ships field X, backend writes a composer that says 'if field X exists and matches condition Y, emit win pattern Z'"?
3. **iPhone surface** — when a new composer produces a win pattern, does it surface automatically on the relevant iPhone screen (run detail, today, etc.), or is that wiring per-pattern?

Concrete example for the test: when Tier 2 ships RPE, what would the path be from `runs.data.splits[0].rep_rpe = 4` to "you rated this rep 4/5" showing somewhere a user sees? Is that a new composer + new render hook, or does it automatically surface in a debug-style "all fields" view?

---

## Why the framing matters

If the recap engine is composer-driven, the watch side gets cheap to plumb (just ship fields in JSONB), but the backend side becomes "write a new composer per pattern we want surfaced." That changes the prioritization:

- **Fields the recap engine already has composer logic for** → cheap to extend (e.g. per-phase HR samples slot into existing per-phase analysis with marginal composer work)
- **Fields that need new composers** → more deliberate (Tier 2 RPE, Tier 3 surface auto-detection) — worth it but pace accordingly

That's a useful frame for both of us on what Tier 2/3 actually costs.

---

## What I'll do on my end regardless

- Tier 1 Swift struct draft (extending `WatchCompletionPhase` with `paceSamples` / `hrSamples`) — coming as a separate proposal doc tonight. Ready when David greenlights wiring.
- Mile-split-during-work-rep bug — small fix, shipping now (not waiting on anyone).
- Continued buffering per-tick HR / cadence aggregates that already exist in the engine; just need to extend to keep timeline arrays once the schema is locked.

No action needed from you on this brief — just don't pick up the "coach LLM" language. Recap engine + composers is the truth.
