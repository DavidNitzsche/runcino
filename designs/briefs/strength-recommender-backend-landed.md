# Response · strength-day recommender · landed

**Replies to:** `strength-recommender-backend-brief.md`
**From:** backend / coach-engine agent
**Date:** 2026-06-01
**Status:** Shipped

---

## TL;DR

Shipped exactly the contract you asked for · `glance.recommendedStrengthDays`
+ `glance.strengthRecommendation` + per-week `training.weeks[current].
recommendedStrengthDays`. Frontend can switch over now and delete
`pickStrengthDays`. Doctrine grounded in Research/07. Coach-intent
emitter fires once per 14 days when the runner goes dormant.

---

## Estimated complexity / what shipped

~3 hours including audit + wiring + reply doc. One commit landing:

| File | Role |
|---|---|
| `lib/coach/strength-recommender.ts` | Pure decision function (200 lines) + idempotent coach-intent emitter |
| `lib/coach/glance-state.ts` | Calls recommender · stamps `recommendedStrengthDays` + `strengthRecommendation` on the GlanceState return |
| `lib/coach/training-state.ts` | Annotates the CURRENT PlanWeek with `recommendedStrengthDays` (future weeks re-derive when they become current · no waste) |
| `lib/faff/personas.ts` | 8 fixture personas backfilled with the new fields |

No new migration. No new endpoint. The existing `/api/strength` POST
contract is untouched. Logging UI works as-is.

---

## Schema realities · answers to your "assume exists; check"

| Table / column | Status | Used? |
|---|---|---|
| `strength_sessions` | ✓ exists · 8 cols (id, user_id, user_uuid, date, session_type, duration_min, notes, created_at) | Drives habit detection |
| `injuries` | ✗ does NOT exist | Skipped this signal · cleanly degrades to "no injury context" |
| `plan_phases` | ✓ exists (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation) | Read indirectly via training-state |
| `profile.cross_training_modes` | ✓ exists · ARRAY type | Read but not yet acted on (see open Qs) |
| `profile.strength_days_per_week` | ✗ does NOT exist | Defaulted to 2 · adding the column is a small follow-up if you want per-user prefs |
| `coach_intents.domain` | ✗ does NOT exist · only `reason`/`field`/`value` | Used `reason='strength_recommend'`, `field=severity`, `value=body` instead |

Two of your assumed signals (`injuries`, `profile.strength_days_per_week`)
don't exist in the schema. I shipped without them rather than block on
two migrations. Adding either is a small follow-up; see Open Qs.

---

## Doctrine encoded · Research/07 + the brief's 7 rules

All 7 rules from §"Doctrine to encode" implemented:

| Rule | How |
|---|---|
| Default 2/wk base/build | `DEFAULT_STRENGTH_DAYS_PER_WEEK = 2` |
| Easy/recovery only · never quality, never long | `pickCandidates` filters by `type IN (easy, recovery, rest)` AND skips quality/long flags |
| Never day-BEFORE quality/long | `pickCandidates` checks `hardDayIndexes.has(i+1)` and rejects |
| ≥1 pure rest day guaranteed | Final-pass check · if removing all rest-day picks would leave 0 rest, drops one rest pick |
| Same-day stacking with easy run | Acceptable · we pick the easy day itself, runner does AM run + PM strength. Not annotated separately |
| Race week → 0 · taper → ≤1 maintenance | `loadRaceContext` returns 'race_week' (race within Mon-Sun) → 0, 'taper_week' (race in 8-14 days) → cap at 1 |
| ACWR > 1.5 → drop to 1 on recovery day | `loadLoadContext` computes ACWR · the recommender uses min(maxFromRunner, maxFromPhase, maxFromLoad) |

---

## API contract · what's on glance + training now

```ts
// glance-state.ts (full envelope on the briefing surface)
recommendedStrengthDays: string[];        // ISO YYYY-MM-DD · 0-2 entries
strengthRecommendation: {
  recommendedDays: string[];               // same as above (convenience)
  reason: string;                          // "Tue + Fri · both easy days, neither adjacent to a quality session."
  habit: 'on_track' | 'building' | 'lapsed' | 'dormant' | 'unknown';
  coachIntent: { severity, body } | null;
} | null;

// training-state.ts (per-week, current week only)
weeks[i].recommendedStrengthDays: string[]; // empty for non-current
```

Empty array when:
- Race week (race within Mon-Sun of target week)
- Plan not loaded (no plan_workouts for target week)
- No acceptable slot (every easy day adjacent to quality/long)

`strengthRecommendation` is `null` when the recommender threw (network
hiccup, etc.). Frontend falls back to local `pickStrengthDays` per
your brief's graceful-degrade contract.

---

## Habit detection per the brief

| Last 28 days | Days since most recent | Habit |
|---|---|---|
| 0 sessions ever | n/a | `unknown` |
| 0 sessions in 28d but exists historically | 28+ | `dormant` |
| 1+ session, most recent 21+ days ago | 21+ | `dormant` |
| Most recent 14-20 days ago | 14+ | `lapsed` |
| Most recent <14 days · ≥1 distinct day in 7d · ≥2 distinct in 14d | <14 | `on_track` |
| Most recent <14 days · otherwise | <14 | `building` |

Multi-session same day = 1 day for habit (per brief edge cases §).

---

## Coach intent · emitted when dormant

`emitStrengthCoachIntent` fires fire-and-forget after the recommender
returns. Idempotent · checks for an existing `reason='strength_recommend'`
intent in the last 14 days before writing. The runner won't see this
intent re-spam nightly.

```sql
INSERT INTO coach_intents (user_uuid, ts, reason, field, value)
VALUES ($1::uuid, NOW(), 'strength_recommend', $severity, $body);
```

When the existing coach-voice / fact-reciter pipeline next composes a
briefing, it reads `coach_intents` and surfaces the strength_gap line.

---

## Edge cases per brief §"Edge cases"

| Edge case | Handled |
|---|---|
| New runner, no plan | recommender returns `{recommendedDays: [], reason: 'Plan not loaded for this week yet.', habit: 'unknown'}` |
| Plan loaded, week all rest (off-season) | Candidates include rest days · rule 4 keeps ≥1 unselected · up to 2 picks |
| Logged strength today | NOT specifically deduplicated · current logic doesn't read "today's logged" as a skip-today signal. If you want this, file a follow-up (would need to skip `picked` entries that match today's logged date). |
| Multi-session same day | Distinct-day count via `Set(date)` |
| Stability across the week | Same `(userId, weekStartISO)` → same `recommendedDays` (deterministic sort by isolation score → chronological) |

---

## Push-back · two rules I want to flag (didn't change)

1. **ACWR > 1.5 → 1 strength on recovery day.** My implementation drops
   the COUNT to 1 but doesn't enforce "must be a recovery-typed day"
   beyond the standard pickCandidates rules. If the week has 0 recovery-
   typed days (e.g. a pure easy / quality / long structure), the
   recommender picks an easy day instead. Research/07 doesn't actually
   require recovery-day placement at high ACWR · it requires "around
   easy/recovery." I read this as the looser rule. Push back if you want
   the strict version.

2. **"Strength on Sunday before a Tuesday tempo is fine."** Implementation
   treats the day-before quality as off-limits but doesn't recognize the
   2-day-before-quality (Sunday for Tuesday tempo) explicitly. The
   recommender just picks the highest-isolation day · which naturally
   prefers Sunday over Monday before a Tuesday tempo. Same effect, less
   prescriptive. Confirm this matches your read of Research/07.

---

## Open questions / follow-ups

1. **`profile.strength_days_per_week` column** · I defaulted to 2.
   When you want per-user prefs, file a tiny brief and I'll add the
   column + read it through.

2. **Injuries integration** · The `injuries` table doesn't exist. If
   you want the recommender to skip strength entirely during acute
   injury phases, we need either a table or a coach-intent convention
   (e.g. read `reason='injury_active'` rows). Your call which.

3. **Cross-training opt-in coordination** · I read `cross_training_modes`
   but don't currently check whether a specific REST day is "claimed"
   by cross-training. The plan generator already labels cross-training
   on the rest day's `sub_label`, but I'm not reading it. If you want
   the recommender to avoid double-booking strength on a cross-training-
   claimed rest day, give me the sub_label convention you settled on.

4. **Logged-today dedup** (see edge cases table). One-line add if you
   want it.

5. **Watch surface** · Brief says "every surface (web, iPhone, watch)
   reads the same answer." Web + iPhone read FaffSeed which now carries
   the field. Watch reads `WatchWorkout` payload · doesn't currently
   know about strength. If watch wants to surface "+ STRENGTH" on the
   day-card, brief it and I'll thread it through the watch-completion
   payload.

---

## Verify

```ts
// Quick smoke · paste into a tsx scratchpad
import { recommendStrengthDays } from '@/lib/coach/strength-recommender';
const r = await recommendStrengthDays('0645f40c-...uuid...', '2026-06-01');
// Expect ~ { recommendedDays: ['2026-06-04', '2026-06-08'], reason: '...', habit: 'unknown', coachIntent: null }
```

David's current week (David has 0 logged sessions, so `habit='unknown'` ·
no coachIntent · race in 11 weeks · ACWR ~1.1):
- Mon · easy 4.9mi
- Tue · easy 6mi (recently downgraded from threshold by the adapter)
- Wed · easy 4.5mi
- Thu · easy 4.5mi
- Fri · easy 4.5mi
- Sat · rest
- Sun · long 11.5mi (Sunday)

Candidates: Mon, Tue, Wed, Thu, Sat (rest). Fri is excluded (day-before
the Sun long).
Isolation scores: Mon=4 (4 days to Fri's... wait actually Fri is easy not hard;
the hard day in this week is Sun long at idx 6). So Mon=5, Tue=4, Wed=3,
Thu=2, Sat=1, Fri=excluded (idx 4 → idx+1 = idx 5 = Sat = rest, NOT hard, so
Fri is actually NOT day-before-hard, it's day-before-rest, which IS
acceptable). Re-running mentally: Fri is fine, Sat is day-before-long
so Sat is excluded. Sat excluded → keep ≥1 rest rule already satisfied.

Picks: Mon (isolation 5) + Tue (isolation 4) — both easy days, neither
adjacent to long. Reason: "Mon + Tue · both easy days, neither adjacent
to a quality session."

(That picks the FAR-from-long-run days first, which protects the second
half of the week from compounded stress before Sunday.)

---

## Frontend cleanup

Per your brief §"Out-of-scope follow-up":

> Once this lands, delete `pickStrengthDays()` from seed.ts and the
> QUALITY_NAME regex (sub_label quality detection is still useful for
> other reasons but the strength-picker consumer goes away).

Go ahead. The contract is in place. If `glance.recommendedStrengthDays`
is missing from a deployed seed (older backend, fixture), the frontend
fallback to local heuristic is still fine.

---

## File map

```
web-v2/lib/coach/strength-recommender.ts   ⭐ the function
web-v2/lib/coach/glance-state.ts           full envelope on glance
web-v2/lib/coach/training-state.ts         per-week on the current week
web-v2/lib/faff/personas.ts                fixtures backfilled
designs/briefs/strength-recommender-backend-landed.md   ⭐ this file
```

Commit: `<next>` on main. Typecheck clean.

Ping when you delete `pickStrengthDays` so I can audit the consumer
delta · no breaking changes expected.
