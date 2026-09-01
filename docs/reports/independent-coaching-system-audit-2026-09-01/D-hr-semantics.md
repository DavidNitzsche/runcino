# HR semantics audit — every heart-rate quantity, producer → consumer → meaning

Independent audit, 2026-09-01. **Audited commit: `7cac80f0`.** The assigned
worktree was created from the stale `claude/build-runcino-app-OIRJr` line at
`f43fb7a7`, which has no `web-v2/` or `native-v2/` at all; it was reset to
`7cac80f0` before a single file was read, and `git rev-parse HEAD` was
re-confirmed as `7cac80f0` at the end. Nothing outside the worktree was written;
no commit, no push. Read-only production DB throughout
(`faff_readonly`). Owner `0645f40c-951d-4ccc-b86e-9979cd26c795`, active plan
`pln_9a57561debb776e5`.

**Live anchors, read from prod:** `profile.lthr = 168` (`lthr_method =
race_half · Americas Finest City · 2026-08-16`, `lthr_set_at =
2026-08-31T02:40:47Z`), `profile.hrmax = NULL`, `profile.hrmax_observed = 183`,
`profile.rhr = 46`, `users.max_hr = 183`, `users.max_hr_override = NULL`,
`users.resting_hr = 52`, `profile.phone_hr_alerts = false`.

Every number in §1 was produced by CALLING the real exported functions at those
anchors (`web-v2/lib/coach/_hrprobe.test.ts`, a throwaway probe run under
vitest, since deleted), not hand-traced. Every recap sentence quoted in §4 was
produced by running `deriveRecap` itself.

---

## 0 · The headline

**At one anchor (LTHR 168) this app computes ELEVEN structurally different
heart-rate numbers, and on a single threshold session FOUR of them are live at
once, disagreeing.** The round-3 report (`hr-semantics-2026-09-01.md`) named
four mechanisms; there are eleven, and its own "mechanism 4" turns out to have
three different values depending on workout type plus a downstream consumer it
declared it did not have.

At LTHR 168 / HRmax 183:

| bpm | What it is | Where it is computed |
|---|---|---|
| **151** | aerobic ceiling (Friel Z2 top) | `aerobicCeilingBpm` / `hrCapEasy` / `aerobicCapBpm` |
| **142** | Friel Z1 top, drawn as a warm-up ceiling | `hrTargets().z1` via `spec-card.ts` |
| **152–159** | Friel Z3, quoted on tempo cards | `hrTargets().z3` |
| **155** | tempo spec target (92% LTHR) | `spec-builder.ts:1462` |
| **155** | marathon race ceiling (92% LTHR) | `spec-builder.ts:1618` |
| **160–167** | Friel Z4, quoted on threshold cards | `hrTargets().z4` |
| **164** | "pass" criterion (97.5% LTHR) | `thresholdPassHrBpm` |
| **167** | pace/HR compatibility refusal edge (Z4 upper) | `pace-hr-compatibility.ts:265` |
| **168** | threshold live-run "expected" reference; HM race ceiling | `build-workout.ts:1814`; `spec-builder.ts:1618` |
| **171.4** | top of the threshold band for post-run grading | `THRESHOLD_HR_CEILING_OF_TARGET × 168` |
| **173** | bail line (LTHR + 5) | `spec-builder.ts:1061` |
| **176** | interval live-run "expected" reference (105% LTHR) | `build-workout.ts:1814` |
| **179** | race abort line (10K: 105% LTHR + 3) | `distance-doctrine.ts:354` |
| **≥168** | Friel Z5, quoted on interval cards | `hrTargets().z5` |

Verified against the live active plan: **on 2026-09-01's threshold session the
runner is simultaneously told the band is `~160–167`, the expected value is
`168`, the pass criterion is `≤164`, and the bail is `>173`.** On 2026-09-03's
interval session the card says `~> 168`, the live-run screen says `176
expected`, and the same row's pass rule says `≤164`. Running the app's own
stated expectation on an interval day guarantees failing the app's own stated
pass criterion by 12 beats and tripping its own bail by 3.

---

## 1 · The value → producer → consumer → meaning table

Abbreviations: **AC** = aerobic ceiling (a real "stay under this"); **ER** =
expected-response reference (informational); **PB** = pass/bail contingency;
**SS** = safety stop; **RE** = readiness/environment adjustment; **IR** =
informational reference.

### Anchors (the roots everything else derives from)

| Value | Producer (file:line) | Formula / anchor | Persisted? Rule 10 posture | Consumers | Meaning |
|---|---|---|---|---|---|
| `profile.lthr` (168) | `lib/training/lthr-reanchor-store.ts:109` (`UPDATE profile SET lthr, lthr_method, lthr_set_at`); also `app/api/watch/workouts/complete/route.ts:1046` (field test) | `lthrFromRace(avgHr)` = HM avg HR, 1:1 (`lib/training/lthr.ts:16`); gated by `effort-authority` tier | **Persisted WITH its anchor** — `lthr_method` names the race, `lthr_set_at` dates it. The only anchor in the app that satisfies Rule 10 properly. | everything below | the runner's threshold HR |
| `users.max_hr` (183) | `lib/training/max-hr.ts:454` `GREATEST(COALESCE(max_hr,0), $1)` ratchet, from `snapshot-projections` cron | monotone-up ratchet over a 365-day observed window | Persisted, **no anchor stamp**, monotone-up so it can never fall. Read through `loadEffectiveMaxHr`, which recomputes. | `hrCapEasy`, `resolveHrCeiling`, `easy-discipline`, `pctMaxZones` | HRmax |
| `profile.rhr` (46) vs `users.resting_hr` (52) | two independent columns | — | **Two persisted values for one quantity, 6 bpm apart.** See §5 conflict R-1. | Karvonen-ish surfaces, readiness | resting HR |
| `profile.hrmax` (NULL) vs `profile.hrmax_observed` (183) vs `users.max_hr` (183) | three columns | — | three names, one quantity | — | HRmax |

### Producers of prescribed / displayed HR

| Value | Producer | Formula (LTHR 168 / HRmax 183) | Persisted? | Consumers | Meaning |
|---|---|---|---|---|---|
| **Friel 5-zone table** | `lthrZones` `lib/training/zones.ts:198` | Z1 <142, Z2 143–151, Z3 152–159, Z4 160–167, Z5 168+ | recomputed | `hrTargets`, `resolveHrZoneShares`, `pace-hr-compatibility`, `derivePaces` | population zone %s applied to an individual anchor |
| **`hrTargets()` band strings** | `lib/training/prescriptions.ts:305` | `~160–167 bpm (Z4 Threshold)` etc. — carries the `~` modelled mark | not persisted | `spec-card.ts:406` (per-step `hr_target`), `prescriptions.ts:486–667`, `/api/v5/today:1513` | **IR** — display-only per its own doc comment. **But see conflict C-4: `spec-card.ts:426` renders `hr?.z1` as a warm-up ceiling and its own comment calls it "the real constraint".** |
| **`hr_cap_bpm` (easy/recovery/long/shakeout/strides)** | `hrCapEasy` `lib/plan/spec-builder.ts:389` | `max(aerobicCeilingBpm(168)=151, round(183×0.78)=143) = 151` | **PERSISTED into `workout_spec`, no anchor stamp** (verified: 0 of the owner's spec rows carry any `anchor` key). Refreshed only by `recompute-paces.ts`, and only for `date_iso >= today`. | watch `resolveHrCeiling`, phone `hrCapStat`, phone live-run `.ceiling` gauge, recap `plannedHrCap`, `easy-discipline`, `glance-adapter` | **AC** |
| **`hr_cap_bpm` (race)** | `lib/plan/spec-builder.ts:1618` | `dMi≥25 → round(168×0.92)=155`; `dMi≥12 → 168`; else `null` | persisted, no stamp | recap `plannedHrCap`, phone asked-vs-ran row (`askedHrIsHardCap` is TRUE) | **a fifth meaning in the same field**: a race-effort ceiling, not an aerobic one. See conflict C-2. |
| **`hr_target_bpm` (tempo only)** | `lib/plan/spec-builder.ts:1462` | `atMarathonPace ? null : round(168×0.92) = 155` | persisted, no stamp | watch/phone live-run `hrTargetBpm`; **`drift-monitor.ts:695`**; recap `plannedHrCap` fallback | **ER** as authored — but consumed as a threshold band by drift-monitor. See conflict C-3. |
| **`lthr_bpm` (threshold / intervals / race_week_tuneup)** | `lib/plan/spec-builder.ts:1518,1579,1738` | `= lthr` (168) | persisted, no stamp | watch/phone live-run reference; recap `plannedHrCap` fallback | **ER** |
| **`workHrTargetBpm`** (the wire value) | `lib/watch/build-workout.ts:1814` | threshold → 168; intervals → `round(168×1.05)=176`; tempo → 155; no-LTHR fallback `round(maxHr×0.95)`=174 / `×0.87`=159 | wire only | phone `LiveRunOutdoorV5` `.reference` gauge; **decoded but never rendered on the watch** (`WatchWorkoutModels.swift:190`, no face reads it — verified by grep) | **ER** |
| **`hrCeilingBpm`** (the wire value) | `resolveHrCeiling` `lib/watch/build-workout.ts:1437` | spec cap first, else `aerobicCeilingBpm(lthr)` else `round(maxHr×0.78)`; **null for anything but easy/long, and null for a long with an HM/M finish** | wire only | watch ceiling-breach board + ceiling-override question + haptic; phone `.ceiling` gauge | **AC** — the only HR value on the wrist that alarms |
| **pass line 164** | `thresholdPassHrBpm` `lib/training/zones.ts:193` | `round(168×0.975)` | persisted in `workout_spec.rules` | `goal-projection.ts:881` (next-test-point criterion). **Nothing else. The watch never evaluates it; `splitRuleRegisters` deliberately drops it from every card.** | **PB** (post-run confirmation) — but see conflict C-5: it is authored on interval rows where it is physiologically unreachable |
| **bail line 173** | `lib/plan/spec-builder.ts:1061` | `lthr + 5` | persisted in `workout_spec.rules` | phone "If it goes wrong" card; watch bail board TEXT | **PB** — but the number is never evaluated. See conflict C-1. |
| **race abort 179** | `raceAbortHrBpm` `lib/race/distance-doctrine.ts:354` | `round(lthr × RACE_HR_PCT_LTHR[cat].hi) + 3`; 10K → `round(168×1.05)+3` | persisted in `workout_spec.rules` | phone card text only | **SS** in intent, **inert in fact** — `WatchRule` decodes `metric`/`op`/`value` and reads none of them; `WatchWorkoutModels.swift:87` says "Only `bail` draws a board" |
| **`THRESHOLD_HR_CEILING_OF_TARGET`** | `lib/training/threshold-band.ts:44` | `hrTarget × 1.02` → 171.4 off LTHR, **158.1 off a tempo target** | pure | `drift-monitor.ts:795` (VDOT-refit gating), `run-recap.ts:590` (recap copy) | grading band top |
| **`THRESHOLD_HR_FLOOR_OF_TARGET`** | `lib/training/threshold-band.ts:54` | `hrTarget × 1.0` → 168 | pure | `drift-monitor.ts:796` only — **`run-recap.ts` imports only the ceiling.** See conflict C-6. | grading band floor |
| **Z4 upper as a refusal edge (167)** | `lib/adaptation/pace-hr-compatibility.ts:265` | `computeZones(lthr).z4.upper` | pure, shadow-only | `shadow-compare.ts:440` → `pace-canary.ts` gate | pace/HR compatibility |
| **`easy-discipline` ceiling** | `lib/coach/easy-discipline.ts:464` | `max(round(maxHr × 0.78) = 143, workout_spec.hr_cap_bpm)` | pure | `coach-log.ts` cards, `adaptation/load.ts` | **AC**, HRmax-anchored — a genuinely different derivation |
| **`judgeEasyRunHr` ceiling** | `lib/training/zones.ts:429` | `aerobicCeilingBpm(LIVE lthr) + heatBump` = 151 | recomputed at read | `run-state.ts:1119` → run-detail `easy_hr_read` | **AC**, live-anchored |
| **`resolveHrZoneShares`** | `lib/coach/hr-zone-bucket.ts:223` | per-second samples → `zoneIdxForBpm(bpm − hrOffset, table)`, apportioned to 100; stored `data.hrZonePcts` demoted to rung 3 | **RECOMPUTE posture — the worked example Rule 10 names** | `/api/v5/today:964`, `run-state.ts:934` | descriptive |
| **heat HR bump** | `heatHrBumpBpm` `lib/weather/heat-adjustment.ts:132` | `0` if <77 °F, else `round(5 + 15·min(1,(t−77)/13))` | pure | `judgeEasyRunHr` (verdict band shift), `easy-discipline` (exclusion filter), `pace-hr-compatibility` (overage explanation), `run-state` display | **RE** |
| **readiness HR/HRV** | `convergence.ts` (RHR +5 bpm ≥2 d; HRV ln-SWC `0.5×sd60`, ≥3 d), `acwr.ts` (`acute7/chronic28`) | — | recomputed per call from `health_samples` | `runner-state.ts` (reporting only — `ACWR_IS_REPORTED_NEVER_DRIVING = true`), `plan/adapt.ts:1256` `readiness_pullback` | **RE** — changes today's prescription, never an anchor |

---

## 2 · The specific verifications requested

### (a) Can an informational reference trigger a safety alarm? — PHONE live-run: no. WATCH: no. But there is a third alarm nobody has been auditing, and it is wrong.

**`native-v2/Faff/Faff/HRAlerter.swift` — a phone push notification titled
"HR ceiling", currently dormant and fully armed.** Three defects in 140 lines:

- `:94` `let threshold = Double(ceiling) * 0.95`, `:115` `if peak > threshold` —
  it fires at **95% of the ceiling** and then says `"Heart rate \(val) bpm ·
  above your \(ceiling) ceiling. Back off?"` (`:126`). At ceiling 151 it fires at
  144 and calls 144 "above your 151 ceiling". A sentence asserting a fact that
  its own trigger disproves (Rule 16).
- `:68` `HKObserverQuery(sampleType: hrType, predicate: nil …)` — **no workout
  predicate at all**, while the file header (`:3-4`) states it fires "when one
  arrives **during an active workout** AND the value exceeds the user's
  ceiling". Both halves of that sentence are false. Rule 20's prose corollary:
  gate the claim or delete the sentence.
- `:34-42` `ceilingBpm` reads `UserDefaults "faff.phone_hr_ceiling"`, written
  only by `configure(enabled:ceiling:)` — which **has no call site** (grep across
  `native-v2` returns only `FaffApp.swift:161`, which reads `.enabled` and never
  calls `configure`). So the ceiling is a persisted derived value with no anchor,
  no writer, and no refresh when LTHR moves (Rule 10), and nothing connects it to
  `profile.phone_hr_alerts` (false for the owner) either.

It is inert today only because `UserDefaults "faff.phone_hr_alerts"` is never
written, so `FaffApp.swift:161`'s gate is always false. The moment anyone wires
`configure(...)` — which is the obvious next step for the settings toggle that
already exists in the DB — a false ceiling alarm ships. Fix the 0.95, add the
workout predicate, and source the ceiling from the day's `hr_cap_bpm` (with its
type, so a quality reference can never land in that variable) before wiring it.

### (a, continued) The live-run gauges and the wrist

**Phone live-run: fixed as claimed, verified in source.** `LiveRunOutdoorV5.heartReference`
(`native-v2/Faff/Faff/ViewsV5/LiveRunOutdoorV5.swift:587`) returns
`.expected(walk.phase.hrTargetBpm)` first, `.ceiling(plan.workoutHrCeilingBpm)`
second; `heartTile` (`:450`) draws `.reference` for the former (no shaded zone,
never amber) and `.ceiling` for the latter.

**Watch: clean, and the round-3 report's reason is right — but incomplete.**
`hrTargetBpm` is decoded onto `WatchPhase`
(`legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift:190`) and read
by **no** watch file (grep across all 33 `.swift` files returns only the model's
own init/encode). The ceiling alarm — `engine.hrOverCeiling`
(`WorkoutEngine.swift:1101`) → `FaceCeilingBreachV5` + `.ceilingBreach` haptic +
the `.ceilingOverride` question (`WatchRouterV5.swift:462–486`) — is gated
exclusively on `workout.hrCeilingBpm`, which `resolveHrCeiling`
(`build-workout.ts:1449`) returns `null` for every session class but `easy` and
`long`, and for a long with a race-pace finish.

`RangeScale.Mode.reference` (`native-v2/Faff/Faff/DesignV5/ChartsV5.swift:74–238`)
verified exhaustively: `:141-145` draws `EmptyView()` for the zone, `:109`
returns `outOfRange = false` unconditionally, `:152`'s marker fill is therefore
always `V5.signal` and never `V5.attention`, and the spoken string is *"You are
at {v}. Informational only, not a target."* — the words "ceiling" and "band" do
not appear on that branch. `.ceiling` (`:107`, `:129-134`) is untouched and still
speaks *"Ceiling {hi}. You are at {v}, above the ceiling."* **`.reference` cannot
reach an alarm state.**

**The fragility nobody gated (Rule 20):** the phone's precedence puts
`.expected` AHEAD of `.ceiling`. The two are mutually exclusive only by a
server-side invariant (`isQualityWorkout` gates `hrTargetBpm`;
`sessionClass ∈ {easy,long}` gates `hrCeilingBpm`) that **nothing checks**. If
that invariant ever breaks, the phone silently suppresses a real aerobic-ceiling
alarm in favour of an informational number. The precedence is ordered the wrong
way round for a safety read: a ceiling should win a tie, not lose one.

### (b) Does a faster pace mechanically raise `hr_cap_bpm`? — NO. Clean on every path checked.

- `recompute-paces.ts:509–521` resolves `lthr` from a LIVE `profile.lthr` read
  and `maxHr` from `loadEffectiveMaxHr`, then hands both to `buildWorkoutSpec`.
  The six pace anchors are resolved separately by
  `resolvePrescribedPaceAnchors` and never touch the HR arms.
- `hrCapEasy(lthr, maxHr)` has no pace input at all.
- `adaptation-engine.ts` proposes PACE / DURATION / DENSITY / HOLD. Grep for HR
  writes returns only prose in comments.
- Canary branch `origin/pace-canary-infrastructure-20260901` (`a0051439`):
  `pace-canary.ts` writes **only** the top-level `plan_workouts
  .pace_target_s_per_mi` column and says so in its own header (`:47–61`),
  explicitly deferring `workout_spec` (where `hr_cap_bpm` lives) to the next
  `recomputePacesForPlan`. It also refuses outright on
  `finalDecision === 'REFUSED_HR_INCOMPATIBLE'` (`:207`).
- The only path from evidence to `profile.lthr` is `lthr-reanchor.ts`, off a
  half-marathon's **average heart rate**, gated by `effort-authority`. HR moves
  from HR evidence, as §3 of the 2026-09-01 decision requires.

*Adjacent, out of scope but worth naming:* because the canary writes the column
and defers the spec, `pace_target_s_per_mi` and `workout_spec.rep_pace_s_per_mi`
diverge between a canary application and the next recompute — and the recap
route `COALESCE`s the column first while the watch reads the spec. That is the
same Rule 16 shape on the pace axis.

### (c) Does heat/environment ever write into LTHR or capacity? — NO.

`lib/weather/heat-adjustment.ts` imports no database and is pure. Its HR output
(`heatHrBumpBpm`) reaches exactly four consumers, all interpretation:
`judgeEasyRunHr` (shifts the verdict bands for one run),
`easy-discipline.ts:389` (excludes a hot run from the HR basis),
`pace-hr-compatibility.ts:278` (subtracts heat from an over-band overage),
`run-state.ts:1016` (display). `lib/watch/heat.ts` moves **pace targets only**
and, in any case, is hard-disabled: `build-workout.ts:1904` is
`const heat = null as …`, so `heatNote` is always null on the wire today.

The only writers of `profile.lthr` / `users.max_hr` are `lthr-reanchor-store.ts`,
the watch field-test path, `max-hr.ts`'s ratchet, and `/api/health/manual` —
none heat-driven. **Clean, and it is the cleanest boundary in this audit.**

### (d) Quality-work cardiac lag: how do grading and the watch treat the first ~2 min of a rep?

The doctrine is encoded exactly once, on the CARD, and nowhere in grading:

- `spec-card.ts:278` `HR_TARGET_MIN_REP_SEC = 30` — a rep under 30 s carries no
  HR band at all (`Research/03` §13 "Useless — HR lags"), and the row falls back
  to `effort_target: 'By effort'`. Watched by `PRERUN.hr-short-rep-floor`.
- `build-workout.ts` has **no** equivalent: `workHrTargetBpm` is stamped on
  every `work` phase regardless of rep length, so a 60-second hill rep ships
  `hrTargetBpm: 176` to the phone's live-run gauge — a number Research/03 §2's
  own kinetics (half-time ≈30 s, plateau 90–180 s) say cannot arrive inside the
  rep. The card refuses to print it; the live-run screen prints it anyway.
- Post-run grading has **no settle/lag window on either axis**: `drift-monitor`
  and `run-recap` both compare a WHOLE-segment average against the band, and
  `pace-hr-compatibility` takes `avgWorkHrBpm` over the whole work segment.
  Averaging over the segment is the right shape for a lagging signal, so lag is
  not producing a false verdict here — but nothing states that, and nothing
  gates it (Rule 20).

**The watch has no settle window on either axis, and its HR check is
instantaneous.** `WorkoutEngine.swift:1101-1107` is the ONLY HR-vs-threshold
comparison anywhere on the wrist: `hr > ceiling`, strict, no hysteresis, no
dwell, no rep-start grace, running from the first tick. `prepDrift()`
(`:667-676`) arms the pace evaluator at the instant a work phase begins and
`tick()` feeds it on the first sample with `pace > 0` (`:1147-1151`); the only
delay in the whole system is `PaceDrift.sustainSeconds = 5` before the *haptic*
— the colour flips immediately, and the per-phase completion verdict
(`:1698-1730`) counts every 5-second sample of the rep including the first.
Grepping `WorkoutEngine.swift` for `settle` / `warmIn` / `grace` returns zero.

Pace tolerance, for the record: `build-workout.ts:1711-1714` ships **8 s/mi**
for threshold/interval, 12 for race, 20 otherwise; a range target yields
half-range (`:392-406`); the watch falls back to `?? 10` (`WorkoutEngine.swift:669`).

Net: **the app refuses to PRINT an HR band on a sub-30-second rep and then
alarms on an instantaneous HR sample from the first second of any easy run,
while grading quality reps on whole-segment averages that happen to absorb the
lag by accident.** Three different postures toward the same physiology, none of
them stated in one place.

### (e) Same number, different meaning across surfaces — YES, four ways.

1. **151 is a ceiling everywhere it appears** — consistent. Good.
2. **168 is three different things at once on a threshold day**: the top of the
   card's `~160–167` band is 167 and 168 is one past it (Friel Z5 floor); the
   live-run gauge prints `168 expected`; on an HM race row the SAME number is a
   graded hard cap (`askedHrIsHardCap`).
3. **The runner CAN read `~160–167 (Z4 Threshold)` as a target while the watch
   carries 164/173.** Confirmed: `spec-card.ts:707` maps `threshold → hr?.z4`,
   and `v5-today.ts:1050`'s `stepSub()` resolves `pace_target ?? hr_target ??
   effort_target` — so the band is suppressed on any rep WITH a resolved pace,
   which is most of them, but survives on the `by_effort` fallback step
   (`spec-card.ts:713`) and on the no-breakdown step. The `~` mark is the only
   thing separating it from an instruction.
4. **The bail number is stated in a sentence that the bail's own trigger never
   evaluates** — see C-1.

### (f) Static Friel zones (`hrTargets()`): where do they render, and are they labelled?

Rendered as the per-step `hr_target` string on the pre-run card
(`spec-card.ts:438,504,525,542,713`), on the legacy `prescriptionFor()` path
(`prescriptions.ts:486–667`), and through `/api/v5/today:1513→1597`.

**They carry the `~` modelled mark (commit `50c7aab3`'s change — verified live:
`hrTargets(168).z4 === '~160–167 bpm (Z4 Threshold)'`), and that is the ONLY
labelling.** Nowhere does any surface say these are Friel *population*
percentages applied to an individual anchor. That matters more than it looks:
the percentages (85/90/95/100) are population constants; only the 168 is this
runner's. The `~` reads as "modelled number", which is right; it does not say
"population band", which is the actual provenance. Compare `computeZones`'s
Tanaka branch (`zones.ts:350`), which carries a full honesty note —
"individual error up to ±20 bpm · treat zones as approximate" — that the LTHR
branch does not, because the LTHR branch's anchor is individual. That is a
defensible split, but the population-percentage half is unlabelled on every
surface.

**Also: the warm-up step draws `hr?.z1` (`~< 142 bpm (Z1 Recovery)`) and
`spec-card.ts:424`'s own comment calls it "the HR cap … the only one of the
three that was ever the real constraint", while `hrTargets`'s doc comment
(`prescriptions.ts:284`) says the same values "must never be presented as
something the runner is meant to hit or hold."** Two files, both edited
2026-09-01, stating opposite things about the same value. Conflict C-4.

### (g) Rule 10: do the owner's `hr_cap_bpm` stamps carry the anchor, and do they match LTHR 168?

**No anchor stamp exists anywhere.** Queried:
`SELECT count(*) FROM plan_workouts WHERE workout_spec::text ILIKE '%anchor%'`
→ **0**. Not one spec row in production carries `{anchor, value, at}`. Rule 10's
first posture is unsatisfied by construction; the app relies entirely on the
recompute posture, which in turn relies on `plan-drift` / `recompute-paces`
firing — the exact Rule 23 dependency.

**And there ARE stale rows.** Active plan, by cap value:

| `hr_cap_bpm` | rows | future rows | dates |
|---|---|---|---|
| 145 (LTHR 162 — repudiated) | 4 | 0 | 2026-08-26 → 2026-08-30 |
| 151 (LTHR 168 — current) | 60 | 59 | 2026-08-31 → 2026-12-05 |
| 155 (marathon race, 92% × 168) | 1 | 1 | 2026-12-06 |
| 168 (HM race, 100% × 168) | 1 | 1 | 2026-11-08 |

`lthr_bpm` is 168 on all 13 quality rows. So **every FUTURE row is current** —
the recompute cascade is working. The defect is in the past:
`recompute-paces.ts:551` filters `date_iso >= today`, so the four pre-re-anchor
rows are **frozen at 145 forever**, and the recap reads them:

| date | type | cap on row | avg HR | what the recap says |
|---|---|---|---|---|
| 2026-08-26 | easy | 145 | 138 | (under — silent) |
| 2026-08-27 | easy | 145 | 121 | (under — silent) |
| **2026-08-28** | easy | **145** | **154** | *"Your HR (154) ran past the 145 target. Slow it down next time…"* |
| **2026-08-30** | long | **145** | **159** | *"Your HR averaged 159 against the 145 ceiling for this one · this ran harder than an aerobic long day."* |

Both sentences quote a ceiling derived from an LTHR the app **no longer
believes**. At the live anchor the ceiling is 151, so the 08-30 long run was 8
over, not 14. And on the 2026-08-28 run the run-detail screen renders
`easy_hr_read.easy_ceiling_bpm` from `judgeEasyRunHr(LIVE lthr)` = **151** while
the recap sentence on the same run says **145**. One run, two ceilings, six
apart, both on the runner's phone.

### (h) Duplicated formulas answering the same HR question

**"What is the aerobic ceiling?" — 5 live derivations:**

| # | Site | Formula at 168/183 | Verdict |
|---|---|---|---|
| A | `zones.ts:178` `aerobicCeilingBpm(lthr)` | `ceil(168×0.90)−1 = 151` | **SURVIVES — the canonical one** |
| B | `spec-builder.ts:389` `hrCapEasy(lthr,maxHr)` | `max(151, 143) = 151` | survives as A's authoring wrapper; the `max(HRmax×0.78)` arm is doctrine-cited (Daniels E) and is the only reason it is not a pure alias |
| C | `spec-builder.ts:403` `hrCapLong` | delegates to B, identical | **DELETE** — a name with no quantity of its own |
| D | `build-workout.ts:1455` `resolveHrCeiling` derived arm | `lthr ? 151 : round(183×0.78)=143` — **no `max()`**, so it can differ from B | **FOLD INTO B.** For a runner with `maxHr > 1.154 × lthr` the watch's derived ceiling is TIGHTER than the plan's authored one. Not the owner (183/168 = 1.089), but real. |
| G | `prescriptions.ts:385` `aerobicCapBpm = z2.upper` | 151 via a second route | **CALL A.** Diverges from B for the same high-HRmax runners, and this is the value the phone's `hrCapStat` prints. |
| F | `easy-discipline.ts:464` | `max(round(183×0.78)=143, spec cap)` | **HRmax-anchored, genuinely different.** Deliberate (its header argues it must never accuse the runner of obeying the app) — keep, but it should call B's HRmax arm rather than re-typing `0.78`. |

**"What is the top of the threshold band?" — 4 live values, all from LTHR 168:**

| Site | Value | Used for |
|---|---|---|
| `zones.ts:193` `thresholdPassHrBpm` | **164** (97.5%) | post-run pass criterion, next-test-point |
| `pace-hr-compatibility.ts:265` `z4.upper` | **167** (100% minus one) | refusing a pace progression |
| `build-workout.ts:1814` threshold arm | **168** (100%) | the live-run "expected" gauge |
| `threshold-band.ts:44` `×1.02` | **171.4** (102%) | recap copy + VDOT-refit gating |

All four cite `Research/03` §6. **Recommendation: `lthrZones()` is the single
owner. Z4 upper (167) is "under threshold", Z5a top (102% = 171) is "at
threshold".** Everything else should be expressed as one of those two edges,
not as a fourth percentage. `thresholdPassHrBpm`'s 0.975 and
`THRESHOLD_HR_CEILING_OF_TARGET`'s 1.02 are two names for the two ends of the
same Friel row and should be derived from `FRIEL_7_ZONE_EDGES`, not typed.

**"What is LTHR in terms of HRmax?" — 3 mutually inconsistent crosswalks:**

| Site | Formula | At 168/183 |
|---|---|---|
| `lthr.ts:78` `lthrFromMaxHr` | `round(maxHr × 0.90)` | 183 → 165 |
| `max-hr.ts:158` `hrMaxImpliedByLthr` | `round(lthr / 0.92)` | 168 → 183 |
| `zones.ts:396` `estimateMaxHRFromLTHR` | `round(lthr + 22)` | 168 → 190 |

Round-trip: 183 →(×0.90)→ 165 →(/0.92)→ 179. **Not an involution.** Nothing in
the doctrine registry binds these three to each other. One owner, one
direction, one inverse.

---

## 3 · Post-run: what the recap actually says (Rule 13 — engine run, not read)

Ran `deriveRecap` (`lib/coach/run-recap.ts:698`) directly. Verbatim outputs:

**A threshold rep set at 174 bpm (LTHR 168, `plannedHrCap` 168), 15 s/mi under
target:**
> Tempo done · 4 mi @ 6:55 · avg HR 174.
> Ran 15s/mi under the target, and the heart rate went with it · that is past threshold, not more of it. Threshold is bought with time at the pace, not by beating it. very even.

**Answer to the brief's question 4: the recap does NOT say "blew the ceiling"
on a threshold rep at 174.** The only negative verdict is the one above, it is
gated on `ranAboveThresholdBand(174, 168)` = `174 > 171.4` = true, and 174 is
genuinely 3.6% over LTHR — Friel Z5b (VO2) territory, not Z5a. **On a threshold
session that copy is defensible.**

**But the same code path fires on a TEMPO session at a heart rate the same app
calls Z4 Threshold.** On a tempo row `plannedHrCap` resolves to
`hr_target_bpm` = 155, so the band top is `155 × 1.02 = 158.1`. Verified:
`ranAboveThresholdBand(160, 155) === true`. So a tempo run at 160 bpm — the
**floor of `hrTargets().z4`, labelled "Z4 Threshold · just below LT"** — is told
"that is past threshold, not more of it." Conflict C-3.

**And the same branch's other arm asserts a fact it never checks.** Verified,
same runner, HR 154 against `plannedHrCap` 168 (the owner's real
2026-09-01 shape: threshold row, `lthr_bpm` 168, avg HR 154):
> Tempo done · 4 mi @ 6:55 · avg HR 154.
> Ran 15s/mi under the target **with the heart rate still in the band** · that is a soft lead the targets should probably catch up to. Worth a retest before it counts as a new number. very even.

154 is **fourteen beats below** the band floor. `ranBelowThresholdBand(154,168)`
returns `true` — the function exists, in the same module, and `run-recap.ts:31`
imports only its opposite. `run-recap.ts:593`'s guard is
`input.actualAvgHr != null && input.plannedHrCap != null`, with no band test at
all. **This is the "kept it aerobic" defect, alive, in the branch immediately
below the one that was fixed** — and it does not just misdescribe: it converts a
session where the runner never reached the prescribed intensity into "a soft
lead the targets should probably catch up to", i.e. a recommendation to make the
targets FASTER. Conflict C-6.

**An easy day at 174 against a 151 cap** (the control):
> Easy 6 mi at 8:35/mi. Right in the easy range. That's the aerobic work, no cost.
> Your HR (174) ran past the 151 target. Slow it down next time · easy days only work when they're actually easy.

Correct — and note the first sentence praises the pace while the second scolds
the HR, which is the intended two-axis read.

**The owner's most recent real quality run** (canonical row,
`NOT (data ? 'mergedIntoId')`): 2026-09-01, 8.5 mi, avg HR 154, max 172, 8:03
overall, against `threshold · 4×1 mi @ T pace · 1 min jog`,
`pace_target_s_per_mi = 430`. `workout_spec` carries `lthr_bpm: 168`, no
`hr_cap_bpm`, no `hr_target_bpm`. So `plannedHrCap` = 168 and, if the work
splits came in under 425 s/mi, the copy above is what he read.

**Recap text is not persisted** — no `run_recaps` table exists; `deriveRecap` is
called live by `app/api/runs/[id]/recap/route.ts` and `/api/v5/today`. So there
is no archive to check against; running the engine is the only verification
available, which is what was done.

---

## 4 · The conflicts, ranked

### C-1 · The bail says "Heart rate over 173 and still climbing" and is triggered by PACE. Severity: high.

`WorkoutEngine.shouldOfferBailNow` (`WorkoutEngine.swift:1997`):
```swift
guard bailRule != nil, !bailAnswered, state == .running else { return false }
return milesAdrift >= 2
```
`milesAdrift` is incremented at `:1380` by `noteMileBand(inBand: paceZone == .onTarget)` — **two consecutive whole miles whose PACE left the band.** Heart rate is never read.

The board then prints `engine.bailEvidence`, which prefers `bailRule.evidence`,
which the server composed in `splitRuleRegisters`
(`build-workout.ts:1076`) as **"Heart rate over 173 and still climbing"**.

So a runner at 150 bpm who drifts two miles off pace is shown a sentence
asserting his heart rate is over 173 and climbing. And a runner genuinely at 180
bpm holding pace is never offered the bail at all. `WatchRule` decodes `metric`,
`op` and `value` (`WatchWorkoutModels.swift:114–116`) and **reads none of
them** — grep confirms only `isBail`, `evidence` and `judgement` are ever
touched. Rule 16, in its own words: *"a sentence asserting a fact about a
measurement must be gated on that measurement or not said."*

The `declinedBail` recap arm compounds it (`run-recap.ts:784`): *"The bail line
tripped and you pushed through. Watch tomorrow's readiness."* — asserting a
tripped rule that never evaluated its own metric. And the watch sends
`label: "Bail line"` hardcoded (`WorkoutEngine.swift:2120`), so the recap cannot
even name which rule it means.

**Same defect, worse, on race day:** the `abort` rules (`Mile 2 check: avgHr over
179 · switch to the B plan`) draw **nothing at all** —
`WatchWorkoutModels.swift:87`: *"Only `bail` draws a board."* The race HR abort
is authored, persisted, shipped over the wire, and inert. This is the Rule 21
"wired, tested and inert" signature on a **safety stop**.

**Fix:** either evaluate `metric`/`op`/`value` on the wrist against
`tracker.heartRate` (the data is right there — `hrOverCeiling` already does
exactly this shape at `WorkoutEngine.swift:1101`), or stop shipping HR-worded
evidence for a pace-triggered board. Do not leave it as it stands.

### C-2 · `hr_cap_bpm` is one column holding two incompatible meanings, and the race one is graded. Severity: high.

`spec-builder.ts:1618` writes a **race-effort** ceiling into the same field as
the **aerobic** ceiling: HM → `lthr` (168), marathon → `round(lthr × 0.92)`
(155). `askedHrIsHardCap` (`/api/v5/today:829`) is `Boolean(hr_cap_bpm > 0)`, so
it is TRUE on race day, and `v5-today.ts:1411` draws the graded "Heart · under
168" row with `tone: 'attention'` when `avgHr > 168`.

The code's own comment (`spec-builder.ts:1620`) cites `Research/08` §6.1: *"an
HM races at 96-100% of LTHR."* **A ceiling set at the top of the correct band
grades correct execution as a fault the moment the runner reaches the top of
it.** And the owner's AFC half on 2026-08-16 came in at **avg HR exactly 168**,
max 178 — one beat from amber on his own PR. Worse, that is not a coincidence:
`lthr-reanchor` set LTHR *to* that race's average, so the ceiling and the
measurement are the same number by construction. This is Rule 9's
hair's-difference shape on a graded surface.

**And it hits both surfaces.** The watch lobby composes the identical row —
`build-workout.ts:1327-1336`, `{id:'heart', label:'Heart', sub: 'under ${askedHrCap}',
tone: avgHr > askedHrCap ? 'attention' : null}` — rendered at
`FacesLobbyV5.swift:355-374` with the value inked amber on `tone == "attention"`.
So a correctly-raced half marathon goes amber on the wrist and on the phone.

**Fix:** race gets its own field (`race_hr_ceiling_bpm`) or its own
`askedHrIsHardCap` exclusion. A race-effort reference is not an aerobic cap and
must not inherit the aerobic cap's grading.

### C-3 · `threshold-band.ts` is applied to a target that is not the threshold. Severity: high.

`drift-monitor.ts:695` and `run-recap.ts:590` both feed
`ranAboveThresholdBand(avgHr, hrTarget)` a value that is **92% of LTHR on tempo
rows** (`hr_target_bpm` = 155). The band top becomes `155 × 1.02 = 158`, so the
app calls 160 bpm "past threshold" while its own `hrTargets().z4` labels
160–167 "Z4 Threshold · just below LT".

Compounding it, `drift-monitor`'s HR corroboration reads **only**
`workout_spec.hr_target_bpm`, which `spec-builder` writes on **tempo rows
only** — threshold and interval rows carry `lthr_bpm`. Verified in prod: of the
active plan's 19 quality rows, 6 carry `hr_target_bpm` and 13 carry `lthr_bpm`.
So the mechanism whose header says *"Did the heart rate agree that this was
threshold work?"* is structurally blind on every actual threshold session and
fires only on tempo, where its threshold is 13 bpm too low. Rule 15: a mechanism
the corpus cannot reach is untested — this one the *production data* cannot
reach.

**Fix:** `drift-monitor` should COALESCE both fields (as `build-workout.ts:1791`
and the recap route already do), and `threshold-band.ts` should take the
runner's LTHR, not the session's target, since Friel's 100–102% is a fraction of
LTHR and not of whatever number the row happens to carry.

### C-4 · Two files, edited the same day, state opposite things about `hrTargets()`. Severity: medium.

`prescriptions.ts:284`: *"It is display-only … and it must never be presented as
something the runner is meant to hit or hold."*
`spec-card.ts:424` (WARMUP-CONTRADICTION-1): *"the HR cap was the only one of the
three that was ever the real constraint … 'build into the work' all point the
same direction — start under both ceilings."*

Both landed 2026-09-01. The warm-up step ships `hr_target: hr.z1` next to a
`pace_target` rendered as a ceiling (`≤ 8:22 /mi`), so the runner reads two
ceilings, one of which the producing function insists is not one. Rule 20's
prose corollary: gate the claim or delete the sentence.

### C-5 · The pass criterion is authored where it is physiologically unreachable, and read by nothing that matters. Severity: medium.

`spec-builder.ts:1063` writes `Pass: avgHr ≤ 164 on the work` on
`threshold | tempo | intervals | race_week_tuneup`. Verified in prod — the
2026-09-03 row *"10×60s hills @ 5K-10K effort"* carries it. `Research/03` §6 puts
VO2 reps at 103–107% LTHR = 173–180. **A pass line at 97.5% LTHR cannot be met
by a correctly executed VO2 session.** `goal-projection.ts:876` gets this right —
`T_PACE_CRITERIA_TYPES = {tempo, threshold, race_week_tuneup}`, intervals
excluded. Two consumers of one constant, one correct, one not.

And on the same interval row the app's own live-run gauge prints **176
expected** (`round(168 × 1.05)`), 12 beats above its own pass line and 3 above
its own bail. Three numbers, one session, mutually unsatisfiable.

`pass` rules reach nothing: `splitRuleRegisters` (`build-workout.ts:1067`) drops
them from every card, the watch records only the bail
(`ruleOutcomesForWire` returns `[bailOutcome]` and nothing else,
`WorkoutEngine.swift:2247`), and `run-recap` filters
`kind === 'bail' || kind === 'abort'`. The only reader is
`goal-projection.ts:881`. Rule 21: authored on 19 live rows, evaluated on zero.

### C-6 · "the heart rate still in the band" is asserted without checking the band. Severity: high — it recommends a pace increase off a session that never reached intensity.

`run-recap.ts:593`, quoted in §3. `ranBelowThresholdBand` exists at
`threshold-band.ts:75`, is imported by `drift-monitor.ts:66`, and is **not
imported by `run-recap.ts`** — which imports only the ceiling (`:31`). The
`slowQualityNeverReachedTheBand` helper exists for exactly this and is never
called from the recap either.

**Fix:** three arms, not two — above the band, in the band, below the band —
and the below-band arm must not say "soft lead". Reachable on the owner's live
data today (2026-09-01, avg HR 154, cap 168).

### C-7 · Four ceilings for one threshold band; two of them give opposite advice on the same session. Severity: high (blocks the §3 policy from working).

At avg work HR **171** on a fast threshold session:
- `run-recap.ts:593` → `171 < 171.4` → *"with the heart rate still in the band ·
  that is a soft lead the targets should probably catch up to."*
- `pace-hr-compatibility.ts:265` → `171 − 167 = 4` unexplained → `unexplained_hot`;
  three such sessions → `INCOMPATIBLE_REFUSE`, `paceProposalMayProceed: false`.

**The recap tells the runner the targets should get faster; the validator that
decides whether they get faster refuses on the grounds that the HR was too
high.** Both cite Friel. They are 4.4 bpm apart. This is the single most
consequential duplicate in the audit because `PRODUCT_DECISIONS.md` 2026-09-01
§3 makes that validator the gate on live PACE authority — it cannot arbitrate a
pace/HR contradiction while it is itself one of the two contradicting answers.

### C-8 · Rule 10: no spec row carries an anchor, and past rows are frozen against a repudiated one. Severity: medium (correct today, wrong in the archive).

See §2(g). Zero anchor stamps in production; four sealed rows judged against
LTHR 162 while the app believes 168; run detail and the recap print 151 and 145
for the same ceiling on the same run. The `recompute-paces.ts` cascade holds the
future correct — but per Rule 20 the header comment at
`build-workout.ts:1401–1416` that argues spec-first is safe *because* the cascade
works is only as good as that cascade, and the cascade explicitly does not touch
`date_iso < today`.

**Fix (cheapest correct one):** stamp `{lthr_bpm_at_authoring, at}` beside
`hr_cap_bpm` and have the recap either recompute from the live anchor or LABEL
the frozen one ("the 145 ceiling this day was prescribed under"). Silence is not
available — the runner is currently reading a number with no provenance.

### C-9 · Two resting heart rates and three HRmax columns. Severity: low, but it is the same disease.

`profile.rhr = 46` and `users.resting_hr = 52` on the same runner, 6 bpm apart,
neither carrying provenance. `profile.hrmax = NULL`, `profile.hrmax_observed =
183`, `users.max_hr = 183`. Rule 16.

### C-10 · Phone `.reference` beats `.ceiling` in precedence. Severity: low today, latent.

`LiveRunOutdoorV5.swift:588`. See §2(a). Order it the other way and add the
invariant as a gate rather than a comment.

### C-11 · No cardiac-lag allowance downstream of the card. Severity: low.

`HR_TARGET_MIN_REP_SEC = 30` guards the CARD only. `build-workout.ts` stamps
`hrTargetBpm` on every work phase regardless of duration, so 60-second hill reps
ship a live-run HR reference the card itself refuses to print. See §2(d).

### C-12 · `HRAlerter` — a dormant phone alarm whose copy contradicts its own trigger. Severity: medium (latent), trivial to fix now.

`native-v2/Faff/Faff/HRAlerter.swift`: fires at `ceiling × 0.95` and says
"above your {ceiling} ceiling"; `predicate: nil` where the header claims a
workout gate; `configure(enabled:ceiling:)` has no call site, so its ceiling is
a `UserDefaults` value nothing writes and nothing re-anchors. See §2(a). Fix it
before wiring the settings toggle, not after.

### C-13 · The wrist cannot tell an HR breach from a pace correction by feel. Severity: low, deliberate, worth re-examining.

`Haptics.swift:260` maps both `.headsUpEaseOff` (pace drift) and
`.ceilingBreach` (HR) to the `.easeDown` texture. Documented as intentional at
`:218-221`. It is the one place an HR event and a pace event are
indistinguishable, and given C-1 — where an HR-worded board is raised by a pace
trigger — the two are already confused enough at the copy layer.

---

## 5 · Recommended single owner per HR question

| Question | Canonical owner | What gets deleted / folded |
|---|---|---|
| What is this runner's threshold HR? | `profile.lthr`, written **only** by `lthr-reanchor-store.ts` / the field-test path | already correct — and it is the only anchor carrying method + date |
| What is this runner's HRmax? | `loadEffectiveMaxHr` (`max-hr.ts:261`) | `profile.hrmax` / `hrmax_observed` collapse to mirrors; `users.max_hr` stays the ratchet store |
| What are this runner's HR zones? | `computeZones` → `lthrZones` (`zones.ts`) | everything else reads the table; nobody re-derives a percentage |
| What is the aerobic ceiling? | `aerobicCeilingBpm` (A), wrapped once by `hrCapEasy` (B) for the HRmax arm | delete `hrCapLong` (C); `resolveHrCeiling`'s derived arm (D) calls B; `aerobicCapBpm` (G) calls A; `easy-discipline` (F) calls B's HRmax arm |
| Where does the threshold band start and end? | `lthrZones()`'s Z4 upper (167) and Z5a top (171) | `thresholdPassHrBpm`'s 0.975 and `THRESHOLD_HR_CEILING_OF_TARGET`'s 1.02 derive from `FRIEL_7_ZONE_EDGES`, not from typed literals; `pace-hr-compatibility` and `threshold-band` then agree by construction (closes C-7) |
| What HR should the runner expect on quality work? | ONE resolver, off `lthrZones()` | `build-workout.ts`'s `workHrTargetBpm` stops using flat 100% / 92% / ×1.05 and reads the zone the session is prescribed for; `spec-builder`'s `hr_target_bpm`/`lthr_bpm` split collapses to one field with one meaning (closes the round-3 report's own "not fixed" item and C-5) |
| Is this session's HR a reason to change the plan? | `threshold-band.ts`, taking **LTHR**, not the row's target | `drift-monitor` COALESCEs both spec fields; `run-recap` imports the floor as well as the ceiling (closes C-3, C-6) |
| May a pace progression proceed? | `pace-hr-compatibility.ts` | but only once it and `threshold-band` share one band (C-7) |
| Is the runner over an aerobic ceiling right now? | watch `hrCeilingBpm` / phone `.ceiling` | unchanged — this is the one HR alarm and it is correctly scoped |
| Should the plan bail mid-session? | must become HR-evaluated on the wrist, or lose its HR wording | C-1 |
| Should the race be aborted? | currently nothing — the rule ships and no surface reads it | C-1 |
| How does heat change today's HR read? | `heatHrBumpBpm` | already single-owner and correctly interpretation-only |
| Is normal training appropriate today? | `runner-state.ts` / `convergence.ts` | already correct; ACWR and post-race are reported-never-driving by explicit constant |

---

## 6 · Corrections to the reports this audit was asked to verify

- **`hr-semantics-2026-09-01.md` Part 1, mechanism 1: "zero downstream
  consumers."** True of the `hrTargets()` STRING. Not true of the underlying
  Friel table, which `pace-hr-compatibility.ts:236` reads as the refusal edge and
  `resolveHrZoneShares` reads as the bucketing table. The mechanism is not
  display-only; its string is.
- **Mechanism 4: "purely for the runner's own information."** False.
  `drift-monitor.ts:695` reads `workout_spec.hr_target_bpm` and uses it to decide
  whether a fast quality block is a fitness LEAD (→ VDOT refit proposal) or an
  execution finding. `run-recap.ts:590` reads the same value (via the recap
  route's `COALESCE`) to choose between two verdicts. It is graded, twice.
- **Mechanism 4 has three values, not one.** 168 (threshold, `lthr_bpm`), 176
  (intervals, `× 1.05`), 155 (tempo, `× 0.92`). The report's table lists the
  ×1.05 but does not note that 176 exceeds the same session's own bail (173).
- **"Mechanisms 1 and 4 are two independent formulas"** — correct and honestly
  flagged, but the count is wrong: there are FOUR independent derivations of the
  top of the threshold band (164 / 167 / 168 / 171.4), and the fourth
  (`pace-hr-compatibility.ts`) is the one the 2026-09-01 decision makes the gate
  on live PACE authority.
- **"`TodayPreRunBodyV3.swift` — phone pre-run static preview."** That file is
  the v4 body, reachable only under the `-faffLegacy` launch argument
  (`FaffApp.swift:360-366`). The shipping v5 pre-run panel composes no HR string
  client-side; it renders the server's `panel.stats`. The report's "`168+ bpm ·
  VO2max` reads like a floor" flag is therefore about a legacy-only surface.
- **"`SpokenCues.swift` … no separate ceiling/target framing exists in the voice
  layer to fix."** Correct, and stronger than stated: **no HR line is ever
  spoken on the watch at all.** The ceiling breach is visual + haptic only.
- **"`WorkoutGrade.swift` — pace-based only; no HR grading logic."** Confirmed
  by reading all 88 lines. But the report stops there; the HR comparison the
  watch DOES make lives in `WorkoutEngine.swift:1101`, and the bail — the one
  HR-worded decision the wrist offers — is triggered by pace (C-1). "No HR
  grading in `WorkoutGrade.swift`" is true and reads as more reassuring than the
  wrist actually is.
- **`pace-hr-compatibility-2026-09-01.md`'s account of where "164-172" came
  from** (pass 164, bail 173 − 1) is convincing and matches the live data.
  Confirmed in prod: the owner's rows carry exactly `pass ≤ 164` / `bail > 173`.
- **`50c7aab3`'s HR copy change is live and correct**: `hrTargets(168).z4`
  returns `'~160–167 bpm (Z4 Threshold)'` — verified by calling the function.

---

## 7 · What this audit could NOT check

- **Rule 13 rendering.** Nothing here was verified on a running simulator or a
  real phone. The phone and watch findings are source-level; the engine findings
  were verified by executing the real functions. The round-3 report's own
  `LiveRunOutdoorV5` screen render remains unconfirmed by anyone.
- **Whether the 2026-09-01 threshold run's work splits actually beat 425 s/mi.**
  The run's whole-run pace is 8:03 against a 7:10 target; if the watch recorded
  work phases the `tempoExecution` branch fired, and C-6's sentence is what he
  read. The phase data was not queried.
- **`legacy/` and the retired `web/` tree** beyond confirming `validate-max-hr.ts`
  lives only there, reads a table (`strava_activities`) that no longer exists in
  `web-v2`, has no `web-v2` importer, and cannot write `users.max_hr` (it only
  reads `max_hr_validation_dismissed_at`).
- AppleDouble `._*` sidecars are present beside `lib/adaptation/*.ts` — per the
  project's own volume notes those break `find`-driven tooling and can corrupt
  git packs. Not acted on; flagged.
