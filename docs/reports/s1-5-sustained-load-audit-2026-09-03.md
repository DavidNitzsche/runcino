# S1.5 · monthly and sustained load — independent re-measurement

**Branch** `audit/s1-5-sustained-load`, cut from `origin/main` **`ceba473b`**. Nothing
merged into the engine; this document is the only file the branch adds.

**Runner** `0645f40c-951d-4ccc-b86e-9979cd26c795`. **Measured** 2026-09-03, splice point
`2026-09-03` (his last recorded run is 2026-09-02).

**Production was read through `DATABASE_URL_RO`**, connected as `faff_readonly`. The two
in-process harnesses used to reach the composer and the app's own readers set
`process.env.DATABASE_URL` to that same read-only string before importing anything that
opens a pool; `vitest.setup.ts`'s write barrier reported `writes REFUSED` in both runs.
`composeForUser` composes and returns — `persistComposedPlan` is not reachable from it.
Both harnesses were deleted; `git status` is clean apart from this file.

---

## Prior art, and why this is not a duplicate

`docs/reports/complete-coaching-brain-handback-2026-09-02/LOAD-AUDIT.md` already audited
these two claims, against `origin/main` **`656f3328`**. That audit handed over one defect,
which landed as **`ba2ebc2c` · ROLLING7-1** — *"enforce the peak ceiling in the unit it is
measured in"*.

This is an independent re-measurement against **`ceba473b`**, from raw SQL first, after
that fix. It reproduces both claims, reaches the same verdicts, and adds three things the
earlier pass could not have:

1. the composed block **after** ROLLING7-1 (the 62.0 mi breach is gone — it now sits at
   60.1, exactly on its own ceiling);
2. a **raw-versus-reader diff** that explains the 0.1 mi disagreements between every
   number in the earlier audit and the underlying data;
3. the finding that **the corrected block is not the block on his phone** (§6).

Where the two audits' numbers differ, the cause is stated. Nothing here is taken on
trust from the earlier document.

> **Doc inconsistency, for whoever owns it.** `docs/MASTER_CORE_PRODUCT_PROGRAM.md` lists
> S1.5 as **Merged** in the LANDED table (line 150) and as **Ready** in the Stage 1 table
> (line 220). One of the two is stale.

---

## Verdicts

| Claim | Verdict | Measured |
|---|---|---|
| **A** · the newly-composed block grows rolling 28-day load ~30% | **TRUE** | **+30.4%** composed · **+32.1%** on the persisted plan |
| **B** · a 7-week stretch at ~52.9 against a best sustained 5 weeks at ~42.6 | **TRUE, both halves** | **52.90** and **42.56** — the second is 42.50 raw, 42.56 through the app's reader |

**Neither is grounds for a correction, and none is proposed.** The reasoning is §5.

**The live defect this measurement found is a delivery defect, not a load defect:** the
plan `pln_9a57561debb776e5` that is actually on his phone predates both LOADCONTRACT-1 and
ROLLING7-1. It carries a peak rolling-7 of **61.5 mi against a 60.1 ceiling** and a
**1.23** long-run spike, and it publishes no ceiling at all in its own stamp. The composer
no longer produces either. Merged is not live — §6.

---

## 1 · Population, unit and filter, stated before any number

### 1.1 Population (Rule 14)

Canonical rows only, by the one predicate — `CANONICAL_ROW_SQL` in
`web-v2/lib/runs/volume.ts:60`, `NOT (data ? 'mergedIntoId')`. Filtered on `user_uuid`;
the `'me'` sentinel appears nowhere. Plan figures are pinned to the **active** plan, by
`archived_iso IS NULL` **and** by `pw.user_uuid`, so none of the 46 archived versions can
join.

```
population                                    rows      mi
A  all rows, no predicate                      275   2082.42
B  canonical: NOT (data ? 'mergedIntoId')      156   1166.54
C  WRONG: absorbed_into_canonical_at IS NULL   156   1166.54
```

**B and C agree today, and that is the trap rather than the absolution.** The cross-tab is
`(merged=f, stamped=f) → 156` and `(merged=t, stamped=t) → 119`, with no cell in between:
the six stale-stamped canonical rows `volume.ts` warns about have been cleaned up, so the
wrong predicate currently returns the right answer. It is one promotion away from zeroing
a day again. Use the predicate, not the stamp.

### 1.2 Unit

Two, each for the question it is honest about, and both given wherever the verdict moves.

- **Calendar weeks, Monday-start** for anything either claim calls "a week". The plan
  authors in Monday weeks (`plan_workouts.week_id` starts 2026-08-24, a Monday), so a
  rolling comparison would answer a question nobody asked.
- **Rolling 7-day and rolling 28-day, stepped one day at a time**, for peak and chronic
  load. This is the engine's own unit — `resolvePeakWeekly` is a rolling-7 max — and it is
  the unit tissue experiences.

The two disagree, and the difference is not an error:

```
best calendar week (Mon-start)   48.53   week of 2026-02-09
best rolling 7-day               52.35   2026-07-11 .. 2026-07-17
```

### 1.3 Rule 8, and which side of the corollary each number sits on

`loadPrescribedWindows()` returns six windows for this runner, one per race he actually
ran, each `[race − taperWeeks·7, race + recoveryWeeks·7]`:

```
rose-bowl-half-2026    2026-01-18  hm  A                taper 2  rec 2   2026-01-04 .. 2026-02-01
disney-half-2026       2026-02-01  hm  A                taper 2  rec 2   2026-01-18 .. 2026-02-15
la-marathon-2026       2026-03-08  m   A                taper 3  rec 4   2026-02-15 .. 2026-04-05
big-sur-marathon       2026-04-26  m   hilly-excluded   taper 3  rec 4   2026-04-05 .. 2026-05-24
sombrero-half          2026-05-03  hm  C                taper 2  rec 1   2026-04-19 .. 2026-05-10
americas-finest-city   2026-08-16  hm  A                taper 2  rec 2   2026-08-02 .. 2026-08-30
```

They union to `2026-01-04 .. 2026-05-24` and `2026-08-02 .. 2026-08-30`: **170 of the 246
days in his record — 69.1% — are prescribed taper, race week or post-race recovery.** Nine
full calendar weeks are clean, they are consecutive (2026-05-25 .. 2026-07-20), and they
contain a 0.00 mi week and a 27.97 mi week. **His record contains no uninterrupted build
block.**

| Figure | Filtered? | Question it answers |
|---|---|---|
| peak rolling-7 **52.35** · peak rolling-28 **172.57** · best 5-week mean **42.50/42.56** · every plan-side figure | **unfiltered, deliberately** | **absorbed load** — what the tissue has carried, and what it is about to be asked to carry |
| `sustainedWeeklyMileage` **45.5 mi/wk** (rank-3 of 9 representative weeks; 73 representative days, 48 excluded, 120-day lookback) | filtered | **habit / capability** |
| `normalWeeklyMileageDetail(28)` and `(90)` — both **45.5 mi/wk** | filtered | habit |
| best 5 consecutive Rule-8-**clean** calendar weeks **39.98** | filtered | habit |
| `recentWeeklyMileageMi(28)` **32.7 mi/wk** | unfiltered | recent absorbed load |

**Both claims compare a planned future load against what the legs have carried. That is a
tissue question, not a habit question, so the reviewer used the correct population for
both** — and filtering them would have made a safety comparison *more permissive*, which
is the over-application Rule 8's corollary exists to stop. Note which direction the filter
actually moves things here: his filtered habit is **45.5**, *higher* than the 42.6
comparator, and his best five clean weeks average **39.98**, *lower* than it. The
unfiltered number is not the flattering one.

The demonstrated peak is unaffected either way: 52.35 falls on 2026-07-11 .. 07-17, inside
the clean stretch.

---

## 2 · Raw versus the app's own readers (verified raw first)

Every history figure above was computed from raw SQL, with no app code in the path. Only
then was the app's canonical reader run over the same window.

```
                                RAW SQL      APP READER (mileageByDay)
run days                             149                          149
total mi                         1166.54                      1167.20
peak rolling-7                     52.35                         52.30
peak rolling-28                   172.57                       172.70
best calendar week                 48.53                        48.70
best 5-week mean                   42.50                        42.56
best 7-week mean                   39.71                        39.74
```

**They differ, on 133 of 149 days, by at most 0.05 mi each, and the cause is entirely
`mileageByDay`'s per-day rounding** — `volume.ts:118`, `Math.round(total * 10) / 10`. The
net is **+0.66 mi** across the record, 0.06%. It is the whole explanation of the reviewer's
`42.6` and of every 0.1 mi disagreement between the earlier audit and the raw data.

**Identity clustering collapses nothing for this runner**, which is the substantive result
of the comparison: 149 run days both ways, and the five days carrying more than one
canonical row (2026-03-03, 05-14, 05-21, 05-24, 08-01 — twelve rows between them) are
separate physical runs, not duplicates. No day is inflated by an unflagged dupe.

The one number where the rounding could matter is the demonstrated peak: the engine's
`ramp_base.peakMi` reads **52.3**, which is the reader's value, and the raw value is
52.35. 0.05 mi of ceiling. Immaterial, recorded so it is not re-found.

---

## 3 · Claim A · rolling 28-day load

```
HISTORY (unfiltered · absorbed load)
  peak rolling-7     52.35 mi   2026-07-11 .. 2026-07-17
  peak rolling-28   172.57 mi   2026-05-31 .. 2026-06-27   = 43.14 mi/wk

COMPOSED  (composeForUser, origin/main ceba473b, 2026-09-03)
  peak calendar week  60.0 mi
  peak rolling-7      60.1 mi   2026-10-07 .. 2026-10-13
  peak rolling-28    225.1 mi   2026-10-05 .. 2026-11-01   = 56.28 mi/wk
  peak-over-peak rolling-28 growth                          = +30.4%

WRITTEN  (pln_9a57561debb776e5, the plan on his phone)
  peak calendar week  61.0 mi
  peak rolling-7      61.5 mi   2026-10-27 .. 2026-11-02
  peak rolling-28    228.0 mi   2026-10-06 .. 2026-11-02   = 57.00 mi/wk
  peak-over-peak rolling-28 growth                          = +32.1%
```

**TRUE.** It reproduces on the composed block and on the persisted one, from raw SQL and
through the app's reader alike. It cannot be re-raised as unverified.

The composed block's own stamp agrees with the independent measurement to the decimal:
`rolling_seven_ceiling.peak_rolling_seven_after_mi` reads **60.1**, and the splice-based
walk of its authored days reads **60.1**.

Composed weekly curve, for reference:

```
2026-08-24  46.0   2026-10-05  59.5   2026-11-16  49.0
2026-08-31  49.0   2026-10-12  59.6   2026-11-23  36.0
2026-09-07  24.4   2026-10-19  46.0   2026-11-30  44.2
2026-09-14  47.0   2026-10-26  60.0
2026-09-21  55.2   2026-11-02  42.7
2026-09-28  43.0   2026-11-09  40.5
```

---

## 4 · Claim B · the 7-week mean and its comparator

```
best mean over N consecutive HISTORY calendar weeks (unfiltered)
  N=2   45.42   2026-02-09 .. 2026-02-16   min 42.31
  N=3   44.08   2026-06-01 .. 2026-06-15   min 40.08
  N=4   42.99   2026-05-25 .. 2026-06-15   min 39.70
  N=5   42.50   2026-05-18 .. 2026-06-15   min 39.70    <- 42.56 through the reader
  N=6   41.67   2026-05-11 .. 2026-06-15   min 37.55
  N=7   39.71   2026-05-11 .. 2026-06-22   min 27.97

best mean over N consecutive PLAN weeks
  COMPOSED  N=7   52.90   2026-09-14 .. 2026-10-26   min 43.0
  WRITTEN   N=7   53.97   2026-09-21 .. 2026-11-02   min 45.5
```

**TRUE, both halves.** 52.90 against a claimed 52.9; 42.56 against a claimed 42.6.

---

## 5 · Coherence judgement · why no correction is warranted

### 5.1 The peak-week axis already spends doctrine's figure, once, in the right unit

`Research/00a` §"Volume progression rules" publishes **5–15% per training cycle** as a
statement about the base and peak a runner returns to. The composed block spends it there
and nowhere else, and its own stamps say so:

```
load_progression_contract  demonstrated_peak_weekly_mi 52.3 · per_cycle_peak_growth 1.15
                           planned_peak_mi 60.1 · basis per_cycle_growth_on_demonstrated_peak
rolling_seven_ceiling      ceiling_mi 60.1 · before 61.0 · after 60.1 · within_ceiling true
```

`60.1 / 52.3 = 1.149`, under 1.15, **in the unit the ceiling is measured in**. That is the
single most important change since the earlier audit: the 62.0 mi rolling-7 breach it
found is gone.

Spending 5–15% a **second** time on the 28-day aggregate double-counts one doctrine number.
The arithmetic of doing so: `172.57 × 1.15 = 198.5 mi` = 49.6 mi/wk of 28-day load which,
at doctrine's own down-week shape (§5.2), forces a peak week of about **53 mi** — the
52.3 he already has. A build that builds nothing. That is refused by
`PROGRESSIVE_BASELINE_DOCTRINE`'s acceptance criterion (*"a plan that merely repeats
today's capability fails even if every number is internally consistent"*) and by Rule 21.

### 5.2 Cutback cadence · the month/peak ratio is not a free parameter

`Research/00a`: *"Down weeks | Every 3–4 wk, reduce by 20–30%"*. Three weeks at peak plus
one down week at 70–80% puts the best 28-day block at **0.925–0.95 of the peak week**.
Measured:

```
                     peak week   peak 28-day block   ratio
history (literal)      52.35        43.14 mi/wk      0.824
COMPOSED               60.1         56.28 mi/wk      0.936    <- inside doctrine's implied band
WRITTEN                61.5         57.00 mi/wk      0.927    <- conservative end of it
```

The composed block's authored cutbacks:

```
2026-09-07  24.4  vs 49.0  = -50.2%   race week · Santa Monica 10K 2026-09-13
2026-09-28  43.0  vs 55.2  = -22.1%   gap 3 wk
2026-10-19  46.0  vs 59.6  = -22.8%   gap 3 wk
2026-11-02  42.7  vs 60.0  = -28.8%   gap 2 wk · race week · Run Malibu 2026-11-08
2026-11-23  36.0  vs 49.0  = -26.5%   gap 3 wk
```

Cadence at or tighter than 3–4 weeks, depth 22–29%, inside 20–30%, line for line.

**And this is most of the +30%.** Decomposed:

```
+30.4%  =  peak-week term  60.1/52.35 = 1.148   ×   density term 0.936/0.824 = 1.136
```

The density term exists because **his 0.824 is depressed by unplanned collapses, not by a
demonstrated inability to hold a month.** Eight of his 36 weeks are under 25 mi, including
a **0.00** and a **4.16**. A plan replaces accidental collapses with designed deloads, and
the arithmetic consequence of doing that correctly *is* a higher 28-day aggregate at the
same peak week. Reading it as overload reads the removal of chaos as the addition of load.

### 5.3 The month is governed at every week, by the instrument doctrine publishes for it

`validate.ts` §6 (WKRAMP-1) checks each non-race week against the 4-week chronic mean at
`ACWR_HIGH_RISK = 1.5`. Computed **by the validator's own definition** — non-race weeks
only, chronic = this week plus the three before, checked only when the step exceeds 4 mi:

```
COMPOSED                                   WRITTEN
2026-10-05  59.5  chronic 49.6  1.20 [x]   2026-08-31  45.0  chronic 41.5  1.08 [x]
2026-10-26  60.0  chronic 56.3  1.07 [x]   2026-09-28  56.0  chronic 43.3  1.29 [x]
2026-11-16  49.0  chronic 48.9  1.00 [x]   2026-10-05  61.0  chronic 49.0  1.24 [x]
                                           2026-10-19  60.0  chronic 55.6  1.08 [x]
worst checked  1.20                        worst checked  1.29
```

Worst **1.20** composed, against a red line of 1.5 and a sweet-spot ceiling of 1.3. No
acute:chronic excursion anywhere in the block. `composeForUser` returned `ok`, which means
the full validator — §3 cumulative ramp, §6 ACWR, §10 dosing caps, the taper band — passed.

### 5.4 Rolling-7 peak, long-run history, quality density

**Rolling-7 peak.** 60.1, exactly the published ceiling, 1.149× demonstrated. Nothing left
to cut without going under it.

**Long runs.** The composed block's longest is **21.5** on 2026-11-01 — his own
demonstrated best to the tenth (21.51, 2026-01-25). Two runs reach 20+ (20.0 and 21.5).
His record holds 9 runs ≥ 16 mi, 7 ≥ 18 and 5 ≥ 20, two of which are the LA (26.70) and
Big Sur (26.81) marathons and are races, not training-long evidence. Spike ratios against
`Research/00a`'s *"single long run should not exceed 110% of the longest run in the prior
30 days"*:

```
2026-09-06  15.0 / 13.49 = 1.11   week 1 — one point over
2026-09-20  16.5 / 15.0  = 1.10
2026-09-27  17.0 / 16.5  = 1.03
2026-10-11  18.5 / 17.0  = 1.09
2026-10-18  20.0 / 18.5  = 1.08
2026-11-01  21.5 / 20.0  = 1.08
2026-12-06  26.22 / 16.0 = 1.64   race day, which is what the taper is for
```

One marginal 1.11 in week 1, 0.16 mi from compliant. Recorded; it belongs to long-run
sizing (S1.2), not to sustained load, and it is a continuous quantity so any fix to it is
smooth by construction. **The long-run axis is the one neither claim mentions and it is
the conservative one** — the block peaks exactly at his own best, never above it.

**Quality density.** Composed: 1.53 sessions/wk mean, median 2, counts
`2 2 2 1 2 1 2 1 2 2 2 0 1 1 2`. His own measured habit over the Rule-8-clean stretch
(2026-05-25 .. 2026-07-20): `0 1 2 2 2 0 2 2 1`, median **2**. The block does not escalate
density; it matches it. *Caveat (Rule 11): `data.workoutType` / `data.type` is populated
only from 2026-06-01, so weeks before that are ABSENT, not zero. The habit figure rests on
nine weeks.*

**Frequency, the one axis that does step up.** The composed block asks 6 run days in 13 of
15 weeks. His modal full calendar week is **5** (12 of 33 full weeks; 6 days in 5 weeks;
3–4 days in 14). `profile.weekly_frequency` is **NULL** for this runner — the Rule 11
landmine CLAUDE.md names — but DERIVEDFREQ-1 has since closed that hole and derives
rank-3-of-16 = **6**, which is measured, not defaulted. So the six-day week is
evidence-backed. It is still a step on the density axis, stacked on the volume
progression rather than traded against it, and `Research/00a`'s *"add stress
one-at-a-time"* row is the thing to check it against. That belongs to whoever owns week
shaping; it is named here because a sustained-load audit that did not name it would be
answering half the question.

### 5.5 A mean is not a level

*"Asks for seven weeks at 52.9"* reads as *seven weeks at 52.9*. It is not.

- The composed block's **longest run of consecutive weeks above his demonstrated 52.35
  peak is two.** Above his filtered habit of 45.5, **four**.
- The 7-week window that averages 52.90 contains two authored cutbacks and its **minimum
  week is 43.0 — below the 45.5 he normally holds** and barely above the 42.6 comparator.
- Only four of fifteen weeks sit above 52.35 at all: 55.2, 59.5, 59.6, 60.0.

### 5.6 The comparator is not measuring capacity

His best 7-week mean is **39.71**, and every 7-week window in his record contains a
collapse. The best seven consecutive *Rule-8-clean* weeks average **35.10** and include a
zero week. Six races in eight months; 69.1% of his days inside a prescribed taper or
recovery window; no uninterrupted build block anywhere. **A 7-week mean measured across
that is dominated by the interruptions**, so comparing it to a designed 7-week mean
measures the absence of interruptions, not the presence of overload.

Note also that the claim's comparison is malformed in the *unalarming* direction: it puts a
7-week plan mean against a 5-week history mean. Like for like:

```
at N=7   52.90 vs 39.71   = +33.2%
at N=5   53.62 vs 42.50   = +26.2%
as stated 52.90 vs 42.56  = +24.3%   <- understates both
```

### 5.7 And what may not be used to soften it

`PLAN_SIMPLIFICATION_DOCTRINE` lists *"his explicit preference for aggressive training"*
among the eleven things that may influence the plan, and it is explicit that *"the initial
plan must stand on its own without requiring adaptation to rescue it."* That cuts both
ways. The consistency risk is real, and it is an **adherence** question; adherence is not
in the list of things that may shape the plan, and pre-shrinking a block against a
forecast that the runner will miss weeks is exactly the hidden softening the doctrine
removed decision authority over.

### 5.8 Verdict

**No correction. No new limiter.** The peak-week axis is bound at 60.1 in the unit it is
measured in; the 28-day axis is bound three ways — ACWR at every non-race week (worst
1.20), the cutback cadence and depth that fix the month/peak ratio (0.936, inside the
band doctrine's own down-week row implies), and the rolling-7 ceiling itself; the long-run
axis sits at his demonstrated best and no higher; quality density matches his habit. The
+30% is doctrine's growth spent once, times the removal of chaos.

---

## 6 · The live defect · the corrected block is not the block on his phone

ROLLING7-1 is merged, and green, and **the plan `pln_9a57561debb776e5` that he is running
was authored 2026-08-31, before both LOADCONTRACT-1 and ROLLING7-1.** Measured on it:

| | Persisted plan | Composer today | Ceiling |
|---|---|---|---|
| peak calendar week | **61.0** | 60.0 | 60.1 |
| peak rolling-7 | **61.5** (2026-10-27 .. 11-02) | 60.1 | 60.1 |
| ratio to demonstrated peak | **1.176** | 1.149 | 1.15 |
| worst long-run spike | **1.23** (2026-10-04, 19.0 vs 15.5) | 1.11 | 1.10 |
| worst checked ACWR | 1.29 | 1.20 | 1.5 |
| `load_progression_contract` stamp | **null** | published | — |
| `tier_band_anchor` stamp | **null** | published | — |

The persisted plan publishes **no ceiling in its own `authored_state`**, so nothing on the
phone can be measured against one. Both stamps read `null`; what it does carry is
`tier_peak_weekly_band [65, 90]`, `ramp_base.peakMi 52.3`, `recent_avg_mpw 31.6`.

**This is corrected only by a re-author, not by a recompute** — a recompute reprices, it
does not re-lay-out — which is P0-3, currently blocked on P0-2. Recorded so the breach is
not re-found as a live engine defect (it is not; the engine no longer produces it) and so
that the block he is actually running is not assumed to carry the fix.

---

## 7 · The gate was made to fail (Rule 18)

`web-v2/lib/plan/_rolling_seven_ceiling.test.ts` on `ceba473b`: **6 passed**. With
`enforceRollingSevenCeiling(composed)` commented out at `generate.ts:14467`, **all 6
fail**, and the important one quotes the breach rather than the missing pass, because it
reads the ceiling from the load contract's own stamp:

```
AssertionError: peak rolling-7 61 mi exceeds the block's own published ceiling
                60.1 mi (window opening 2026-10-21)
AssertionError: the peak rolling-7 jumped on a hair of demonstrated peak:
                expected 1.5 to be less than or equal to 1
```

The second is the Rule 9 walk: without the pass, a tenth of a mile of demonstrated peak
moves the block's peak 7-day exposure by 1.5 mi. **The correction removes a cliff rather
than adding one** — it is a `min` against a continuous quantity. Restoring the line turns
all six green; `generate.ts` is byte-identical to `origin/main` in this branch.

**Its cost on the real runner, measured by composing him with and against the pass:** 0.4
mi off 2026-10-12 and 0.9 mi off 2026-11-02, **1.3 mi across a 15-week block**, both taken
from easy days. Nothing else in the curve moves.

**One side effect, benign, recorded so it is not re-found.** The pass also recomputes
`w.weeklyMi` from the week's days. On the CIM race week that changes the composed total
from **18.0 to 44.22**, because the goal race's 26.22 mi was previously not folded into
`weeklyMi` for that one week. It makes the composed value agree with what `plan_workouts`
persists (43.72 on the live plan), and `validate.ts`'s taper checks exclude race weeks
(`!w.isRaceWeek`), so nothing downstream is disturbed. No other week's total changes.

---

## 8 · What this audit cannot answer (Rule 22)

- **Quality density before 2026-06-01.** `workoutType` / `type` is absent on the
  Strava-era rows. Absent is not zero (Rule 11); the habit figure rests on nine weeks.
- **Whether 1.15 is the right per-cycle growth figure.** Owned by
  `RAMP.cycle-over-cycle-peak-growth` against `Research/00a`'s own table cell. Taken as
  given here.
- **Whether the 1.11 week-1 long-run spike is authored or inherited.** 2026-09-06's 15.0
  is one week out and its 13.49 anchor is a real run; which pass sized it was not traced.
- **The six-day week against "add stress one-at-a-time."** Named in §5.4, not adjudicated;
  it belongs to week shaping.
- **Whether he will run it.** Adherence is not the plan's to price.
- **Anything rendered.** Rule 13: nothing here is a display fix and nothing was rendered.
  No claim is made about what the phone shows.
- **Any other runner.** The refutations in §5.1–5.3 rest on doctrine rows and on the ACWR
  guard and are runner-independent; the coherence judgement in §5.4–5.6 is one runner's
  and should not be cited for anybody else.

---

## 9 · Reproduction

### 9.1 Population check

```sql
SELECT 'A all rows (no predicate)' AS population, count(*) AS rows,
       round(sum((data->>'distanceMi')::numeric), 2) AS mi
  FROM runs WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
UNION ALL
SELECT 'B canonical: NOT (data ? mergedIntoId)', count(*),
       round(sum((data->>'distanceMi')::numeric), 2)
  FROM runs WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
   AND NOT (data ? 'mergedIntoId')
UNION ALL
SELECT 'C WRONG: absorbed_into_canonical_at IS NULL', count(*),
       round(sum((data->>'distanceMi')::numeric), 2)
  FROM runs WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
   AND absorbed_into_canonical_at IS NULL;

SELECT (data ? 'mergedIntoId') AS is_merged,
       (absorbed_into_canonical_at IS NOT NULL) AS is_stamped,
       count(*), round(sum((data->>'distanceMi')::numeric),2) AS mi
  FROM runs WHERE user_uuid='0645f40c-951d-4ccc-b86e-9979cd26c795'
 GROUP BY 1,2;
```

### 9.2 The daily series both sides are built from

```sql
-- history · canonical rows, the one predicate, runDaySql's own day expression
CREATE TEMP TABLE h AS
  SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date AS d,
         sum((data->>'distanceMi')::numeric) AS mi
    FROM runs
   WHERE user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
     AND NOT (data ? 'mergedIntoId')
   GROUP BY 1;

-- plan · the ACTIVE plan only, pinned by archived_iso AND by user_uuid
CREATE TEMP TABLE p AS
  SELECT pw.date_iso::date AS d, sum(pw.distance_mi) AS mi
    FROM plan_workouts pw
    JOIN training_plans tp ON tp.id = pw.plan_id
   WHERE tp.user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
     AND tp.archived_iso IS NULL
     AND pw.user_uuid  = '0645f40c-951d-4ccc-b86e-9979cd26c795'
   GROUP BY 1;

-- spliced dense series: history to and including today, plan after it
CREATE TEMP TABLE s AS
  SELECT g::date AS d,
         CASE WHEN g::date <= '2026-09-03'::date
              THEN COALESCE(h.mi, 0) ELSE COALESCE(p.mi, 0) END AS mi
    FROM generate_series((SELECT min(d) FROM h), (SELECT max(d) FROM p), '1 day') g
    LEFT JOIN h ON h.d = g::date
    LEFT JOIN p ON p.d = g::date;
```

### 9.3 Rolling maxima and weekly means

```sql
-- peak rolling-7 and rolling-28, either segment
WITH r AS (
  SELECT d, mi,
         sum(mi) OVER (ORDER BY d ROWS BETWEEN  6 PRECEDING AND CURRENT ROW) AS r7,
         sum(mi) OVER (ORDER BY d ROWS BETWEEN 27 PRECEDING AND CURRENT ROW) AS r28,
         row_number() OVER (ORDER BY d) AS n
    FROM s)
SELECT round(max(r7),2) FROM r WHERE n >= 7 AND d <= '2026-09-03';   -- 52.35
-- ... and with `d > '2026-09-03'` for the plan segment, r28 for the month.

-- Monday-start calendar weeks
SELECT date_trunc('week', d)::date AS wk, round(sum(mi),2) AS mi
  FROM s GROUP BY 1 ORDER BY 1;
```

Best mean over N consecutive weeks is a window function over that weekly table
(`avg(mi) OVER (ORDER BY rn ROWS BETWEEN N-1 PRECEDING AND CURRENT ROW)`, taking the max).

### 9.4 Quality density

```sql
WITH q AS (
  SELECT DISTINCT (COALESCE(data->>'date', LEFT(data->>'startLocal',10)))::date AS d
    FROM runs
   WHERE user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
     AND NOT (data ? 'mergedIntoId')
     AND COALESCE(data->>'workoutType', data->>'type', '')
           IN ('tempo','threshold','intervals'))
SELECT date_trunc('week', d)::date AS wk, count(*) AS quality_days
  FROM q GROUP BY 1 ORDER BY 1;
```

### 9.5 The composed block and the app's readers

Read-only vitest harnesses under `web-v2/lib/plan/`, since deleted. Each sets
`process.env.DATABASE_URL` to `DATABASE_URL_RO` **before** any dynamic import that opens a
pool, then calls:

- `composeForUser({ userId, raceSlug: 'cim' })` — the composed block, its daily series and
  its `authoredState` stamps (`load_progression_contract`, `tier_band_anchor`,
  `rolling_seven_ceiling`, `ramp_base`);
- `mileageByDay(uid, '1900-01-01', '2999-12-31')` — the canonical reader, for §2;
- `loadPrescribedWindows(uid, '2026-09-03')`, `sustainedWeeklyMileage`,
  `normalWeeklyMileageDetail(28|90)`, `recentWeeklyMileageMi(uid, today, 28)` — §1.3.

A composed `DayPlan` carries `dow` (Sun=0), not a date; the date is
`week.startISO + ((dow − weekStartDow + 7) % 7)`, and the reconstructed week totals
reconcile against `week.weeklyMi` exactly, which is the check that the mapping is right.

**Nothing was written to production.** The session connected as `faff_readonly`; the write
barrier reported `writes REFUSED` in every harness run; `persistComposedPlan` is not
reachable from `composeForUser`; no plan was persisted and no rebuild triggered.
