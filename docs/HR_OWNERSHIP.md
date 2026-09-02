# Heart rate — the ownership table

**Locked 2026-09-01 (Phase 8 of the brain completion). One meaning, one owner,
one formula, per row. If a change introduces a second answer to any row here,
reject it** — the same rule `docs/BRAIN_CONSTITUTION.md` §29 applies to
coaching questions, applied to the seven heart-rate numbers this app states.

Heart rate is the one quantity in the app that means something different in
almost every context it appears, and until this table existed those meanings
shared columns, names and grading code. The costs are recorded per row.

Doctrine: `Research/03-heart-rate-zones.md` (§6 Friel LTHR zones, §13 rep
kinetics, §14 coach-by-HR-vs-pace), `Research/08-pacing-and-race-week.md` §6.1
(race HR by distance), `Research/15-wearable-data.md` (readiness). Governed by
`docs/PRODUCT_COACHING_DOCTRINE.md` §14: **heart rate is evidence, not truth.**

---

## 1 · The seven numbers

| # | Number | Means | Owner (the ONE formula) | Value for the owner (LTHR 168, HRmax 183) |
|---|---|---|---|---|
| 1 | **Aerobic ceiling** | "Do not go above this on an easy day" | `zones.ts#aerobicCeilingBpm` = `ceil(LTHR × 0.90) − 1`, then `spec-builder.ts#hrCapEasy` takes `max(that, 0.78 × HRmax)`; the watch's `resolveHrCeiling` decides WHEN one exists | **151** |
| 2 | **Expected threshold response** | "A correct threshold rep costs about this" | `zones.ts#thresholdPassHrBpm` = `round(LTHR × 0.975)` — the Friel Z4→Z5a seam; the BAND is `threshold-band.ts` (Z4 95–99 %, Z5a 100–102 %) | **164** (band 160–171) |
| 3 | **Expected race response** | "Expect roughly this at race effort" | `race-hr-guidance.ts#resolveRaceHrGuidance` → `expectedRangeBpm` = `RACE_HR_PCT_LTHR[distance] × LTHR`, validated against the runner's own efforts within ±5 % of the execution pace | **148–160** (marathon) · **168–176** (10K) |
| 4 | **Early-race ceiling** | "Under this through the opening block" | same resolver, `earlyCeilingBpm` = the range's LOW edge, through `raceCheckpointMi` (38 % of the distance) | **148 through mile 10** |
| 5 | **Late-race allowance** | "Up to this late is drift, not a fault" | same resolver, `lateAllowanceBpm` = range high + `RACE_HR_LATE_DRIFT_ALLOWANCE_BPM` (5) — `Research/08` §6.1's own 3–5 bpm/hour | **165** |
| 6 | **Pass / bail contingency** | "This session's own if-then, mid-run" | `spec-builder.ts` authors `workout_spec.rules`; `WorkoutEngine.noteRuleMetric` evaluates the rule's OWN `metric`/`op`/`value`, sustained `hrRuleSustainSec` = 120 s | bail **> 173** on threshold work · pass **≤ 164** |
| 7 | **Safety stop** | "Abandon the A goal from here" | `distance-doctrine.ts#raceAbortHrBpm` = `round(LTHR × RACE_HR_PCT_LTHR[d].hi) + 3`, at `raceCheckpointMi`, and ONLY when `informationalOnly` is false | **163 at mile 10** |

**Rows 3–5 and 7 are one object.** `RaceHrGuidance` resolves all four together
from one LTHR read, so a race can never show an expected band from one
derivation and a bail figure from another. That was the state before: race day
carried a single `hr_cap_bpm` filled with a race-effort number and graded as a
hard cap on every surface, and the owner's AFC half came in at avg HR 168
against a 168 cap — one beat from amber on his PR, and not by coincidence,
because `lthr-reanchor` had set LTHR *to* that race's average.

---

## 2 · Every consumer of every number

Read this as the answer to "if I change row N, what moves?"

| # | Phone | Watch | Spoken | Grading | Post-run interpretation | Race execution | Adaptation |
|---|---|---|---|---|---|---|---|
| 1 Aerobic ceiling | Today `hrCapStat` (easy/long/shakeout only); after-run "Heart · under 151" row; **`HRAlerter`** (armed from this number, `applyTodaysCeiling`) | `hrCeilingBpm` → easy-face guardrail turns red and holds; the ceiling-override board | no | `hrCapBreached(avg, cap)` at `HR_CAP_GRACE_BPM` = 1 | `run-recap.ts` easy/long arms; `judgeEasyRunHr` | — | `pace-hr-compatibility.ts` reads the zone table (read-only) |
| 2 Threshold response | run detail "in the band" sentences, gated on WORK HR | phase `hrTargetBpm` on quality work | no | quality-day HR read; `judgeTestPointExecution`'s pass criteria | `threshold-band.ts` four arms (above / at / sub-threshold / below) | — | `pace-hr-evidence.ts` work-segment mean (read-only) |
| 3 Expected race response | race detail outlook; execution plan | `raceHr.expectedLo/HiBpm` → **race lobby qualifier, "Expect 148-160 bpm"** | no | **never graded** | — | the reference the strategy is written against | — |
| 4 Early-race ceiling | race detail outlook; execution plan | decoded, not drawn (Rule 17 — the range says it once) | no | never graded | — | the controlled opening | — |
| 5 Late-race allowance | race detail outlook | decoded, not drawn | no | never graded | — | what a well-run finish may reach | — |
| 6 Pass / bail | execution plan bail line | `WatchRule` → the bail board, sustained 120 s | **no** — see §5 | `pass` reaches no card (open — see §5) | recap reads `ruleOutcomes` (bail ≠ fail) | — | — |
| 7 Safety stop | execution plan bail line | the abort board, gated on `mile-N` scope | **no** — see §5 | never a grade | — | the A-goal abandonment | — |

---

## 3 · The rules this table enforces

**A · Informational HR never triggers an alarm.** A band with no personal
evidence behind it — or one the runner's own efforts at that pace contradict —
is `informationalOnly`, and no surface may grade or alarm on it. Enforced at
the source: `resolveRaceHrGuidance` sets the flag, race rows carry **no**
`hr_cap_bpm` at all (`spec-builder.ts:1622`, `hr_cap_bpm: null`), and the
watch's race lobby draws the range with "Expect", never a colour.

**B · A safety mechanism evaluates the metric it names.** An `hr` rule is
decided on heart rate (`noteRuleMetric` reads `tracker.heartRate` against the
rule's own `op`/`value`), a `pace` rule on miles adrift. Before C-1 the board
fired on two pace-adrift miles and then printed the server's HR-worded evidence
over it — "Heart rate over 173 and still climbing" at a runner who might be at
150 and simply slow.

**C · A ceiling has no slow edge, and an expected range is not a ceiling.**
Rows 1 and 3 are different shapes, not different numbers of the same shape.
Grading either as the other is what made a correct 534 s/mi cool-down read
"missed" and a correct 168 bpm half marathon read as a breach.

**D · An absent number disarms; it never reuses the last one.** Rule 11. The
plan sends no aerobic ceiling on a quality day, a race, or a long run with a
race-pace finish, and nil must silence the phone alarm rather than leave
yesterday's easy-day 151 watching a threshold session
(`HRAlerter.applyTodaysCeiling`).

**E · HR is read over an interval of constant intent.** `reading-scope.ts`
refuses an HR reading below `HR_REP_KINETICS_FLOOR_SEC` (`Research/03` §13 — HR
half-time ≈ 30 s, plateau 90–180 s), and every band sentence is gated on the
WORK heart rate, not the whole run's. On the owner's 2026-09-01 session those
are 162 and 154 — 96.4 % and 91.7 % of LTHR, opposite sides of the Z4 floor.

---

## 4 · What was wired and what was removed (2026-09-01)

| Mechanism | Was | Now |
|---|---|---|
| Phone `HRAlerter` | `configure` had no call site; ceiling was a `UserDefaults` value nothing wrote; it had never fired for anyone | armed from `WatchWorkout.hrCeilingBpm` at `WatchSync.pushTodayToWatch`, toggled from settings, `armedCeiling(toggleOn:workoutHrCeilingBpm:)` tested |
| Watch `raceHr` | reported as "decoded by the watch" — it was added to the PHONE's mirror (`Models/Watch.swift`); `WatchWorkoutModels.swift`, which the watch app compiles, had no such field, so the band was dropped on decode | decoded on the watch model (leniently), and **drawn** on the race lobby's qualifier register |
| HR bail / abort board | `shouldOfferBailNow` read HR (C-1) while the only observer watched `milesAdrift` — the PACE evidence, which never moves for a runner holding pace. The board could not go up | both evidence streams observed through one `offerBailIfDue()`; driven on the watch simulator at `-hr 180` against the owner's real mile-10 abort |
| Race `hr_cap_bpm` | `0.92 × LTHR` on a marathon row, graded as a hard cap for 26.2 miles | removed; race rows carry `race_hr` instead |
| `HRAlerter` threshold | alarmed at `0.95 × ceiling` while asserting the runner was above the ceiling | compares against the ceiling itself, sustained 60 s, bounded to running workouts |

---

## 5 · Open, and stated rather than hidden (Rule 20)

- **Nothing about heart rate is spoken.** The 2026-09-01 handback's §10 records
  the checkpoint abort as "Spoken: yes, at the checkpoint". It is not. No entry
  in `composeSpokenCues` mentions heart rate at all, and the bail/abort board is
  a `router.pendingQuestion`, while `speak()` is driven by `engine.transition`
  (splits, phase changes, fuel, drift) — two different paths. The board draws
  and fires `Haptics.Moment.bailOffered`; it says nothing.

  Not fixed here, deliberately. `SpokenCues`'s invariant is *spoken ⟹ drawn*,
  so a drawn-but-silent board does not break it, and putting a QUESTION into a
  runner's ear — one they must answer with two buttons they may not be looking
  at — is a product decision about the coach's voice, not a semantics fix. It
  is recorded here so the next reader does not inherit the handback's claim.

- **`pass` rules reach nothing.** `spec-builder.ts` authors `kind: 'pass'`
  (avg HR ≤ the Z4/Z5a seam) on quality rows; its only reader is
  `goal-projection.ts:881`. It reaches no card, no watch board and no recap.
  Row 6's "pass" half is therefore authored and unread — not wrong, but not
  in force either.
- **Four ceilings for one threshold band** (audit C-7) is not closed. This
  table names row 2's owner; the consumers were not all re-pointed in this
  phase.
- **The watch's compiled HR grading is not executed by a test.**
  `_watch_grader_parity.test.ts` ports the Swift rule into TypeScript and reads
  the Swift source to check the port still matches; it does not run Swift.
- **`HRAlerter` has never fired on a real wrist.** Its arming decision is
  tested and its call sites are asserted, but `HKObserverQuery` delivery,
  background-delivery entitlement and the 60-second sustain are unproven
  outside a device.
