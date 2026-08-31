# Pace/HR compatibility — 2026-09-01

Response to `docs/PRODUCT_DECISIONS.md` 2026-09-01 §3's two open items: "what
semantic is `HR 164-172` on the quality segment" and the "mandatory
compatibility validator" the decision authorizes but does not yet implement.

Subject account: `0645f40c-951d-4ccc-b86e-9979cd26c795`. Every number below
was read from the live database over the read-only role, or produced by
calling the real, live functions against that data — `resolveThresholdCapacity`
and `checkPaceHrCompatibility` were both invoked directly, not against a
fixture. Verified per Rule 13.

---

## Part 1 · What does `HR 164-172 bpm (Z4)` mean today?

**Short answer: that exact number no longer exists anywhere in the live
code path, and it never was one single, coherent quantity.** Re-running the
real card-rendering function against the same production row the prior
verification report (`docs/reports/workout-fix-verification-2026-09-01.md`
§8) claimed to have run produces a different number — **`160-167 bpm (Z4
Threshold)`** — and tracing both figures to their source shows they came
from two structurally different mechanisms that got collapsed into one
reported string.

### The two real mechanisms, and neither is "164-172"

**Mechanism A — the displayed `hr_target` string (what the runner reads
next to the reps).** Computed by `hrTargets()`
(`web-v2/lib/training/prescriptions.ts:280-293`), which calls
`computeZones({lthr})` → `lthrZones()` (`web-v2/lib/training/zones.ts:184-
203`) — a **Friel LTHR-percentage physiological zone table**, independent
of the prescribed pace, the resolver's confidence, or anything about this
specific workout. For this account's live `lthr = 168` (confirmed via
`SELECT lthr FROM profile WHERE user_uuid = '0645f40c-...'`, `lthr_set_at:
2026-08-31T02:40:47Z`), Z4 (95-100% of LTHR) is:

```
160-167 bpm (Z4 Threshold)
```

Verified by calling the real function directly (`tsx` against the live
source, not a hand trace):

```
hrTargets(168).z4 = '160–167 bpm (Z4 Threshold)'
```

and by calling `cardFromSpec()` — the actual phone card renderer
(`web-v2/lib/training/spec-card.ts`) — against the real
`plan_workouts` row for `wko_eaa8cfd7cb94310b` with `easyPaceSec: 522,
easyCeilingSec: 502, toleranceSec: 8` (the exact inputs the prior report
used):

```json
{
  "label": "Repeat 4×", "reps": 4, "rep_distance_mi": 1,
  "pace_target": "7:02-7:18 /mi",
  "hr_target": "160–167 bpm (Z4 Threshold)",
  "note": "Same pace on every rep. If the last one slips, the target was too fast.",
  "recovery": { "duration": "1:00", "note": "Honest jog, not standing." }
}
```

Grep across `web-v2` confirms this string has **zero downstream consumers**
besides display: nothing parses `hr_target` back into a number, nothing
gates or warns on it, nothing feeds it to an adaptation. It reaches the
wire payload unchanged (`app/api/v5/today/route.ts:1555`) and stops there.

**Mechanism B — the pass/bail contingency rule (what actually reaches the
watch).** Computed inline in `web-v2/lib/plan/spec-builder.ts:1060-1069`:

```ts
const passHr = lthr != null ? Math.round(lthr * 0.975) : null;  // 164
const bailHr = lthr != null ? lthr + 5 : null;                  // 173
```

For `lthr = 168` this is **pass ≤ 164, bail > 173**, stored verbatim in
`workout_spec.rules` (confirmed against the live row):

```json
"rules": [
  { "kind": "pass", "metric": "hr", "op": "<=", "value": 164,
    "label": "Pass: avgHr ≤ 164 on the work" },
  { "kind": "bail", "metric": "hr", "op": ">", "value": 173,
    "label": "HR over 173 and climbing · finish easy, the stimulus is banked",
    "action": "drop_to_easy" }
]
```

This IS consumed downstream: `lib/watch/build-workout.ts:2015-2025` reads
`workout_spec.rules` and decorates the watch's contingency cues; a breach of
the bail rule triggers `action: 'drop_to_easy'`. But per the code's own
comment (`spec-builder.ts:1038`) the watch **OFFERS the bail as a runner
choice (CONTINUE / TAKE THE BAIL) and never enforces it automatically**, and
it evaluates against the AVERAGE HR of the whole work segment, not an
instantaneous ceiling. Post-run, `lib/coach/run-recap.ts:772-775` reads
whether the bail was breached and whether the runner acted on it, for the
recap narrative.

### Where "164-172" actually came from

**164** is `passHr` exactly. **172** is `bailHr - 1` (173 - 1). Nothing in
the live code ever computes or displays `[passHr, bailHr - 1]` as a range —
this looks like the prior report's author manually eyeballed the two
contingency-rule numbers and wrote them out as an ad hoc "band," then
attached the `(Z4)` label because the workout is a threshold session,
without checking that against what `hrTargets().z4` actually evaluates to
for this LTHR. It is a **real, distinct number from both live mechanisms**
— not mechanism A (160-167), not mechanism B's actual pair (164 / 173) —
and it is itself an instance of exactly the pattern Rule 16 names ("one
quantity, one name"): two independent HR figures on one card, conflated
into a third number that matches neither.

### The semantic answer, given both real mechanisms

Neither mechanism cleanly matches any one of the three labels offered
(hard safety ceiling / expected-response band / target zone):

- **Mechanism A (the displayed Z4 band, 160-167)** is closest to an
  "expected-response" *classification*, but not in the sense of "this is
  what HR should look like if you're at the right pace" — it does not
  derive from the prescribed pace at all. It is a static physiological zone
  computed purely from LTHR%, shown next to whatever pace the reps carry,
  regardless of what that pace is. It is **pure display**: nothing reads it
  back.
- **Mechanism B (pass 164 / bail 173)** is the closest thing to a ceiling
  in this app today, but it is an **offered escape hatch**, not a hard
  block — nothing stops the runner from exceeding it, it only surfaces a
  CONTINUE/TAKE-THE-BAIL choice mid-run and a post-run narrative note. It
  is evaluated against average work-segment HR, not instant HR, and it
  plays no role at authoring/proposal time — it never gates or adapts a
  pace prescription.
- **Neither is a "target zone to aim for."** The card's own instruction
  ("Same pace on every rep...") tells the runner to hit the *pace* band;
  the HR text sits beside it with no imperative verb.

**This is the finding worth stating plainly, as the task anticipated:** the
current implementation does not implement any ONE of the three product
semantics coherently. It implements two structurally different mechanisms
that happen to sit on the same card, and a third, invented number
(reported previously as "164-172") that matches neither and should not be
cited again.

---

## Part 2 · The compatibility validator

### Where it lives, and what it does not touch

`web-v2/lib/adaptation/pace-hr-compatibility.ts` — new file, pure function,
no database import, no import of `adaptation-engine.ts`. It does not touch
`adaptation-engine.ts`'s proposal composition, `capacity-resolver.ts`, or
`normal-window.ts` — all three were explicitly off-limits for this pass and
were only read for context. It is **not wired into any live path** — the
shadow-compare harness (a separate stream of work per the task brief) is
the intended caller; this file is the check that harness calls.

Test file: `web-v2/lib/adaptation/pace-hr-compatibility.test.ts` — 7 tests,
including the real-data case and three synthetic falsifiers (Rule 18).

### Design, mapped to the decision's exact policy

| Policy clause | Implementation |
|---|---|
| Pace and HR resolve independently | The module takes an already-resolved `previousSecPerMi`/`proposedSecPerMi` (from wherever `detectPace` in `adaptation-engine.ts` produces its proposal) and an already-resolved `lthrBpm` + per-session `avgWorkHrBpm`. It never derives one from the other. |
| (a) Compatible → HR stays put, no action | `COMPATIBLE` verdict, `paceProposalMayProceed: true`, no HR field is touched or returned as "should change." |
| (b) Adverse conditions ≠ incompatibility | Reuses `heatHrBumpBpm()` from `lib/weather/heat-adjustment.ts` (Research/03's own confounder table, already live) to subtract the expected heat-driven HR elevation before judging a session "hot." A fully heat-explained overage returns `COMPATIBLE_ENVIRONMENTAL_EXPLAINED`, distinctly labeled so a caller can see it was excused, not ignored. No new environment logic was built — the existing function is called verbatim. |
| (c) Repeated stale-ceiling pattern → HR evidence's job, not a pace side effect | Three-or-more controlled sessions running materially under the Z4 floor return `COMPATIBLE_HR_CEILING_LIKELY_STALE` — the pace proposal still proceeds (this is not blocking anything), but the verdict names the pattern and echoes an optional `lthrReanchor` advisory read from `decideLthrReanchor()` (`lib/training/lthr-reanchor.ts`) if the caller supplies one. The module never re-anchors LTHR itself. |
| (d) Materially incompatible → REFUSE/HOLD | Three-or-more controlled sessions running materially over the Z4 ceiling, with any heat confounder already subtracted, return `INCOMPATIBLE_REFUSE`, `paceProposalMayProceed: false`. |

The 3-session corroboration bar (`MATERIAL_INCOMPATIBILITY_MIN_SESSIONS`)
deliberately mirrors `PACE_PROGRESS_MIN_SESSIONS` in `adaptation-engine.ts`
— the same standard the PACE proposal itself had to clear to exist is the
standard held against it before this validator will contradict it. A
one-session refusal would set a stricter bar going down than the bar the
lever itself must clear going up, which is Rule 9's asymmetry check in its
mirror form.

Rule 11 discipline: a session with no HR data is excluded and named
(`excludedForMissingHr`), never guessed at or defaulted to "in band." No
LTHR on file returns `INSUFFICIENT_HR_EVIDENCE` — this is explicitly
**not** the same as `INCOMPATIBLE_REFUSE`; "we could not check" does not
become a new veto power the decision never granted the validator (a
judgment call, made explicitly and documented in the file's own header
comment, since the module is shadow-mode-only and has zero live effect
either way).

### Verdict against the real, live proposal

`resolveThresholdCapacity('0645f40c-951d-4ccc-b86e-9979cd26c795',
'2026-09-01')`, called live:

```json
{
  "paceSecPerMi": 430, "vdot": 47.9, "confidence": 0.724, "sourceMode": "direct",
  "evidenceIds": ["-280549580846348", "-226755616416002", "-87627419857791"],
  "reasons": ["DIRECT_CORROBORATED_THRESHOLD_EVIDENCE", "THREE_RECENT_CORROBORATING_SESSIONS", "OBSERVATIONS_AGREE", "FRESH_EVIDENCE"]
}
```

`438` is the pre-split blended prescribed pace named in
`adaptation-engine.ts`'s own `PacePhaseRead` doc comment as the real number
this account produced before the 2026-09-01 decision's phase-split fix.
`430 → 438` is therefore the real proposal shape to check.

Pulling the three evidence activities' HR (read-only role):

| Activity | Distance | Whole-run avg HR | Splits | Work-segment HR used |
|---|---|---|---|---|
| `-226755616416002` | 4.86 mi | 129 | **none persisted** | **excluded** (Rule 11 — cannot isolate work HR, not guessed) |
| `-87627419857791` | 7.56 mi | — | 8 miles, HR 138-170 | miles 3-6 (7:13, 7:04, 7:22, 6:27/mi — the fast portion) avg **163.25 bpm**, 70.2°F |
| `-280549580846348` | 5.73 mi | — | 5 miles, HR 127-149 | only mile 2 (7:33/mi, 453 s/mi) reads near threshold pace, rest at easy pace → **149 bpm**, 73.5°F |

(This account's historical activities carry mile-granularity auto-lap
splits, not segment-tagged work/recovery boundaries, so isolating the
"work" miles here used pace as a proxy — a reasonable stand-in for this
demonstration, but a production wiring of this validator should instead
source `avgWorkHrBpm` from the Evidence Engine's own quality-segment
grouping in `lib/evidence/activity-evidence.ts`, which already exists and
does this properly. Named here rather than silently smoothed over.)

Calling `checkPaceHrCompatibility()` with these real numbers:

```json
{
  "verdict": "COMPATIBLE",
  "paceProposalMayProceed": true,
  "reason": "The controlled sessions backing this pace proposal sit inside or reasonably near the runner's own Z4 ceiling (160-167 bpm). The faster pace is compatible with existing HR evidence — HR stays put, no action.",
  "z4BandBpm": { "lower": 160, "upper": 167 },
  "sessionReads": [
    { "activityId": "-87627419857791", "avgWorkHrBpm": 163.25, "deltaAboveZ4Bpm": -3.75, "classification": "within_band" },
    { "activityId": "-280549580846348", "avgWorkHrBpm": 149, "deltaAboveZ4Bpm": -18, "classification": "below_band" }
  ],
  "excludedForMissingHr": ["-226755616416002"],
  "lthrReanchorAdvisory": { "stale": false, "action": "none", "why": "Set 2026-08-31 · inside the re-test cadence." }
}
```

**Real verdict: COMPATIBLE. The 430→438 (equivalently 438→430) pace
proposal proceeds and HR is not touched — both readings agree this is one
truthful stimulus.** Neither qualifying session ran anywhere near the Z4
ceiling, so this is not a borderline call.

### Proving it actually refuses something (synthetic, clearly labeled)

Per the task's own requirement, three synthetic cases exercise the
mechanism the real data didn't happen to trigger:

**1 — genuine incompatibility.** Three controlled sessions, avg work HR
179-182 bpm (12-15 over the Z4 ceiling of 167), on cool days (52-58°F, well
under the 77°F heat-confounder threshold) — no environmental explanation
available:

```json
{ "verdict": "INCOMPATIBLE_REFUSE", "paceProposalMayProceed": false,
  "reason": "3 of the 3 controlled sessions backing this pace proposal ran 15, 13, 12 bpm over the runner's own Z4 ceiling (160-167 bpm) with no heat confounder to explain it. ... refuse the pace step rather than silently moving HR to fit it." }
```

**2 — same overage, heat-explained.** Identical HR pattern, but every
session ran at 90°F (`heatHrBumpBpm(90)` ≈ 20 bpm, fully covering the
overage):

```json
{ "verdict": "COMPATIBLE_ENVIRONMENTAL_EXPLAINED", "paceProposalMayProceed": true }
```

Confirms policy (b): the validator does not conflate a same-day heat
confounder with a real capacity contradiction.

**3 — repeated undershoot.** Three controlled sessions running 6-8 bpm
under the Z4 floor:

```json
{ "verdict": "COMPATIBLE_HR_CEILING_LIKELY_STALE", "paceProposalMayProceed": true }
```

Confirms policy (c): the pace step is not blocked, and the pattern is
surfaced for the HR owner rather than silently absorbed.

All three, plus the real-data case, the missing-LTHR case, and a
below-corroboration-bar case, are asserted in
`web-v2/lib/adaptation/pace-hr-compatibility.test.ts` (7/7 passing).

---

## Verification (Rule 13)

- `resolveThresholdCapacity` called live against the real account and date,
  over the read-only DB role — not a fixture.
- `cardFromSpec` called live against the real `wko_eaa8cfd7cb94310b` row —
  reproduced the discrepancy with the prior report directly rather than
  asserting it from a hand trace.
- `hrTargets(168)` and `computeZones({lthr:168})` called live against the
  actual exported functions via `tsx`, not hand-derived arithmetic (the
  hand-derived arithmetic was cross-checked against this and matched).
- Real HR/temperature/splits data for all three evidence activities pulled
  from `runs.data` over the read-only role.
- `npx tsc --noEmit` clean across `web-v2` (whole project, not just the
  changed files).
- `npx vitest run lib/adaptation/pace-hr-compatibility.test.ts` — 7/7
  passing, including all three synthetic falsifiers.
- `npx vitest run lib/adaptation lib/training/zones lib/weather` — 141/141
  passing, confirming no regression in the files this pass read from.
- No file in the explicit off-limits list (`adaptation-engine.ts`'s
  proposal-composition/absorption-reader split, `normal-window.ts`,
  `capacity-resolver.ts`) was edited — confirmed via `git status` before
  and after this pass; those three files show as modified by other agents,
  untouched by this one.

## Files changed

- `web-v2/lib/adaptation/pace-hr-compatibility.ts` — new. The compatibility
  validator, pure, shadow-mode only, no live callers.
- `web-v2/lib/adaptation/pace-hr-compatibility.test.ts` — new. 7 tests:
  real-data case, three synthetic falsifiers, an insufficient-evidence
  case, a below-corroboration-bar case, and a constants-are-documented
  sanity check.
- This report.

## Flagged, not fixed (out of scope for this pass)

- The `round(lthr × 0.975)` threshold-pass fraction is now inlined
  independently in three places (`spec-builder.ts:1060`,
  `goal-projection.ts:880`, and implicitly re-derived as this validator's
  Z4-ceiling-adjacent logic via `computeZones` instead — this file does NOT
  add a fourth inline copy of the 0.975 formula itself, it uses the
  already-shared `computeZones`/Friel table instead). The two existing
  inline copies are a Rule 16 candidate for extraction into one named,
  exported constant — not touched here since both host files are either
  outside this pass's scope or risk conflicting with concurrent agent work.
- Isolating a session's true work-segment HR from raw GPS splits (used here
  via a pace-based proxy for two of three real evidence sessions) should be
  sourced from the Evidence Engine's own quality-segment classification in
  `lib/evidence/activity-evidence.ts` once the shadow-compare harness wires
  this validator in for real — flagged in Part 2 above, not built here.
