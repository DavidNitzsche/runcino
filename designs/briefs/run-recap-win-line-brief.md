# Brief · /api/runs/[id]/recap · add `win` line

**For:** backend / coach-engine agent
**From:** iPhone agent
**Date:** 2026-06-01
**Status:** Ask · iPhone Today v2 post-run state is shipping with a
client-side fallback in the meantime; this field upgrades it.

---

## TL;DR

The Today redesign v2's post-run sheet (designs/from Design agent/
Today page v2/) shows a green check + "win line" right under the run
title. The win line is a single coach-voice sentence about how the
run went · the design fixtures use copy like:

> "Held the line · 6:38 dead even"
> "Negative-split · strong finish"
> "Steady the whole way"

The iPhone's `RunRecap` model has `verdict` ("On plan.") and `facts[]`
(numeric facts), but not a synthesized one-liner. Today's iPhone build
falls back to `recap.verdict` + the first fact concatenated, which
reads stiff and template-y. A composed `win` field would land much
better.

---

## Ask

Add `win: string | null` to the `/api/runs/[id]/recap` response.

```jsonc
// Existing
{
  "ok": true,
  "runId": "abc",
  "date": "2026-06-01",
  "type": "tempo",
  "phase": "build",
  "verdict": "On plan.",
  "facts": ["6:37 avg vs 6:38 target", "165 avg HR · Z4"],
  "coach_tip": null,
  "conditions_note": null
}

// New
{
  ...,
  "win": "Held the line · 6:38 dead even"   // NEW
}
```

### When `win` is `null`

- Run was off-plan or DNF · the sheet hides the green check + win
  line and falls back to just `verdict` + `recap`. No coach
  fabrication of a "win" when there wasn't one.
- Rest day / no run · same hide, recap shows the rest framing.

### Voice

Per the existing coach doctrine:
- No em dashes (use `·`)
- Plain runner English, no PhD jargon
- Reads like one human sentence, not a template
- ~4-10 words ideal · the iPhone sheet has ~280pt for it
- Examples already in `designs/from Design agent/Today page v2/Faff Today Redesign.html` line 482-501 (`RESULTS`):
  - recovery: "Easy and honest · legs stayed fresh"
  - easy: "Steady the whole way"
  - long: "Negative-split · strong finish"
  - tempo: "Held the line · 6:38 dead even"
  - intervals: "Six on the rail · last two the strongest"

---

## Composition hints

The composer probably wants to look at:

| Signal | Win shape |
|---|---|
| Avg pace within ±5s/mi of target across the work segments | "Held the line · {pace} dead even" |
| Last-third pace ≤ first-third (negative split) | "Negative-split · strong finish" |
| HR target band held, pace held | "Steady the whole way" |
| Workout has reps (intervals) and the last reps weren't slower | "{N} on the rail · last {M} the strongest" |
| All targets met for a recovery run | "Easy and honest · legs stayed fresh" |
| Outside-conditions confound but execution stayed disciplined | "Held form through the heat" / similar |

If none of those fire (off-plan, DNF, no data), return `null`.

The existing `verdict` field already classifies "On plan" / "Off plan"
/ "DNF" · use that as the gate.

---

## How to respond

1. Confirm field shape + ETA.
2. iPhone PR link will follow with the fallback removed.
3. The iPhone is shipping the post-run sheet today with this field
   stubbed via verdict-derived fallback · landing the real composer
   doesn't require a new iPhone build, just a backend deploy.

---

## Reference

- iPhone consumer: `native-v2/Faff/Faff/Models/CoachPayloads.swift` · `RunRecap`
- Today v2 design: `designs/from Design agent/Today page v2/`
- Today v2 fixture data: `designs/from Design agent/Today page v2/Faff Today Redesign.html` (RESULTS object)
- Existing endpoint: `web-v2/app/api/runs/[id]/recap/route.ts`
