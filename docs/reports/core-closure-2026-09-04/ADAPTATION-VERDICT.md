# Stage 5 · the canonical Adaptation Engine — promote or hold

**VERDICT: HOLD.** Do not enable live automatic mutation.

And the reason is not the one the numbers first suggest.

## What was run

`scripts/adaptation-real-replay/run.sh` against `real-history.snapshot.json`
— the owner's real training history. The harness opens no database
connection, by design: "a proof that could write is not a proof anybody should
run." 3 files, 30 tests, all passing.

Plus `lib/adaptation/_shadow_compare.audit.test.ts` and
`_promotion_contract.test.ts` against live production over the read-only role.

## The distribution

Across 40 decision points and 566 gate readings on real history:

```
PROGRESS   0
HOLD      63
REGRESS    4
REFUSE    53
```

That is the sensitivity run — the MOST generous assumption available, that
every long run could be read and finished clean. Zero upward proposals.

Rule 22's imbalance, measured rather than asserted.

## But it is a bar, not a wall

Guard 3 of `_upward_bar.test.ts` is the Rule 21 wall test, and it PASSES:
every lever can be pushed by some behaviour. The counterfactual ladder says
which:

| Rung | Weeks where it bought a PROGRESS |
|---|---|
| AS_RUN | 0 of 13 |
| WEEKS_AT_BAR | 0 of 13 |
| WEEKS_AND_KEY_SESSIONS | 5 of 13 |
| WEEKS_KEY_AND_LONGS | 8 of 13 |
| EVERYTHING_AT_BAR | 11 of 13 |

So the engine can say yes, and the behaviour that would make it say yes is
describable. Two gates bind:

- `THRESHOLD_PACE / T2-direction` — needs ≥ 2 faster sessions; closest ever
  **1**, on 2026-09-02 (1 faster, 1 slower, against a 442 s/mi anchor).
- `WEEKLY_VOLUME / V2-week-completion` — needs ≥ 0.95 on the worst of the last
  three non-cutback weeks; closest **0.9023**, short by 0.0477.

Neither is absurd. A runner who completes three weeks at 95% and puts two
faster threshold sessions together gets an increase.

## The real finding · the upward path is blocked by unreadable data, not by the runner

This is what changes the verdict from "the bar is high" to "hold".

```
THRESHOLD_PACE / T2-direction    34 of 40 readings could not be judged from the data
LONG_RUN / L4-durability-readable 26 of 40 readings could not be judged
LONG_RUN / L2-admissible           6 of 40
WEEKLY_VOLUME / V5-something-to-move 8 of 40
```

**Eighty-five percent of the threshold-direction gate's readings are data
blocks.** The evidence layer says why:

- 29 of 146 split-carrying runs record pace ONLY as a clock string.
- 8 of 15 long runs have comparable thirds; the rest are unreadable for named
  reasons ("the prescription changes pace across the run, so its thirds are
  not comparable" ×6, "no activity was recorded in this week" ×1).

Rule 11 is doing its job here — the engine reports "could not read" rather
than inventing a shortfall, and guard 4 explicitly refuses to count a data
block as "he never earned it". That is correct behaviour and it is why the
zero above is not evidence of a punitive engine.

But it means promotion today would hand live authority to a mechanism whose
dominant outcome is REFUSE-for-want-of-readable-evidence. The runner would
experience an engine that never moves and never explains, and Rule 21's
warning — "wired, tested and inert is this codebase's signature failure" —
would be satisfied in its most expensive form: inert *with* write authority.

## What has to be true before promotion

1. **The threshold-direction gate must be readable on most decision points.**
   85% data blocks is the blocker. The pace-as-clock-string parsing (29 of 146
   runs) is the cheapest identified contributor.
2. **A PROGRESS must appear on real or replayed history**, not only on a
   counterfactual rung. `WEEKS_AND_KEY_SESSIONS` buys one in 5 of 13 weeks, so
   the target is reachable.
3. **`_promotion_contract.test.ts` must stay green through the switch.** It
   names the three legacy mutators and fails if the engine is switched on
   without retiring them — the "two authors, no way to tell which moved it"
   case.

## Production write safety — confirmed, not assumed

The shadow path was exercised against live production during this session. The
write barrier refused it:

```
[write-barrier] REFUSED a write from a verification process · vitest
  leading keyword INSERT is not on the read-only allow-list
  target: crossover.proxy.rlwy.net:20769/railway · production
  ledger: 4 writes attempted, 0 issued
```

And it reported `posture: "skipped"` with the reason, distinctly from the
other honest skip (table absent). That is Rule 11 in the persistence layer and
it behaved correctly under a real attempt.

## The four required outcomes

| Outcome | Demonstrated |
|---|---|
| progress | **counterfactually only** — 5–11 of 13 weekly boundaries on the ladder rungs; never on as-run history |
| hold | yes — 63, with named reasons |
| regress | yes — 4, each naming both short long runs |
| refuse | yes — 53, and refusals distinguish "unreadable" from "not earned" |

A suite containing only hold/refuse cases would fail this stage. It does not:
ACCELERATE/PROGRESS is exercised, and the wall test proves the yes-path is
reachable. What is missing is a PROGRESS the RUNNER has actually earned, and
that is currently gated by data readability rather than by the bar.
