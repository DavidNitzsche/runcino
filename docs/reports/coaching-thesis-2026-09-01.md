# Coaching Thesis — the smallest real version, plus the rationale it was missing

Built against `docs/BRAIN_CONSTITUTION.md` §F (Coaching Thesis) and
`docs/PRODUCT_COACHING_DOCTRINE.md`. §F names a domain — "the strategic
bridge between fitness and planning" — with zero implementation anywhere in
the codebase, confirmed by two prior audits and again by
`docs/reports/workout-provenance-trace-2026-09-01.md` §11: *"there is no
strategic layer in this app that has an opinion about what this Tuesday is
for."* This work adds the smallest version of that opinion that is still
real, and separately fixes the specific discard bug the trace found one
layer down (§1): a real "why this workout beat the alternatives" string,
computed at selection time, thrown away before it ever reached the database.

Commit: `455476c2`, pushed to `main` (fast-forward from `bf3d66dd`). Local
`next build` (the repo's pre-push hook) succeeded. **Railway deploy status
was not directly confirmed** — `RAILWAY_TOKEN` is not set in this
environment, so `scripts/railway-status.sh` could not run. Recommend
confirming from the Railway dashboard or by running that script with the
token.

---

## 1. The object: `web-v2/lib/training/coaching-thesis.ts`

`resolveCoachingThesis(userId, todayISO?)` — same compute-at-read-time,
no-persisted-snapshot, no-goal-parameter discipline as the four capacity
resolvers in `lib/training/capacity-resolver.ts` (which it consumes and does
not duplicate). Shape:

```ts
interface CoachingThesis {
  primaryLimiter: 'THRESHOLD' | 'HIGH_INTENSITY' | 'DURABILITY';
  basis: 'LOWEST_NORMALIZED_CONFIDENCE';
  priority: string;                    // e.g. 'establish_high_intensity_evidence'
  addressedBy: AddressedSession[];     // this week's own sessions that speak to the limiter
  secondaryPriority: { capacity; note };
  notPriority: { capacity; note };
  confidence: number;                  // pass-through of the limiter's own resolved confidence
  evidenceIds: string[];               // pass-through, never fabricated
  reasons: ThesisReasonCode[];         // structured, not prose
  reconsiderIf: string[];              // concrete, checkable conditions
  ranking: CapacityRanking[];          // all three capacities, transparent
  resolvedAt: string;
  modelVersion: string;
}
```

Mapped onto the task's requested fields:

| Requested field | Where it lives |
|---|---|
| current primary limiter | `primaryLimiter` |
| current training priority | `priority` |
| why this week's key sessions address it | `addressedBy[]` (real `plan_workouts` rows this week matching the limiter's family, each carrying its own persisted `selectionRationale` when one exists) |
| what's deliberately held constant | `secondaryPriority` + `notPriority` |
| confidence | `confidence` |
| evidence/provenance | `evidenceIds` (real `runs.id` / race slugs, pass-through from the owning capacity resolver — never invented) |
| review trigger | `reconsiderIf[]` |

### What "primary limiter" means here, and why it's not "lowest raw confidence"

The Constitution's own worked example (`primary_limiter: DURABILITY` →
`priority: increase_long_run_demand`) is followed literally where possible.
With no race-prediction layer built (Constitution §J is itself
unimplemented — grep confirms no `primary_limiter` field existed anywhere in
this codebase before this file), the honest, computed reading available
today is: **the capacity the Runner Model currently knows the least about,
relative to what that capacity's own ladder can ever report.**

That "relative to" clause is load-bearing. `capacity-resolver.ts`'s own
header names a real gap: HIGH_INTENSITY has no direct-evidence reader at
all, so its confidence is structurally capped at `fallbackCeiling` (0.50)
while THRESHOLD and DURABILITY can both reach `directCeiling` (0.90).
Comparing raw confidence would make HIGH_INTENSITY "the limiter" for nearly
every runner in the app — an artefact of an engine gap, not a coaching
finding. Every capacity's confidence is normalized against its own reachable
ceiling before the three are ranked, and the full ranking is returned
(`ranking[]`) so the pick is auditable rather than asserted.

This is stated plainly as a limitation, not hidden: `HIGH_INTENSITY` can
still legitimately win the ranking (normalization narrows the raw-confidence
gap, it doesn't erase it), but `increase_high_intensity_demand` never fires
as a priority — there is no direct rung yet to justify "push it harder," so
its priority is always `establish_high_intensity_evidence`.

---

## 2. Real output for the owner (`0645f40c-951d-4ccc-b86e-9979cd26c795`)

Rendered via `lib/training/_coaching_thesis.audit.test.ts` against the real
account over the read-only role (`DATABASE_URL_RO`), 2026-08-31 anchor date:

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

secondaryPriority = THRESHOLD, "holding steady · evidence is ahead of the other two"
notPriority       = DURABILITY, "holding steady · evidence is ahead of the other two"

reconsiderIf:
  - THRESHOLD's normalized confidence (0.81) drops below HIGH_INTENSITY's (0.58)
  - HIGH_INTENSITY's own confidence crosses into direct evidence (≥0.50) with a
    fresh corroborating session
  - a new race result changes any capacity's sourceMode to direct or race_derived

addressedBy (1 session this week):
  2026-09-03 intervals "10×60s hills @ 5K-10K effort · 2 min jog down"
    — rationale: (none persisted — row authored before this change)
```

This is internally consistent with the independently-run capacity-resolver
audit and with the workout-provenance trace: the owner's THRESHOLD
(0.727, direct) and DURABILITY (0.900, direct) are both well evidenced —
extensive race history and corroborated tempo sessions — while
HIGH_INTENSITY sits on the `vdot_fallback` rung because no direct
high-intensity reader exists yet. The thesis correctly identifies that gap
as the current strategic priority rather than treating a well-evidenced
runner as needing more of what he already has plenty of evidence for.

The one addressed session this week (2026-09-03, an intervals/hills day)
shows `selectionRationale: (none persisted)` — expected and honest: that row
was authored before this change landed, so it carries no
`workout_spec.selection_rationale` key. See §4 for what happens going
forward.

---

## 3. The rationale-discard bug: where it lived, and where the fix landed

`docs/reports/workout-provenance-trace-2026-09-01.md` §1 found it exactly:
`lib/workout-catalogue/select.ts`'s `selectWorkout()` computes a real
rationale string —

> `"Cruise intervals (§5.3) · threshold on the threshold slot in QUALITY;
> 3 session(s) eligible, least recently used wins."`

— and `catalogue-rx.ts`'s `selectSlotWorkout()` already threads it through
as `SlotChoice.rationale`. `generate.ts:5963-5978` (the call site) kept
`entry`, `dose`, `note` and the rendered prescription text, and discarded
`rationale`. It never reached `plan_workouts`.

### The fix, in four small edits, one file each

1. **`web-v2/lib/plan/generate.ts`** — `DayPlan` gains an optional
   `catalogueRationale?: string | null` field. The choice site now carries
   `choice.rationale` through (`catalogueRationale: choice.rationale`), the
   generic-fallback branch sets it explicitly to `null`, `clearWorkShape()`
   (the function that strips a demoted day's stale progression shape) now
   also strips a stale rationale, and `persistedDayShape()` — the exact
   function `persistPlan` calls to build the row that gets inserted — merges
   `{ [RATIONALE_SPEC_KEY]: d.catalogueRationale }` into `workout_spec` right
   after `capSpecToDistance`, the same point `progressionSpecFields` already
   attaches at.

2. **`web-v2/lib/plan/progression-spec.ts`** — new constant
   `RATIONALE_SPEC_KEY = 'selection_rationale'`, new reader
   `readSelectionRationale(spec)`. **The Rule 6 multi-writer guard was
   widened, not duplicated.** `preserveProgressionSql()` used to fold a
   single CASE expression for `PROGRESSION_SPEC_KEY` alone; it now reduces
   over `DURABLE_SPEC_KEYS = [PROGRESSION_SPEC_KEY, RATIONALE_SPEC_KEY]`,
   nesting one CASE per key. Every one of its six existing call sites
   (`adapt.ts`, `recompute-paces.ts`, `reanchor-plan.ts`,
   `progression-pass.ts`, `race-role-apply.ts`, the workout-spec backfill
   route) — several of which were explicitly off-limits for this pass —
   picked up the new key's guard with **zero edits to those files**. This
   was verified against the existing `_progression_spec.test.ts` suite
   (8/8 still pass, including the exact-substring assertions on the
   generated SQL) and against a new test asserting the widened guard
   (`_rationale_persist.test.ts`).

3. **`web-v2/lib/plan/spec-builder.ts`** — untouched. `WorkoutSpec` is
   already `Record<string, unknown> | null`, so no type change was needed
   for the new jsonb key.

4. Nothing in the four DDL-adjacent or in-flight files this task was scoped
   away from (`recompute-paces.ts`, `reanchor-plan.ts`,
   `lib/adaptation/*`, `normal-window.ts`, `capacity-resolver.ts`) was
   touched. No DDL was run or needed — `workout_spec` is jsonb.

---

## 4. The one wired consumer: `GET /api/v5/today`

Chosen because it's the surface the trace named directly: `spec-card.ts`'s
`sessionRationale(type)` produces the byte-identical-forever per-family `why`
string ("Lift the lactate threshold · the engine's ceiling. The pace you
could hold for an hour." — identical on every threshold session, every
runner, every week, forever). The fix does not overwrite that field — it
adds a second, honest one beside it:

- **`SpecCard.selectionRationale: string | null`** (`lib/training/spec-card.ts`)
  — read via `readSelectionRationale(spec)` in `cardFromSpec()`. `null` on a
  row with none stored (an old row, or a day a generic trajectory filled
  rather than the catalogue).
- **`V5PrescriptionLike.selectionRationale?: string | null`**
  (`lib/faff/v5-today.ts`) — the wire type `GET /api/v5/today` returns.
- **`app/api/v5/today/route.ts`** — one line added to the existing
  `prescriptionLike` construction: `selectionRationale: prescription.selectionRationale`.

**Why `why` itself was left alone rather than replaced.** The persisted
string is written in the engine's own working voice — candidate counts,
doctrine section numbers ("3 session(s) eligible, least recently used
wins") — not yet passed through a coach-voice rewrite. Overwriting the
runner-facing `why` with it directly would risk violating the locked coach
voice doctrine (no jargon, no internal mechanics) without a review pass this
task wasn't scoped to do carefully. Keeping it as a distinct field is the
honest middle ground: the real provenance now reaches the wire (previously
answerable only in a debugger, per the trace's own words), and a future pass
can decide how or whether to fold a cleaned version into the primary
sentence.

### Verification (Rule 13)

**Backend/data-flow: rendered against the real code path, not a fixture.**
`lib/plan/_rationale_persist.test.ts` drives the actual author chain —
`composePlan` → `finalizeComposedPlan` → `persistedDayShape` (the exact
functions `persistPlan` calls, not a stand-in) — against a synthetic
marathon block (same `cimBlock()` fixture `_progression_spec.test.ts`
already uses for the equivalent progression-shape check), and asserts:
the rationale on the composed `DayPlan` reaches `workout_spec` unchanged,
survives a JSON round trip, is read back correctly, and reaches
`cardFromSpec()`'s `selectionRationale` field exactly. All 3 assertions
pass; the anti-vacuum guard (`carried > 0`) confirms the catalogue actually
filled at least one quality slot in the test block, so the test cannot pass
vacuously.

**API/UI: NOT rendered live.** `GET /api/v5/today` requires the owner's own
authenticated session, which this pass does not have, and no native iOS
screen currently reads this new field (it was not asked to — no native UI
change was requested, and CLAUDE.md's design doctrine says don't add
surface area without a decision to). Stated plainly rather than claimed:
**the wiring into the live wire response was verified by type-checking and
by reading the route's construction, not by hitting the endpoint or the
simulator.** The owner's live plan also has not been regenerated since this
change landed (deliberately — rebuilding his active plan is a live
production data mutation and out of scope for a background pass without his
go), so no row in his real account carries `selection_rationale` yet; it
will populate the next time his plan is authored or rebuilt through the
normal generation path, which is unchanged in every other respect.

---

## 5. What's still stubbed or deferred

- **Coaching Thesis is not wired into `generate.ts` / plan authoring.**
  §F's relationship to the Plan Generator is a read relationship (the
  generator would consume it to justify placement); building that
  consumption is separately-scoped work, not attempted here to keep this
  pass to "the smallest useful object."
- **`resolveEasyCeiling` is deliberately excluded** from the limiter
  competition — it's a boundary with feel-based guidance, not one of the
  three capacities Runner Model trades off (Constitution §33), per the file
  header's argument.
- **`addressedBy`'s family match is coarse.** DURABILITY matches on
  `is_long` alone; a long run is durability-relevant but not the only
  session type that is. The finer classification belongs to the Activity
  Interpreter (`lib/evidence/activity-evidence.ts`), not this file.
  Stated in the code header rather than silently approximated.
- **`selection_rationale` is not backfilled.** Only rows authored or
  rebuilt after this change carries the key — by design, per CLAUDE.md's
  DDL/data-write gating (a backfill is a data write requiring a separate
  explicit go, same posture `docs/reports/workout-provenance-
  trace-2026-09-01.md` and the existing `backfill-workout-spec` admin route
  already take for `workout_spec` generally).
- **The persisted rationale's voice is not coach-reviewed** — see §4. It's
  exposed as a secondary field precisely because it hasn't been.
- **Railway deploy not directly confirmed** — see the top of this report.

## 6. Tests and typecheck

- `tsc --noEmit` — clean (zero errors from any file this task touched).
- `lib/plan/_rationale_persist.test.ts` — 3/3, new.
- `lib/plan/_progression_spec.test.ts` — 8/8, unchanged, confirms the
  widened Rule 6 guard didn't move the existing SQL shape's substring
  contract.
- `lib/training/_spec_card.test.ts` — 21/21, unchanged.
- `lib/faff/_prerun_card.test.ts`, `lib/faff/_surface_sweep.test.ts` —
  unchanged, all passing.
- `lib/training/_coaching_thesis.audit.test.ts` — new, real-account render
  (see §2), gated on `DATABASE_URL_RO` like its sibling
  `_capacity_resolver.audit.test.ts`, not part of the CI gate chain.
