# Runner experience contract

**Locked 2026-09-03 by David.** Covers the watch, post-run, races-as-evidence,
the proposal experience, notifications, and the edges. Read with
`ADAPTATION_ENGINE_CONTRACT.md` and `RESCHEDULING_CONTRACT.md`.

## The defining capability  (Q60)

> **faff.run should be best at turning completed training into the right next
> prescription on a coherent path toward the runner's race goal.**

Today's session and the last workout's meaning are its two most visible
expressions — **but they are not the whole product.**

```
Understand current ability
  → prescribe the right training
    → observe what actually happened
      → update the relevant evidence
        → adapt the correct lever
          → preserve the coherent path toward the goal
            → explain the decision plainly
```

**Polish priority order — this governs the whole programme:**

1. Correct prescription
2. Correct capture
3. Correct interpretation
4. Correct adaptation
5. Clear explanation
6. Race and post-run depth
7. Additional visual polish

> **"A beautiful sentence attached to the wrong workout or wrong adaptation is
> not success."**

---

## Watch  (Q41-Q43)

**Marathon-effort segment:** pace range as the primary target · current/lap pace
against it · **HR ceiling as a secondary guardrail** turning **amber** on
approach or excess · **no red failure state from a momentary excursion** · a
concise instruction when they disagree — *protect the effort rather than forcing
pace.* No raw confidence, no competing marathon paces, no coaching grade mid-run.
*"The watch should help execute the current segment, not explain the entire
model."*

**Off-plan running — hard recording principles.** Never stop recording
automatically · never discard activity after the final structured phase · **never
truncate because the prescription ended** · never prevent continuing · never
rewrite what happened to match what was planned.

On finishing structured work: *"Workout complete. Continue running or finish
recording."* Additional running is recorded as an **explicit unstructured
continuation phase**.

18 completed against a prescribed 15 → post-run reports separately: prescribed
workout completed · three additional miles recorded · the additional load ·
whether they changed the achieved stimulus · whether adaptation finds them
relevant. **Do not praise extra distance automatically. Do not classify it
automatically as failure.**

**Grading moves server-side.** The watch may show factual execution feedback —
segment complete, rep count, current vs target, pace range, HR ceiling, elapsed
and remaining work. It **must not** issue the canonical FULL / SUBSTANTIAL /
PARTIAL / DIFFERENT / INSUFFICIENT grade, which requires full activity
reconciliation, reliable segmentation, source comparison, context and evidence
adjudication. A provisional factual summary after stopping is allowed, **clearly
labelled provisional**.

## Post-run  (Q44-Q46)

**Matched workouts match by intended coaching stimulus and structure**, not
activity type or whole-run distance. Rank by: same session family and intended
stimulus → similar work duration/distance → similar segment structure → similar
prescribed intensity → similar point in a marathon block → similar terrain and
conditions → recency. Prefer within the current block; fall back to the nearest
defensible match within ~180 days.

**Always state the basis:** *"Compared with your previous 4 × 1-mile threshold
session."* — never merely "matched run."

Compare work-segment pace · HR-pace relationship · rep consistency · recovery
behaviour · late-session deterioration · total intended work · stimulus grade.
**Do not compare whole-run average pace** where warm-up, recovery or cool-down
differences make it misleading. **If no defensible match exists, say so rather
than forcing one.**

**Always state what happens next, even when nothing changes.** Distinguish
immediate factual interpretation · evidence recorded · pending weekly arbitration
· final adaptation decision. *"Do not imply that every workout should produce a
plan change."*

**Density:** one concise coaching paragraph on Today, one post-run, one meaningful
summary per week on Block. Everything else behind progressive disclosure. **Do
not use multiple cards to restate the same conclusion.**

## Races as evidence  (Q47)

| Race | Effect |
|---|---|
| **Santa Monica B 10K** | may move threshold, high-intensity capacity and the CIM projection **modestly**, if genuinely raced, course and conditions understood, result complete and canonical, and recent training does not materially contradict it. **One 10K must not create a large marathon projection change** — durability remains uncertain |
| **Dodgers controlled C 10K** | **not a race-performance result**; its finish time is not maximum-capacity evidence. May contribute controlled pace-to-HR relationship, execution discipline, training load, the combined weekend, and durability observations actually present in the data. **Must not independently move threshold or race projection** |
| **Run Malibu B half** | **the strongest planned single predictor of CIM capability.** May move the projection materially, but **bounded**, and must reconcile execution, course and conditions, HR and pacing, durability evidence, marathon-specific long runs, existing threshold capacity, and whether it was raced fully or controlled. *"One half may create a meaningful proposal. It should not erase all other evidence."* |

## Evidence validity — LEVER-SPECIFIC  (Q48)

**No universal 28/90-day window.**

| Lever | Strongest | Useful with decayed confidence |
|---|---|---|
| Threshold / high-intensity pace | ~28-42 days | through ~90 |
| Race results | ~42-90 days, by distance and subsequent training | |
| Weekly-volume capacity | most recent 28-56 days | longer history retained as context |
| Long-run durability | ~90-180 days | recent comparable runs weighted higher |
| Marathon-specific execution | the current race-specific phase | |
| Historical PBs | context only | **never sufficient alone to authorise a change** |

**Decay confidence and decision weight — never the historical measured value.**
Old evidence may establish prior capability or bounds; it cannot independently
prove present readiness to progress. **Persist the evidence policy and decay used
for every decision.**

## Source disagreement — FIELD-LEVEL provenance  (Q49)

One canonical fused activity, but **no blanket source preference.**

Workout identity, structured phases, lap events, on-device actions → **watch**.
Route and mapped geometry → the source with the complete trustworthy GPS trace,
often Strava. HR → closest to the original sensor with the most complete sample
series. Distance and pace → **resolved from the most trustworthy underlying
samples**, not automatically from either summary. Elevation → the canonical
corrected source. Elapsed and moving time → **preserve both; they answer
different questions.**

> **"Never average conflicting summary values merely to make them agree."**

Record both source values · the selected canonical value · the selection reason ·
the difference magnitude · per-field provenance · any unresolved uncertainty.
**Material disagreement lowers evidence confidence or prevents the affected lever
from using the run.** The canonical activity **must remain stable across
re-ingestion.**

## Unplanned races and hard efforts  (Q50)

**Classify what actually happened** — race effort, threshold, high-intensity,
long aerobic, or different/ambiguous — then count it as evidence for the levers
it genuinely tests. **Do not re-phase the block automatically.**

It still contributes recorded load, volume, relevant pace/HR evidence, race
evidence where appropriate, and execution/durability evidence.

If it displaced a prescribed session: **state the conflict** · do not pretend
both occurred · let the runner initiate the rescheduling proposal · let
adaptation account for the additional load · **do not silently delete or soften
training.**

## The proposal experience  (Q51-Q53)

**One canonical proposal rendered in three places** — Today when a decision is
required, Block when it affects future weeks, and the triggering post-run screen.
All share the same **decision ID, proposed change, reason, status and result**.
**No surface-specific proposals, and not three separate alerts.** Once resolved,
every surface updates.

**Three actions: Approve · Not now · Reject.** "Not now" defers, re-evaluated
only on new relevant evidence or at the next decision boundary. "Reject"
suppresses **that exact proposal** for the block, where identity is
`lever · direction · target value or magnitude · plan version · evidence version`.
**Do not re-offer a rejected change with trivial wording or value differences.**
Materially new evidence may create a genuinely new proposal, but the app must
**acknowledge the prior rejection and explain what changed.**

A permanent coaching preference — *never exceed X mileage* — is **a separate
explicit constraint, not proposal rejection.**

**Before evidence exists**, one concise state in the plan/adaptation detail — not
a daily card: *"The coach is collecting evidence from your first threshold
sessions and long runs. No change is justified yet."* Name what is awaited, when
the first useful review can occur, and what the baseline assumes. **Never
fabricate "on track" before the evidence exists.**

## No direct workout editing in this version  (Q54)

Guided actions only: reschedule · request a shorter version · request an
alternative workout · mark a scheduling constraint · review a coach-proposed
modification. Each returns a coherent, explained, validated diff before writing.

> *"Do not allow arbitrary editing of repetitions, pace, distance, or workout
> type without re-authoring the workout contract. That would destroy the
> relationship between prescription, evidence, and adaptation."*

Recorded as a deferred capability.

## Notifications  (Q55)

**Only:** a proposal awaits a decision · a rescheduling decision awaits approval ·
a sync or data problem the runner can fix · a material plan operation failed · the
A-race execution plan has locked · an approved change was applied or rolled back.

**Never:** streaks · generic encouragement · daily readiness · routine evidence
collection · "no change" results · every completed workout · background technical
activity.

## Weekly coach log  (Q56)

**Exactly one canonical weekly entry**, answering: what the week intended · what
was completed · what important stimulus was achieved · what evidence changed ·
what did not change · what adaptation decided or deferred · what next week is
trying to accomplish. Delete or consolidate duplicates. **Historically stable —
future model changes must not silently rewrite what the coach said at the time.**

## Plan visibility  (Q57)

Current week in full detail · the block as a concise outline · any future week on
demand · milestone workouts visible from the overview.

**Label future weeks "planned", not "forecast".** *"A plan should still feel like
a commitment."* When adaptation changes a future week: highlight what changed,
explain why, preserve the prior version, allow inspection of the diff. **Do not
make the plan feel provisional everywhere merely because it can adapt.**

## After CIM  (Q58)

Race result and execution breakdown · comparison with the prescribed race plan ·
what the block developed · where execution or preparation differed · major
evidence learned · a concise retrospective · recovery guidance **only if
explicitly requested**.

**No automatic next plan.** Offer explicit choices: take a break · start another
race build · maintain fitness · review goals.

## Injury  (Q59)

**The runner pauses the plan explicitly.** Pause stops presenting workouts as due
and preserves the complete plan and history. **No diagnosis · no severity
inference · no rehabilitation prescription · no return-to-run ladder · the pause
is not failed fitness evidence · the race goal is not silently moved.**

On resume: ask whether to continue unchanged or receive a proposed calendar
rebuild. Short pause → minimal schedule shift. Materially longer → explain the old
progression may no longer fit and present a new plan preview. **Nothing writes
without approval.** Preserve the original version and rollback.

> *"The user owns the injury and return decision. The app owns explaining the
> scheduling consequences."*
