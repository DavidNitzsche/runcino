# CIM block review — plan `pln_9a57561debb776e5`

Coach + auditor review of the live active plan for owner `0645f40c-951d-4ccc-b86e-9979cd26c795`.
Read-only against production (`faff_readonly`). Worktree at `main` tip `7cac80f0`.
Review date 2026-09-01.

**Everything below was read from the live database or produced by calling the real
live functions against it.** Where a claim in an existing report could not be
reproduced, that is stated. Where the brief I was given cited a stale number, that
is stated too.

---

## 0 · Corrections to the brief before anything else

Two premises I was handed are wrong, and both would have produced false findings:

1. **The taper is NOT 70/55/40 of peak.** `docs/PRODUCT_DECISIONS.md:516-520`
   (2026-08-30 §3) explicitly retires that figure: *"the 70/55/40 note refers to a
   superseded revision."* The live doctrine shape is `TAPER_DESCENT_SHAPE` with
   marathon `TAPER_RACE_WEEK_PCT_OF_PEAK = 0.45`, yielding **82% / 60% / 45%**.
   Measured against that, this block's taper is correct (below). I would have
   reported a defect that does not exist.

2. **The 19-mile week-5 long run is already adjudicated and HELD.** Same entry, §2:
   the owner ruled on it in his own words — *"a 19 miler in week 5 feels okay for me
   if week 1 starts with a 14 mile long run."* It is not re-opened here. (Note the
   condition he attached is met and slightly exceeded: week 1's long is **15.0 mi**.)

A third premise held up: the phone card really does render `7:02-7:18 /mi` and
`160–167 bpm (Z4 Threshold)`. The `164-172` figure quoted in
`workout-fix-verification-2026-09-01.md` §8 does **not** exist in the live code —
`pace-hr-compatibility-2026-09-01.md` already caught and documented that, and my
read of the live row agrees with the correction, not the original.

---

## PART 1 · THE PLAN AS AUTHORED

### Plan header

| Field | Value |
|---|---|
| Plan | `pln_9a57561debb776e5`, mode `race-prep`, race `cim` 2026-12-06 |
| Authored | 2026-08-31 03:40:26Z · **15 weeks** (idx 0-14) |
| Last adapted | 2026-09-01 08:26:29Z · `adaptation_log` = `[]` |
| Phases | QUALITY wk0-7 · RACE-SPECIFIC wk8-11 · TAPER wk12-14. **No BASE phase** (`is_mid_block: true`) |
| Anchor | threshold VDOT **47.9**, confidence **0.7268**, sourceMode `direct` |
| LTHR | 168 (re-anchored 2026-08-31 02:40 from 162) · HRmax observed 183 · RHR 46 |
| Goal realism | `flag: true` — goal VDOT 53.5 vs estimated current 44.1 |
| Ramp base | `sustainedMi 45`, `meanMi 31.6`, `peakMi 52.3`, `baseMi/heldMi 34.7`, `lifted: false` |
| Derived from | `recentLongMi 18` (Rule 8 filtered) · `spikeAnchorLongMi 13.5` (unfiltered) · `easyDayMedianMi 6.0` · `recentQualityPerWeek 1.5` |

Resolved pace anchors (`authored_state.pace_recompute.anchors`, recompute at
2026-08-31 21:48Z, source `prescription_wire_1_promotion`):

```
repetition 371 · interval 407 · threshold 430 · marathon 475
easy ceiling 502 · shakeout ceiling 532
```

Capacity basis: marathon conf 0.727 `direct` (enduranceExponent 1.0869),
threshold 0.727 `direct`, easyCeiling 0.634 `direct`,
**highIntensity 0.291 `vdot_fallback`**.

### Weekly table

Weeks are Monday-start. `profile.user_settings` is `{}` — **no `long_run_day` is
set for this account**, so the "week ends on long_run_day" rule has no stored
input here; the default Monday-start happens to put the long run on Sunday, i.e.
last, so the two conventions agree by luck rather than by configuration.

| wk | start | phase | run days | total mi | long | quality | easy days | flags |
|---|---|---|---|---|---|---|---|---|
| 0 | 08-24 | QUALITY | 5 | 38.0\* | 13.0 | 0 | 4, 7, 7, 7 | partial — see note |
| 1 | 08-31 | QUALITY | 6 | **45.0** | 15.0 | 2 | 4.5, 5.0, 5.5 | |
| 2 | 09-07 | QUALITY | 6 | 28.9 | 6.2 (race) | 2 | 4.5, 5, 5, 2 | cutback · Santa Monica 10K |
| 3 | 09-14 | QUALITY | 5 | 34.0 | 12.0 | 1 | 5, 5, 5 | post-race |
| 4 | 09-21 | QUALITY | 6 | 48.7 | 15.5 | 2 | 4.5, 6.5, 7 | Dodgers 10K (Sat) |
| 5 | 09-28 | QUALITY | 6 | 56.0 | 19.0 | 2 | 4.5, 6.5, 7 | |
| 6 | 10-05 | QUALITY | 6 | **61.0** | 20.0 | 2 | 4.5, 12, 7.5 | **PEAK** |
| 7 | 10-12 | QUALITY | 6 | 45.5 | 15.0 | 2 | 4.5, 5, 5.5 | cutback |
| 8 | 10-19 | RACE-SPEC | 6 | 60.0 | 19.5 | 1 | 5, 12, 7.5, 7.5 | 11 mi @ M inside long |
| 9 | 10-26 | RACE-SPEC | 6 | **61.0** | **21.5** | 2 | 4.5, 9, 7.5 | peak long |
| 10 | 11-02 | RACE-SPEC | 6 | 45.6 | 13.1 (race) | 2 | 5, 10, 7.5, 2 | cutback · Run Malibu HM |
| 11 | 11-09 | RACE-SPEC | 6 | 44.0 | 16.0 | 1 | 4.5, 5, 5, 5 | post-race · dress rehearsal |
| 12 | 11-16 | TAPER | 6 | 48.0 | 19.0 | 1 | 3.5 × 4 | 11 mi @ MP (Tue) |
| 13 | 11-23 | TAPER | 6 | 36.0 | 14.0 | 1 | 3.0 × 4 | 7 mi @ MP (Tue) |
| 14 | 11-30 | TAPER | 6 | 43.7 | 26.22 (**CIM**) | 2 | 4, 4, 3, 2 | race week |

\* Week 0 is a clipped historical week: **2026-08-25 and 2026-08-29 have no rows
at all**, not even `rest`. That is the backdate guard working correctly
(`_backdate_guard.test.ts` — an unsealed past day is dropped; those two days have
no `runs` row so nothing sealed them). Week 0's 38.0 mi is therefore an artifact
and must not be read as a prescribed week.

### The runner's actual history (canonical rows, `NOT (data ? 'mergedIntoId')`)

| week (Mon) | mi | runs | longest |
|---|---|---|---|
| 05-11 | 37.6 | 6 | 11.0 |
| 05-18 | 40.5 | 8 | 11.1 |
| 05-25 | 39.7 | 5 | 12.4 |
| 06-01 | 44.9 | 6 | 12.6 |
| 06-08 | 40.1 | 5 | 13.1 |
| 06-15 | 47.3 | 6 | 13.2 |
| 06-22 | 28.0 | 3 | 14.0 |
| 06-29 | **(no rows)** | — | — |
| 07-06 | 43.2 | 6 | 12.6 |
| 07-13 | 39.8 | 5 | 9.1 |
| 07-20 | 47.5 | 5 | **18.0** |
| 07-27 | **4.2** | 3 | 2.0 |
| 08-03 | 39.8 | 6 | 12.4 |
| 08-10 | 23.2 | 3 | 13.2 |
| 08-17 | 28.4 | 4 | 11.0 (AFC half 08-16) |
| 08-24 | 34.8 | 5 | 13.5 |
| 08-31 | 14.7 | 2 | 8.5 (partial) |

Sustained mid-summer volume **40-47 mi/wk**; single best week 47.5; longest run
**18.0 mi on 2026-07-25**; one interruption week (07-27, 4.2 mi) and one missing
week (06-29).

### Race calendar

| date | race | dist | pri | result |
|---|---|---|---|---|
| 2026-01-18 | Rose Bowl Half | 13.1 | A | 1:38:38 |
| 2026-02-01 | Disney Half | 13.1 | A | **1:34:54** (best) |
| 2026-03-08 | LA Marathon | 26.2 | A | 3:31:40 |
| 2026-04-26 | Big Sur Marathon | 26.2 | hilly-excluded | 3:36:55 |
| 2026-05-03 | Sombrero Half | 13.2 | C | 1:40:57 |
| 2026-08-16 | Americas Finest City | 13.1 | A | 1:41:53 |
| 2026-09-13 | Santa Monica 10K | 6.2 | B | — |
| 2026-09-26 | Dodgers | 6.21 | C | — |
| 2026-11-08 | Run Malibu | 13.1 | B | — |
| 2026-12-06 | **CIM** | 26.22 | A | — |

---

## PART 2 · COACH VERDICT

### Verdicts at a glance

| Phase | Weeks | Verdict |
|---|---|---|
| QUALITY | 0-7 | **TRUSTWORTHY WITH CAVEATS** |
| RACE-SPECIFIC | 8-11 | **NOT TRUSTWORTHY** — the race-pace axis is wrong |
| TAPER | 12-14 | **NOT TRUSTWORTHY** — inherits the same pace defect on both rehearsals |
| **Block overall** | | **TRUSTWORTHY WITH CAVEATS on volume and structure; NOT TRUSTWORTHY on race-specific pace.** |

The volume architecture, phase sequencing, cutback cadence and taper shape are
good — better than the reports suggested. The defect is concentrated and severe:
**the plan never once rehearses the pace it asks him to race.**

---

### FINDING 1 — "Marathon pace" means two different numbers, 39 s/mi apart. **CRITICAL.**

Every marathon-pace prescription in the block is **475 s/mi (7:55/mi)**:

| date | session | MP pace |
|---|---|---|
| 2026-10-11 | LONG 20 mi · 3.5 mi @ M + 1 mi @ E + 2 mi @ M | 475 |
| 2026-10-25 | LONG 19.5 mi · 11 mi @ M | 475 |
| 2026-11-15 | LONG 16 mi · 4 mi @ M — **the dress rehearsal** | 475 |
| 2026-11-17 | 2.5 WU · **11 mi @ MP** · 1.5 CD | 475 |
| 2026-11-24 | 2 WU · **7 mi @ MP** · 1 CD | 475 |

Race day, 2026-12-06, prescribes `pace_target_s_per_mi_lo: 431`,
`_hi: 441` — **436 s/mi (7:16/mi)**.

**He will arrive at CIM having run 31.5 miles of "marathon pace" work, none of it
at his race-day pace, all of it 39 s/mi slower.** 475 × 26.2 = 3:27:25.
436 × 26.22 = 3:10:32. The block rehearses a 3:27 marathon and then asks for a
3:10 one.

The three-tier design is deliberate and was blessed — `PRODUCT_DECISIONS.md:540-545`
(§5) records `MPLABEL-1` splitting `resolveMarathonPace` into `'goal' |
'current_fitness'`, and calls the tiers "correctly distinct". **But the gap has
since more than doubled.** The audited-and-blessed example was *"MP segments at
current fitness (~7:56/mi), race-day target **7:41** from the modelled ceiling."*
Race day is now **7:16**, not 7:41 — 25 s/mi faster than the version that was
reviewed, and only 24 s/mi off the 3:00 goal pace (6:52) the same decision says
training must never chase. Whatever moved between 2026-08-30 and the 2026-08-31
`prescription_wire_1_promotion` recompute moved race day and left the training
tier behind.

This is Rule 16 in its exact canonical form ("the owner's CIM race had three
different projected finishes live at once"), recurring on the pace axis. A fourth
number is in the same spec: the race's own abort trigger is *"pace slower than
7:38/mi"* (458) — between the two.

#### Root cause — found, and the same file already contains the fix pattern

`web-v2/lib/plan/recompute-paces.ts:322`:

```ts
const RECOMPUTE_EXEMPT_TYPES = ['rest', 'cross', 'strength', 'race', 'race_week_tuneup'];
```

**`race` rows are exempt from the pace recompute.** The 2026-08-31 21:48 recompute
(`prescription_wire_1_promotion`) rewrote **77 workouts** onto the new anchors —
including marathon 475 — and could not touch the CIM row, which still carries the
431-441 band it was authored with at 03:40 that morning. The training tier moved;
race day did not.

The file's own comment at `:391-394` shows this was known:

> *"`race` is in `RECOMPUTE_EXEMPT_TYPES` besides, so on today's engine no row
> reads them at all. They are threaded so that the day race rows come into scope
> they cannot come in anchored to something stale."*

That day has not come, and the row is stale now.

**The precedent for the fix is 70 lines above it** (`:316-321`). `shakeout` was
removed from this very list for this very reason:

> *"on the owner's live block it was the one row type nothing could ever bring up
> to date — authored at 9:42/mi off a threshold offset and frozen there for the
> life of the plan."*

The race row is now the remaining instance of that defect, and it is the single
most important row in the plan.

**What a coach would do:** pick one race-day number, then make the last two MP
rehearsals (11-17, 11-24) and the dress rehearsal (11-15) run at it. If 475 is the
honest current-fitness pace — and the durability exponent 1.0869 argues it is,
given LA 3:31:40 off a 1:34:54 half — then race day should be near 475, not 436.
If 436 is right, the rehearsals must move. They cannot both stand.

---

### FINDING 2 — He ran the fixture session today, perfectly, and the app graded it a failure. **CRITICAL.** (Rule 13, rendered)

`2026-09-01` — the 4×1 mi threshold session — is **today**, and he completed it.
Per-phase execution, read from `runs.data.phases` on the live row:

| # | phase | dur | dist | target | actual | avg HR | in-tol | out-tol | **verdict** |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Warm-up | 1084 s | 2.10 mi | 502 | 516 | 140 | 990 | 55 | hit |
| 1 | Interval · 1 mi | 424 s | 1.01 | 430 | **422** | 158 | 120 | 295 | **drifted** |
| 2 | Jog 1 min | **61 s** | 0.12 | — | 515 | 158 | — | — | — |
| 3 | Interval · 1 mi | 431 s | 1.01 | 430 | **429** | 161 | 240 | 180 | **drifted** |
| 4 | Jog 1 min | **64 s** | 0.08 | — | 785 | 156 | — | — | — |
| 5 | Interval · 1 mi | 423 s | 1.00 | 430 | **422** | 164 | 145 | 270 | **drifted** |
| 6 | Jog 1 min | **64 s** | 0.06 | — | 1034 | 157 | — | — | — |
| 7 | Interval · 1 mi | 422 s | 1.01 | 430 | **419** | 166 | 85 | 325 | **missed** |
| 8 | Cool-down | 1125 s | 2.11 | 502 | 534 | 153 | 910 | 180 | **missed** |

The displayed target band is **7:02–7:18 = 422–438 s/mi** (430 ± 8).

- Four reps at **422, 429, 422, 419** — mean 423. Every rep inside the band or
  within 3 s of it. A slight negative split, which is textbook.
- Distances 1.01 / 1.01 / 1.00 / 1.01 mi — exact.
- Recoveries **61 / 64 / 64 s** against a prescribed 60 s — exact.
- Work-segment HR 158 / 161 / 164 / 166, mean 162.25 — **under** the `pass:
  avgHr ≤ 164` rule, nowhere near the `bail: > 173`.

**This is a near-flawless execution of a threshold session. The app returned
drifted, drifted, drifted, missed — and graded the cool-down "missed" too. Not one
work rep scored "hit."**

The mechanism is `timeInToleranceSec` / `timeOutOfToleranceSec`: the verdict is
computed on **instantaneous** pace against a ±8 s/mi band, while the runner is
shown an **average**-pace band. Rep 4 spent 85 s in / 325 s out precisely *because
he averaged 419 — 3 s/mi faster than the band's fast edge* — so instantaneous
noise sat below 422 for most of the rep. **He is being penalised for running
slightly too fast, and the word he is shown is "missed", which reads as too slow.**
The card's own note reinforces the wrong reading: *"If the last one slips, the
target was too fast."* His last one did not slip. It was his fastest.

Three further problems in the same row:
- **±8 s/mi against an instantaneous GPS pace signal is measuring GPS noise.**
  `spec-card.ts:382` defaults `toleranceSec ?? 8`; `prescription-resolver.ts:332`
  keeps a `WIDEST_STATED_TOLERANCE_S = 30` for E pace. A 1-mile GPS rep routinely
  varies more than ±8 s/mi instant-to-instant.
- **The server would have graded him differently.** The evidence pipeline uses
  **±10** (`goal-projection.ts:1161`), not ±8 — at which reps 1-3 are *on target*
  and only rep 4 is "fast". The watch's ±8-on-instantaneous is the harshest of the
  four tolerances in the codebase (see Part 3), and it is the only one he sees.
- **The cool-down is graded at all.** 534 vs a 502 easy ceiling — a cool-down
  32 s/mi slower than the easy ceiling is a *correct* cool-down. Meanwhile the
  warm-up at 516 (+14) scored "hit" against the same 502. There is no cool-down
  tolerance, so the same target grades opposite ends of the run inconsistently.

And the watch's own last-rep cue is *"Last one. Run it at the pace of the first ·
that is the whole point of the session."* The first was 422. He ran the last at
419. **He did exactly what the cue asked and the app returned "missed."**

This is the mission statement failing on the screen. He pushed — ran the fast edge
and negative-split it — and the app told him he drifted and missed. Rule 21's
asymmetry, rendered.

---

### FINDING 3 — Race-day HR cap is not achievable at the race-day pace. **HIGH.**

`2026-12-06` spec: `pace_target 431-441`, `hr_cap_bpm: 155`, and a mile-10 abort
at `avgHr > 163`.

His own evidence:
- 2026-08-09 · **12.4 mi at 441 s/mi** (the slow edge of the CIM band) → **avgHr 157**.
- 2026-08-16 · AFC half, 13.2 mi at **463** s/mi (slower than the CIM band) → **avgHr 168**.

He cannot hold 431-441 for 26.2 miles under 155 bpm; he exceeded 155 over less than
half that distance at that pace. The 155 cap and the 431-441 band are mutually
unsatisfiable on his own data, and the card presents both without saying which is
primary. Two HR numbers also sit on the same race (`hr_cap_bpm 155` vs abort at
163).

The soft version of the same problem runs through every long run: prescribed band
502-537 with `hr_cap_bpm 151`. At 500-530 s/mi his recent HR is 138-154 (07-13:
525→139; 08-26: 528→138; 08-28: 508→154; 08-31: 501→147) — compatible early, but
his 18-miler at 481 averaged 155 and his 13.5-miler at 457 averaged 159. On the
19-21.5 mile long runs, cardiac drift will breach 151 in the back half and nothing
tells him which target wins.

`pace-hr-compatibility-2026-09-01.md` builds exactly the validator this needs
(`lib/adaptation/pace-hr-compatibility.ts`) and states plainly that it is **not
wired into any live path**. So this is unguarded in production today. Rule 20.

---

### FINDING 4 — Six sessions are labelled as one workout and prescribed as another. **HIGH.** (Rule 16)

| date | `sub_label` says | `notes` / pace says |
|---|---|---|
| 2026-09-22 | `2.5 mi WU · 4 mi @ T · 2.5 mi CD` — continuous | *"Continuous mile **cutdowns**. Each mile ~10–15 s/mi faster than prior."* — but a single `tempo_pace_s_per_mi: 430` |
| 2026-10-27 | `2 mi WU · 6 mi @ T · 2 mi CD` — continuous | same cutdown text, same single 430 |
| 2026-11-03 | `4×1km · **MP → 5K**` | `pace_target 407` (= I pace). MP is 475, 5K ≈ 391. The label's own range brackets neither end |
| 2026-12-01 | `5×400m @ **5K pace**` | `pace_target 425` — slower than I pace (407) and identical to the Malibu **half-marathon** race target |
| 2026-10-15 | Mona fartlek `@ 5K` and `@ mile` | one pace, 403, for both |
| 2026-09-08 | `2 mi @ T` | prose says *"Single block, no recovery"* — correct, but see Finding 5 |

The cutdown cases are the worst: a runner told "each mile 10-15 s/mi faster than
the last" and simultaneously given one flat number cannot do both, and after
Finding 2 we know the grader will punish him for whichever he picks.

---

### FINDING 5 — Residual-mileage splitting produces sessions that are mostly jogging. **MEDIUM.**

| date | warm-up | work | cool-down | jog : work |
|---|---|---|---|---|
| 2026-09-08 | 2.1 | **2.0** | 2.1 | **2.1 : 1** |
| 2026-11-03 | 2.6 | 2.48 | 2.6 | **2.1 : 1** |
| 2026-10-15 | 2.0 | 1.48 | 1.9 | 2.6 : 1 |
| 2026-11-13 | 2.6 | 3.0 | 2.6 | 1.7 : 1 |

2026-09-08 asks for **4.2 miles of jogging around 2.0 miles of tempo**. No coach
writes that; a 2-mile tempo gets a 1.5-mile warm-up and a mile back.

**I should correct the brief here too:** the 4×1 mi session's 2.1 + 2.1 around
4.0 mi of work is **not** an example of this defect — a 2-mile warm-up before
threshold reps is textbook, and the ratio is 1.05 : 1. The tell of the artifact is
not the size but the **decimals**: 2.1, 2.6, 1.9, 1.8, 1.7, 1.4. A coach writes
"2 mi", not "2.6 mi". Those tenths are the residual being divided.

---

### FINDING 6 — `selection_rationale` is present on ZERO of 103 rows. **MEDIUM.** (Rule 20)

```
total | with_rationale | with_progression
  103 |              0 |                1
```

`RATIONALE-PERSIST-1` (2026-09-01) is wired end-to-end in code
(`progression-spec.ts:76`, `spec-card.ts:591`, `coaching-thesis.ts:389`,
`v5-today.ts:668`) and covered by `_rationale_persist.test.ts`. **It is inert on
the live plan**, which was authored 2026-08-31 and predates it. The consequence is
visible in the thesis output below: every session reports `(none persisted)`.

So the question "why was this session selected" has **no answer in production
today**, on any of the 103 rows. Wired, tested and inert — the signature failure
CLAUDE.md names.

---

### FINDING 7 — The Coaching Thesis is real, but the session it credits cannot evidence it. **MEDIUM.**

`resolveCoachingThesis` run live against the owner's account (via the purpose-built
read-only `_coaching_thesis.audit.test.ts`, `DATABASE_URL` pinned to the RO role):

```
primaryLimiter=HIGH_INTENSITY  basis=LOWEST_NORMALIZED_CONFIDENCE
priority=establish_high_intensity_evidence
confidence=0.291  evidenceIds=["-4269086812782646"]
reasons=[LOWEST_NORMALIZED_CONFIDENCE, HIGH_INTENSITY_STRUCTURALLY_CEILINGED,
         LIMITER_HAS_NO_DIRECT_EVIDENCE, KEY_SESSION_PRESENT_THIS_WEEK]
ranking:
  HIGH_INTENSITY confidence=0.291 normalized=0.583 sourceMode=vdot_fallback
  THRESHOLD      confidence=0.727 normalized=0.808 sourceMode=direct
  DURABILITY     confidence=0.900 normalized=1.000 sourceMode=direct
addressedBy (1 session this week):
  2026-09-03 intervals "10×60s hills @ 5K-10K effort · 2 min jog down"
             — rationale: (none persisted)
```

**The thesis is not inert** — the block does contain genuine I-pace work: 10-01
(8×800 @ I), 10-08 (7×1km @ I), 10-15 (Mona fartlek), 10-29 (6×5 min @ I), 11-03,
12-01. Six sessions. Credit where due.

But two things undercut it:

1. **The one session it names this week is run by effort with no pace target.**
   `10×60s hills @ 5K-10K effort` has `pace_target_s_per_mi = NULL`. A hill rep
   produces no pace evidence, so the session credited with
   `establish_high_intensity_evidence` is structurally incapable of establishing
   it. Same for 09-17 (`7×3 min hills @ T-10K effort`, also NULL).
2. **The first I-pace session carrying an actual pace target is 2026-10-01 — week
   5.** The thesis says the priority is *this week*; the plan cannot act on it for
   five weeks.

Also: `repetition_s_per_mi: 371` is resolved and **never prescribed anywhere in
the block**. Zero R-pace sessions in 15 weeks for a runner whose named limiter is
high intensity.

---

### FINDING 8 — Research/00b: quality resumes one day early after Run Malibu. **LOW-MEDIUM.**

`Research/00b` §"Recovery by Distance": half marathon → *"Return to quality
workouts: Day 10-14."* B-race modifier: *"60-70% of A-race recovery duration"* →
day 6.0-9.8.

- **Run Malibu (B, half, 11-08)** → plan resumes quality **2026-11-13 = day 5**.
  Below the adjusted floor. The plan's own note on 11-12 reads *"Post-race recovery
  · day 4 after Run Malibu. Easy only; quality resumes after the recovery window"*
  — and quality lands the next day, inside the window that sentence promises.
- **Santa Monica 10K (B, 09-13)** → quality on 09-17 = day 4. 10K return-to-quality
  is day 7-10, ×0.6 = 4.2. Day 4 is a hair under. **Marginal, not a clear
  violation** — I checked this expecting a breach and it very nearly isn't one.

---

### FINDING 9 — Race Saturday, 15.5-mile long run Sunday. **MEDIUM.**

Week 4: Sat **2026-09-26 Dodgers 10K** (6.21 mi, target 7:15/mi) → Sun **2026-09-27
LONG 15.5 mi**. That is **21.7 miles in 24 hours**, one of them a race effort, and
it is the single largest back-to-back load in the block. `Research/00a` §"Practical
load rules": *"Hard-session spacing — 48 h between hard sessions."*

Dodgers is labelled a C race and *"this is the week's quality session,"* so the
recovery table arguably does not bind — but the 24-hour spacing does. A coach
either moves the long run to Monday or shortens it to ~12.

---

### FINDING 10 — Volume ramp: mostly honest, two real breaches. **MEDIUM.**

**The opening 45 mi/wk is honest, and I want to say so clearly.** His last complete
week was 34.8 and the 4-week mean is 31.6 — but 08-10 and 08-17 are the taper and
post-race window for the AFC half, and Rule 8 requires excluding them. Filtered, his
normal is 40-47 mi/wk with a 47.5 best. `ramp_base.sustainedMi = 45` is that number.
**The engine got Rule 8 right here**, and it also correctly split the Rule 8
corollary: `recentLongMi 18` (filtered, habit) vs `spikeAnchorLongMi 13.5`
(unfiltered, injury guard). That is the doctrine working as designed.

Two things do breach:

- **Week 3 → week 4: 34.0 → 48.7 mi = +43% in one week.** Week 3 is a post-race
  recovery week, so the *absorbed* load genuinely was 34. CLAUDE.md notes
  `weeklyVolWoWMaxPct` is guarded as **removed**, so nothing checks this. Doctrine
  is on the engine's side here (`Research/00a`: *"Weekly mileage change correlated
  weakly with injury"*), but +43% off a recovery week is still the kind of step a
  coach would split.
- **Peak 61.0 exceeds `cycleBoundedPeak`.** `CYCLE_GROWTH_CEILING.advanced = 1.15`
  (`goal-tiers.ts:534`) × measured `peakMi 52.3` = **60.145**. Weeks 6 and 9 are
  both **61.0**. Over by 0.86 mi (1.4%). The 2026-08-30 audit checked this exact
  arithmetic and found the then-block at 59.5, *"just under it"*. The re-authored
  block is over it. Small, but it is a doctrine-bound ceiling and it is breached.

`Research/00a` *"Add stress one-at-a-time — either add mileage OR add intensity in a
given week, not both"* is also breached at wk4→wk5 (+15% volume **and** a step from
one tempo to ST + I intervals) and wk5→wk6 (+9% volume **and** the first MP finish
**and** the first 12-mile medium-long).

**Long-run 110% rule** (`Research/00a`: *">110% of longest in prior 30 d → 64%
increased overuse injury risk"*): 09-06 at 15.0 vs a 13.5 prior-30-day max = 111%,
marginal. 10-04 at 19.0 vs 15.5 = **122.6%** — already ruled on by the owner and
held, not re-opened. All other longs clear: 10-11 105%, 11-01 107.5%, 11-22 97%.

---

### FINDING 11 — Easy days: improved, still under his own median in the build. **MEDIUM.** (Rule 12)

The 2026-08-30 audit's §7 top follow-up was *"week 1 authors four easy days of
exactly 4.0 miles each… four identical easy days is not what a coach writes."*
**That has partly improved** — week 1 is now 4.5 / 5.0 / 5.5, week 4 is 4.5 / 6.5 /
7.0, week 8 is 5.0 / 12.0 / 7.5 / 7.5. Varied, with a medium-long. Credit due.

Two residues:

- **The build weeks still price easy days below his own median.** `easyDayMedianMi`
  is **6.0**; weeks 1, 2, 3 and 7 give 4.5-5.5. At his ~8:34/mi easy pace a 4.5-mile
  day is 39 min — a recovery run by `Research/00a` §1 (20-75 min), sitting below the
  general-aerobic floor of §2 (40-75 min). So the early build weeks are still
  authoring recovery days where a marathon build wants general-aerobic days. The
  named structural cause (`flooredPerEasy = min(effectiveFloor, perEasyBudgetCap)`)
  is unfixed.
- **Taper weeks are four identical days** (3.5 × 4, then 3.0 × 4). In a taper that
  is far more defensible — 3.0 mi is ~27 min, inside the recovery band — so I would
  not chase this one.

---

### FINDING 12 — Rule 17: the same sentence, up to 17 times. **MEDIUM.**

| times | sentence |
|---|---|
| **17** | *"Conversational. Z2 HR cap. Finish with 6 relaxed 20-second strides, full recovery between."* |
| 13 | *"Conversational. Z2 HR cap."* |
| 13 | *"Off. Sleep, mobility, fuel."* |
| **9** | *"Course drops 304 ft. Run at least 60% of this on downhill-similar terrain · Research/11 §net-downhill adjustments."* |

Rule 17's canonical example is *"the same 20-word downhill instruction appended to
every long run, eleven times in one block."* Here it is **nine times**, in a plan
authored **the day after Rule 17 was locked**. The downhill instruction belongs to
the block, said once when the block is prescribed.

---

### FINDING 13 — Progression: volume and density climb; pace cannot. **MEDIUM.** (Rule 21)

Threshold work-volume by week: 4.0 → 2.0 → 0 → 4.0 → 5.6 → 5.0 → 4.3 → 4.0 → 6.0 →
2.5 → 3.0 mi. Peak 6.0 at week 9, up 50% from week 1. Volume 45 → 61. Long 15 →
21.5. Medium-long introduced wk6. **Duration and density genuinely progress.**

**Pace never moves.** Every T session across 15 weeks is 430. Every I session 407.
Every M 475. That is doctrine-correct in itself (pace progresses from capacity
evidence, not from the calendar) — but the mechanism that would move it has never
fired. Re-measured today across the owner's entire `coach_intents` history:

```
plan_adapt_downgrade    5     upgrade / bump / accelerate    0
plan_adapt_long_floor   5
plan_adapt_reschedule   3     vdot_auto_recalc               1  (2026-08-17)
plan_adapt_missed_noted 3
plan_adapt_overridden   2
plan_adapt_gap          1
plan_adapt_drop_missed  1
```

**Rule 21's zero still stands**, and the live plan's `adaptation_log` is `[]`.
Also note weeks 6 and 9 are byte-identical in volume (61.0) with the same shape —
and 2026-09-01 and 2026-10-20 are the **same session** (4×1 mi, 8.5 mi, 430, WU/CD
2.1/2.1), seven weeks apart, with nothing changed. Week 8's threshold session is
week 1's threshold session.

---

### FINDING 14 — Taper: shape is right, content of week 12 is heavy. **LOW.**

Against doctrine's 82 / 60 / 45 of peak 61.0 (= 50.0 / 36.6 / 27.5):

| week | actual | % of peak | doctrine |
|---|---|---|---|
| 12 | 48.0 | 78.7% | 82% |
| 13 | 36.0 | 59.0% | 60% |
| 14 | 17.5 (excl. race) | 28.7% | 45%\* |

\* the 2026-08-30 audit's own worked example counted race week at 18/59.5 = 30%,
so 28.7% matches what was verified rather than the stated 45%. **The taper shape is
correct and I am not flagging it.**

The content is worth a look: week 12 carries an 11 mi @ MP session on Tuesday *and*
a 19-mile long run on Sunday, at 48.0 mi — heavier than build weeks 1, 7, 10 and 11.
That is a legitimate Pfitzinger-style first taper week, so it is a note, not a
defect. The defect in those two sessions is the **pace** (Finding 1), not the volume.

---

### Questionable workouts — what a coach would actually change

| date | session | what's wrong | what a coach does |
|---|---|---|---|
| **2026-11-17** | 11 mi @ MP · 475 | 39 s/mi slower than race day. The biggest single race-specific session in the block, at the wrong pace | run it at the real race target |
| **2026-11-24** | 7 mi @ MP · 475 | same | same |
| **2026-11-15** | dress rehearsal, 4 mi @ M · 475 | *the* rehearsal, rehearsing a pace he will not race | same |
| **2026-10-25** | 11 mi @ M inside a 19.5 | 11 miles is a lot to spend at a pace that is not the target | same |
| **2026-12-06** | CIM · 431-441 with `hr_cap 155` | cap unachievable at that pace on his own data; two HR numbers on one race | one HR number, and make it match the pace |
| **2026-09-27** | LONG 15.5 the day after a 10K | 21.7 mi in 24 h, 48 h spacing rule | move to Monday or cut to ~12 |
| **2026-09-08** | 2.1 WU · **2 mi** @ T · 2.1 CD | 4.2 mi of jogging around 2 mi of work | 1.5 WU · 3 mi @ T · 1 CD |
| **2026-09-22** | `4 mi @ T` labelled *"mile cutdowns, each 10-15 s/mi faster"* | two different workouts in one row | pick one; if cutdowns, give per-rep paces |
| **2026-10-27** | `6 mi @ T` with the same cutdown text | same | same |
| **2026-11-03** | `4×1km MP → 5K` at a flat 407 | label brackets neither end of its own range | per-rep ladder 475 → ~391 |
| **2026-12-01** | `5×400m @ 5K pace` at 425 | slower than I pace (407); equals the Malibu HM target | ~391 |
| **2026-11-13** | `2×1.5 mi @ T` with 2.6 WU + 2.6 CD | 5.2 mi jogging around 3.0 mi work | 1.5 + 1.5 |
| **2026-09-03 / 09-17** | hills "by effort", no pace | the only sessions credited with the HIGH_INTENSITY thesis, and they cannot evidence it | keep the hills, but add one paced I session before week 5 |

---

## PART 3 · THE 4×1-MILE FIXTURE

### The production row

`2026-10-20` (and an identical `2026-09-01`), plan `pln_9a57561debb776e5`:

```
type threshold · sub_label "4×1 mi @ T pace · 1 min jog"
distance_mi 8.5 · is_quality true · pace_target_s_per_mi 430
notes "Cruise intervals · Research/04 §5.3."
workout_spec:
  kind threshold · lthr_bpm 168
  rep_count 4 · rep_distance_mi 1 · rep_pace_s_per_mi 430 · rep_rest_s 60
  warmup_mi 2.1 · cooldown_mi 2.1
  rules:
    pass  hr <= 164  "Pass: avgHr ≤ 164 on the work"
    bail  hr >  173  "HR over 173 and climbing · finish easy, the stimulus is
                      banked"  action drop_to_easy
```

`lthr_bpm: 168` is stamped **into the spec** beside the derivation — Rule 10's
recompute/stamp posture, correctly applied.

### Phone card

`cardFromSpec` is `web-v2/lib/training/spec-card.ts:343`; it delegates structure to
`expandSpecToPhases` → `expandReps` (`lib/training/expand-spec.ts:446-546`), which
yields **9 phases** (warm-up · 4 × [work, jog] minus the trailing jog · cool-down),
tokenised into **3 card steps**: Warm-up, `Repeat 4×`, Cool-down.

```json
{ "label": "Repeat 4×", "reps": 4, "rep_distance_mi": 1,
  "pace_target": "7:02-7:18 /mi",
  "hr_target": "~160–167 bpm (Z4 Threshold)",
  "note": "Same pace on every rep. If the last one slips, the target was too fast.",
  "recovery": { "duration": "1:00", "note": "Honest jog, not standing." } }
```

- Band = 430 ± 8 (`fmtPaceBand`, `spec-card.ts:184`). The 8 arrives twice and the
  two agree by coincidence rather than by sharing a constant:
  `route.ts:1515-1517` (`threshold || intervals ? 8 : race ? 12 : 20`) and
  `spec-card.ts:382`'s `toleranceSec ?? 8`. Locked at `_spec_card.test.ts:88`.
- `160–167` = Friel Z4 via `hrTargets()` (`prescriptions.ts:305-321`) →
  `lthrZones()` (`zones.ts:201`), `FRIEL_5_ZONE_EDGES = [0.85, 0.90, 0.95, 1.00]`,
  `lower = ceil(anchor × loPct)`, `upper = ceil(anchor × hiPct) − 1`.
  At LTHR 168: `ceil(159.6) … 168 − 1` = **160–167**. ✓
- **Correction to the brief:** the warm-up/cool-down HR is **not** `<139 Z1`.
  Z1 upper at LTHR 168 is `ceil(168 × 0.85) − 1 = 142`, so the live string is
  **`~< 142 bpm (Z1 Recovery)`**. 139 would require LTHR **164**. I confirmed
  `profile.lthr = 168` directly, so 139 is not reproducible from this account.
  (Same arithmetic independently corroborated: `hrCapEasy` on every easy/long row
  is **151** = `ceil(168 × 0.90) − 1`, `zones.ts:179` — and the sealed week-0 rows
  still carry **145** = the same formula at the pre-re-anchor LTHR 162. Rule 10
  working, visible in the data.)
- Warm-up/cool-down pace is a **ceiling, not a band** — `fmtPaceCeiling`
  (`spec-card.ts:432`) → `≤ M:SS /mi`, sourced from the plan's nearest authored
  easy band `lo` (`route.ts:1509`), not from LTHR or VDOT.
- The `164-172` figure in `workout-fix-verification-2026-09-01.md` §8 **does not
  exist in the live code**: 164 is `passHr`, 172 is `bailHr − 1`, and nothing
  computes that pair as a range. Do not cite it again.
- `selectionRationale` = **null** (Finding 6). `why`/`citation` are
  `sessionRationale('threshold')` — byte-identical for every runner.

### Watch phases

`buildWatchToday` runs the **same** `expandSpecToPhases` with the same easy-band
query and the same tolerance 8 (`build-workout.ts:1712-1715, 1735-1782`), so the
structure matches the phone exactly.

| # | type | label | unit | value | pace | tol | hrTargetBpm |
|---|---|---|---|---|---|---|---|
| 0 | warmup | Warm-up | distance | 2.1 mi | easy ceiling | 30 | null |
| 1,3,5,7 | work | Interval · 1 mi | distance | 1.0 mi | **430** | **8** | **168** |
| 2,4,6 | recovery | **Jog 1 min** | **time** | **60 s** | **null** | — | null |
| 8 | cooldown | Cool-down | distance | 2.1 mi | easy ceiling | 30 | null |

`hrCeilingBpm` is **null** — `resolveHrCeiling` (`build-workout.ts:1437-1461`)
returns a ceiling only for easy/long.

### Spoken cues

`composeSpokenCues` (`build-workout.ts:932-1031`), threshold arm at `:986-996`.
Exactly **two** cues fire for this session (phase 1 and phase 7):

1. *"Threshold is comfortably hard. If the first rep burns, the pace is wrong, not
   your legs."*
2. *"Last one. Run it at the pace of the first · that is the whole point of the
   session."*

Plus the **bail**, split into two registers by `splitRuleRegisters` (`:1062-1111`)
and pinned to each work phase:
- evidence: *"Heart rate over 173 and still climbing"*
- judgement: *"The stimulus is already banked · forcing the rest of the reps buys
  fatigue, not fitness."*

**The `pass ≤ 164` rule produces no cue at all** — `splitRuleRegisters` returns
nulls for any `kind` other than `bail`/`abort` (`:1067`).

Note cue 2 against Finding 2: the watch tells him *"run the last one at the pace of
the first."* The first was **422**. He ran the last at **419** — 3 s/mi off, doing
precisely what he was told — and it was graded **missed**.

### Are phone and watch asking for the same workout?

**Yes on structure, distance, pace and recovery.** Recovery is **time on both**
(`rep_rest_s: 60` → watch `repUnit: 'time', durationSec: 60`; phone
`"duration": "1:00"`), with **no pace on either** (`RECOVERY-BYFEEL-1`,
`expand-spec.ts:526`). Live execution confirms: 61 / 64 / 64 s.

**No on heart rate.** Three different numbers for the same four reps:

| surface | number | meaning |
|---|---|---|
| phone card | **160–167** | Friel Z4 band, display only |
| watch work phase | **168** | `hrTargetBpm` = `specHrBpm ?? lthr` |
| grader / pass rule | **≤ 164** | `round(168 × 0.975)` |
| bail | **> 173** | `lthr + 5` |

The watch tells him to aim at 168; the phone shows a band that **ends at 167**; the
pass rule fails him above 164. Rule 16, on one workout, across two surfaces.

### Which signal is primary?

**Nothing says — and on the phone the HR is not even shown.**
`web-v2/lib/faff/v5-today.ts:1044-1052`:

```ts
const text = s.pace_target ?? s.hr_target ?? s.effort_target ?? null;
```

**Pace wins by `??` fallback ordering.** Every step on this session carries a pace,
so `hr_target` is silently dropped and the runner never sees the Z4 band on the
Today card at all. There is no primary flag, no conflict resolution, no label.

Likewise the phone's `contingency` block (`route.ts:1647-1654`) filters to rules
that have an evidence line, so the runner sees **only the bail** — the `pass ≤ 164`
gate he is actually graded against is invisible on both surfaces.

### The tolerance is not one number — it is four

| where | tolerance | source |
|---|---|---|
| **shown** on card and watch | **±8** | `route.ts:1515`, `spec-card.ts:382`, `build-workout.ts:1712` |
| evidence / adaptation pipeline | **±10** | `goal-projection.ts:1161` `type === 'long' ? 40 : 10` |
| blended-overall basis | **±15** | `goal-projection.ts:1246` |
| run-detail phase colouring | **±10** while shipping `tolerance_pace_sec: 8` | `run-state.ts:1564, 1584` |
| "on track / slipping" copy | **±12** | `training-influence.ts:101-105` |

`spec-card.ts:174-176` claims in a comment that "± 8 s/mi is the same width the
watch grades execution against." That is true of the watch's `PaceDrift.swift`
only, and false of every server-side consumer — a Rule 20 header comment that
nothing verifies.

Concretely on today's run: at ±10 the evidence pipeline would score reps 1-3 **on
target** and only rep 4 (419, 11 off) as "fast". The watch's ±8-on-instantaneous
scored three of them "drifted". **Same run, same four reps, two engines, opposite
answers**, and the runner only ever sees the harsher one.

Also note the `work-phase-splits` basis **cannot fire for this session at all**:
`contiguousWorkWindowMi` (`goal-projection.ts:1017-1046`) returns null when work is
split across disjoint blocks, which 4 reps with jogs between them always are.

### Is 7:02–7:18 justified at confidence 0.727?

**No.** ±8 s/mi is 1.9% of 430. The threshold anchor is a VDOT 47.9 estimate at
0.727 confidence resting on a half marathon 16 days old; the uncertainty in the
*centre* of that band is comparable to the band's own half-width. Presenting
`7:02-7:18` implies the centre is known to about a second. Finding 2 shows the
cost: a rep at 419 — 3 s/mi outside a band whose centre is not known to 3 s/mi —
is graded **missed**.

### Why this session, and why 4 reps?

**The catalogue entry exists; the stored answer does not.**

`web-v2/lib/workout-catalogue/catalogue.ts:692-750`, slug `cruise-intervals`,
`§5.3`, family `threshold`:

```
structures: reps 3-6 × 1 mi, recoverySec 60  ("1 min jog per mile of work segment")
            reps 2-4 × 2 mi, recoverySec 120
            + two fixed sequences (1+1+1+1+2; 1-2-1-2-1 pyramid)
atPace: 4-8 mi · warmupCooldownMi: 2-3 mi · cadence: 7 days
phases: hill_strength, specific_support, race_specific, taper
```

The production row sits inside every band (WU/CD 2.1 ∈ [2,3]; rest 60 s = the
1-mile structure's `recoverySec`).

**There is no 3→4→5 progression ladder.** The count is a descending fit loop —
`web-v2/lib/workout-catalogue/select.ts:788-791`:

```ts
let reps = structure.reps.max;                                    // 6
while (reps > structure.reps.min && reps * one > sizeToMi) reps--; // floor 3
```

So **4 reps ⟺ the week's threshold budget `sizeToMi` lands in [4, 5) miles.** The
budget is `min(sessionAllowanceMi, targetAtPaceMinutes-converted)`. Which *entry*
wins is least-recently-used rotation (`select.ts:967`), not a ladder.

Two consequences worth naming:

1. **This is a live Rule 9 cliff.** `reps * one > sizeToMi` is a hard `>` on a
   continuous quantity: a budget of **4.999 mi buys 4 reps, 5.000 buys 5**. One
   thousandth of a mile changes the session. It belongs on the continuity-walk
   list alongside the boundaries `_restore_continuity.test.ts` already covers.
2. **It explains why week 1 and week 8 are the same session.** 2026-09-01 and
   2026-10-20 are byte-identical (4×1 mi, 8.5 mi, 430, WU/CD 2.1/2.1) because the
   threshold budget landed in the same bucket both times. Nothing is walking a
   ladder, so nothing progresses.

And the "why" is **unanswerable from production**: `selection_rationale` is absent
on all 103 rows (Finding 6). The string it *would* have held is
`select.ts:1248-1250` — *"Cruise intervals (§5.3) · threshold on the threshold slot
in QUALITY; N session(s) eligible, least recently used wins."* It was computed at
authoring and discarded, because `RATIONALE-PERSIST-1` landed 2026-09-01, a day
after this plan was authored.

### Are sealed/completed rows immutable in the recompute path?

**Yes — and by two independent gates, the stronger of which is the date, not the
seal.** `lib/plan/recompute-paces.ts:525-543`, verbatim:

```sql
       EXISTS (
         SELECT 1 FROM runs r
          WHERE r.user_uuid = $2::uuid
            AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
            AND NOT (r.data ? 'mergedIntoId')
       ) AS sealed
  FROM plan_workouts pw
 WHERE pw.plan_id = $1
   AND pw.date_iso::date >= $3::date
   AND pw.type <> ALL($4::text[])
```

and the guard at `:584`:

```ts
if (row.sealed) { sealedCount++; continue; }
```

Precisely:

- **Past rows are never selected at all.** `pw.date_iso::date >= $3::date`
  (`$3 = today`) excludes them outright, sealed or not. The seal is therefore only
  load-bearing for **today's** row.
- **"Sealed" means a canonical run exists on that calendar date** — note it uses
  `NOT (r.data ? 'mergedIntoId')`, the Rule 14 `CANONICAL_ROW_SQL` predicate. It is
  keyed on the *date*, not on the plan-workout id, so **any** run that day seals the
  row, including an off-plan one.
- `$4 = RECOMPUTE_EXEMPT_TYPES` — which is how the race row went stale (Finding 1).
- The rewrite (`:626-635`) replaces `pace_target_s_per_mi`, `sub_label` and the
  whole `workout_spec` **except** `progression` and `selection_rationale`, which
  `preserveProgressionSql` (`progression-spec.ts:337`) merges forward as a Rule 6
  field-level guard.
- The rebuild reads the **live** `profile.lthr` (`:509-518`), not the frozen
  `authored_state.lthr_bpm` — i.e. the Rule 10 defect CLAUDE.md records for this
  file has been fixed.

**Live corroboration (Rule 13, on real data):** week-0 rows 2026-08-26 → 08-30
still carry `hr_cap_bpm 145` = `ceil(162 × 0.90) − 1`, the **pre-re-anchor** LTHR;
every row from 2026-08-31 forward carries **151** = `ceil(168 × 0.90) − 1`. The
re-anchor rewrote 77 workouts and left the sealed past untouched. The mechanism
works, and the data proves it rather than a comment asserting it.

---

## What is good, and worth not breaking

- **Rule 8 is correctly applied and correctly split.** `sustainedMi 45` excludes
  the AFC taper/recovery window; `recentLongMi 18` (habit, filtered) and
  `spikeAnchorLongMi 13.5` (injury guard, unfiltered) are kept as separate
  quantities. This is the hardest rule in the file and the engine got it right.
- **Rule 10's stamp posture** is applied on the spec (`lthr_bpm` beside the
  derivation) and the sealed guard demonstrably preserved the old anchor on past
  days.
- **The block does not chase the goal.** Race day is prescribed from evidence, not
  from 3:00:00, and `goal_realism.flag` is honest about the gap. Whatever else is
  wrong with 436, it is not goal-poisoned.
- **Phase sequencing, cutback cadence (wk 2/7/10, −25%), and taper shape** are all
  doctrine-correct.
- **Easy-day variation improved** since the 2026-08-30 audit named it.
- **The backdate guard works** — unsealed past days dropped, sealed ones preserved.

## Top three, in order

1. **Finding 1** — "marathon pace" is 475 in training and 436 on race day. He never
   rehearses his race. Root cause found: `race` is in `RECOMPUTE_EXEMPT_TYPES`
   (`recompute-paces.ts:322`), so the 2026-08-31 recompute moved 77 training rows
   and could not move the race row. The fix pattern is 70 lines above it in the
   same file, where `shakeout` was removed from that list for this exact reason.
   Fix before week 8 (2026-10-19), when MP volume starts.
2. **Finding 2** — a perfectly executed threshold session graded drifted ×3 +
   missed. This is live, it happened today, and it punishes exactly the behaviour
   the mission statement exists to reward. The server's own evidence pipeline
   (±10) would have scored it more kindly than the watch (±8) — four tolerances
   exist for one number.
3. **Finding 3** — race-day HR cap 155 is unachievable at the prescribed 431-441,
   and the validator that would catch it is written but not wired.

## Method note

Audited commit **`7cac80f0`**. The worktree I was assigned was created from the
stale `claude/build-runcino-app-OIRJr` line (`f43fb7a7`), which has no `web-v2/`
or `native-v2/`; I detected this before doing any work and reset the worktree to
`7cac80f0`. No commits, pushes, or writes were made to the repository. All
database access was via the `faff_readonly` role; the one TypeScript execution
(`_coaching_thesis.audit.test.ts`) had `DATABASE_URL` pinned to the read-only URL
for that process only.
