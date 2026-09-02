# Phase 5 · the smallest truthful Coaching Thesis

Branch `p0/thesis`, pushed to `origin/p0/thesis`. Base `origin/main` @ `7cac80f0`
(newer than the required `43e15e88`). **Not merged, main untouched.**

---

## 1 · Commits

| sha | title |
|---|---|
| `c69c8043` | `fix(thesis): the primary limiter stops flipping on an unrelated clock` |
| `bfaf9d9e` | `feat(thesis): wire the Coaching Thesis into Today's "why" and the Block screen` |
| `47182f4f` | `fix(thesis): no \`.catch\` on the thesis resolve, and the Rule 13 renders` |

All three carry the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

Files touched:

```
web-v2/lib/training/coaching-thesis.ts            rewritten
web-v2/lib/training/_coaching_thesis.test.ts      new  (15 tests, Rule 9 walk + falsifier)
web-v2/lib/training/_coaching_thesis.audit.test.ts rewritten (both dates)
web-v2/lib/faff/why-voice.ts                      + thesisLead / thesisSessionName
web-v2/lib/faff/v5-today.ts                       + V5Today.thesis, ctx.thesis
web-v2/app/api/v5/today/route.ts                  thesis resolve + why composition + payload
web-v2/lib/plan/v5-block.ts                       thesis at block level
web-v2/lib/workout-catalogue/select.ts            + rationaleForRow()
web-v2/lib/plan/recompute-paces.ts                rationale write-when-absent only
web-v2/lib/audit/generated-content-registry.ts    MODULE_ORPHANS entry deleted
web-v2/lib/faff/_today_thesis.audit.test.ts       new  (Rule 13 render of the real route)
web-v2/lib/plan/_rationale_backfill.audit.test.ts new  (backfill dry run)
native-v2/.../DesignV5/APIV5.swift                + V5Thesis, V5Today.thesis, V5Block.thesis
native-v2/.../ViewsV5/TodayBeforeV5.swift         About section
native-v2/.../ViewsV5/BlockV5.swift               "Where this goes" section
```

Not touched, as instructed: `lib/race/*`, `race-projection.ts`, `spec-builder.ts`,
`build-workout.ts`, tolerance constants, `capacity-resolver.ts`. `recompute-paces.ts`
is touched only for the rationale write.

---

## 2 · Task A — the ranking fix

### What was wrong

`rankCapacities` normalized each capacity's confidence against its **own reachable
ceiling** before comparing: THRESHOLD/DURABILITY by `directCeiling` 0.90,
HIGH_INTENSITY by `fallbackCeiling` 0.50 (it has no direct reader). So
HIGH_INTENSITY's ranked score was

```
0.4 + 0.6 · 2^(−vdotAnchorAgeDays / 28)
```

— a pure function of the age of the best-recent-VDOT anchor. The limiter flipped
HIGH_INTENSITY → THRESHOLD overnight because a *threshold* run refreshed that anchor.

### What it is now

- `RANKABLE_SOURCE_MODES = ['direct', 'inferred', 'race_derived']`. Anything at
  `vdot_fallback` / `user_prior` / `population_prior` is **UNRANKABLE** with reason
  `NO_DIRECT_READER` and can never be the primary limiter.
- **No normalization of any kind.** Rankable capacities sort ascending on their own
  resolved confidence. A capacity can no longer be promoted toward the limiter slot
  because its reachable ceiling is structurally low.
- `primaryLimiter` may be `'UNKNOWN'`; `confidence` is `number | null`.
- `CapacityStanding`'s unrankable branch carries **no `confidence` field**, so
  `standing.confidence` does not compile until the caller branches — the same
  Rule 11-as-a-type discipline as `NormalReading<T>` / `DurabilityComponent<T>`.
- Durability's sub-reads are **consumed and reported**, not re-derived: the fitted
  race exponent (or `null`, never the prior wearing its name), `POPULATION_ENDURANCE_PRIOR`
  beside it, and the decoupling reading.

### One thing I did NOT do, and why

**No "durability is above/below neutral" verdict.** The task named "the race
exponent's raw value vs the neutral band". Turning `1.0869 vs 1.06` into a
categorical strength/weakness needs a band around the prior, and **no `Research/`
file states one** — `durability-anchor.ts`'s own header describes the finding in
prose ("his races fit closer to ~1.10 than to 1.06") but exports no classifier, and
nothing else in the repo does either. A bare point comparison at 1.06 would be a
fresh Rule 9 cliff; an invented band would be a physiology-asserting constant needing
a Rule 7 registry entry it cannot honestly get. So the numbers are **reported** on the
DURABILITY standing (auditable, consumable) and the verdict is not manufactured.
Stated in the module header and in the test file's Rule 22 block, not hidden.
**This is a decision the coordinator may want to reverse; it is the one place I
departed from a literal reading of the task.**

---

## 3 · The two thesis outputs (read-only, owner's real account)

`npx vitest run lib/training/_coaching_thesis.audit.test.ts`, `DATABASE_URL` pinned
to `$DATABASE_URL_RO`.

```
══ COACHING THESIS · todayISO=2026-08-31 ══
  primaryLimiter=THRESHOLD  basis=LOWEST_CONFIDENCE_AMONG_EVIDENCED
  priority=increase_threshold_demand
  confidence=0.727  evidenceIds=["-280549580846348","-226755616416002","-87627419857791"]
  reasons=[LOWEST_CONFIDENCE_AMONG_EVIDENCED, CAPACITY_UNRANKABLE_NO_DIRECT_READER,
           LIMITER_HAS_DIRECT_EVIDENCE, KEY_SESSION_PRESENT_THIS_WEEK]
  standings:
    THRESHOLD      confidence=0.727 sourceMode=direct
    DURABILITY     confidence=0.900 sourceMode=direct
                     [raceExponent=1.0869051877057179 prior=1.06 decoupling=6.411111111111112]
    HIGH_INTENSITY UNRANKABLE (NO_DIRECT_READER) sourceMode=vdot_fallback
  heldConstant:
    DURABILITY [BETTER_EVIDENCED_THAN_THE_LIMITER] holding steady at confidence 0.90
      (direct), which is ahead of the limiter's
    HIGH_INTENSITY [NOT_LOOKED_AT_NO_DIRECT_READER] no direct, inferred or race-derived
      reader exists for this capacity yet (resolved at vdot_fallback), so it is not
      ranked and is not being called a weakness
  reconsiderIf:
    - [LIMITER_CONFIDENCE_OVERTAKEN] DURABILITY's confidence (currently 0.90) falls
      below THRESHOLD's (currently 0.73)
    - [UNRANKABLE_GAINS_A_DIRECT_READER] HIGH_INTENSITY gains a direct, inferred or
      race-derived reader and becomes rankable (it resolves at vdot_fallback today,
      and the ranking admits nothing below direct/inferred/race_derived)
    - [NEW_RACE_RESULT] a new race result changes any capacity's sourceMode, which can
      both admit a capacity to the ranking and move the confidences already in it
  addressedBy (1 session(s) this week):
    2026-09-01 threshold "4×1 mi @ T pace · 1 min jog" serves=MATCHES_LIMITER_FAMILY
      rationale: (none persisted)
  coachLine: Your durability is the best evidenced part of your training right now,
             so it holds. Threshold is where the work goes.
  modelVersion=2.0.0

══ COACHING THESIS · todayISO=2026-09-01 ══
  primaryLimiter=THRESHOLD  basis=LOWEST_CONFIDENCE_AMONG_EVIDENCED
  priority=increase_threshold_demand
  confidence=0.788  evidenceIds=["-280549580846348","-226755616416002"]
  reasons=[LOWEST_CONFIDENCE_AMONG_EVIDENCED, CAPACITY_UNRANKABLE_NO_DIRECT_READER,
           LIMITER_HAS_DIRECT_EVIDENCE, KEY_SESSION_PRESENT_THIS_WEEK]
  standings:
    THRESHOLD      confidence=0.788 sourceMode=direct
    DURABILITY     confidence=0.900 sourceMode=direct
                     [raceExponent=1.0869051877057179 prior=1.06 decoupling=6.411111111111112]
    HIGH_INTENSITY UNRANKABLE (NO_DIRECT_READER) sourceMode=vdot_fallback
  (heldConstant / reconsiderIf identical apart from the live numbers)
  addressedBy (1 session(s) this week):
    2026-09-01 threshold "4×1 mi @ T pace · 1 min jog" serves=MATCHES_LIMITER_FAMILY
      rationale: (none persisted)
  coachLine: Your durability is the best evidenced part of your training right now,
             so it holds. Threshold is where the work goes.
  modelVersion=2.0.0
```

**The limiter no longer moves overnight**, and the audit test asserts that as its
last line rather than leaving it to a reader.

Note the second-order improvement: the session credited on 08-31 is now the
2026-09-01 threshold session (which *can* produce threshold evidence), not the
09-03 hill reps with `pace_target_s_per_mi = NULL` that appendix E Finding 7 flagged
as structurally unable to evidence the capacity it was credited with.

---

## 4 · The Rule 9 walk

`lib/training/_coaching_thesis.test.ts`, 15 tests, all green.

Walk: hold the owner's real THRESHOLD (0.7268) and DURABILITY (0.90) standings fixed,
move the VDOT anchor age 0 → 30 days in one-day steps, take HIGH_INTENSITY's
confidence from the engine's **own** `fallbackConfidence` (consumed, not re-derived),
and assert the set of limiters seen has exactly one member.

```
distinct limiters across ages 0..30  =  ['THRESHOLD']        ✓
```

**The falsifier** (Rule 18: a gate is a hypothesis until it has been made to fail) is
in the same describe block. It reproduces the deleted basis inline —
`confidence / reachableCeiling` per capacity — and asserts it **does** flip across
the identical walk:

```
distinct limiters, OLD basis, ages 0..30  =  ['HIGH_INTENSITY', 'THRESHOLD']   ✓
```

So the walk cannot go quietly dead: if the old basis ever stops flipping, the
falsifier fails and the file stops claiming something it no longer proves.

Other properties locked in the same file:

- every fallback rung refused / every evidenced rung admitted, as a table;
- a capacity with **higher** confidence on a fallback rung still loses to a lower
  direct one (the exact promotion the normalization used to perform);
- all three unrankable → `UNKNOWN`, `priority = establish_evidence_before_prioritising`,
  and `'confidence' in standing === false` on every standing;
- a durability standing with no personal exponent reports `raceExponent: null`, not
  the prior;
- the coach line carries no em dash, no exclamation mark, no interpunct, ≤ 2 sentences,
  and never mentions a missing engine reader.

---

## 5 · Payload keys added

One shape, `ThesisWire`, emitted under `thesis` by **both** routes, so the two
surfaces cannot disagree (Rule 16):

| key | type | notes |
|---|---|---|
| `thesis` | object \| null | on `V5Today` and on `V5Block` |
| `thesis.limiter` | `'THRESHOLD' \| 'HIGH_INTENSITY' \| 'DURABILITY' \| 'UNKNOWN'` | |
| `thesis.priority` | `increase_threshold_demand` etc. | |
| `thesis.confidence` | number \| null | quantity, never a sentence |
| `thesis.coachLine` | string | THE composed sentence set |
| `thesis.reviewTrigger` | string | §F's review trigger, coach voice |

Five keys and no more. `standings`, `evidenceIds`, `heldConstant[].note` and the
structured `reconsiderIf[]` stay on the server's `CoachingThesis` — they are how the
sentence was arrived at, not something a runner acts on
(`PRODUCT_UX_SIMPLIFICATION_DOCTRINE`).

**Phone decoder** (`APIV5.swift`): `struct V5Thesis` with an explicit
`enum K: String, CodingKey { case coachLine, reviewTrigger }` — spelled out rather
than left to synthesis so `check-wire-keys.sh` can see the keys at all (its extractor
only reads `enum K` blocks; a synthesised conformance is invisible to it, which is the
green-light-over-an-unwatched-road failure that script's own header describes).
`V5Today.thesis` and `V5Block.thesis` added to their `enum K`s and decoded leniently.

`scripts/check-wire-keys.sh`: **OK · 107 phone keys** (was 104), all resolve in web-v2.

**Rendering, and Rule 17.** The phone decodes only the two fields it draws — no
decorative property. On Today the About section draws `why` **or** `thesis.coachLine`,
never both (they are alternatives: the route composes `why` out of this very thesis).
`reviewTrigger` is drawn **only on Block**, because it is a statement about the block
and Rule 17 is explicit that a sentence which would otherwise repeat per row belongs
to the block.

---

## 6 · Task C — the rendered "why" copy

Rendered by driving the **real** `GET /api/v5/today` handler against the owner's real
rows over the read-only role (`lib/faff/_today_thesis.audit.test.ts`; only
`requireUserId` is stubbed, and the file says so in its header).

```
══ GET /api/v5/today?date=2026-09-03 ══  status=200
  panel.type  = Intervals        panel.dose = 6.5 mi
  WHY         = "Threshold is the limiter right now, so that is what the block is
                 building toward. Medium hill repeats."
  thesis      = { limiter: THRESHOLD, priority: increase_threshold_demand,
                  confidence: 0.7833333333333334,
                  coachLine: "Your durability is the best evidenced part of your
                              training right now, so it holds. Threshold is where
                              the work goes.",
                  reviewTrigger: "This gets revisited when a new race result lands,
                                  or when the evidence behind your threshold catches
                                  up with the rest." }

══ GET /api/v5/today?date=2026-09-08 ══  status=200
  panel.type  = Tempo            panel.dose = 6.2 mi
  WHY         = "Threshold is the limiter right now, and this is the session that
                 moves it. Continuous tempo."
  thesis      = { limiter: THRESHOLD, priority: increase_threshold_demand,
                  confidence: 0.7550244157414201, coachLine: <as above>,
                  reviewTrigger: <as above> }
```

The two sentences differ in exactly the honest place: the hills day **does not**
address the limiter and does not claim to; the tempo day does. That distinction comes
from `thesis.addressedBy`, not from the day's type.

The body (`Medium hill repeats.` / `Continuous tempo.`) is currently the day's own
note, because `selection_rationale` is absent on all 103 live rows. Once the Phase 6
recompute lands, the same words arrive through `coachSafeSessionName` off the row's
persisted rationale instead — same text, selector provenance.

### Simulator render (Rule 13, done)

Built the `Faff` scheme (`BUILD SUCCEEDED`, 0 errors), pointed a throwaway build at a
local `next dev` running this branch against the read-only role, installed on the
booted iPhone 17 sim, and read the screen. **The temporary `API.baseURL` patch was
reverted and is not in any commit; the simulator's original app bundle was backed up
before install and restored afterwards.**

`today-0903-about.png` — Today, 2026-09-03, ABOUT section:

> **Threshold is the limiter right now, so that is what the block is building
> toward. Medium hill repeats.**

`block-thesis.png` — Block, "WHERE THIS GOES":

> This is where the fitness gets built. Hit the quality sessions, let the easy days
> stay easy.
>
> **Your durability is the best evidenced part of your training right now, so it
> holds. Threshold is where the work goes.**
>
> *This gets revisited when a new race result lands, or when the evidence behind your
> threshold catches up with the rest.*

Two distinct claims (where in the block / what the block is moving), no repetition,
no new card, no new screen.

Screenshots at `…/scratchpad/p0/today-0903-about.png` and `…/scratchpad/p0/block-thesis.png`.

**2026-09-08 was not rendered on the device**: the training-calendar sheet does not
make next week's rows tappable, and the week strip only covers the current week, so
there is no path to it in the UI. Its payload is above, and the 09-03 render proves
the About section draws `why` verbatim — but the 09-08 *screen* was not looked at.

---

## 7 · Task D — the `selection_rationale` backfill (NOT run against production)

`preserveProgressionSql` **does** preserve `selection_rationale` already (RATIONALE-
PERSIST-1 widened its fold to `DURABLE_SPEC_KEYS`) — confirmed, and
`_progression_spec.test.ts` 8/8 still green. What it cannot do is *create* one, and
`buildWorkoutSpec` knows nothing about the catalogue, so a recompute could not
regenerate it.

`rationaleForRow(row)` (`lib/workout-catalogue/select.ts`) recomposes the identifying
half of the selector's own line from what the row carries: the catalogue entry's name
is written verbatim into `plan_workouts.notes` by the same selection, so the entry is
resolved by name and the line is rebuilt in the same shape and word order —
**minus** the `"N session(s) eligible, least recently used wins"` clause, which
existed only inside the call that made the choice and is not recoverable. It is
omitted, never guessed. `null` (not a partial guess) on a day the catalogue did not
fill.

`recompute-paces.ts` writes it **only when absent** — a stored rationale is the
selector's own record of a real choice and outranks anything recomposed after the
fact — and stamps `rationales_written` into `authored_state.pace_recompute` so the
effect is observable (Rule 21).

**Dry run on the live block** (`lib/plan/_rationale_backfill.audit.test.ts`,
read-only, writes nothing):

```
rows=103   already carry one=0   would be written=13   correctly refused=90

  2026-09-01 threshold  Cruise intervals (§5.3) · threshold on the threshold slot in QUALITY.
  2026-09-03 intervals  Medium hill repeats (§8.3) · hills on the intervals slot in QUALITY.
  2026-09-08 tempo      Continuous tempo (§5.2) · threshold on the tempo slot in QUALITY.
  2026-09-17 intervals  Long hill repeats (§8.4) · hills on the intervals slot in QUALITY.
  2026-09-22 tempo      Continuous mile cutdowns (§12.5) · cutdown on the tempo slot in QUALITY.
  2026-09-29 threshold  Sub-threshold / Norwegian intervals (§5.4) · threshold on the threshold slot in QUALITY.
  2026-10-01 intervals  800m repeats (§6.4) · vo2max on the intervals slot in QUALITY.
  2026-10-08 intervals  1K cutdowns (§12.3) · cutdown on the intervals slot in QUALITY.
  2026-10-13 threshold  Sub-threshold / Norwegian intervals (§5.4) · threshold on the threshold slot in QUALITY.
  2026-10-15 intervals  Mona fartlek (§9.2) · fartlek on the intervals slot in QUALITY.
  2026-10-20 threshold  Cruise intervals (§5.3) · threshold on the threshold slot in RACE-SPECIFIC.
  2026-10-27 tempo      Continuous mile cutdowns (§12.5) · cutdown on the tempo slot in RACE-SPECIFIC.
  (13th row not printed by the sample cap)
```

The 90 refusals are the easy / long / rest / shakeout days the catalogue never filled.
That is the right answer, not a gap.

### The command for the coordinator to run in Phase 6

This is a production data write. **I did not run it.** It goes through the normal
recompute path, unchanged in every other respect:

```bash
# from web-v2/, with the WRITE DATABASE_URL (not the RO role)
npx tsx -e "
  import('@/lib/plan/recompute-paces').then(async (m) => {
    const r = await m.recomputePacesForPlan(
      'pln_9a57561debb776e5',
      { source: 'rationale_backfill_2026-09-01' },
    );
    console.log(JSON.stringify(r, null, 2));
  });
"
```

Or, if a route is preferred, whatever admin entry point already invokes
`recomputePacesForPlan` for this plan — the write is a side effect of the normal
recompute and needs no separate backfill endpoint.

Expected: `workouts_updated` in the tens, `rationales_written: 13`. Sealed rows
(those with a logged run on the day) and `RECOMPUTE_EXEMPT_TYPES` are skipped by the
existing filters, so a handful of the 13 may be skipped if they seal before it runs.
Verify afterwards with:

```sql
SELECT count(*) FILTER (WHERE workout_spec ? 'selection_rationale') AS with_rationale,
       count(*) AS total
  FROM plan_workouts WHERE plan_id = 'pln_9a57561debb776e5';
```

---

## 8 · Task E — deletions

- `normalizedConfidence`, `HIGH_INTENSITY_REACHABLE_CEILING`,
  `DIRECT_REACHABLE_CEILING`, `clamp01`, `CapacityRanking`, `PrimaryLimiterBasis`
  — all gone with the normalization.
- `noteFor()` — replaced by `heldConstantFor()`, which is reason-coded.
- The `establish_threshold_evidence` / `establish_durability_evidence` /
  `establish_high_intensity_evidence` priorities — **unreachable** once a limiter must
  have direct/inferred/race-derived evidence, so deleted (Rule 26). The unevidenced
  case is now `UNKNOWN` + `establish_evidence_before_prioritising`.
  `increase_high_intensity_demand` is now a legitimate branch, because HIGH_INTENSITY
  can only reach `priorityFor` once it has the evidence that posture needs.
- The `MODULE_ORPHANS` entry for `coaching-thesis.ts` — deleted; the gate's staleness
  check would have failed until it was.
- The old audit test's assertions that pinned the ranking to `ranking[0]` /
  `normalizedConfidence` ordering — rewritten to the standings contract.

No test that pinned the flipping behaviour survived; the flipping is now asserted only
inside the falsifier, against a locally reconstructed copy of the deleted basis.

---

## 9 · Verification

| check | result |
|---|---|
| `npx tsc --noEmit` | clean, after every commit |
| `lib/training/_coaching_thesis.test.ts` | 15/15 |
| `lib/training/_coaching_thesis.audit.test.ts` | 1/1 (both dates) |
| `lib/faff/_today_thesis.audit.test.ts` | 1/1 (real route, both dates) |
| `lib/plan/_rationale_backfill.audit.test.ts` | 1/1 |
| `lib/faff/_why_voice.test.ts`, `_surface_sweep.test.ts` | unchanged, green |
| `lib/plan/_progression_spec.test.ts`, `_rationale_persist.test.ts` | unchanged, green |
| `lib/audit/_generated_content_gate.test.ts` | green after the orphan deletion |
| **full `npx vitest run`** (RO env) | **1 failed file / 2 failed tests — identical to the `main` baseline** (`lib/evidence/_activity_evidence.audit.test.ts`, pre-existing; `main`'s own run: 1 failed file / 2 failed tests). 390 files / 7989 tests passing, up from 387 / 7972. |
| **all 17 prebuild gates** | **exit 0.** palette · spacing · modelled-mark · coach-voice (189 files) · doctrine (323 citations) · wire-keys (107 phone keys) · generated-content · surface-sweep · xcodeproj-sync (214/214) · swallowed-failure · derived-consistency · automatic-mutations · normal-window · goal-immutability · anchor-derivation · client-graph · coercion (peripheral baseline 181, unchanged) |
| `npx next build` | exit 0 |
| `xcodebuild -scheme Faff` (sim) | `** BUILD SUCCEEDED **`, 0 errors |
| watch gate (pre-push hook) | OK · 195 test cases, 20 boards |
| push | `origin/p0/thesis` created, no `--no-verify` needed |

### Gates falsified (Rule 18)

- **The Rule 9 walk** — falsified by reconstructing the deleted basis inline and
  asserting it flips across the same walk. Green on the fix, and it names the old
  behaviour rather than merely asserting the new one.
- **`_coercion_scan`** — it caught my first draft, correctly, and I removed the two
  `.catch(() => null)` sites rather than arguing them into the registry. That is a
  gate failing on new work and being obeyed, which is the falsification this rule asks
  for.
- **`check-wire-keys`** — the phone key count moved 104 → 107, so the extractor
  demonstrably saw the new keys rather than reporting clean over nothing.

---

## 10 · What is NOT verified, and open questions

1. **No durability direction verdict.** §3 above. If the coordinator wants
   "durability is above/below neutral" as a real signal, it needs a band with a
   `Research/` citation and a Rule 7 registry entry, and that is a decision, not an
   implementation detail.

2. **2026-09-08 was not rendered on the device.** Payload verified, screen not.
   The UI offers no path to next week's day detail.

3. **The route render stubs `requireUserId`.** Everything below the auth line runs
   for real; a break in authentication on `/api/v5/today` would not show up in a green
   run of that file. Named in its own header.

4. **The backfill has not run.** 13 rows would gain a rationale on the live block; the
   command is in §7. Until it does, every Today "why" body comes from
   `plan_workouts.notes` rather than from the selector's own record — same words on
   these rows, weaker provenance.

5. **`resolveCoachingThesis` now runs on every `/api/v5/today` and `/api/v5/block`
   request.** It resolves three capacities plus settings plus one plan query. On the
   local dev server the first (cold, uncached) `/api/v5/today` took 14 s and the
   second 9 s; that is `next dev` compile time dominating, and the whole route was
   already doing far more DB work than the thesis adds, but **I did not measure the
   added latency in isolation** and the route memo (`withRequestMemo`) does not cover
   the capacity resolvers. Worth a look if Today feels slower in TestFlight.

6. **`.catch` removal is a behaviour change on two live routes.** If
   `resolveCoachingThesis` throws for some runner shape I have not exercised, Today
   and Block now return the data-outage screen instead of drawing without a strategy.
   I argued that is correct (the resolver reads the same DB the routes already read
   uncaught, so a throw means the request was failing anyway), but only the owner's
   account was exercised end to end.

7. **HIGH_INTENSITY is unrankable for every runner today**, by construction, because
   `resolveHighIntensityCapacity` has no direct rung at all. That is the honest state,
   not a bug in this change — but it means the thesis currently ranks two capacities,
   not three, and the app cannot name speed as a limiter until that reader exists. The
   `reconsiderIf` trigger says so as a concrete condition, and the module header states
   it as the first thing this file cannot catch.

8. **Rule 19.** The branch is pushed but **not merged and not deployed**. Nothing here
   is live.
