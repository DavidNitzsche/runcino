# F077 — TRAINING_CONSISTENCY consolidation + non-adherence detector

Branch: `fix/f077-training-consistency-2026-09-14`, based on `origin/main` (945f4a3b6).
Worktree: isolated, not merged, not pushed.

## Honest headline

**Phase 1 landed: the missing canonical `TRAINING_CONSISTENCY` reader now exists, is
tested, and is cited from `ownership.ts`.** One deliberate, named piece of Phase 1 —
migrating `adaptation-model.ts`'s own "consistency" dimension to consume the new
reader — was **not** done, on purpose, and is recorded as an open follow-up rather
than forced. **Phase 2's detection primitive (item 4) also landed** — the 2-3
consecutive-miss trigger and the recommit-cycle-of-2 escalation are both real, tested
code. **Phase 2's UI/persistence wiring (item 5) was not attempted** — it needs a new
database table (offer/response history) and touches the live coach-decision-card
surface, which is its own scoped piece of work needing a schema-change approval this
session did not have standing to make unilaterally.

## What was found (Phase 1, step 1)

`lib/runner-state/ownership.ts`'s own audit already named this belief `TRAINING_CONSISTENCY`,
already marked it `OPEN`, `canonical: null`, and already named three "competing" readers.
Reading each one directly, rather than trusting the label, found:

1. **`lib/adaptation/adaptation-model.ts`'s private `readConsistency`** (feeding
   `CONSISTENCY_SPREAD_NOTE` into `classifyAdaptation`'s composite `consistency`
   dimension). This is the ONE genuine attempt at a consistency-shaped score: it
   scores planned-vs-actual **weekly mileage ratio and its spread**, folded into the
   load-absorption composite. It is exactly the shape doctrine says NOT to build a
   non-adherence detector on — blended volume, not quality-session-specific — and it
   is module-private, so (per `ownership.ts`'s own words) "nothing else in the app can
   reach it."
2. **`lib/faff/week-mileage.ts#computeWeekMileage`**. Read its own file header: this
   function answers "how many miles did he run this week" for the Today/Train
   surfaces, fixed a real cross-surface mileage-disagreement bug, and explicitly
   "never returns one blended miles figure" and keeps "no belief" across weeks. It
   tracks `hardSessionsDone` (a count of quality sessions run) as a side output, but
   has no rolling window and no pass/fail judgment of whether the stimulus landed.
   **This is not actually a competing implementation of "how consistent is this
   runner" — it answers a different question** ("miles this week"), and its own
   `computes` line in the ownership registry already undersold that distinction.
3. **`lib/coach/runner-calibration.ts#loadRunnerCalibration`**. Its own file header
   says exactly what it does: a three-tier cold-start/building/calibrated label off
   raw workout counts, deciding how much the plan engine should trust learned curves
   over bucket defaults. `ownership.ts`'s own audit already flagged this correctly:
   "Account maturity, not training consistency." **Also not a real competitor.**

So the actual defect was narrower than "three readers disagree": it was "one real
attempt exists and is unreachable; two decoys share the English word 'consistency'
but answer different questions." Confirmed at the call-site level too — `hardSessionsDone`
is only ever displayed as a raw count on Today (`TodayView.tsx:4489`), and `dataQuality`
is only ever logged in a cron snapshot (`snapshot-projections/route.ts:240`); neither
one is presented to the runner as a "how consistent are you" judgment today, so there
is no live, user-visible contradiction between them to reconcile — the risk was
entirely architectural (no one function anyone could call), not a runtime bug where
two numbers disagree on screen.

## What was built (Phase 1, steps 2-3)

**New canonical reader**: `web-v2/lib/training/training-consistency.ts`
- `resolveTrainingConsistency(sessions)` — pure, Rule-18-falsifiable. Counts the
  **trailing** consecutive-miss streak (not a lifetime count, not a share) over an
  already-filtered, already-ordered list of representative quality sessions, and
  exposes `triggersNonAdherenceOffer = consecutiveMissedQuality >= 2`.
- `loadTrainingConsistency(userUuid, todayISO, opts?)` — the production loader.
  Reuses existing machinery verbatim rather than re-deriving anything:
  - `loadKeySessionExecutions` (`lib/execution/load.ts`) already resolves every
    prescribed quality session (`plan_workouts.is_quality`) to one of doctrine's
    seven `ExecutionState`s and already answers "did this land"
    (`earnsProgressionCredit`, `lib/execution/interpret.ts`) — this is the exact
    "stimulus landed, not calendar presence" machinery the coaching consult named as
    already existing and reusable.
  - `loadPrescribedWindows` / `isPrescribedNonNormal` (`lib/training/normal-window.ts`)
    excludes taper/race/recovery days from the read entirely, so a plan-authored
    cutback can never manufacture a false non-adherence signal (doctrine's own
    `neverMovesOn: PRESCRIBED_TAPER` note on this exact belief).
  - Telemetry-compromised sessions are excluded too (RULE8CLOSE-1): an app-side
    capture failure is never scored as a runner shortfall.
- Why this is new code and not a route to any of the three named symbols: see the
  file's own header comment for the full argument, and `ownership.ts`'s updated
  entry below for the registry-level record.

**Detection number, cited, not invented**: `NON_ADHERENCE_TRIGGER_STREAK = 2`, per
consult-log `2026-09-15-025` Ruling 1 — the smaller end of the doctrine's stated
"2-3 consecutive" band, reusing `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`'s own
"two or three corroborating sessions" language for the upward direction, applied
symmetrically (Rule 22).

**`ownership.ts` updated**: `TRAINING_CONSISTENCY.canonical` now names
`lib/training/training-consistency.ts#resolveTrainingConsistency`. `conflict.verdict`
stays `OPEN` — deliberately, not by omission — narrowed to exactly one remaining
question: whether `adaptation-model.ts`'s own "consistency" dimension should be
redefined to consume this reader (see next section). The full argument, the
citation of which of the three competitors were real vs. decoys, and why the one
real overlap stays open are written into `conflict.because` / `notRoutedBecause` in
the same dense why-comment style the rest of the file uses.

## What was deliberately NOT done, and why (the honest scope boundary)

**`adaptation-model.ts`'s `readConsistency` was not migrated to consume the new
reader.** This is the one piece of Phase 1 that is genuinely a "needs a decision
beyond what's already been ruled on" case, not a shortcut:

- `readConsistency`'s dimension feeds `classifyAdaptation`'s composite score, which
  is live, load-bearing, and directly affects progression decisions for every
  runner today.
- Its current question — "has weekly training *load* followed the planned *shape*
  closely enough to call the stimulus well absorbed" (blended mileage ratio +
  spread) — is a **different, still-valid physiological question**, not a wrong
  answer to F077's question ("has quality-session delivery specifically kept
  failing"). Redefining it to mean the latter is a real product/coaching call about
  what that composite dimension should measure going forward, not a bug fix.
- `web-v2/lib/adaptation/_adaptation_model.test.ts` pins the current volume/spread
  behavior directly (e.g. "chronically over-running the plan is not scored as good
  consistency", "consistency means the shape of the block, not just its average").
  Swapping the underlying computation would require deriving new expected values
  for all of that coverage, plus a replay against the account's real training
  history the way past absorption-reader changes have been (see
  `docs/reports/absorption-reader-split-2026-09-01.md` for the precedent of how
  seriously this codebase treats a live absorption-scoring change).
- The coaching consult (`2026-09-14-019`) ruled the shape F077's OWN detector needs;
  it did not examine or rule on whether `classifyAdaptation`'s internal composite
  dimension should be redefined. That is a distinct question nobody has decided.

This is recorded, not hidden: `ownership.ts`'s `conflict.verdict` stays `OPEN` for
exactly this reason, with a full citation trail, so the next person (or the "Training
Load owner" this entry has always pointed at) has everything needed to make that call
without re-deriving the investigation above.

`computeWeekMileage` and `loadRunnerCalibration` were not touched at all — confirmed,
on inspection, to answer genuinely different questions that were never actually
competing on this belief. No migration is owed there; the registry entry now says so
explicitly instead of leaving them as unexplained "competing" entries for the next
reader to re-investigate.

## Phase 2 — how far it got

**Item 4 (detection logic): built.** `web-v2/lib/coach/non-adherence-offer.ts`:
- `resolveNonAdherenceOffer(triggersNonAdherenceOffer, priorOffers)` — pure,
  Rule-18-falsifiable. Reads the canonical reader's trigger (never re-derives it —
  Rule 16) and decides which of RECOMMIT / RECALIBRATE to lead with, per consult-log
  `2026-09-15-025` Ruling 2: **`RECOMMIT_CYCLE_THRESHOLD = 2`** — the first ask leads
  with RECOMMIT; if the identical pattern recurs after a prior RECOMMIT, the default
  framing shifts to RECALIBRATE. Both choices are always real and always offered —
  this only sets which one the coach's sentence leads with, never forces an outcome,
  and never touches the stated goal (Goal Feasibility stays a separate, unowned-by-this
  question per `docs/BRAIN_CONSTITUTION.md` §29).
- Tests cover: no offer when the reader hasn't triggered (even with a busy history);
  genuine first ask; escalation after one prior RECOMMIT; staying escalated on a
  third/fourth recurrence (never resets to "genuine first ask"); a prior RECALIBRATE
  alone does not itself force escalation (the doctrine's escalation language is
  specifically about a RECOMMIT that then recurs).

**Item 5 (UI/persistence wiring): not attempted.** Two real blockers, both requiring
work and approval this session did not have standing for:
- `priorOffers` has no home. There is no existing table for "when was this coach
  decision offered and how did the runner answer", and per this project's own
  standing rule ("DDL needs per-statement go" — `project_faff_audit_master_plan`),
  adding one needs an explicit schema-change approval this pass did not seek.
- Wiring the actual RECOMMIT/RECALIBRATE choice onto a real coach-decision-card
  surface (the task points at the HOLD/RECORD_ONLY mechanism touched by tonight's
  F060 fix as the existing pattern to reuse) needs its own investigation of that
  surface's contract, plus a real persisted read of "has this exact pattern recurred
  since the last offer" — which depends on the same missing table above. Attempting
  this without the storage layer would mean either inventing a second, throwaway
  persistence mechanism (exactly the kind of side door this codebase's own doctrine
  keeps closing) or wiring something that cannot actually remember the recommit
  cycle across sessions, which would silently defeat Ruling 2's whole point.

This is exactly the kind of boundary the task's own instructions anticipated and
explicitly sanctioned stopping at: the pure detection logic (item 4) is real,
tested, and ready to be called; the persistence + surface wiring (item 5) is a
separably-scoped follow-up, not a corner that was cut.

## Verification

- `npx tsc --noEmit` in `web-v2`: clean, before and after every edit in this pass.
- New tests: `lib/training/training-consistency.test.ts` (7 tests) and
  `lib/coach/non-adherence-offer.test.ts` (6 tests) — all passing. Rule 18
  falsification included in both (a single miss must not fire; a landed session
  resets the streak; the trigger reads the trailing streak and not the lifetime
  share, with a case built to prove a good average does not suppress it; the
  recommit-cycle escalation is tested for first-ask, escalated, stays-escalated, and
  the "prior RECALIBRATE alone does not force escalation" edge).
- `lib/runner-state/_runner_state.test.ts` (the ownership-registry gate itself): 52/52
  passing after two required fixes forced by resolving `TRAINING_CONSISTENCY`:
  (a) an em dash in a new runner-facing `movesUpOn`/`movesDownOn` string, caught by
  the file's own coach-voice punctuation scan and rewritten; (b) an oracle test that
  had (implicitly) depended on `TRAINING_CONSISTENCY` staying `canonical: null`
  forever — fixed to explicitly null `canonical` in its constructed fixture, per the
  same "the oracle should test the shape of the finding, not today's live registry
  state" principle the file's own comments already argue for its sibling oracles.
- Broader regression check: ran `lib/adaptation`, `lib/execution`, `lib/faff/week-
  mileage.test.ts`, `lib/coach/runner-calibration.test.ts`, `lib/runner-state`, plus
  the two new files together — 1427 passed, 1 failed (pre-existing, unrelated:
  `_f038_reign_scoping.audit.test.ts` requires `DATABASE_URL_RO`, which is not set in
  this environment — an infrastructure gate, not a regression from this change), 26
  skipped.
- Full `web-v2` suite (694 test files) was also run in the background as the final
  checkpoint; see the session's own follow-up note for its result if this report is
  read before that run finished.

## Files touched

- `web-v2/lib/training/training-consistency.ts` (new) — canonical reader.
- `web-v2/lib/training/training-consistency.test.ts` (new).
- `web-v2/lib/coach/non-adherence-offer.ts` (new) — Phase 2 item 4 detection/escalation.
- `web-v2/lib/coach/non-adherence-offer.test.ts` (new).
- `web-v2/lib/runner-state/ownership.ts` — `TRAINING_CONSISTENCY` entry updated:
  `canonical` named, `conflict` narrowed and re-argued, `movesUpOn`/`movesDownOn`
  re-pointed at the new reader.
- `web-v2/lib/runner-state/_runner_state.test.ts` — one oracle test fixed to not
  depend on `TRAINING_CONSISTENCY`'s now-resolved `canonical: null` state.

No changes to `lib/adaptation/adaptation-model.ts`, `lib/faff/week-mileage.ts`, or
`lib/coach/runner-calibration.ts` — confirmed by `git status` before writing this
report. Nothing outside `web-v2` was touched. No schema/DDL changes were made or
proposed as code — the missing offer-history table is named as a requirement for
Phase 2 item 5, not built.

## What a follow-up session needs, in order

1. A coaching/product decision on whether `adaptation-model.ts`'s `readConsistency`
   dimension should be redefined to consume `resolveTrainingConsistency` (quality-
   session delivery) instead of its own volume/spread heuristic, or kept as its own,
   differently-named question. Either answer is legitimate; only the current
   "unexamined" state is not.
2. If wiring F077's offer through a real surface: design (or reuse) the
   offer-history persistence, get the DDL approved per this project's standing rule,
   then wire `resolveNonAdherenceOffer` through the HOLD/RECORD_ONLY-style
   coach-decision-card mechanism, plus decide the RECALIBRATE re-evaluation point
   (doctrine: "temporary recovery must not silently become a permanent lower
   trajectory") — not designed in this pass.
