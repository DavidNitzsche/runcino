# Handback 2 · the rebuild preview, and two rulings

Covers everything since the last handback. **The live plan has not been
rebuilt.** No production write of any kind.

---

## 1 · In one paragraph

The rebuild-anchoring fix is built, merged and deployed, and a rebuild now
restores the block to its own fifteen weeks instead of re-phasing it into
fourteen. Nine of the eleven proofs required before a rebuild pass; two report
CHANGED, and the reasons turned out to be more interesting than the fix. Along
the way: a flag called "goal realism" was found to be a typo screen and has been
renamed; the four race specifications were produced through the real production
path, which exposed that a C race is priced exactly like an A race; the volume
shape change was traced to a one-point crossing of a training-form threshold
that re-phases thirteen of fifteen weeks; and the runner ruled that readiness,
illness and injury may no longer influence training decisions at all.

---

## 2 · What is now true

| | |
|---|---|
| anchoring fix | **merged and deployed** (`b113a787`, deploy `success`) |
| live plan | **untouched**, `pln_9a57561debb776e5`, 103 rows |
| production writes | **zero**, verified through a read-only role |
| rebuild | **not performed**, awaiting approval |

---

## 3 · The anchoring fix

Every rebuild path passed neither `startAnchor` nor `startDateISO`, so the
composer defaulted to Monday of the *current* week.

| | Span | Weeks | Aligned starts |
|---|---|---|---|
| live | 2026-08-24 → 2026-12-06 | 15 | — |
| before the fix | 2026-08-31 → 2026-12-06 | 14 | 0 of 15 |
| **after** | **2026-08-24 → 2026-12-06** | **15** | **15 of 15** |

**And it was worse than re-phasing.** `persistPlan` writes only dates its
composed weeks cover, so an unanchored rebuild **would have dropped five
completed rows entirely** — the week 08-24 through 08-30, including the 13-mile
long run.

The `startDateISO` clamp was not loosened; it is an onboarding rule and correct
as one. This is a separate question with its own answer in
`lib/plan/block-anchor.ts`, resolved once at the chokepoint every authoring path
passes, with nine named refusals and a refusal branch that carries no
`anchorISO` field — so `.anchorISO` does not compile until the caller branches.

---

## 4 · Why the volume shape moved — not the anchor

Up to ±15 mi per week, and I had attributed it to the higher ramp base. Wrong.

```
cutbackCadence(tsb) = tsb < -10 ? 3 : 4
```

Training form read **−6** when the block was authored and **−11** today.
Crossing one point gives the block a fourth deload and **re-phases 13 of 15
weeks**. He sits one point from the boundary.

The remaining difference is **SPIKEROLL-1**, `Research/00a`'s 110%/30-day spike
rule — 1.0 mi off peak week and long. A doctrine-cited injury guard doing its
job.

The direction is the Rule 9 signature: train hard, accumulate fatigue, cross the
line, and the whole calendar re-phases off a single instantaneous reading. The
practical stake is that rebuilding today at −11 and rebuilding Thursday at −9
produce materially different blocks for the same runner.

---

## 5 · Peak volume — and a correction to my own advice

The previous handback said the engine was leaving 6.5 miles of headroom unspent
below the "advanced" band and should push into it. **That reasoned from the
label, which is exactly the error he named.** The band comes from
`profile.experience_level`, which reads `advanced` because he typed it at
onboarding.

His actual record, 35 weeks: highest week ever **48.5 mi**, **zero** weeks at
50 or above.

| Peak | vs his all-time best |
|---|---|
| composed 58.5 | **+20.6%** |
| live 61.0 | +25.8% |
| band floor 65 | **+34.0%** |

**Retain 58.5.** It is already an aggressive progression above a demonstrated
ceiling, and raising it to meet a self-declared category would be indefensible.

**But the long run does not hold up, and here his evidence argues the other
way.** His best training long run is **21.5 mi**; the live plan matches it and
the rebuild prescribes **20.5** — while the composer's own thesis names
`DURABILITY` the least-evidenced capacity with priority
`increase_long_run_demand`. Marathon-pace miles embedded in long runs fall
**20.5 → 5.0**; the live plan's eleven-mile marathon-pace long run, the most
race-specific session in the block, is dropped. A correction is in progress.

Also worth stating: the entire structural shape rests on a thesis held at
**confidence 0.51**, and nothing he can see says so.

---

## 6 · Goal realism was a typo screen wearing a feasibility name

It never asked whether the goal was realistic. It asked whether the goal's VDOT
sits more than 15% above resolved threshold capacity. `totalWeeks` is computed
six lines away and never passed; confidence and the likely range never reach it.

| anchor | edge | predicate | result |
|---|---|---|---|
| 44.1 | 50.715 | 53.5 > 50.715 | **true** |
| 47.8 | 54.970 | 53.5 > 54.970 | **false** |

One input moved: threshold capacity 44.1 → 47.8. At his anchor the band
tolerates **7.17 VDOT**, while the largest block gain the engine will model is
5.0. At the band's edge, current fitness predicts **3:22:33** against a 3:00
goal.

Renamed `goal_vdot_sanity` / `beyondSanityBand`, predicate unchanged, `goalVdot`
now always present, the read recomputing from the live anchor, ten
falsifications. **The stated goal is untouched and nothing renegotiates from
it** — verified: the one consumer route has no consumer at all.

---

## 7 · The four races, from the production path

Driven through `resolveAuthoringRaceSeed` → `persistedDayShape` →
`buildWorkoutSpec` (all twelve arguments) → `refreshRaceRowsForPlan`, then each
surface through its own resolver. The 6:52/mi artifact in the previous preview
was my harness, and it is gone.

| Date | Race | Role | Goal | Projection | Prescribed |
|---|---|---|---|---|---|
| 09-13 | Santa Monica 10k | B | none | 42:59 | **43:00 · 6:56** |
| 09-26 | Dodgers 10K | **C** | 45:00 | 43:04 | **45:00 · 7:15** |
| 11-08 | Run Malibu HM | B | 1:30:00 | 1:36:02 | **1:32:10 · 7:02** |
| 12-06 | CIM | A | 3:00:00 | 3:23:50 | **3:13:30 · 7:23** |

**The finding: `RaceForOutlook.priority` is loaded by the race-pace brain and
read nowhere in it. A C race is priced exactly like an A race.** The only reason
the Dodgers sits 2:04 slower than his expected 42:56 is a soft typed goal —
change it to 43:00 and the engine prescribes an all-out 10K the day before an
18-miler. Every structured field prescribes a full race: sub-label `RACE`, HR
168-176, a 179 bpm mile-2 abort, a brief saying *"Push the final mile on feel"*.
**Nothing on either day names the other.**

Two more, both live on his plan today: `plan_workouts.notes` is frozen at
authoring while `race-row-refresh` moves the number beside it — his Santa Monica
row reads "Coach target 7:24/mi" over a row at 6:56 — and the 12-01 race-week
tune-up is repriced to marathon pace while its reps stay at 6:41.

---

## 8 · Two rulings by the runner

**Volatile inputs may not re-phase a block.** Verified first that his fear did
not apply as stated: TSB is pure training load — CTL minus ATL from
`distance × intensity` of runs actually run, with no sleep, HRV, RHR or
watch-wearing term — and readiness never reaches the composer at all. But the
principle stands, and a run that fails to sync reads as "did not train," which
*raises* TSB and removes a down week.

**Readiness, illness and injury no longer influence training decisions.** His
words: *"I want to be the one who decides how ready I am or not ready… To have
a plan cheapen itself is not what I'm building here."* He chose full removal
over advisory, and included illness and injury — *"its noise. its a feature we
can add in later."* Removal is in progress. Measured context: `readiness_pullback`
has **never fired in production** for him, so this removes a capability rather
than changing an experienced behaviour. One consequence handled deliberately:
`tryAdaptiveBump` refuses to raise load within 48h of a recorded pull-back, and
that brake on the UPWARD path goes with it.

---

## 9 · Main stopped deploying, and the gate is what caught it

Three consecutive deployments failed. Cause: two parallel branches collided —
one retired the `goal_realism` identifier and added a ratchet asserting it is
gone, the other branched from an older base and added a proof script still
reading it. **The gate did its job**, and this is the first time one of these
ratchets has stopped a broken tree from reaching production. Fixed at
`5a845a46`.

Worth recording why `verify-commit.sh` reported CLEAN on the same tree: it runs
`tsc --noEmit` plus `next build`, and the vitest prebuild chain is not in its
scope. Rule 19's lesson one layer in — the chain that proves a commit is not the
chain that ships it.

---

## 10 · Still open

- The typed race-plus-long-run exception, and making `priority` load-bearing.
- Both Rule 9 cliffs: `cutbackCadence` and `lifted`.
- The long-run and marathon-pace correction.
- Readiness / illness / injury removal.
- **Adaptation remains unowned** — the last system.

Nothing above requires the rebuild. Nothing below the rebuild has been done.
