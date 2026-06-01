# Brief · Strength-day recommender · backend authority

**For:** backend / coach-engine agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Architecture · brief only, no implementation yet

---

## TL;DR

The frontend currently picks 2 strength days per week with a client-side heuristic in `web-v2/components/faff-app/seed.ts:pickStrengthDays`. It has no per-user signal — only the week's run shape. We want backend to own this decision so every surface (web, iPhone, watch) reads the same answer, personalized to the runner.

Build a coach-engine function that emits `recommendedStrengthDays: ISO[]` on the existing glance/training state. Frontend becomes a dumb renderer.

---

## What's in place today

### Real
- `strength_sessions` table — id, user_uuid, date, session_type, duration_min, notes. Logged via `LogNonRunSheet` (iOS) + `/api/strength` (POST).
- Research doctrine — `Research/07-strength-programming.md`. Two sessions per week. Avoid hard-on-hard. Easy or recovery days. Not adjacent to long run.
- Locked product call (David, 2026-05-31): cross + strength are NOT scheduled by the plan generator. Runner logs ad-hoc. Plan generator only relabels rest days with cross-training when opted in via `profile.cross_training_modes` (separate from strength).

### Missing
- No coach-engine function recommends WHEN.
- No DB flag on `plan_workouts` for strength.
- The `/api/strength` route doc cites "coach reads logs to credit the runner's strength habit + flags 3-week gaps as CHALLENGE" — that logic is NOT implemented, just doctrine-as-stub.
- Frontend `pickStrengthDays` is a pure week-shape heuristic. It doesn't read `strength_sessions`, doesn't know about injuries, doesn't know about runner preferences.

---

## What we want backend to build

### 1. Coach-engine recommender

A function (suggested path: `web-v2/lib/coach/strength-recommender.ts`) that returns:

```ts
type StrengthRecommendation = {
  /** ISO YYYY-MM-DD dates for the upcoming week (Mon-Sun). 0-2 entries.
   *  Empty array = no strength surfaced (off-week, race week, injury). */
  recommendedDays: string[];
  /** Why these days vs. others. Coach-voice, short, single sentence.
   *  e.g. "Tue + Fri · both easy days, neither adjacent to Sunday's long." */
  reason: string;
  /** Status of the runner's strength habit.
   *  - 'on_track'   · ≥1 session logged in last 7 days, ≥2 in last 14
   *  - 'building'   · 1 session in last 14 days
   *  - 'lapsed'     · no session in 14-21 days
   *  - 'dormant'    · no session in 21+ days (this is the CHALLENGE state)
   *  - 'unknown'    · no logging history yet (new runner) */
  habit: 'on_track' | 'building' | 'lapsed' | 'dormant' | 'unknown';
  /** Optional coach intent escalation. When habit='dormant', this fires
   *  as a coach_intents row so the runner sees it in the briefing. */
  coachIntent?: {
    severity: 'soft' | 'firm' | 'urgent';
    body: string;
  } | null;
};
```

Function signature:

```ts
async function recommendStrengthDays(
  userId: string,
  weekStart: Date,   // Monday of the target week
  ctx: CoachContext  // existing context · plan_workouts, races, profile, etc.
): Promise<StrengthRecommendation>
```

### 2. Personalization inputs

The recommender should consider:

| Signal | Source | Rule |
|---|---|---|
| Logged strength history | `strength_sessions` (last 28 days) | Don't recommend days adjacent (±1) to a recent session; surface coach intent if dormant. |
| Quality days in the week | `plan_workouts.sub_label` keywords (per the alignment brief) + `type` bucket | Skip quality days, never day-before quality, never day-before long. |
| Race in next 14 days | `races` table | If race within 7 days → return empty (taper week, no strength). If race in 8-14 days → 1 session max, midweek only. |
| Active injuries | `injuries` table (assume exists; check) | If runner has an active acute injury → return empty unless explicitly cleared. Surface modified guidance. |
| Runner preference | `profile.strength_days_per_week` (NEW · optional, default 2) | Cap recommended days at this number. |
| Cross-training schedule | `profile.cross_training_modes` | Don't double-book strength on a cross-training-claimed rest day. |
| ACWR / load band | existing readiness/training-state | High spike (ACWR > 1.5) → drop to 1 strength day, prefer recovery-day placement. |
| Plan phase | `plan_phases` | Peak/taper phases → maintain (not build). Base/build → encourage 2/wk. Off-season → cap at 1, allow heavier. |

### 3. Surface on existing glance / training state

Add `recommendedStrengthDays` (the array of ISOs) to:
- `glance-state.ts` output (`Glance.recommendedStrengthDays: string[]`) — drives the week-strip annotation on TodayView.
- `training-state.ts` output (`Training.weeks[i].recommendedStrengthDays?: string[]`) — drives the FULL PLAN month calendar.

Both should call the same `recommendStrengthDays()` function. The full recommendation object (`reason`, `habit`, `coachIntent`) goes on `glance-state` only (the briefing surface reads it).

### 4. Coach-intent emission

When `habit === 'dormant'`, write a `coach_intents` row:

```ts
{
  user_uuid: ...,
  date: today,
  domain: 'strength',
  severity: 'firm',
  field: 'strength_gap',
  body: "It has been 24 days since your last logged strength session. Two short sessions a week protects your hips and hamstrings, especially as mileage climbs. Today is an easy day · 20 minutes is enough.",
  source: 'strength-recommender',
}
```

Use the same coach-intent pipeline that drives readiness adaptations. Frontend already renders coach_intents on the briefing surface.

---

## API contract / shape the frontend will consume

The frontend will:

1. Read `glance.recommendedStrengthDays: string[]` (an array of ISOs). Render "+ STRENGTH" annotation on the week-strip chip when the day's ISO is in the array.
2. Read `glance.strengthRecommendation: { reason, habit, coachIntent }` for the briefing surface. Render the reason as the strength block's subhead. If `coachIntent` is set, render via the existing coach-intent component.
3. Stop calling `pickStrengthDays()` (frontend will delete that function once backend ships this).

If `recommendedStrengthDays` is undefined or missing from the response (e.g. backend not yet shipped), frontend falls back to the current heuristic — gracefully degrades to today's behavior.

---

## Doctrine to encode (Research/07 summary)

The recommender's rules should match these:

1. **Default 2 sessions/wk** for distance runners in base/build phases.
2. **Easy or recovery days** are the preferred placement. Never a quality day, never long-run day.
3. **Never day-BEFORE quality or long.** Strength on Sunday before a Tuesday tempo is fine. Strength on Saturday before a Sunday long is not.
4. **At least 1 full rest day per week** must remain. If picking strength on a rest day would leave zero pure rest, skip.
5. **Same-day stacking with easy run** is acceptable (runner can do AM easy + PM strength). Note this as a hint, not a separate row.
6. **Race week: zero strength.** Taper week: optional 1 session, light/maintenance only.
7. **High ACWR (>1.5):** drop to 1 strength/wk, prefer recovery day.

---

## Edge cases

- **New runner, no plan loaded:** return `habit: 'unknown'`, `recommendedDays: []`, generic reason. Don't pretend to know.
- **Plan loaded but week is all rest (off-season):** allow up to 2 strength days on rest days, but explicitly call out this is off-season programming (heavier, lower frequency OK).
- **Runner has logged strength TODAY:** acknowledge in reason ("Logged today, good · next session Thu") and recommend the next day, not today.
- **Multiple sessions same day in history:** count as 1 day for habit calculation.
- **Recommender output stable across the week:** picking should be deterministic per (userId, weekStart) so the chip doesn't jitter day-to-day. Cache or compute from stable inputs only.

---

## What's NOT being asked

- Don't ship a strength-PLAN GENERATOR. We are not scheduling specific exercises, sets, or reps. The runner picks the session. The recommender only picks the DAYS and surfaces the habit signal.
- Don't change `LogNonRunSheet` or `/api/strength` POST contract. The logging UI works.
- Don't change `plan_workouts` shape. Strength is NOT a `plan_workouts` row — it's a separate signal layered on the week.
- Don't auto-pop a modal. Recommended days are annotations on existing UI, not a new prompt.

---

## Out-of-scope follow-up the frontend will queue

Once this lands, delete `pickStrengthDays()` from seed.ts and the QUALITY_NAME regex (sub_label quality detection is still useful for other reasons but the strength-picker consumer goes away).

---

## How to respond

Reply with:
1. Estimated complexity / hours.
2. Any rules above you'd push back on (e.g. "ACWR thresholds should be different per Research/X").
3. Open questions about which signals are available (`injuries` table existence, `profile.strength_days_per_week` column, etc).
4. PR link when shipped — frontend will wire the renderer the same day.

---

## Related briefs

- `designs/briefs/plan-type-column-alignment-brief.md` — the QUALITY_NAME regex this recommender will rely on stops being needed once `plan_workouts.type` is tightened. Either order works; this brief doesn't depend on that one.
