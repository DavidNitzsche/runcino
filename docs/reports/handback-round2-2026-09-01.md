# Handback round 2 — the four decisions, executed

Follow-up to `docs/PRODUCT_DECISIONS.md`'s 2026-09-01 "Four calls" entry.
All six pieces landed and are on `main`. Everything below is real —
run against the owner's real account, or explicitly labeled synthetic.

---

## A · The 42-day reader split, and replay evidence

**Landed** (`7445f117`). `web-v2/lib/adaptation/load.ts` now exports two
named outputs: `actual_load_absorption` (unfiltered — byte-identical to
today's live behavior) and `representative_execution` (Rule-8-filtered,
using the same `normal-window.ts` extension built earlier tonight). The
live call path is untouched — nothing promoted.

**Corpus reality check, not assumed:** exactly **one** account in the
entire database has real training history — the owner's own. Every other
account is a zero-run QA fixture, and the archetype sweep's `Arc` type
can't express this reader's input at all (not thinly — the fields don't
exist on the type). Five synthetic fixtures were built directly against the
real input shape to partially fill that gap.

**Replay result on the real account (7 dates):** 1 of 7 flipped the actual
decision — 2026-08-20, inside the AFC recovery window, went from
`normal/PROGRESS` to `marginal/STAY` under the filtered reading. A second
date held the same band but on a materially different evidentiary basis (2
of 7 sessions considered vs. 7 of 11). Rule 9 continuity walk: no new
discontinuity at either taper/recovery boundary.

**DURATION vs. VOLUME, resolved separately as required:** DURATION is
genuinely gated by this reader today. VOLUME's hold is a wholly separate,
already-filtered mechanism (historical tolerance) that returns before this
gate is even reached — the split doesn't change VOLUME's current hold,
though it could once the plan matures past two absorbed weeks.

**A correction to the first handback, found here:** `adaptive-ramp.ts`
does NOT consume `classifyAdaptation`'s verdict — it reads its own
independent evidence. The real live consumer of the unfiltered fork is
`progression-pass.ts`, reached through `adapt.ts`.

**Recommendation: no promotion yet — and it's not one-directional.**
Filtering can also surface a real hold the unfiltered window was diluting
away. This is the input to your decision, not the decision itself.

---

## B · PACE shadow-compare

**Landed** (`3d29aa8b`, confirmed deployed — Railway SUCCESS at that
commit). Three parts, all real:

### B1 · The blended-average bug — fixed, verified

The old code priced PACE's target as one `AVG()` across every future
threshold/tempo/cruise row with no phase awareness — 438 s/mi blended
across QUALITY (435), RACE-SPECIFIC (424), and TAPER (475). It would have
moved all 12 rows toward 430, including RACE-SPECIFIC rows that were
already *faster* than believed capacity, and TAPER rows that are
deliberately slower by design.

**Fixed:** grouped by the plan's own authored phase structure. Real result:

| Phase | Before | After |
|---|---|---|
| QUALITY | moved 8s/mi off the blend | moved **5s/mi**, off its own 435 |
| RACE-SPECIFIC | moved 8s/mi — wrong direction, already ahead | **held**, 0s/mi |
| TAPER | moved 8s/mi, fighting the deliberate slowdown | moved **9s/mi**, clamped to its own doctrinal ceiling |

RACE-SPECIFIC correctly holding is the clean proof this works — a phase
already ahead of capacity no longer gets dragged by a neighbor's gain.
72/72 tests passing, including two new regression scenarios.

### B2 · The shadow-compare mechanism — built, zero-mutation proven

- **Zero mutation:** proven via the read-only-role fence plus an
  independent `plan_workouts` checksum, unchanged across 3 cycles.
- **Determinism** (the honest substitute for true multi-day stability,
  which needs real elapsed time that doesn't exist yet — stated plainly,
  not faked): same account, same day, 3 runs, byte-identical output.
- **A real non-upward case**, not just the one lucky PROGRESS: walked 5
  earlier dates in the account's season, all correctly landed on `HOLD`
  ("threshold pace holds while the block is not being absorbed") — a
  second, genuinely different decision type, correctly reasoned.
- **Persistence: blocked on DDL, correctly stopped rather than run.**
  Three additive-only homes were checked and rejected for specific,
  argued reasons (would corrupt Rule 21's upward-adaptation measurement,
  risk live proposal consumers, or hit the Rule 6 multi-writer-jsonb
  defect). The correct answer is a new table — drafted as
  `db/migrations/160_adaptation_shadow_log.sql`, **not run**. In
  production right now, the cron step runs, reads real evidence, and
  reports `skipped` with the exact reason rather than crashing or silently
  doing nothing. **This is the one item that needs your explicit go before
  shadow-compare evidence can actually accumulate in production.**

### B3 · Authoring/recomputation convergence — scoped, not migrated

Re-counted fresh: `generate.ts` still calls the legacy VDOT cascade at 32
call expressions across 19 lines, zero references to either canonical
resolver. This is not a small, isolable swap — it's threaded through the
authoring logic of the single largest file in the plan engine. Confirmed:
this is its own large piece of work, not a quick follow-up.

**Is tonight's PACE evidence contaminated by this gap? Checked, not
assumed: no, not right now.** `reanchorActivePlan` runs nightly,
unconditionally, across every active plan, and rewrites unrun future rows
through the canonical resolvers — bounding the contamination window to
under 24 hours worst-case. The owner's account had already converged by
the time tonight's shadow-compare ran. **Recommendation:** the evidence
gathered is meaningful today, but add a cheap guard before trusting this
for live authority — flag a shadow-compare record when the plan's
`authored_iso` is more recent than its last `reanchorActivePlan` run, so a
future reviewer can tell "the two brains agree because nothing needed to
change" from "they agree because the flex pass already overwrote what
authoring wrote." Not built tonight — small, named, deferred.

---

## C · Pace/HR compatibility — validator built, one real correction

**Landed** (`5bb979d6`). Two things:

**Correction to the first handback:** `HR 164-172 bpm (Z4)`, as reported
there, is not a real, coherent number — it doesn't match any live
mechanism. Tracing it fresh: the live card actually shows **`160-167 bpm
(Z4 Threshold)`** (`hrTargets()`, a static display-only Friel zone with
zero downstream consumers), which is entirely separate from the **164 /
173** pass/bail contingency pair the watch offers (never auto-enforced).
"164-172" was an unintentional hand conflation of the two in the earlier
report. Neither of the two real mechanisms currently matches any of the
three semantics you asked about (safety ceiling / expected-response band /
target zone) — the display-only zone is closest to "expected-response
band" but isn't labeled or used as one.

**The validator:** `web-v2/lib/adaptation/pace-hr-compatibility.ts`, pure,
DB-free, implementing all four of your policy clauses (compatible/no-action,
heat-explained, stale-ceiling-advisory, material-incompatibility-refuse).
Verified against the real proposal (438→430 s/mi with real HR/temperature
from 3 real activities): verdict **COMPATIBLE**, HR unchanged. Three
synthetic, clearly-labeled cases prove REFUSE, environmental-explained, and
stale-ceiling-advisory all actually fire — not just the one pass-through
case. Zero live callers — genuinely shadow-mode only.

---

## D · Formal verification policy

**Landed** (`6b96bdd0`). `scripts/verify-commit.sh` — checks out an exact
SHA into an isolated worktree, runs the same checks the hook runs, reuses
build caches. Falsified per Rule 18: built a scratch commit with a
deliberate type error, confirmed the tool caught it, discarded the commit.
The seven-condition policy is written into `docs/VERIFICATION_POLICY.md`
and summarized right at the top of `.githooks/pre-push`, where the failure
actually happens.

**Unplanned finding, worth your attention separately:** GitHub Actions CI
— the check independent of the local hook — has been **red for the last 10
consecutive runs**, roughly since tonight's Coaching Thesis work landed.
Two named, real causes (a Rule-11 zero-erasure site, an orphaned module).
Not fixed — flagged as a `spawn_task` chip. You already started it
(`task_cb663aab`) in a separate session; still running as of this writing.

---

## E · Taper-period sessions, and a bonus bug with real reach

**Your original question, answered directly:** 08-04/08-06 are NOT a
comparison-basis bug. The taper hadn't reduced those specific tempo
sessions yet — only the surrounding easy days and the long run had shrunk
at that point — so scoring them against the full 8.0mi ask was scoring
against a genuinely live, contemporaneous prescription. Those two
under-execution findings are real.

**What the investigation found instead:** a wrong-plan-version bug in
`ownedDaysSql` — the query resolving "what was prescribed on date X" could
be won by a plan that was live for 21 minutes and reverted, over the plan
that actually trained the runner for 2.5 months, once both were eventually
archived. **Fixed** (`e76ff593`, `c272d9d2`): a plan now only "owns" a date
if that date falls inside its actual `[authored_iso, archived_iso)` reign.
Verified with a full-database sweep: **7 accounts, 674 plan-days, 97 dates
corrected**, including an independent second instance of the exact same
bug on a different account. 214 tests pass; new regression test added.

This fix changes what several live evidence readers report for historical
dates (fitness evidence, race-replacement, threshold-pattern, adaptive-ramp
all route through this function) — flagged plainly as a real behavior
change, not just a report correction.

---

## Readiness picture for PACE live authority

Against the six items your decision named as required before live PACE
authority was even reconsidered:

| Requirement | Status |
|---|---|
| Phase-aware mutation targets | **Done** (§B1) |
| Pace/HR compatibility validator | **Done** (§C) |
| Replay across multiple runner archetypes | **Not met — structural gap.** Only one real account has training history at all; synthetic fixtures partially cover the 42-day split but not PACE shadow-compare specifically. |
| Stable proposals across repeated daily evaluations | **Partially met.** Determinism (same day, repeatable) is proven. True day-to-day stability needs real elapsed days the cron hasn't run yet. |
| A rollback/audit trail | **Not yet operative.** Mechanism built and correctly stops at the DDL boundary — needs your go on migration 160 before evidence can accumulate in production. |
| Explicit decision on authoring/recomputation convergence | **Scoped and recommended, not decided or built.** Evidence is meaningful today with a caveat; a small guard is recommended, not yet built. |

Two of six fully met, one partial, three genuinely open — one of which
(the archetype/multi-account gap) can't be closed by more work tonight,
only by more real accounts existing or by building a synthetic-history
capability that doesn't exist yet. This is what "needs another shadow
cycle" looks like concretely, laid out for you to weigh rather than decided
here.
