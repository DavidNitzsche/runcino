# Dataset correction — the CIM trace was built on a truncated history

Defect 1 of 7. Everything else in the re-run depends on this, so it is settled first.

## The verdict

**The previous production audit was right and my trace was wrong.** 21.51, 20.02 and
20.00 are real, canonical, non-merged training runs in this account. My trace's claim
that "18 miles is his longest run of 2026" is false.

## Why it happened

My history query carried `AND (data->>'startLocal') >= '2026-06-01'`. That window was
correct for the question it was originally asked (recent training), and I then reused
its output to answer a different question (longest of 2026) without changing the
filter. It is CLAUDE.md Rule 14 exactly — a query that ran without error and read a
population nobody intended — and Rule 16, one quantity carrying two names: "longest
recent run" and "longest run of 2026" are not the same number and I printed one under
the other's label.

Nothing in the apparatus caught it because the fixture `DemonstratedHistory` in
`_adjudication.test.ts` pins `longestRunMi: 18.0` as a literal. The test agreed with
itself. Rule 18.

## The correct dataset

Full 2026, canonical rows only (`NOT (data ? 'mergedIntoId')`), user by uuid.

### Longest runs

| Date | Miles | What it is |
|---|---|---|
| 2026-04-26 | 26.81 | Big Sur Marathon (race) |
| 2026-03-08 | 26.70 | LA Marathon (race) |
| 2026-01-25 | **21.51** | **longest training run of 2026** |
| 2026-04-05 | 20.02 | training |
| 2026-02-15 | 20.00 | training |
| 2026-01-11 | 19.00 | training |
| 2026-07-25 | 18.00 | training — the longest of the last 90 days, which is all my window could see |

### Weekly volume

Peak week **48.5 mi** (week of 2026-02-09, 5 running days, 20.0 long). Not 47.5.
Six weeks at 44 mi or more: 48.5, 47.5, 47.3, 45.8, 44.9, 44.7.

The 48.5 week sits 8 days after the Disney Half and 27 days before LA, so it is
outside LA's 21-day taper lead-in. It is a legitimate build week, not a Rule 8
artefact.

## What this changes in the trace

Three of my own classifications were wrong, and all three were wrong in the same
direction — they made him look less capable than he is.

| Prescription | I said | Corrected |
|---|---|---|
| 21.5 mi long run, 2026-11-01 | +19% over demonstrated max (18.0), CONDITIONAL | He has run **21.51**. Step is **−0.05%**. SUPPORTED |
| 60.0 mi week, 2026-10-26 | +26% over demonstrated peak (47.5) | +23.7% over **48.5**. Still the genuine step in this block |
| 16 mi at D+7 after Malibu | unsupported, because 11.01 once | falsified below |

## Two further corrections I owe you, found while checking this

**There is no 10-mile marathon-pace dose in your plan.** I merged two quantities under
one name. The 10-mile figures on 2026-10-27 and 2026-11-03 are total *session*
distance for a tempo workout: 2 mi warm-up + **6 mi at threshold (7:10/mi)** + 2 mi
cool-down. The largest marathon-pace dose in the entire block is on 2026-10-18 —
8 miles of M inside a 20-mile long run, split as 5 + 1 easy + 3, so the largest
*continuous* M block anywhere in the block is **5 miles**. The question worth asking
is about 6 miles at threshold, not 10 at marathon pace.

**The post-Malibu long run is 16 miles, not 18.** 2026-11-15, sixteen miles with 4 mi
at M, seven days after the Malibu Half.

## Defect 3, falsified by your own history

I inferred that a long run seven days after a half was unsupported because you ran
11.01 miles seven days after AFC. You were right that one comparison is not a capacity
limit. It is worse than that — I picked the minimum of the set and called it the
ceiling.

What you actually did at exactly D+7 after each half:

| Race | D+7 date | Miles at D+7 |
|---|---|---|
| Rose Bowl Half 2026-01-18 | 2026-01-25 | **21.51** |
| Disney Half 2026-02-01 | 2026-02-08 | 17.21 |
| AFC Half 2026-08-16 | 2026-08-23 | 11.01 |

You have run **21.51 miles seven days after a half marathon** — your longest run of the
year came at exactly that offset. A 16-mile long run seven days after Malibu is below
your median at that offset, not above your maximum. The inference is withdrawn.

The 14-day totals after each half tell the same story: 76.5 mi after Rose Bowl, 83.3
after Disney, 51.6 after Sombrero, 63.2 after AFC. You train through halves.

## What is still a genuine question

Stripped of my three errors, one thing survives, and it is the volume:

- **60.0 mi in the week of 2026-10-26 is +23.7% over your demonstrated peak of 48.5.**
  Two other weeks in the block sit at 59.5 and 59.6.
- That week stacks 6 mi at threshold, 9x3 min at I pace, and the 21.5-mile long run.
  The long run is earned. The volume it sits inside is not, yet.

That is the sequence question the adjudication layer exists to answer, and it is the
one to re-run against corrected history under defects 2 and 6 — whether September and
October training can *earn* a 60-mile week by the time it arrives, rather than that
week being accepted or refused today.
