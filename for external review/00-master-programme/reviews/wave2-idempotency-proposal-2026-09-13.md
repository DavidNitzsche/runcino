# Wave 2 · Independent review + idempotency proposal

**Date:** 2026-09-13
**Branch:** `proposal/wave2-canonical-fitness-resolver` — continued, new commits on top of `6874b4518`
**Reviewed artifact:** `6874b4518` (`lib/training/resolve-current-fitness.ts` + its 10 tests), based on `origin/main` @ `a79c5c86d`
**Reviewer:** fresh pass. Every claim below was re-derived, not inherited.

---

## STATUS — READ THIS FIRST

**THIS IS A PROPOSAL. NOTHING HERE IS ADOPTED, WIRED, OR MERGED.**

- No change to `lib/plan/adapt.ts`. `detectFitnessRegression` and
  `detectTrainingLead` are byte-identical to `origin/main`.
- No cron, route, job or detector imports any file added by this branch. That
  is not a promise, it is `GUARD 5` in
  `lib/training/_wave2_no_mutation_scan.test.ts`, which fails the moment
  anything does.
- No production write of any kind. All database access was through
  `scripts/_ro.sh` (`DATABASE_URL_RO`); vitest additionally armed the
  production write barrier, which logged `writes REFUSED`.
- No `vdot_last_reviewed` write, no `recompute_paces` trigger, no reprice, no
  plan mutation, no runner-visible card. The 2026-09-02 seam
  (`lib/plan/adaptation-authority.ts`) is untouched and unreachable from
  anything here.
- **Migration 166 (`plan_decision_ledger`) is NOT applied to production** —
  independently verified below. The idempotency design in §3 rests on it, so
  adoption has an unmet DDL precondition that needs David's per-statement go.

"Proposal, tested in isolation" is not "already adopted." Anyone reading this
downstream should treat every design section as a recommendation awaiting a
decision.

---

## 0. Executive summary

The prior pass's factual claims **hold**. I reproduced all of them
independently and found nothing it got wrong.

I found **three things it missed**, one of them serious:

| # | Finding | Severity |
|---|---|---|
| **A** | The cross-check has **~0.7 VDOT of headroom before it refuses permanently**, and the direction of travel is toward the cliff. Measured over 45 real days, not one. | **HIGH** — the single-day validation could not see this |
| **B** | A naive transitive-reachability scan reports the canonical resolver reaching `lib/plan/adapt.ts`. It is a **false positive through `import type` edges**, but a one-hop or careless scan would have said "mutation path reachable" and a careless reader would have believed it. | MEDIUM — gate design, not engine |
| **C** | The reviewed suite's "no disagreement" fixture (`cascadeVdot: 48.9`) **inverts which rung of the real cascade wins**. Live, `vdot_last_reviewed` (46.6) wins over `authored_state.pace_recompute.vdot` (47.7). Cosmetic, but the fixture is not the live shape it claims to be. | LOW |

And I answer questions 2-7 with real, tested, unwired code: three new modules,
57 new tests, all six new guards falsified.

---

## 1. Q1 · Independent review of `6874b4518`

### 1.1 What I re-ran, and what came back

| Check | Result |
|---|---|
| Existing suite `_resolve_current_fitness.test.ts` | **10/10 pass** |
| Falsification: disable the disagreement guard (`if (false && …)`) | **4 tests fail**, exactly as claimed. Restored by file copy — never `git stash`, which is shared across worktrees here |
| `tsc --noEmit`, whole project | clean |
| Neighbouring suites (`_pace_anchor`, `_capacity_resolver`) | unaffected |
| Real-data revalidation, read-only, `dnitch85@me.com` | **reproduced exactly** |

The re-derived live read, 2026-09-13:

```
vdot 47.5 · paceSecPerMi 432 · confidence 0.772350193688833 · sourceMode direct
reasons  DIRECT_CORROBORATED_THRESHOLD_EVIDENCE, THREE_RECENT_CORROBORATING_SESSIONS,
         OBSERVATIONS_AGREE, FRESH_EVIDENCE,
         REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT, NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT
legacy   reviewedVdot 46.6 · authoredStateVdot 47.7 · cascadeVdot 46.6
delta    +0.90   threshold 2.00   →  ok
```

Reproduce with `bash web-v2/scripts/_ro.sh scripts/_wave2_review_single_day_ro.script.ts`.

I also verified two things the prior pass asserted but did not check:

- **`evidenceIds` really are `runs.id`.** All four
  (`-258355938987883`, `-87627419857791`, `-75144899844434`,
  `-245190372869167`) resolve to live `runs` rows dated 2026-09-01,
  2026-07-07, 2026-09-08 and 2026-08-30. They are negative bigints because
  they are HealthKit-derived, not synthetic hashes. This matters: it is what
  makes an evidence-identity hash trustworthy (§3).
- **The resolver is stable within a process.** Two consecutive calls return
  identical numbers and an identical evidence set.

### 1.2 FINDING A · the cross-check has a clock on it (the serious one)

The prior pass validated **one day** and reported "agrees within threshold."
True — and one day cannot answer the question that matters. I replayed
`resolveThresholdCapacity` + `decideCurrentFitness` across **45 consecutive
real days** (2026-07-31 → 2026-09-13), read-only
(`scripts/_wave2_review_45day_replay_ro.script.ts`):

```
legacy cascade (frozen)  46.6

2026-07-31 .. 2026-09-05   vdot 47.8   delta +1.20   ok
2026-09-06 .. 2026-09-07   vdot 47.9   delta +1.30   ok
2026-09-08 .. 2026-09-13   vdot 47.5   delta +0.90   ok

SUMMARY over 45 days:  ok=45   refuse=0   evidence-set changes=3
```

Read that against three facts already established on this branch:

1. `users.vdot_last_reviewed` is **mechanically frozen** — its only writer is
   unreachable since the 2026-09-02 seam. It will read 46.6 forever.
2. The canonical belief is **evidence-driven and rising**. This runner's
   `projection_snapshots` over the last 30 days span **44.1 to 47.8**.
3. The refusal fires at `|delta| > 2.00`.

So the resolver's margin is **not** "comfortably inside." It has spent 45-65%
of its budget, the denominator never moves, and the numerator is a marathon
block's worth of training away from 48.6. **At canonical 48.6 the resolver
refuses, and it refuses permanently**, for a reason that has nothing to do
with the runner.

This is two CLAUDE.md rules at once:

- **Rule 9's exact signature — "the fitter runner gets the worse plan."** A
  continuous improvement produces a categorically different output (an answer
  becomes a refusal) at a boundary the runner cannot see and did not cause.
- **Rule 21's signature — wired, tested and inert.** A pace lever that stops
  answering as the runner gets fitter is the failure this app can least
  afford.

It also cuts the other way and is worth saying plainly: the low end of the
snapshot range, 44.1, is **2.5 below the frozen anchor** — already past the
threshold. The resolver would have refused on a bad-evidence day too. The
cross-check is not stable; it only looks stable because 45 days happened to
sit on one side.

**Recommendation.** Do not adopt the cross-check as written. Two options,
neither of which I am authorised to implement:

- **Preferred — retire the comparison rather than tune it.** The legacy
  cascade's first rung is a dead column. Comparing a live belief against a
  dead number and refusing on divergence guarantees eventual permanent
  refusal. Constitution §8 is explicit that a migration runs **OLD → shadow
  only, NEW → authority**, not "new authority, gated on agreeing with old."
  Record the divergence (§6's `raise`), never let it veto.
- **If the comparison stays**, it must compare against something that can
  move — `authored_state.pace_recompute.vdot` (47.7, delta −0.2) rather than
  the frozen column — and the widening delta must itself raise, so the cliff
  is announced long before it is reached.

Either way, **the refusal must never be silent**, which is why §6's state 2
sets `raise: true`.

### 1.3 FINDING B · a reachability scan false-positives through `import type`

Building the Q7 scan (§7), my first transitive walk reported:

```
resolve-current-fitness → capacity-resolver → plan/spec-builder
  → training/prescription-resolver → training/runner-state → plan/adapt
```

`lib/plan/adapt.ts` is the plan engine's mutation module. That read as a
serious violation of the reviewed file's own header claim.

**It is a false positive.** Two of the four hops are `import type`
(`spec-builder.ts:62`, `prescription-resolver.ts:143`), which TypeScript
erases entirely — no runtime edge, no module load, nothing callable. And
`runner-state.ts:379` reaches `adapt.ts` through a *dynamic* import
specifically to avoid a static edge; its own comment at line 337 says so.

Reported anyway, for three reasons:

- A one-hop or type-blind scan would have called this "mutation path
  reachable," and Rule 19's incident was exactly a deep dynamic edge nobody's
  gate could see. The direction of the error matters: an over-matching gate
  earns an allowlist entry, and the allowlist is then the hole.
- The reviewed file's header sentence *"there is no … call to
  `applyAdaptations`, `sealAutomaticActions`, or any mutation path"* is true
  of its own code and is **not** a statement about the module graph. Rule 20's
  corollary applies: gate the claim or narrow the sentence. §7 gates it.
- The corrected walk **passes**, and is falsified in both directions: a real
  value import of `@/lib/plan/adapt` fails guards 2 and 3; a type-only import
  of the same module does not.

### 1.4 FINDING C · the "real-world shape" fixture inverts the live cascade

`_resolve_current_fitness.test.ts:55` uses
`{ reviewedVdot: 46.6, authoredStateVdot: 48.9, cascadeVdot: 48.9 }` under the
heading "current, real-world shape." Live, `anchorVdotFromState` returns
**46.6** — `vdot_last_reviewed` is rung 1 and wins. The real triple is
`{ 46.6, 47.7, 46.6 }`.

Harmless to the assertions (they only read `cascadeVdot`), but the fixture
advertises itself as the live shape and is not it — and the *reason* it is not
is the entire finding of the investigation. Worth correcting if the file is
touched again.

### 1.5 Things the prior pass got right that I specifically tried to break

- The refusal is at `>` not `>=`, so the threshold itself is not a cliff. Held.
- The refusal is symmetric in sign. Held.
- `LegacySnapshotProbe` genuinely keeps `none` and `failed` apart, and both
  let the canonical belief answer. Held, and correct per Constitution §C.
- The SQL is a single `SELECT` mirroring the detectors' own query verbatim.
  Held; I diffed it against `adapt.ts:3685` and `adapt.ts:4157`.
- The `INCOMPARABLE_BELOW_TABLE` refusal is right and non-obvious: a
  below-table runner has a real pace and no VDOT, and every threshold in
  `adapt.ts` is denominated in VDOT points.

---

## 2. Q2 · What replaces the reviewed-anchor stamp's idempotency function

### 2.1 What the stamp was actually doing

`adapt.ts` ~4112, verbatim:

> "the anchor cascade below reads `vdot_last_reviewed` first, and the
> `recompute_paces` limb stamps it after applying — so a credited lead becomes
> the anchor it was measured against, the delta collapses to zero, and the
> detector cannot re-fire on the same evidence."

That is **idempotency by moving the goalpost**. The firing test is
`measured − anchor ≥ 1.0`; acting on it sets `anchor := measured`, so the test
is false tomorrow. Two defects:

- **It fuses two quantities under one name (Rule 16).** The anchor is both
  "what we believe" and "what we have already acted on." A belief that can
  only be updated by an adaptation firing is not a belief — which is precisely
  how the column came to read 46.6 for four months against evidence of 47.5.
- **The stamp is dead.** Since 2026-09-02 nothing writes it. The idempotency
  guarantee has been *absent*, not weakened, for that whole period.

### 2.2 The replacement: separate the two quantities

```
BELIEF    → resolveThresholdCapacity()      Constitution §C. Recomputed at
                                            read time, never stamped (Rule 10).
ACTED-ON  → a DECISION IDENTITY in the      A content hash of the evidence,
            decision ledger                 checked before firing.
```

The belief moves for evidential reasons alone; "have we already acted on
this?" is answered by a record of having acted, rather than by a number that
had to be corrupted to carry the answer.

### 2.3 Does something already do this for a different lever? YES — reuse it

I searched `lib/brain/ledger/`, `coach_intents` and `plan_decision_ledger`. **Three
existing mechanisms cover this job and this proposal uses all three rather
than growing a fourth (Constitution §9).**

| Mechanism | Where | What it already provides |
|---|---|---|
| `idempotencyKeyFor()` | `lib/adaptation/canonical/decision-record.ts:457` | The key **shape** — `athlete · planVersion · evidenceVersion · lever · boundary` — and its load-bearing rule: *"Note what is NOT in it: the timestamp."* |
| `plan_decision_ledger.idempotency_key` + partial unique index | migration 166 | The **enforcement**. `recordDecisionInTransaction(tx, entry, { onceOnly: true })` makes a duplicate key insert nothing, return `{ state: 'duplicate' }`, and the caller rolls its own mutation back — exactly-once, in the same commit as the plan change |
| `plan_lineage_id` | migration 166 | The id that **survives a plan rebuild**. Without it a key forgets everything on every rebuild, and this runner has 47 plan versions (Rule 14) |

Nothing needs to be built. **The correct answer to Q2 is "reuse migration 166,
do not reinvent."**

**What must NOT be reused:** `lib/adaptation/canonical-shadow/live-input.ts:1016`
derives `evidenceVersion` as `runData[runData.length - 1].dateISO` — the date
of the last run. Defensible for the volume lever at a weekly cadence.
Wrong for this lever, in both directions:

- **It misses changes.** A run ageing out of the capacity resolver's lookback
  window changes the evidence set and not the last run's date. This runner's
  oldest evidence member is **2026-07-07, 63 days old** — it will leave with
  no new run required.
- **It invents changes.** Any run at all — including a recovery jog the pace
  corpus excludes as `LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE` — moves the
  date and therefore the key.

The fix is not a new key format. It is a better `evidenceVersion`, computed
from the canonical resolver's own `evidenceIds`.

### 2.4 The unmet precondition

```
SELECT to_regclass('public.plan_decision_ledger');  →  NULL
```

Verified against production, read-only, 2026-09-13. **Migration 166 is not
applied.** Consequences for adoption:

- Until it is, `shouldFireOnThisEvidence` returns
  `IDEMPOTENCY_UNAVAILABLE_TABLE_ABSENT` and **withholds** — it does not fire
  unprotected. This mirrors `decision-ledger.ts`'s own
  `LEDGER_ONCE_WITHOUT_TABLE` posture verbatim rather than inventing a softer
  one, because Rule 11 forbids a missing input silently disabling a safety
  mechanism.
- So **adoption of this design is gated on a DDL statement David has to
  approve per-statement.** The approval packet already exists:
  `docs/reports/brain-2026-09-05/MIGRATION-PACKET.md`. This proposal does not
  ask for it and does not run it.

---

## 3. Q3 · How evidence identity stops the same evidence re-firing forever

`web-v2/lib/training/fitness-decision-identity.ts` · 23 tests in
`_fitness_decision_identity.test.ts`.

### 3.1 The measurements the design rests on

From the 45-day replay:

| Quantity | Behaviour over 45 real days |
|---|---|
| evidence set | changed **3 times** — unchanged for 33 consecutive days at one point |
| canonical VDOT | 47.8 → 47.9 → 47.5 |
| confidence | 0.67 → 0.84, moving on 20 of 45 days |
| `resolvedAt` | changes every call |

Three design constraints fall straight out:

- `confidence` and `resolvedAt` **must not** be in the key, or it changes
  nightly and the dedup is decorative. Same reason `idempotencyKeyFor`
  excludes the timestamp.
- The **raw** VDOT must not be either: it moved 47.8 → 47.9 with **no**
  evidence change (the day-to-day continuity cap and freshness weighting), so
  a raw-vdot key mints identities for questions nobody asked.
- A hash over the sorted evidence set **is** the right substrate: it is stable
  for weeks, and it is the thing that actually changed on the three days
  something was learned.

### 3.2 The mechanism

```ts
fitnessEvidenceFingerprint(ids)      // sha256 over sorted, de-duped runs.id;
                                     // null on an empty set (Rule 11)
quantiseVdotMagnitude(delta)         // buckets on TRAINING_LEAD_REANCHOR_DELTA (1.0),
                                     // imported from doctrine, not restated
fitnessDecisionIdentity({…})         // → idempotencyKeyFor({
                                     //     athleteId, planVersion: planLineageId,
                                     //     evidenceVersion: `${fingerprint}@${bucket}`,
                                     //     lever: 'THRESHOLD_PACE',
                                     //     boundary: 'SESSION_COMPLETED' })
shouldFireOnThisEvidence(id, probe)  // → { fire } | { fire: false, reason }
```

Every slot is filled with a value that is **true** of this decision — no cast,
no widened enum, no sentinel.

**The detector and the direction are deliberately NOT in the key.** They were,
in my first draft, on the reasoning that up and down are two decisions. The
codebase says otherwise: `detectAdaptations` runs `detectTrainingLead` only
when neither `pr_bank` nor `fitness_regression` fired — `adapt.ts` ~4103 names
that exclusivity as the double-counting guard. One evidence set, one lever, one
boundary therefore admits **at most one** threshold-pace decision. A key that
separated the directions would licence the same evidence being recorded as both
a push and a pull-back — the incoherence Rule 16 forbids. Keeping them out
makes exclusivity a property of the identity rather than of one caller's
control flow.

**The quantised magnitude IS in the key**, because the evidence set alone does
not determine the delta: the delta is `canonical − anchor`, and the anchor is
the other operand. An anchor that genuinely moved a doctrine step against
unchanged evidence is a new question.

**Rule 9 note, stated rather than assumed:** quantisation puts a bucket edge in
a continuous quantity. Rule 9 asks whether a hair's difference produces a
categorically different *plan*. It does not: two readings either side of an
edge produce two keys, whose entire consequence is one extra ledger row and one
extra evaluation of a decision that was going to be evaluated anyway. No plan
differs, and this seam cannot reach a plan at all (§7).

**An UNDONE decision may fire again**, deliberately. Treating a reversal as
"already decided" would mean one undo silences the detector on that evidence
forever — amnesia in the shape of politeness. `directionCensus()` excludes
undone rows for the same reason. The honest cost: a runner who undoes and does
not change their training will see it re-raised; that is a *proposal-expiry*
question (`lib/brain/proposal/staleness.ts` owns it), not an identity question.

### 3.3 The literal Q3 scenario, as a test

> "if the same three corroborating runs are still the most recent evidence
> tomorrow night, and nothing new has happened, the detector must not re-fire"

```
first night                              → fire
next night, same evidence                → ALREADY_DECIDED_ON_THIS_EVIDENCE
night 3, 4, 5 … (key is time-free)       → still suppressed, no decay
a new run joins the set                  → new key → fires
the decision is undone                   → fires again
```

---

## 4. Q4 · Is `ok: true` sufficient when the reasons carry caveats?

**The argued call: `ok` does NOT become false for the two caveats found on
real data. The TYPE changes instead, so `ok: true` stops being enough to
reach the numbers.**

`web-v2/lib/training/current-fitness-contract.ts` · 11 tests.

### 4.1 Why not `ok: false`

1. **Constitution §14, verbatim:** *"Data quality modifies confidence, never
   creates alternate truth."* Both codes are emitted from
   `direct.supporting.some(o => o.weight < 1)` and `.some(o => !o.representative)`
   — observations whose **weight was reduced**, and that reduction is
   **already priced into the 0.772 confidence returned beside them**.
   Refusing charges the discount twice and promotes a confidence fact into a
   truth fact, which is the exact move §14 forbids.
2. **Rule 21, and what it would cost.** These two codes are present on the
   owner's ordinary, current read. A rule that refuses on them refuses for the
   only real runner this app has, on a normal day — inert by construction, on
   the upward path, which is where inertness is most damaging.
3. **Constitution §32:** LOW_CONFIDENCE is a legitimate state, not an error.

### 4.2 Why `ok: true` is nevertheless not sufficient

Rule 11, pointed at the resolver's own output. A clean read and a caveated read
are two facts and `ok: true` collapses them. A caller reads a number that is
arithmetically correct, spends it, and nothing records that it was discounted
— the shape of every defect in Rule 11's own catalogue.

### 4.3 The combinations that DO force a refusal

The line is not *how weak* but **which kind of fact**:

> A caveat that **discounts a real observation** is a confidence fact (§14) →
> QUALIFIED.
> A caveat that says an observation **could not be read**, or that the
> observations **contradict each other with nothing to break the tie**, is a
> Rule 11 fact → REFUSED.

| Code / combination | Tier | Why |
|---|---|---|
| `REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT` | QUALIFIED | weight discount, already in confidence |
| `NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT` | QUALIFIED | same |
| `SINGLE_SESSION_MOVE_CAPPED`, `STALE_EVIDENCE`, `SPARSE_CORROBORATION`, `OBSERVATIONS_DISAGREE`, `DAY_TO_DAY_CONTINUITY_CAPPED`, `CONTINUITY_UNAVAILABLE`, `REEXAMINATION_LOWERED_THE_CORROBORATION_BAR` | QUALIFIED | all confidence facts |
| **`EVIDENCE_ENGINE_READ_UNAVAILABLE`** | **DISQUALIFYING** | the evidence engine could not classify the activity. "The read failed" vs "the evidence is weak" is literally Rule 11's first sentence |
| **`OBSERVATIONS_DISAGREE` + `SPARSE_CORROBORATION` together** | **DISQUALIFYING** | the corpus contradicts itself *and* has too few members to arbitrate. Either alone is normal; the **conjunction** has no honest reading |

**Symmetry is asserted, not intended.** `assessCaveats` takes exactly one
argument — the reason list. There is no direction to pass, so Rule 21's "the
bar to go UP may not be higher than the bar to come DOWN" is enforced by
signature. A test asserts `assessCaveats.length === 1`, so a future added
parameter fails rather than sliding in.

---

## 5. Q5 · The typed caller contract

**The numbers are not properties of the returned object.** There is no `.vdot`
on `CurrentFitnessContract` to read, so a caller that ignores the caveats does
not get a slightly-wrong number — **it does not compile**.

```ts
type CurrentFitnessContract =
  | { outcome: 'clean';     assessment; provenance; _numbers }
  | { outcome: 'qualified'; assessment; provenance; _numbers }
  | { outcome: 'refused';   reason; detail; assessment; provenance }   // no _numbers at all

withCurrentFitness(contract, {
  onClean:     (numbers, provenance) => …,
  onQualified: (numbers, caveats, provenance) => …,   // caveats REQUIRED parameter
  onRefused:   (reason, detail, assessment) => …,     // no default, no optional
})
```

This copies the pattern CLAUDE.md Rule 8 already names as the strongest
enforcement available here — `NormalReading<T>`'s refusal branch carrying no
`value` field — and goes one step further, because a discriminated union alone
is not enough: narrowing to the answered branch would still hand over `.vdot`
with the caveats merely *sitting beside it*, unread. Rule 11's catalogue is
full of callers that had the information and did not look.

The only route to the numbers passes through a function the caller had to
write that **names the caveats in its signature**. Omitting any handler is a
compile error, verified by a `@ts-expect-error` that itself fails `tsc` if the
requirement is ever relaxed.

**What this cannot enforce (Rule 22), stated in the file header:**

- A caller reaching into `._numbers`. TypeScript has no true private field on
  an object type. `GUARD 6` greps for it repo-wide with a ratcheted allowlist
  — that is a grep, not a proof.
- A handler that receives the caveats and ignores them. The type forces the
  parameter to exist; nothing can force it to be used. This raises the floor
  from "did not know" to "chose not to act", which is the most a type can do.
- Whether the classification in §4.3 is *right*. A miscategorised code yields
  a confident, well-typed, wrong tier.

---

## 6. Q6 · Exact detector behaviour, all four states

`web-v2/lib/training/detector-fitness-posture.ts` · 17 tests. **Unwired.**

The governing rule is Rule 11: *"the runner has not changed", "we have nothing
to say about the runner"* and *"we could not find out"* are three different
reasons to stay silent, and today all three are `return null`. Rule 21 names
the cost: *"an engine that returns nothing when it cannot decide is
indistinguishable from an engine that was never called."* So every state
returns a **typed posture**, never a bare null.

| State | Condition | Posture | `raise` | Rationale |
|---|---|---|---|---|
| **1 · AGREEMENT** | canonical answers; legacy within `SELF_HEAL_REANCHOR_DELTA` | **EVALUATE** against `canonicalVdot`, carrying `caveats` and `evidenceIds` | — | §C: the canonical belief is the anchor. The 46.6 → 47.5 substitution is the entire adoption |
| **2 · DISAGREEMENT** | beyond the threshold | **HOLD** both detectors | **true** | §16: *"if a contradiction exists: FAIL LOUDLY rather than silently choosing one."* The raise is load-bearing per Finding A — the likeliest cause silences the pace lever **permanently** |
| **3 · UNAVAILABLE** | `sourceMode ∉ {direct, inferred, race_derived}` **or** `evidenceIds` empty **or** below-table | **HOLD** | **false** | not a fault. See the trap below |
| **4 · READ FAILURE** | the read threw | **HOLD** | **true** | Rule 11. Not "unchanged", not "nothing to read" — a fault |
| (5 · DISQUALIFIED) | a §4.3 disqualifying caveat | **HOLD** | **false** | the engine worked; the evidence did not support a number. Raising here would train whoever reads `ops_alerts` to ignore it |

### 6.1 State 3 is not what it looks like — the trap

**`resolveThresholdCapacity()` NEVER returns "I have nothing to say."** It
always returns a number, down to `MILEAGE_POPULATION_PRIOR` — a threshold pace
derived from a weekly-mileage figure typed into an onboarding form. That is
correct for a *pace prescription* consumer (§32: a simple fallback beats fake
intelligence; the runner needs a pace today).

It is a disaster for an *adaptation* consumer. A detector comparing a
population-prior number against a stale anchor **will** find a delta, and the
delta is two fallbacks disagreeing rather than anything the runner did. It
would fire a pace change on a runner the engine has never observed.

So "unavailable" is detected from `sourceMode` + `evidenceIds`, never from a
null. `vdot_fallback` is excluded even though it *is* runner-specific: it is
the very cascade this migration moves away from, and admitting it would be the
legacy number arriving through a canonical-looking door — Constitution §4's
side door.

### 6.2 One function for both detectors

`fitnessDetectorPosture` takes **no direction argument**, so an asymmetric bar
is not expressible (Rule 21). `adapt.ts` has already paid for two functions
drifting: its own comment records that `detectFitnessRegression` swallows a
failed race-week read into "no race is coming" while `detectTrainingLead` fails
closed on the identical query.

### 6.3 Composition with §3

```
posture = fitnessDetectorPosture(read)
if posture.posture !== 'EVALUATE' → record the silence, raise if asked, stop
identity = fitnessDecisionIdentity({ …, evidenceIds: posture.evidenceIds, deltaVdot })
verdict  = shouldFireOnThisEvidence(identity, ledgerProbe)
if !verdict.fire → record, stop
// only here may a detector return an AdaptationTrigger.
// The trigger's application still passes through the 2026-09-02 seam,
// unchanged. Nothing in this proposal opens it.
```

---

## 7. Q7 · Proof that no route can reprice, mutate, or reopen the seam

`web-v2/lib/training/_wave2_no_mutation_scan.test.ts` — six guards, covering
**all four** wave-2 files including `resolve-current-fitness.ts` from
`6874b4518`.

| Guard | What it proves | Liveness assertion |
|---|---|---|
| 1 | every SQL template literal opens with `SELECT` and carries no mutation verb | ≥1 SQL literal found |
| 2 | no direct import of a mutation module | all 4 files read |
| 3 | **transitive** reachability — full closure, static **and** dynamic, `import type` excluded | >30 modules visited, depth >2 |
| 4 | no runtime-computed `import(…)`, which would defeat guard 3 | all 4 files read |
| 5 | nothing outside the wave-2 set references these files (the unwired tripwire) | ≥4 grep hits |
| 6 | `._numbers` is not read outside the contract that owns it | owning file found in code, not prose |

Comments are stripped before every check, because each file **names** the
modules it avoids in its own header — the citation-scrub defect in Rule 18's
catalogue is exactly a check that cannot tell a warning about a hazard from
the hazard.

**Every guard was made to fail (Rule 18):**

| Planted violation | Result |
|---|---|
| value `import { applyAdaptations } from "@/lib/plan/adapt"` | guards 2 **and** 3 fail |
| **`import type`** of the same module | **all 6 pass** — no false positive |
| `` `UPDATE users SET vdot_last_reviewed = $2 …` `` | guard 1 fails |
| `import(m)` with a variable | guard 4 fails |
| an outside file importing `fitnessDetectorPosture` | guard 5 fails |
| an outside file reading `._numbers` | guard 6 fails |
| restored | 6/6 pass |

The `import type` row is the one that matters most: my first version failed it
(Finding B), and the second failed it again through an unrelated bug — a lazy
`[\s\S]*?` in the re-export regex letting an earlier `export const` swallow a
later import's specifier. **Both were found by falsifying, not by reading**,
and both were fixed by tightening the parser rather than loosening the
assertion.

---

## 8. Falsification matrix

| # | Scenario | Expected behaviour | Test that proves it | Result |
|---|---|---|---|---|
| 1 | Existing resolver, canonical and legacy agree | `ok: true`, provenance names both | `_resolve_current_fitness.test.ts` | **PASS** |
| 2 | Disagreement guard disabled on purpose | 4 tests fail | manual falsification, file copy | **FAIL as required**, restored green |
| 3 | Live production data, one day | `47.5 / 432 / 0.772 / direct`, `ok` | `_wave2_review_single_day_ro.script.ts` | **PASS** — matches prior report |
| 4 | Live production data, 45 consecutive days | should be stable | `_wave2_review_45day_replay_ro.script.ts` | **45/45 ok, 0 refuse — but margin 0.90–1.30 of 2.00, and closing.** FINDING A |
| 5 | `evidenceIds` are real `runs` rows | all named ids resolve | `_wave2_review_single_day_ro.script.ts` | **PASS — named 4, matched 4** |
| 6 | `plan_decision_ledger` exists in prod | — | same script, `SELECT to_regclass(…)` | **NOT APPLIED — migration 166 unapplied** |
| 7 | Evidence fingerprint stable under reorder / duplication | same hash | `_fitness_decision_identity.test.ts` | **PASS** |
| 8 | Oldest run ages out of the window | hash **changes** (the `live-input.ts` proxy misses this) | same | **PASS** |
| 9 | Confidence moves, evidence unchanged | key **unchanged** | same | **PASS** |
| 10 | VDOT wobbles 47.8 → 47.9, no evidence change | key **unchanged** | same | **PASS** |
| 11 | Delta crosses a full doctrine step | key **changes** | same | **PASS** |
| 12 | Two detectors, same evidence | **same key** (mutual exclusivity) | same | **PASS** |
| 13 | Same evidence tomorrow night | `ALREADY_DECIDED_ON_THIS_EVIDENCE` | same | **PASS** |
| 14 | Same evidence 74 days later | still suppressed (key is time-free) | same | **PASS** |
| 15 | New run joins the set | fires again | same | **PASS** |
| 16 | Decision was undone | fires again | same | **PASS** |
| 17 | Ledger table absent | **withhold**, `IDEMPOTENCY_UNAVAILABLE_TABLE_ABSENT` | same | **PASS** |
| 18 | Ledger read failed | withhold, **different** reason (Rule 11) | same | **PASS** |
| 19 | Empty evidence set | no key minted; `NO_EVIDENCE_TO_IDENTIFY` | same | **PASS** |
| 20 | Real live reasons (reduced-authority + non-representative) | `QUALIFIED`, not refused | `_current_fitness_contract.test.ts` | **PASS** |
| 21 | `EVIDENCE_ENGINE_READ_UNAVAILABLE` | **refused** | same | **PASS** |
| 22 | `OBSERVATIONS_DISAGREE` alone / `SPARSE_CORROBORATION` alone | QUALIFIED each | same | **PASS** |
| 23 | The two **together** | **refused** | same | **PASS** |
| 24 | Caveat tier asked with a direction | impossible — arity is 1 | same | **PASS** |
| 25 | Caller omits a handler | **compile error** | `@ts-expect-error` + `tsc --noEmit` | **PASS** |
| 26 | Contract exposes `.vdot` directly | it must not | same | **PASS** |
| 27 | Detector state 1 · agreement | `EVALUATE` on **47.5**, caveats carried | `_detector_fitness_posture.test.ts` | **PASS** |
| 28 | Detector state 2 · disagreement | `HOLD` + `raise: true` | same | **PASS** |
| 29 | Detector state 3 · population prior / user prior / vdot_fallback / below-table | `HOLD`, `raise: false` | same | **PASS** |
| 30 | Detector state 4 · read threw | `HOLD` + `raise: true`, **distinct** silence from state 3 | same | **PASS** |
| 31 | Legacy cross-check itself failed | still `EVALUATE` (§C is not vetoed by a broken cross-check) | same | **PASS** |
| 32 | Any branch returns null/undefined | none may | same, 8 shapes | **PASS** |
| 33 | No wave-2 file issues a mutation SQL | guard 1 | `_wave2_no_mutation_scan.test.ts` | **PASS**, falsified |
| 34 | No direct mutation import | guard 2 | same | **PASS**, falsified |
| 35 | No transitive mutation reachability | guard 3 | same | **PASS**, falsified |
| 36 | `import type` of a mutation module | must **not** trip guards 2/3 | same | **PASS** after Finding B fix |
| 37 | Runtime-computed dynamic import | guard 4 | same | **PASS**, falsified |
| 38 | Anything outside the set imports the proposal | guard 5 | same | **PASS**, falsified |
| 39 | `._numbers` read elsewhere | guard 6 | same | **PASS**, falsified |
| 40 | `tsc --noEmit`, whole project | clean | — | **PASS** |
| 41 | Neighbouring suites unaffected | `_pace_anchor`, `_capacity_resolver` | — | **PASS**, 128 tests green across 7 files |

---

## 9. Open decisions for David — flagged, not taken

1. **Finding A.** Adopt the cross-check as a **shadow record** (Constitution
   §8) rather than a veto, or re-point it at a comparator that can move? My
   recommendation is the former. Either way the current shape has a clock on
   it. **I did not change it** — it is the artifact under review.
2. **Migration 166.** Adoption of §2/§3 is gated on a DDL statement. Packet
   exists; approval is yours per-statement.
3. **`detectPrBank`.** It reads `vdot_last_reviewed` **directly**, with no
   cascade at all (`adapt.ts:3244`). It is a third migration site the prior
   pass noted and neither pass has designed for.
4. **`POST_RACE_RECOVERY_WEEKS['5k']`** and the fixture correction in §1.4 are
   unrelated small items surfaced in passing; neither is touched here.

---

## 10. Files on this branch

**Reviewed, unchanged:**
- `web-v2/lib/training/resolve-current-fitness.ts` (`6874b4518`)
- `web-v2/lib/training/_resolve_current_fitness.test.ts` (`6874b4518`)

**Added by this pass — all unwired:**
- `web-v2/lib/training/fitness-decision-identity.ts` (Q2, Q3)
- `web-v2/lib/training/current-fitness-contract.ts` (Q4, Q5)
- `web-v2/lib/training/detector-fitness-posture.ts` (Q6)
- `web-v2/lib/training/_fitness_decision_identity.test.ts` — 23 tests
- `web-v2/lib/training/_current_fitness_contract.test.ts` — 11 tests
- `web-v2/lib/training/_detector_fitness_posture.test.ts` — 17 tests
- `web-v2/lib/training/_wave2_no_mutation_scan.test.ts` — 6 guards (Q7)
- `web-v2/scripts/_wave2_review_single_day_ro.script.ts` — read-only evidence
- `web-v2/scripts/_wave2_review_45day_replay_ro.script.ts` — read-only evidence

**Not touched:** `lib/plan/adapt.ts`, `lib/plan/adaptation-authority.ts`,
`lib/plan/recompute-paces.ts`, `lib/training/capacity-resolver.ts`,
`lib/training/pace-anchor.ts`, every cron, every route.
