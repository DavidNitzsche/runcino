# STATE-AUDIT FIXES — GATED DATA OPERATIONS

**Status: AWAITING PER-STATEMENT GO.** Code fixes change future behavior; these statements repair the data at rest. Per deployment doctrine, every statement here needs David's explicit go before execution. Each is reversible (inverse shown) and verified-row-count-guarded.

---

## OP-1 · Active plan race row: 6:47 → 6:52 (Tier 1.1)

The code fix makes every future plan generate race day at goal pace. David's ACTIVE plan (`pln_ca91f252bba50c74`) already has the row stored with 407 s/mi (6:47) and spec band 397–412 / hr_cap 154. Field-level update (Rule 6 — never full-replace the jsonb):

```sql
UPDATE plan_workouts
   SET pace_target_s_per_mi = 412,
       workout_spec = jsonb_set(jsonb_set(jsonb_set(workout_spec,
         '{pace_target_s_per_mi_lo}', '407'),
         '{pace_target_s_per_mi_hi}', '417'),
         '{hr_cap_bpm}', '162')
 WHERE plan_id = 'pln_ca91f252bba50c74'
   AND type = 'race'
   AND date_iso = '2026-08-16'
   AND pace_target_s_per_mi = 407;   -- guard: only the unfixed row
-- EXPECT: UPDATE 1
```

- 412 = round(5400 / 13.1) — goal pace. Band 407–417 (−5/+5). hr_cap 162 = LTHR (HM races at 96-100% LTHR, Research/08 §6.1; old 154 = 0.95× would alarm all race).
- **Reverse:** same statement with 407 / 397 / 412 / 154.
- Note: the watch already paces race day at goal pace via the race-killer F3 fix (build-workout overrides from race meta); this aligns the stored row so web/iPhone plan surfaces and any spec consumer agree.

## OP-2 · Race-week tune-up: Aug 11 easy 3 → 4×1km @ race pace (Tier 2.2)

Generator now schedules this for future plans (T-5, Research/08 §9.3). The active plan's Aug 11 row predates it:

```sql
UPDATE plan_workouts
   SET type = 'race_week_tuneup',
       distance_mi = 5,
       is_quality = true,
       pace_target_s_per_mi = 412,
       sub_label = '4×1km @ race pace · 90s jog',
       notes = 'Race-pace primer, 5 days out. Hold goal pace, even reps, stop at 4. Confidence check, not a workout. Pass: reps at 6:52/mi with avgHr <= 158.',
       workout_spec = '{"kind":"threshold","warmup_mi":1.5,"rep_count":4,"rep_distance_mi":0.62,"rep_pace_s_per_mi":412,"rep_rest_s":90,"cooldown_mi":1.0,"lthr_bpm":162}'::jsonb
 WHERE plan_id = 'pln_ca91f252bba50c74'
   AND date_iso = '2026-08-11'
   AND type = 'easy';   -- guard: only if still the easy row
-- EXPECT: UPDATE 1
```

- **DIVERGENCE FLAG:** the handoff brief said "Aug 13 or 14, 3.5 mi @ T." Aug 14 is the rest day (T-2) and Aug 13 is T-3 — both inside the freshness window Research/08 §9.3 protects. Doctrine places the race-prep session at T-5 (Tue Aug 11 for a Sunday race): 4×1K @ HMP w/ 90s jog. Engine-must-match-research is locked doctrine, so this proposes Aug 11. If you want the brief's version instead, say so and I'll re-cut the statement for Aug 13 @ 3.5 T.
- Pass criterion 158 bpm = round(LTHR × 0.975). Race-week total goes 29.1 → ~31.1 mi.
- **Reverse:** restore `type='easy', distance_mi=3, is_quality=false, pace_target_s_per_mi=NULL, sub_label='EASY', notes='Conversational. Strides optional.'` (original spec was the stale easy band; better to rebuild via buildWorkoutSpec if ever reverted).

## OP-3 · Gun time — NO SQL NEEDED

The race detail page's **Gun chip is inline-editable** (commit 13144c86, today). Tap it on the AFC page and enter the official start time (AFC Half starts **7:00 AM** per the event's standard schedule — confirm against your registration email). The conditions engine + execution plan read `meta.startTime` from there. Everything downstream (start-hour forecast, warm-up clock times) lights up on its own.

## OP-4 · Strava re-push (May 31 ×2 → one run, Jun 8) — AUTOMATIC AFTER DEPLOY

The push-poll cron now auto-retries terminal-failed pushes (≤3 total attempts per run, REAUTH excluded, duplicate-safe). On the first cron pass after deploy, the May 31 and Jun 8 runs re-push themselves. **Deploying the code IS the GO for this** — flag here so it's explicit: two historical runs will appear on your Strava within ~15 minutes of the merge, titled per your push settings. If you'd rather they stay off Strava, say so and I'll add a skip for rows older than N days.

## OP-5 · Shoe repairs (Tier 2.4) — NEEDS YOUR GROUND TRUTH

Three defects, three proposals. **Answer the two questions before any statement runs:**

**Q1 — Are shoes id 1 and id 6 the same physical pair?** Both "New Balance SC Trainer v3"; id 1 has stored 15.17 mi / 1 assigned run; id 6 has 79.71 / 2 runs.
- If SAME pair → merge: `UPDATE runs SET shoe_id = 6 WHERE shoe_id = 1; UPDATE shoes SET mileage = 92.11 WHERE id = 6; UPDATE shoes SET retired = true, notes = 'merged into #6 (duplicate entry)' WHERE id = 1;` (EXPECT: 1, 1, 1)
- If TWO pairs → no merge; optionally rename one ("SC Trainer v3 · B") for disambiguation.

**Q2 — Nike Zoom Fly 6 (id 4): is 150 the lifetime mileage you typed in when adding it?** Stored mileage 150 with baseline_mi 0 and only 8 assigned miles is bookkeeping-incoherent.
- If yes → `UPDATE shoes SET baseline_mi = 142 WHERE id = 4 AND baseline_mi = 0;` (mileage 150 = 142 baseline + 8 tracked ✓) (EXPECT: 1)

**Vomero Plus (id 5):** stored 13.64 mi, zero assigned runs → `UPDATE shoes SET baseline_mi = 13.64 WHERE id = 5 AND baseline_mi = 0;` makes it coherent (EXPECT: 1).

**Also still queued from the shoe-deploy session:** Item 16-B backfill (~10 watch runs with null shoe_id) — those UPDATE statements were to be shown for per-statement go after the auto-assign falsifier passed. Jun 9's run got an auto-assignment (falsifier passed); the backfill list can be generated on your go.

## OP-7 · Strength plan-row batch — WITHDRAWN (architectural)

Phase 2 investigation killed this op before it was cut: `glance-state.ts` (and the watch/today + adapt readers) collapse plan rows into a **last-row-wins map keyed on date** — inserting a second same-date `strength` row would shadow the day's RUN across the week strip, Today, and the watch payload. Putting strength rows into `plan_workouts` safely needs a one-per-day-reader sweep first (its own session).

Shipped instead, zero DB writes: the existing strength recommender (already 2×/wk, race-week-zero, taper-aware, readiness-gated) now carries **session content** on every pick (Research/07 templates — Session A hips/posterior, Session B single-leg/core, mobility variant), so the Today chip can finally answer "what do I actually do for 20 minutes." Same surfaces, real prescription.

## OP-6 · NOT proposed (deliberately)

- **Easy-band refresh on the active plan** (stored 7:47–8:37 vs doctrine 8:30–9:10): the HR cap 144 is the honest governor on every easy card, the bands self-correct on the next plan generation/rebuild, and rewriting 40+ future workout_specs by hand multiplies risk for a number the watch doesn't enforce. If you want them refreshed anyway, the right tool is a small recompute script through buildWorkoutSpec — say the word.
- **VO₂ 62.3 display clamp** — needs a product decision (clamp vs label), parked in the recap.

---

*Every statement above runs in a transaction with the row-count check; mismatch → ROLLBACK and report.*
