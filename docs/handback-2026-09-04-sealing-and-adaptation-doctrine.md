# Handback · sealing is execution identity, missing training is not negative fitness evidence

4 September 2026. Deployed commit `2b7b5afa` on main, Railway confirmed
`SUCCESS` on that exact commit hash, container started clean and is serving
traffic. This closes the two P0 contradictions flagged in the round-8
consolidated handback, plus the five follow-on items in the same ruling.

## The two contradictions, closed

### 1 · Sealing now answers "did this execution satisfy THIS prescription," never "does a run exist on this date"

The round-8 handback stated as settled fact that "a day seals on any
unmerged run existing for its date, independent of exact/legacy/absent" —
directly contradicting the execution-identity principle those same rounds
built. Under that rule the friend's run could have sealed the interval
prescription's fields before the real workout happened.

Inventoried every sealing definition in the codebase and found **three**
independent, previously undetected copies of the same date-EXISTS
predicate: `seal.ts::isDaySealed`, `seal.ts::snapshotSealedDays` (the
rebuild path), and `adapt.ts::filterUnsealedWorkouts` (the update path) —
a Rule 14 violation. `snapshotSealedDays` also carried a latent two-a-day
collision: its date-scoped EXISTS clause let completing one of two
same-date prescriptions incorrectly seal its unrelated sibling.

All three now route through `lib/execution/day-resolver.ts` — the same
resolver Today, Watch, post-run and the Adaptation Engine's evidence path
already use. New `isPrescriptionSealed(userUuid, dateIso, planWorkoutId)`
is the per-workout predicate; `isDaySealed`/`snapshotSealedDays` are
rewritten in terms of it.

**Proof, against every one of your seven named scenarios**
(`lib/plan/_sealing_identity.test.ts`, 17 tests):

| Scenario | Result |
|---|---|
| Friend's supplemental run, before the real session | does NOT seal |
| Real hill session, EXACT-linked | DOES seal |
| Unambiguous LEGACY match | DOES seal |
| Supplemental alone — one run | does NOT seal |
| Supplemental alone — passive-sync stamped with the matching type | does NOT seal |
| Partial EXACT match | seals the RECORD, makes no completeness claim |
| Multiple supplemental runs | still does NOT seal |
| Race warm-up / cooldown | does NOT seal the race |
| Actual race recording, EXACT-linked | DOES seal the race |
| Delayed canonical duplicate (loser excluded upstream by `getCanonicalRunIds`) | no second seal exists to create |
| Rescheduled prescription, old date | does NOT seal (found and fixed a real bug here — see below) |
| Rescheduled prescription, new date, genuinely executed | seals normally |
| Resolver read failure | seals conservatively — never unseals |

**A real bug found and fixed inside this work**: my first draft of
`isPrescriptionSealed` returned `true` (sealed) whenever the resolver
couldn't find the queried `planWorkoutId` on the queried date — reasoning
that mirrored the resolver-failure default. That's wrong for the
rescheduling case: a prescription's old date genuinely has no row for it
once moved, and treating "not found" the same as "read failed" would have
made a moved workout's old date read as still-locked. Caught by my own
test suite before it shipped; fixed to distinguish "resolver couldn't
answer" (seal conservatively) from "resolver answered: no such
prescription here" (a definite negative fact, not sealed) — Rule 11's
distinction, applied to sealing itself.

**Falsified per Rule 18**: reverted to the old date-only predicate,
confirmed 7 of 17 tests fail in exactly the cases that predicate gets
wrong (friend-run, both passive-sync cases, both race cases,
multiple-supplemental, rescheduling), restored, confirmed clean.

Full `lib/plan` + `lib/execution` regression sweep: 2882 tests, 0
regressions. `tsc --noEmit`: 0 errors. Commits `7baf4e85`, `36bcb1d7`,
`a58cbc17`.

### 2 · Missing training is absence of evidence, never negative fitness evidence — RULE8CLOSE-1

My adaptation-downgrade proof in round 8 "celebrated" a partial run scoring
better than a plain miss — which, as you named it, revealed the wrong
underlying model. A miss must never be negative evidence, full stop,
however many there are.

**Root cause**: `readExecution`'s training-credit average folded a
`MISSED` session's hard-zero `stimulusCompletion` in alongside real data —
so a genuinely absent session dragged the score down exactly like a
poorly-executed one, and could single-handedly cap the whole verdict via
`EXECUTION_GATE`. That is the identical shape Rule 8 already named for
five other readers in this codebase; this is the sixth.

**Fix**: `MISSED` sessions (and a new `telemetryCompromised` state, see
below) are now excluded from the training-credit average entirely —
narrated separately ("N not run" / "N telemetry-compromised"), scored as
neither positive nor negative. When nothing attempted has trustworthy
data, the dimension correctly returns `null` (Rule 1's own stated
principle: absence of evidence is excluded from the mean, never scored as
zero) rather than a punitive number.

**Proof this cannot cause a downgrade** (`_adaptation_model.test.ts`,
`RULE8CLOSE-1` describe block): swapping one MISS for the real incident's
telemetry-compromised session leaves the execution score **exactly**
unchanged — not "not worse," which would still tolerate the "beat a
negative miss score" framing you rejected. Both are excluded from the
average; there is nothing left for either one to beat or lose to.

**Proof missing training cannot lower capacity belief**
(`_absorption_split.test.ts`, `_duration_volume_density_replay_corpus.test.ts`):
a taper-window's genuine misses now score identically whether or not the
window-filter strips them (previously the filter's whole job), and a
**connected finding**: `DURATION 3`'s documented live bug — the unfiltered
verdict wrongly blocking DURATION progression off taper-window misses
that were never the runner's fault — is fixed as a *consequence* of this
change, not worked around a second time by the not-yet-promoted
`representative_execution` shadow path.

Every test that encoded the old model was rewritten, not just patched to
pass: the doctrine-progression-table `marginal`/`poor` fixtures now use
genuinely poorly-executed (`PARTIAL_FAILED`) sessions instead of leaning
on punitive miss-scoring; the "execution is a gate" block proves a
mostly-missed block is blocked from `strong` by the PROGRESSION gate
(insufficient evidence), never punished into `poor`.

**Falsified per Rule 18**: reverted to scoring MISSED as a hard zero,
confirmed 4 tests fail in exactly the cases that predicate gets wrong,
restored, confirmed clean.

Commit `c0790b57`.

## 3 · The minimal TELEMETRY_COMPROMISED state

Built, not just plumbed inert. Rather than widen `ExecutionState` (an
eighth value would ripple into Today/Watch/post-run UI files this task
does not own — a real blast-radius risk I checked before deciding
against it), `interpretExecution` now accepts `ctx.telemetryCompromised`
— set by a caller who already knows, never inferred inside this pure
module — and quarantines `evidence.fitness`/`evidence.adaptation` to
`'none'`/`'unknown'` while preserving the real, trustworthy
`stimulusCompletion` (distance/duration survive; per-phase pace/HR/incline
compliance does not get graded).

This also protects a consumer I found while tracing the blast radius:
`lib/coach/fitness-evidence.ts` gates on `evidence.fitness === 'high'` to
feed capacity-adjacent conclusions elsewhere — a telemetry-compromised
session can never reach that gate now, closing the exact "any negative
[or positive] capacity conclusion caused by app failure" risk you named.

**What is NOT built, and why, stated plainly rather than left silently
inert (Rule 21's lesson)**: no detector sets this flag yet. Detecting
"this session's data is telemetry-compromised" requires domain knowledge
(which build, which payload field, which device path) this pure
interpreter doesn't have, and building it here would duplicate the
treadmill owner's own state machine — the thing you explicitly told me
not to do. The plumbing is real, typed, and tested
(`_adaptation_model.test.ts`'s `RULE8CLOSE-1` block includes a direct
`interpretExecution` unit test proving the quarantine fires and the
completion figure survives); wiring an actual detector to it is separate,
future work, owned by whichever session has that domain knowledge.

Commit `c0790b57` (same commit as item 2 — they're one coupled fix).

## 4 · Short-rep HR: collection and persistence were never suppressed — only the on-screen number, and only during work-phase short reps

Traced the live code path rather than asserting from memory.
`showHrThisPhase` (`LiveRunTreadmillV5.swift`) gates exactly one thing:
whether the HR pill paints a number on screen, scoped to WORK phases only
(`guard let phase = walk?.phase, phase.type == .work else { return true }`)
— warm-up, recovery and cooldown HR is never hidden by this guard, only a
60-second work rep's number, per `hrRoleForRepDuration`'s physiological
reasoning that HR hasn't reached steady state in that window.

**Proof collection is unconditional**: `Task { await hr.start(from:
cp.startedAt) }` runs once at session start, not gated by phase or
`showHrThisPhase` — the underlying `TreadmillHRStreamer` samples
continuously regardless of what's painted on screen.

**Proof persistence is unconditional**: `.onChange(of: hr.currentBpm) {
_, bpm in session.currentBpm = bpm }` — the exact line comment reads
"Push heart rate INTO the recorder as a plain stored value" — fires on
every sample change, feeding the recorder that produces the saved run,
completely independent of the display gate.

**One thing I did NOT do**: change the display-suppression itself. That
was your own round-6 instruction ("show effort as the governing
instruction... do not expose the non-actionable short-rep HR number") —
a deliberate coaching-voice decision, not a bug. Your new wording asked me
to "state exactly which behavior is suppressed and prove the live
treadmill display receives continuous samples" — I read that as asking
for verification of the boundary, not a mandate to reverse a prior
explicit ruling, and did not touch it. If you want the on-screen number
shown even during short work reps, that's a real UX call to make
explicitly — flag it and I'll wire it, but I won't silently override a
round-6 decision on my own read of ambiguous wording.

Static/source verification only, per the treadmill owner's exclusive
ownership of runtime — I did not duplicate their state machine or attempt
a live physical-device pass for this item.

## 5 · The Friday/Sunday schedule swap — full field audit, no code change (verification only)

Queried every meaningful field across the swap window
(`plan_workouts` for 2026-09-03 through 2026-09-08, all columns) and
cross-checked against every OTHER `easy`/`long` day in the plan to confirm
consistency, not just internal coherence:

- **Thu 9/3** (intervals, 6mi): `original_type`/`original_distance_mi`
  match the current row exactly — genuinely untouched by the swap.
- **Fri 9/4** (now `long`, 15mi, was `easy`/7.5mi —
  `original_type: 'easy'`): pace target `520` s/mi, `hr_cap_bpm: 151`,
  `fuel_mi: [5,9,13]` — **byte-identical** to every other `long` entry in
  the plan from 9/4 onward (9/20, 9/27, 10/4, 10/11, 10/18, 10/25, 11/1,
  11/15 all read `520`/`151`), confirming this wasn't a stale or
  one-off-miscalculated value.
- **Sat 9/5** (rest): unchanged, `original_type: 'rest'` matches.
- **Sun 9/6** (now `easy`, 7.5mi, was `long`/15mi —
  `original_type: 'long'`): `hr_cap_bpm: 151` matches every easy day from
  8/31 onward (the plan's post-re-anchor standard); top-level
  `pace_target_s_per_mi: null` with `hi`/`lo` range in `workout_spec`
  matches the plan's universal convention for `easy`-type rows (checked
  15 other easy days — every one is `null` at the top level); `fuel_mi:
  []`, correctly emptied rather than left over from the old long-run row;
  `notes: "Aerobic day. Keep it easy and honest."` — freshly authored, not
  a leftover.
- **Mon 9/7** (rest): `original_type: 'rest'` — this is NOT a retroactive
  edit from the swap. It was authored as rest at the plan's original
  generation time (the taper into the 9/13 race), which answers your
  "explicit authorization/source" question directly: there is no separate
  authorization to produce, because nothing was adapted here.
- **No duplicates or orphans**: exactly 1 active-plan row per date on both
  swapped dates; the pre-swap plan version (`pln_9a57561debb776e5`) is
  properly archived (`archived_iso` set), not live.

Today/week-strip/Watch all resolve through the same generic
`day-resolver.ts`/`v5/today` route paths already exercised by every other
day in this plan — I did not re-render this specific screen live (Rule
13), since the code path itself is unmodified and generic, not something
this swap touched. Flagging that as an honest limit rather than claiming
a render-verification I didn't do.

## 6 · Cache/backfill — the "unclaimed" claim in round 8 was wrong; retiring the backfill request

Traced `app/api/v5/today/route.ts`: **PLANVERSION-1**, already shipped by
the Today-reliability session on 2026-09-03, threads
`planVersion = "${activePlan.id}:${activePlan.last_adapted_at}"` onto
every response specifically so the client can invalidate a cached day
"the moment the plan underneath it moves" — its own header comment names
`lib/plan/adapt.ts` stamping `last_adapted_at` on every adaptation pass,
rebuild or re-anchor alike, as exactly the mechanism this covers.

Confirmed end-to-end on the client: `HostsV5.swift`'s
`planVersionAcceptable(candidate:current:)` validates every cached entry
(including cached week entries) against this exact field before trusting
it.

The schedule swap's `last_adapted_at` bump to `2026-09-04 02:16:43` is
therefore **already covered** — `planVersion` changed the instant that
write landed, and any client cache for that plan invalidates on its next
fetch through the existing mechanism. **The standalone backfill is
obsolete. Not run, and should not be.** Cache ownership was never
unclaimed; that line in the round-8 handback was simply wrong, and I'm
correcting it here.

## 7 · The 9/13 race — the row already existed; my earlier claim was a query error, not a real gap

Queried the `races` table directly (not through any app-level filter, per
Rule 14's "verify without the app's own filters first"). The row exists:
`santa-monica-10k-2026-09-13`, `meta.name: "Santa Monica 10k"`,
`meta.date: "2026-09-13"`, `meta.distanceMi: 6.2`, `priority: "B"`, with a
full course profile (elevation, aid stations, parking, packet pickup).
The `plan_workouts` row for that date names it explicitly in its own
`notes` field ("Santa Monica 10k. B race · race effort..."), and the two
match on distance and date exactly.

My round-8 claim that no matching row existed was a query defect — the
`races` table has no `date_iso`/`name`/`distance_mi` columns at the top
level (they live inside the `meta` jsonb), and my first query against
this table used the wrong column names, silently erroring rather than
finding the row. Corrected here, per Rule 14's discipline of naming the
population a query actually reads. **No write was needed or made.**

## Final integration proof

- **Base reconciled**: fetched and merged `origin/main` seven times across
  this session as other sessions' work landed concurrently (treadmill P0
  closure, the postrun-experience-lead redesign — 95 files, 6800+
  insertions — CANCELBANNER-1/STAGE1-DIAG-1, PLANSNAPSHOT-1). Every merge
  inspected for real conflict before trusting it; three-way conflicts on
  `_swallowed_failure_fixes.test.ts`/`coercion-registry.ts`/`route.ts`
  and on `RepBreakdownV5.swift`/`RunAnalysisV5.swift` resolved by hand
  (two other sessions independently converged on functionally identical
  fixes for the same root causes I'd found — resolved in favor of
  whichever wording was already established, never a rubber-stamp).
- **Two merge-silent defects found and fixed, neither from my own
  diffs**: a duplicate `paceShape` property declaration
  (`app/api/watch/workouts/complete/route.ts`, TS2300 — two sessions
  independently added the same field to the same interface in
  non-conflicting hunks, so git's merge combined both without seeing the
  semantic collision) and a genuine new `check-derived-consistency.sh`
  finding in the brand-new `lib/plan/plan-snapshot.ts` (traced both
  flagged halves before exempting — one is a pure unit conversion of an
  authored value with nothing to reconcile against, same standing as the
  existing `lib/watch/heat.ts` entry; the other already routes through
  the canonical `runFacts`/`reconcileRun` resolver).
- **Full suite, final reconciled HEAD** (`2b7b5afa`): `tsc --noEmit` 0
  errors. `npm run prebuild` (all 22 shipping gates) PASS.
  `check-web-build.sh` PASS. CI unit tests PASS. `check-watch.sh` PASS
  (223 test cases; board-geometry guard not checked — no booted 46mm
  simulator in this environment, disclosed rather than assumed clean).
  `verify-commit.sh`: **CLEAN**.
- **Deployed**: pushed to `main`, Railway `latestDeployment.status:
  SUCCESS` confirmed on commit hash `2b7b5afa7cf324da2e1534c7f967919a09b181a8`
  exactly (not inferred from a green push — checked the deployment record
  directly, per Rule 19). Runtime logs confirm clean container start,
  Next.js ready, cron heartbeat armed, no crash loop.
- **Coordinated live** with the treadmill-execution session (`runcino-ba`)
  throughout — production had been undeployable on `main` since before
  either of us touched it tonight (a pre-existing spacing-gate break); we
  each independently found and fixed overlapping subsets of the same root
  causes in real time, and explicitly held pushes to avoid stacking on
  each other. Final state: no duplicate fixes landed, both sessions
  confirmed the same green deployment.

**What this proves, stated as the two claims you asked for explicitly**:

1. **Supplemental activity cannot seal a prescription.** Proven by
   `_sealing_identity.test.ts`'s full matrix, falsified against the old
   predicate (7/17 tests correctly fail on it), and now the one canonical
   answer routing through `day-resolver.ts` everywhere sealing is checked.
2. **Missing activity cannot reduce fitness/capacity belief.** Proven by
   `RULE8CLOSE-1`'s exact-equality assertion (miss vs. telemetry-
   compromised score identically — not "no worse"), by the taper-masking
   convergence proof, and by the DURATION-3 live-bug closure as a direct,
   traceable consequence rather than a claim taken on faith.

## Open, not closed here — named rather than silently dropped

- The short-rep HR display question (item 4): verified as designed, not
  changed. If you want the round-6 suppression revisited, that's a
  decision for you to make explicitly.
- No detector sets `telemetryCompromised` yet (item 3) — the typed
  plumbing exists and is tested; wiring a real detector is separate work
  for whichever session has the domain knowledge of which builds/payloads
  actually produced compromised data.
- Everything the treadmill-execution and postrun-experience sessions have
  in flight beyond what's described here is theirs, not reported past
  "merged and verified compiling/passing together."
