# Workout selection — external review

**Scope.** Not the block architecture (volume/phase/timing over a 14-16 week
build — that is a separate report). This one answers a narrower question:
**within a given week, how does the app decide which specific workout goes on
which day, what that workout actually is, and why?** Everything below was
read from the live repository on `main` on 2026-08-31, and the worked example
in §7 was pulled from the owner's own active plan in the production database
(read-only role) on the same date.

---

## Executive summary

Workout selection is more coherent than a typical "collection of heuristics"
codebase, and considerably more coherent than its own history — the module
headers document, in detail, three separate doctrine-cited-but-unreachable
defects found and fixed by a purpose-built reachability sweep
(`lib/workout-catalogue/_reachability.test.ts`) in the last few days. There is
a real selection algorithm (`lib/workout-catalogue/select.ts`), it is bound to
a 59-entry catalogue transcribed from `Research/04-workout-vocabulary.md` with
every number carrying a citation, its citations are checked against the live
document text at CI time rather than hardcoded, and a live production plan
traces cleanly through it end to end (§7).

But it is not fully coherent, and the gaps are not cosmetic:

1. **Two selection mechanisms coexist**, not one. Named doctrine workouts
   (hills, fartlek, cutdowns, race-specific sessions, most of threshold and
   VO2max) go through the catalogue selector. The two *generic* quality slots
   — an unnamed "threshold" and an unnamed "intervals" session that doctrine
   gives no name to — go through a second, structurally different system (`lib/
   prescription/trajectory.ts`, the `OverloadTrajectory`) that grows a shape
   week over week rather than selecting an identity. They are joined at one
   seam (§3) that is well-documented but genuinely intricate, and the join is
   itself a recent fix (`SLOT-ROTATE-2`) for a defect where the trajectory's
   earned dose and the catalogue's chosen identity used to disagree.

2. **Pace Prescription, as the Brain Constitution defines it, is not yet the
   live authority for workout pace.** `lib/training/prescription-resolver.ts`
   exists, is described in the Constitution as built "tonight, shadow mode,"
   and is imported into the plan-generation path **type-only** — every runtime
   pace anchor a workout parameter is built from still comes from
   `resolveCurrentTPace`/`vdot.ts` and `blendedTPaceForWeek`
   (`lib/plan/recompute-paces.ts`). This is not a bug — the module's own
   header says "shadow mode" — but it means the Constitution's row `"How hard
   should this workout be? → Pace Prescription"` does not yet describe the
   live plan-generation code path, and that gap should be named explicitly
   rather than assumed closed because the module exists.

3. **"Why this workout" is a real, gated decision internally, and a thin
   label externally.** Every catalogue pick carries a `rationale` string
   ("N session(s) eligible, least recently used wins") computed at selection
   time — but it is discarded before it reaches the runner. What the runner
   actually gets, verified against a live row (§7), is `catalogueNote`: the
   workout's name, its doctrine citation, and one generic per-*family* purpose
   sentence ("Run the climb by effort, not pace"). There is no persisted
   answer to Brief 04's own test — "why this week, why for this runner" — and
   no Coaching Thesis layer exists anywhere in the repo to hold one. This
   confirms, independently, the same finding other audits made tonight: the
   `CoachingThesis` type the Brain Constitution names does not exist as code.

4. **Evidence-coverage awareness is confirmed absent from workout selection**,
   exactly as `docs/design/plan-evidence-coverage-2026-08-31.md` says it should
   be at this stage — this was checked against the actual selector rather than
   assumed from the design doc's own framing (§6).

Overall verdict: workout **identity** selection (which named session, which
day) is a genuinely well-built, doctrine-gated, tested system — the strongest
part of the plan engine examined for this report. Workout **parameter**
setting (the actual pace, and the pace *mechanism* specifically) is architecturally
split across a legacy-but-live path and a newer-but-shadow path, and the
"why" that would let a runner or a reviewer interrogate a specific
prescription is computed and then thrown away before it is persisted.

---

## 1. The workout library — what a workout definition actually contains

Two catalogues exist, not one, and they are not peers — one is primary and
one is a fallback the header explicitly documents as demoted:

**Primary: `web-v2/lib/workout-catalogue/` (`catalogue.ts` + `types.ts` +
`select.ts`).** 59 entries transcribed from `Research/04-workout-vocabulary.md`
(18 sections; `_catalogue.test.ts` walks the doc's own §18 index and fails if
any named workout has no entry). The real shape of a `CatalogueEntry`
(`lib/workout-catalogue/types.ts:230-302`) is close to, but not identical to,
the doctrine brief's proposed `Workout { training_goal, structure,
expected_stimulus, evidence_opportunities[] }` shape:

```ts
export interface CatalogueEntry {
  slug: string;
  name: string;
  section: string;          // e.g. "§8.3", resolvable in the doc's headings
  family: WorkoutFamily;
  zones: PaceZone[];        // the WORK segments' pace zones, in run order
  effortOnly: boolean;      // true where the doc prescribes effort, never a clock pace
  structures: Structure[];  // reps | continuous | sequence | alternation | double
  atPace: Band | null;
  session: Band | null;
  warmupCooldownMi: Band | null;
  cadence: Cadence | null;
  perCycleMax?: number;
  distances: DistCategory[];
  phases: DoctrinePhase[];
  tiers: Tier[];
  cites: string[];          // verbatim-ish quotes of the doc rows the numbers came from
  conventions?: string[];   // anything the module supplies that the doc does not state
}
```

There is no `training_goal` field and no `evidence_opportunities[]` field —
the brief's proposed evidence-mapping layer (§ below, and confirmed in §6) is
genuinely not built. What the real entry has instead of "expected stimulus"
is `family` + `zones` + the one-line `FAMILY_NOTES` purpose string kept
separately in `generate.ts` (§5). A real entry, verbatim
(`lib/workout-catalogue/catalogue.ts:1190-1211`):

```ts
{
  slug: 'medium-hill-repeats',
  name: 'Medium hill repeats',
  section: '§8.3',
  family: 'hills',
  zones: ['5K', '10K'],
  effortOnly: true,
  structures: [
    { kind: 'reps', reps: r(6, 10), rep: b(60, 90, 's'), recoverySec: r(120, 180),
      recoveryRule: '2–3 min jog down' },
  ],
  cadence: null,
  distances: ALL,
  phases: ['base', 'hill_strength', 'specific_support'],
  tiers: EVERYONE,
  cites: [
    '| Medium hill repeats | 60–90 s | 4–6% | 5K–10K effort | 6–10 | 2–3 min jog down |',
    'Purpose | Aerobic + strength stimulus; bridges short hills and long hills',
    'When in cycle | Late base, early specific',
  ],
}
```

Note the doc's own **bands are kept as bands** ("6-10 reps", "60-90s"), not
collapsed to a single number — collapsing that decision to the selector
(§2) is a deliberate design choice stated in the module header, and is the
right call given Rule 9 (a hair's-width input change must not produce a
categorically different plan): the selector picks a point *inside* the band
based on the week's earned dose, rather than the catalogue author picking one
arbitrarily.

**Secondary/fallback: `web-v2/lib/plan/workout-library-static.ts`.** 54 rows,
a simpler `WorkoutTemplate` shape (one fixed `prescriptionText` string per
row, no bands, no `evidence_opportunities`). Its own header is explicit about
its demoted status: it is the retired `workout_library` DB table's rows,
transcribed into code, and its three listed consumers are `resolvePrescriptions`'s
**fallback strings**, the v5 Block screen's library browser, and the
`/workouts` page. It is not where identity selection happens; it is what a
slot falls back to when the primary catalogue declines it and the family has
no catalogue member at all — a genuinely secondary role, correctly documented
as such, not a second source of truth for selection *authority* (Brain
Constitution §5's "one question, one resolver" is honored here: this table is
never itself asked "what should today be," only "what string do I show if
nothing else answered").

## 2. Selection logic — how the Plan Generator picks from the library

**This is the strongest part of the system.** `lib/workout-catalogue/select.ts`'s
`selectWorkout()` is a real, self-contained algorithm, not scattered
heuristics, and it correctly sits where the Brain Constitution's §O says it
should — it is called by the Plan Generator (`generate.ts` via
`lib/plan/catalogue-rx.ts`), and the catalogue itself carries no selection
logic (no workout entry decides when it applies; it only declares the facts
`selectWorkout` filters on). Concretely, for a given day, the decision walks:

1. **Eligibility** — phase (`entry.phases.includes(phase)`, off `Research/04`
   §15's placement table), distance category, experience tier, per-cycle cap
   (`perCycleMax`), cadence (`entry.cadence`, "run N weeks ago; wait M more"),
   and pace-anchor availability (an entry whose zone the composer cannot
   honestly anchor is declined rather than paced by inference —
   `lib/plan/catalogue-rx.ts:160-196`).
2. **Affordability** — Daniels' at-pace share caps (T ≤10%, I ≤8%, R ≤5% of
   weekly mileage — `AT_PACE_WEEKLY_SHARE_CAP`), checked against the
   structure's own stated *minimum* dose, not the share cap's minimum. When
   the cheapest legal form of every eligible session still breaches the
   week's share, the selector **refuses** rather than degrading a workout
   below the shape that makes it that workout — a documented, deliberate
   design decision (`select.ts:18-36`), and the refusal path is itself tested.
3. **§16 combination rules** — five doctrine-cited "do not pair" predicates
   (VO2max + long run within 48h, MP long + hard tempo within 5 days, two
   threshold sessions back-to-back except the Norwegian double-day exception,
   fast-finish long run inside the taper, R-pace day before threshold) checked
   against everything already placed in the week.
4. **Rotation** — least-recently-used among the remaining eligible
   candidates, broken by a fixed per-slot rotating offset
   (`chooseIndex`/`rankCandidates`). Deterministic by construction: no clock,
   no random number, so a plan regenerates byte-identically — a hard
   requirement stated in the module header and independently a house
   invariant (`_sweep_allusers.test.ts` and siblings depend on it).

Selection is genuinely concentrated in one place. `generate.ts` supplies the
*inputs* (phase, distance, tier, week index, weekly mileage, pace anchors,
what has already been placed this week, what has recently run) through
`lib/plan/catalogue-rx.ts`'s `selectSlotWorkout()`, and consumes the *output*
(a `CatalogueEntry` + a `Dose`) without re-deciding anything. `qualityFamilyFor()`
in `generate.ts` (lines 3502-3614) states which *family* — not which specific
workout — belongs on a given slot in a given phase, quoting the doctrine row
it is enforcing in a comment beside it (e.g. "the mid-block speed slot is the
dedicated R day (Research/22 advanced sample weeks)"); this is a defensible
placement ruling one layer above identity selection, not a second selector —
and it is exactly what the doctrine gate's `VOCAB.phase-placement` claim
checks it against.

The one real crack: `qualityFamilyFor` occasionally hands the catalogue a
family with **no catalogue row and no `rx.families` fallback row** for
certain (family, phase) combinations — the module's own comment calls these
"doors, not prescriptions" (`generate.ts:3600`) — and when that happens the
slot silently falls through to §3's generic trajectory-driven session. That
fallback is intentional and documented, but it means "which mechanism decided
today's threshold session" is not always answerable from the family name
alone; you have to know whether the catalogue actually had a candidate that
week.

## 3. Workout parameters — how the numbers get set once the type is chosen

Two genuinely different mechanisms exist, and they hand off to each other in
a way that is well-documented but non-obvious:

**A. The catalogue's own `fits()` function** (`select.ts:604-847`) picks a
dose *inside* the doctrine band the entry declares — how many reps, how long
each rep is, how much recovery — bounded by (a) what the week's Daniels share
can afford, and (b) `SelectorInput.targetAtPaceMinutes`, described in its own
comment as "the block's earned dose, in at-pace minutes" (§C below). Reps come
off before rep length shortens, and never below the structure's own doctrine
floor — e.g. a VO2max session cannot be cut to fewer than 3 reps because "§6.1's
overview table states no VO2max row with fewer" (`trajectory.ts:342`, cross-
checked against `_select.test.ts`).

**B. `lib/prescription/trajectory.ts`'s `OverloadTrajectory`** owns the two
*generic, unnamed* quality slots — the plain "threshold" and "intervals"
sessions doctrine gives no name to (`rx.threshold` / `rx.intervals`). This is
a genuinely different mechanism from (A): instead of picking an identity from
a catalogue, it *grows a shape week over week*, using a lever ladder
(`selectLever`/`advanceShape` in `lib/prescription/levers.ts`) that walks
duration → density → (last) pace, per session family:

```ts
export const SESSION_LADDER: Record<SessionFamily, readonly ProgressionLever[]> = {
  threshold: LIMITER_LEVERS.threshold,
  interval:  LIMITER_LEVERS.speed_reserve,
  repetition: ['rep_count', 'interval_duration', 'pace'],
};
```

This is the module in the codebase that most directly implements
`ADAPTATION_PROGRESSION_DOCTRINE.md`'s "four separate questions, not one
progression score" — reps, rep duration, and recovery are separately
steppable, pace is deliberately gated last and only reachable at a `strong`
adaptation band, and a deload week holds the shape rather than stepping it
(doctrine's W4). At authoring time (no execution evidence yet) the trajectory
asks the real adaptation model with every input null and gets back `normal`
— "progress as planned" — rather than hand-writing that verdict, so if the
model's honest-abstain behavior changes, authoring changes with it. **After**
a session is actually run, `lib/plan/progression-gate.ts`'s
`resolveProgressionStep()` is the second half: it reads the *previous
persisted shape* (not a recomputed default) and the adaptation verdict, and
returns TAKE / ACCELERATE / HOLD / BACK_OFF — explicitly never touching pace
("Pace is never touched; see the module header" — `progression-gate.ts:184`),
consistent with the doctrine brief's instruction that duration/density
progress from *load tolerance*, not from a capacity re-estimate.

**C. The seam between A and B, and why it exists.** Until `SLOT-ROTATE-2`
(recent, per the code's own changelog comments), the catalogue spent the
*whole* weekly share on every pick — so a block opened at the same at-pace
volume in week 1 as week 6, flattening the progression the trajectory was
supposed to own. The fix: the trajectory steps *first*, unconditionally, for
every quality track in the week; its `totalWorkMinutes(step.shape)` — the
dose the block has *earned* — is then passed into the catalogue selector as
a **sizing ceiling only, never an eligibility test**
(`generate.ts:5845-5872`, `select.ts:402-429`). This is a genuinely well-reasoned
join — the catalogue still offers everything doctrine places on the slot at
the full share the week could afford; it just sizes *inside* the band toward
what the trajectory says has been earned so far. But it means the honest
answer to "what set this rep count" is frequently "both mechanisms, in
series" rather than either one alone, and a reviewer has to hold both models
simultaneously to explain a single number.

**D. Pace itself is neither A nor B's decision — and its actual source is a
gap.** Both mechanisms consume a pace anchor (`tPaceSec`/`iPaceSec`/`mpPaceSec`)
rather than deriving one. Tracing where `generate.ts` gets `weekTPaceSec`
(the value both A and B are handed): `blendedTPaceForWeek()`
(`lib/plan/recompute-paces.ts`), seeded from `resolveCurrentTPace()`
(`lib/training/vdot.ts`) — **not** from `lib/training/prescription-resolver.ts`,
the module the Brain Constitution names as the canonical Pace Prescription
owner ("Built tonight, shadow mode"). Checked directly: `prescription-resolver`
is imported into `lib/plan/spec-builder.ts` and `lib/plan/recompute-paces.ts`
**type-only** (`import type { PrescribedPaceAnchors } from
'@/lib/training/prescription-resolver'`) — no runtime call. It is genuinely
wired at runtime elsewhere (`lib/adaptation/adaptation-engine.ts`,
`lib/training/runner-state.ts`), just not into the plan-generation pace path.
This is not a defect exactly — "shadow mode" is the module's own stated
status — but it means Brief 03's routing rules ("threshold pace primarily from
Threshold Capacity," "VDOT remains useful as fallback... not the central
authority") describe a state the *plan-generation* code has not yet reached.
Workout parameter *pace* is still, today, on the VDOT-cascade path Doctrine
Enforcement's own language calls out for eventual deletion.

## 4. Doctrine citations behind specific workout choices

This is genuinely, verifiably live-checked, not decorative. Every number in
the catalogue traces to a `cites` quote, and the doctrine gate reads the
*actual current text* of `Research/04-workout-vocabulary.md` at check time
rather than hardcoding both sides. Concrete example, `VOCAB.threshold-family`
(`lib/doctrine/registry.ts:12564-12626`):

```ts
{
  id: 'VOCAB.threshold-family',
  binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
  doc: 'Research/04-workout-vocabulary.md',
  anchor: '### 5.1 Threshold family overview',
  claim: 'The four threshold sessions carry the rep counts, rep distances and ' +
    'at-pace volumes §5.1 states for them, and cruise-interval recovery runs ' +
    'one minute per mile of work.',
  check({ cite }) {
    const t = cite.table();
    const volumeCell = t.cell('Cruise intervals (Daniels)', 'Volume');
    const shapes = [...volumeCell.matchAll(/(\d+)[–-](\d+)\s*×\s*(\d+)\s*mi/g)];
    // ... parses the LIVE table cell and asserts the catalogue entry's own
    // reps/rep-length/recovery band equals what the doc's own row currently says
  },
}
```

The registry (`lib/doctrine/registry.ts`) carries a dozen-plus `VOCAB.*`
claims covering the threshold, VO2max, speed, hill, fartlek, cutdown, ladder,
long-run and race-specific families, plus `VOCAB.phase-placement` (§15's
placement table), `VOCAB.catalogue-anchors` (which pace zones may legally be
anchored — see §3.D's own concern about a zone the spec builder cannot pace),
and `VOCAB.catalogue-covers-the-index` (every §18-indexed workout has an
entry). This satisfies Rule 7 ("a constant that asserts physiology carries a
registry entry") at a density well above most of the rest of the codebase.

Rule 15/18 compliance is also directly demonstrated, not assumed:
`_reachability.test.ts`'s own header documents three real defects it found —
the Canova block (`double` structure, no renderer, declined on every pass
since written), the hill fartlek and Lydiard fartlek (both base-phase
entries, admitted by phase but refused by the renderer, so "§15's own base
row" was silently unenforceable for them), and the Lydiard hill circuit
(dosed to zero work in both currencies, so eligible-but-worthless). All three
are exactly Rule 18's target class — doctrine-cited, gated, and structurally
unreachable, passing every phase/distance/tier check while never once being
prescribable — and all three are now fixed, per the header's own account, with
the reachability sweep as the falsifying gate that would catch a fourth.

## 5. "Why this workout" — is it explainable today?

Partially, and the split is worth being precise about, because it is the
report's most important finding.

**Internally, the reasoning is genuinely rich.** Every `selectWorkout()` call
returns a `rationale` string naming the workout, its section, its family, the
slot, the phase, and how many eligible candidates competed for the slot
("N session(s) eligible, least recently used wins" — `select.ts:1248-1250`).
Every `Rejection` in the same result carries a `reason` and human-readable
`detail` for every candidate that was *not* chosen and why (phase mismatch,
no anchor, doesn't fit the week's share, cadence not elapsed, per-cycle cap
hit, §16 combination clash). This is close to Rule 21's "every adaptation
writes what it did, in which direction, and on what evidence" standard,
applied to selection rather than adaptation.

**Externally, almost none of that reaches the runner or the row.** Tracing
`generate.ts:5963-5978`, the composer keeps `choice.entry`, `choice.dose`, and
`choice.note` (`catalogueNote` — a one-line name + citation + generic family
purpose sentence), and **explicitly discards `choice.rationale`** — it is
computed, returned by `selectSlotWorkout`, and never assigned to anything the
composer keeps. Verified against a live row (§7): `plan_workouts.notes` for
the owner's 2026-09-03 hill session reads `"Medium hill repeats · Research/04
§8.3. Run the climb by effort, not pace. Jog down, full recovery, repeat."` —
which answers "what is this workout" and "what family is it for," never "why
this workout, this week, for this runner" in Brief 04's sense (why this
session and not the fartlek that was also eligible; why this week and not
last week; what evidence or limiter made this the pick over the alternatives
the `rejected` trail actually names).

**No Coaching Thesis layer exists to hold that answer even if it were kept.**
Searched the full `lib/` tree for `CoachingThesis` or `coaching-thesis`: zero
matches. The nearest neighbor, `lib/coach/synthesis.ts`, is a readiness
morning-card composer (HRV/RHR/sleep/wrist-temp confounders into a 2-3
sentence story) — it is not imported by `generate.ts`, does not feed workout
selection, and answers a different question ("how is the runner doing right
now") than the one Brief 04's success test asks ("why this workout, this
week, for this runner"). This independently confirms what other audits
tonight found elsewhere in the app: the Brain Constitution's §F Coaching
Thesis is a designed ownership slot with no implementation, and workout
selection is exactly the place its absence is most visible — the mechanism
that would answer "why" is the one system named specifically to answer it,
and it does not exist.

**Verdict:** "why this workout" is a real, inspectable answer *at the code
level, for someone reading the selector's return value in a debugger* — every
fact needed to construct Brief 04's answer is computed. It is not a real,
inspectable answer *for the runner, or for a reviewer looking at the
persisted plan row*, because the richer half of the computation
(`rationale`, the `rejected` trail) is thrown away before it is written down.

## 6. Evidence-coverage awareness — confirmed absent, checked against the code

`docs/design/plan-evidence-coverage-2026-08-31.md` frames this as
deliberately not-yet-built. This was verified against the selector and
composer rather than taken on the design doc's word:

- `SelectorInput` (`lib/workout-catalogue/select.ts:355-494`) has no evidence-
  coverage field anywhere in it — no `evidenceDebt`, no "last strong
  observation," nothing resembling the design doc's proposed
  `EvidenceCoverage { high_intensity, threshold, durability }`.
- `rankCandidates()`, the tie-breaker among equally-eligible candidates
  (`select.ts:967-986`), breaks ties purely on staleness-of-*use*
  (least-recently-*run*), never on staleness-of-*evidence*. The design doc's
  own proposed mechanism — "when multiple workouts provide equally
  appropriate training stimulus, prefer the workout that resolves the
  greatest evidence uncertainty" — has no code path today; variety and
  evidence-coverage are two different tie-breaking questions and only the
  first is implemented.
- Nothing in `generate.ts`'s call into `selectSlotWorkout`/`selectLongRunVariant`
  passes anything resembling an evidence-coverage signal.

Confirmed: workout selection today is purely training-driven (doctrine
placement, affordability, combination rules, use-based rotation), with zero
evidence-coverage awareness, exactly as the design doc describes and exactly
as it should be at this stage — it is explicitly filed for later, not
silently missing.

## 7. A real example, traced

Pulled from `training_plans` / `plan_workouts` for `user_uuid =
'0645f40c-951d-4ccc-b86e-9979cd26c795'` (read-only role), the sole active plan
(`pln_9a57561debb776e5`, authored 2026-08-31, goal race 2026-12-06). Two
quality days from the first upcoming week, both traced from the persisted row
back through the code that produced them.

**2026-09-01, Tuesday — `wko_eaa8cfd7cb94310b`, type `threshold`.**

- `plan_workouts.notes`: `"Cruise intervals · Research/04 §5.3."`
- `workout_spec`: `rep_count: 4, rep_distance_mi: 1, rep_pace_s_per_mi: 439,
  rep_rest_s: 60, warmup_mi: 2.1, cooldown_mi: 2.1, lthr_bpm: 168`, plus a
  pass/bail HR rule pair (`pass: avgHr ≤ 164`, `bail: avgHr > 173 → drop to
  easy`).
- `sub_label`: `"4×1 mi @ T pace · 1 min jog"`.

Traced: `catalogueNote()`'s name-and-section pattern
(`"<name> · Research/04 <section>."`) matches `lib/workout-catalogue/catalogue.ts`'s
`cruise-intervals` entry (§5.3), whose first structure is `reps: r(3,6), rep:
b(1,1,'mi'), recoverySec` scaled at "one minute per mile of work" — exactly
the citation `VOCAB.threshold-family` (§4 above) checks against the live doc
table. The dose picked 4 of the doctrine band's 3-6 reps: this is the
catalogue's `fits()` sizing *inside* the band toward
`SelectorInput.targetAtPaceMinutes` — the `OverloadTrajectory`'s earned dose
for the `threshold` track this week (§3.C) — rather than opening at the
doctrine ceiling. The rep pace (439 s/mi ≈ 7:19/mi) and the LTHR-derived
HR-rule pair (168 bpm anchor, 164/173 bpm gates) are `buildWorkoutSpec`'s
(`lib/plan/spec-builder.ts`) work, built from the week's `tPaceSec` — which
traces to `resolveCurrentTPace()`/`vdot.ts` via `blendedTPaceForWeek()`, the
live (non-shadow) pace path documented as a gap in §3.D.

**2026-09-03, Thursday — `wko_e346d05fc84e0977`, type `intervals`.**

- `plan_workouts.notes`: `"Medium hill repeats · Research/04 §8.3. Run the
  climb by effort, not pace. Jog down, full recovery, repeat."`
- `workout_spec`: `rep_count: 10, rep_duration_s: 60, rep_rest_s: 120,
  by_effort: true, rep_pace_s_per_mi: null, warmup_mi: 1.5, cooldown_mi: 1`.
- `sub_label`: `"10×60s hills @ 5K-10K effort · 2 min jog down"`.

Traced exactly to the `medium-hill-repeats` entry quoted verbatim in §1
(§8.3, `reps: r(6,10), rep: b(60,90,'s'), recoverySec: r(120,180)`). No
`repBuild` field on this entry, so `fits()`'s effort-cued branch opens at the
*ceiling* of the reps band (10, not ramped) at the *floor* of the rep-length
band (60s) — exactly what §8.3's own cited row states and exactly what the
rendered string shows. The week's phase resolved to early QUALITY
(`weeksToPhaseEnd > 2`, so `qualityFamilyFor` names the family `hills`,
`generate.ts:3566-3581`), the `intervals` slot's family list admits `hills`,
and `medium-hill-repeats`'s `phases` include `hill_strength` — consistent
with the doc's own "When in cycle | Late base, early specific" row quoted in
its `cites`.

Both traces close cleanly, end to end, from the persisted row back to the
cited doctrine passage — which is real evidence the pipeline described in §§1-3
is the pipeline actually running in production, not just the pipeline the
code intends. Neither row's `notes` field contains anything beyond identity
and family purpose, which is the concrete instance of §5's finding: the
`rationale` and `rejected` trail that would answer "why this one, over the
alternatives" were computed for both of these picks and are not present
anywhere in the database.

---

## Open questions worth a second opinion

1. **Should workout-parameter-setting be its own explicitly owned domain?**
   Today it is split three ways with no single name: the catalogue's `fits()`
   (dose inside a doctrine band), the `OverloadTrajectory`/lever ladder
   (week-over-week growth for the two unnamed generic slots), and
   `buildWorkoutSpec`/`spec-builder.ts` (pace, HR rules, warm-up/cool-down
   sizing, rendering to the persisted spec). The Brain Constitution's
   ownership table has no row for "how many reps, how long, how much rest" —
   it is implicitly split between Workout Library (structure) and Plan
   Generator (selection), but the actual sizing math lives in neither's
   stated scope. Whether this deserves a named owner, or is fine as an
   internal detail of Plan Generator, is a real design call.

2. **Does the missing Coaching Thesis layer matter more here than anywhere
   else in the app?** §5's finding is that workout selection is the one place
   where "why" has a doctrine-stated success test (Brief 04) and a
   purpose-built ownership slot (Brain Constitution §F) — and is also the
   place where the richest internal reasoning (`rationale`, `rejected`) is
   computed and then actively discarded rather than merely never computed.
   That is a smaller gap to close than building a Coaching Thesis from
   scratch (persist what already exists before inventing more), and worth
   weighing against wherever else Coaching Thesis is being considered as a
   build priority.

3. **Should the generic-slot / catalogue-slot split in §3 be collapsed?** The
   `OverloadTrajectory` exists specifically because doctrine gives the
   generic threshold/intervals slots no named vocabulary to rotate through —
   but as `qualityFamilyFor`'s comments note, several of those slots (e.g.
   "specific support" threshold/vo2max) were *recently* given catalogue
   coverage they didn't used to have, shrinking the generic path's territory.
   Whether the generic path should keep shrinking toward zero, or is a
   permanent second mechanism for doctrine's genuinely un-named work, wasn't
   answerable from the code alone and is worth asking the person who wrote
   the two systems.

4. **Is `weekMpPaceSec`/`resolveCurrentTPace` slated for the same "delete
   once migrated" treatment `DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`
   prescribes for legacy VDOT-cascade paths?** If `prescription-resolver.ts`
   is meant to become the live pace authority for plan generation, that
   migration has not started on this code path (§3.D), and the "shadow mode"
   label in the Brain Constitution should probably say so explicitly rather
   than reading as already-complete on a skim.
