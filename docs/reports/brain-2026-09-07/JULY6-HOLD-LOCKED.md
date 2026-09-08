# The 2026-07-06 HOLD, locked as a falsifiable statement

Written 2026-09-08 ~06:40 UTC (23:40 PDT 2026-09-07), against `origin/main` at
`dd1761718993833f38bf2975e040a1cb693a6f2f`.

This extends `HANDBACK-ROUND3-FINAL.md` §1, which established that the
rolling-boundary evaluator organically earns a PROCEED on this week and that
the option lane nonetheless chose HOLD. That document could not say WHY the
lane chose HOLD; it attributed it broadly to "a separate
evidence-classification system". **This document names the exact mechanism, the
exact input, and the exact line, and states the conditions under which the same
rule produces something other than HOLD.**

Every claim carries how it was verified. Four methods, kept distinct and never
blurred:

- **CODE** — read in the source at `dd1761718`.
- **RO-SQL** — a read-only query against production over `DATABASE_URL_RO`
  (role `faff_readonly`; persistent writes confirmed refused tonight —
  `CREATE TABLE public.…` returns `permission denied for schema public`,
  `UPDATE users …` returns `permission denied for table users`).
- **RO-RUN** — the real, unmodified production code executed against
  production over that same read-only connection.
- **SCRATCH** — executed against a loopback scratch copy. Never production.

---

## 1 · The chain, link by link

### Link 0 · What the runner actually did

He ran MORE than prescribed in the trailing window, and the demand step into
week 2026-07-06 was a modest +9.6%. That is the case this app exists for
(CLAUDE.md, world three). The boundary agreed:

```
[rolling-boundary-evaluator] 0645f40c · week_demand_step · PROCEED ·
demand rises 9.6% on the highest of the trailing three weeks (2026-06-15)
at 92.2% confidence · an earnable push, not an automatic one
```

**SCRATCH**, reproduced verbatim tonight (§4), matching round 3's own replay.

### Link 1 · Evidence · the run-day list

**RO-SQL.** Canonical run days for `0645f40c-951d-4ccc-b86e-9979cd26c795`,
using the canonical predicates verbatim (`COALESCE(data->>'date',
LEFT(data->>'startLocal',10))` from `runDaySql()`, and `NOT (data ?
'mergedIntoId')` from `runNotMergedSql()` — Rule 14: the scope is named, not
retyped by hand):

```
… 2026-06-19  2026-06-21  2026-06-23  2026-06-25  2026-06-27
                                                              <- nothing here
   2026-07-06  2026-07-07  2026-07-08  2026-07-09  2026-07-10 …
```

**Verified raw first, per Rule 14's own instruction.** A second query with NO
app filter at all — every `runs` row for that user between 2026-06-20 and
2026-07-08, grouped by day, counting merged rows and absorption stamps
separately — returns rows on 06-21, 06-23, 06-25, 06-27, 07-06, 07-07, 07-08
and on no other day. The gap is not a filtering artifact. There is no run row
of any kind on 2026-06-28 through 2026-07-05.

**Be precise about the number.** The two bounding runs are **nine calendar days
apart**. The engine counts **eight no-run days** between them, and that is what
`gapDays` reports. Earlier notes said "a 9-day gap"; both describe the same
fact, and this document uses the engine's own count, because that is the number
compared against the threshold.

### Link 2 · The Rule 8 filter · is any of that gap PRESCRIBED?

**CODE + RO-SQL.** `readDisruption` (`web-v2/lib/safety/load-safety.ts`) does
not count a day `isPrescribedNonNormal` marks as taper, race week or post-race
recovery — `lib/training/normal-window.ts`, the one filter. Its race read
(`loadPrescribedWindows`) admits only races carrying a non-empty
`actual_result` dated on or before today. Run against production for
`todayISO = 2026-07-06`, that returns five races, the latest being **Sombrero
Half, 2026-05-03**. Nothing in 2026-06-28 … 2026-07-05 sits inside any taper
lead-in or post-race window.

All eight days count. **This gap is the runner's own, not the engine's.**

### Link 3 · The signal

**CODE.** `DISRUPTION_MIN_GAP_DAYS = 8` (`lib/safety/safety-verdict.ts`),
cited to `Research/22-plan-templates.md` §14 "Return from Short Layoff (1-2
weeks off)" — 1 to 7 days resumes the full plan; 8 is where the table's second
row begins and the restart drops below previous volume.
`DISRUPTION_LONG_GAP_DAYS = 15` was not reached, so the constraint window is
`DISRUPTION_SHORT_CONSTRAINT_DAYS = 14`.

**8 >= 8. The signal fires at exactly its own edge.**

### Link 4 · Belief / verdict

**RO-RUN.** `resolveSafety` -> `classifySafety` -> `resolveTrainingSafety`,
real code, real production rows, read-only connection, as of 2026-07-05:

```
safety CAUTION · reason=training_disruption · driver=disruption
disruption  · gapDays=8 ended=2026-07-05 returned=not yet sinceReturn=0 window=14
posture     · CONSTRAINED · rank=4 · tier=RECOVERY_CONSTRAINT
```

`TIER_BY_REASON['training_disruption'] = 'RECOVERY_CONSTRAINT'` and
`POSTURE_BY_TIER['RECOVERY_CONSTRAINT'] = 'CONSTRAINED'`
(`lib/safety/training-safety.ts`). **CODE.**

### Link 5 · Arbitration

**CODE + RO-RUN.** `resolveArbitrationPriority`
(`lib/adaptation/canonical/phase-priority.ts`), step 1 of a lexicographic
composition — before phase, event, limiter or recency is consulted at all:

```ts
if (ctx.safety !== 'NORMAL') {
  …
  return {
    posture: 'STOP',
    defersDemandIncrease: true,
    declineBasis: 'PRESCRIBED_RECOVERY',   // CONSTRAINED, not HARD_STOP
    …
  };
}
```

Confirmed by running it on the real posture for this week: `phase=QUALITY`,
`raceDistance=HALF`, `defersDemandIncrease=true`, `posture=STOP`,
`declineBasis=PRESCRIBED_RECOVERY`.

### Link 6 · The override, exactly

**CODE.** `web-v2/lib/brain/option-lane.ts`, two lines:

```ts
const stoppedBySafety = chosen === 'PUSH' && priority.defersDemandIncrease;
const finalChoice: Option = stoppedBySafety ? 'HOLD' : chosen;
```

PUSH won the appraisal and died here. That is not an inference — the lane's own
recorded sentence, reproduced tonight (§4, PHASE A), says so:

> the appraisal ranked PUSH first on SUPPORTED evidence, and arbitration
> deferred every demand increase: The Safety owner permits training and does
> not permit advancing it. This runner is carrying a complaint in doctrine's
> amber band, or is inside a return window prescribed to rebuild below their
> previous load.

---

## 2 · Why HOLD is doctrine-correct here

`docs/BRAIN_CONSTITUTION.md` §E, verbatim:

> Outputs: NORMAL / CAUTION / MODIFY / STOP. Safety may override other
> systems. Other systems may not override Safety. **SAFETY > TRAINING
> OPTIMIZATION.**

`phase-priority.ts` cites this passage by that exact anchor string
(`anchor: 'SAFETY > TRAINING OPTIMIZATION'`) at the branch that fired, and
`lib/brain/objective.ts` states the same as
`OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP`. **CODE.**

The load-bearing point:

**This is not the engine's disposition. It is the runner's own eight days.**
Rule 21 is right that this codebase's upward path is suspiciously quiet, and
Rule 22 is right that the tests share the engine's instinct. Neither is the
explanation for this week. The suppressing input is a real, independently
verified fact about what the runner did, doctrine puts a number on it, and the
number was met. **A HOLD here is the coach being right, not the coach being
timid** — and the way to tell those apart is §3, not a vibe.

Two honest caveats, stated rather than buried:

1. **The threshold sat at its exact edge.** Eight against a minimum of eight.
   Seven no-run days would have produced a different plan. That is not a Rule 9
   violation — `safety-verdict.ts` argues it explicitly: the input is a COUNT OF
   WHOLE DAYS, an integer with no hair, and `_safety_precedence.test.ts` asserts
   the property that actually matters, monotonicity (a longer break never buys a
   more permissive answer). It is still worth knowing that this decision rested
   on the narrowest margin the rule has.
2. **One gap suppressed three consecutive weeks.** Because the constraint window
   runs 14 days from the return, the SAME eight-day gap produced
   `defersDemandIncrease=true` at the 2026-07-06, 2026-07-13 AND 2026-07-20
   boundaries (**RO-RUN**, §3). Doctrine-correct — `Research/22` §14's
   short-layoff row is a two-week ramp — but it means one real gap has three
   weeks of reach on the upward path. Anyone auditing Rule 21's zero should hold
   that fact.

---

## 3 · The falsifiable claim

Stated so it can be broken rather than admired.

> **IF**, at the moment a rolling boundary for week *W* is resolved for runner
> *U* (`todayISO = T`):
>
> 1. `readDisruption(U, T)` finds a run-to-run interval, or an open-ended
>    interval ending at *T*, whose count of no-run days — **after** excluding
>    every day `isPrescribedNonNormal` marks as taper / race week / post-race
>    recovery — is **>= 8**; and
> 2. the first run after that interval is no more than **14** days before *T*
>    (or the runner has not resumed at all); and
> 3. no injury, illness or amber-band niggle outranks it, and every safety
>    signal reads successfully;
>
> **THEN** safety resolves `CAUTION / training_disruption / driver=disruption`
> -> `CONSTRAINED` -> `resolveArbitrationPriority` returns `posture: 'STOP'`,
> `defersDemandIncrease: true`, `declineBasis: 'PRESCRIBED_RECOVERY'`, and
> `option-lane.ts`'s `stoppedBySafety` converts a first-ranked PUSH into
> **HOLD**, however strong the PUSH evidence was.
>
> **IF INSTEAD** condition 1 fails (no interval reaches 8 after the Rule 8
> exclusion) or condition 2 fails (the return is more than 14 days old), and
> nothing else raises safety, **THEN** safety resolves `NORMAL`,
> `defersDemandIncrease` is `false`, `posture` is `ADVANCE`, `stoppedBySafety`
> is `false`, and **the option lane's own ranking stands** — PUSH is neither
> forced nor forbidden by this rule; it is decided on training merits.

### How to break it

- Find a week where all three IF-conditions hold and `defersDemandIncrease` is
  `false`. The rule is wrong.
- Find a week where none of them hold and a PUSH is nonetheless converted to
  HOLD **by this mechanism** (its `because` naming "arbitration deferred every
  demand increase"). The rule is wrong.
- Change `DISRUPTION_MIN_GAP_DAYS`, `DISRUPTION_SHORT_CONSTRAINT_DAYS`, or the
  `TIER_BY_REASON` / `POSTURE_BY_TIER` rows without changing this document.
  Then this document is wrong, and saying so is the point of writing it down.

### The proof, one case each way

`web-v2/scripts/walks/_disruption_discrimination.script.ts` runs the real chain
over `roQuery` against production for the six eligible rolling-boundary weeks
of plan `pln_ca91f252bba50c74`. **RO-RUN**, 2026-09-08 ~06:34 UTC:

| week | as of | disruption | posture | `defersDemandIncrease` | a first-ranked PUSH would be |
|---|---|---|---|---|---|
| 2026-06-22 | 06-21 | none | NORMAL | **false** | left to stand on its own merits |
| 2026-06-29 | 06-28 | none | NORMAL | **false** | left to stand on its own merits |
| **2026-07-06** | **07-05** | **gapDays=8, not yet returned** | **CONSTRAINED** | **true** | **OVERRIDDEN TO HOLD** |
| 2026-07-13 | 07-12 | gapDays=8, returned 07-06, sinceReturn=6 | CONSTRAINED | true | OVERRIDDEN TO HOLD |
| 2026-07-20 | 07-19 | gapDays=8, returned 07-06, sinceReturn=13 | CONSTRAINED | true | OVERRIDDEN TO HOLD |
| 2026-07-27 | 07-26 | none | NORMAL | **false** | left to stand on its own merits |

**Positive case (the rule fires): 2026-07-06.** Above, and traced in §1.

**Negative case (the rule correctly does not fire): 2026-06-22.** Chosen as the
representative negative because it is the clean negative where a demand
increase was genuinely on the table — round 3's boundary scan records a
**+15.6%** step for that week, refused at 45.1% confidence, *below the
boundary's own 50% bar*. Safety read NORMAL, `defersDemandIncrease` was false,
and this rule did not touch the outcome: the week was declined on training
merits, by a different mechanism entirely. That is the discrimination the rule
is supposed to have — it did not reach for a week it had no business in.
2026-06-29 and 2026-07-27 return the same NORMAL / false result and are not
elaborated.

The script asserts the discrimination itself (`positives > 0` **and**
`negatives > 0`), so it fails if the rule ever collapses into always-firing or
never-firing, and it fails on zero candidates read (Rule 18 liveness). Its own
header states what it CANNOT fail on: it does not run `runOptionLane`, so it
says nothing about what the lane would choose on its own merits — only whether
the safety override was armed.

---

## 4 · Is the PUSH path DORMANT or BROKEN?

**This section is a CONSTRUCTED test case. Nothing in Phase B or Phase C
happened. Do not quote it as history.**

Rule 21 measured zero upward adaptations in 309 real production intents, and
"wired, tested and inert" is this codebase's signature failure. A mechanism
that never fires and a mechanism that *cannot* fire are different defects with
different fixes, and nothing in the owner's real history separates them. One
deliberately-crossed threshold does.

**SCRATCH.** `scripts/walks/_organic_push_july_constructed.script.ts` against
`faff_push_jul_ctor`, a loopback copy of `faff_push_walk_jul` — itself a copy
of real production rows restricted to the state that genuinely existed on
2026-07-05. Date faked to 2026-07-05T19:00Z. The real
`POST /api/cron/run-adaptations` route, fired twice per phase exactly as
production does it (one pass schedules the boundary, the next resolves it).

**Exactly one input is adjusted, and only in Phase B:** one synthetic run row
on **2026-07-01**, cloned from the owner's own real 2026-06-25 run (real
distance, real heart rate, real phases) with the date and id changed. It splits
the eight-day gap into a three-day gap and a four-day gap, both below
`DISRUPTION_MIN_GAP_DAYS`. **No threshold was moved. No guard was weakened. No
verdict, belief, option or proposal was seeded.**

```
PHASE A · REAL         safety CONSTRAINED · gapDays=8 · reason=training_disruption
                       chosen=HOLD
                       because=the appraisal ranked PUSH first on SUPPORTED evidence,
                       and arbitration deferred every demand increase: …

PHASE B · CONSTRUCTED  safety NORMAL · no disruption signal · reason=clear
                       chosen=PUSH
                       because=PUSH ranked first · raise week 2026-07-06 from
                       45.5 to 50.5 mi · 16 runs classified · 0 finished short of
                       the prescription, 0 went materially past it, 3 could not be read

PHASE C · RESTORED     (synthetic row deleted)
                       safety CONSTRAINED · gapDays=8
                       chosen=HOLD
```

**What this proves:** the option lane's volume-axis PUSH path completes
end-to-end — appraisal, the objective's decline clause, arbitration, a recorded
decision, and a real `DISTANCE_CHANGE` action naming 45.5 -> 50.5 mi. It is
**DORMANT, not BROKEN.** Falsified in both directions (Rule 18): A -> B flips on
the one adjusted input, B -> C flips back when it is removed.

**What this does NOT prove**, and must not be read as proving:

- Not that the owner would ever organically reach a PUSH. He did not, on this
  week, and that stays true.
- Not anything about the other two push axes. `tryAdaptiveBump`
  (`adaptive-ramp.ts`) and `progression-pass.ts` are untouched here.
- Not that the substrate is production. It is a partial copy; only the boundary
  and option-lane reads are exercised against it.
- Not that the eight-day gap was the ONLY thing between the owner and a PUSH
  that week. It is what fired FIRST and decisively; whether the lane would still
  have chosen PUSH had some other input differed is not a question this case
  asks.

---

## 5 · Artifacts

| What | Path |
|---|---|
| Read-only production discrimination probe | `web-v2/scripts/walks/_disruption_discrimination.script.ts` |
| its runner | `web-v2/vitest.disruption-probe.config.ts` |
| Constructed July-6 PUSH case | `web-v2/scripts/walks/_organic_push_july_constructed.script.ts` |
| its runner | `web-v2/vitest.july-constructed.config.ts` |

```
# read-only, against production
cd web-v2 && npx vitest run --config vitest.disruption-probe.config.ts --disable-console-intercept

# loopback scratch only
cd web-v2 && DATABASE_URL=postgresql://127.0.0.1:5432/faff_push_jul_ctor \
  DATABASE_URL_RO=postgresql://127.0.0.1:5432/faff_push_jul_ctor \
  FAFF_VERIFICATION=1 FAFF_DB_TARGET=local \
  npx vitest run --config vitest.july-constructed.config.ts --disable-console-intercept
```

Nothing in this document wrote to production. No migration was applied. No live
plan was mutated.
