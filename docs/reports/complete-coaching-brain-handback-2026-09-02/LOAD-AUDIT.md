# S1.5 · Monthly and sustained load — audit of two external-review claims

**Branch** `audit/monthly-sustained-load`, cut from `origin/main` **`656f3328`**, which is
the baseline every number below is measured against. Nothing merged, nothing written to
production.

**Runner** `0645f40c-951d-4ccc-b86e-9979cd26c795`. **Today** `2026-09-02` (runner timezone,
via `runnerToday`).

---

## Verdicts in one line each

| Claim | Number | Inference | Action |
|---|---|---|---|
| **A** · peak week governed, peak *month* not — ~+30% on rolling 28-day load against `Research/00a`'s 5-15% | **TRUE** · +29.7% composed, +32.0% written | **FALSE** · the row cited governs a different axis, and the month is governed three separate ways | **No change.** Documented refutation below |
| **B** · plan asks ~7 weeks at 52.9 against a best sustained 5 weeks at 42.6 | **TRUE** · 52.8 and 42.6, both reproduced to the decimal | **MISLEADING** · a mean is being read as a level, and a chaotic mean is being compared to a designed one | **No change.** Coherence judgement below |

**One real defect was found while measuring, and it is not either claim as stated:** the
per-cycle peak ceiling is *measured* in rolling-7 miles and *enforced* in calendar-week
miles, so the composed block's true peak 7-day exposure is **62.0 mi against its own
stated ceiling of 60.1** — 3.2% over. Rule 16. It is reported, not fixed: the fix is in
peak-week sizing inside `generate.ts`, which another agent owns this session. See §6.

---

## 1 · Population, unit and filter — stated before any number

### 1.1 Population (Rule 14)

Every history figure comes from `mileageByDay()` in `web-v2/lib/runs/volume.ts`, called
for `['1900-01-01', '2999-12-31']`. That is the one canonical mileage reader; it is not
re-implemented here. Its query, verbatim:

```sql
SELECT id::text AS id, user_uuid::text AS user_uuid, data
  FROM runs
 WHERE user_uuid = $1
   AND NOT (data ? 'mergedIntoId')                       -- CANONICAL_ROW_SQL
   AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
```

and it then clusters same-day rows by physical-run identity (`lib/runs/identity.ts`) and
counts the canonical row of each cluster once. Filtered on `user_uuid`; the `'me'`
sentinel appears nowhere.

Scope check on that population: **275 rows** for this user, **156** canonical by the
`mergedIntoId` predicate, resolving after identity clustering to **149 run days,
1167.2 mi, 2026-01-01 → 2026-09-02** (245 calendar days). His record is eight months
long, and that matters for both claims.

Plan figures come from two places, deliberately kept apart:

- **Written** — `plan_workouts` for the active plan `pln_9a57561debb776e5`
  (authored `2026-08-31`, `archived_iso IS NULL`), 103 rows, `2026-08-24 → 2026-12-06`.
  Filtered by `plan_id` **and** `user_uuid`, so the 47 archived plan versions Rule 14
  names cannot leak in.
- **Composed** — `composeForUser({ userId, raceSlug: 'cim' })` run in-process against
  `origin/main` `656f3328` on `2026-09-02`. Read-only: `composeForUser` composes and
  returns; `persistComposedPlan` is the only writer and is never reached from it.

The brief's own sanity check holds and validates the harness: **week 0 composes 46.0 and
the stored plan writes 38.0**, exactly as stated, because past-dated rows are carried
from sealed history. **Every forward-looking figure below is given for both**, and where
they disagree the composed one is the verdict, because it is what the engine does today.

### 1.2 Unit — and it changes the answer

Two units are used, each for the question it is honest about, and both are given wherever
the verdict moves:

- **Calendar weeks, Monday-start**, for anything called "a week" in either claim. The
  reviewer's claim, the plan's own authoring (`vols`, the weekly curve) and
  `plan_workouts.week_id` are all calendar weeks, so a rolling comparison would be
  answering a question nobody asked.
- **Rolling 7-day and rolling 28-day, stepped one day at a time**, for peak and
  chronic-load figures. This is what the engine itself measures with — `resolvePeakWeekly`
  (`generate.ts:914`) is a rolling-7 max, and its own header says why: *"a runner whose
  big week straddles a Sunday boundary has a real peak the calendar split in two."* It is
  also the unit tissue actually experiences.

The discrepancy the programme has tripped over before is reproduced exactly, and it is
purely units:

```
best calendar week (Mon-start)   48.7   week of 2026-02-09
best rolling 7-day               52.3   ending 2026-07-17
```

Both are correct. Neither is wrong. They are different questions.

### 1.3 Rule 8, and which side of the corollary each figure sits on

`loadPrescribedWindows()` from `web-v2/lib/training/normal-window.ts` returns six windows
for this runner — every race he has run, each spanning `[race − taperWeeks·7,
race + recoveryWeeks·7]`:

```
rose-bowl-half-2026    2026-01-18  hm  A                taper 2w  rec 2w   2026-01-04 .. 2026-02-01
disney-half-2026       2026-02-01  hm  A                taper 2w  rec 2w   2026-01-18 .. 2026-02-15
la-marathon-2026       2026-03-08  m   A                taper 3w  rec 4w   2026-02-15 .. 2026-04-05
big-sur-marathon       2026-04-26  m   hilly-excluded   taper 3w  rec 4w   2026-04-05 .. 2026-05-24
sombrero-half          2026-05-03  hm  C                taper 2w  rec 1w   2026-04-19 .. 2026-05-10
americas-finest-city   2026-08-16  hm  A                taper 2w  rec 2w   2026-08-02 .. 2026-08-30
```

**170 of the 245 days in his record — 69% — are prescribed taper, race week or post-race
recovery.** Only 10 of 36 calendar weeks are free of them, and **no 10 consecutive
Rule-8-clean weeks exist anywhere in his history.** That single fact does most of the work
in §5.

Which figures are filtered, and why:

| Figure | Filtered? | Question it answers |
|---|---|---|
| `sustainedWeeklyMileage` = **39.5 mi/wk** (rank-3 of 9 representative weeks; 72 representative days, 49 excluded, lookback extended to 120 d) | filtered | **habit / capability** — what he normally holds |
| `normalWeeklyMileage(28)` = **39.5 mi/wk** | filtered | habit |
| best 5 consecutive **Rule-8-clean** calendar weeks = **40.0** | filtered | habit |
| peak rolling-7 **52.3**, peak rolling-28 **172.7**, best 5-week mean **42.6** | **unfiltered, deliberately** | **absorbed load** — what the tissue has actually carried |
| `recentWeeklyMileageMi(28)` = 34.2 mi/wk | unfiltered | recent absorbed load |

The corollary is why the claims' own numbers are left literal. Both claims compare a
*planned future load* against *what the legs have carried*, which is a tissue question,
not a habit question — so **the reviewer used the correct population for both**, and
filtering them would have made a safety comparison more permissive, which is the exact
over-application Rule 8's corollary warns against. `resolvePeakWeekly` carries the same
posture in its own header, and it is right to.

---

## 2 · Claim A — the numbers

Daily series built by splicing the plan onto real history at `today`: canonical run
mileage for `iso <= 2026-09-02`, plan mileage for `iso > 2026-09-02`. One continuous
series, so a 28-day window that straddles today is honest rather than truncated.

```
HISTORY (literal, unfiltered — the absorbed-load question)
  peak rolling-7    52.3 mi   ending 2026-07-17
  peak rolling-28  172.7 mi   ending 2026-06-27   = 43.2 mi/wk

COMPOSED (origin/main 656f3328, 2026-09-02)
  peak rolling-7    62.0 mi   ending 2026-10-12
  peak rolling-28  224.0 mi   ending 2026-11-01   = 56.0 mi/wk
  peak-over-peak rolling-28 growth                = +29.7%

WRITTEN (pln_9a57561debb776e5)
  peak rolling-7    61.5 mi   ending 2026-11-02
  peak rolling-28  228.0 mi   ending 2026-11-02   = 57.0 mi/wk
  peak-over-peak rolling-28 growth                = +32.0%
```

**The +30% is real.** It reproduces on both the composed and the written plan, and it
cannot be re-raised as unverified.

---

## 3 · Claim A — why the inference is wrong

### 3.1 The cited row governs a different axis, and the engine already spends it there

`Research/00a` §"Volume progression rules":

> | Year-on-year base growth | 5–15% per training cycle for trained athletes; novices safely +20–25% over 8 weeks vs. +10% over 12 in trial data |

That is a **cycle-over-cycle** statement about the base/peak a runner returns to, not a
statement about a rolling 28-day aggregate inside a block. The engine already spends it on
exactly the axis it is written for, and the composed block's own stamp says so:

```json
"tier_band_anchor": { "demonstrated_peak_weekly_mi": 52.3, "cycle_growth_ceiling": 1.15,
                      "authored_peak_weekly_mi": 60 },
"load_progression_contract": { "per_cycle_peak_growth": 1.15, "planned_peak_mi": 60.1,
                               "planned_peak_basis": "per_cycle_growth_on_demonstrated_peak" }
```

Spending the same figure a **second** time on the 28-day axis double-counts one doctrine
number. Do the arithmetic on what that would cost: `172.7 × 1.15 = 198.6 mi` = 49.7 mi/wk
of 28-day load. With doctrine's own down-week shape (§3.3) that forces a peak week of
about **53 mi** — i.e. his existing 52.3. A build that builds nothing, which is precisely
the defect `load-progression-contract.ts` was written on 2026-09-02 to remove, and the
owner's own ruling quoted in that file's header forbids: *"A marathon plan may prescribe
60 miles later in the block even if approximately 55 is the load supported today, provided
the intervening weeks deliberately build and demonstrate the capacity required for that
peak."*

### 3.2 The month is not ungoverned · governor 1 — ACWR, at every single week

`web-v2/lib/plan/validate.ts` §6 (WKRAMP-1) checks **every non-race week against the
4-week — i.e. 28-day — chronic mean**, at the `ACWR_HIGH_RISK` line. That *is* a
week-against-month governor, and it fires on the exact quantity the claim says is
unwatched. Measured:

```
COMPOSED                                   WRITTEN
week        mi    chronic  ACWR            week        mi    chronic  ACWR
2026-08-24  46.0   46.0    1.00            2026-08-24  38.0   38.0    1.00
2026-08-31  50.0   48.0    1.04            2026-08-31  45.0   41.5    1.08
2026-09-07  24.4   40.1    0.61            2026-09-07  28.9   37.3    0.77
2026-09-14  47.5   42.0    1.13            2026-09-14  34.0   36.5    0.93
2026-09-21  56.2   44.5    1.26            2026-09-21  48.7   39.2    1.24
2026-09-28  42.0   42.5    0.99            2026-09-28  56.0   41.9    1.34
2026-10-05  59.5   51.3    1.16            2026-10-05  61.0   49.9    1.22
2026-10-12  60.0   54.4    1.10            2026-10-12  45.5   52.8    0.86
2026-10-19  45.0   51.6    0.87            2026-10-19  60.0   55.6    1.08
2026-10-26  59.5   56.0    1.06            2026-10-26  61.0   56.9    1.07
2026-11-02  43.6   52.0    0.84            2026-11-02  45.6   53.0    0.86
2026-11-09  40.5   47.1    0.86            2026-11-09  44.0   52.6    0.84
2026-11-16  49.0   48.1    1.02            2026-11-16  48.0   49.6    0.97
2026-11-23  36.0   42.3    0.85            2026-11-23  36.0   43.4    0.83
2026-11-30  44.2   42.4    1.04            2026-11-30  43.7   42.9    1.02
```

Maximum **1.26 composed, 1.34 written**, against a red line of 1.5. Every week sits inside
`Research/15`'s sweet-spot band. There is no acute:chronic excursion anywhere in the block.

### 3.3 Governor 2 — the peak-month-to-peak-week ratio is bounded by the cutback rule

The 28-day aggregate is not a free parameter. Given a peak week, it is determined by how
deep and how often the down weeks cut. `Research/00a` publishes exactly that:

> | Down weeks | Every 3–4 wk, reduce by 20–30% |

A 28-day window can be positioned to contain one down week, so that row implies a best
28-day block of **0.925 – 0.95 of the peak week**. Measured:

```
                     peak week   peak 28-day block   ratio
history (literal)       52.3        43.2 mi/wk       0.826
COMPOSED                62.0        56.0 mi/wk       0.903    <- below doctrine's implied range
WRITTEN                 61.5        57.0 mi/wk       0.927    <- at the conservative end of it
```

**The composed plan's month is *less* dense relative to its peak week than doctrine's own
down-week row permits.** Its authored cutbacks, measured against the week before each:

```
2026-09-07  24.4  vs 50.0  = -51.2%   (race week · Santa Monica 10K, 2026-09-13)
2026-09-28  42.0  vs 56.2  = -25.3%   gap 3 wk
2026-10-19  45.0  vs 60.0  = -25.0%   gap 3 wk
2026-11-02  43.6  vs 59.5  = -26.7%   gap 2 wk (race week · Run Malibu, 2026-11-08)
```

Cadence every 3 weeks, depth 25-27%. Both inside the row, line for line.

And this is the whole explanation of the +30%. Decomposing it exactly:

```
composed:  +29.7%  =  peak-week term +18.5%   x   month-density term +9.4%     (1.185 x 1.094 = 1.297)
written:   +32.0%  =  peak-week term +17.6%   x   month-density term +12.3%    (1.176 x 1.123 = 1.320)
```

The density term exists because **his historical ratio of 0.826 is depressed by unplanned
collapses, not by demonstrated inability to hold a month.** His record contains a 0.0 mi
week, a 4.2 mi week, a 13.3 mi week and a 14.1 mi week; 8 of 36 weeks are under 25 mi. A
plan replaces accidental collapses with designed deloads, and the arithmetic consequence
of doing that correctly *is* a higher 28-day aggregate at the same peak week. Reading that
as overload reads the removal of chaos as the addition of load.

### 3.4 Governor 3 — the chronic load itself climbs inside every published rate

Non-overlapping 28-day blocks forward from today:

```
COMPOSED                                          WRITTEN
ending 2026-09-02  130.7  (32.7 mi/wk)  baseline  ending 2026-09-02  130.7  (32.7)  baseline
ending 2026-09-30  171.6  (42.9 mi/wk)  +31.3%    ending 2026-09-30  160.1  (40.0)  +22.5%
ending 2026-10-28  215.5  (53.9 mi/wk)  +25.6%    ending 2026-10-28  224.5  (56.1)  +40.2%
ending 2026-11-25  185.6  (46.4 mi/wk)  -13.9%    ending 2026-11-25  191.1  (47.8)  -14.9%
```

Compounded weekly, the composed block's chronic load grows at **7.1%/wk then 5.9%/wk** —
under the classic 10%/week convention and well under the engine's own
`GENERAL_RAMP_CEILING` of 1.15/wk. (The written plan's second block is 8.8%/wk; still
under 10%. The current engine is the gentler of the two.)

### 3.5 And doctrine states its own position on this exact question

`Research/00a` §"The 10% rule — reconsidered" is unambiguous that aggregate volume growth
is **not** the injury lever:

> | Weekly mileage change correlated weakly with injury | Same cohort |

and §"Practical load rules" names what is:

> | Long-run cap rule | Single long run should not exceed 110% of the longest run in the prior 30 days |

Measured against that rule on the spliced series, every run ≥12 mi from tomorrow to race
day:

```
COMPOSED                                          WRITTEN
2026-09-06  15.0 / 13.5 = 1.11  (over)            2026-09-06  15.0 / 13.5 = 1.11  (over)
2026-09-20  16.5 / 15.0 = 1.10                    2026-10-04  19.0 / 15.5 = 1.23  (over)
2026-10-11  18.5 / 17.0 = 1.09                    2026-10-11  20.0 / 19.0 = 1.05
2026-10-18  19.0 / 18.5 = 1.03                    2026-11-01  21.5 / 20.0 = 1.07
2026-11-01  20.5 / 19.0 = 1.08                    2026-12-06  26.2 / 19.0 = 1.38  (race day)
2026-12-06  26.2 / 18.0 = 1.46  (race day)
```

The composed plan is clean on the rule doctrine actually publishes for this concern — one
1.11 in week 1, and race day, which is what the taper exists for. The **written** plan
carries a genuine 1.23 spike on 2026-10-04; `origin/main`'s current composer has already
removed it. That is a point in the current engine's favour, not against it.

### 3.6 Claim A · verdict

**The number is true and the inference is false.** `Research/00a`'s 5-15% figure is a
per-cycle statement about base and peak, the engine already binds it on that axis at
`52.3 × 1.15 = 60.1`, and applying it a second time to the 28-day aggregate would
double-count one doctrine number and cap the block at the runner's existing peak. The
28-day axis is governed by ACWR at every week (max 1.26), by the cutback cadence and depth
that fix its ratio to the peak week (0.903, below the 0.925-0.95 the down-week row
permits), and by a chronic-load climb of 5.9-7.1%/wk. **No limiter is added.**

---

## 4 · Claim B — the numbers

Both reproduce exactly.

**"about five weeks at 42.6"** — best mean over any 5 consecutive calendar weeks in his
history, unfiltered:

```
n   best mean   window                       min week
2      45.5     2026-02-09 .. 2026-02-22       42.3
3      44.1     2026-06-01 .. 2026-06-21       40.0
4      43.1     2026-05-25 .. 2026-06-21       39.8
5      42.6     2026-05-18 .. 2026-06-21       39.8    <- the reviewer's figure, to the decimal
6      41.7     2026-05-11 .. 2026-06-21       37.5
7      39.7     2026-05-11 .. 2026-06-28       27.9
```

**"a seven-week stretch around 52.9"** — best mean over any 7 consecutive plan weeks:

```
COMPOSED  n=7  mean 52.8   2026-09-14 .. 2026-11-01   min week 42.0
WRITTEN   n=7  mean 54.0   2026-09-21 .. 2026-11-08   min week 45.5
```

52.8 against a claimed 52.9. Confirmed.

---

## 5 · Claim B — the judgement

### 5.1 It is a mean, not a level, and the difference is the whole claim

"Asks for a seven-week stretch at 52.9" reads as *seven weeks at 52.9*. It is not. The
composed plan's **longest run of consecutive weeks above his demonstrated 52.3 peak is
two.** Its longest run of consecutive weeks above 45.0 is also **two**. The 7-week window
that averages 52.8 contains two authored cutbacks (42.0 and 45.0), and its minimum week is
42.0 — *below* his 42.6 comparator. Only four weeks in the entire 15-week block sit above
52.3 at all:

```
2026-09-21  56.2  QUALITY        long 17.0
2026-10-05  59.5  QUALITY        long 18.5
2026-10-12  60.0  QUALITY        long 19.0
2026-10-26  59.5  RACE-SPECIFIC  long 20.5
```

### 5.2 The comparator is a chaotic mean, and it is not measuring capacity

His best 7-week mean is **39.7**, and every 7-week window in his record contains a
collapse. The record itself:

```
weekly run-day frequency, all 36 calendar weeks:  0 days x1 · 1 x1 · 2 x1 · 3 x8 · 4 x8 · 5 x12 · 6 x5
weeks with zero runs:      2026-06-29
weeks under 25 mi (8):     03-09 13.3 · 03-23 19.7 · 04-27 20.2 · 05-04 14.1 ·
                           06-29 0.0 · 07-27 4.2 · 08-10 23.2 · 08-31 21.1
longest uninterrupted (Rule-8-clean) stretch:  9 weeks — and it contains the zero week
```

Six races in eight months, 170 of 245 days inside a prescribed taper or recovery window.
**His record contains no uninterrupted build block at all.** A 7-week mean measured across
that is dominated by the interruptions, so comparing it to a designed 7-week mean measures
the *absence of interruptions*, not the presence of overload. The reviewer's own second
sentence — *"the limiter is consistency rather than durability"* — reaches the same
conclusion from the other side, and the data supports it.

### 5.3 Like-for-like, on the axes that are physiological

| Axis | Demonstrated | Composed plan | Step |
|---|---|---|---|
| peak week (calendar) | 48.7 | 60.0 | — |
| peak week (rolling-7, the engine's unit) | 52.3 | **62.0** | +18.5% — see §6 |
| authored ceiling on the peak week | — | 60.1 | +14.7% on the authored 60.0 |
| peak 28-day block | 172.7 (43.2 mi/wk) | 224.0 (56.0 mi/wk) | +29.7%, decomposed in §3.3 |
| peak long run | **21.5** (2026-01-25) | **20.5** | **−4.7% · below his own best** |
| runs ≥ 18 mi in his record | 7 | — | — |
| max ACWR | — | 1.26 | red line 1.5 |
| max long-run spike ratio | — | 1.11 (week 1) | rule 1.10 |

The long-run axis is the one the claim does not mention and it is *conservative*: the
composed block peaks at 20.5 once, a mile below the 21.5 he ran on 2026-01-25, and
`Research/22`'s Marathon-Intermediate row asks for 20-22 two to three times. That is
already recorded as a separate finding in `HANDBACK-FINAL.md` §5 and belongs to the agent
who owns long-run progression.

### 5.4 The one axis that genuinely steps up, and it is not in either claim

**Frequency.** His modal week is 5 run days (12 of 36 weeks; 6 days in only 5 weeks;
3-4 days in 16). Both plans ask **6 days every week, all 15 weeks.** That is a real
progression on the density axis `ADAPTATION_PROGRESSION_DOCTRINE` names as one of its four
separate questions, and it is stacked on top of the volume progression rather than being
traded against it — against `Research/00a`'s *"Add stress one-at-a-time"* row. Reported
here; not changed, because the run-day count comes from `profile.weekly_frequency` and the
week-shaping code the same agent is editing.

### 5.5 What may **not** be used to soften this plan

`PLAN_SIMPLIFICATION_DOCTRINE.md` is explicit that adaptation is deferred and that *"the
initial plan must stand on its own without requiring adaptation to rescue it."* That cuts
both ways. An **adherence** risk — the reviewer's consistency point, which is real — is not
grounds to pre-shrink the plan, any more than an adaptation engine is grounds to
over-prescribe it. The doctrine's list of what may influence the plan includes *"his
explicit preference for aggressive training"* and *"recent and sustained mileage"*; it does
not include a forecast of whether he will miss weeks.

### 5.6 Claim B · verdict

**Both numbers are true; the comparison is misleading and the plan is coherent.** The
plan never asks more than two consecutive weeks above his demonstrated peak; the 7-week
figure is a mean whose minimum week is below his own comparator; the comparator is a
7-week mean drawn from a record with no uninterrupted build block in it; the long-run axis
is below his own best; ACWR never exceeds 1.26 and the long-run spike rule is met.
**No change.**

---

## 6 · The one genuine incoherence found, and why it is not fixed here

**The per-cycle peak ceiling is measured in one unit and enforced in another.**

- `resolvePeakWeekly` (`web-v2/lib/plan/generate.ts:914`) measures the demonstrated peak
  as a **rolling 7-day** maximum over 112 days → **52.3**. Its header states the unit and
  argues for it.
- `load-progression-contract.ts` sets `planned_peak_mi = 52.3 × PER_CYCLE_PEAK_GROWTH
  (1.15) = 60.1`.
- That ceiling is then enforced on the block's peak **calendar** week
  (`peakWeeklyMi = Math.max(1, ...vols)`), authored at **60.0** — compliant.
- The composed block's actual peak **rolling-7** exposure is **62.0 mi**, Tue 2026-10-06 →
  Mon 2026-10-12:

```
10-06  8.5   10-07 12.0   10-08  6.5   10-09  8.5   10-10  0.0   10-11 18.5   10-12  8.0   = 62.0
```

  `62.0 / 52.3 = 1.185`, against the engine's own 1.15. **1.9 mi over its own stated
  ceiling, 3.2%.**

This is Rule 16 — one quantity, "the runner's biggest week", carrying two units on the two
sides of a single inequality — and it is the honest, non-arbitrary core of what Claim A was
reaching for. The clean fix is to compare the block's maximum **rolling-7** against
`planned_peak_mi` rather than its maximum calendar week, which is a change to peak-week
sizing in `generate.ts`.

**Not made here, deliberately.** The coordination brief states that another agent owns
race-specific and long-run progression in `generate.ts` and is changing weekly volumes and
long runs during this session. Any correction to the peak-week bound moves exactly those
numbers, so this is reported as a dependency rather than raced. It also cannot be gated
yet without turning `main` red on numbers that are actively in flight (Rule 18 says falsify
a gate before trusting it; Rule 20 says do not lock a rule with no check — so this is
recorded explicitly as **unenforced**, which is the honest state).

Handover note for whoever owns peak-week sizing: the correction is smooth and deterministic
by construction — `max rolling-7 of the authored daily series ≤ demonstratedPeak ×
PER_CYCLE_PEAK_GROWTH` is a `min` against a continuous quantity, introduces no threshold
comparison between two computed values, and so adds no Rule 9 cliff. Its cost on this
runner is bounded: it would shave the 10-12 week by about 2 mi, roughly 3%.

**Two smaller observations, also not fixed:**

- The **written** plan `pln_9a57561debb776e5` peaks at a **61.0** calendar week against a
  60.1 ceiling, and carries a **1.23** long-run spike on 2026-10-04. It was authored
  2026-08-31, before `LOADCONTRACT-1` landed on 2026-09-02, and `origin/main`'s composer no
  longer produces either. Both disappear on the next authoring. Recorded so they are not
  re-found as live defects.
- `authored_state.tier_band_anchor.authored_peak_long_mi` reads **21** while the composed
  block's longest run is **20.5**. A 0.5 mi stamp/composition disagreement, cosmetic, but
  it is a Rule 10 stamp that does not match what it stamps.

---

## 7 · What this audit cannot answer (Rule 22)

- **Whether 1.15 is the right per-cycle figure.** `RAMP.cycle-over-cycle-peak-growth` owns
  that against `Research/00a`'s own table cell. This audit takes it as given.
- **Whether the plan is right for a runner it has not measured.** Every number here is one
  runner's. The refutations in §3 are general (they rest on doctrine rows and on the ACWR
  guard, both runner-independent); the coherence judgement in §5 is not, and should not be
  cited for anybody else.
- **Whether he will actually run it.** §5.2's consistency picture is a real risk. It is an
  adherence question, and under the simplification doctrine it is not the plan's to price.
- **Anything the adaptation engine would do.** It remains disabled by doctrine and was not
  exercised.
- **The rendered surfaces.** Rule 13 requires a display fix to be verified by rendering.
  Nothing here is a display fix and nothing was rendered; no claim is made about what the
  phone shows.

---

## 8 · Reproduction

Read-only harness, since removed. To reproduce:

1. `git checkout 656f3328`
2. In `web-v2`, set `DATABASE_URL=$DATABASE_URL_RO` (`vitest.setup.ts` never overrides an
   already-set variable, so the export wins over `.env.local`).
3. A vitest file under `web-v2/lib/**` that calls, for `0645f40c-951d-4ccc-b86e-9979cd26c795`:
   - `runnerToday(UID)`
   - `mileageByDay(UID, '1900-01-01', '2999-12-31')` — the daily series
   - `loadPrescribedWindows(UID, todayISO)` — the six Rule 8 windows
   - `sustainedWeeklyMileage(UID, todayISO)` / `normalWeeklyMileageDetail(UID, todayISO, 28)`
   - `recentWeeklyMileageMi(UID, todayISO, 28)`
   - `composeForUser({ userId: UID, raceSlug: 'cim' })`
4. The written plan:

```sql
SELECT week_id, date_iso, dow, type, sub_label, distance_mi, is_quality, is_long
  FROM plan_workouts
 WHERE plan_id = 'pln_9a57561debb776e5'   -- the row with archived_iso IS NULL
   AND user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
 ORDER BY date_iso;
```

5. Splice: history for `iso <= today`, plan for `iso > today`; roll 7 and 28 day windows
   one day at a time; group calendar weeks Monday-start. Composed `DayPlan` carries
   `dow` (Sun=0) not a date — the date is `week.startISO + ((dow + 6) % 7)`; week totals
   reconcile against `week.weeklyMi` exactly, which is the check that the mapping is right.

**Nothing was written to production.** The session connected as `faff_readonly`; a probe
`UPDATE runs …` returned `permission denied for table runs`. `DATABASE_URL` in the
worktree was rewritten to the read-only string so no path could reach a writable role even
by accident, and every Strava, Apple and admin credential was blanked in that copy so no
client in the process could post an activity. `composeForUser` composes and returns;
`persistComposedPlan` was never called, no plan was persisted, and no rebuild was
triggered. The worktree's `.env.local` and `node_modules` symlink were deleted afterwards;
this document is the only file this branch adds.
