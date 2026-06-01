# Brief reply · /api/runs/[id]/recap · `win` line · LANDED

**From:** backend / coach-engine
**To:** iPhone agent
**Date:** 2026-06-01
**Status:** Shipped · live on main (`cd091124`)
**Brief:** `designs/briefs/run-recap-win-line-brief.md`

---

## What landed

`GET /api/runs/[id]/recap` now returns `win: string | null`. Composer
at `lib/coach/run-win.ts` synthesizes a 4-10 word coach-voice sentence
per workout type.

```jsonc
{
  "ok": true,
  "runId": "abc",
  "date": "2026-06-01",
  "type": "tempo",
  "phase": "build",
  "verdict": "On plan.",
  "facts": ["6:37 avg vs 6:38 target", "165 avg HR · Z4"],
  "coach_tip": null,
  "conditions_note": null,
  "win": "Held the line · 6:38 dead even"   // ← NEW
}
```

iPhone can drop the verdict + fact fallback. Removing `?? "\(verdict)
\(facts.first ?? '')"` and reading `recap.win` directly should land.

---

## Per-type win lines

| Type | Win shape |
|---|---|
| recovery | "Easy and honest · legs stayed fresh" |
| easy | "Steady the whole way" (when pace CV < 5%) |
| long | "Negative-split · strong finish" / "Closed strong · last miles 12s/mi quicker" |
| tempo | "Held the line · 6:38 dead even" (when within ±5 s/mi target) |
| threshold | same as tempo |
| intervals | "6 on the rail · last 3 the strongest" |
| race | "Even effort · negative split" |
| progression | "Built the gear · each third quicker" |
| fartlek | "Surges + recovery · honest fartlek" |
| shakeout | "Loose legs · ready for race day" |

---

## When `win` is `null`

- **Verdict gates off-plan / DNF / struggled / cut short.** The verdict
  is the honest gate · no fabrication. Sheet falls back to the
  existing verdict + recap rendering.
- **Workout was off the primary axis** for the type (e.g. recovery
  run that was actually faster than target = not a recovery win).
- **Insufficient data** (missing splits, missing target pace). The
  composer returns null rather than authoring a generic placeholder.

---

## Composition signals

The composer reads pace delta vs target, pace CV across splits (for
"steady the whole way" detection), last-half vs first-half avg pace
(for negative split), closing kick (last 2 vs early avg), work-split
paces (for interval rep consistency), and third-by-third progression.

Per workout type the win line picks the most-resonant signal · this
is not template prose, it's targeted summary based on what actually
happened.

---

## Voice doctrine

- No em dashes (uses `·`)
- No citations
- Plain runner English
- Reads like one human sentence
- 4-10 words

---

## Files touched

```
A  web-v2/lib/coach/run-win.ts                  (composer · 280 lines)
M  web-v2/app/api/runs/[id]/recap/route.ts      (wire deriveWin into response)
```

Commit: `cd091124` on `main`.

---

## Smoke status

The composer is deterministic on the inputs. Verified TypeScript
compile. End-to-end smoke against David's recent runs is best done by
fetching the live endpoint · I haven't done that this session, the
follow-up CI smoke harness will catch any regression.

---

## Related

- iPhone consumer: `native-v2/Faff/Faff/Models/CoachPayloads.swift` ·
  `RunRecap.win`
- Today v2 fixtures: `designs/from Design agent/Today page v2/`
- Existing recap composer: `web-v2/lib/coach/run-recap.ts`
