# The plan-adjudication layer · architecture, owners, and the CIM trace

> "The brain clearly contains research and rules, but it is not yet reliably
> reasoning across them as a complete coaching system. It can quote the correct
> doctrine and evaluate individual workouts while still potentially assembling
> an incoherent overall sequence."

That is the right diagnosis, and the cause is structural.

## Why the existing brain could not catch this

**Every gate in this engine samples the output at POINTS and asks whether each
point is legal.** `_maint_invariants` checks placement, distance and alignment.
`_dosing_sweep_gate` checks per-session caps across 11,598 archetypes. The
doctrine registry checks 342 constants against their own research tables.
`_coach_sensible` checks individual sessions.

**Nothing asks what a SEQUENCE costs.** CLAUDE.md Rule 9's own audit named this
shape for a different class — *"every gate samples the output space at POINTS …
Nothing sampled the derivative."* This is the same failure one level up.

So the 2026-10-26 week can contain 6 mi at T, 9×3 min at I **and** a 21.5-mile
long run — at +26% over his highest week ever and +19% over his longest run
ever — and pass every check in the repository, because each component is
individually legal and nothing asks what they cost together.

It is also why "supported for him" and "permitted by a table" were being
conflated. No type distinguished them, so nothing could.

---

## Architecture

```
lib/plan/adjudication/
  contract.ts      the vocabulary, as types — EvidenceClass, Option,
                   DoctrineForce, DecisionTrace, PromotionCheck
  adjudicate.ts    the reasoning, as pure functions over loaded facts
  _adjudication.test.ts   20 enforcement tests
  _cim_trace.test.ts      the live decision trace
```

Pure functions over already-loaded facts. It opens no database and reads no
plan: a caller hands it demonstrated history and planned weeks. That is
deliberate — the layer must be testable against constructed sequences, and a
function that fetches cannot be.

### Optimisation target, stated once in the code

**The maximum productive load this runner can ABSORB.** Not maximum safety, not
maximum difficulty, not compliance with a table. That target has a direction:
**the default is to advance.** A HOLD or PULL_BACK must be justified by evidence
exactly as a PUSH must — an adjudicator that returns HOLD when it cannot decide
has picked the option that never has to defend itself, which is the disposition
Rule 21 measured at zero upward adaptations.

Proven by test: *"A SUPPORTED PUSH WINS · the layer advances when the evidence
is there"*, and the CIM trace chooses **PUSH** on 11-29.

### The distinction the whole layer turns on

| class | means |
|---|---|
| `SUPPORTED` | he has completed something comparable and it went well |
| `ALLOWED` | a research table permits it — says nothing about him |
| `CONDITIONAL` | depends on evidence that does not exist yet |
| `CONTRAINDICATED` | his own history argues against it |
| `UNKNOWN` | nothing comparable either way — an absence, never a pass |

### Named owners

| Question | Owner | Status |
|---|---|---|
| is this supported for HIM, or just allowed? | `classifyStep` / `athleteEvidenceFor` | **new** |
| what do these stressors cost TOGETHER? | `detectStackedStress` | **new** |
| which of push / hold / pull-back adapts most? | `rankOptions` + `expectedAbsorbed` | **new** |
| which doctrine sentence wins, and why? | `adjudicate` | **new** |
| may this reach production? | `checkPromotion` | **new** |
| is this workout individually legal? | `_maint_invariants`, `_dosing_sweep_gate` | unchanged |
| does this constant match its table? | `lib/doctrine/registry.ts` | unchanged |
| did the runner execute it? | `lib/execution/day-resolver.ts` | unchanged |
| should the belief move? | `lib/adaptation/canonical/` | unchanged |

### What it replaces, wraps or changes

**Replaces: nothing.** No existing gate is removed or weakened.

**Wraps: the promotion boundary.** `checkPromotion` is a new gate *in front of*
plan promotion. The existing per-workout gates stay exactly where they are and
keep doing what they do; this adds the sequence-level question none of them
asked.

**Changes: the conflict path.** `adjudicate()` **throws** when two equal-force
doctrine sentences disagree and no reason is given. Cherry-picking the sentence
that supports the proposal already made is no longer expressible — that is the
one place existing behaviour becomes impossible rather than merely discouraged.

---

## The decision trace · current CIM preview

Run by `_cim_trace.test.ts` against his real demonstrated history
(peak week 47.5 mi, longest run 18.0, largest completed MP dose 5 mi, most
stressors in a week 2).

| decision | prescribed vs demonstrated | class | chosen | reassess |
|---|---|---|---|---|
| **10-26 peak week** | 60.0 vs 47.5 · **+26.3%** | CONDITIONAL | **HOLD** ~54 mi | — |
| **11-01 long** | 21.5 vs 18.0 · +19.4% | ALLOWED | **HOLD** 21.5 w/ 3 @ M | 2026-10-19 |
| **11-15 post-half** | 18.0 vs 11.01 · **+63.5%** | CONDITIONAL | **HOLD** 14–15 easy | 2026-11-09 |
| **11-22 MP block** | 10 vs 5 · **+100%** | CONDITIONAL | **HOLD** 6 @ M | 2026-11-16 |
| **11-29 primer** | 3 vs 5 · −40% | SUPPORTED | **PUSH** 3 @ M | — |

Stacked-stress detection on 10-26, unprompted:

> *"Volume, longest run AND stressor count all peak in the same week. 3 stressors
> (6 mi @ T, 9×3 min @ I, 21.5 mi long) against a demonstrated 2; 60 mi is
> +26.3% on his peak week; the long run is +19.4% on his longest."*

Each decision compares all three options with expected adaptation:

```
10-26   → HOLD      ALLOWED      E[adapt]=0.59   ~54 mi, drop the I session
          PULL_BACK SUPPORTED    E[adapt]=0.57   ~48 mi, two stressors
          PUSH      CONDITIONAL  E[adapt]=0.50   60.0 mi, all three stressors
```

The preference for HOLD **falls out of expected adaptation**, not out of a
safety rule. Nobody wrote "be careful" anywhere.

### Promotion verdict

```
mayPromote: false
  FAIL  athleteSpecificSupport
  PASS  wholeBlockCoherence   PASS  recoverability     PASS  progression
  PASS  taperIntegrity        PASS  doctrineResolution

BLOCKED · athleteSpecificSupport · 1 decision is not supported by his own
          history and is not marked for reassessment: 10-26 peak week
```

**The blocked decision is the LIVE plan, not a proposed change.** The layer's
first act is to refuse the week that is already authored.

---

## Tests that prove it is enforced, not described

20 tests in `_adjudication.test.ts`. The ones that matter:

| test | proves |
|---|---|
| "a quantity he has never approached is CONDITIONAL and must be EARNED" | the +100% MP block cannot pass as supported |
| "THE WEEK NOTHING IN THIS REPO WAS CHECKING · 2026-10-26" | stacking is detected from his numbers |
| "an ordinary two-stressor week at a sane volume is not flagged" | it is not just a tripwire |
| "A SUPPORTED PUSH WINS" | the default is to advance |
| "a CONDITIONAL push loses to a supported hold — without anyone writing 'be careful'" | preference is computed, not asserted |
| **"TWO HARD CONSTRAINTS WITH NO ADJUDICATION THROWS"** | cherry-picking is inexpressible |
| "BLOCKS an unsupported decision that is not marked for reassessment" | the gate blocks |
| "…and ALLOWS the same decision once it is conditional on evidence to come" | conditionality is the fix, not the crime |
| "BLOCKS a simultaneous-peak week that was pushed anyway" | stacking blocks promotion |
| "BLOCKS on nothing adjudicated at all" | a silent zero is not a pass (Rule 18) |

### What this layer CANNOT do (Rule 22)

`expectedAbsorbed` returns 0.95 / 0.70 / 0.50 / 0.25 for the four classes. Those
are a labelled **HEURISTIC**, not physiology, and the suite cannot tell whether
0.70 is right for an ALLOWED prescription — only whether the comparison was
made and the ranking is coherent. Calibrating them needs outcome data that does
not exist yet, and pretending otherwise would be the "confident, well-formed,
wrong" failure the layer exists to stop.

It also does not yet **fetch** — a caller supplies the facts. Wiring it into
plan authoring and into the adaptation promotion path is the next step, and it
is deliberately separate so the reasoning could be tested before it could block
anything real.

---

## Remaining, named

1. **Wire `checkPromotion` into plan authoring and adaptation promotion** so it
   blocks in production, not only in tests.
2. **DOSE-RESPONSIVE-TAPER** — every reader needed to re-price 11-22 from Malibu
   execution, recovery, HR behaviour and recent load exists and is tested;
   nothing re-SIZES a dose from them.
3. **MOVE-A-RUN** — one of the two remaining breaks in the coaching loop.
