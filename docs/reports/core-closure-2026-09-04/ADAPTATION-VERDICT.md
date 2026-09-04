# Stage 5 · the canonical Adaptation Engine — promote or hold

**VERDICT: HOLD — but the blocker has changed, and the previous one is gone.**

The earlier verdict (same day, earlier session) said hold because the engine
could not read enough evidence to ever push. That was true, and it was our
fault, not the runner's. Two engine defects have been found and fixed. The
engine now proposes increases on his real history.

What remains before live authority is no longer a defect. It is a shadow-log
confirmation period on production and one simultaneous change to retire the
legacy writers — and the decision itself is David's, because it is authority
over his training.

---

## What changed · PROGRESS 0 → 14

| | Before | After |
|---|---|---|
| PROGRESS | **0** | **14** |
| HOLD | 63 | 64 |
| REGRESS | 4 | **4 (unchanged)** |
| REFUSE | 53 | 38 |

REGRESS unchanged at 4 is the load-bearing number. **Nothing about the
downward path moved.** No bar was lowered, no threshold widened, no tolerance
stretched. What changed is that correctly-executed sessions can now be seen.

### Readable counts, per gate, before and after

| Lever / gate | Blocked before | Blocked after |
|---|---|---|
| `THRESHOLD_PACE / T2-direction` | **34 of 40 (85%)** | **14 of 40 (35%)** |
| `LONG_RUN / L4-durability-readable` | 26 of 40 | 26 of 40 |
| `LONG_RUN / L2-admissible` | 6 of 40 | 6 of 40 |
| `WEEKLY_VOLUME / V5-something-to-move` | 8 of 40 | 8 of 40 |

And the bars themselves:

| Gate | Ever met · before | Ever met · after |
|---|---|---|
| `T1-corroboration` (≥2 sessions) | YES (2) | YES (**4**) |
| `T2-direction` (≥2 faster) | **NO** — closest 1 | **YES** — closest 2 |
| `T3-meaningful-step` (≥1 s/mi) | YES | YES (32) |
| `V2-week-completion` (≥0.95) | **NO** — 0.9023 | **NO** — 0.9023 |

`V2-week-completion` is untouched and still unmet. It is an honest bar: his
worst week in the best three-week run completed 90.2% of prescribed, and the
lever asks for 95%. That is a thing to go and earn.

---

## The two defects

### HRCEILING-1 · threshold work graded against an easy-day HR cap

Every threshold session in June and July was graded against an HR ceiling of
**149 bpm**. His LTHR is **168**.

```
2026-06-11 tempo   DIFFERENT · mean work HR 162 against ceiling 149
2026-06-18 tempo   DIFFERENT · mean work HR 163 against ceiling 149
2026-06-23 tempo   DIFFERENT · mean work HR 160 against ceiling 149
2026-06-25 tempo   DIFFERENT · mean work HR 155 against ceiling 149
2026-07-07 tempo   PARTIAL   · mean work HR 167 against ceiling 149
2026-07-09 tempo   PARTIAL   · mean work HR 163 against ceiling 149
2026-07-14 tempo   PARTIAL   · mean work HR 156 against ceiling 149
2026-07-21 tempo   PARTIAL   · mean work HR 159 against ceiling 149
```

149 is the *easy-day aerobic cap*. Threshold work is run at or just under
LTHR, so 155–167 against 168 is the session doing exactly what it was for. The
engine read every one as "completed at clearly excessive effort" —
`gradeStimulus`'s DIFFERENT branch — and DIFFERENT and PARTIAL are both outside
`GRADES_THAT_COUNT_AS_EVIDENCE`.

**The rule was not invented for this fix.** ZONEBAND-1 (2026-09-03) had already
ruled that "a quality HR target belongs to threshold/interval work, never to an
easy or long block", and fixed the AUTHORING side. Verified on the live plan:
`intervals`, `tempo`, `threshold`, `race`, `race_week_tuneup` all carry
`hr_cap_bpm = null`; `easy`, `long`, `shakeout` carry 151. ZONEBAND-1 fixed
what the runner READS. Nothing reached what the engine GRADES.

Fixed by one shared resolver, `lib/adaptation/canonical/work-hr-ceiling.ts`,
called by BOTH the production shadow builder and the replay harness — so the
replay can never be more or less permissive than the engine it replays.

### HRCHANNEL-1 · and the one that would have bitten every future session

`gradeStimulus`'s "HR is not a channel for this session" escape was gated on
`!hrReliable` — a dead strap. It did not cover an **absent ceiling**.

That is the state of *every quality session authored since ZONEBAND-1*. So a
perfectly executed threshold session — pace on target, work complete, no late
collapse, clean HR trace — fell past every branch onto the final `DIFFERENT`
and could never corroborate a faster anchor.

**A correct fix to the authoring side had silently made every future quality
session unable to serve as evidence, and nothing connected the two.** Rule 11
exactly: "don't know" is not "failed". An absent ceiling is a missing channel,
not a breached one, and the doctrine for a missing channel was already written
two branches above — it costs the larger 5 s/mi step and nothing else.

---

## What training behaviour earns progress, and how much

Stated plainly, because Rule 21 asks for exactly this:

> **Two threshold sessions on separate days inside 28 days**, each completed at
> or near its prescribed work, each faster than the current anchor, and
> outnumbering any slower sessions two to one. That buys the **ordinary step of
> 3 s/mi**.

Every one of the 14 proposals is that ordinary step. **Not one reaches the
larger 5 s/mi step**, which requires FULL grades — stronger and more numerous
evidence.

The magnitude is the reassurance. Across two months of real training the anchor
walks **7:22 → 7:16 — six seconds a mile**, held there by the
one-step-per-cutback-cycle contract. His actual production anchor today is
**7:10/mi**, so the replayed engine stays *behind* where his fitness really
went rather than running ahead of it.

Sample proposals, verbatim:

```
2026-06-19  THRESHOLD_PACE  -3 s/mi  7:22 → 7:19 · 2 sessions on separate days ran faster than the anchor
2026-06-24  THRESHOLD_PACE  -3 s/mi  7:19 → 7:16 · 3 sessions on separate days ran faster than the anchor
2026-06-26  THRESHOLD_PACE  -3 s/mi  7:19 → 7:16 · 4 sessions on separate days ran faster than the anchor
```

---

## Falsification

Both fixes were reverted independently, against the real snapshot:

| Reverted | Result |
|---|---|
| HRCHANNEL-1 alone | PROGRESS **14 → 0** |
| HRCEILING-1 alone | PROGRESS **14 → 0** |

Each is load-bearing; neither is redundant.

The pinned assertions did their job and had to be argued down rather than
edited quietly. `_upward_bar.test.ts` guard 1 failed with *"expected 4 to be
0"*; `real-replay.test.ts`'s distribution pin failed; and the block titled
**"THE FINDING · the engine never proposes an increase on his real data"** —
which said of itself *"the day a change makes it push, THIS TEST FAILS and the
person who made it has to come and delete this block"* — was deleted by the
person who made it, and replaced with the new observation and its reasoning.

A dedicated gate, `lib/adaptation/canonical/_hr_ceiling.test.ts`, now holds
both rules independently of the replay, including the two loopholes the fix
must not open: a session run over a REAL ceiling still grades DIFFERENT, and an
incomplete session still grades PARTIAL.

---

## What remains before promotion

1. **A shadow-log confirmation period on production, with the fixed grader.**
   The nightly shadow path now writes decisions that can actually move. Those
   need to accumulate and be compared against what the legacy writers do, on
   live data, for long enough to be evidence. This is the only remaining
   *technical* precondition and it takes calendar time, not code.

2. **Retire the three legacy mutators IN THE SAME CHANGE.**
   `_promotion_contract.test.ts` names them and enforces the simultaneity:

   - `lib/plan/adapt.ts` — reschedules, downgrades and drops sessions
   - `lib/plan/adaptive-ramp.ts` — the volume bump
   - `app/api/cron/plan-drift/route.ts` — fires `fireAutoRebuild`

   **They are deliberately NOT retired here.** Retiring them while the canonical
   engine is still shadow-only would leave the runner with no adaptation at all
   — a regression wearing a fix's clothes. The contract's own rule is that
   retirement and promotion are one change, and promotion is not authorised.

3. **David's decision.** Promotion is live authority over his training. That is
   a doctrine call, not an engineering one, and this session stops there.

**Live automatic mutation remains disabled. Nothing in this work enabled it.**
The production write barrier was exercised during this session and refused a
shadow-log INSERT against production, reporting `posture: "skipped"` with its
reason — Rule 11 in the persistence layer, under a real attempt.

---

## The four required outcomes

| Outcome | Demonstrated on real history |
|---|---|
| progress | **YES — 14, on his own season, each corroborated, each the ordinary step** |
| hold | YES — 64, with named reasons |
| regress | YES — 4, unchanged by this work |
| refuse | YES — 38, and refusals still distinguish "unreadable" from "not earned" |

A suite containing only hold/refuse cases would fail this stage. It no longer
does, and the pass is on the runner's real training rather than on a
counterfactual rung of a ladder.
