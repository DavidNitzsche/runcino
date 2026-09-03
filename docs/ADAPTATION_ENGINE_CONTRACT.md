# Adaptation Engine contract

**Locked 2026-09-03 by David.** The specification for P0-6. Read with
`PROGRESSIVE_BASELINE_DOCTRINE.md` (what the baseline must forecast) and
`PLAN_SIMPLIFICATION_DOCTRINE.md` (what may never influence either).

## The governing principle

> **Evidence is evaluated separately by lever, but every proposed change must
> survive recomposition of the complete plan.**

The engine must be able to say:

> *"Your threshold evidence supports a faster threshold pace, but this week
> already contains enough total demand, so the change is deferred until the next
> appropriate boundary."*

> *"That is not one lever improperly suppressing another. It is independent
> evidence followed by coherent plan-level arbitration."*

---

## Per-lever evidence contracts

### Threshold pace  (Q20)

Never moved by a single training session. Normally **≥2 independent qualifying
sessions within ~21-28 days**, on separate days, consistent in direction, no
material contradiction. Or **one well-executed 10K/half plus ≥1 corroborating
training session**. A 5K informs high-intensity capacity more than threshold; a
**marathon is not clean threshold evidence** — durability and execution dominate.

Bounded: **~3-5 s/mi** ordinary confirmed update; larger needs stronger and more
numerous evidence; **no same-day oscillation**; **idempotent on re-ingest**;
contradiction → **HOLD**, never a bouncing anchor.

### Weekly volume  (Q21)

- **≥3 consecutive non-cutback weeks** at **≥~95%** of prescribed volume.
- Key sessions **FULL or defensible SUBSTANTIAL**.
- Relevant long runs substantially completed.
- **No repeated meaningful late-session deterioration.**
- Data complete enough to evaluate the progression.
- Demonstrated-load envelope advanced.
- The proposed future plan passes **all** volume, density, race, long-run and
  taper invariants.

Movement: **≤~5%** above the affected prescribed week · **one upward step per
cutback cycle** · never retroactive · applies only **through the next cutback
boundary**, then re-evaluate · **does not automatically raise long-run distance
or workout intensity.**

> *"Three successful weeks should authorize a proposal, not force one. The engine
> may still HOLD if the existing plan already provides sufficient progression."*

### Long-run distance  (Q22)

- The **two most recent** relevant prescribed long runs at **≥~95%** of distance.
- **No meaningful late deterioration across both.**
- **No material execution failure in the following key session attributable to
  the long run.**
- Coherent with weekly volume.
- Satisfies the canonical rolling-load / spike rule.
- **Enough weeks remain** for the increase to serve the marathon build.
- Does not collide with a race, peak marathon-specific session, or taper.

Movement: **≤~1 mile** ordinary · **one increase per cutback cycle** · not
alongside an aggressive marathon-effort-volume rise in the same proposal · does
not exceed the evidence-derived long-run envelope without stronger corroboration
· recomposes only through the next cutback or race boundary.

> **Faster threshold work must never independently authorize a longer long run.**

---

## Cadence and reach  (Q23)

**Evaluate:** after a relevant completed quality session, long run or race · at
the **weekly boundary** once the week's evidence has settled · after a materially
corrected or **late-arriving** activity. **Never during a session. Never
duplicate proposals from repeated ingestion of the same evidence.**

Session-triggered evaluation updates evidence and asks whether a lever has new
information. **Weekly evaluation arbitrates plan-level changes.**

**Idempotency key:** `athlete · plan version · evidence version · lever ·
evaluation boundary`.

**Reach is lever-specific:**

| Change | Reaches |
|---|---|
| Pace anchor | all relevant future sessions of that type, through canonical phase-aware offsets |
| Race projection | the outlook, immediately |
| Race execution | the coherent race contract and directly related rehearsals |
| Weekly volume | only to the next cutback boundary |
| Long run | only to the next cutback, tune-up race or taper boundary |
| Marathon-effort volume | only the relevant progression phase |

**No proposal may rewrite sealed or completed history.** Every affected future
session is **recomposed and validated — not patched numerically in isolation.**

---

## Arbitration when levers disagree  (Q24)

**Evidence contracts are independent; resulting plan mutations are not.**

- Each lever reaches its verdict independently.
- Convert proposed changes into a **common projected plan-load representation**.
- Evaluate their **combined** effect on the future plan.
- Do not apply two individually valid proposals when their combination makes the
  week incoherent.
- A volume or long-run **HOLD suppresses changes that materially increase the
  same week's total demand** — but does **not** automatically suppress a
  threshold-pace proposal.
- A small pace correction may proceed if it preserves intended stimulus and all
  invariants.
- **Prefer one material lever per evaluation cycle** so the response stays
  attributable.
- **Atomic bundles only for inseparable changes** — e.g. a threshold anchor plus
  repricing its threshold sessions.
- **Record suppressed proposals and why they were deferred.**

> *"Do not let one unrelated HOLD freeze the entire engine. Do not pretend pace
> changes are load-neutral."*

---

## The conditional race target  (Q25)

**Owner approval.** Meeting the criteria creates an **owner-visible proposal**;
it does not promote automatically during the initial authority phase.

Re-evaluate at each weekly boundary · after every marathon-specific long run ·
after a relevant tune-up race · after a material capacity-anchor change.

Show: current active execution target · conditional upside · **criteria already
satisfied** · **criteria still missing** · evidence per criterion · proposed
race-plan diff · effect on related future rehearsals.

> *"Automatic race-target promotion requires its own later promotion record. It
> should be among the last automatic authorities granted because of its
> consequence and visibility."*

---

## Course adjustment  (Q26)

**Two typed quantities**, and the canonical course model applied **exactly once**:

```
flat-equivalent capability
  → one canonical course adjustment
    → course-specific finish target
      → mile-by-mile pacing plan that SUMS to that target
```

The **course-adjusted target is the actionable race number**; the flat-equivalent
figure is explanatory context. The split plan may redistribute effort for
climbing and descending, but **its total must reproduce the course-adjusted
target**. Never adjust the overall target and then apply another net course
benefit inside the splits.

Persist: flat-equivalent target · course adjustment in seconds · **coefficient
and model version** · course-specific target · split-plan total · any confidence
or course-data limitation.

> *"The downhill adjustment should be modest and evidence-bounded. It must not
> create a materially more aggressive race plan merely because CIM is net
> downhill."*

---

## Evidence admissibility

### Representativeness is LEVER-SPECIFIC  (Q27)

> *"Do not globally admit or reject an entire activity when different parts
> remain useful."*

**Excluded or adjusted for raw pace-anchor evidence:** uncalibrated treadmill ·
trail · materially hilly without trustworthy grade adjustment · strong wind
without trustworthy adjustment · materially different altitude · heat/humidity
without a supported adjustment · deliberately altered-effort sessions · missing,
unreliable or incorrectly segmented work phases · paused or interrupted work that
materially changes the stimulus.

**Still admissible for:** completed duration · recorded distance · weekly volume ·
consistency · time on feet · long-run completion · HR/effort evidence where the
sensor and context are reliable · durability evidence where surface and terrain
are relevant · **the fact that a workout occurred, even when it cannot price
pace.**

Heat and grade adjustments only where the canonical models are validated, and
**adjustment uncertainty is carried into the evidence weight**. A session
prescribed at a deliberately different effort supports **the lever it actually
tests, not the lever its nominal label implies.**

### Treadmill  (Q28)

Counts toward distance · duration · weekly volume · load · consistency · workout
completion · time on feet. **Never moves road, threshold, marathon or race-
projection pace.** May contribute HR/effort evidence when HR is reliable, the
work structure is complete, environmental difference is acknowledged, and no
claim depends on displayed pace being road-equivalent. Any future
treadmill-to-road calibration must be **a separate versioned evidence source, not
an implicit assumption.**

### Truncated activities  (Q29)

Count **only recorded** distance and duration · carry an explicit **provenance and
incompleteness flag** · **never infer the missing distance** · repair only from
trustworthy raw source samples · **not usable for late-session deterioration** ·
**absence of a captured late decline is not evidence of durability** · the
missing portion is **not** failed training.

Complete, correctly segmented work intervals captured before truncation may give
pace or threshold evidence if truncation did not affect them — with reduced
confidence and a record of exactly which portions were admitted.

For earned-volume decisions: passes on recorded data alone → truncation need not
block it. Missing portion needed to pass → **refuse for insufficient evidence**.
Truncation makes a required assessment unknowable → **do not claim that criterion
was satisfied.**

> *"Do not allow one known small truncation to invalidate an entire multi-week
> progression automatically."*

---

## How marathon effort is prescribed  (Q30)

**A pace range, plus a canonical HR ceiling, plus plain-language effort
guidance.** Every marathon-effort prescription carries: the pace range for that
workout and phase · an HR ceiling from the canonical HR owner · how the effort
should feel · **what to do when pace, HR, terrain and conditions disagree**.

His example form:

> *"Run the marathon-effort segments around 7:48-7:56/mi. Keep the effort
> controlled and sustainable, with HR below the prescribed ceiling. On hills or in
> heat, protect the effort rather than forcing pace."*

**Do not hardcode 160 bpm** if the canonical model produces a different
defensible ceiling.

**Grading combines channels:**

| Outcome | When |
|---|---|
| `FULL` | prescribed work completed predominantly within the pace range without violating the HR/effort ceiling |
| `SUBSTANTIAL` | conditions reasonably slowed pace, but HR, effort and structure support the intended stimulus |
| `DIFFERENT_STIMULUS` | pace achieved only through materially excessive effort |
| `PARTIAL` | a meaningful portion missed |
| `INSUFFICIENT_EVIDENCE` | relevant data unreliable |

> *"Pace remains important because this is race-specific training. HR is a
> ceiling and corroborating signal — not an alternative target that allows any
> pace to count."*

---

# Presentation rulings · locked 2026-09-03

## Race execution lock  (Q37)

Lock the primary execution plan **~10 days before the A race**, after the last
session expected to materially change the fitness evidence.

Re-evaluate at: the final major marathon-specific workout · the 10-day lock · any
late-arriving evidence correction **before** the lock.

**After locking:** fitness-based target changes require **runner approval** ·
preserve the uncertainty range · a **separate conditions layer** may adjust
pacing execution for material weather or course conditions · **never represent a
weather adjustment as changed fitness** · ordinary daily fluctuation must not
reopen the target.

**By ~3 days out:** one clear primary plan, one conservative fallback, and
**explicit switch criteria**.

## What each stimulus grade means to the runner  (Q38)

| Grade | The sentence | Rule |
|---|---|---|
| `FULL` | *You completed the workout and achieved its intended training effect.* | name the strongest supporting evidence; **do not say "perfect"** |
| `SUBSTANTIAL` | *The workout still did its job, with an adjustment or small execution difference.* | explain what differed and why the benefit was substantially preserved |
| `PARTIAL` | *You completed useful work, but not enough of the intended session to receive the full training effect.* | state what was completed and what was missing, **without scolding** |
| `DIFFERENT` | *This became a different workout from the one prescribed.* | explain the stimulus actually achieved — **a different stimulus may still be useful; it is not failure** |
| `INSUFFICIENT` | *There is not enough reliable information to judge the workout.* | name the missing or unreliable data. **Never translate insufficient evidence into a bad workout.** |

**Every grade carries a separate plan-consequence line:** no plan change ·
evidence recorded, more confirmation needed · adaptation proposal available ·
existing proposal held or refused.

> *"Do not imply causation between the grade and a plan change unless the
> canonical Adaptation Engine made that decision."*

## Confidence display  (Q39)

**Never show raw confidence decimals in the normal coaching experience.**
Translate uncertainty through: a useful range · evidence count and type · a
plain-language limitation · **what evidence would make the conclusion stronger.**

His examples:

> *"This is supported by two recent threshold sessions."*
> *"This rests mainly on a population expectation; your own response is not
> established yet."*
> *"The range is wide because only one comparable long race is available."*

Raw values, model versions and component weights stay in the **auditable decision
detail**. An advanced diagnostic view may expose them later; they must not lead
the runner-facing experience.
