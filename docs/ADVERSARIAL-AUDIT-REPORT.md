# ADVERSARIAL AUDIT — Will this app fail David on August 16?

_Session 2026-06-09. Fully adversarial, read-only (DATABASE_URL_RO + code reads; zero writes except this file). Method: assume every number is wrong until reproduced from first principles. Every headline claim below was recomputed against production data with the exact formulas from the shipped code (replica scripts: `web-v2/scripts/_adv_audit_*.mjs`). File:line references were opened and read this session unless marked (agent), which came from systematic Explore-agent sweeps and are reliable to within a few lines._

**Subject:** David, advanced, LTHR 162 / HRmax 181 / RHR 52, Pacific. A-race **AFC Half, Sun Aug 16 2026, 68 days out, goal 1:30 (B 1:37)**. Active plan `pln_ca91f252bba50c74` (11 weeks, Jun 1 → Aug 16). Displayed today: VDOT 47.9 · HM projection 1:34:54 · gap 4:54 · TSB −25.

**Severity scale:**
- 🔴 **RACE-KILLER** — would change what happens on Aug 16 (wrong pace, wrong decision, broken morning)
- 🟠 **MAJOR** — would cause a wrong decision during the build, or wrong data race week
- 🟡 **MINOR** — friction, confusion, or latent risk

---

## THE TOP TEN (read this if you read nothing else)

| # | Finding | Severity | When it bites |
|---|---|---|---|
| F1 | **VDOT anchor expires Aug 1** — Disney (Feb 1) exits the 180-day window; VDOT drops 47.9 → 44.1 overnight, projection 1:34:54 → **1:41:55**, 15 days before the race. No training run can rescue it. | 🔴 | Aug 1, peak of taper anxiety |
| F2 | **"1:30" goal string parses as 90 seconds** on both race-day surfaces. iPhone race-morning splits: 5K "0:21", B-goal "8:30", goal pace "0:07/mi". Web hero: same. This code path renders for the first time ever on race morning. | 🔴 | 5:00 AM Aug 16 |
| F3 | **Watch race face targets 6:45/mi** (mid of spec band 397–412), 7 s/mi faster than goal pace and 29 s/mi faster than fitness pace. Tolerance ±12s means 6:57 already reads "slow". | 🔴 | Mile 1 of the race |
| F4 | **No race-day suppression on readiness/health actions.** A single bad HRV night produced "38 PULL-BACK" + pull-back prescriptions in production on Jun 8 (from a 29 ms partial reading later corrected to 46). The same fires on race morning. | 🔴 | 5:00 AM Aug 16 |
| F5 | **Watch refuses to start an expired workout** (payload TTL 14h). Phone dead / no signal at the corral + last sync > 14h → the watch will not start the race workout, discovered at the start line. | 🔴 | 6:50 AM Aug 16 |
| F6 | **The race-day wake notification can never fire.** It needs a cron tick 05:30–05:45 PT; the notifications workflow has zero ticks 00:00–06:59 PT. Dead code with a gun-time reminder in it. | 🟠 | 5:30 AM Aug 16 |
| F7 | **Displayed TSB −25 carries a −10 bootstrap artifact** (EWMA seeded from zero over a 60-day window; CTL reaches only 76% of steady state). True TSB ≈ −15. Label shifts a band pessimistic. | 🟠 | Every day, now |
| F8 | **Long-run HM finish segments demand goal pace (6:52) for 9–10 mi** — faster than his current open 10-mile race effort — while tempo plateaus at 6:59. The hardest sustained pace of the week is buried inside the long run, and the plan was authored with `bestRecentVdot = null`. | 🟠 | Jul 12–Aug 2, the make-or-break block |
| F9 | **Recent race evidence contradicts the 47.9 headline.** Sombrero Half May 3, full effort (avgHr 162.7 = LTHR): **1:40:57** = VDOT 44.8, excluded as priority C. LA Marathon Mar 8: 44.1. The 47.9 is a 128-day-old anchor; everything since says 44–45. | 🟠 | Every pacing decision |
| F10 | **Per-phase execution is stored nowhere.** `runs` rows carry no `phases`; `workout_completions` died May 25 (10 rows ever). Nobody — not the coach, not the VDOT engine, not this audit — can verify whether the 4 mi @ T was actually run at T. | 🟠 | Silently, all build long |

---

# ATTACK VECTOR 1 — THE NUMBERS LIE

## 1.1 VDOT 47.9 — proven, and proven fragile

**What produced it.** `projection_snapshots` (2026-06-09): `vdot=47.9, projection_sec=5694, source=cron-daily`. The anchor is the **Disney Half Marathon, 2026-02-01, 1:34:54 (5694 s) at 13.109 mi**, priority A (`races.actual_result.finishS=5694`).

**Formula check.** `lib/training/vdot.ts:31-53` implements Daniels exactly: `VO2 = −4.6 + 0.182258·v + 0.000104·v²` (v in m/min), `%VO2max = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t)` (t in min), VDOT = VO2/%. Recomputed independently for every race in the table:

| Race | Date | Result | Recomputed VDOT | Eligible? |
|---|---|---|---|---|
| Rose Bowl Half | Jan 18 | 1:38:38 @ 13.109 | 45.848 → 45.8 | A ✓ (window) |
| **Disney Half** | **Feb 1** | **1:34:54 @ 13.109** | **47.944 → 47.9** | **A ✓ — current anchor** |
| LA Marathon | Mar 8 | 3:31:40 @ 26.219 | 44.133 → 44.1 | A ✓ |
| Big Sur | Apr 26 | 3:36:55 @ 26.2 | 42.813 | priority `hilly-excluded` → SQL drops it (`vdot-inputs.ts:104` takes only `IN ('A','B')`) |
| Sombrero Half | May 3 | 1:40:57 @ 13.16 | 44.845 | priority C → excluded |

The formula is correct, the inversion is correct (`predictRaceTime(47.9, 13.1) = 5694 s = 1:34:54` — round-trips to the input), and the displayed number is faithfully computed. **The number is right. The number is also four months old.**

**F9 🟠 — The anchor no longer describes the runner.** Every race since Feb 1 computes 42.8–45.8. Sombrero (May 3) was a true race effort — avgHr 162.7, exactly his LTHR, mile splits on file — and it says 44.8 *five weeks ago*, not 47.9. The system's "best race in 180 days, highest wins" doctrine guarantees the headline only ratchets down when anchors *expire*, never when newer slower evidence arrives. Two marathons and a C-half later, the app still pitches fitness off a February peak.
- **Severity:** 🟠 — every pace target, projection, and gap message inherits the optimism.
- **Probability:** certain (it is the current state).
- **Detection:** David cannot see it. The Targets page shows 47.9 with no anchor age. (`vdot_anchor_date` exists in `projection_snapshots` but both anchor columns were empty in every row inspected.)
- **Fix:** show the anchor ("47.9 · Disney Half · Feb 1 · 128 days old") wherever VDOT renders; weight recent sub-threshold race evidence into a confidence band rather than discarding C-races entirely.

**F1 🔴 — The Aug 1 cliff.** `bestRecentVdot` cutoff = today − 180 days (`vdot.ts:259`). Simulated through race week with production data and the exact run-candidate SQL (`vdot-inputs.ts:180-219`):

```
2026-07-31: VDOT 47.9 (Disney) → HM proj 1:34:54
2026-08-01: VDOT 44.1 (LA Marathon) → HM proj 1:41:55   ← Disney exits the window
2026-08-16: VDOT 44.1 → 1:41:55 (race morning)
```

Overnight on Aug 1 the projection lurches **+7:01** with zero change in fitness. Run candidates cannot rescue it: a training run only qualifies if ≥4 mi AND (quality type OR avgHr ≥ 80% HRmax), it is scored on **whole-run average pace** (WU/CD jog included), and it carries a −1 sort penalty (`vdot.ts:297`). His actual qualifying runs in the last 30 days compute VDOT 35.5–41.1 (best: 41.1, May 12). A diluted tempo run can never out-rank 44.1.

Race-week consequences, all verified in code:
- The **race-day hero** (web `TodayView.tsx:4420`) prints "Fitness reads {projected}" — on Aug 16 that is **"Fitness reads 1:41:55 · +11:55"** on the one morning the brief says should feel reverent.
- The Targets page gap balloons 4:54 → 11:55 during taper week; "the build is written to close it" copy becomes farce.
- iPhone GOAL VDOT pill, projections table on RaceDayView, coach briefing context — all inherit 44.1.
- **Severity:** 🔴 — this lands in the most psychologically fragile week of the block and tells the runner he's lost 7 minutes. Best case he disbelieves the app (and then why trust its pacing?); worst case he panics and over-races the taper or rewrites his race plan around 1:42 fitness.
- **Probability:** certain, dated: Aug 1, absent a new A/B race result before then.
- **Detection:** he will see it; he will not know why. Nothing explains "your anchor expired."
- **Fix (pick one, all small):** (a) decay anchors smoothly (e.g., −0.1 VDOT/30d past 90 days) instead of cliff-dropping; (b) keep the best anchor until a *better-or-newer race* replaces it, flagged stale; (c) at minimum freeze projection churn inside T−14 days (race-week projection lock). Also: schedule the planned tune-up — a Jul 10K or HM time-trial would re-anchor honestly (see AV7).

## 1.2 Projection 1:34:54 — arithmetically right, semantically unlabeled

`predictRaceTime` (`vdot.ts:77-90`) binary-searches finish time whose Daniels VDOT equals the target — correct, monotonic, converges (verified by reproduction). 47.9 → 5694 s. **Margin of error:** none shown. Daniels equivalence assumes equal preparedness at the target distance, flat course, neutral weather; the app surfaces a confidence band on the Targets page but the race-day hero and snapshots print a single second-precise number from a 128-day-old anchor. Conditions that make it wildly wrong, in this exact case: anchor staleness (above), AFC's net-downhill-but-uphill-finish profile, and an August start (Mission Bay sun by mile 8 for a 1:35 runner). None of those adjust the printed number.

## 1.3 TSB −25 — reproduced exactly, and one-third artifact

**F7 🟠.** Replicated `lib/coach/training-form.ts` SQL + EWMA bit-for-bit against production runs: **CTL 41, ATL 66, TSB −25** — matches the displayed value. Constants are industry-standard (42d/7d, `training-form.ts:72-75`); stress = `distance × intensity_factor` with the plan's workout type joined **by date**; MAX-per-day dedupe.

Three defects, in descending order:

1. **Bootstrap bias.** `ctl = 0; atl = 0` seeded at day −60 (`training-form.ts:176-178`). A 42-day EWMA fed 60 days reaches 1 − e^(−60/42) = **76%** of steady state; the 7-day ATL reaches ~100%. CTL is structurally ~24% low, so TSB is structurally negative. Re-ran the identical pipeline with a 180-day window: **CTL 51, ATL 66, TSB −15**. The displayed −25 ("LOADED", brushing OVERREACH at −30) is really −15 (mid-LOADED). David reads "borderline overreached" when he is in normal productive overload. The same bias built `tsbAtStart: −21` into the active plan's authored state.
2. **Plan-rest-day zero-stress hole.** Workout type comes from `plan_workouts` joined by date (`:153-161`); a run on a planned rest day gets `INTENSITY_FACTOR.rest = 0.00` → an entire run contributes **zero stress**. Swap Sunday's long to Saturday and the long run vanishes from CTL/ATL. Checked his last 60 days: hasn't fired yet (he's been date-faithful) — latent, will fire the first time life forces a shuffle.
3. **What −25 means for Aug 16: nothing bad — if he tapers as written.** Forward-simulated the EWMA through the plan: TSB crosses 0 around Aug 9, **+11 by Aug 13, +20 on race-eve Aug 15** — textbook race-ready (+10..+25). So the taper architecture is sound; the bias mostly washes out by then (shipped +20 vs unbiased +22, because by August the 60-day window contains only real data).

- **Severity:** 🟠 now (mislabels today's state a full band low; feeds the plan generator and readiness LOAD pillar), 🟡 by race week.
- **Probability:** certain (artifact is structural).
- **Detection:** invisible — both numbers look plausible.
- **Fix:** seed the EWMA from the first 18 days of the window (or extend the bootstrap window to ≥120d and report the first 42 days as warm-up); join plan type by *matched workout* not date, falling back to HR/distance inference when the plan day was rest.

## 1.4 The gap "4:54" — real subtraction, fictional decomposition

`TargetsView.tsx:73`: `gapSec = fitSec − goalSec` = 5694 − 5400 = **294 s = 4:54** ✓. But the prompt's premise — FITNESS + CONDITIONS + COURSE + EXECUTION summing to 4:54 — **does not exist as a computation**. `projection-levers.ts:65-71` declares that shape; `conditions` is only modeled for hardcoded multi-wave race slugs, and `course`/`execution` are not computed anywhere (agent-verified, grep-confirmed: no producer writes those fields). The gap is one subtraction plus narrative copy.
- **Severity:** 🟡 (honest single number; the unimplemented decomposition just shouldn't be implied anywhere in UI copy). One real consequence: with no COURSE term, **nothing anywhere adjusts the 1:30 plan for AFC's profile** — splits are computed flat (see AV3).
- **Fix:** either ship the conditions/course terms for AFC specifically (one race, known profile, August climatology) or delete the levers scaffolding until it's real.

---

# ATTACK VECTOR 2 — THE PLAN FAILS

Pulled all 77 workouts of the active plan. Planned weekly volume:

```
wk1 Jun 1   44.6        wk7  Jul 13  59.5  (+30.8% over cutback wk6, +7.2% over prior high)
wk2 Jun 8   45.5 (+2%)  wk8  Jul 20  64.5  (+8.4%)  ← PEAK · long 19mi w/ 10 @ HM
wk3 Jun 15  45.5 (0%)   wk9  Jul 27  55.5  (−14%)
wk4 Jun 22  49.5 (+8.8%) wk10 Aug 3  46.0  (−28.7% from peak · 2× tempo 4mi @ T)
wk5 Jun 29  55.5 (+12.1%) wk11 Aug 10 16.0 + race  (4/3/4/3/rest/2-shakeout/RACE)
wk6 Jul 6   45.5 (−18% cutback)
```

## 2.1 The ramp — aggressive at two joints, and big in absolute terms

The prompt's "week 7 peak 64.5" is week_idx 7 = the Jul 20 week — confirmed. Ramp verdict:
- Week-over-week breaches of 10%: **wk4→5 (+12.1%)** and the **post-cutback wk6→7 (+30.8%)**. The second is partially excused by the cutback (vs. the prior *high* it's +7.2%, which is defensible "new-high" progression).
- The absolute jump is the bigger risk: the plan's own `derived_from` says recent weekly volume was **39.1 mi** (Jun 3 authoring) — wk1 starts at 44.6 (+14% instantly) and peaks at 64.5, **+65% over his trailing average, with the peak just 7 weeks after the start.** For an advanced runner with 45–50 mpw history this is fine; for a runner whose trailing 4 weeks were 27.5–39.1 (both authoring snapshots), 64.5 with a 19-mile long run is the injury-risk zone. `plan/validate.ts` caps single WoW jumps and long-run peaks (agent-verified: HM long cap 14–20 by tier, 30–50% WoW guard) — all individually passed, but no rule checks **peak vs. trailing-actual** ratio.
- **No week is flagged `is_peak`** (all 11 rows false) and the only structural cutback (wk6) has `is_cutback=false` — any UI badge keyed on those flags never renders.
- **Adaptivity:** `archived_iso`/`adaptation_log` machinery exists, `run-adaptations` cron exists (agent), and plan mutations are supported — but nothing in the plan or code path auto-downgrades wk8 if wk7 execution cracks. If David can't complete week 7, the plan prescribes week 8 anyway. The drift monitor flags VDOT drift ≥2 pts against the **plan anchor** — which is `null` for this plan (authored pre-C1 with `bestRecentVdot=null`), so that tripwire is likely inert.
- **Severity:** 🟠 · **Probability:** possible (he's executing well now — 45.8 actual vs 44.6 planned last week) · **Detection:** he'd feel it before the app says it · **Fix:** add peak-vs-trailing-28d validation; honor the is_peak/is_cutback flags or delete them; gate wk8 on wk7 completion ratio.

## 2.2 The taper — right shape, wrong final week intensity

- Volume: 64.5 → 46.0 (−28.7%) → 16.0 pre-race (−75% from peak). Squarely inside the standard 20–30% / 40%+ HM taper. ✓
- Intensity: wk10 keeps **two** 4 mi @ T tempos (Aug 4, Aug 6 — arguably one too many, 10 days out) — then **race week has zero quality**: easy 4/3/4/3, rest Fri, 2 mi shakeout Sat. No strides, no 2×1 mi @ HMP Tuesday touch-up. Ten days with nothing faster than easy pace before a goal race is the classic "flat legs" taper error; every standard prescription (Daniels, Pfitzinger, and `Research/08-pacing-and-race-week.md` §taper which the plan itself cites) keeps short race-pace touches in race week.
- The Aug 15 shakeout (day before) is correct. Aug 14 full rest two days out is a defensible choice.
- **Severity:** 🟠 · **Probability:** certain (it's written) · **Fix:** swap Aug 11 easy 3 → 3 mi w/ 4×30s strides; add 2×1 mi @ HMP inside Aug 12's 4-miler.

## 2.3 The HMP finish segments — right pace math, wrong pace *source*, impossible as written

Jul 19 verbatim (`plan_workouts` row `wko_9dcc3044b166b9a6`): 17 mi long, spec `finish_mi: 9, finish_pace_s_per_mi: 412, finish_label: HM`, easy band 462–497, `hr_cap_bpm: 144`, `fuel_mi: [5,9,13]`.

- **HMP arithmetic ✓:** 412 s/mi × 13.109 = 1:30:01 — 6:52/mi is the correct 1:30 pace (prompt's claim verified).
- **HR ✓ (after the Jun 7 fix):** `build-workout.ts:474-482` suppresses the 144 ceiling when `finish_mi > 0`, so the watch won't red-alert through the finish. The phases split correctly into easy-build → FINISH face (`expand-spec.ts:223-249`).
- **🟠 Internal contradiction, three ways:** the row's `notes` say *"Steady 10mi, then 7mi at half-marathon pace"*, `sub_label` says **9 mi @ HM**, `original_sub_label` says 7. The sub_label was corrected by hand (Item 5 fix); the prose wasn't. The iPhone shows the notes; the watch executes the spec (8 easy + 9 @ HM). David will discover at mile 8 that the app disagrees with itself about when the hard part starts — mid-long-run, headphones on.
- **🔴-adjacent coaching error — the pace is goal-anchored, not fitness-anchored.** The tempo ladder ramps honestly (442 → 437 → 433 → 428 → 424 → 419, plateauing at 6:59); the finish segments jump straight to **goal pace 412 from Jul 12 onward and never ramp**. Two consequences: (1) **inversion** — from Jul 7 the plan's "T pace" (419) is *slower* than its long-run finish pace (412), upside-down physiologically (T should be ≈ HM − 5s); (2) **impossibility** — 10 mi @ 6:52 inside a 19-miler (Jul 26) is faster than his current *open* 10-mile race effort (predictRaceTime(47.9, 10 mi) ≈ 7:05/mi — and his recent races say 44–45, making it worse). He will either blow up failing it (confidence crater, 3 weeks out, plus a junk-fatigue bomb into the TSB) or the workout silently becomes "9 @ 7:10" and every downstream surface still claims he did "10 @ HM" because nothing stores per-phase actuals (F10).
- **Is 9–10 @ HMP appropriate 3–4 weeks out at all?** The *structure* is defensible for an advanced HM build (race-specific phase, finish-on-tired-legs). The *dose* at goal pace is not, at his current fitness. Daniels-style prescriptions put HM-pace continuous segments at 4–6 mi inside long runs, or anchor them at *current* HM effort.
- **Root cause:** the active plan was authored Jun 3 with `bestRecentVdot: null` (cold-start mileage-based floor for tempos — hence the sane ramp — but goal-anchored race/finish paces). The Jun 7 regenerations that had 47.9 available were created and archived within 21 minutes — rolled back. The one plan that knew his fitness was discarded; the one that didn't is live.
- **Fix:** re-derive finish paces from current VDOT with a ramp (430 → 425 → 418 → 412 only if a tune-up confirms), or cap finish segments at `max(goal, currentHM + 5s)`; regenerate the notes from the spec (the `subLabelFromSpec` machinery already exists — extend it to prose).

---

# ATTACK VECTOR 3 — RACE MORNING, MINUTE BY MINUTE

## 5:00 AM — he wakes up. The notification didn't come.

**F6 🟠 — the race-day wake notification is unreachable code.** `app/api/cron/notifications/route.ts:310-329` enqueues Category A on race day when a cron tick lands within `[05:30, 05:45)` runner-local (`isAtLocalTime`, slack 15 min, `:253-259`). The workflow (`.github/workflows/notifications.yml:32-33`) runs `*/30 14-23` and `*/30 0-6` **UTC** — i.e., **no ticks between 00:00 and 06:59 Pacific**. 05:30 PT = 12:30 UTC = dead zone. The carefully-built race-day push — gun time, "kit on the chair", `bypass_quiet_hours: true`, time-sensitive interruption level — cannot fire, ever, for a Pacific runner. Bonus defect: the 15-minute slack assumes 15-minute polling; the workflow polls every 30, so even in-window targets in the second half of each gap are silently skipped (GitHub Actions' habitual 5–20 min cron delay makes this worse). Race-**eve** 21:00 PT = 04:00 UTC is inside the window and should fire — if Actions runs on time.
- **Fix:** add `*/30 7-13 * * *` to the schedule (one line), and widen slack to ≥ the real polling interval, or better: enqueue with `fire_at` at schedule-time the night before instead of tick-matching.

Also at 5:00 AM: the `keep-warm` workflow has the same dead zone (`14-23`,`0-6` UTC), so the first app open of race morning hits a cold Railway container. Seconds of spinner on the morning patience is shortest.

## 5:05 AM — he opens the app. The race-day surfaces render for the first time. With garbage.

Race-day mode **does trigger correctly**: web `TodayView.tsx:87` (`goal.daysAway === 0 && d.iso === goal.date && !d.done`, server-computed in runner TZ via `runnerToday` — DST-safe) and iPhone `TodayView.swift:148-153` (double gate `days_to_race == 0 || date == todayISO`; device-local date, three-way fallback). The gates are sound. What they reveal is not:

**F2 🔴 — the goal string detonates.** AFC's stored goal is `goalDisplay: "1:30"` (H:MM, no seconds — exactly how runners write goals). The shared lib parser was fixed for this on Jun 3 (`vdot.ts:145-157`, comment literally cites this exact field as the motivating bug). But **both race-day surfaces have their own private parsers that never got the fix**:
- iPhone `RaceDayView.swift:560-568`: `case 2: return parts[0] * 60 + parts[1]` → "1:30" = **90 seconds**. Race-morning render: splits card **5K "0:21" · 10K "0:43" · FINISH "1:30"**; B-goal **"8:30"** at "0:39/mi"; A-goal pace **"0:07/mi"**; fueling falls back to `90s × 1.7 gels/hr → 1 gel`.
- Web `TodayView.tsx:4326-4331` (`parseHMSToSec`, same 2-part = MM:SS assumption) → race-day hero GOAL "1:30" with **"0:07/mi"** under it and **B·SAFE "8:30"**.

This is the purest race-day landmine in the system: the data has been wrong-shaped for weeks, every *non-race-day* surface that parses it was fixed, and the two surfaces that only render on Aug 16 were not. It has never rendered in production, so no amount of daily usage will catch it before the one morning it matters.
- **Probability:** certain on current data. (If David renegotiates his goal via the Targets flow, the PATCH rewrites `goalDisplay` as "1:30:00" and defuses it by accident — `race/[slug]/route.ts:99-104`.)
- **Fix (do all three):** normalize `goalDisplay` in the DB to H:MM:SS; replace both private parsers with the shared `parseRaceTime`; add a unit test that renders RaceDayHero/RaceDayView with the literal production meta.

**The rest of the 5:05 screen, audited:**
- **GUN TIME "—"**: `races-state.ts:92` reads `meta.startTime ?? gun_time ?? start_time` — all absent from AFC meta (keys verified: date, name, location, priority, courseSlug, distanceMi, goalDisplay, distanceLabel, goalSafeDisplay). No wave either. The "RACE MORNING" card renders a dim em-dash for the single most time-critical fact of the morning, and there's no edit affordance on that card to fix it. The race-day notification template defaults to "Gun 07:00" — fabricated-by-default if it could fire.
- **Splits are flat-course splits.** `RaceDayView.swift:598-613` does `cum = r.mi / dist × goal` — pure linear interpolation. For AFC the honest 1:30 plan is +10–15s on the Point Loma climb miles, −20s on The Drop, and a protected effort budget for the 6th Ave/Balboa climb at 10.9–13.1. The course intel **exists in the DB** (`course_library.geometry_json` — phase-by-phase notes that correctly describe climb→drop→flat→climb, with the right coaching instincts) but the splits calculator never reads it. (Course facts block has its own wobble: finish elevation 150 ft / final climb +90 ft vs. reality ≈ 280 ft / ≈ +160 ft — "secondary_source" data understating the famous finish climb by ~half.)
- **Projection line:** "Fitness reads 1:41:55 · +11:55" (F1). Reverent.

**F4 🔴 — readiness can tell him to pull back on race morning.** `lib/coach/health-actions.ts` (full read): trigger logic has **no race-proximity check anywhere** — HRV streaks, RHR streaks, sustained pull-back (2-of-3-days < 40 forces "Take 2-3 easy days"), TSB triggers, all fire on any day including `days_to_race = 0`. This is not hypothetical: **on Jun 8 production readiness scored 38 PULL-BACK from a single 29 ms HRV reading** (stored snapshot, pillar weight −18) — a reading that `health_samples` now records as 46 (the early partial-night sample was later corrected by re-sync; the snapshot and that morning's advice kept the garbage). Pre-race nights are exactly when HRV craters benignly (nerves, travel, hotel bed, early alarm cutting the sleep window the sleep pillar also punishes, −14 that same day). The probability that Aug 15–16 biometrics trip pull-back is *high*, and the app will hand a maximally-suggestible runner "cut today to 30 minutes easy" at 5 AM.
  - Compounding it: HRV ingest has **zero outlier rejection** (`ingest/health/route.ts:88-92` — `isFinite()` is the only check; yesterday's HRV stored as **102 ms** vs 55 baseline, accepted) and the readiness HRV pillar window is inconsistent (Jun 8 snapshot used a raw single-day "29ms"; Jun 9 used "55ms · 7d avg" — same pillar, different windowing depending on data availability).
  - **Fix:** race-day/race-week guard in `buildHealthActions` (suppress pull-back class; keep illness/injury hard rules), median-of-3-days for HRV pillar, and clamp/reject HRV samples outside ±40% of 30-day baseline at ingest.

## 6:30–6:53 AM — the corral

**Watch routing:** `/api/watch/today` builds from the race-day plan row (`type: 'race'`), `isRace: true` flips the watch to `LiveRaceFace` (`ActiveWorkoutView.swift:105`, `Faces.swift:110`). Routing is correct. Contents:

**F3 🔴 — the race face's pace target is 6:45/mi.** The race row's spec is `{kind:'long', pace_lo:397, pace_hi:412}` (a "stash" shape — race rows deliberately reuse kind:'long', `expand-spec.ts:344-365`). `expandLong` with no finish_mi emits one phase at **mid(397,412) = 405 ≈ 6:45/mi, tolerance ±12 s** (`expand-spec.ts:214-217` + `build-workout.ts:366`). So the four-row race face reads: live pace · **target "6:45"** · distance · goal delta. 6:45 even pace is a **1:28:30 half**. His goal is 6:52; his February-anchored fitness is 7:14; his recent-race fitness is ~7:35. A runner who obeys his watch through The Drop at "on-target" 6:40s will be walking up 6th Avenue. The spec's band bottom (397 = 6:37) has no defensible source — it's T-pace −10 from a goal-anchored T.
  - Also on the race spec: `hr_cap_bpm: 154` (dead on the watch path — race type nulls the ceiling, verified `build-workout.ts:478` — but alive in any UI that prints spec fields), and `fuel_mi: [5, 9, 13]` — **a gel at mile 13.0 of a 13.1-mile race** (generator does fixed spacing with no final-miles exclusion).
  - **Fix:** race specs should carry `pace_target = goal pace` with an explicit negative-split band (first 5K at goal+5–10s), or better, course-phase targets from `course_library`. Cap `fuel_mi ≤ distance − 2`.

**F5 🔴 — the expiry refusal.** `WorkoutRootView.swift:51-58`: tapping Start on a payload older than its `expiresAt` (issued-at + 14 h, `build-workout.ts:502`) **refuses to start and silently requests a re-fetch from the iPhone**. Normal mornings this is the right guard (it exists to stop yesterday's workout recording against today). Race morning it inverts: if the phone is dead, left in the gear-check bag, or stuck on congested start-line LTE — and the last successful sync was before ~5 PM Saturday — the watch will not start the race workout, with no override, discovered at the line. The fallback is recording with Apple's native Workout app (HealthKit ingest will pick it up later — see AV4), but then race day happens with zero pacing support.
  - The watch race mode also has **dead inputs**: `goalSec`, `gelsMi`, `strategyLabel`, `fueling` are decoded by the watch model (`WatchWorkoutModels.swift:147,174`) and consumed by the engine (gel alerts at `WorkoutEngine.swift:764`, goal delta row) — but the server **never sends any of them** (`build-workout.ts:486-512` emits none; `gelsMi` exists only as a type declaration, grep-verified). The goal-delta row and in-race fuel alerts the watch was built to show will be empty/silent on Aug 16.
  - **Fix:** `isRace == true` payloads get `expiresAt = race-day 23:59` (or the gate becomes date-equality for race workouts); populate `goalSec` from the race meta (through the *fixed* parser) and `gelsMi` from a sane fuel plan. Add an on-watch "start anyway" escape hatch.

## 1:30 PM — logging the result

`POST /api/race/result` (`app/api/race/result/route.ts`, agent-verified with line cites): writes `actual_result` via jsonb-merge (Rule 6-compliant), snapshots post-race VDOT + projections, archives the active plan (`archive_reason: 'race_completed'`), then auto-generates the next plan for the **next A/B race by date**. Failures return explicit 500s / structured `nextPlan.reason` — not silent. Two catches:
- **The next plan is Run Malibu, not CIM.** The next A/B race after Aug 16 is Run Malibu HM (Nov 8, priority B); CIM (Dec 6, the actual A goal) is second. The post-AFC auto-plan targets a B-tune-up half with CIM as a horizon constraint at best. If David expects "AFC result in → CIM 3:00 build out," that's not what ships.
- The race-day run itself is excluded from run-VDOT candidates (correct — curated result is canonical), but only the *finish time* enters; his 1:30-attempt VDOT (~50.7 if he pulls it off) would finally fix F1/F9 — *after* the race it mattered for.

---

# ATTACK VECTOR 4 — THE APP GOES DOWN

| Scenario | What actually happens (verified/agent-verified) | Verdict |
|---|---|---|
| **Railway down race morning** | iPhone: every fetch fails → views render from `AppCache` (UserDefaults stale-while-revalidate, `AppCache.swift:38-102`) — yesterday's briefing, no error banner; RaceDayView needs `/api/race/[slug]` live (detail not in the cache key list (agent)) → likely spinner/blank. Watch: runs entirely from last-pushed applicationContext; **if the payload is <14h old the race workout starts and records fully offline** (HKWorkoutSession is watch-local; completion queues). If >14h: F5. | Survivable iff phone synced that morning — same single dependency as F5 |
| **Watch battery dies mile 8** | HKWorkoutSession dies with it. The Faff completion payload is built at workout end — never built, nothing queued → the run's watch record is lost (partial workout may survive in HealthKit on reboot; `HealthKitImporter` 3-day window would then ingest whatever HK saved). No live fallback recorder on the iPhone. | Data mostly lost; race continues on feel. Hardware risk, not code bug |
| **Phone dies during race** | Watch is autonomous mid-workout ✓. Completion can't reach the server (`transferUserInfo` queues on watch → phone delivers when both alive; pending queue capped 50, `WatchSync.swift:28-32,93-98`). Data lands when the phone revives **and David opens the app** (flush triggers: WCSession activation / message receipt). | OK — delayed, not lost |
| **Strava push fails post-race** | `strava_pushes` row inserted before upload; 15-min poll cron resolves pending; >24h pending → failed. Notification **only** on 3 consecutive 401s (re-auth case). Generic failures (5xx, network): silent — status visible only if he opens the run's detail sheet. Auto-push is OFF by David's choice, so the push is manual anyway. | 🟡 fine for him as-is; silent-failure class noted |
| **All crons stop** (CRON_SECRET rotated, Actions outage) | First visible break: VDOT/projection freeze (snapshot cron) and notifications stop. Dedupe stops → volume double-counting creeps back. **No dead-man alerting found** — `ops_alerts` table exists but no cron-failure producer was found wiring into it (agent + grep). Davids discovers by vibes, days later. | 🟠 silent-stale class: the projection shown race week could be days old with no staleness indicator |

The single-point-of-failure list: `CRON_SECRET` env var (16 workflows die at once, 401s, silently), GitHub Actions as the only scheduler, and the **phone-sync dependency for the watch's race payload** (F5) — the only one that can ruin race morning by itself.

---

# ATTACK VECTOR 5 — THE DATA CORRUPTS

## 5.1 Ingest validation — the doors are open

Verified directly + agent-confirmed across all four write paths:

| Path | Distance ceiling | Pace sanity | HR bounds | Future timestamps | HRV/RHR bounds |
|---|---|---|---|---|---|
| `/api/watch/workouts/complete` | none (floor 0.25mi) | none | **none** | none | n/a |
| `/api/ingest/workout` (HealthKit) | none | none | **none** | none | n/a |
| `/api/run/manual` | none | none | **none** | none (date as-is) | n/a |
| `/api/strava/webhook` + pullSync | none | none | **none** | none | n/a |
| `/api/ingest/health` | n/a | n/a | n/a | n/a | **`isFinite()` only** |
| `/api/race` POST/PATCH (meta) | n/a | n/a | n/a | **no date validation at all** | n/a |

The only real guard anywhere is the sub-threshold filter (drops <0.25 mi & <180 s tap-tests) and elevation sanitization. A 0.1-mi-instead-of-8 corruption: skips VDOT (4-mi floor — fails *safe* there), **poisons training form** (stress 0.085 vs 6.8 → TSB jumps a band fresher), poisons weekly volume/adherence ("you're 7.9 mi short"), and **breaks dedup** (`identity.ts:97-102` tolerance ±0.05 mi → its sibling row no longer matches → the run double-counts when both survive). The HRV=102 row sitting in production *right now* is the live proof for biometrics: accepted, averaged into the 7-day pillar, no questions asked.

## 5.2 Race meta integrity — wrong date, wrong everything, no guard

`meta.date` is written as a raw string with zero validation (`api/race/route.ts:49`). It drives: race-day mode triggering on all three surfaces, the taper countdown, plan generation end date, race-day run exclusion from VDOT (±1 day window — a date off by 2 days lets the GPS-overmeasured Strava race activity leak in as a phantom-high VDOT, the exact Disney-13.38mi bug class C1-1e fixed), and notification scheduling. One fat-fingered edit = race-day mode on the wrong day, and **nothing would flag it** until the morning. The good news: the current AFC date is verified correct (2026-08-16 is the real AFC date, a Sunday).

## 5.3 The dedup pipeline and the absorber

Known state confirmed: `isSameRun` two-tier matching, MAX-per-day in training form as a workaround for the absorber not firing reliably, nightly `dedupe-runs` self-heal, the HealthKit full-replace `mergedIntoId` wipe (Cluster 1b) still root-cause-open but cron-healed. Residual risk for race week is volume-display flicker (a same-day duplicate surviving until the 10:00 UTC cron), not decision corruption.

**Fix block for AV5 (one afternoon):** bounds at every ingest (distance 0.25–50 mi, pace 3:00–20:00, HR 30–230, HRV 10–200 ms + ±40%-of-baseline clamp, RHR 25–110, race dates within [today−1y, today+2y]), and a `data_quality` log table for rejects so corrections are auditable.

---

# ATTACK VECTOR 6 — THE UX FAILS

_Cross-referenced with `IPHONE-QA-REPORT.md` (2026-06-09), `DESIGN-AUDIT-REPORT.md` (2026-06-08), `UI-HEALTH-REPORT.md`; race-lens findings are this session's._

**Persona 1 — first install, no data.** Onboarding fabrication is fixed (TF191/192: minimal honest flow, real connects). Remaining wall: the app is plan-shaped everywhere — History is gated behind the plan tab loading, the feed is undifferentiated rows of "Run", and there's no glossary on iPhone (web shipped one), so VDOT/TSB/ACWR jargon lands cold. A new runner's first week is "numbers I don't understand describing runs the app didn't see."

**Persona 2 — two weeks in, no plan yet.** The Today surface composes around a plan that doesn't exist; readiness renders (good) but the headline real estate asks them to generate a plan before the app has fitness signal to author it from — and F9 shows what happens when it authors anyway: the active plan in production was authored from `bestRecentVdot=null`. The cold-start floor (`b53c4fdf`) made the *tempos* sane; race paces remain pure goal echo. The honest move at this stage is a time-trial prompt; it doesn't exist.

**Persona 3 — David today, 68 days out.** The best-served persona by far; the daily execution loop (hero, watch handoff, recap) is genuinely strong. His five real frictions, all verified: (1) phase mislabeled "BASE" during RACE-SPECIFIC (`Theme.swift:436`, 1-line fix, still open); (2) the pre-run card's hardcoded HR target disagreeing with the watch (`TodayPreRunBodyV3.swift:626-636`); (3) the fake map squiggle on every run detail (`RunDetailView.swift:419-454`) — an active honesty debt in an app whose brand is honesty; (4) tempo execution feedback built on whole-run averages because phases aren't stored (F10) — "did I hit the workout?" is answered by vibes; (5) the readiness story and the workout story never connect on a pull-back morning (both audits flagged it; still open).

**Persona 4 — David at 5 AM Aug 16, max stress, needs clarity.** Walked in AV3. Summary of what he actually sees on current code+data: no wake notification (F6) · cold container spinner · race-day mode fires ✓ · hero with goal-pace "0:07/mi" and B·SAFE "8:30" (F2) · "Fitness reads 1:41:55" (F1) · GUN TIME "—" · flat-course splits ignoring the course intel the DB already has · a fueling card computed from a 90-second race (F2) · readiness possibly yelling pull-back (F4) · then a watch that either refuses to start (F5) or starts and paces him to a 1:28:30 (F3). **The morning the app was built for is its weakest rendered state.** Every individual fix is small; the compound is what would make him close the app — and on race morning, "closes the app" means he races naked on a course with a trap finish.

---

# ATTACK VECTOR 7 — THE COACHING IS WRONG

**Easy pace.** Prompt's premise: 8:12 target. Plan reality: easy days carry HR cap 144, no pace target (deliberate, correct); the long-run band is 7:42–8:17 (462–497). His last 30 days of easy-day executions: **8:18–8:31, avg 8:22, HR 138–148**. Verdict: he's running easy *honestly* — at or below the band, HR mostly under the cap. Not too fast. (If anything the 12-mile long runs at 8:01 with HR 151–154 run slightly warm against a 144 cap that the watch correctly doesn't enforce on finish-runs but does display.) **No intervention needed — this is the app and the runner both behaving well.**

**Tempo pace.** Prompt's premise: 7:17 (437). Plan targets ramp 442→419. Whole-run tempo-day paces (the only data that exists — F10): Jun 4 7:41 for 7.76 mi (target 442 over 5 mi + WU/CD), Jun 9 8:01 for 8.02 mi (target 437 over 4 mi + 4 mi jog). Back-computing, both are *consistent with* hitting the T segments roughly on target, but it is literally unverifiable — and that's the finding. **The app prescribes structured quality and then stores no structure about what came back.** `vdotFromRun` then reads these diluted whole-run averages (VDOT 40 for Jun 9's tempo day) — which is why no run will ever rescue the Aug 1 cliff (F1) and why "fitness vs VDOT" questions can't be answered from training data at all.

**The ratio.** Peak weeks run ~28% quality by distance (wk8: 4 @ T + 4×1 @ I + 10 @ HM = 18/64.5) against the 80/20 standard — aggressive, and the quality is concentrated in the wrong place (F8: long-run finishes harder than tempo days). 13-mi long runs with HMP finishes for a 1:30 target: structurally appropriate for advanced HM training; at goal-pace dose, see F8.

**The single most important coaching advice the app isn't giving him:**

> **"Your goal and your fitness haven't met each other yet. Race something in early July."**

Every thread in this audit converges there: the 47.9 anchor is February; every 2026 race since says 44–45; the goal needs 50.7; the plan's race-pace segments assume the goal is already true; the projection cliff (F1) happens *because* there's no fresh anchor; and the fix for all of it is the one thing the system already understands — `projection-levers.ts` literally models "Tune-up race: +1.0 VDOT" as its best lever, and the Dodgers 10K shows the C-race slot exists in his calendar. A hard 10K or HM time-trial around Jul 4–11 would: re-anchor VDOT honestly before the race-specific block, make the Jul 19/26 finish segments either validated or corrected, defuse the Aug 1 cliff with a fresh in-window anchor, and answer the 1:30-vs-1:33 question while there's still time to renegotiate (the renegotiation machinery — `daysToRenegotiate`, goal PATCH, auto-rebuild — is built and waiting). The app has all the parts and never says the sentence.

---

# ATTACK VECTOR 8 — THE COMPETITION

**Where Faff beats them all** (honest, having lived in Garmin/TrainingPeaks/Strava/Final Surge for years):
1. **The watch as an execution layer** — phase-by-phase structured guidance with finish-segment faces, haptic transitions, HR ceilings on easy days. Garmin's daily-suggested-workouts are context-blind by comparison; TrainingPeaks has no first-party execution surface at all.
2. **One opinionated voice.** Every metric traces to a cited doctrine file. TrainingPeaks gives you 40 charts and no opinion; Strava gives you a feed; Faff gives you a coach's answer. The state-driven composition (race-day takeover, rest-day calm) is something none of the incumbents do.
3. **Whole-athlete readiness folded into the same surface as the plan** (HRV/RHR/sleep pillars with shown work) — Garmin's Body Battery is a black box; Whoop doesn't know your plan.

**Where it falls short:** reliability of the numbers under time (this entire report); no community/social layer at all (Strava's moat); no historical analytics depth (TrainingPeaks' PMC across years, custom charts); single-athlete assumptions everywhere; and **trust debt** — fake map squiggles and fabricated-feeling fallbacks ('148 bpm' hardcodes) are things Garmin would never ship, and serious athletes smell them.

**What the best running app in the world does that Faff doesn't:** *adapts*. Garmin DSW re-plans tomorrow from today's execution and HRV status nightly; TrainingPeaks/Join recompute the week when you miss Tuesday. Faff's plan is regenerate-or-nothing (and the one regeneration that knew his fitness got rolled back). The architecture for closed-loop adaptation exists (adaptation_log, run-adaptations cron, drift monitor) but the loop isn't closed.

**The one feature that wins a competitive runner from TrainingPeaks:** the race-day execution package, finished. Course-phase pace targets on the watch (the DB already holds the course phases!), gel cues at the right miles, goal-delta live, splits banked against the course profile — nobody has that as an integrated artifact from *their own training data*. It's 80% built. Finishing it is also exactly the list in AV3.

---

# COMPLETE FINDINGS INDEX

| ID | Finding | Sev | Prob | Would David notice? | Fix size |
|---|---|---|---|---|---|
| F1 | VDOT anchor cliff Aug 1 (47.9→44.1, proj +7:01) | 🔴 | Certain | Yes — misattributed | S (decay/freeze rule) |
| F2 | "1:30" parses as 90s on both race-day surfaces | 🔴 | Certain | Yes — as broken UI, race morning | XS (use shared parser + normalize data) |
| F3 | Watch race target 6:45/mi (band 397–412) | 🔴 | Certain | Only mid-race | S (race spec = goal pace + split plan) |
| F4 | No race-day guard on pull-back advice; fired Jun 8 on bad HRV | 🔴 | Likely | Yes — and might obey it | S (guard + HRV median window) |
| F5 | Watch refuses expired payload; phone-sync single dependency on race morning | 🔴 | Possible | At the start line | XS (race payloads expire end-of-day + override) |
| F6 | Race-day wake notification unreachable (cron UTC dead zone 00:00–06:59 PT; slack 15 vs poll 30) | 🟠 | Certain | No — absence | XS (one cron line) |
| F7 | TSB −10 bootstrap artifact (−25 shown, −15 real) | 🟠 | Certain | No | S (seed/window fix) |
| F8 | Goal-anchored 9–10mi @ HMP finishes; T slower than HMP; plan authored with null VDOT | 🟠 | Certain | Yes — by failing the workout | M (re-anchor finish paces) |
| F9 | Headline VDOT 128 days stale; all 2026 races since say 44–45; no anchor age shown | 🟠 | Certain | No | S (show anchor; tune-up prompt) |
| F10 | Per-phase actuals stored nowhere (runs.phases absent; workout_completions dead since May 25) | 🟠 | Certain | No — absence of feedback | M (persist phases on completion ingest) |
| F11 | Race-week zero intensity (last quality T−10d) | 🟠 | Certain | No | XS (strides + HMP touches) |
| F12 | Jul 19 notes vs spec vs sub_label 3-way contradiction (10+7 vs 8+9 vs 7) | 🟠 | Certain | Yes — mid-run confusion | XS (derive notes from spec) |
| F13 | Ramp: wk4→5 +12%, peak 64.5 = +65% over trailing avg; no peak-vs-history validation; no completion gate on wk8 | 🟠 | Possible | By injury | S |
| F14 | GUN TIME "—" / no wave / no logistics editing on race card | 🟠 | Certain | Yes, 5 AM | S (editable fields + nag in race week) |
| F15 | Race splits ignore course profile the DB already has; course facts understate finish climb ~2× | 🟠 | Certain | At mile 11.9 | M (course-aware splits) |
| F16 | `gelsMi`/`goalSec`/`fueling`/`strategyLabel` decoded by watch, never sent by server; gel alerts + goal delta dead on race day | 🟠 | Certain | Mid-race | S |
| F17 | fuel_mi includes gel at mile 13.0 of 13.1 | 🟡 | Certain | Yes (comedy) | XS |
| F18 | Race spec hr_cap_bpm 154 (dead on watch path, live wherever spec fields print) | 🟡 | Certain | Maybe | XS |
| F19 | Plan-rest-day runs contribute zero training stress (type-by-date join) | 🟠 latent | Possible | No | S |
| F20 | Ingest bounds absent everywhere (distance/pace/HR/HRV/race-date) | 🟠 | Edge | No | S |
| F21 | HRV pillar windowing inconsistent (raw single-day vs 7d-avg); snapshot froze 29ms later corrected to 46 | 🟠 | Likely | No | S |
| F22 | Cron monoculture: CRON_SECRET SPOF, GitHub Actions sole scheduler, no dead-man alert; stale snapshots show with no age indicator | 🟠 | Possible | Days later | S–M |
| F23 | Post-race auto-plan targets next A/B by date = Run Malibu (B), not CIM (A) | 🟡 | Certain | At plan reveal | S (target next A; B as tune-up) |
| F24 | `is_peak`/`is_cutback` flags never set; phase mislabel "BASE" in race-specific (Theme.swift:436); fake map squiggle; hardcoded glance HR fallbacks | 🟡 | Certain | Yes | XS each |
| F25 | TSB label bands: −25 reads "LOADED" one notch from OVERREACH while Coggan calls −10..−30 productive overload; header comment contradicts code bands | 🟡 | Certain | No | XS |

**Five things to ship before Aug 16, in order:** F2 (parser, 1 hour) → F3+F16 (race payload: goal pace target, goalSec, gels, end-of-day expiry = F5, ~1 day) → F4 (race-week readiness guard, ~half day) → F1 (anchor decay or race-week projection freeze, ~half day) → F6 (one line of YAML). Everything else can wait for CIM; these five cannot.

---

## THE VERDICT

**Would I bet my reputation on David running 1:30 at AFC using only this app for guidance?**

**No — and the app, used as built today, would actively reduce his odds on the day itself.** Not because the engineering is bad: the formulas are *correct* (I reproduced every one), the daily training loop is honestly excellent, and the architecture is more coherent than products with 100× the headcount. The "no" splits cleanly in two:

**The fitness half (no app can fix):** 1:30 needs VDOT ~50.7. The only evidence for anything near that is one February race. Everything since — two marathons, a full-effort May half at 1:40:57 — reads 44–45. The build can plausibly buy 2–3 points by August off this volume; that lands him at **1:33–1:35 on a course with an uphill finish in San Diego in August**. The B-goal, 1:37, is close to bankable. 1:30 requires the Jul 13–27 block to go perfectly, a fresh anchor proving it went perfectly, and a cool morning — a parlay, not a plan. A coach who bets his reputation on 1:30 today is betting on hope; the honest bet is 1:33:30 with a renegotiation conversation in mid-July that the app should be initiating and isn't.

**The app half (entirely fixable, ~3 days of work):** as the code and data sit right now, race morning serves him a projection that lurched 7 minutes for calendar reasons, splits computed from a 90-second goal, a dash where the gun time goes, possibly an instruction to pull back, and a watch that will either refuse to start or pace him to a 1:28:30. Every one of those is individually small, fully diagnosed above, and the five-fix list at the end of the index defuses all of them. Ship those five and the answer upgrades to: *I'd bet on the app; I'd still set the goal at 1:33.*

**What keeps me up at night about this system:** its authority peaks exactly where its correctness bottoms. For 67 of 68 days it's a careful, cited, conservative coach — and the runner learns to trust it. On day 68 — maximum stress, zero independent judgment, decisions measured in seconds per mile — it serves its least-tested code paths (first-ever render of the race-day surfaces), its stalest data (a window-cliffed anchor), its most fragile dependency (one phone sync), and zero of the guardrails it applies to ordinary Tuesdays. The race-day surfaces have never rendered in production and can't be caught by daily dogfooding; they fail precisely once, at 5 AM, with the gun at 7. Trust built over 68 days, spent in 5 minutes — *that's* the failure mode. Not wrong formulas. A system that's most confident at the moment it's most wrong, talking to a runner who's least equipped to doubt it.

Fix the five. Race the tune-up. Renegotiate honestly in July. Then the bet is good.
