# Backend state · 2026-06-01 · what landed today

**For:** web + iPhone frontend agents
**From:** backend / coach-engine agent
**Status:** All commits on `main` · typecheck clean

A lot of plumbing landed today across multiple briefs. This is the
catch-up · what's new on the FaffSeed envelope, behavior changes you'll
see in production, what's deprecated, and what's still queued.

---

## TL;DR

Today the app moved from "templated outputs" to **two autonomous loops**
plus a **multi-system shared source of truth**:

  1. **Plan adapts itself** when reality drifts from authored state ·
     soft drift (volume, VDOT, staleness) → pending proposals · hard
     drift (race date, goal time, A-race add/remove) → auto-applied
     rebuilds · runner sees cards on Today view.

  2. **Readiness drives EVERYTHING.** One brief, five pillars, three
     consumers · the morning brief on Today · the run-adapter that
     downgrades quality days · the strength recommender that picks
     strength days. All three read the SAME `readiness-brief.ts`.
     No more single-signal contradictions.

Plus three new FaffSeed fields you can render: `readinessBrief`,
`planProposals`, `strengthRecommendation`.

---

## New seed fields · render-ready

### 1. `seed.readinessBrief: ReadinessBriefSeed | null`

The daily morning brief envelope · score + trend + per-pillar tiles +
streaks + movers + confounders + watch-tomorrow callouts.

```ts
type ReadinessBriefSeed = {
  date: string;
  score: number;                // 0-100
  band: 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data';
  label: string;                // 'READY'
  headline: string;             // band+streak-aware one-liner
  oneLineMover: string | null;  // "HRV down 8 pts vs yesterday"
  scoreTrend: Array<{ date, score, band }>;   // 14d
  pillars: ReadinessPillarTile[];              // 5 tiles
  streaks: ReadinessStreak[];                  // 3+ day persistence
  movers: ReadinessMover[];                    // biggest vs yesterday
  subjectiveOverride: ... | null;              // Saw et al. · UI TBD
  watchTomorrow: string[];                     // 0-3 forward callouts
};
```

**Doctrine guardrails** (don't break these):
- **No prescription on the panel** · readings only · the coach voice
  prescribes. Otherwise contradictions surface.
- **State both numbers, no derived deltas** · "7.2h · 7-night avg" +
  "target 7.5h" · NEVER "−0.3h short."
- **Subjective beats objective** · when subjectiveOverride fires
  (UI not shipped yet), the advice override wins.

Full doc: `designs/briefs/readiness-brief-backend-landed.md`

### 2. `seed.planProposals: PlanProposalSeed[]`

Plan-drift detections + auto-applied rebuild audit rows. 0-5 items.

```ts
type PlanProposalSeed = {
  id, planId, newPlanId, source, reasons, severity, createdAt, ...
  kind: 'volume_drift' | 'vdot_drift' | 'staleness'        // soft · accept/dismiss
      | 'race_date_changed' | 'goal_time_changed'
      | 'a_race_added' | 'a_race_removed';                  // hard · auto-applied
  status: 'pending'        // soft · runner picks
        | 'auto_applied'   // hard · already rebuilt
        | 'accepted' | 'dismissed' | 'superseded';
  message: string;         // plain-language one-liner · always populated
};
```

**Card render matrix:**

| Status | Render | Action |
|---|---|---|
| `pending` | Card with Accept + Dismiss buttons | POST `/api/plan/proposal {id, action}` |
| `auto_applied` | "We rebuilt your plan because X" notification · no buttons | Optional "see what changed" link to `newPlanId` |
| `accepted` | Brief success toast · auto-dismiss | — |
| `dismissed` | Don't render | — |

Full doc: `designs/briefs/plan-auto-adapt-backend-landed.md`

### 3. `seed.strengthRecommendation: { recommendedDays, reason, habit, coachIntent } | null`

Web agent already pulled this into FaffSeed top-level (was previously
only on glance). Also threaded to `PlannedDay.strengthSuggested` so
the week-strip annotation is a pure render.

```ts
strengthRecommendation: {
  recommendedDays: string[];    // ISO YYYY-MM-DD · 0-2 entries
  reason: string;               // "Mon + Tue · both easy days, ..."
  habit: 'on_track' | 'building' | 'lapsed' | 'dormant' | 'unknown';
  coachIntent: { severity, body } | null;   // fires when habit=dormant
};
```

Full doc: `designs/briefs/strength-recommender-backend-landed.md`

---

## Behavior changes you'll see

### Run-adapter no longer single-signal blind

**Before** · `detectRhrSpike` fired on RHR alone (one elevated reading
Sunday morning → downgrade Tuesday's threshold). Two systemic problems:
single signal + 2-day-ahead window.

**After** (commit `c7f779c5`) · `detectReadinessPullback` reads the FULL
readiness brief · band='pull-back' OR ≥1 active 3+ day streak. Action
window narrowed to TODAY ONLY · `pw.date_iso = CURRENT_DATE::text`.
Tuesday's quality gets decided Tuesday morning based on Tuesday's data.

**What you'll see:** fewer downgrades. The ones that fire are doctrinally
solid (sleep streak, HRV streak, composite pull-back). The reason copy
now names the actual signal: "Readiness pullback · SLEEP below 8 days
running + composite readiness 54/100 (pull-back band)."

### Strength recommender now coordinates with readiness

**Before** · recommender only checked ACWR > 1.5. Two contradictory
behaviors possible: adapter downgrades the run, but the "+ STRENGTH"
chip still shows two heavy days.

**After** (commit `dc1771da`) · recommender reads the SAME readiness
brief the adapter reads.

| Readiness signal | Behavior |
|---|---|
| `band='pull-back'` | recommendedDays=[] · "Strength suppressed · sleep 8d streak · injury risk per Research/07" |
| ≥1 active streak | drop weekly cap to 1 maintenance |
| neither | normal 2/wk |

**What you'll see:** "+ STRENGTH" chip disappears or drops to 1 when the
runner is in a fatigue band. Reason copy explains which signal tripped.

### ACWR includes strength load now

**Before** · ACWR was running-mileage-only. Heavy strength weeks
under-counted real stress.

**After** (commit `9ad0d31b`) · strength_sessions duration folds into
acute7 + chronic28 at 0.07 mi-equivalent per minute. Closes the feedback
loop · strength → ACWR → readiness brief → strength recommender + run
adapter.

**What you'll see:** the ACWR you display on Form / At-A-Glance / readiness
will tick slightly higher for runners who log strength regularly. David
has 0 logged sessions so it's a no-op for him today.

### plan_workouts.type contract tightened

**Before** · adapter `downgrade` action rewrote `type` but left
`sub_label`, `pace_target_s_per_mi`, `is_quality` untouched · the row
ended up self-contradictory (type='easy' + sub_label='Cruise Intervals').

**After** (commit `e02c8412`) · downgrade is atomic. type=easy/recovery/rest
clears sub_label + pace + is_quality coherently. Backfill ran for the
one rogue row (David's Tue 6/02).

**What you'll see:** `type` is now reliable as the source of truth.
Your `mapType` switch can trust it without keyword-matching sub_label.

Full doc: `designs/briefs/plan-type-column-alignment-landed.md`

---

## Hooks that fire on user actions

Pre-existing endpoints, but new behavior:

| Endpoint | Now also fires |
|---|---|
| `PATCH /api/race` (date) | `fireAutoRebuild` with `race_date_changed` · plan rebuilds atomically |
| `PATCH /api/race` (goal) | `goal_time_changed` · rebuild |
| `PATCH /api/race` (priority A/non-A swap) | `a_race_added` / `a_race_removed` · rebuild |
| `DELETE /api/race` (was the goal race) | `a_race_removed` orphan · proposal written, no auto-rebuild (no race to point at) |

Response payload now includes `autoRebuild: { kind, oldPlanId, newPlanId, ok, reason } | null`.

You can surface this directly in the race-edit toast: "Plan rebuilt
because race date moved to Aug 23 · 11 weeks remaining" → tap → goes
to the new plan view.

---

## What's deprecated · don't use

| Was | Use instead |
|---|---|
| Frontend `pickStrengthDays(week)` heuristic | `seed.strengthRecommendation.recommendedDays` (already wired by web agent) |
| Manual `Regenerate plan` button as load-bearing path | Still works · but rarely needed · auto-adapt fires for race/goal edits, drift cron catches the rest |
| Single-signal RHR or sleep checks anywhere | Read the readiness brief · it composes all 5 pillars + Plews HRV + streaks |
| Hardcoded "+ STRENGTH" chip math | Render off `recommendedStrengthDays` ISO array · pure render |

The deprecated code paths haven't been DELETED · they're just no longer
called. Safe to clean up in your next pass.

---

## Crons running nightly

| Cron | Schedule | What |
|---|---|---|
| `/api/cron/refresh-briefings` | 07:05 UTC | Existing |
| `/api/cron/run-adaptations` | 07:15 UTC | Adapter · now multi-signal · today-only window |
| `/api/cron/snapshot-projections` | 07:30 UTC | Existing · VDOT + race projection |
| `/api/cron/enrich-weather` | 07:30 UTC | Existing |
| `/api/cron/readiness-snapshot` | 08:15 UTC | **NEW** · daily readiness_snapshots row |
| `/api/cron/plan-drift` | 09:00 UTC | **NEW** · soft drift detection → plan_proposals pending rows |

Order matters · readiness-snapshot runs AFTER projection-snapshot so
the load pillar has the latest VDOT. Plan-drift runs after both so
it sees the freshest signals.

---

## Open questions for frontend

1. **Card placement.** The Today view now has potentially THREE banner
   surfaces:
   - Pending `coach_proposals` (injury / illness · existing)
   - Pending `plan_proposals` (drift · new)
   - Auto-applied `plan_proposals` (race/goal · new)
   Decide stack order. Suggest: hard-impact / runner-actionable first
   (illness, drift accept), then auto-applied notifications.

2. **`auto_applied` notification persistence.** How long should "we
   rebuilt your plan because race date moved" stay visible? Suggest
   24h or until manually dismissed.

3. **Subjective wellness check-in.** The `readinessBrief.subjectiveOverride`
   slot is ready but the UI to capture 1-10 wellness hasn't been built.
   Per Saw et al., this is the strongest single recovery signal. When
   you're ready, file a brief and I'll wire it.

4. **Pillar trend display dominance.** Research says 14-day trend is
   more informative than spot score. Want the sparkline to be the
   biggest visual element on the readiness panel? Or lead with the
   score?

5. **Strength chip when habit='dormant'.** Recommender emits a coach_intent
   on dormancy. Currently the briefing surface should auto-render it.
   If you want a dedicated "you haven't lifted in 24 days" callout on
   the strength surface itself (not just in the coach intent stream),
   tell me what shape to expose.

---

## Known gaps · queued for follow-up

These are tracked but not blocking. They surface as worse outputs in
edge cases, not bugs:

1. **Generator strips quality from Wks 1-3 of rebuilds.** When a runner
   is mid-block, the rebuilt plan treats them as "fresh base." Auto-rebuild
   fires anyway (better than a stale plan pointing at the wrong date)
   but the rebuilt plan is subtly worse for mid-block runners. Tracked
   to fix the generator's mid-block awareness.

2. **`pace_target_s_per_mi` sometimes null** on freshly-generated workouts.
   Existing plans have paces; new generator output sometimes doesn't.
   Bug in workout-library resolver.

3. **`injuries` table doesn't exist.** Strength recommender + plan adapter
   both want to read it. Today they skip the signal cleanly. When the
   table lands, file a brief and I'll integrate.

4. **`profile.strength_days_per_week` doesn't exist.** Recommender defaults
   to 2. Per-user pref is a small column-add + read-through.

5. **Generator gaps file** at `designs/briefs/targets-gap-panel-backend-landed.md`
   §"Known generator gaps" tracks both #1 and #2 above.

---

## Doctrine reminders · the autonomy mindset

David, 2026-06-01: "We haven't had the coach chat in this build for a
long time. Its not going to happen and any features that rely on it
need to be recalibrated/removed."

Anywhere you're tempted to write "tap to ask the coach" or build a card
that requires user friction to resolve · stop. The system has to act
autonomously. Translate that copy into either:
- Auto-applied action with a notification, OR
- Pre-emptive surfacing of WHY the system already decided

Three rules locked across all backend systems shipped today:

1. **Hard-drift = no accept gate.** Race date / goal time / A-race
   add-or-remove · auto-apply. The runner already made the underlying
   change.
2. **Soft-drift = accept/dismiss card.** Volume / VDOT / staleness ·
   the tradeoff is real, runner picks. Dismissal respected 14 days.
3. **All triggers read shared signals.** Run adapter + strength
   recommender + readiness brief = three readers of the same physiology
   model. Don't build a 4th reader with its own logic · plug into the
   brief.

---

## Commits today (newest first)

```
9ad0d31b  feat(load): fold strength sessions into ACWR
dc1771da  feat(strength): recommender reads readiness brief
c7f779c5  fix(adapt): multi-signal readiness + today-only window
34bff2a0  feat(coach): strength recommender · per-user picked days
e02c8412  fix(plan): adapter downgrade no longer leaves stale fields
f8e4dc55  feat(plan): autonomous plan-adaptation system
2b6c8765  docs(targets): backend-landed companion (GapPanel)
8753b26b  feat(targets): GapPanel Hit list · projection-levers
89c8f120  feat(targets): GapPanel Execution chunk · pacing discipline
37d950f9  feat(targets): GapPanel Conditions chunk
ce9fcfde  feat(targets): GapPanel Course chunk
e05bc975  feat(readiness): morning brief system
```

---

## File map · what to open first

```
designs/briefs/
├── backend-state-2026-06-01-landed.md           ← this file · the catch-up
├── readiness-brief-backend-landed.md            ⭐ brief contract + UI rules
├── plan-auto-adapt-backend-landed.md            ⭐ auto-adapt contract + card states
├── strength-recommender-backend-landed.md       strength recommender contract
├── plan-type-column-alignment-landed.md         type-column tightening
└── targets-gap-panel-backend-landed.md          GapPanel chunks (from earlier)

web-v2/components/faff-app/
├── types.ts                                      ⭐ FaffSeed envelope · 3 new fields
└── seed.ts                                       ⭐ enrichment block · all wired

web-v2/lib/coach/
├── readiness.ts                                  score computation (unchanged · stable contract)
├── readiness-brief.ts                            ⭐ composer · 5 pillars + streaks + movers
├── readiness-history.ts                          60d pillar history + Plews HRV
├── readiness-snapshot.ts                         nightly writer
├── strength-recommender.ts                       ⭐ picks days · reads readiness brief
└── strength-load.ts                              ⭐ ACWR fold helper · 0.07 mi/min

web-v2/lib/plan/
├── adapt.ts                                      ⭐ rewritten · multi-signal + JIT
├── drift-monitor.ts                              soft drift detector
├── auto-rebuild.ts                               hard drift handler
└── proposals-state.ts                            FaffSeed.planProposals loader

web-v2/app/api/
├── cron/readiness-snapshot/route.ts              nightly
├── cron/plan-drift/route.ts                      nightly
├── plan/proposal/route.ts                        accept/dismiss endpoint
└── race/route.ts                                 PATCH + DELETE hooks (auto-rebuild)
```

---

## TL;DR for picking up

Read the three ⭐ design briefs in `designs/briefs/`. Render the three
new FaffSeed fields. Trust `type` as the source of truth in `plan_workouts`.
Delete `pickStrengthDays` if you haven't already. When in doubt, the
autonomy rule wins · build it to fix itself, not to prompt the runner.

Ping for any of the 5 open questions or the 5 known gaps. Otherwise
the contract is in place.
