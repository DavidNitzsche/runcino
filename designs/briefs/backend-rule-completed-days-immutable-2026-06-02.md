# Backend doctrine · completed days are immutable

**Date:** 2026-06-02
**For:** backend agent
**From:** David, via web agent
**Status:** new rule · please codify

## TL;DR

**Once a `plan_workouts` row has a corresponding completed run, NOTHING on that row may change.** Type, distance, target pace, target HR, spec, sub_label, workout_spec, phase, week_id, none of it. Plan adjustments, doctrine updates, rule-engine retroactives, rebuilds — all stop at the boundary of "did the runner complete this day."

A completed day is a historical record, not a planning artifact. Treat it like an immutable journal entry from the moment the run lands.

## The failure case (2026-06-02 / Mon EASY)

Sequence:

1. Mon was authored as a 5.1 mi easy run (or similar).
2. David ran 5.1 mi. The Strava row landed, `runs.data.distanceMi = 5.1`, plan-workouts and run linked by date.
3. Some later backend pass — plan rebuild, rule sweep, generator update, doctrine codification — touched Mon's `plan_workouts` row and revised its `distance_mi` upward to 6.0.
4. David opened Mon's post-run hero (web) the next day. The badge logic compared actual (5.1) vs planned-now (6.0), saw 85%, fired **OFF PLAN**.
5. The recap and the AEROBIC STAMP panel both said the run was correctly executed (Z1+Z2 100%, +3 bpm drift, "effort was right"). The badge contradicted them because it was comparing against a planned distance that didn't exist when the runner did the run.

The data was honest about its own state. The doctrine that allowed retroactive edits to a day with a completed run was the bug.

## The rule, concretely

A day becomes immutable the moment **any** of the following is true for that calendar date:

- A `runs` row exists with `COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = pw.date_iso` AND `(data ? 'mergedIntoId') = false`.
- A `coach_intents` row exists with `reason = 'watch_completion'` for that date and runner.
- Any post-completion artifact (RPE, weather enrichment, run recap, run win, etc.) has been written for the matching activity.

From that point forward, the backend MAY NOT write any of these `plan_workouts` columns on that row:

- `type`
- `distance_mi`
- `pace_target_s_per_mi`
- `hr_cap_bpm` / `hr_target_bpm` / `lthr_bpm`
- `workout_spec` (the whole jsonb · and the fields inside it: targets, intervals, structure)
- `sub_label`
- `name`
- `phase` / `week_id` (no shifting completed days between weeks · no re-labeling phase boundaries through them)
- `is_quality`
- Any other column that describes what the runner was prescribed to do.

The day's row is sealed. Writes that try to touch it should be no-ops with a `[plan/seal] skipped immutable day YYYY-MM-DD · reason=<completion-source>` log line, not silent failures and not loud errors.

## Adjacent rule · adjustments to TODAY and forward

Plan rebuilds, rule sweeps, and doctrine updates are still allowed for:

- Today's planned day BEFORE a run is logged (it's not completed yet).
- Any future planned day (no completion can exist).
- Archived rows (mark a plan archived and create a new one · the archived snapshot is immutable on its own terms).

The only thing the new rule blocks is **mutating a row tied to a real run after the fact**.

## What backend code paths need this guard

Best-guess list of code that may currently write `plan_workouts` retroactively:

- `lib/plan/generate.ts` and its rebuild entry points (mid-block rebuild, post-race auto-graduate, drift-driven rebuild).
- `lib/plan/auto-rebuild.ts`.
- Whatever path fires from the daily `plan-drift` cron when it picks up a VDOT delta.
- Manual admin endpoints (audit-coach-intents, recompute-runs, etc.) that touch plan rows.
- Any future "doctrine rule 12 retro" sweep that walks historical weeks.

Each of these should call a shared `assertDayIsMutable(date_iso, user_uuid)` before any UPDATE / DELETE on a `plan_workouts` row, and skip the row if it returns false.

Pseudocode for the guard:

```ts
async function assertDayIsMutable(userId: string, dateIso: string): Promise<boolean> {
  const completed = await pool.query(
    `SELECT 1 FROM runs
      WHERE user_uuid = $1
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2
        AND NOT (data ? 'mergedIntoId')
      LIMIT 1`,
    [userId, dateIso],
  );
  return completed.rowCount === 0;
}
```

For a stricter version, also check `coach_intents` for `watch_completion` on that date — covers the case where the watch payload landed but the Strava row hasn't merged yet.

## Test plan

A bench / sim that catches regressions:

1. Author a plan with a Wed long-run prescribed at 12 mi.
2. Simulate a run completion for Wed at 10 mi.
3. Run any rule sweep or rebuild that would normally update Wed's `distance_mi`.
4. Assert: `pw.distance_mi` is unchanged. Asset: a `[plan/seal]` log line was emitted.

Repeat for each of `type`, `pace_target_s_per_mi`, `hr_target_bpm`, `workout_spec`, `sub_label`.

## What this does NOT block

For clarity, the rule applies to PRESCRIPTION fields only. The backend may still write to a completed day's row for:

- `actual_distance_mi`, `actual_pace_s_per_mi`, `actual_hr_avg`, etc. — these are *measured*, not prescribed.
- Coach-derived analysis fields (any new column you add later that describes the run as executed).
- The `completed_at` / `notes` / similar metadata.

The rule is: don't change what the runner was supposed to do, after the fact. Recording what they actually did is fine and expected.

## Why this matters · doctrine framing

The post-run hero, the run-detail page, the activity feed, every retro surface — they all rely on the assumption that "what the plan prescribed for that day" is fixed at the moment the runner completed it. When that assumption breaks, every retro surface starts lying:

- Post-run badge says OFF PLAN when the runner did exactly what was asked.
- Run-detail VDOT computation reads the new pace target, not the one in effect when the runner trained.
- Adapt-text generation references a "from" that didn't exist for the runner.
- Honest retros become impossible because there's no "as of when the run happened" snapshot.

Sealing the row is cheaper than maintaining a separate prescribed-at-execution-time snapshot.

## Open question (small)

Should an admin/agent be allowed to override the seal in a one-off "this run was misclassified" case (e.g., runner logged a tempo as easy and wants to retroactively retag)? My recommendation: yes, but only via an explicit `unseal` admin endpoint that takes a reason and writes a `plan_unseal_audit` row. Default behavior is sealed. Manual override is the exception.

Up to you on whether to ship that escape hatch in v1 or wait until a real case comes up.
