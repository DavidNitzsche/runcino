# The 2026-09-21 gate, corrected

The previous gate read "the 46.8 mi week completed with no session graded
MISSED." That is a mileage-and-attendance test, and it cannot see whether the
work was absorbed. Replaced with eight conditions.

**Nothing has been written to the plan.**

## The week as authored

| date | session | mi | stressor |
|---|---|---|---|
| 09-21 | easy · 6x20s strides | 5.0 | |
| **09-22** | **tempo · 2 WU + 5.5 @ T + 2 CD** | **9.5** | **yes** |
| 09-23 | easy · medium-long | 9.5 | |
| 09-25 | easy · 6x20s strides | 8.0 | |
| 09-26 | Dodgers 10K | 6.21 | yes |
| 09-27 | long | 17.0 | yes |
| | | **55.2** | **3** |

- **+13.8%** on his demonstrated peak week of 48.5. ALLOWED, not supported.
- **+18.0%** on the trailing max of 46.8, **and** stressors go 2 to 3.
  `Research/00a` §"Practical load rules": *"Either add mileage OR add intensity
  in a given week, not both."* **Violated.**

This is the only week in the block that blocks promotion.

## The eight conditions

Assessed **2026-09-20**, the last date the answer can still change the week.

| # | Condition | Owner | If unreadable |
|---|---|---|---|
| 1 | **Completed mileage** of the 09-14 week reaches 46.8 | canonical rows, `NOT (data ? 'mergedIntoId')` | refuse |
| 2 | **Quality execution**: the 09-18 threshold session graded FULL or SUBSTANTIAL | `gradeStimulus` | refuse |
| 3 | **Late deterioration**: no material fade in the final third of that session or the 09-20 long run | `deterioration.ts` | refuse |
| 4 | **HR validity**: the work phases carry a credible trace, not a held value | `hr-trace-credibility.ts`, `work-hr-ceiling.ts` | **condition drops out**, it cannot refuse on a read it did not get |
| 5 | **Recovery**: the days after the 09-20 long run are run, not skipped | execution identity | refuse |
| 6 | **Pain / niggle**: no open niggle and no escalating pain report | `safety-verdict.ts` | **HARD STOP, not a refusal** |
| 7 | **One stressor at a time**: the week may not add mileage AND intensity | `detectSimultaneousStressAddition` | structural, always readable |
| 8 | **Enough evidence by the deadline**: conditions 1 to 5 have data by 09-20 | | refuse |

Condition 4 is the one that must not be a wall. A missing HR trace is an absent
read, and Rule 11 says an absent read is not a failure. It withholds its
contribution and the other conditions decide.

Condition 6 outranks everything, including a clean sweep of 1 to 5. The
objective never overrides a hard stop.

Condition 7 fails **today**, on the plan as authored, before any of this is run.

## If the gate fails · the exact mutation

Three candidates were priced. Only one clears both findings.

| | change | week | stressors | volume | one-at-a-time |
|---|---|---|---|---|---|
| **A** | **09-22 tempo becomes an easy 7** | **52.7** | **2** | **+8.7% · SUPPORTED** | **clear** |
| B | Dodgers run as a C-effort easy 6 | 55.0 | 2 | +13.4% · still a reach | clear |
| C | shave the two easy days by 6.7 | 48.7 | 3 | +0.4% · SUPPORTED | **still violated** |

**A is the answer, and exactly one row changes.**

```
UPDATE plan_workouts
   SET type = 'easy', distance_mi = 7.0, sub_label = 'EASY',
       pace_target_s_per_mi = NULL
 WHERE plan_id = 'pln_7636bcc0a201bf2d' AND date_iso = '2026-09-22';
```

**Not executed.** Stated so it can be reviewed, and so the proposal the engine
would raise is legible before it is raised.

**Why not C**, which is the cheapest arithmetic: it takes 6.7 miles out of easy
running to protect a quality session, and CLAUDE.md Rule 12 is explicit that
easy running is sized first and quality fits into what remains. It also leaves
the one-at-a-time violation exactly where it was. It fixes the number this gate
measures and not the thing the gate is about.

**Why not B**: dropping the tune-up leaves volume a reach and costs a race he
entered, to fix the smaller of the two findings.

## What happens if the gate PASSES

The 55.2 week runs as authored, and every later week is already supported
against the chain it builds. The 09-21 week is the only gate in the block; the
60.0 peak on 10-26 is +0.7% on what precedes it.

## What this still does not do

It is a specification and a priced mutation, not a wired gate. The evaluator
that would run it exists (`lib/plan/adjudication/dose-responsive.ts`) and has no
caller, which is recorded as an argued orphan. Until something calls it on
2026-09-20, this is a decision written down rather than a decision the system
takes.
