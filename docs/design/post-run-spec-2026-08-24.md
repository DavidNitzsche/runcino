# Post-run — what each kind of run has to say for itself

2026-08-24. Written from `Research/`, not from the current UI and not from the
design files. The design decides *how* a row looks; this decides *which rows
are true*.

The brief was: **"each type of run will need a different break down. Not
everything is by mile. Not everything is a global cadence, etc. not everything
is a global HR."** That is correct, and the research is blunter about it than
the brief is. The failure mode is not a missing row. It is a row that is
arithmetically fine and describes no part of the session.

---

## 0 · The four rules that generate every table below

**R1 · The unit of the recap is the unit of the prescription.**
A session prescribed as `4 × 1 mi @ T` was not run in miles of *the run*; it
was run in reps. Mile 2 of that session is the back of rep 1, a jog, and the
front of rep 2, averaged into one bar. `Research/01-pace-zones-vdot.md`
§"Pace zone width and lock-in rules" makes the ask explicit —
`| I | ±3 sec per rep | Yes — by interval time, not by per-mile pace |` — so a
per-mile chart is answering a question the plan never asked.

**R2 · An average is honest only over an interval of constant intent.**
A whole-run mean is a fair summary of an easy run because an easy run has one
intent from start to finish. Over warm-up + reps + jogs + cool-down it is a
number with no referent. Every mean below therefore carries a stated **scope**:
whole-run, work-only, or a named segment. A mean with no scope is a defect.

**R3 · Heart rate is a lagging response, and short work outruns it.**
`Research/03-heart-rate-zones.md` §13: "HR rises with a half-time of ~30 s on
intensity step-up, plateauing at 90–180 s." Its decision table then says
`| Reps / R-pace (<2 min) | Pace | RPE | Ignore HR |`. Not "de-emphasise" —
**ignore**. The corollary the app has never honoured: if HR must be ignored
*during* the reps, an HR verdict *after* them is the same claim made later.

**R4 · A refusal is a correct answer.**
From `docs/faff-iphone-design-contract.md` §1: "A refusal means *we read it and
the answer is no*." Omitting avg HR from a 12×400 is not a gap in the data. It
is the finding.

And one carried over unchanged: **a modelled number must never look measured**
(same contract). Grade-adjusted pace, heat-neutral equivalents, estimated
VDOT, training load — all modelled, all marked.

---

## 1 · The global aggregate audit

The three numbers the app shows on every run, ruled once:

| Number | Honest on | Must be scoped on | Must be absent on |
|---|---|---|---|
| **Avg HR (whole run)** | easy, recovery, long, progression, MP, race, treadmill-steady | tempo, threshold, long-with-finish, race-week tune-up, fartlek (→ work-only) | intervals with reps < 2 min, hill work, walk-run, strides-only |
| **Avg cadence (whole run)** | easy, recovery (single-pace runs only) | long, progression, MP, race (→ first-third vs last-third, as a *delta*) | every rep session, hill work, walk-run, fartlek |
| **Avg pace (whole run)** | easy, recovery, long, progression, race | tempo, threshold, intervals, tune-up (→ work-only, and never printed beside the rep target) | walk-run, hill work |

**Cadence deserves its own sentence, because it is the worst offender.**
`Research/16-form-biomechanics.md` §2.3 lists what moves cadence:
`| Pace (faster) | Higher cadence |`, `| Surface (uphill) | Cadence rises;
stride length shortens |`, `| Fatigue (later in run) | Cadence drops |`. A
single spm figure across a run that changed pace four times is the mean of four
different distributions. §2.2 settles what cadence is *for*: "The intervention
in the literature is **a relative shift (5–10% above habitual)**, not an
absolute target." Cadence is only ever meaningful **against this runner's own
cadence at this pace** — so the honest render is a *delta* (late-run vs
early-run), never a bare number with no comparator.
`Research/15-wearable-data.md` says it in one line: "Cadence drift downward at
constant pace = fatigue or fitness loss." *At constant pace.*

---

## 2 · Per type

Each block: **decomposition** · **rows in** · **rows out** · **the one deciding
measure** · **context filters**. `[J]` marks a judgement call the research does
not settle.

---

### 2.1 Easy

**Decomposition.** The whole run is one unit. Per-mile splits are the only
decomposition needed. `Research/01` §"When to lock to a specific pace vs. give
a range": `| Easy day, base mileage | Wide range; effort-anchored |`, and the
band table gives `| E | ±30 sec/mi (wide) | Never. Prescribe a window. |` — so
per-mile pace is context, not a grade.

**Rows in.** Distance · time · avg pace (whole-run, honest) · **avg HR against
his own easy ceiling** · per-mile splits with HR · conditions.

**Rows out.**
- A pace *verdict*. The band is ±30 s/mi and prescribed as a window; marking
  a mile "slow" against it invents a precision doctrine explicitly refuses.
- Cadence as a bare number. Nothing on an easy run makes 174 spm mean anything
  without his own easy-pace baseline beside it.

**The one deciding measure.** **Submaximal HR at his usual easy pace, versus
his own recent baseline.** `Research/00b-recovery-protocols.md`
§"Quantitative Signals": `| Submaximal HR | HR ≥5 bpm higher than usual at
fixed easy pace | Aerobic decoupling without training stimulus = fatigue. |`
and `Research/03` §18: "Easy-pace HR dropping at fixed pace over weeks →
aerobic adaptation working. Easy-pace HR rising at fixed pace over weeks →
under-recovery or stress." The absolute avg HR is nearly worthless; the *delta
against his own history at the same pace* is the entire signal.

**Context filters (each applied to this observation, not inherited).**
Heat (`Research/06` §1 — a 5 bpm lift at Td 68 is the weather, not fatigue) ·
days since a race · illness · terrain (a hilly easy run's HR is a grade
artefact) · warm-up ramp (his 2026-08-24 run opens at 128 bpm and closes at
158; a mean of 139 describes neither end).

---

### 2.2 Recovery / shakeout

**Decomposition.** One unit. Duration, not distance —
`Research/00b` §"Recovery Run vs. Easy Run": `| Duration | 20–45 min (cap to
avoid glycogen depletion) |`.

**Rows in.** Time · avg HR against the recovery ceiling · distance (secondary).

**Rows out.**
- **Pace, as anything but a footnote.** `Research/03` §14:
  `| Recovery jog | HR | RPE | Cap HR; ignore pace |`. "Ignore pace" is the
  doctrine. A recovery-run pace verdict is the app grading the one session
  defined by not being graded.
- Splits. Nothing in a 25-minute shakeout varies enough to decompose.
- Any good/bad verdict. `Research/00b`: "A recovery run does not make recovery
  faster than rest... If true recovery is in doubt, choose rest."

**The one deciding measure.** **Did HR stay under the recovery ceiling?**
`Research/00b` puts the recovery run at `≤60% HRmax` against the easy run's
`60–70% HRmax`. One boolean.

**Context filters.** Heat · elevated morning RHR (`Research/03` §9:
`| +7+ bpm | Easy day or rest |`) — if RHR was already up, an over-ceiling
recovery run is the body, not the choice.

---

### 2.3 Long run

**Decomposition.** **Thirds, not miles** — plus the named finish segment when
the spec carries one (`finish_mi` / `finish_pace_s_per_mi` / `finish_label`).
Miles are still shown; the *read* is first-third vs last-third.
`Research/03` §12 defines the analysis on halves: "Compare first vs. second
half of a steady aerobic run (60–90 min)."

**Rows in.** Distance · time · **aerobic decoupling (Pa:HR)** · finish-segment
pace against its own target when a finish exists · cadence *delta* first-third
→ last-third · fuelling when the run cleared 60 min (`Research/18`;
`run-recap.ts` already gates on `FUELLING_RELEVANT_MIN_MINUTES = 60`) ·
elevation.

**Rows out.**
- **Whole-run avg pace as a grade.** A progression long run is *supposed* to
  have a fast last third; its mean averages two intents.
- **Avg HR as a grade.** Cardiac drift is designed in — `Research/03` §1:
  `| Cardiac drift (>30 min steady) | Rises | +5–15% over 60 min |`. Show HR as
  a *shape* (the drift), not a *level*.
- A cadence number. Show the fade.

**The one deciding measure.** **The fade — `Pa:HR` decoupling.**
`Research/03` §12: `| <5% | Strong aerobic endurance; sustainable |` ·
`| 5–8% | Acceptable; approaching aerobic limit |` · `| 8–10% | Endurance gap;
build base before progressing |` · `| >10% | Above aerobic threshold or
insufficient endurance |`. And: "A well-paced marathon shows <5% Pa:HR
decoupling at 30 km." **On a long run with a prescribed finish the deciding
measure moves to the finish segment** — `Research/03` §14:
`| Long run with fast finish | Pace | HR | Target pace last 25% |`.

**Context filters.** Heat is the big one and it is *not* a flat correction:
`Research/03` §12 — "Heat adds 2–5% artifactually — control conditions" — so a
hot long run must not be reported as an endurance gap. Also fuelling (a bonk is
a fuel finding, not a fitness one) · terrain · days since a race · whether this
was a dress rehearsal (`Research/04` §4.6: "Not a fitness builder — keep effort
controlled").

---

### 2.4 Tempo / progression / marathon-pace

**Decomposition.** **The work block alone**, as one unit, with warm-up and
cool-down named but ungraded. A progression run decomposes into its prescribed
segments (`prog_start_s_per_mi` → `prog_end_s_per_mi`); an MP run into its MP
block.

**Rows in.** Work-block distance, duration and pace · **time in band within the
block** · avg HR *scoped to the block* · the ask beside the ran, block-to-block.

**Rows out.**
- Whole-run avg pace. On 2 mi WU + 4 mi T + 1 mi CD the whole-run mean is
  ~40 s/mi slower than the tempo, and it is the number a runner will subtract
  from his target.
- Whole-run avg HR — same reason.
- Per-mile bars *judged* against the tempo target. Mile 1 is a warm-up.

**The one deciding measure.** **Time in band inside the work block, not the
block's average pace.** Two runs can average 6:59 for four miles: one held
6:57–7:01 throughout, the other sawed 6:40 / 7:20. `Research/01` gives tempo
the tightest lock outside reps — `| T | ±3 sec/mi | Yes — narrow window
required for adaptation |` — because the adaptation is a steady-state one.
`Research/04` §5.2 sets the floor the block must clear:
`| Duration | 20 min minimum for stimulus; 20–40 min sweet spot |`. So the
verdict is two facts: **did the block clear 20 minutes**, and **how much of it
sat inside the band**. The watch already counts this
(`PhaseBreakdown.time_in_tolerance_sec`) and nothing reads it.

`Research/03` §14 keeps HR co-primary here and only here:
`| Tempo (continuous) | HR or Pace | RPE | Both valid >15 min |`.

**Context filters.** Heat at the *continuous* rate, not the halved rep rate
(`Research/06` §2: "For repeats with ≥1:1 work:rest, apply **half** the
continuous-run adjustment") · grade · `Research/04` §5.2's own
contraindication: "Skip if HR/perceived effort elevated — pace will lie."

---

### 2.5 Threshold (cruise intervals)

**Decomposition.** **Per rep**, jogs shown as jogs and never graded.
`Research/04` §5.3 makes recoveries part of the prescription —
`| Recovery | 1 min jog per mile of work segment |` and "Lengthening rest
changes the workout — keep recoveries short" — so jog *durations* are evidence;
jog *paces* are not.

**Rows in.** Rep-by-rep pace against the rep target · **cumulative time at T
across the reps** · rep-scoped avg HR (reps here are 5–15 min, so HR is valid) ·
actual jog durations against prescribed.

**Rows out.**
- Whole-run anything — pace, HR, cadence.
- A "target" beside a recovery jog. `RunDetailV5.swift` already refuses this,
  and its comment is the right rule in the right place: "A RECOVERY JOG'S
  'TARGET' IS NOT A TARGET."
- Per-mile splits as a graded chart.

**The one deciding measure.** **Cumulative time at T, and whether the reps held
the band without lengthening the rest.** `Research/04` §5.3:
`| Purpose | Accumulate more time at T than a single tempo allows |` and
`| Total volume at pace | 4–8 mi (Daniels: cap T-pace at 10% of weekly mileage) |`.
The dose is the point. "4 of 6 reps at pace" is a cleaner statement than any
average.

**Context filters.** Heat at the halved rep rate · grade · rep length — at
≥5 min HR is a legitimate confirm (`Research/03` §14:
`| Threshold reps (5–15 min) | Pace | HR | Pace primary, HR confirms |`).

---

### 2.6 Intervals (VO2max reps)

**Decomposition.** **Per rep. Only per rep.**

**Rows in.** Rep-by-rep pace or rep time · spread across the reps · whether the
first rep was the fastest · reps completed of reps prescribed · total time at
I pace.

**Rows out — this type has the longest removal list.**
- **Whole-run avg HR.** `Research/03` §14: `| VO2max short (<3 min) | Pace |
  RPE | Ignore HR target |` and `| Reps / R-pace (<2 min) | Pace | RPE | Ignore
  HR |`.
- **Work-scoped avg HR too, when the reps are under ~2 minutes.** This is the
  rule the app is missing. §13's kinetics table:
  `| <30 s (sprints, R) | Useless — HR lags | Pace, RPE |`,
  `| 30–90 s | Late-rep HR meaningful | Pace primary |`,
  `| 90 s–3 min | Reaches band only late | Pace primary |`. An 8×400 never
  reaches its HR band; reporting the HR it did reach reports the lag.
- **The time-in-zone bar.** Dominated by jogs and rise-time, and its target zone
  is unreachable by construction. The most confidently wrong element on a rep
  session today.
- **Whole-run cadence.** Rep cadence and jog cadence are 20+ spm apart.
- **Per-mile splits.**
- **Whole-run avg pace**, anywhere near the rep target.

**The one deciding measure.** **Per-rep consistency — the spread, and whether
the set descended or faded.** `Research/04` §6.4 states the failure mode:
`| Contraindications | Avoid running first reps too fast — first rep should not
be the fastest |`. `Research/01` sets the tolerance:
`| I | ±3 sec per rep | Yes — by interval time, not by per-mile pace |`. The
secondary number is dose — `Research/00a` §6:
`| Total work | 10–20 min above 90% VO2max — roughly 15–30 min of total intervals |`,
with "Long intervals (3–5 min) accrue more time at >90% VO2max than short,
intensified intervals — a determining variable for VO2max gains."

`run-recap.ts#intervalPacing` already computes exactly this pattern.

**Context filters.** Heat at half rate · grade · sensor class
(`Research/15`: `| VO2 intervals, hill repeats, sprints | Chest strap or arm
band; do not coach off wrist HR |` — a second, independent reason to drop HR
here for an Apple Watch runner) · reps completed (a 5-of-6 session is not a
graded 6).

---

### 2.7 Fartlek

**Decomposition.** **Per surge, by time.**

Note: the engine has **no `fartlek` spec kind**. `buildWorkoutSpec` routes
fartlek through `timeRepSpec('threshold', …)` with `by_effort: true` and the
identity carried in `label` ("Mona"). Read the label and the `rep_duration_s`,
not the kind.

**Rows in.** Surge count · time at effort · the shape (did the last surges match
the first).

**Rows out.**
- Anything per mile. A Mona fartlek is 2×90 s, 4×60 s, 4×30 s, 4×15 s. Mile
  splits cut across it at random.
- Pace *verdicts*. `Research/04` §9 defines fartlek as "speed play... Run by
  feel", and the floats are "recovery jogs (not stops)". The spec already
  carries `by_effort`; the engine knows.
- Whole-run avg HR or cadence, for the reps-under-2-min reason above.

**The one deciding measure.** [J] **Total time at effort, and whether the last
surges matched the first.** The research names the dose (`Research/04` §8.6:
`| Total at-pace | 5–10 min total of uphill surging |`) but publishes no
consistency threshold for fartlek the way it does for I reps. Judgement: apply
the ±3 s/mi lock only when the spec carries a pace; otherwise report shape
without a verdict.

**Context filters.** Terrain (a hill fartlek is a hill session) · `by_effort` —
when set, **no pace target may be printed at all**.

---

### 2.8 Hill work

**Decomposition.** **Per rep, by time and by climb** — never by pace.

Also has no spec kind of its own; it is `timeRepSpec('threshold', …)` with
`by_effort: true`, `rep_pace_s_per_mi: null`, and "hill" in the label.

**Rows in.** Rep count · rep duration · elevation gained per rep · total climb.

**Rows out.**
- **Pace. Entirely.** `Research/03` §14: `| Hill repeats | RPE | HR | Pace
  meaningless |`. Not "adjust the pace"; meaningless. `lib/faff/types.ts`
  documents the same: "the pace column reads '5K–10K effort', never a number,
  because a flat-ground pace is unreachable on a gradient."
- **Grade-adjusted pace as a substitute.** GAP is modelled, and on a 10-second
  hill sprint it models a steady state that never existed.
- Whole-run avg HR for short hills (`Research/04` §8.2: `| Duration | 10–30 s |`
  — far under the kinetics floor).
- Cadence. `Research/16`: `| Surface (uphill) | Cadence rises; stride length
  shortens |` — the number moves for a mechanical reason and says nothing about
  the runner.

**The one deciding measure.** [J] **Reps completed at held form, and total
climb.** The research grades hills by completion and quality, not by any
recorded number (`Research/04` §7.3: "Not a workout — back off if form
deteriorates"; hill sprints recover "until normal breathing returns"). The app
cannot measure form. It should report what it *can* — reps done, climb gained —
and stop. **Do not manufacture a verdict.**

**Context filters.** Whether grade was recorded (barometric elevation is real;
*grade per rep* is only as good as the GPS) · surface.

---

### 2.9 Race-week tune-up

**Decomposition.** **Per phase** — the type that most needs it. The 2026-08-11
session stores nine phases; a single average across them describes no part of
it.

Engine note: `buildWorkoutSpec` emits `kind: 'threshold'` for
`race_week_tuneup`, so **the tune-up identity is lost at the spec layer** and
must be read from `plan_workouts.type`, not from the spec.

**Rows in.** Phase by phase, work phases named and graded, jogs named and not ·
work-scoped pace against the ask · **an explicit "this was sharpening, not a
test" frame**.

**Rows out.**
- Any whole-session average whatsoever.
- **Any fitness inference.** This is the removal that matters, because a tune-up
  *looks* like a predictor. `Research/08` §9.4: "'Taper crud' / 'taper madness'
  — fatigue, sluggish legs, irritability, sleeplessness, phantom pains — is
  normal. **Resist the urge to test fitness. The work is done.**" A tune-up that
  felt heavy is a taper artefact until proven otherwise, and must never move a
  VDOT, a projection, or a goal verdict.
- A comparison to the same session earlier in the block. Different taper state,
  different question.

**The one deciding measure.** **Did the race pace feel controlled?** Not the
clock. `Research/02` §12.4: "Not a quantitative predictor, but a binary go/no-go
signal: if the tempo feels redline, the goal is too aggressive." That is an RPE
question, which makes the tune-up **the one session where the app must ask him**
rather than compute. HR at race pace is the objective co-signal
(`Research/08` §6.1 HR ceilings by distance) and it is a *ceiling check*, not a
grade.

**Context filters.** Taper (mandatory, and a *suppression*, not an adjustment) ·
heat · days to race · that a race-week session is by design below capacity.

---

### 2.10 Race

**Decomposition.** **5 km segments for a marathon; per mile for 5K/10K/HM.**
`Research/08` §2.2: "The standard analytical method in marathon pacing
literature divides the 42.195 km into eight 5-km segments plus a final 2.195-km
section."

**Rows in.** Chip time (canonical — `Research/15`: "the official chip time over
the certified course is canonical", and `CLAUDE.md`'s race-data rule says the
same) · segment splits · **first-half vs second-half** · the conditions-adjusted
neutral equivalent, **marked as modelled** · HR against the distance's ceiling ·
cadence fade in the closing quarter.

**Rows out.**
- **GPS distance and GPS-derived pace, presented as the result.**
  `Research/15`: "Race PRs measured by GPS distance can over- or under-report by
  1–3% on technical courses." The watch's 26.4 miles is not the race.
- Avg cadence as a number (show the fade — `Research/08` §7.1: "cadence drops
  3-8 spm in the final 10K of a marathon... The cadence drop precedes the pace
  drop by a few minutes").
- A "PR" claim from a training effort — already locked in `CLAUDE.md`, restated
  because this screen is where it would leak.

**The one deciding measure.** **Pacing execution — the second-half delta.**
`Research/08` §3.5: "**Key rule:** second 10K should never be slower than first
10K by more than 1-2%. A 4:00 marathon as 1:55/2:05 is botched; the same fitness
as 2:00/2:00 finishes 5+ minutes faster." And `Research/02` §13.6: "Most
prediction failures at the marathon are pacing failures." The CV of the 5 km
segments is the formal version (`Research/08` §2.2 tier table). For 5K/10K/HM,
`Research/08` §3 gives the per-segment template to grade against.

**Context filters.** Heat/dewpoint/wind/altitude, composed once and only once
(`Research/06` §10: `total_slowdown_pct ≈ heat_pct + altitude_pct + wind_pct +
aqi_pct`, with the "heat and altitude slightly compound" caveat) · course
profile (`Research/08` §4.5 — a net-downhill split pattern is a quad-damage
story, not a fitness one) · race priority A/B/C (a C race run as a workout is
not a failed race).

---

### 2.11 Treadmill (a modality overlay, not a type)

Applies **on top of** whichever type the session was. It is a run-side
attribute (`runs.data.indoor` / `source: 'treadmill'`) resolved through
`lib/terrain/run-terrain.ts`, and it reaches the recap only inside `terrain`.

**Rows out.**
- **The route card and the elevation profile.** The design already handles this
  (5c swaps in an "On the belt" card); stated here so run detail honours it too.
- **GPS-derived anything.** `Research/15`: "**Treadmill GPS** is meaningless."
- **Pace compared to an outdoor target without the incline.** `Research/01`
  §"Treadmill workout-specific notes": "**Calibration**: many consumer
  treadmills mis-report speed by ±5%." `run-recap.ts` already refuses to adjust
  when the incline is unknown (`basis: 'treadmill-incline-unknown'`) and that
  refusal is correct.

**Rows in.** Avg speed · avg incline · **HR, the one signal a belt does not
distort** — and therefore promoted on a treadmill run.

**Context filter.** `Research/01` §"Cooling penalty": "Add ~2–4% to the pace
adjustment for treadmill at temperatures >68°F or with no fan." Indoor air is
still; a treadmill HR reading in a warm room is a heat reading.

---

### 2.12 Walk-run (return-to-running)

**The app has no type for this.** `SESSION_TYPES` carries thirteen members and
none is walk-run. `lib/plan/injury-builder.ts` inserts `plan_workouts` rows
**with no `workout_spec` at all**, so there is nothing to expand and nothing to
grade against; the recap falls to its `default` arm and says "Logged."

**Decomposition.** **Per interval, by time**, against the stage.
`Research/05-injury-return-protocols.md` §1.1 publishes the eight-stage table:
`| Stage | Run (min) | Walk (min) | Repeats | Total run time | Sessions/wk |`.

**Rows in.** Total **run** time (not distance) · intervals completed vs stage ·
the stage itself.

**Rows out.**
- **Pace, and every pace-derived number.** `Research/05` §1.1: "Pace:
  easy/conversational only." There is no target to miss.
- **Avg HR and avg cadence across the session** — both averaged over walking
  and running, so both meaningless by construction.
- Distance as the headline. The prescription is in minutes.

**The one deciding measure.** **Pain — during, and at 24 hours.**
`Research/05` §1.2: "**The 0-10 in-session rule.** ... 0-2: green. Continue,
progress next session. 3-5: amber. Tolerable. Hold current load; do not
progress. 6+: red. Stop the session. Drop a stage next attempt." and "**The
24-hour rule.** Pain the morning after the session... Same or better than
baseline within 24 h: tolerated. Progress permitted." **This is the only run
type whose deciding measure is not in the run data at all.** It has to be asked,
twice — once after, once the next morning. No capture path exists.

---

### 2.13 Off-plan / unplanned

**Decomposition.** Whatever shape the run itself has — laps if he pressed lap,
miles otherwise.

**Rows in.** Distance · time · pace · avg HR · splits · conditions.

**Rows out.**
- **Every "asked" column, every band, every verdict.** There was no ask. A
  reconciliation badge on an unplanned run is the app inventing a prescription
  in order to grade against it.
- Any comparison to the plan's session for that day, unless he links it.

**The one deciding measure.** [J] **What it did to the week.** Nothing in
`Research/` grades an unprescribed run, because coaching research grades
sessions against intent. The honest post-run is descriptive plus one
forward-looking fact: what it costs the next quality day
(`Research/00b` §"Hard/Easy Alternation" supplies that table).

---

## 3 · The zone-band question, answered

The owner asked whether the gaps in `computeZones({lthr: 162})` are correct
doctrine. **They are not, and there are four separate problems, only one of
which is the rounding.**

`lib/training/zones.ts#lthrZones` implements `Research/03` §6's Friel table.
Friel's bands are stated in **integer percent** and are contiguous by
construction: `| 2 Aerobic / Endurance | 85–89% |` then `| 3 Tempo | 90–94% |`.
Multiplying by 162 and rounding each edge independently breaks that:

| Zone | % of LTHR | bpm as implemented |
|---|---|---|
| Z1 | 0 – 0.85 | 0 – 138 |
| Z2 | 0.85 – 0.89 | 138 – 144 |
| Z3 | 0.90 – 0.94 | **146** – 152 |
| Z4 | 0.95 – 0.99 | **154** – 160 |
| Z5 | 1.00 – 1.10 | **162** – 178 |

1. **Three bpm values belong to no zone: 145, 153, 161.** Not ranges — three
   single integers, produced by rounding two adjacent percent edges away from
   each other. Doctrine has no gap; the arithmetic does.
2. **138 belongs to two zones** (Z1 upper and Z2 lower are both 138). The same
   one-value overlap exists at every boundary of the `pctMaxZones` fallback.
3. **Everything above 178 belongs to no zone.** The app collapses Friel's
   5a/5b/5c into one Z5 capped at `1.10 × LTHR`. Friel's 5c is
   `| 5c Anaerobic capacity | > 106% |` — **unbounded**. A hard rep finish at
   182 bpm falls off the top of the table. This is the largest of the four and
   the least visible.
4. **Z1 starting at 0 is faithful to Friel** (`| 1 Recovery | < 85% |`) and is
   still wrong for a *run* recap, because Friel's Z1 is "everything below
   aerobic" — it pools a genuine recovery jog with standing at a traffic light
   and with the first ninety seconds of any run before HR has risen. On a rep
   session, "time in Z1" is mostly jogs and lights, and it renders as though he
   had an easy day.

**The fix is to bucket in percent space** — compute `hr / lthr` and compare
against the percent edges — rather than rounding each edge to bpm and then
comparing. Displayed bpm edges should be derived so they are contiguous
(`Z2 upper = Z3 lower − 1`), and the top band should be open-ended.

**Not implemented, on purpose.** Re-banding moves every zone figure everywhere —
the zone bar, `judgeEasyRunHr`, `zone-target.ts`, readiness, and every stored
`hrZonePcts` computed under the old edges. That is the owner's call.

---

## 3.5 · What his data actually carries

Read over `faff_readonly`, 2026-08-24. A spec that asks for a field no run holds
is a spec nobody can build, so this is the floor everything above stands on.

**143 live runs** (256 rows, but 113 are absorbed duplicates — anything counting
runs must filter `absorbed_into_canonical_at IS NULL` or it double-counts).

| Reliable | Coverage |
|---|---|
| date, distance, avg HR, max HR, elevation gain | ≥99% |
| splits array with per-split HR and pace | 80–100%, **10 different object shapes** |
| avg cadence, GPS polyline, temperature | 80–100% |
| **phases** (work/recovery labels, per-phase HR + cadence + pace + time-in-band) | 56 runs · `source: watch` and `treadmill` only, 2026-06 onward |

| Do not rely on | Reality |
|---|---|
| **Run type** | 36 of 143 semantically typed. The column mixes plan vocabulary with Strava integers. **This is why the scoping rule keys on structure.** |
| Per-split cadence | 7–26% depending on shape |
| Shoes | 34%, none before 2026-05-18 |
| `plan_workout_id` | **The column does not exist.** Plan association is inferred by date, and 0 of 111 `client_workout_id` values match a `plan_workouts.id`. |
| **RPE / feel / notes** | **2 rows in the entire database.** `perceived_exertion` is present-and-null on all 87 Strava detail rows. Treat as absent. |
| Race place, chip-vs-gun, race-day conditions | `actual_result` holds none of them |

**Three findings that change what can be claimed:**

1. **Split arrays over-sum the run.** Not rounding, and not a missing final
   partial mile — the opposite. The dominant split shape carries no per-split
   distance, so each is implicitly one mile and an N-split array claims N miles
   for an N.x-mile run. Median excess **+0.41 mi**; 23 runs are off by more than
   a mile in either direction. (The "99 of 139" figure in the brief did not
   reproduce; the real count is 132 of 138 at a 0.05 mi tolerance.)
2. **The canonical row is sometimes the poorer one.** For 2026-08-24 the merge
   kept the watch record (3 splits, no cadence, no elevation) and discarded the
   Apple Watch twin (5 splits *with* cadence and elevation). The two also
   disagree on elevation gain by 10× (128 ft vs 13 ft).
3. **The 139-vs-141 question has six defensible answers.** Stored `avgHr` 139 ·
   mean of the canonical 3 splits 135.7 · distance-weighted 137.8 · absorbed
   twin's stored 138 · mean of 400 five-second samples 138.8 · naive mean of the
   twin's 5 splits **141.4**. The 141 on screen is the last of these — an
   unweighted average of the *pre-merge* splits. **This is the same disease as
   the rest of the document**: an average with no stated scope, computed a
   different way in a second place. Whichever one is chosen, one derivation
   should own it.

---

## 4 · Defects, as a build list

`Owner`: `me` = this agent (run detail / recap / derivation), `builder` = the
agent rewriting the after-run card, `David` = held for a decision.

| # | Defect | File | Why it is wrong | Status |
|---|---|---|---|---|
| 1 | Whole-run avg HR on every run type, including rep sessions | `RunDetailV5.swift#readingRows`; `RunDetailModal.tsx` | `Research/03` §14 `Reps / R-pace (<2 min) → Ignore HR`. `hr_avg_work` was already on the wire and unread. | **fixed** |
| 2 | Whole-run avg cadence on every run type | same two files | `Research/16` §2.3 — cadence tracks pace, grade and fatigue; a mean over a varying run has no referent. `cadence_avg_work` already on the wire and unread. | **fixed** |
| 3 | HR shown at all on reps shorter than the kinetics floor | same + `lib/coach/reading-scope.ts` | `Research/03` §13 — HR never reaches its band; the number is the lag. | **fixed** |
| 4 | Per-mile split chart drawn on rep sessions | `RunDetailV5.swift#splitsSection`; `RunDetailModal.tsx` | The Swift file's own comment states why it cannot work — "mile two of that session is the back of rep one, a recovery jog and the front of rep two averaged into one bar" — and then drew it anyway. | **fixed** |
| 5 | Time-in-zone bar drawn on rep sessions | `RunDetailV5.swift#zoneSection`; `RunDetailModal.tsx` "TIME IN ZONES" | Dominated by jogs and rise-time; its target zone is unreachable by construction. | **fixed** |
| 6 | Web run detail has no rep breakdown and no time-in-band line | `RunDetailModal.tsx` | `phase_breakdown` and `time_in_tolerance_sec` have been on the endpoint since P44 and web never asked for them. The native screen already drew both. | **fixed** |
| 7 | `fartlek`, `progression`, `race_week_tuneup` all recap as "Logged." | `run-recap.ts#deriveRecapCore` default arm | Three real session types die at the default arm. §2.4, §2.7, §2.9. | **fixed** |
| 8 | `race_week_tuneup` has no `derivePurpose` arm → "By feel." | `lib/coach/run-purpose.ts` | Same gap, pre-run side, on the most over-read session in the block. | **fixed** |
| 9 | The recap PROSE quoted the whole-run HR inside a sentence about the work | `run-recap.ts` tempo + intervals arms | "Tempo done · 4.0 mi @ 6:59 · avg HR 148" — the two halves describe different intervals and nothing said so. | **fixed** |
| 10 | `AVG PACE` unscoped on a structured session | `RunDetailModal.tsx` | 7:18 over nine phases whose reps ran 6:2x. Now `WORK PACE`. | **fixed** |
| 11 | The `pass` contingency rule uses HR for `intervals` | `lib/plan/spec-builder.ts` | One clause covers `threshold\|tempo\|intervals\|race_week_tuneup`. HR is right for the first two and wrong for reps per §2.6. Nothing evaluates `pass` rules today, so this changes no screen — but it changes authored spec bytes, so it is not worth the plan-stability risk in this pass. | open, low priority |
| 12 | **A race-week tune-up anchors the run-VDOT read** | `lib/training/vdot-inputs.ts` — `pw.type IN (…,'race_week_tuneup')` | `Research/08` §9.4: "Resist the urge to test fitness. The work is done." A sharpener run on taper legs is being used to set fitness, and fitness sets every prescribed pace. | **held for David** — moves paces app-wide |
| 13 | That same subquery picks its plan row with `ORDER BY pw.type LIMIT 1` | `lib/training/vdot-inputs.ts` | Alphabetical. With two qualifying plan rows on one date it takes whichever type sorts first, which is arbitrary rather than wrong-on-purpose. | open |
| 14 | No `walk_run` session type; injury rows carry no `workout_spec` at all | `lib/training/workout-type.ts`, `lib/plan/injury-builder.ts` | §2.12 — the plan builds the ladder, the recap cannot name it, and there is no spec to expand. | David (taxonomy, likely DDL) |
| 15 | No pain capture, and RPE is ~1.4% populated (2 rows in the whole database) | `post_run_rpe`, `subjective_checkins` | The only deciding measure for a walk-run is not collected, and §2.9's go/no-go is not either. Net-new capture, not a read. | David (new capture) |
| 16 | Zone bands leave 145 / 153 / 161 unzoned, double-count 138, cap at 178 | `lib/training/zones.ts` | §3 above. | **held for David** — moves every zone number in the app |
| 17 | Whole-run avg HR / cadence on the after-run card | `TodayAfterV5.swift`, `lib/faff/v5-today.ts` | Same as #1 and #2, other surface. `RunDetail.readings` is the wire field to consume. | builder |
| 18 | Per-mile decomposition on the after-run card for rep sessions | `TodayAfterV5.swift`, `ChartsV5.swift` | Same as #4. `readings.splitsMeaningful` is the gate. | builder |

### The one thing a builder needs from this

`GET /api/runs/[id]` now returns a `readings` block:

```ts
readings: {
  hr:      { scope: 'whole' | 'work' | 'none'; value: number | null; note: string | null };
  cadence: { scope: 'whole' | 'work' | 'none'; value: number | null; note: string | null };
  pace:    { scope: 'whole' | 'work';          value: number | null; note: string | null };
  splitsMeaningful: boolean;
  zoneBarMeaningful: boolean;
  isRepSet: boolean;
}
```

`scope: 'none'` is a **refusal** — draw no row. Do not fall back to `hr_avg`;
that fallback is the defect. `note` is the interval, already in runner-English
("across the 4 reps"), meant to be concatenated into the row label rather than
shown as a caveat.

**It keys on phase structure, not on workout type, and that is deliberate.** Of
143 live runs in production, 36 carry a semantic type; the rest are null or a
Strava integer, and the column mixes two vocabularies. Phases are present on
every watch run since June, carry the work/recovery labels the type does not,
and — the actual point — a run *with* work phases is exactly a run whose
whole-run mean spans more than one intent.

---

## 5 · Where I am making a call the research does not settle

- **Fartlek consistency threshold** (§2.7). No published tolerance.
- **Hill session verdict** (§2.8). The research grades hills by form and
  completion; the app cannot measure form. I report and do not judge, rather
  than substitute a number that is available for one that is not.
- **Unplanned-run verdict** (§2.13). Coaching research grades against intent;
  there was none.
- **Tempo's per-mile chart.** Suppressed for rep sets (≥2 work phases), kept for
  single-block sessions. A continuous tempo's miles are at least all one intent
  *inside* the block, though miles 1 and 6 are not. Charting only the miles
  inside the block is cleaner and is a bigger change than this pass.
- **Cadence as a delta rather than a level.** `Research/16` and `Research/15`
  both frame cadence relatively; neither publishes the delta window that makes a
  fade "real". First-third vs last-third, reported without a threshold verdict.

---

## 6 · What "perfect" means for this screen

**Every number on the post-run screen can name the interval it is the average
of, and that interval is one the plan actually asked for.** A number that cannot
name its interval comes off.
