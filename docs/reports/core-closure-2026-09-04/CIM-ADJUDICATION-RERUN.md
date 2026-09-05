# CIM adjudication, re-run on corrected history

Plan `pln_7636bcc0a201bf2d`, authored 2026-09-03, California International
Marathon 2026-12-06. Re-run 2026-09-04 after the first trace was rejected.

**Nothing here has been written to your plan.** This is the reasoning, offered
for your decision.

## How to read the scores

Every number below carries its provenance, because you asked for exactly that
separation and the first version did not have it.

| Provenance | Meaning |
|---|---|
| ATHLETE EVIDENCE | measured from your completed training |
| CALCULATED PHYSIOLOGY | derived from a research table, traceable to `Research/` |
| POLICY ASSUMPTION | somebody chose it. Defensible, not measured, not research |

The ranking score is **POLICY ASSUMPTION throughout**. It is ordinal, it orders
three options, and it is not a prediction of what you will absorb. It was called
`expectedAbsorbed` and described as an expectation while being a fixed lookup
table; that was defect 4 and it is now named `heuristicRankScore` and labelled.
Calibrating it properly needs a season of graded sessions, which does not exist
yet, and substituting a fitted curve on the handful of graded sessions you have
would replace an admitted guess with a disguised one.

Ranking weights, all POLICY ASSUMPTION: stimulus PUSH 1.00, HOLD 0.85,
PULL_BACK 0.60. Evidence SUPPORTED 0.95, ALLOWED 0.70, CONDITIONAL 0.50,
CONTRAINDICATED 0.25, UNKNOWN null.

## Sequence 1 · the 60.0 mile week of 2026-10-26

The one real question in the block.

**Evidence.** Peak demonstrated week **48.5 mi** (w/c 2026-02-09, five running
days, 20.0 long) — ATHLETE EVIDENCE. Six weeks at 44+ in 2026. 60.0 is **+23.7%**
on that, which is a genuine reach.

**Time-relative evidence**, which is defect 1 and changes the answer. The block
does not jump there. It asks 55.2 (w/c 09-21), then 59.5 (10-05), then 59.6
(10-12), then 60.0. Judged against 59.6, the 60.0 week is **+0.7%**, the smallest
step in the chain rather than the largest. That projection is a POLICY
ASSUMPTION, not a measurement: it assumes you execute September and October.

| Option | What it is | Class | Score today | Score if the chain holds |
|---|---|---|---|---|
| **HARDER** · PUSH | run 60.0 as authored | ALLOWED today, SUPPORTED against projection | 0.70 | **0.95** |
| **HOLD** | cap the week at 55 | SUPPORTED | **0.81** | 0.81 |
| **EASIER** · PULL_BACK | cut to 48-50, your demonstrated peak | SUPPORTED | 0.57 | 0.57 |

**The verdict is conditional, and that is the honest answer rather than a hedge.**
Today the hold wins. If you complete the September and October weeks, the push
wins outright. So the layer neither fixes 60.0 today on evidence that does not
exist, nor deletes it.

**Earning gate.** Assessed 2026-10-12. Requires a 55 mi week completed by
2026-09-27 and a 59 mi week completed by 2026-10-12, neither carrying a session
graded MISSED. If unmet, the week REDUCES to 55.0 rather than being dropped.

## Sequence 2 · the 21.5 mile long run, 2026-11-01

**I had this wrong and it was the largest error.** I reported it as +19% over a
demonstrated maximum of 18.0. Your longest run of 2026 is **21.51 mi, on
2026-01-25** — ATHLETE EVIDENCE. The step is **minus 0.05%**. You have run this
distance.

| Option | Class | Score |
|---|---|---|
| **HARDER** · PUSH · run 21.5 as authored | SUPPORTED | **0.95** |
| **HOLD** · 20.0, matching 2026-04-05 | SUPPORTED | 0.81 |
| **EASIER** · PULL_BACK · 18.0 | SUPPORTED | 0.57 |

**Keep it.** No gate needed. Its position is also correct: 2026-11-01 is 35 days
out, inside the 4-to-5-week window `Research/00a` puts a peak long run in.

## Sequence 3 · 6 miles at threshold, 2026-10-27 and 2026-11-03

**First a correction you are owed.** There is no 10-mile marathon-pace dose in
your plan. I merged two quantities under one name, which is Rule 16 and it was
mine. The 10-mile figure is the *session* total: 2 mi warm-up, **6 mi at
threshold (7:10/mi)**, 2 mi cool-down. The largest marathon-pace dose anywhere in
the block is 2026-10-18 — 8 miles of M inside a 20-mile long run, split 5 + 1
easy + 3, so the largest continuous M block in the whole block is **5 miles**.

**Evidence for 6 mi at 7:10.** You raced 13.38 mi at **7:06/mi** on 2026-02-01
and ran 12.37 mi at **7:21/mi** in training on 2026-08-09 — both ATHLETE
EVIDENCE. Six miles at 7:10 is under half that duration at a pace you have held
for twice as long.

| Option | Class | Score |
|---|---|---|
| **HARDER** · PUSH · 6 mi at T as authored | SUPPORTED | **0.95** |
| **HOLD** · 5 mi at T | SUPPORTED | 0.81 |
| **EASIER** · PULL_BACK · 4 mi at T | SUPPORTED | 0.57 |

**Keep it.**

## Sequence 4 · 16 miles seven days after Malibu, 2026-11-15

**Correction: it is 16 miles, not 18** — 16 mi with 4 mi at M.

You were right that one comparison is not a capacity limit, and it was worse than
that: I took the **minimum** of a three-element set and called it your ceiling.
What you actually did at exactly D+7 after each 2026 half — all ATHLETE EVIDENCE:

| Race | D+7 | Miles |
|---|---|---|
| Rose Bowl Half 01-18 | 01-25 | **21.51** |
| Disney Half 02-01 | 02-08 | 17.21 |
| AFC Half 08-16 | 08-23 | 11.01 |

Your longest run of the year came seven days after a half marathon. The ceiling
claim is now the maximum of the set, 21.51, and it requires at least three
comparables before it may refuse anything at all. 16 is comfortably inside it.

| Option | Class | Score |
|---|---|---|
| **HARDER** · PUSH · 16 mi with 4 mi at M | SUPPORTED | **0.95** |
| **HOLD** · 16 mi easy, drop the M | SUPPORTED | 0.81 |
| **EASIER** · PULL_BACK · 13 mi easy | SUPPORTED | 0.57 |

**Keep it. The earlier objection is withdrawn.**

## Sequence 5 · the stacking in the week of 2026-10-26

6 mi at T on Tuesday, 9x3 min at I on Thursday, 21.5 long on Sunday. Three
stressors, 60.0 miles.

The triple-peak check does **not** fire: the long run is level with your
demonstrated maximum and the volume sits inside the allowed band, so volume,
long run and stressor count do not all peak together.

**But the honest answer here is that I do not know**, and Rule 11 says that is a
third fact rather than a pass. Your demonstrated maximum stressors in one week is
**not measurable from your data**: plan-linked execution identity only began
stamping in September, so there is no reliable record of how many quality
sessions you have previously carried in a single week. The class is UNKNOWN and
**the ranking score is deliberately null. The layer refuses to rank this rather
than invent a number.**

**Earning gate instead.** The block already contains an earlier three-stressor
week at similar volume: **2026-10-05, 59.5 mi, intervals plus tempo plus an 18.5
long.** That week is the evidence this one needs. Assessed 2026-10-12: if the
10-05 week completes with no session graded MISSED, the 10-26 stacking becomes
SUPPORTED. If it does not, the Thursday interval session drops and the week runs
two stressors.

## What changed, in one line

I previously recommended cutting roughly five miles of volume and one stressor.
**On corrected history I withdraw that.** The plan is closer to right than I said:
the long run is earned, the threshold dose is earned, the post-Malibu long run is
earned. The volume is the single real reach, and the answer to it is a gate
rather than a cut.

## What is not settled

- **Weekly demand** is still computed as mileage against a ceiling. The real
  seven-component model (volume, intensity, long-run load, stacking, recent
  adaptation, recovery, injury) is in build and is defect 5. Until it lands, the
  demand column in every trace above is `null` and says so.
- **`checkPromotion` is not yet wired** into authoring or promotion, so this
  remains a tested prototype. That is defect 7 and it is in build.
- **Arbitration reading C** and the full-history counterfactual are in build.
- **The ranking score is uncalibrated.** Named, labelled, and still a guess.
