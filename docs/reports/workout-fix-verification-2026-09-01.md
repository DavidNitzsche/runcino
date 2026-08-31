# Workout fix verification — 2026-09-01

Subject: `plan_workouts.id = 'wko_eaa8cfd7cb94310b'`, `date_iso = '2026-09-01'`,
`plan_id = 'pln_9a57561debb776e5'`, user `0645f40c-951d-4ccc-b86e-9979cd26c795`.
Same row `docs/reports/workout-provenance-trace-2026-09-01.md` traced.

This report closes the second half of that trace: the wiring agent
(`66a5fea5`) fixed the *values* — 7:19 → 7:10, and confirmed the new
`resolveThresholdCapacity`/`resolvePrescribedPaceAnchors` layer is what feeds
the row. It did not touch the *composition layer* that turns those values into
what the runner reads. This pass does that: `web-v2/lib/plan/spec-builder.ts`
(WU/CD remainder-split policy), `web-v2/lib/training/expand-spec.ts` (the
phase expander both the phone and the watch consume), `web-v2/lib/training/
spec-card.ts` (the phone's card renderer), and the two call sites that feed
them an easy-pace anchor (`web-v2/app/api/v5/today/route.ts`,
`web-v2/lib/watch/build-workout.ts`).

Every number below was read from the live database over the read-only role,
or produced by calling the real, now-patched functions against that row —
`cardFromSpec` was invoked directly against the production row, not a
fixture, and its full output is reproduced verbatim in §8. Verified per
Rule 13.

---

## 1. Workout purpose and intended physiological stimulus

Catalogue entry `cruise-intervals` (`web-v2/lib/workout-catalogue/
catalogue.ts:693-701`), family `threshold`, zones `['T']`. Research/04 §5.3's
own Purpose row: *"accumulate more time at T than a single tempo allows."*
The session is four broken-up miles at threshold rather than one continuous
block, so the runner spends more total time at the lactate-threshold
intensity than an uninterrupted tempo run of the same total distance could
sustain.

The card's own "why" string (`sessionRationale('threshold')`,
`web-v2/lib/training/prescriptions.ts:397-400`, unchanged by this pass):

> "Lift the lactate threshold · the engine's ceiling. The pace you could hold
> for an hour."

## 2. Capacity belief, evidence, confidence, and exclusions

`resolveThresholdCapacity`, executed live against this account
(`training_plans.authored_state.pace_recompute.anchors.basis.threshold`,
written 2026-08-31T21:48:43Z by the wiring commit):

```json
{
  "paceSecPerMi": 430,
  "vdot": 47.9,
  "confidence": 0.7268354752028102,
  "sourceMode": "direct",
  "reasons": [
    "DIRECT_CORROBORATED_THRESHOLD_EVIDENCE",
    "THREE_RECENT_CORROBORATING_SESSIONS",
    "OBSERVATIONS_AGREE",
    "FRESH_EVIDENCE"
  ]
}
```

Direct evidence, three corroborating recent threshold sessions that agree
with each other, all fresh — not a VDOT-table fallback and not a goal-facing
blend (the wiring commit deleted `blendedTPaceForWeek` and its
`measuredProgressFraction` grace term outright, per Constitution §G's "goal ≠
current training capacity"). Confidence 0.73, not 1.0 — three sessions is
real corroboration, not certainty, which is exactly what §5 below spends on
the display format rather than ignoring.

This pass did not touch the resolver itself (out of scope, and explicitly
off-limits — `web-v2/lib/training/capacity-resolver.ts` is one of the files
other agents may still have in flight per the working instructions). It only
changed how the number the resolver already produced is displayed.

## 3. Canonical quality-pace prescription, and why it's a band

Stored: `workout_spec.rep_pace_s_per_mi = 430` (7:10/mi), unchanged by this
pass — that value was already corrected by the wiring commit.

**What changed:** the card used to print that as a bare point, `"7:10 /mi"`,
with no represented uncertainty at all — the single-second resolution of
`Math.round()` at the end of a formula chain, on a value the resolver itself
grades at 0.73 confidence. It now prints `"7:02-7:18 /mi"` — a band centred
on the same 430, widened by the *same* ±8 s/mi tolerance `/api/v5/today`
already set as `cardTolerance` for a threshold/interval work phase
(`route.ts:1447-1449`) and the watch already grades execution against. That
number was not invented for this fix — the provenance trace found it already
travelling on the wire, unused: *"the expanded phase for the work segment
carries `tolerancePaceSPerMi: 8` … i.e. the watch grades against `439 ± 8` …
The phone has that band in hand and prints only the midpoint."* The fix is
routing, not invention: `lib/training/spec-card.ts`'s new `fmtPaceBand()`
reads a work phase's own `tolerancePaceSPerMi` (`web-v2/lib/training/
spec-card.ts:184-207`) instead of discarding it, gated to genuine quality
work (threshold/intervals/tempo) so the 2026-08-31 "easy pace is a ceiling,
not a band" ruling for easy/long running is not re-opened by accident.

This also closes the Rule 16 gap the trace named by name: the phone and the
watch now describe the *same* target for the first time — both read
`workPaceSPerMi`/`tolerancePaceSPerMi` off the identical phase the expander
built, and the card's band is that phase's own tolerance, not a re-derived
one.

## 4. Warm-up, recovery, and cool-down intent — as the runner now reads it

**Warm-up:** *"Start easy. Build into the work over the last quarter mile."*
— unchanged copy, but the pace beside it changed shape: `"≤ 8:22 /mi"`, a
ceiling with an explicit upper-bound glyph, not a flat target. The HR row
beside it, `"<139 bpm (Z1)"`, is the same field it always was. Read together
they now agree instead of fighting: start under both ceilings, let the effort
rise toward the work that follows. (§6 walks the short-lived intermediate
state — `8:43` — where this pass's semantics fix had landed but a separate,
same-day tiebreak bug still fed it a stale anchor; both are fixed as of this
report.)

**Recovery (the 1:00 jog between reps):** *"Honest jog, not standing."* — no
pace shown at all now. It used to print `"9:03 /mi"`, identical to the
warm-up and cool-down by construction. It never had a doctrine reason to
carry an exact number — `Research/04` §5.3's own `recoveryRule` prescribes
the jog's *duration* ("1 min jog per mile of work segment"), never a pace,
and the point of the jog is arriving ready for the next rep, not hitting a
split.

**Cool-down:** *"Easy jog. Part of the workout, not extra mileage."* — the
punitive "it shortens tomorrow" line was already fixed by a prior pass
(`docs/reports/workout-provenance-trace-2026-09-01.md` §15, commit before
this one); untouched here. Pace shows the same `"≤ 8:22 /mi"` ceiling as the
warm-up, for the same reason — cool-down is easy running too.

## 5. Provenance of every distance, duration, pace, range, and HR instruction

| Field | Value | Source | What changed this pass |
|---|---|---|---|
| Warm-up distance | 2.1 mi | `spec-builder.ts` threshold branch, remainder mileage after reps+floats, split evenly — **now an explicitly-documented policy** (`WU_CD-BOUND-1` comment, `spec-builder.ts`), with a **3.0 mi upper sanity bound** (`WU_CD_MAX_MI`, cited to `Research/22` §"Definitions" "WU/CD (1-3 mi E)"). Did not bind on this row (2.1 < 3.0). | Comment + bound added; value unchanged |
| Cool-down distance | 2.1 mi | Same remainder split, symmetric formula | Same bound added |
| Rep count | 4 | `fits()` band-walk, Daniels 10% weekly T share on a 45 mi week | Unchanged (already doctrine-bound) |
| Rep distance | 1 mi | §5.3's own band, single value | Unchanged |
| Rep pace | 430 s/mi (7:10/mi) | `resolveThresholdCapacity`, direct, confidence 0.727 | Unchanged (wiring commit's fix); **display now a band, not a point** |
| Rep recovery duration | 60 s | §5.3 `recoveryRule`, registry-gated | Unchanged |
| Rep recovery pace | *(none)* | Was `easyPaceSec` reused; now explicitly null | **Fixed this pass** — no doctrine source ever priced this pace |
| Rep pass/bail HR | ≤164 / >173 | `round(lthr × 0.975)` / `lthr + 5`, off live `lthr = 168` | Unchanged |
| Warm-up/cool-down HR | ≤139 (Z1) | `hrTargets(profile)` zone 1 | Unchanged |
| Warm-up/cool-down pace | ≤ 8:22/mi (502 s/mi) | Nearest easy-band row's `lo` (fast edge = ceiling, per `docs/PRODUCT_DECISIONS.md` 2026-08-31) | **Fixed this pass** — was the *midpoint* of the same band (543 s/mi, 9:03/mi); now the ceiling. Briefly still stale at 523 s/mi (8:43/mi) due to a separate same-day tiebreak bug (§6, EASYBAND-TIE-1) this pass found and flagged; that bug is also resolved as of this report, landing the final 502 s/mi |
| Rep pace tolerance | ± 8 s/mi | `cardTolerance` in `route.ts`, same width the watch grades against | Unchanged value; **now displayed**, not just wired |

## 6. Identical effective target — phone, watch, and execution grading

**Phone and watch: yes, identical, verified by code path.** `web-v2/app/api/
v5/today/route.ts` and `web-v2/lib/watch/build-workout.ts` run the *same*
`easyBandRow` query, and both were patched this pass to compute an
`easyCeilingSec` (`= Math.round(lo)`) alongside the existing midpoint
anchor, and to pass it into `expandSpecToPhases` as `easyCeilingSec`. Both
surfaces therefore stamp the identical warm-up/cool-down ceiling and the
identical (now absent) recovery-jog pace onto the workout — the same
`ExpandedPhase[]` shape underlies both the phone's `PrescriptionStep[]` and
the watch's `WatchPhase[]`.

**Execution grading: yes, for the rep pace.** `cardTolerance = 8` for
threshold/intervals was already what the watch grades against
(`route.ts:1447-1449`); the card now *shows* that same ±8 band (§3), so a
runner reading "7:02-7:18/mi" on the phone and being graded against exactly
that band on the wrist are now describing one fact, not two.

**One honest exception, found by this verification, not fixed by it:** the
warm-up/cool-down ceiling itself — `523 s/mi` (8:43/mi) — is *not* the
doctrine-fresh value. The nearest-easy-band query that both files share picks
the closer of the two easy/long rows bracketing this workout's date, and on
this specific row the two candidates (2026-08-31 and 2026-09-02) are
**equidistant** (one day each side). The query's `ORDER BY` has no tiebreak
beyond that distance, and it resolves to 2026-08-31's row — which **predates**
the 2026-08-31T21:48 UTC pace recompute — rather than 2026-09-02's, which
carries the fresh ceiling (`502 s/mi`, 8:22/mi, matching the resolver's own
`easyCeilingSecPerMi` in `authored_state.pace_recompute.anchors`).

This is a distinct bug from everything else in this report — it is about
*which row* the shared query resolves to, not about how the resolved value is
displayed, and it predates this pass (it would have produced the same stale
9:03/mi under the *old* midpoint logic too, just further from correct: the
old code would have shown `543 s/mi` = 9:03/mi from the same stale row, this
pass's fix already improves it to `523 s/mi` = 8:43/mi by switching midpoint
→ ceiling, and closing it fully needs the tiebreak fixed). Flagged, not
silently absorbed: a background task (`task_10b63406`, "Fix easy-band
nearest-day tie-break toward freshness") was spawned with the full repro and
citations rather than expanding this pass's scope to include a change to a
query shared by every workout type, every plan, on every day — a change that
size deserved its own falsification pass.

**RESOLVED 2026-09-01, same-day follow-up (EASYBAND-TIE-1).** Both
`easyBandRow` queries (`app/api/v5/today/route.ts`,
`lib/watch/build-workout.ts`) now carry a third `ORDER BY` term —
`(date_iso::date > $2::date) DESC` — that breaks an exact distance tie toward
the future-dated candidate. This is monotone, not a heuristic guess:
`recomputePacesForPlan`/`reanchorActivePlan` only ever rewrite rows with
`date_iso >= "today"` that aren't sealed, so a future-dated row keeps
receiving every later recompute while a past-dated row freezes the moment it
seals or simply passes — a future tie-candidate's band can therefore never be
staler than a past one's. Re-run against the live read-only role on
`pln_9a57561debb776e5`: the query now resolves to 2026-09-02
(`lo=502, hi=542`) instead of 2026-08-31 (`lo=523, hi=563`), so
`wko_eaa8cfd7cb94310b`'s warm-up/cool-down line becomes `≤ 8:22 /mi`
(502 s/mi) — exactly the "if fixed" value predicted above, and matching the
resolver's own `easyCeilingSecPerMi` in `authored_state.pace_recompute.anchors`
as of the 2026-08-31T21:48 UTC recompute. `npx tsc --noEmit` clean and the
418 tests in `app/api/v5`, `lib/watch`, `lib/faff` pass unchanged.

## 7. Which legacy values disappeared

- **The bare `7:10 /mi` point** on the rep target — replaced by the `7:02-
  7:18 /mi` band already implied by the wire's own tolerance.
- **`9:03 /mi` reused identically on warm-up, every jog recovery, and
  cool-down "by construction"** (provenance trace finding #1) — gone. Three
  segments now carry three different treatments: warm-up/cool-down get a
  ceiling, the jog gets nothing.
- **The recovery jog's exact pace target** — gone outright; no doctrine
  source ever priced it.
- **The warm-up's three-way contradiction** (flat pace + "build" language +
  HR cap, provenance trace §14) — gone; the ceiling framing is consistent
  with all three surviving fields.
- **The midpoint-of-a-ceiling-band anti-pattern** — `543 s/mi` (the mean of
  523/563) is no longer shown anywhere on this card; the fast edge is used
  instead, per the settled "easy pace is a ceiling, not a band" product
  decision.
- **The stale easy-band row selection** described in §6 — gone as of
  EASYBAND-TIE-1, same day. `task_10b63406` ("Fix easy-band nearest-day
  tie-break toward freshness") was spawned for this and is now resolved;
  dismissed rather than left open against a closed finding.

**Not touched by this pass, still present, named so the next reader does not
have to re-find them:**

- `restS / 540` — the hardcoded 9:00/mi conversion `spec-builder.ts` still
  uses to convert a rep's rest seconds into mileage for the WU/CD slack
  split (provenance trace §6, "the same fabricated constant `P1-47` removed
  from `expand-spec.ts` in 2026-07-06; it survives here as mileage
  accounting"). It moves the WU/CD split by hundredths of a mile on this row
  and was left alone — out of scope for this pass, which touched the
  *display* semantics of WU/CD, not the mileage-accounting arithmetic that
  decides their size.
- Threshold's own catalogue `selection_rationale` persistence and the
  Coaching Thesis question (provenance trace §1, §9, §11) — a different
  agent's work (`455476c2`, `RATIONALE-PERSIST-1`), landed concurrently with
  this pass, not evaluated here.

## 8. Before / after — the literal rendered card

**Before** (provenance trace §A, reproduced from the original screenshot and
the pre-wiring code):

```
Warmup     2.1 mi   9:03 /mi   HR ≤ 139   "Start easy. Build into the work over the last quarter mile."
Repeat 4×  1 mi     7:19 /mi   HR 164-172 "Same pace on every rep. If the last one slips, the target was too fast."
  recovery 1:00     9:03 /mi              "Honest jog, not standing."
Cooldown   2.1 mi   9:03 /mi   HR ≤ 139   "Easy jog. Do not skip it, it shortens tomorrow."
why:  "Lift the lactate threshold · the engine's ceiling. The pace you could hold for an hour."
```

**After, intermediate** (this pass's semantics fix alone, before
EASYBAND-TIE-1 landed — `easyCeilingSec: 523`, the stale-but-now-correctly-
interpreted-as-a-ceiling anchor described in §6):

```
Warmup     2.1 mi   ≤ 8:43 /mi     HR <139 bpm (Z1)    "Start easy. Build into the work over the last quarter mile."
Repeat 4×  1 mi     7:02-7:18 /mi  HR 164-172 bpm (Z4)  "Same pace on every rep. If the last one slips, the target was too fast."
  recovery 1:00     (by feel)                           "Honest jog, not standing."
Cooldown   2.1 mi   ≤ 8:43 /mi     HR <139 bpm (Z1)    "Easy jog. Part of the workout, not extra mileage."
why:  "Lift the lactate threshold · the engine's ceiling. The pace you could hold for an hour."
```

**After, final** (post EASYBAND-TIE-1 — `cardFromSpec` called directly
against the live row with the corrected tie-break in force, `easyCeilingSec:
502` — this is what the runner actually reads as of this report):

```
Warmup     2.1 mi   ≤ 8:22 /mi     HR <139 bpm (Z1)    "Start easy. Build into the work over the last quarter mile."
Repeat 4×  1 mi     7:02-7:18 /mi  HR 164-172 bpm (Z4)  "Same pace on every rep. If the last one slips, the target was too fast."
  recovery 1:00     (by feel)                           "Honest jog, not standing."
Cooldown   2.1 mi   ≤ 8:22 /mi     HR <139 bpm (Z1)    "Easy jog. Part of the workout, not extra mileage."
why:  "Lift the lactate threshold · the engine's ceiling. The pace you could hold for an hour."
```

Raw output of the final verification call (`cardFromSpec` against
`wko_eaa8cfd7cb94310b`'s real `workout_spec`, `easyPaceSec: 522`,
`easyCeilingSec: 502`, `toleranceSec: 8`, re-run after EASYBAND-TIE-1):

```json
{
  "label": "Warmup",
  "distance_mi": 2.1,
  "pace_target": "≤ 8:22 /mi",
  "hr_target": "<139 bpm (Z1)",
  "note": "Start easy. Build into the work over the last quarter mile."
}
{
  "label": "Repeat 4×",
  "reps": 4,
  "rep_distance_mi": 1,
  "pace_target": "7:02-7:18 /mi",
  "hr_target": "164-172 bpm (Z4)",
  "note": "Same pace on every rep. If the last one slips, the target was too fast.",
  "recovery": { "duration": "1:00", "note": "Honest jog, not standing." }
}
{
  "label": "Cooldown",
  "distance_mi": 2.1,
  "pace_target": "≤ 8:22 /mi",
  "hr_target": "<139 bpm (Z1)",
  "note": "Easy jog. Part of the workout, not extra mileage."
}
```

Note the recovery sub-object carries no `pace_target` key at all — not a
null, an absence, which is what "goes out by feel" means on the wire (same
P1-47 convention the expander already used for a missing easy anchor).

This matches the resolver's own live `easyCeilingSecPerMi` (502 s/mi) in
`authored_state.pace_recompute.anchors` exactly — the display layer and the
capacity layer now agree, which they did not at any point before this pass.

---

## Verification method (Rule 13)

- `cardFromSpec` called directly against the real `plan_workouts` row for
  `wko_eaa8cfd7cb94310b`, read over the read-only DB role, with the real
  `easyBandRow` anchor the live route resolves — not a fixture, not a sample.
  Full output reproduced in §8.
- `npx tsc --noEmit` clean across `web-v2`.
- `npx vitest run` — 3202 tests passing across `lib/training`, `lib/plan`,
  `lib/watch`, `lib/faff`, `app/api/v5` (the trees this change touches); full
  repo run is 7889 passing / 4 pre-existing failures, confirmed pre-existing
  by reproducing them against the pre-change tree via `git stash` (two are
  live-production-data assertions in `_activity_evidence.audit.test.ts` that
  drift as the runner logs new activity; one is `_generated_content_gate`
  flagging a concurrently-landed module from a different agent's commit;
  none touch a file this pass changed).
- Nine tests updated to assert the new, intended behaviour rather than the
  old one this pass deliberately reverses (band vs. point pace, ceiling vs.
  midpoint, no recovery pace) — each updated assertion carries a comment
  explaining what changed and why, so a future reader can tell "test now
  agrees with a new decision" from "test was loosened."
- Two execution-grading functions (`blendedExpectation`,
  `contiguousWorkWindowMi` in `lib/training/goal-projection.ts`) broke when
  the recovery jog's pace went to `null`, because they were silently reusing
  that pace as a distance-equivalent for GPS-split accounting — a real,
  test-caught side effect of the display fix reaching a consumer that needed
  the same phase for a different question. Fixed by giving those two
  functions their own fallback estimate (the same internal constant
  `expandSpecToPhases` already uses to size a by-feel phase's `durationSec`),
  so the *display* answer (no pace shown) and the *accounting* answer (a
  jog covers some distance) no longer have to be the same field.

## Files changed

- `web-v2/lib/plan/spec-builder.ts` — WU/CD remainder-split policy
  documented explicitly; 3.0 mi sanity ceiling added at all five sites that
  derive a warm-up/cool-down as remainder mileage.
- `web-v2/lib/training/expand-spec.ts` — `easyCeilingSec` threaded
  separately from `easyPaceSec`; between-rep/between-step recovery jog no
  longer carries a pace target; `DURATION_EST_S_PER_MI` exported for the one
  legitimate downstream reuse.
- `web-v2/lib/training/spec-card.ts` — `fmtPaceCeiling`/`fmtPaceBand` added;
  warm-up/cool-down render as a ceiling, quality-work reps render as a band,
  the warm-up contradiction resolved.
- `web-v2/app/api/v5/today/route.ts`, `web-v2/lib/watch/build-workout.ts` —
  both compute and pass `easyCeilingSec` (the band's fast edge) alongside
  the existing midpoint anchor, identically.
- `web-v2/lib/training/goal-projection.ts` — execution-grading fallback for
  the now-null recovery pace, described above.
- Tests updated: `web-v2/lib/training/_spec_card.test.ts`,
  `web-v2/lib/training/expand-spec.test.ts`,
  `web-v2/lib/faff/_prerun_card.test.ts`.
