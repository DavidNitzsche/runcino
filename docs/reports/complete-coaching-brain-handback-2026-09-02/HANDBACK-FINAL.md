# Faff · complete handback

**Status: section 7 complete and merged. Section 8 partially complete —
the records are clean, the behaviour is not yet.** Everything else is done and
verified. `main` is at `2de5ad60`, CLEAN through all twenty shipping gates plus
`next build`.

---

## 0 · What this is

One document covering the whole programme: what was found, what was changed,
what is proved, what is not, and what remains. It supersedes the three interim
handbacks, which stay in this directory as the record of how it went.

**The live plan has not been rebuilt.** No production write of any kind, proved
by checksum rather than asserted.

---

## 1 · The one-paragraph version

The app's plan generator was reading a dozen inputs that could soften, re-phase
or veto training — daily training form, readiness, sleep, HRV, resting heart
rate, illness, injury, a mislabelled goal-realism flag, and an experience level
the runner typed about himself at onboarding. Those authorities are gone. Three
threshold cliffs were measured and two removed. Two real defects that had
quietly halved the block's marathon-specific work were found and fixed by
recalculation. A race-plus-long-run weekend that had been available to every
runner by accident is now a typed, athlete-specific transaction with an authored
purpose. Race rows update as one coherent contract instead of one number inside
an incompatible structure. What remains is one system: adaptation.

---

## 2 · The plan, as it would actually be written

Two columns, because they are not the same thing and conflating them is the
error §13.1 corrects. **Composed** is the composer's arithmetic. **Written** is
what a rebuild persists — past-dated rows are carried from the sealed history,
never recomposed, and a past date with no live row is not written at all.

| Wk | Start | composed | **WRITTEN** | long | Notable | Flags |
|---|---|---|---|---|---|---|
| 0 | 08-24 | 46.0 | **38.0** | 13.0 *sealed* | 5 sealed rows carried | |
| 1 | 08-31 | 50.0 | **47.5** | 15.0 | 2 sealed rows carried | |
| 2 | 09-07 | 24.4 | **24.4** | RACE 6.2 | Santa Monica 10k · B | cutback |
| 3 | 09-14 | 48.0 | **48.0** | 16.5 | | |
| 4 | 09-21 | 56.2 | **56.2** | 17.0 | **Dodgers C + long · 23.21 mi pair** | |
| 5 | 09-28 | 42.0 | **42.0** | 13.0 | | cutback |
| 6 | 10-05 | 59.5 | **59.5** | 18.5 | | |
| 7 | 10-12 | 60.0 | **60.0** | 19.0 | `LONG · 4mi @ M + 2mi @ T` | **peak week** |
| 8 | 10-19 | 45.0 | **45.0** | 14.0 | | cutback |
| 9 | 10-26 | 59.5 | **59.5** | **20.5** | **`LONG · 11mi @ MP`** | peak long |
| 10 | 11-02 | 44.6 | **44.6** | RACE 13.1 | Run Malibu HM · B | cutback |
| 11 | 11-09 | 40.5 | **40.5** | 16.0 | post-race | cutback |
| 12 | 11-16 | 49.0 | **49.0** | 18.0 | `11 mi @ MP` | |
| 13 | 11-23 | 36.0 | **36.0** | 13.0 | `7 mi @ MP` | |
| 14 | 11-30 | 44.2 | **44.2** | RACE 26.2 | **CIM · A** | race week |

**Only weeks 0 and 1 differ**, and only because they contain sealed rows. Every
other week is written exactly as composed.

| | live | **written** | delta |
|---|---|---|---|
| block total | 695.4 | **694.4** | **−1.0** |
| peak week | 61.0 | **60.0** | −1.0 |
| peak long | 21.5 | **20.5** | −1.0 |
| marathon-pace miles | 38.5 | **33.0** | **−5.5** |

**The block total is essentially unchanged.** An earlier draft of this document
reported +9.5 by comparing composed against live; that was wrong and the
comparison above is like-for-like.

The races, prescribed through the complete production authoring path:

| Date | Race | Role | Stated goal | Prescribed | Source |
|---|---|---|---|---|---|
| 09-13 | Santa Monica 10k | B | none | 43:00 · 6:56 | `expected_race_day` |
| 09-26 | Dodgers 10K | **C** | 45:00 | **45:00 · 7:15** | `controlled_c_effort` |
| 11-08 | Run Malibu HM | B | 1:30:00 | 1:32:10 · 7:02 | `stated_goal_clamped_to_range_edge` |
| 12-06 | **CIM** | A | **3:00:00** | **3:13:30 · 7:23** | `stated_goal_clamped_to_range_edge` |

Four distinct paces, each with one owner. The stated goal is untouched at
10800 s and never prescribed:

> "Your goal (3:00:00) is faster than the likely range's fast edge (3:13:27) ·
> race to the edge; the goal stays yours."

---

## 3 · What no longer influences the plan

| Removed | What it could do before |
|---|---|
| readiness · sleep · HRV · resting HR | soften a session; `AdaptationVerdict.veto` forced PROTECT in the **live** progression gate |
| illness · injury · niggle | the same, plus the walk-run ladder |
| **daily training form (TSB)** | re-phased 7 of 15 weeks — 16.0 mi on one week, 6.0 mi on one long run |
| goal-realism flag | a 15% VDOT screen wearing a feasibility name |
| self-declared experience band | a 65-90 mi/wk band against a measured 48.5 best week |

Enforced by `_authoring_input_surface.test.ts`: every one of `ComposePlanInput`'s
fields must be classified against an allowed input, and the removal list is a
ratchet where a **stale** entry fails as loudly as a new violation.

Injury is sealed three ways — no writer, no acceptor, and `buildInjuryPlan`
refuses as its first statement before any DB read, so a hand-inserted row cannot
archive the block.

**A deliberate consequence, recorded not discovered:** removing pullbacks removed
the 48-hour brake on upward adaptation. Replaced by an **ACWR < 1.3** gate
(`Research/15`, Gabbett) failing closed on an unreadable *and* a
not-yet-computable ratio, so missing data produces **less** upward movement.

---

## 4 · Three cliffs, measured

| Cliff | Verdict |
|---|---|
| `resolveRampBase.lifted` | **Not a cliff for this runner.** `baseMi = max(liftedBase, heldMi)`, `heldMi` 44, flag inert. CLAUDE.md's Rule 9 table entry is stale on this account. A 1-mile non-monotone cliff where it *can* bind; fixed as a maximum. |
| the restore ladder | **Real, found while measuring.** 9.5 block miles and 5.5 on one week for **0.02 mi** of input, its boundary sitting exactly on doctrine's own resume level. Replaced with doctrine's integer rung count. Post-fix 0.0. |
| `cutbackCadence(tsb)` | **Largest; removed, not smoothed.** Authoring no longer calls `computeTrainingForm`. Cadence authored once, inherited via `authored_state.cutback_every_n` — recovering **3** from the live block, so a rebuild preserves the established calendar. Walk −30 → +5: identical plan at every point. |

A missing run sync can no longer reorganise the calendar, by construction.

**One trade, written down:** a genuinely returning runner no longer gets
doctrine's tighter 3-week cycle from a *new* block; it survives only by
inheritance. The alternative measured red on four gates.

---

## 5 · The two defects behind the collapsed marathon work

**The long run.** `smoothLongWoW` capped week 9's long against the **cutback
week** beside it. The validator has bridged planned deloads since 2026-08-28;
the authoring pass that actually cuts never got the exemption. Invisible because
a validator reports what is *illegal*, and a long trimmed *below* the limit is
legal.

**Marathon pace.** `racePaceLongThisWeek` knew about deloads but not races. A
race replaces the long run on the runner's own long day, so the cadence anchored
on a deload, stepped once onto the raced week, and stopped — giving the whole
four-week race-specific phase **zero** MP long runs. The engine wrote
`racePaceLongsInPhase: 0` into `authored_state` and nothing read it.

**The marathon-pace repair is real but incomplete, and the honest comparison is
against the LIVE plan, not against the broken composition.** Before the fix the
race-specific phase received ZERO marathon-pace long runs and the block carried
23.0 MP miles. It now carries 33.0. His live plan carries **38.5**. So the
mechanism is fixed — the phase is no longer empty — but the rebuilt block is
still **5.5 marathon-pace miles short of the plan he is on**, entirely in the
embedded half: 20.5 embedded miles live against 15.0 rebuilt. The stated-pace
half is identical at 18.0 in both.

(Both figures count mile-denominated segments, which is what the engine's own
`33 mi at marathon pace` counts. The rebuilt block additionally carries about
1.2 mi of kilometre-denominated MP reps inside two ladder sessions; the live
plan has none. Including them the gap is 4.3 rather than 5.5.) Whether that is
correct is a coaching question, not a bug, and it is stated here rather than
left inside a favourable comparison.

The longest run is now chosen from evidence and the choice persisted:

```json
{"ceilingMi":21.5,"demonstratedLongMi":21.5,"recentNormalLongMi":18,
 "cycleGrowth":1.15,"tierBandTopMi":24,"boundBy":"demonstrated_long_run"}
```

Races excluded — without that it read 26.8, which is Big Sur.

---

## 6 · The Dodgers weekend

`priority` is load-bearing. **Typing a 43:00 goal now yields 44:30, not 43:00** —
the restraint no longer depends on having typed a soft number.

HR band 168-176 → **161-168**, abort 179 → **171**, "Goal pace" → "Controlled
effort · 7:15/mi", closing-push split removed, *"Push the final mile on feel"*
gone, **3 easy days follow (was 1)**.

**The root defect was larger than the one it was sent after:**
`raceConsumesLongRunSlot('C')` returned false, so every C race in front of every
runner's long run was accepted at full dose with no reference to that runner.

Condition 8 landed as ruled: detect and record, nothing mutates. The `shave`
path was **deleted**, not disabled.

---

## 7 · The load progression contract · DONE

The plan peaked at 60.0 against a band whose top read ~55, and the two
authorities contradicted each other. **Neither number was what it appeared to
be, and the runner's own framing is what unlocked it** — ~55 was not a ceiling,
it was an answer to a question nobody had asked precisely.

It turned out to have **two** distinct meanings, and neither was a limit:

1. It is `TIER_TARGETS.m.intermediate.peakWeeklyMileageBand[1]` — the peak
   `Research/22` §"Marathon — Intermediate" publishes for that template. His
   fifth option: **a historical evidence reference.** It now lives in
   `template_peak_band_mi` and **bounds nothing.**
2. Separately and by coincidence, 55.0 is also the demonstrated week that
   *earns* headroom above a 60-mile peak.

`lib/plan/load-progression-contract.ts` is the one owner, pure, with no DB, no
goal and no experience label. Its refusal branch carries no `mi` field, so a
caller cannot read a load it was refused. Resolved in exactly two places —
`composePlan` at authoring, and `detectRampSignals` for adaptation — through the
same functions.

**The six questions, answered for him, measured:**

| Question | Answer | Basis |
|---|---|---|
| What does the evidence support **now**? | **45.0 mi** | sustained week, floored by held 34.7 |
| What may be authored for the **next** week? | **39.9 mi** | held 34.7 × 1.15 week-over-week |
| What future peak may be **planned**? | **60.1 mi** | demonstrated peak 52.3 × 1.15 per-cycle |
| What evidence makes it **actionable**? | a completed **55.0 mi** week | opens >5% headroom above a 60.0 peak |
| What if he **doesn't** demonstrate it? | envelope does not advance | no cut, no re-phase |
| What may **adaptation** propose today? | 60.1 | block peaks 60.0, so ~0 headroom — correctly refuses |

The planned envelope, week by week: **39.9 · 45.9 · 52.8 · 60.1 · 60.1 · 60.1 ·
60.1** across seven climbing weeks.

**The 60-mile peak stands, and all eight of his conditions are met.** It sits at
week 8 of 15 after seven climbing weeks; cutbacks are authored every third week
with no daily-state input; the peak long of 20.5 is under the 21.5 evidence
ceiling; it needs no readiness, TSB, illness or injury; and it holds with
adaptation disabled. The published band moved `[45,55]` → **`[45,60.1]`**, so
the plan no longer exceeds its own ceiling.

**Condition 5 — independence from the onboarding label — is the one that had
been failing.** Before the change, the word he typed was worth **52.3 versus
60**. Composed now at `null`, `beginner`, `intermediate`, `advanced` and
`advanced_plus`, every weekly volume is byte-identical and the peak is 60.0 in
all five. *Every weekly volume is unchanged from before this work: the plan did
not move, the ceiling that contradicted it did.*

**Adaptation is no longer inert.** It was inert because a well-authored block
always spends its authoring-time headroom, so ceiling and peak were the same
number by construction. The ceiling is now recomputed from his live demonstrated
peak through the same resolver, and the bar — a 55.0 mi week, 5.2% above
anything he has recorded — falls inside weeks 7 and 8 of his own block. It still
cannot write: `tryAdaptiveBump` returns null on the authority check before
reading anything, and the promotion, zero-mutation and single-seam gates are
green.

**Three things this work caught in itself**, which is the standard I want held:

- It introduced a **third Rule 9 cliff** and its own gate caught it before
  commit — a runway of `0` meant "unbounded" (60.1) while `1` meant a real bound
  (52.3), a **7.8 mi step for one week of calendar**. Fixed the Rule 9 way: "no
  calendar" is `null`, a data-presence fact, not a zero.
- A doctrine claim **passed because its regex matched the file's own header
  comment** — the "any comment satisfies it" shape Rule 18 catalogues. Both the
  claim and the gate now strip comments.
- On rebase it checked each of the four items I told it to preserve and found
  **three were already on main**. Replaying them would have caused the exact
  regression I was trying to avoid. It also judged its own measured-zero fix
  worse than mine and kept mine.

And one it handed back rather than editing a contested file: `composePlan` built
the contract's demonstrated load with `||`, which treats a measured zero as
absent — one line before the function that distinguishes them. So the
`peak === 0` refusal was **unreachable from authoring**, and every measured zero
was recorded as "never measured". Same outcome, wrong reason. A refusal that
cannot be exercised is a refusal nobody can trust. Fixed.

---

## 8 · Removing the self-declared level · RECORDS CLEAN, BEHAVIOUR NOT YET

**What is done.** Composing him now, `declaredLevel`, `experience_level`, the
`READINESS` prerequisite and the dangling `scoreReadiness` are **all absent**
from `authored_state`. `EXPERIENCE_CAPS_MI` is deleted, along with the volume
overshoot detector's `SELECT experience_level`, its persisted `evidence: {cap,
level}` and the runner-facing sentence *"advanced cap 80mi"*; that baseline now
**refuses** rather than defaulting to `intermediate` → 60 mi/wk.
`experience_level` is off the profile route's `PLAN_SHAPING` list, and the phone
hint now reads *"Profile only. Your plan is built from what you have actually
run."*

The Dodgers grant is justified by four facts he ran, and the Rule 16 collision
is resolved — the grant's 28-day reading is renamed `recentHabitLongMi`:

```json
{"demonstratedPairMi": 29.4, "demonstratedPairFromISO": "2026-04-25",
 "recentHabitLongMi": 18, "sustainedWeeklyMi": 46.4}
```

**What is NOT done, and I am not rounding it up.** The gate he asked for is
**red on 7 of its 8 dimensions**. The label still moves plan volume, peak,
long-run progression, race prescriptions, weekend permission, adaptation
eligibility and the coaching explanations. Only cutback placement is green.
Three reads remain, each a separate decision:

- `GENERAL_RAMP_CEILING[level]` — the week-over-week rate. Doctrine genuinely
  states 1.20 for novices, so this one has a real citation behind it.
- `classifyCapacityTier`'s floor — **this is what produces the
  `composed_row_band_weekly: [65,90]`** still visible in the stamp, and it also
  selects the long-run band and quality density.
- `isBaseBuildingPlan` / `recoveryDayAfterLongMi` — the layout path.

And one honest design problem, named rather than papered over: the workout
library filters templates on `levelFit`, and **passing `undefined` does not
narrow the filter, it switches it off** — the lowest-id template then wins for
everyone, replacing a bad authority with an arbitrary one, in the direction that
makes his sessions easier. The doctrine-correct answer is selection on
demonstrated capacity, which `ADAPTATION_PROGRESSION_DOCTRINE.md` says is not
yet built. An agent is on it.

### 8a · A third instance, found while this was in flight

The same defect exists in a different field name, and it reaches the runner.
`lib/plan/strategy-contracts.ts:331-341` still returns, as the prerequisite
evidence justifying a weekly-volume increase:

```ts
{ kind: 'READINESS',
  statement: 'No readiness pull-back is active.',
  owner: 'lib/coach/readiness.ts#scoreReadiness' },
```

Composing today, **week 4 (2026-09-21, 48 → 56.2 mi) is presented to him with
"No readiness pull-back is active" as one of the two prerequisites justifying
the step up.** Readiness pull-backs no longer exist. And `scoreReadiness` does
not exist either — the `owner` field names a deleted function.

That is Rule 20's corollary in the place it does most harm: a claim nothing
verifies, in prose the runner reads, stopping the next person from checking. It
was found on the FIRST owner string checked, which says little for the other
four, so the gate is being extended to assert that every `owner` resolves to a
symbol that exists. **A dangling owner should fail loudly** — that is what would
have caught this at the moment readiness was deleted, rather than it surfacing
hours later in composed output.

This matters because the explanations are otherwise good, and he will read them:

> **Why the longest run is what it is** · "20.5 mi is the longest run, the week
> of 2026-10-26. It is set from the longest runs you have actually completed and
> what one training cycle adds to them, not from a category."

> **How it prepares race effort** · "The long runs build the hours; the 33 mi at
> marathon pace inside and beside them build the effort. Running 20.5 mi easy
> proves you can cover the distance. Holding race pace late in a long run is
> what proves you can race it."

An explanation that cites deleted machinery as its justification is worse than
no explanation.

---

## 9 · Race rows update as one contract

One pure function decides the whole row; the SQL applies it mechanically; every
path passes `coherentOrRefused`, so an incoherent row is **refused whole**
rather than half-written. All four races: **0 contract violations**.

Fixed: a note reading "Target 6:52/mi" over a row at 7:02; the 12-01 tune-up
keeping 6:41 reps after being repriced to marathon pace; two coach-set tables
40 s apart; the Santa Monica brief 404; `NOTE.race` naming distances a
6.21-mile race does not have.

---

## 10 · Process, including what went wrong

**Main stopped deploying for three commits.** Two parallel branches collided —
one retired an identifier and added a ratchet asserting it was gone, the other
branched from an older base and still read it. The ratchet caught it.

**Then the verification itself was found wanting.** `verify-commit.sh` ran
`npx next build` directly, bypassing the npm `prebuild` lifecycle, so none of
the twenty gates Railway runs were in its scope — a gate failure passed
verification and failed the deploy. It now runs them first, falsified by
reintroducing the identifier that caused the outage. A second instance of the
same collision class was then caught by the input-surface ratchet *before* it
reached the deploy.

**Corrections to my own statements, carried forward:**

1. Claiming the earlier programme complete when the evidence contradicted it.
2. Telling the runner his run data was complete when it was not.
3. Claiming a render verified a fix when the app had not fetched in 11 hours.
4. Diagnosing a watch-versus-phone pace gap that did not exist.
5. Recommending against the rebuild on reasoning he correctly overturned.
6. **Advising that peak volume be pushed toward the "advanced" band's floor** —
   reasoning from a label he typed rather than from his record of 35 weeks with
   a 48.5 best and zero weeks at 50+.

**Seals, re-verified byte-identical** across five agents and a dozen merges:
seven past plan rows `df8b2ae4…`, eight completed runs `d8ad8b19…`, 103 rows on
the live plan.

---

## 9a · Every week, every session, and its role

The engine's own role label per week, with the quality sessions it prescribes.
Composed read-only; nothing here is written.

| Wk | Start | Mi | Long run | Quality sessions | Role |
|---|---|---|---|---|---|
| 0 | 08-24 | 46.0 | 14.5 | 4.5mi wave tempo · 8×3 min hills @ T-10K | HOLD |
| 1 | 08-31 | 50.0 | 15.0 | 5×1mi @ T · 60s jog · 10×60s hills @ 5K-10K | BUILD |
| 2 | 09-07 | 24.4 | RACE 6.2 | 1.5mi tempo · **Santa Monica 10k** | CUTBACK |
| 3 | 09-14 | 48.0 | 16.5 | 2×1.5 mi @ T · 3 min jog | BUILD |
| 4 | 09-21 | 56.2 | 17.0 | 5mi mile cutdowns · **Dodgers 10K (C)** | BUILD |
| 5 | 09-28 | 42.0 | 13.0 | 6×800m @ I pace · 2 min jog | CUTBACK |
| 6 | 10-05 | 59.5 | 18.5 | 4.5mi cutdowns · 5×1km ladder MP→5K | BUILD |
| 7 | 10-12 | **60.0** | 19.0 · **4mi @ M + 2mi @ T** | 5K/mile speed ladder | HOLD |
| 8 | 10-19 | 45.0 | 14.0 | 4.5mi tempo · 8×3 min @ I pace | CUTBACK |
| 9 | 10-26 | 59.5 | **20.5 · 11mi @ MP** | 6×1km ladder MP+5→5K | BUILD |
| 10 | 11-02 | 44.6 | RACE 13.1 | 2.5mi wave tempo · **Run Malibu HM** | CUTBACK |
| 11 | 11-09 | 40.5 | 16.0 | **none** — post-race | CUTBACK |
| 12 | 11-16 | 49.0 | 18.0 | 2.5 WU · **11 mi @ MP** · 1.5 CD | TAPER |
| 13 | 11-23 | 36.0 | 13.0 | 2 WU · **7 mi @ MP** · 1 CD | TAPER |
| 14 | 11-30 | 44.2 | RACE 26.2 | 5×400m @ 5K · **CIM** | RACE |

**The taper, day by day.** Three weeks, 60.0 → 49.0 → 36.0 → race week.

```
11-16 easy      4.0  EASY · 6×20s strides      11-23 easy      3.5  EASY · 6×20s strides
11-17 tempo    15.0  2.5 WU · 11 mi @ MP · 1.5 11-24 tempo    10.0  2 WU · 7 mi @ MP · 1 CD
11-18 easy      4.0  EASY · 6×20s strides      11-25 easy      3.5  EASY · 6×20s strides
11-19 easy      4.0  EASY                      11-26 easy      3.0  EASY
11-20 easy      4.0  EASY                      11-27 easy      3.0  EASY
11-21 rest      0.0                            11-28 rest      0.0
11-22 long     18.0  LONG                      11-29 long     13.0  LONG

11-30 easy 4.0 · 12-01 tune-up 5.0 (5×400m @ 5K) · 12-02 easy 4.0 · 12-03 easy 3.0
12-04 rest · 12-05 shakeout 2.0 (4×20s strides) · 12-06 RACE 26.2
```

The final long run is 18.0 mi, two weeks out. Taper weeks sit at 82%, 60% and
(excluding the race itself) 30% of the 60.0 peak. **One advisory dosing finding**
sits here and is unenforced under doctrine's taper exemption: the 11 mi @ MP is
22.45% of a 49-mile week against a 20% cap.

Week 11 carries **no quality at all** — it follows the half marathon.

---

## 9c · The pace, HR and effort contracts

Anchors: threshold **430 s/mi (7:10)**, LTHR **168**, max HR **183**, easy
ceiling **151 bpm**.

| Quantity | Value | Owner |
|---|---|---|
| threshold (T) | 7:10/mi | capacity resolver |
| marathon-pace TRAINING | 7:52/mi, range 7:40-8:08 | `race-outlook.trainingPrescription` |
| long-run / easy | 8:40/mi headline, HR cap 151 | spec builder off the easy anchor |
| CIM race-day execution | 7:23/mi | `race-outlook.execution` |
| stated goal (never prescribed) | 6:52/mi | the runner |

Of **96 future rows**: **61** carry an HR cap, **15** carry warm-up and
cool-down, **21** carry pass/abort rules.

**The rules, verbatim:**

- Quality work — pass: *"avgHr ≤ 164 on the work"*; bail: *"HR over 173 and
  climbing · finish easy, the stimulus is banked"*.
- Long runs with a fast finish — bail: *"HR over 173 mid-finish · cut the finish
  in half, jog home"*.
- Races, distance-scaled checkpoints: **mile 2 at 179 bpm** for a 10K, **mile 5
  at 171** for the half, **mile 10 at 163** for CIM — each *"switch to the B
  plan"*.

**One correction to that last row, because the number differs by race role.**
The figures above come from a harness that calls the spec builder with seven of
its twelve arguments, so it prices every 10K as a full race. Through the
complete production path the **Dodgers C race carries HR 161-168 with a mile-2
abort at 171**, not 168-176 and 179. The A and B races are unaffected. Race
pacing is owned by `race-row-refresh`, and the harness's race column is labelled
an artifact in the detail file rather than deleted, so the limit stays visible.

---

## 9b · Determinism, and proof nothing can mutate the stored plan

**Determinism.** Composed three times against the same inputs:

```
run 1  f80399fed8069f7e2fd60853c616383d4dc7db27703a1257104f76e82d3adee5
run 2  f80399fed8069f7e2fd60853c616383d4dc7db27703a1257104f76e82d3adee5
run 3  f80399fed8069f7e2fd60853c616383d4dc7db27703a1257104f76e82d3adee5
```

Identical. And the removed inputs cannot vary the plan because they are no
longer inputs: `tsbAtStart` is gone from `ComposePlanInput` entirely, walking
training form from −30 to +5 produces an identical plan, and readiness, sleep,
HRV, resting HR, illness and injury reach the composer at no point.

The one input that CAN still vary the plan is the self-declared experience
level. That is §8, and it is not finished.

**Nothing automatic can mutate the stored plan.** Three gates, 51 tests, all
green:

- `_promotion_contract.test.ts` — the shadow engine writes nothing, and its only
  importer is the comparator.
- `_seal_single_seam.test.ts` — there is exactly ONE adaptation seam, default
  off. It caught a real mistake during this work: an agent sealed the injury
  builder behind a second dormant flag, and the gate refused it because a second
  switch guarding a second plan writer is the state being removed. The refusal is
  now hardcoded with no flag to flip.
- `_automatic_mutations.test.ts` — every statement that can write a plan row is
  declared, including sealed ones, so re-opening a seal cannot go unlisted.

`tryAdaptiveBump` returns null on the authority check before it reads anything.

---

## 10a · How the numbers in this document were checked

Three of the runner's questions each found an error in the previous draft, which
means the draft was not audited hard enough. The common cause was one habit:
**reporting what the composer computes rather than what the write persists.**
§2 now carries both columns for that reason, and §13.1 states the difference
explicitly.

Provenance for every claim here:

- **Measured by me, read-only against production, in this pass:** the
  composed-versus-written table and both totals; the peak week and peak long;
  the marathon-pace accounting on both the live plan and the rebuild; all four
  race prescriptions through the live outlook; the CIM improvement model; the
  sealed hashes.
- **Measured by an agent and quoted, not independently re-run by me:** the
  cliff sensitivity walks in §4; the falsification outputs; the Dodgers
  `43:00 → 44:30` pricing proof; the race-row contract's zero violations.
- **Not measured by anyone** — see §11.

Where a figure came from an agent I have said so rather than absorbing it into
my own voice. Two agent claims were checked and corrected earlier in this
programme, so the distinction is not academic.

---

## 11 · What is not verified

- **The Swift Block screen rendering** the new per-week explanations. It
  compiles (223 watch test cases, and that check caught a real decoder defect
  first). The simulator was not run, and the live plan predates
  `block_strategy.answers`, so the screen shows nothing until re-authoring.
- **The persisted result of a rebuild.** Everything here is composed in memory.
- **Anything the adaptation engine decides.** It remains the last system.

---

## 12 · What remains

**Before a rebuild:**

1. The level-inert gate green on all eight dimensions — three reads and one
   design decision, named in §8.
2. An external coaching review, now running: a reviewer with no stake in the
   build, sandboxed read-only, asked whether a good marathon coach would sign
   this plan for this runner. Not "does the code work" — the gates cover that.
   It has been told explicitly that finding nothing material is a valid and
   valuable answer, and not to manufacture findings.

**After that:** the rebuild, then verification of the STORED plan rather than
the generator, on Today, Block, workout detail, race detail, watch payload and
post-run.

**The last system, unchanged:** adaptation consolidation. One canonical engine,
legacy mutators removed, every proposed change carrying evidence, confidence,
magnitude limits and reasons, refusal preserved, upward adaptation shadow-only
until promotion criteria are met, and one decision explained identically on
every surface. Section 7 moved the first stone — the ceiling adaptation reads is
now real and resolvable rather than inert by construction — but the engine
itself is still unowned.
