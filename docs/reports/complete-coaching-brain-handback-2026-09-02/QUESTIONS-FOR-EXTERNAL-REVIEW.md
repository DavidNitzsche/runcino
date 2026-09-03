# Questions for external review

Self-contained. A reviewer needs no access to the codebase or the project
history to answer these — everything required is below.

**What we want:** coaching judgement, not code review. Where you disagree, the
reasoning matters more than the verdict.

---

## The runner

Male, 40, Los Angeles. Experienced, explicitly wants an aggressive plan.

| | |
|---|---|
| Target race | **CIM marathon, 6 December 2026** (net downhill, Sacramento) |
| Stated goal | **3:00:00** |
| Marathon PRs | LA Marathon **3:31:40**; Big Sur (hilly, slower) |
| Half PR | **1:34:54** |
| Threshold pace | **7:10/mi** · LTHR 168 · max HR 183 |
| Best training week ever | **48.5 mi** (calendar) / 52.3 (rolling 7-day) |
| Weeks at 50+ mi, ever | **zero**, across 35 recorded weeks |
| Trailing 26-week mean | 32.6 mi/wk |
| Best *training* long run | **21.5 mi** (Jan 2026). Then 20.0, 20.0, 19.0, 18.0 |
| Best sustained stretch | **5 weeks averaging 42.6 mi/wk** |
| Training days | Quality Tue/Thu · long run Sunday · rest Saturday |

His marathon is far weaker than his half, which is the usual signature of a
durability limiter rather than a speed one.

## The plan as it currently composes

15 weeks, 24 Aug – 6 Dec. Peak week **60.0 mi**. Peak long run **20.5 mi**.
**33 marathon-pace miles** total. Four races inside the block:

| Date | Race | Role |
|---|---|---|
| 13 Sep | Santa Monica 10k | B |
| 26 Sep | Dodgers 10K | **C — controlled effort, with a long run the next morning** |
| 8 Nov | Run Malibu half marathon | B |
| 6 Dec | **CIM** | A |

Current model output for CIM: projection **3:23:50**, likely range
3:13:28–3:26:51, and a prescribed race-day execution target of **3:13:30
(7:23/mi)**. The 3:00 goal is preserved but never prescribed as capacity.

---

## Q1 · Marathon-specific work is stacked into the taper

**18 of the 33 marathon-pace miles — 55% — fall in the final three weeks** (an
11-mile MP session 19 days out, a 7-mile MP session 12 days out). In the
6-to-10-weeks-out window the plan delivers **four** MP miles in a single
session.

We think the taper should preserve and sharpen marathon-specific fitness already
built, not create most of it. **What shape should the race-specific phase
actually take for this runner?** Specifically:

- How many marathon-pace sessions, at what sizes, with what spacing?
- Is **MP embedded inside long runs** or **standalone MP tempo** the better
  vehicle for someone who has never held 50 mi/wk?
- Is an 11-mile continuous MP block 19 days out appropriate, or too much that
  late?

## Q2 · How many 20+ mile long runs?

The block currently reaches 20+ **once** (20.5 mi), a mile below what he already
ran in January, in a block whose stated priority is durability. Standard
marathon-intermediate guidance asks for 20–22 mi two to three times — but that
guidance assumes a weekly volume he has never carried.

**For this runner, how many 20+ runs, and how long should the longest be?**
More 20s at lower weekly volume is a materially different plan from fewer at
higher. We would rather hear "one is right, here's why" than default to three.

## Q3 · Is the limiter durability, or consistency?

The engine names **durability** as the least-evidenced capacity and shapes the
whole block around increasing long-run demand. It holds that belief at
**0.51 confidence** — barely better than a coin flip.

A counter-argument: his record shows the real constraint is **consistency**. His
best sustained stretch is 5 weeks at 42.6 mi/wk; the plan asks for roughly 7
weeks around 53. On that reading the block should prioritise sustainable
repeatable weeks over peak long runs.

**Which is the better read of this runner, and what would change in the plan if
it's consistency?**

## Q4 · Is 3:13:30 a defensible race-day target?

Current projection is 3:23:50. The prescribed target of 3:13:30 is the fast edge
of a modelled range that already assumes **+2.56 VDOT across 10.6 build weeks**
— and that gain rate is a **population assumption**, not this runner's measured
response, at 0.585 confidence.

He also currently rehearses marathon pace at **7:52/mi** while being told to
race at **7:23/mi** — a 29 s/mi gap between what he practises and what he is
asked to execute.

**Is a ten-minute improvement over 13 weeks defensible here?** And if the
training doesn't bridge 7:52 to 7:23, which should move — the training, or the
target?

## Q5 · The Run Malibu half on 8 November

It sits four weeks before CIM and consumes two of the four race-specific weeks:
its own race week, and the following recovery week, which currently carries **no
quality work at all**.

**Keep it as a raced half, downgrade it to a marathon-pace workout inside a
normal week, or drop it?**

## Q6 · The Dodgers weekend, 26–27 September

A controlled-effort 10K on the Saturday, then a long run on the Sunday morning.
The runner has explicitly authorised this and accepts it is aggressive.

The relevant fact: **he has never done this before.** Every large two-day block
in his history runs the other way round — long run first, easy day second
(20+7.9, 20+7.5, 17.2+5.4). The one 29.4-mile pair in his record is a 2.6-mile
shakeout followed by the Big Sur *marathon*.

**Given that, how should the two days be prescribed?** How hard is "controlled"
for the 10K, and how long and how easy should the Sunday run be?

---

## What we are NOT asking

Not asking whether the 3:00 goal is realistic — it is his stated ambition and is
deliberately kept separate from prescribed capacity. Not asking about code,
architecture or tooling. Not asking for a full plan rewrite; targeted judgement
on the six questions above is more useful than a replacement.
