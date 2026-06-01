# Brief reply · standing recommendation after override · LANDED

**From:** backend / plan-adapter + coach-engine
**To:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Shipped · live on main (`67a6f4f0`)
**Brief:** `designs/briefs/standing-recommendation-after-override-brief.md`

---

## What landed

`seed.week[].standingRecommendation` field exactly per the brief.
Composer at `lib/coach/standing-recommendation.ts` runs a live
re-evaluation against today's readiness signals every seed load.
Returns the engine's CURRENT recommendation, not a replay of history.

### Field shape

```ts
standingRecommendation: {
  kind: 'ease_down' | 'shave' | 'reschedule' | 'maintain' | 'push_back';
  copy: string;
  suggestion: {
    proposedType?: string;
    proposedDistanceMi?: number;
    proposedDateIso?: string;
  } | null;
  severity: 'advisory' | 'firm';
} | null;
```

### Live trigger logic (mirrors `detectReadinessPullback` non-mutating)

| Trigger | Severity | Condition |
|---|---|---|
| `composite_low` | firm | brief.band === 'pull-back' |
| `sleep_streak` | firm | sleep streak ≥ 5 days below target |
| `rhr_elevated` | firm | RHR pillar in pull-back band |
| `hrv_below` | advisory | HRV streak ≥ 3 days below baseline |
| `multi_pillar` | advisory | 2+ pillars in moderate/pull-back band |

### Returns null when

- Brief is null (cold start · no signal)
- Workout is past (completed or archived)
- Workout is not quality (easy / recovery / rest don't get recommendations)
- Runner accepted a fresh proposal for this row in the last 7d
- Live signals don't fire any trigger

The composer is **read-only**. It never mutates plan_workouts. The
runner explicitly accepts via the Accept action which routes through
the existing adapter mutation path.

---

## Re-evaluation cadence

**Per request.** Every seed load (every `/today` render) re-runs the
composer. This is cheap (one brief load + one tiny query per quality
workout). When David's sleep streak breaks tomorrow morning, the
brief reflects that, the composer sees the cleared signal, and the
standingRecommendation disappears on the next page load.

No caching. No staleness. The runner sees the engine's current view.

---

## What David sees right now

His Tue 6/02 was restored to THRESHOLD earlier. With his 8-day sleep
streak still active, the next seed load should populate:

```ts
{
  kind: 'ease_down',
  copy: "Coach still recommends easing this run · sleep below target 8 nights running.",
  suggestion: {
    proposedType: 'easy',
    proposedDistanceMi: 6,
  },
  severity: 'firm',
}
```

The chip stays THRESHOLD (runner's choice). The advisory mounts as a
secondary block below the hero per your design:

```
TUE · TEMPO · PLANNED
THRESHOLD
6.0 mi · 6:47 · ~41 min

▼ Coach still recommends easing this run.
   Sleep below target 8 nights running.
   [ Accept ease ]  [ Proceed with threshold ]
```

When the sleep streak breaks (one full 8h+ night), the advisory
clears automatically on next render.

---

## Frontend Accept-action wiring

The "Accept ease" button should POST through the existing adaptation
acceptance flow. Suggested target:

```
POST /api/coach/proposal/[id]/accept   (existing)
  or
POST /api/plan/workout/[id]/accept-standing  (new, if you want a
                                              dedicated endpoint)
```

Either works. The existing proposal-accept path already writes the
mutation + `plan_adapt_accepted` row to `coach_intents` which the
composer reads via `checkAcceptedProposal` to clear the standing
recommendation on next render.

If you'd like a dedicated endpoint that takes a workoutId + the
suggestion payload directly (rather than going through plan_proposals
first), let me know · I can add it.

---

## Filter pattern · putting it together with adaptations dedup

Frontend renders three different states on the same row:

| Signal | What's shown |
|---|---|
| `adaptation` (was-adapted glyph + "was X" sub) | Historical · the row was changed |
| `adaptations[].kind && !supersededByOverride` | Active adaptation · "Adapted: eased ..." |
| `standingRecommendation` | Forward counsel · "Coach still recommends ..." |

After a runner restores:
- `adaptation` clears (row mutated back)
- `adaptations` history has both downgrade (supersededByOverride=true) and overridden (kind='overridden')
- `standingRecommendation` populates if signals still hold

Design's amber "was X" banner is HISTORY. Standing recommendation is
the cooler-toned FORWARD COUNSEL.

---

## Architecture fit

Per the brief, this adds a 4th case to the closed-loop rules:

1. Hard drift → no accept gate (auto-applies)
2. Soft drift → accept/dismiss card
3. All triggers read shared signals
4. **Post-override → standing reminder** (this one)

Aligns with the locked autonomy doctrine: the runner is the human in
the loop. The engine never overrides their override. It stays honest
about its view through the standingRecommendation surface.

---

## Files touched

```
A  web-v2/lib/coach/standing-recommendation.ts   (composer · 218 lines)
M  web-v2/components/faff-app/seed.ts             (enrichWeekWithStandingRecommendations)
M  web-v2/components/faff-app/constants.ts        (PlannedDay.standingRecommendation type)
```

Commit: `67a6f4f0` on `main`.

---

## Related

- `designs/briefs/restore-original-workout-endpoint-landed.md` · the
  restore endpoint that this layers on top of
- `designs/briefs/key-workouts-training-trajectory-and-adapt-dedup-landed.md` ·
  the trainingInfluence + adaptations dedup that ships in tandem
- `web-v2/components/faff-app/views/TodayView.tsx` · PlannedHeroV2 is
  the mount point for the advisory block
