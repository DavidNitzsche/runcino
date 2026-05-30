# System Audit · 2026-05-30 · Full-auto Simulation Pass

**Scope.** Run simulations across every major system path. Find holes,
fix what's auto-fixable, queue what needs David's input. Push each fix
to main. Repeat.

---

## Status

| Sim | Subject | Status | Headline finding |
|---|---|---|---|
| SIM-01 | New user onboarding completeness | ✓ done | Most paths complete; RPE capture path missing in web-v2 |
| SIM-02 | Plan library coverage | ✓ done | Race-prep generator solid; gaps in 5K/10K differentiation + experience-level scaling |
| SIM-03 | Race priority lifecycle | ✓ fixed | POST /api/race was defaulting to 'C' → changed to 'A' |
| SIM-04 | Pre/post run data loop | ✓ done | Pre-run prescription works; **post-run RPE capture NOT implemented in v2** |
| SIM-05 | Sync dedup (Strava / Apple Health / watch) | ✓ fixed | Strava webhook didn't call autoMergeForDate → added |
| SIM-06 | Plan adaptation triggers | ✓ done | 4 triggers wired; niggle / sick / race-add not wired |
| SIM-07 | Doctrine alignment | ✓ done | Only 24 Research citations in web-v2 vs 122 in legacy/web; citation strings include non-canonical filenames |
| SIM-08 | Cold-start coach behavior | ✓ fixed (P0) | Cross-user data leak — new users were getting David's plan. Fixed across 14 query sites. |

---

## P0 fixes shipped

### Cross-user data leak (SIM-08, commit `40710ca`)

**Symptom.** A fresh user with no rows in their UUID was getting David's
training plan returned by the state-loader's plan-lookup query, because
the read pattern was `WHERE (user_uuid = $1 OR user_id = 'me')` — the
`OR user_id = 'me'` clause matched David's legacy row regardless of
whether `user_uuid` was set on it.

**Fix.** Verified all of David's rows now have `user_uuid` set (1
lingering plan was backfilled), then dropped the `OR user_id = 'me'`
fallback in 14 query sites. State-loader / glance-state / training-state
/ race-header / log-state / run-state / profile-state / watch /
plan-generate / plan-seed-maintenance / plan-week / plan-workout /
cron-snapshot-projections / coach-proposal / admin-backfill-workout-spec.

**Verification.** Re-ran SIM-08 — cold-start user now returns
`{plan: null, race: null, profile: null, prefs: null}` ✓.

**Safe fallback patterns kept.** `state-loader.ts:21`, `settings.ts:32`,
`profile-state.ts:84` already used the safer
`user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')` pattern with
the `IS NULL` guard. Those were left untouched. `cron/keep-warm` keeps
its explicit owner-sweep.

### Strava webhook dedup gap (SIM-05, this commit)

**Symptom.** Strava webhook upserts an activity but doesn't call
`autoMergeForDate(userId, date)`. If the runner also has a HKWorkout
ingest row or a watch completion for the same run, they'd see two rows
until something else triggered a dedup pass.

**Fix.** `upsertStravaActivity` now returns the activity's date; the
webhook handler calls `autoMergeForDate(userId, date)` after each
upsert. Idempotent — no-op when nothing matches.

### Race priority default (SIM-03, this commit)

**Symptom.** POST /api/race defaulted `priority` to `'C'` (low-priority
training-effort) when caller omitted the field. Onboarding flows passed
`'A'` explicitly so this didn't bite there, but manual API additions or
future client code paths would silently downgrade goal races.

**Fix.** Changed default to `'A'`. Locked 2026-05-30. Use `'B'` for
tune-ups and `'C'` for training-effort; both require explicit caller
intent.

---

## P1 findings · documented + queued

### SIM-02 · Plan library gaps

The race-prep generator (`lib/plan/generate.ts`) is solid for HM/M but
has these gaps:

- **No experience-level scaling.** `profile.experience_level` is NOT
  read by the generator. A beginner and an advanced runner with similar
  recent volume get the same 7%-ramp / 85%-cutback / quality structure.
  Beginners should ramp more conservatively (5%/wk) and get fewer
  quality days per week.
- **No 5K/10K-specific block adjustment.** `isMarathon = raceDistanceMi >= 20`
  is the only differentiation. 5K and 10K plans get the same structure
  as half. 5K plans should have shorter base + more VO2max work; 10K
  more tempo emphasis.
- **Volume floor fixed at 15 mpw.** `Math.max(15, baseMi)` makes any
  plan start at ≥ 15 mpw. A true beginner running 8 mpw would get a
  >85% jump in week 1. Should scale floor by experience_level (beginner:
  10, intermediate: 15, advanced: 20, advanced_plus: 25).
- **Quality types hardcoded.** `'6×800m @ I pace'`, `'3×1mi @ T pace'`,
  etc. No VDOT-derived rep distance or pace. Comment says paces come
  from CoachState at iPhone briefing time — but the structure itself
  is fixed regardless of VDOT.
- **Maintenance generator is separate.** `seed-from-onboarding.ts`
  duplicates phase / volume / day logic. Worth extracting a shared
  `lib/plan/core.ts` so doctrine changes don't need two-file edits.

### SIM-04 · Post-run loop gaps

The closed loop (prescribe → run → recap → coach reads) has working
parts:
- ✓ Pre-run: `/api/watch/today` returns prescription with `workout_spec`
- ✓ Watch completion: `/api/watch/workouts/complete` → `workout_completions` + autoMerge
- ✓ Strava webhook: now wired with autoMerge (see SIM-05 fix above)
- ✓ Run recap: `/api/runs/[id]` reads strava_activities + workout_completions

But:
- ✗ **No web-v2 RPE capture route.** The schema has `post_run_rpe` (1 row
  for David from legacy) and `workout_rpe` (2 rows, legacy global). The
  legacy `/api/activity/rpe` exists but is NOT in web-v2/app/api.
  Result: the iOS post-run RPE capture surface has nowhere to POST.
  *Recommended fix: port `legacy/web/app/api/activity/rpe/route.ts` →
  `web-v2/app/api/runs/[id]/rpe/route.ts`.*
- ✗ **No "how did the workout feel?" reply-chip path.** The check_ins
  table is generic; topics with kind=run_recap could carry an RPE chip
  but the writer doesn't exist.
- ✗ **runner_notes never written.** Schema is ready (free-text journal)
  but no UI/API to capture.

### SIM-06 · Plan adaptation triggers

`lib/plan/adapt.ts` has 5 trigger kinds:
- ✓ MISSED_KEY_WORKOUT (threshold/intervals not completed within ±1d)
- ✓ RHR_SPIKE (3-day RHR avg > 7 bpm above 14d baseline)
- ✓ SLEEP_CRATER (2+ nights < 5h)
- ✓ VOLUME_OVERSHOOT (last 7d > 25% above experience-level cap)
- ✓ PR_BANK (listed but NOT in `detectAdaptations()` — orphan)

Missing triggers (system has the schema to detect them):
- ✗ **NIGGLE_REPORTED** — `niggles` rows with severity ≥ 5 should
  downgrade the next quality session. Coach doctrine: stop or modify
  based on niggle progression. Not wired.
- ✗ **SICK_EPISODE_ACTIVE** — `sick_episodes.cleared_at IS NULL` should
  trigger ILLNESS mode (the schema has a `runner_illnesses` table for
  this). The "above-the-neck no fever" rule needs an applier.
- ✗ **GOAL_CHANGED** — when `users.vdot_last_reviewed` shifts > 2 pts,
  paces should refresh across the plan. Half-implemented via
  `vdot_shift_dismissed_at` / `vdot_shift_snoozed_at`.
- ✗ **RACE_ADDED** — POST /api/race fires `bustBriefingCacheForEvent`
  but doesn't kick a `generatePlan` for the new race when it's an A.

### SIM-07 · Doctrine citation gap

**Counts (citations per file):**
- `web-v2/lib`: 24 citations across 6 Research files
- `legacy/web/lib + coach`: 122 citations across 22 Research files

**Top cited in legacy** (where web-v2 is missing most of these):
- `Research/00a-distance-running-training.md` · 35 refs
- `Research/00b-recovery-protocols.md` · 30 refs
- `Research/01-pace-zones-vdot.md` · 17 refs
- `Research/08-pacing-and-race-week.md` · 12 refs
- `Research/02-race-time-prediction.md` · 6 refs

**Never cited in either:**
- `Research/05-injury-return-protocols.md` — needed when an injury is
  active. Currently no INJURY-mode code path.
- `Research/13-sex-specific-training.md` — `users.sex` is read but no
  doctrine applied
- `Research/14-age-considerations.md` — age is read but no
  decade-by-decade adjustment
- `Research/17-footwear.md` — shoes table exists but no doctrine
  citations for shoe rotation rules
- `Research/18-fueling-products.md` — `users.fuel_*` columns exist
  but `lib/training-fueling.ts` (legacy) has only 2 citations

**Non-canonical filenames in citations (SIM-07 spot-check):**
`lib/plan/adapt.ts` cites `Research/05-readiness-and-recovery.md` and
`Research/03-pacing-and-zones.md` — neither file exists. Canonical:
`05-injury-return-protocols.md`, `03-heart-rate-zones.md` (or
`00b-recovery-protocols.md` for the original intent). Worth a citation
audit + fix.

### SIM-01 · Onboarding completeness

The Lilian onboarding (`/api/onboarding/complete`) writes:
- ✓ `profile` (full_name, timezone, goal_race_*, history_*, tt_goal_*)
- ✓ `races` (if race path)
- ✓ `training_plans` + child rows (via `generatePlan` or
  `seedMaintenancePlanFromOnboarding`)

Does NOT write:
- ✗ `user_prefs` — relies on lazy default in `loadSettings`. Plan
  generator handles missing prefs by defaulting to Sun/Tue+Thu/Sat;
  works but means the first plan never reflects a runner who'd want
  Sat/Mon+Wed/Sun until they touch Settings.
- ✗ `users.timezone` — even though onboarding asks for it, the body
  payload writes to `profile.timezone` only. `users.timezone` (the
  canonical column per the data plan) stays null. Two-place split.

---

## Open questions for David

See [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

---

## Up next (queued)

1. Port `/api/activity/rpe` from legacy → web-v2 so the iOS post-run
   RPE capture has somewhere to land.
2. Add NIGGLE / SICK / RACE_ADDED triggers to `lib/plan/adapt.ts`.
3. Wire `users.timezone` from onboarding body (currently only writes
   to `profile.timezone`).
4. Citation audit pass: fix non-canonical Research file paths.
5. Plan library: parameterize 5K/10K/HM/M templates and add an
   experience-level multiplier.
6. Extract shared plan-builder primitives into `lib/plan/core.ts`.
