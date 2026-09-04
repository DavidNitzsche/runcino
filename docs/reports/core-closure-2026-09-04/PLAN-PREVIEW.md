# Plan preview — CIM block, corrected week-by-week

**Read-only.** Subject: the owner's live block, plan `pln_7636bcc0a201bf2d`,
user `0645f40c-951d-4ccc-b86e-9979cd26c795`, authored 2026-09-03, last adapted
2026-09-04 12:13 UTC. Goal race CIM 2026-12-06, stated goal 3:00:00. Every
CURRENT number below was read off `plan_workouts` on the active plan over
`DATABASE_URL_RO`, with `default_transaction_read_only = on`. **Nothing was
written.** PROPOSED numbers are a paper preview only.

Today is **2026-09-04**. Weeks before 2026-09-05 are sealed history and are not
touched. The 2026-09-04 long run (15 mi prescribed) was executed at 15.51 mi.

---

## 0 · Three corrections to the baseline audit, before anything else

**C-1 · The peak long run is on 2026-11-01, not 2026-10-25.**
`BASELINE-PLAN-AUDIT.md` §S4-1 says "21.5 mi on 2026-10-25, forty-two days
before race day". Its own table disagrees with its prose (W10 starts 10-26).
The database is unambiguous:

```
2026-10-25 Sun | long | 15mi   | LONG
2026-11-01 Sun | long | 21.5mi | LONG
```

The peak long is **2026-11-01 — 35 days (5 weeks) out**, not 42. The finding
survives the correction but is one week less severe than stated.

**C-2 · "Only two runs reach 20 miles" is inside doctrine, not outside it.**
`Research/22` §"Marathon — Intermediate" (peak weekly volume 45-55 mi, 5-6
days/wk — the tier this runner's demonstrated base sits in) specifies
**"Peak long run | 20-22 mi (2-3 times)"**. The block has exactly two, at the
low edge of the band. The count is not the defect. What the same table also
says, and the block does not deliver, is the row underneath it:
**"MP runs (8-14 mi w/ 8-12 @ M)"** and a sample peak-week Sunday of
**"20 mi LR w/ last 14 @ M"**. The gap is marathon-pace *density*, not
long-run *count*.

**C-3 · The Malibu recovery cost cited in the brief is the A-race row.**
`Research/00b` §"Recovery by Distance" gives half marathon = 10-14 days no
quality, 21-28 days to next race effort. The very next section,
§"Recovery by Effort (A vs. B vs. C Race)", scales that: a **B race** gets a
7-10 day taper and **"60-70% of A-race recovery duration"**, and states in its
own words: *"For a B-race half marathon, expect 7-10 days of recovery rather
than 14."* Malibu is priority B. So the correct figures are:

| Metric | A-race half | B-race half (60-70%) | Where CIM falls |
|---|---|---|---|
| Total recovery days, no quality | 10-14 | **7-10** | — |
| Return to long runs | day 7-10 | **day 5-7** | — |
| Return to quality | day 10-14 | **day 7-10** | — |
| Earliest next race effort | 21-28 d | **14-20 d** | CIM is **day 28** |

**CIM is 28 days after Malibu.** It clears even the unscaled A-race band. The
half does not compromise CIM by the race-effort metric. What it does cost is
the *shape* of the two weeks either side of it — which is a scheduling cost,
not a recovery cost, and the two must not be conflated.

---

## 1 · The measured runner, which constrains every proposal below

Read from `runs`, canonical rows only (`NOT (data ? 'mergedIntoId')`):

| Fact | Value |
|---|---|
| Highest measured weekly volume, 2026 | **47.5 mi** (wk of 2026-07-20) |
| Next highest | 47.3, 45.8, 44.9, 43.9 |
| Longest measured **training** run, last 90 days | **18.0 mi** (2026-07-25) |
| Longest measured training run, 2026 | 21.51 (2026-01-25), 20.02 (2026-04-05), 20.00 (2026-02-15) |
| Marathons run 2026 | 26.70 (03-08), 26.81 (04-26 Big Sur) |
| Plan's peak week | **60.0 mi** — **+26% above anything demonstrated** |
| Plan's peak long | 21.5 mi — matches his 2026 best (21.51, January) |

**This is the single most important constraint on this preview.** The block
already asks for 26% more weekly volume than he has ever recorded, and a long
run equal to his 2026 maximum. Anything that adds *more* maximal work is
spending headroom that does not exist.

**And the block is already over the long-run share cap.** `Research/00a`
§"Long-run rules of thumb": *"Long run cap: 25-30% of weekly volume."*
Measured across the live block:

| Week | Long / Volume | Share | vs 25-30% cap |
|---|---|---|---|
| 09-14 | 16.5 / 46.8 | 35.3% | over |
| 09-21 | 17.0 / 55.2 | 30.8% | over |
| 09-28 | 14.0 / 43.0 | 32.6% | over |
| 10-05 | 18.5 / 59.5 | 31.1% | over |
| 10-12 | 20.0 / 59.6 | 33.6% | over |
| 10-19 | 15.0 / 46.0 | 32.6% | over |
| 10-26 | 21.5 / 60.0 | **35.8%** | over |
| 11-09 | 16.0 / 40.5 | **39.5%** | over |
| 11-16 | 16.0 / 49.0 | 32.7% | over |

**Nine of nine non-taper weeks exceed the cap.** The long run is already
carrying too much of this runner's week — because the surrounding volume is
thin, not because the long runs are long. To fit a 21.5 inside a 30% cap you
need a 72-mile week. He is at 60 and has never run 48.

That is the measured answer to "only two runs reach 20 miles": **a third
maximal long run makes an already-out-of-band ratio worse, on a runner whose
last 90 days top out at 18.0.**

---

## 2 · The finding the baseline audit did not name

`Research/22` §"Marathon — Intermediate" specifies the phase structure:
*"Endurance (5 wk) → LT + endurance (6 wk) → **race prep (4 wk, MP runs)** →
taper (3 wk)"*.

Anchoring the 3-week taper on race week, the race-prep phase for a 2026-12-06
marathon is **2026-10-19 through 2026-11-15**. What the live block puts there:

| Week | Long run | Marathon-pace miles |
|---|---|---|
| 10-19 | 15.0 plain | 0 |
| 10-26 | 21.5 plain | 0 |
| 11-02 | (Malibu Half) | 0 |
| 11-09 | 16.0 w/ 4 @ M | **4** |

**Four marathon-pace miles in the entire four-week race-prep phase.** The
block's largest MP dose — 8 mi, on 2026-10-18 — sits one week *before* the
phase that is supposed to own it, and the phase's own peak long run (21.5) is
prescribed as a plain easy run at 8:40/mi.

`Research/00a` §"Long-run variants" names 2026-11-01 precisely:
*"**Dress rehearsal** | Mid-cycle long run that simulates race day... | Once
per cycle, **3-6 wk before race**"*. 11-01 is 5 weeks out. It is the
dress-rehearsal slot, and it is currently spent as a plain easy long run.

That is the defect worth fixing. Not the 20-mile count.

---

## 3 · CURRENT vs PROPOSED, week by week

Pace legend, taken from the plan's own `workout_spec` (all priced by the
engine's race-pace brain off **current evidence**, never off the stated goal):
**M** 7:52/mi (472 s) · **T** 7:10/mi (430 s) · **ST** 7:25/mi (445 s) ·
**I** 6:41/mi (401 s) · easy long 8:40/mi (520 s) · CIM race target 7:46/mi
(466 s, = 3:23:47 evidence projection; stated goal 3:00:00 is not what these
are priced at).

Weeks are Monday-start; the plan's long-run day is Sunday, so plan weeks and
calendar weeks coincide.

### Weeks 1-2 (08-24, 08-31) — SEALED HISTORY, not touched

38.0 mi / long 13.0, and 46.5 mi / long 15.0. Executed. Out of scope.

---

### W3 · 2026-09-07 — Santa Monica 10K (B) — **CHANGED**

| | Volume | Long | M miles @ pace | T / I work | Race + effort | Recovery spacing | Taper phase |
|---|---|---|---|---|---|---|---|
| **CUR** | 24.4 (**−47.5%** off 46.5) | 6.2 (race) | 0 | 3.5 @ T (Tue) | 09-13 10K, **B**, race effort, 6:56/mi | Tue→Sun = 5 d | 10K mini-taper |
| **PRO** | **31.4** (−32.5%) | 6.2 (race) | 0 | 3.5 @ T (Tue) — unchanged | unchanged | Tue→Sun = 5 d | 10K mini-taper |

Edits: `09-07 Mon rest → 4.0 easy` · `09-09 Wed 5.0 → 7.0` · `09-10 Thu 5.0 → 6.0`.

**REASON.** `Research/08` §9.1 gives the 10K row a **30-40%** volume reduction.
The block cuts **47.5%** — 7 to 17 points deeper than doctrine, for a **B**
race, where `Research/00b` §"Recovery by Effort" allows only a *1-week taper*.
The same section shows the mirror-image error one page later on the half
(W11 below): same priority, opposite direction. Fixing both brings the two B
races into their own distance's band rather than into agreement with each
other. Secondary: §9.1 also rules *"Run frequency is maintained at ~80% of
normal. Don't suddenly add rest days"* — the week drops from 6 running days to
5; restoring Monday returns it to 6. Cost: nothing. The 7 recovered miles are
all easy aerobic, 3-6 days out from a 10K.

---

### W4 · 2026-09-14 — **UNCHANGED**

46.8 mi · long 16.5 w/ **3 @ M + 1 @ E + 2 @ M** (5 MP mi) · 2×1.5 @ T (Fri) ·
no race · post-10K quality returns day 5 (`Research/00b` 10K row: return to
quality day 7-10 at A-scale, day 5-7 at B-scale — compliant) · not tapering.
The modified-block long run is the right first marathon-specific step and the
progression it starts is preserved intact.

### W5 · 2026-09-21 — **UNCHANGED — deliberately**

55.2 mi · long 17.0 (Sun) · 0 MP · 5.5 @ T (Tue) · **09-26 Dodgers 10K, C,
`race_execution.source = "controlled_c_effort"`, `feasibility = "comfortable"`,
7:35/mi** · race Sat → long Sun, back-to-back · no taper (correct for a C race:
`Research/00b` "C race | Strong effort, no taper | 0-3 days easy").

The 17 is **103%** of the prior-30-day longest (17.0 on 09-20), inside
`Research/00a`'s 110% single-session spike red line. The aggressive weekend is
doctrine-cited and stays exactly as authored.

### W6 · 2026-09-28 — **UNCHANGED**
43.0 mi (cutback, −22% — `Research/00a` "Down weeks: every 3-4 wk, reduce by
20-30%") · long 14.0 · 0 MP · 7×800 @ I (Thu) · no race · Thu→Sun 3 d.

### W7 · 2026-10-05 — **UNCHANGED**
59.5 mi · long 18.5 · 0 MP · 4.5 @ T (Tue) + 5-rung 1km ladder MP→5K (Thu) ·
no race · Tue→Thu 2 d, Thu→Sun 3 d.

### W8 · 2026-10-12 — **UNCHANGED**
59.6 mi · long 20.0 w/ **5 @ M + 1 @ E + 3 @ M** (8 MP mi) · 9×1km @ ST (Tue) ·
no race · Tue→Sun 5 d.

Held deliberately. 16.5/5-MP → 20/8-MP is a clean single-generation step in
both duration and dose; `ADAPTATION_PROGRESSION_DOCTRINE` ("progress one
primary stressor at a time") argues against pushing it further, and this is
the session the whole marathon-specific progression is built on.

### W9 · 2026-10-19 — **UNCHANGED**
46.0 mi (cutback) · long 15.0 plain · 0 MP · 4.5 @ T (Tue) + 8×3min @ I (Thu) ·
no race.

Considered and rejected: adding MP to the 10-25 long. `Research/00a` rules
*"Most long runs are easy; intensity inserts come 1 in every 2-3 long runs"* and
*"Don't make every long run a progression — rotate."* Loading a cutback long
and then the peak long back-to-back breaks both. The cutback stays a cutback.

---

### W10 · 2026-10-26 — peak week — **CHANGED (one session)**

| | Volume | Long | M miles @ pace | T / I work | Race + effort | Recovery spacing | Taper phase |
|---|---|---|---|---|---|---|---|
| **CUR** | **60.0** (peak) | **21.5** plain, 8:40/mi | **0** | 6 @ T (Tue) · 9×3min @ I (Thu) | none | Tue→Thu 2 d, Thu→Sun 3 d | none |
| **PRO** | **60.0** (unchanged) | **21.5 w/ last 5 @ M** | **5 @ 7:52** | unchanged | none | unchanged | none |

Edit: `11-01 Sun long 21.5 plain → 21.5 with a 5-mile fast finish at M`.
Volume, distance, week shape, quality-day count: all unchanged.

**REASON.** This is the dress-rehearsal slot — `Research/00a` §"Long-run
variants": *"Dress rehearsal ... Once per cycle, 3-6 wk before race."* 11-01 is
5 weeks out and is the last long run in the block that is neither inside the
half's window nor inside the marathon taper. Spending it as a plain easy run
is the single largest missed opportunity in the block.

**Sized as a fast finish, not an MP block, on purpose.** `Research/00a`:
*"Fast finish | Final 10-25% at half-marathon-to-MP effort."* 5 / 21.5 =
**23%**, inside that band. A full 10-12 mi MP block here would be the
`Research/22` "20 mi LR w/ last 14 @ M" session — but 11-01 is **7 days before
the Malibu half**, and `Research/00b` §"Recovery by Effort" gives a B race a
7-10 day taper. A 5-mile finish is the largest specific dose that does not eat
that taper. Total session time ≈ 2:57, inside `Research/00a`'s absolute
long-run ceiling (*"<3.0-3.5 h for marathoners"*).

**Bail condition, stated up front** (`Research/00a`, MP long runs: *"Skip if
accumulated fatigue is high"*): this week already carries a 6 @ T and a 9×3min
@ I. If either goes badly, the fast finish is the first thing dropped and the
21.5 runs plain. This is the one week in the preview that runs hot, and it is
flagged rather than hidden.

---

### W11 · 2026-11-02 — Run Malibu Half (B) — **CHANGED**

| | Volume | Long | M miles @ pace | T / I work | Race + effort | Recovery spacing | Taper phase |
|---|---|---|---|---|---|---|---|
| **CUR** | 43.2 (**−28.0%** off peak 60) | 13.1 (race) | 0 | **6 @ T**, 5 days out | 11-08 Half, **B**, 7:20/mi, target 1:36:01 vs stated 1:30:00, `feasibility: "aggressive"` | Tue→Sun 5 d | **none** |
| **PRO** | **37.6** (−37.3%) | 13.1 (race) | 0 | **3 @ T**, 5 days out | unchanged | Tue→Sun 5 d | **7-day B-race taper** |

Edits: `11-03 Tue 10.0 (6 @ T) → 7.0 (3 @ T)` · `11-04 Wed 7.6 → 6.0` ·
`11-05 Thu 6.0 → 5.0`. Running days held at 6.

**REASON.** `Research/08` §9.1 gives the half marathon row a **30-50%**
reduction; the week is at **−28%**, outside the band. `Research/00b`
§"Recovery by Effort" gives a B race a **7-10 day taper** and this week has
none. The 6 mi @ T five days out is a full threshold session, not a sharpener;
halving it to 3 mi preserves the intensity §9.1 says to keep (*"The largest cut
is to easy mileage; intensity is preserved through the taper"*) while removing
the volume it says to cut.

This is the direct answer to inconsistent-taper finding #4: **W3 was 17 points
too deep, W11 is 9 points too shallow, and both are priority B.** They are not
made to match each other — each is brought inside `Research/08` §9.1's band for
*its own distance*, which is what the doctrine actually indexes on.

---

### W12 · 2026-11-09 — post-half — **CHANGED**

| | Volume | Long | M miles @ pace | T / I work | Race + effort | Recovery spacing | Taper phase |
|---|---|---|---|---|---|---|---|
| **CUR** | 40.5 | **16.0 w/ 4 @ M** on day 7 post-half | **4 @ 7:52** | none | none | no quality prescribed | post-race recovery |
| **PRO** | **46.0** | **18.0 easy**, no MP, on day 7 | **0** | none | none | no quality until day 14 | post-race recovery |

Edits: `11-15 Sun 16.0 (4 @ M) → 18.0 easy, MP removed` · `11-11 Wed 5.0 → 8.0
(medium-long)` · `11-13 Fri 5.0 → 5.5`.

**REASON — two, and they point the same way.**

*Recovery.* `Research/00b` §"Recovery by Effort", B-race half scaled to 60-70%:
return to **long runs day 5-7**, return to **quality day 7-10**. 11-15 is
**day 7**. A long run there is inside its window; four miles at marathon effort
there is quality at the very first hour of its window, seven days after a raced
half. Removing the MP and adding two miles of easy distance takes the session
from the wrong side of one band to the middle of the other.

*Placement.* 11-15 is **21 days out** — the outer edge of `Research/08` §9.1's
*"Marathon | 14-21 days"* taper. It is the last long run in the block that
sits **outside** the taper. Extending it is free; sharpening it is not.

The five identical 5.0-mile easy days in the current week are also a
CLAUDE.md Rule 12 / Rule 17 finding in their own right (*"Four identical easy
days is a template, not a plan"*); the Wednesday medium-long and the varied
Friday fix that as a by-product, not as the point.

---

### W13 · 2026-11-16 — taper −3 — **CHANGED**

| | Volume | Long | M miles @ pace | T / I work | Race + effort | Recovery spacing | Taper phase |
|---|---|---|---|---|---|---|---|
| **CUR** | 49.0 (81.7% peak) | 16.0 w/ **5 @ M** | **5 @ 7:52** | `race_week_tuneup` 4.0 mi, 5×400 @ 5K (Tue 11-17) | none | Tue→Sun 5 d | **−3** |
| **PRO** | **51.0** (85.0% peak) | 16.0 w/ **10 @ M** | **10 @ 7:52** | tune-up **removed** → 6.0 easy | none | single key session, Sun; day 14 post-half | **−3** |

Edits: `11-17 Tue race_week_tuneup 4.0 → 6.0 easy` · `11-22 Sun long 16.0
(5 @ M) → 16.0 (10 @ M)`.

**REASON.** `Research/08` §9.2's **−3 row asks for exactly this**: *"Final
MP-specific (**14-16 mi w/ 10-12 mi at MP**)"*. The block prescribes 16 mi with
5. Raising the dose to 10 lands the row literally, at the bottom of its band,
with no change to the run's distance. Volume goes to 85% of peak — §9.2's −3
row is 80-90%.

**Why this is affordable at 14 days out and a 20-22 miler is not.** 16 mi with
10 at M ≈ **2:11** total (6 easy at 8:40 + 10 at 7:52). A 21-mile run at the
same effort mix is ≈ 3:00. The specific stimulus is nearly doubled while the
session's duration *falls* by 49 minutes against the block's peak long. That is
the trade this preview is built on.

**The tune-up removal has two independent justifications.** (a) It is a 5×400
@ 5K session sitting **9 days** after the half, inside `Research/00b`'s B-scaled
7-10 day no-quality window. (b) `Research/08` §9.2 places that session in the
**−1** row, *"4-5 days out"* — where it already exists, identically, on
2026-12-01. Printing the same session twice is CLAUDE.md Rule 17. Note this is
also the row carrying the S4-2 `race_week_tuneup` type-name defect; that defect
is authoring-side and is **not** what is being proposed here — the content is
misplaced independently of the name.

---

### W14 · 2026-11-23 — taper −2 — **CHANGED**

| | Volume | Long | M miles @ pace | T / I work | Race + effort | Recovery spacing | Taper phase |
|---|---|---|---|---|---|---|---|
| **CUR** | 36.0 (60.0% peak) | **10.0 plain** | 0 | 4.5 @ T (Tue) | none | Tue→Sun 5 d | **−2** |
| **PRO** | **39.0** (65.0% peak) | **13.0 w/ last 3 @ M** | **3 @ 7:52** | 4.5 @ T (Tue) — unchanged | none | Tue→Sun 5 d | **−2** |

Edit: `11-29 Sun long 10.0 plain → 13.0 with the last 3 @ M`.

**REASON.** `Research/08` §9.2's −2 row: long run *"**12-14 mi w/ MP miles
late**"*, quality *"6-8 mi at MP, or 4-5 mi threshold"*. The Tuesday 4.5 @ T
already satisfies the quality cell exactly. The long run cell asks for 12-14
with MP late and the block gives 10 plain. Three MP miles at the end of a 13,
seven days out, is the smallest change that lands the row; volume moves to 65%
of peak, mid-band for §9.2's 60-70%.

---

### W15 · 2026-11-30 — race week — **UNCHANGED, and this is a deliberate refusal**

43.7 mi including the race; **17.5 non-race = 29.2% of peak** ·
`race_week_tuneup` 4.5 mi, 5×400 @ 5K on **Tue 12-01 = 5 days out** · Sat
shakeout 2.0 · **12-06 CIM, A, 7:46/mi target (3:23:47 evidence projection),
mile-10 abort checks at 163 bpm / 8:09 pace**.

`Research/08` §9.2's −1 row says 40-50% of peak, i.e. 24-30 mi. The week is at
29%. **I am not raising it.** The band is written for a week whose long run is
a *"'Freshener' 8-10 mi"*; here that slot is occupied by a 26.2-mile race.
Adding six miles of easy running in the six days before a goal marathon to
satisfy a percentage buys nothing and costs freshness. The tune-up's day (−5)
and character (5×400 @ 5K ≈ 80-85 s reps, against §9.2's "4-6 × 1 min at 5K
pace") both land, and §9.1 forbids anything novel in the final 10 days.

---

## 4 · What changes, in totals

| Measure | CURRENT | PROPOSED | Δ |
|---|---|---|---|
| Peak weekly volume | 60.0 | **60.0** | **0** |
| Longest single run | 21.5 (11-01) | **21.5 (11-01)** | **0** |
| Runs ≥ 20 mi | 2 | **2** | **0** |
| Total volume, 09-05 → 12-06 | 614.4 | 626.3 | **+11.9 (+1.9%)** |
| Marathon-pace miles, 09-05 → race | 22 | **31** | **+9** |
| Marathon-pace miles, final 6 weeks (10-26 →) | 9 | **18** | **+9 (doubled)** |
| MP miles in the 4-wk race-prep phase (10-19 → 11-15) | 4 | 5 | +1 — see note |
| Quality sessions removed | — | 1 (misplaced 5×400 tune-up) | −1 |
| Miles at T pace (430 s/mi) | 37.5 | 34.5 | −3.0 |
| Weeks changed | — | 6 of 13 future weeks | — |
| Weeks unchanged | — | **7 of 13** | — |

**Note on the race-prep row.** The proposal adds only one MP mile *inside* the
nominal race-prep window, and that is the finding, not a shortfall in the
proposal: 10-25 is a cutback, 11-01 is 7 days pre-half, 11-08 is the half, and
11-15 is day 7 post-half. **The phase is structurally full.** The marathon-
specific dose therefore lands at −14 days (11-22), immediately after the window
closes, which is where `Research/08` §9.2 puts it anyway. The baseline audit
was right that the half costs the weeks either side of it; what it did not say
is that those weeks *are* the race-prep phase.

**Direction ledger** (CLAUDE.md Rules 21/22 — the bar to go up must not be
higher than the bar to come down). Changes that push **up**: +9 MP miles,
+7 mi restored to W3, +5.5 to W12, +2 to W13, +3 to W14, long run 16 → 18 on
11-15. Changes that pull **down**: −5.6 mi in the Malibu taper week, −3 mi at
T, one misplaced session removed. **Five up, three down**, and every downward
change is a taper or a duplicate, not a capability judgment.

**MP-dose progression across the block:** 5 (09-20) → 8 (10-18) → 5 fast-finish
(11-01) → 0 (11-15, post-half) → **10 (11-22)** → 3 (11-29) → race. Monotone in
specificity through the build, with the peak specific session at −14 days and a
clean recovery notch after the half.

**Spike-rule check** (`Research/00a`: >110% of the longest run in the prior 30
days = 64% increased overuse injury risk). Every proposed long run passes:
11-15's 18.0 against a 21.5 prior max (84%); 11-22's 16.0 against 21.5 (74%);
11-29's 13.0 against 21.5 (60%). No proposed session moves this needle at all,
because no proposed session is longer than one already in the plan.

**Long-run share** (`Research/00a` cap 25-30%): the proposal does not fix this
and does not pretend to. W12 goes 39.5% → 39.1%, W13 32.7% → 31.4%, W14 27.8%
→ 33.3%. The block runs over the cap because weekly volume is thin relative to
the long run, and the only two fixes are shorter long runs (wrong for a
marathon) or a higher weekly base (not demonstrated — his ceiling is 47.5).
Named here so it is not mistaken for something this preview closed.

---

## 5 · (a) The preferred recommendation

**Spend the last six weeks on marathon-pace density, not on a third
twenty-miler. Keep the peak volume at 60 and the peak long at 21.5 exactly
where they are; convert the block's under-used long runs into the
marathon-specific sessions doctrine already asks for.**

Six edits, in priority order:

1. **`11-22`: 16 mi with 10 @ M** (from 5 @ M) — `Research/08` §9.2 −3 row,
   verbatim. *The single highest-value change in the preview.*
2. **`11-01`: 21.5 with a 5-mile fast finish at M** (from plain) —
   `Research/00a` dress rehearsal, 3-6 wk out; fast-finish band 10-25%.
3. **`11-02` week to 37.6 mi, Tuesday 6 @ T → 3 @ T** — `Research/08` §9.1
   half row (30-50%); `Research/00b` B-race 7-10 day taper.
4. **`11-15`: 18 mi easy, MP removed** (from 16 w/ 4 @ M) — `Research/00b`
   B-half return-to-long day 5-7 vs return-to-quality day 7-10; last long
   outside the 14-21 day taper.
5. **`11-29`: 13 mi with last 3 @ M** (from 10 plain) — `Research/08` §9.2
   −2 row.
6. **`09-07` week to 31.4 mi** — `Research/08` §9.1 10K row (30-40%, not 47.5%)
   and its frequency rule.

Edit 1 alone closes most of the gap. Edits 1-2 close it. Edits 3-6 are the
consistency work around them.

## 5 · (b) The trade-off

**The runner gets a harder final month and a less-rested one.** Concretely: 18
miles at 7:52/mi in the last six weeks instead of 9, with the biggest of those
sessions 14 days before the start line, and **10.5 more miles spread across the
three taper-adjacent weeks W12-W14** than the plan currently asks. The 11-22
session is 2:11 of work
where the plan had 2:00 of easy running, and it lands inside the marathon
taper by design.

**What that buys:** the marathon-specific stimulus doubles, on a block whose
race-prep phase currently contains four MP miles.

**What it costs, honestly:** a taper carrying more specific work sheds less
fatigue than one carrying none. If he arrives at 12-06 flat, the 10 MP miles
on 11-22 are the most likely reason — not the volume, which is barely moved.
The mitigation is that nothing maximal was added: no new distance record, no
new peak week, no session longer than one already prescribed, and the peak
long run stays 35 days out where it already was.

**And there is a second, smaller cost:** W10 now carries a 6 @ T, a 9×3min @ I
*and* a 5-mile fast finish in the same 60-mile week, seven days before a B
half. That week is the proposal's thin ice, which is why the fast finish
carries an explicit bail condition rather than an assumption.

## 5 · (c) What I would NOT do, and why

**1 · I would not add a third 20-miler, and specifically not on 11-22.**
`Research/08` §9.2's −3 row does say *"Last long (20-22 mi)"*, and I am
declining that half of the row deliberately. Four reasons, all measured:
the block already places a 21.5 five weeks out, inside `Research/22`'s
*"80-90% of race distance"*; the −3 week's Sunday is **14 days out**, inside
`Research/08` §9.1's own 14-21 day marathon taper, whose stated job is shedding
fatigue; a 20-22 *plus* the §9.2 MP session would put the week past 55 mi and
outside its own 80-90% band; and his **longest training run in the last 90 days
is 18.0 mi**. Placing a maximal long run two weeks before the marathon because
a table has a number in it is the exact failure this preview was asked to
avoid. A 16 with 10 at M delivers more marathon-specific stimulus in 49 fewer
minutes.

**2 · I would not raise peak weekly volume above 60.** It is already +26% over
anything he has recorded in 2026. `Research/00a`'s long-run share cap is
breached in nine of nine build weeks, and the arithmetic fix (a ~72-mile week)
is not available to this runner this cycle. Adding volume to fix a ratio he
cannot support is how a plan gets him injured instead of fast.

**3 · I would not touch the 09-26 Dodgers weekend.** C-effort race Saturday,
17-mile long Sunday, 55.2-mile week. The race row's own `race_execution` reads
`controlled_c_effort` / `comfortable`, the 17 is 103% of the prior-30-day
longest, and `Research/00b` says a C race gets no taper and 0-3 easy days. It
looks alarming in a table and is correct.

**4 · I would not re-price any marathon-pace work off the 3:00:00 goal.** All
M segments here inherit the engine's `finish_pace_s_per_mi` = 472 (7:52/mi),
resolved from current evidence. The stated goal stays the runner's; the coach
projects, it does not renegotiate.

**5 · I would not raise race week to §9.2's 40-50% band.** Stated in W15 above.
This is the one number in the doctrine I am declining outright.

**6 · I would not rebuild the plan to get these changes.** Five of the six
edits are per-row content changes to future workouts. A regeneration would
re-lay-out the whole block, and — per the archive log — this plan is already
the sixth CIM version since 2026-08-17 (`regenerated`, `regenerated`,
`easy_drift`, `recovery_complete`, `silent_rebuild`). Churn is its own cost.

## 5 · (d) Status of this document

**This is a preview. The live plan was NOT written.**

`pln_7636bcc0a201bf2d` is unmodified. Every query behind this document was a
`SELECT` issued over `DATABASE_URL_RO` with `default_transaction_read_only =
on`; no `INSERT`, `UPDATE`, `DELETE` or DDL was executed against production,
and no engine code was changed. Nothing here has reached the runner's phone.

Applying any of section 5(a) requires David's explicit go, and — per CLAUDE.md
— a data write to `plan_workouts` needs a separate per-statement approval
beyond approval of the coaching decision itself.
