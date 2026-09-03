# Rescheduling contract

**Locked 2026-09-03 by David.** Runner-initiated only. Read with
`ADAPTATION_ENGINE_CONTRACT.md` — these are different systems and must stay so.

> **Rescheduling solves an explicit calendar constraint. It does not rewrite
> history, update fitness, or conceal a compromised stimulus.**
>
> **The best option preserves the most important training value while making the
> smallest coherent change to the surrounding plan.**

Adaptation changes training because demonstrated capacity changed. Rescheduling
changes placement because the runner supplied a constraint. **Separate typed
decisions, owners, records and mutation paths.** A reschedule never updates
fitness beliefs and never counts as evidence the plan was too demanding.

---

## Search window  (Q31)

A **search boundary, not an automatic permission**.

| Session | Window |
|---|---|
| Long run | ±3 days |
| Quality | ±2 days |
| Easy / recovery | within the surrounding week |
| Adjacent calendar week | only when no in-week option preserves the important stimulus |

Expand only on an explicit runner request. **Rank by physiological and plan
disruption, not calendar distance.**

**Worked, for the live case (long run Sunday 2026-09-06, 15.0 mi):**
- Saturday 09-05 may be least disruptive **if available** — provided Friday stays
  easy and Thursday's intervals leave adequate separation.
- Monday 09-07 is viable, **but Tuesday's threshold must move later** so it does
  not immediately follow the long run.
- **Do not assume availability.** Ask him to mark available dates and rank only
  feasible candidates.

## Separation between demanding sessions  (Q32)

Minimum **one complete easy or rest day** between ordinary demanding sessions.

| After | Before the next quality session |
|---|---|
| Long run < ~16 mi | ≥1 easy/rest day |
| Long run 16-18 mi | 1-2 easy/rest days, depending on whether it carried quality |
| Long run 18+ mi or marathon-specific | ~2 easy/rest days |
| Threshold, intervals, raced B effort, marathon-specific | ≥1 complete easy/rest day |

Back-to-back demanding days require an **explicit authored transaction**, as with
the Dodgers weekend.

**Also evaluate elapsed time** — *"'One day apart' can mean barely 24 hours."*
Prefer **~36-48 hours** between ordinary demanding sessions.

> *"Reject accidental back-to-back hard days. Do not offer them merely because no
> clean option exists; instead explain that preserving everything is impossible
> and show the least-cost compromise."*

## The following session  (Q33)

A one-off **6-day gap is acceptable** when both sessions are not extreme long
runs, the first carries no major marathon-specific demand, the intervening
schedule provides recovery, and the second stays coherent.

**For the live case:** 09-13 is the **Santa Monica 10k**, not another long run —
treat it as the next demanding event. A 15-mile long run on Mon 09-07 followed by
a B 10K on Sun 09-13 is acceptable **provided** Tuesday becomes easy rather than
threshold; the displaced threshold either moves to a defensible later date **or is
removed because the B race supplies that week's principal quality stimulus**; no
additional major quality is crowded between; and the race week's total stays
coherent.

> *"Do not recursively move subsequent weeks unless the local repair cannot
> satisfy the plan invariants."*

## Protected weeks — protect the PURPOSE, not the label  (Q34)

| Week | Rule |
|---|---|
| **A-race week** | no additional long or quality work moved in |
| **B-race week** | only if it does not compromise the race's purpose, recovery or total demand; the B race normally replaces a quality stimulus |
| **C-race week** | more flexible — the race may itself be a controlled training session — but the complete race transaction must stay coherent |
| **Taper** | **no importing long-run or quality load from earlier weeks.** A workout already belonging to taper may move locally only if taper volume and recovery stay intact |
| **Cutback** | only if the resulting week still performs its recovery function. *"Do not preserve one workout by destroying the planned reduction."* |

## Splitting a long run  (Q35)

> *"Do not describe a split run as preserving a durability or marathon-specific
> long run. It does not reproduce continuous time on feet, fueling practice,
> late-run mechanics, or sustained marathon effort."*

For durability or marathon-specific long runs: **move the complete workout**; if
impossible, offer an **honestly shortened continuous run**; treat splitting as a
**different substitute stimulus, not an equivalent reschedule.**

A split may be offered for an early base-phase long run whose purpose is general
aerobic volume — as a last choice, with the lost continuous-duration benefit
**stated explicitly**. **Never split marathon-pace segments across two days and
call the original stimulus preserved.**

## A workout with no matching activity  (Q36)

**Do not immediately label it "missed."** Display:

> **No completed activity was matched to this workout.**

Because the cause may be: not completed · device did not sync · recorded
elsewhere · matching failed · deliberately skipped.

**Behaviour:** no automatic plan change · no fitness inference · no negative
coaching judgement · no retrospective automatic reschedule · allow him to attach
an activity, mark it skipped, or leave it unresolved · allow him to initiate a
future replacement explicitly.

> *"A past workout cannot literally be moved into the future. If the runner wants
> to recover its value, create a new proposed FUTURE schedule transaction with
> lineage to the uncompleted workout."*

## Identity of a moved or modified workout  (Q40)

**A pure date change** with identical distance, structure, purpose and
prescription **remains the same workout instance**, with rescheduling lineage.

**Any change to distance, structure, intended intensity or purpose creates a
revised workout VERSION linked to the original.** Preserve: original workout ID
and version · original date and prescription · the rescheduling decision · new
version · new date and prescription · **reason for any reduction** ·
stimulus-preservation assessment · undo information.

**The two questions, which must never be collapsed into one:**

1. **Did the runner execute the workout that was ultimately prescribed?**
   → `executionGrade`
2. **How much of the ORIGINAL intended training stimulus was preserved?**
   → `stimulusPreservation`

Worked example — 15 miles becomes 12:

- Completing 12 may earn `executionGrade: FULL` against the revised instruction.
- It must **not** earn full credit for the original 15-mile durability demand.
- Record `stimulusPreservation: PARTIAL`.
- **Load and durability evidence use the 12 miles actually completed.**
- The app says the revised workout was completed as asked **while acknowledging
  that some of the original long-run stimulus was sacrificed.**

> **"Never change the prescription after completion to convert an undercompleted
> workout into FULL."**
