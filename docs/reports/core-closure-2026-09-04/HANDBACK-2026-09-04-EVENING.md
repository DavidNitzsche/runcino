# Handback · 2026-09-04 evening

Everything merged to `main`. Nothing written to your plan, no adaptation
promoted, no production data changed.

## 1 · The banner (STUCKCONN-2) — fixed, not yet verified on your phone

**You were right that there is no error, and right that it kept coming back.**

`STUCKCONN-1` (this morning) diagnosed the cause correctly — a pooled HTTP/2
connection URLSession keeps handing requests to after it has died — and then
shipped a detector that cannot fire in that situation, beside a Retry button
that reissues the request down the same dead connection.

| # | Defect | Why it mattered |
|---|---|---|
| 1 | **Retry was inert.** `onRetry` was `Task { await surface.load() }` | It went back out over the same dead connection. The one control for this failure could not fix this failure. That is why tapping it for eleven hours did nothing |
| 2 | A success anywhere cleared the stuck streak | "Any real HTTP response proves the connection works" treats a POOL as one connection. Parallel healthy reads wiped the streak before it reached 3 |
| 3 | Only `.timedOut` counted | The incident's own OS log said "HTTP/2 terminating broken Connection", which Foundation raises as `.networkConnectionLost`. It was explicitly excluded |
| 4 | "Consecutive" across concurrent requests | Not a meaningful sequence. Now 3 signals in a 90s rolling window |

Plus the case that actually produced eleven hours: **a long background kills
pooled connections and URLSession does not notice.** A foreground more than five
minutes after the last active scene now throws the pool away before anything
asks it for data. A cold start resets nothing, because a fresh process has no
stale pool.

Falsified: reverting the predicate to `.timedOut` only — the exact STUCKCONN-1
state — fails 2 tests by name. 7 tests, BUILD and TEST SUCCEEDED.

**This needs a TestFlight build and a morning to confirm.** A failure that takes
hours of real backgrounding cannot be reproduced in a simulator, so I am not
claiming it fixed until you see a clean morning.

## 2 · The dataset correction — my error, your audit was right

My history query carried `startLocal >= '2026-06-01'` and I reported its output
as "longest run of 2026".

| | I said | Truth |
|---|---|---|
| Longest training run | 18.0 | **21.51** (2026-01-25) |
| Peak week | 47.5 | **48.5** (w/c 2026-02-09) |

Three verdicts were wrong, all making you look less capable than you are.

**Defect 3 was worse than one comparison.** I took the *minimum* of a
three-element set and called it your ceiling. At D+7 after a half you have run
**21.51**, 17.21 and 11.01. Your longest run of the year came seven days after a
half marathon. Objection withdrawn.

**Two corrections you did not ask for.** There is no 10-mile MP dose in your
plan — that is a 10-mile *session* containing 6 mi at threshold; the largest
continuous marathon-pace block anywhere in the block is 5 miles. And the
post-Malibu long run is 16 miles, not 18.

## 3 · The seven defects

| # | Status |
|---|---|
| 1 · correct dataset | **Closed.** Explained above, fixture re-pinned, query written into the trace |
| 2 · time-relative evidence | **Closed.** `asOfISO`, projected-vs-today, reassess boundaries |
| 3 · single-comparison inference | **Closed.** Ceilings read the maximum, need 3 comparables, cannot refuse below that |
| 4 · rename `expectedAbsorbed` | **Closed.** `heuristicRankScore`, POLICY_ASSUMPTION, provenance on every number |
| 5 · weekly demand | **Closed.** Seven components, each with provenance, null not zero when unknown |
| 6 · earning gates | **Closed.** A conditional says what would earn it, when, and what happens if unmet |
| 7 · wire `checkPromotion` | **Built, held.** See below |

Arbitration **reading C** is implemented and merged, with the deferral queue and
the full-history counterfactual.

## 4 · The block, re-adjudicated

Exactly **one week in fifteen** is a genuine reach, and it is not the one that
was flagged.

| week | mi | vs today | vs what the block builds first | verdict |
|---|---|---|---|---|
| **2026-09-21** | **55.2** | **+13.8%** | **+13.8%** | **ALLOWED** |
| 2026-10-05 | 59.5 | +22.7% | +7.8% | SUPPORTED |
| 2026-10-26 | 60.0 | +23.7% | +0.7% | SUPPORTED |

46.8 to 55.2 is +17.9% week over week and nothing before it exceeds what you did
in February. Reassess boundary **2026-09-20**.

**A second, independent line lands on the same week.** `Research/00a`: "Add
stress one-at-a-time. Either add mileage OR add intensity in a given week, not
both." That week adds both. The rule was cited in the adaptation path that has
fired zero times in 309 intents, and checked nowhere that composes a plan. It is
enforced now.

**If that gate is missed the block does not collapse** — the reach moves to
2026-10-05 and arms its own gate. Re-queued, not deleted.

## 5 · The counterfactual

13 weekly boundaries, sealed 156-run history:

| world | proposals | APPLIED | DEFERRED | SUPPRESSED | anchor |
|---|---:|---:|---:|---:|---|
| A (today) | 8 | 4 | 0 | **4** | 7:22 to 7:19 |
| C-absent (live posture) | 8 | 7 | 1 | 0 | 7:22 to **7:10** |
| C-probe (with a ceiling) | 8 | 5 | 3 | 0 | 7:22 to 7:16 |

Every suppression under today's arbitration is on THRESHOLD_PACE: 1 of 5 applied
becomes 4 of 5. Volume and long run were never blocked.

**This gates promotion.** C-absent is the live posture, because no demand model
is wired, so rule 1 cannot fire and demand-based suppression is entirely off.
Reading C must not be promoted until the demand model supplies a ceiling.
C-probe is the sensible middle and shows it behaves once it has one.

## 6 · What I corrected in my own work, and in agents'

- **The demand model** compared a with-context index against a without-context
  ceiling, inflating any week with two hard sessions — biasing exactly the way
  this codebase already biases. Sent back. Both sides now price through one
  function. It also caught an arithmetic error of mine: base-to-base is 130%,
  not the 140% I calculated.
- **My step bands.** I had +10% as "supported" for everything. For a long run
  that is doctrine and strong. For weekly volume it is **not** — the section is
  titled "The 10% rule reconsidered" and finds weekly mileage change correlated
  *weakly* with injury. I was reading a policy assumption as an injury threshold.
- **Falsification caught a hole in my own gate.** Breaking the promotion-level
  block left all 34 tests green: the detector was tested, the gate acting on it
  was not.
- **Two promotion dimensions could not fail** — `progression` was
  `traces.length > 0` and `taperIntegrity` was the literal `true`.
- **Three bugs in my own block script**, found by reading output not code:
  `count(*)` as a string so `'2' + 1` printed 21 stressors; the goal race graded
  as a training long run; a reassess boundary set two weeks before the week it
  guards.

## 7 · The decision you owe

**`checkPromotion` is wired but I have NOT merged it.** The wiring makes a
blocked adjudication a fatal `PlanValidationError` on every authoring path. The
agent that built it warned it would refuse your next `generatePlan` — but it
computed that against my **old** history numbers (47.5 / 18.0). With the
corrected 48.5 / 21.51 the simultaneous-peak condition does not fire, so I
expect it now passes. **I have not yet proven that**, and merging a hard block on
plan authoring without proving it is how `plan-drift` starts failing silently
overnight.

Three other things not settled: the demand model is observational and unwired;
the deferral queue is in-memory with an unapplied migration; and the ranking
score is honestly labelled and still uncalibrated.

## 8 · What is unverified

- The banner fix, on your phone. Needs TestFlight.
- That §12 passes against your real block with corrected history.
- Rule 1 has never fired in production and cannot until the demand model lands.
- The adjudication layer is unreachable by the 11,598-archetype corpus — its
  fixtures have no history fields at all, which is Rule 15's original finding
  verbatim. Only its own test file reaches it.
