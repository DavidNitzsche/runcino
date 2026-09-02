# Stage 4 handback · the post-run experience

Branch `stage4/post-run` · base `a0ba9c9f` · head `76d05a0d` · **pushed, NOT merged**
Four commits. 24 files, +2985 / −36.

---

## 0 · Executive scorecard

| Area | Verdict | Direct evidence | Remaining contradiction |
|---|---|---|---|
| Canonical run identity | **PASS** | `runIdentityMatchSql` in `lib/runs/run-shape.ts`; all four id call sites migrated; `/api/runs/[id]` now opens by row PK **and** by `<uuid>-2026-09-01#0920`, both returning the same `decisionVersion`. Before: PK returned 404 while the recap route accepted it. | `loadRunDetail` still has no canonical-row predicate — it can return a merged twin. Named in §11, not fixed. |
| Today/Run Detail parity | **PASS** | One loader, one composer, one wire key. `_postrun_surface_parity.audit.test.ts` calls the three real handlers against production and asserts `JSON.stringify` equality of the whole `postRun` block, plus identical `verdict`/`win`/`facts`. Before/after strings in §4. | Parity is proven on the payload, not on the phone. |
| Workout execution truth | **PASS** | `PostRunExecution` — status, headline, summary, `stimulusDelivered`, confidence, reason codes — off `resolveWorkoutVerdict` and never re-graded. 40 real runs reach 7 of the 9 statuses. | `MODIFIED` and `SENSOR_LIMITED` are fixture-only; no real row in this window produces them. |
| Physiological-cost interpretation | **PASS** | `lib/prescription/hr-ceiling.ts` — one owner, and a SCOPE on every ceiling. His threshold day now reads "Work heart rate averaged 162 against a 164 ceiling", against a `pass` rule no server reader had ever looked at. | Drift/decoupling and recovery-HR are not in the cost read. Brief §4F asks for them. |
| Evidence impact | **PASS** | "This supports your current threshold range and ability to hold pace late. One session is not enough to move them." — read straight off `classifyStoredActivity`. This was the brief's one genuinely-absent P0. | `beliefTension` refuses with `no_belief_supplied` because the loader does not resolve a current belief. §11. |
| Plan impact / next action | **PARTIAL** | `PostRunPlanImpact` with five states; `UNCHANGED` vs `UNKNOWN` is a Rule 11 distinction the type enforces. Adaptation window bounded at both ends after the sweep caught five false `UPDATED`s. | Two days is an argued window, not a measured one. A pass that fires 50 hours late reads as `UNCHANGED`. |
| Phone/Watch consistency | **PASS (grading)** | `CEIL-SLACK-1`: the server graded every ceiling at the 30 s/mi fallback while the wrist used the phase's own tolerance — 10-12 s/mi apart on every easy and long day. Fixed, and the parity gate now has six ceiling cases from his real authored tolerances. | The watch does not yet consume `postRun`; its finish board is unchanged. |
| Charts and source quality | **FAIL (not attempted)** | — | Brief §4E (synchronized pace/GAP/HR/elevation) is untouched. §11. |
| Run-type states | **PARTIAL** | 40 real runs, 332 runner-readable strings, 0 findings; 13 fixture states. | No race, no injury-return, no chosen-skip and no duplicate-source row exists in the window. |
| Accessibility | **PARTIAL** | `accessibilitySummary` on the wire and audited; the "Why" disclosure announces expanded/collapsed and has a 44pt target; outcome is never colour-only (`changeState` is a code). | **No VoiceOver capture and no Dynamic Type pass.** Not done, not claimed. |
| Sealed-history immutability | **PASS** | `sealedHistoryChanged: false` is hard-typed to the literal, asserted on all 40 real runs. Nothing in this branch writes. | — |

---

## 1 · Provenance

- Start `a0ba9c9f`, end `76d05a0d`, branch `stage4/post-run`, worktree `agent-ae6bd4a86a1a5190f`.
- `d4ad5130` the canonical interpretation · `f4aa227d` CEIL-SLACK-1 · `b4ccad56` the phone · `76d05a0d` the real-run sweep.
- **No migrations. No writes.** `DATABASE_URL` was the read-only role for every run; no plan rebuild was triggered.
- **Deployed: nothing.** The branch is not merged. The pre-push hook reported `✓ next build green` on the last two pushes, which is evidence about the build and not about production (Rule 19).
- **Unverified claim, stated once: no screen has been observed rendering any of this.** §10.

---

## 2 · Previous and final ownership

| Question | Before | After |
|---|---|---|
| What did this run do to the workout | `deriveRecap` + `deriveWin` + `composeRecap`, arguments assembled independently at two call sites | `lib/postrun/experience.ts`, one composer |
| Which rows are this run | four call sites, four different subsets of three id spellings | `runIdentityMatchSql`, one fragment |
| What ceiling did the session set | the same three-rung ladder retyped at three call sites, none reading `spec.rules` | `lib/prescription/hr-ceiling.ts`, scoped |
| What slack grades a ceiling | wrist: the phase's own; server: always 30 | both: the phase's own |
| What did the run teach the coach | nothing read it | `readEvidence` over `classifyStoredActivity` |
| What does "what this did" mean | a weekly mileage percentage | `PostRunLearnedV5`, one component, both screens |

Contract version `postrun-1`; explanation contract `expl-1` (Stage 3's, unchanged).
Consumers: `/api/v5/today`, `/api/runs/[id]`, `/api/runs/[id]/recap` → `V5Today.postRun`, `RunDetail.postRun`.

**Deleted:** the `week-total` row; `app/api/runs/[id]/recap/route.ts`'s `RAW_ACCESS_ALLOWED` entry (clean, so the ratchet demanded the deletion).

**Not deleted:** `deriveRecap`/`deriveWin` still author the weather note and the tip, and are still the whole answer on a run the briefing declines to grade. Deleting them is a separate change.

---

## 3 · Data contract

`PostRunExperienceV1` — `execution`, `cost`, `evidence`, `plan`, `next`, `briefing`, `decisionVersion`.
`PostRunWire` is the runner-facing subset: `headline`, `summary`, `cost`, `learned`, `change`, `changeState`, `changes`, `next`, `why`, `accessibilitySummary`.

**Two deviations from the brief's §6, both argued in code:**

1. **`EvidenceRole` has a seventh member, `UNREAD`.** The brief's six cannot say "the read failed". Folding that into `INSUFFICIENT` prints "not enough evidence yet" over a database error — the exact collapse Rule 11 exists to stop. `UNREAD` also forces `PlanImpact` to `UNKNOWN` rather than `UNCHANGED`.
2. **`cost` carries `hrScope` beside `hrBpm`.** A work-phase mean and a whole-run mean are different quantities with different ceilings; the pair is chosen together so they can never be from two scopes.

**Compatibility:** the briefing ships as STRINGS into `win`/`verdict`/`facts`, which the app already renders — **no app release needed for the sentences**. The structured `postRun` block needs one. That distinction cost two earlier reports their conclusion and is stated here deliberately.

**Stored rows:** nothing needs re-authoring. Every value is resolved at read time from rows that already exist — the phase's own `tolerancePaceSPerMi`, the spec's own `pace_target_s_per_mi_lo` and `rules`. Both corrections reach him on deploy, without a plan rebuild.

---

## 4 · The real 4 × 1-mile fixture

Run `-258355938987883`, plan row `wko_eaa8cfd7cb94310b`, 2026-09-01. 8.50 mi, 4103 s.

| Phase | Asked | Ran | Wrist said | Canonical | HR |
|---|---|---|---|---|---|
| Warm-up | ≤ 8:22 ceiling | 2.10 mi · 8:36 | hit | Under the ceiling | 140 |
| Rep 1 | 7:10 ±8 | 7:02 | **drifted** | On target | 158 |
| Jog 1 | 1:00, no pace | 1:01 | — | not graded | 158 |
| Rep 2 | 7:10 ±8 | 7:09 | **drifted** | On target | 161 |
| Jog 2 | 1:00 | 1:04 | — | not graded | 156 |
| Rep 3 | 7:10 ±8 | 7:02 | **drifted** | On target | 164 |
| Jog 3 | 1:00 | 1:04 | — | not graded | 157 |
| Rep 4 | 7:10 ±8 | 6:59 | **missed** | Quicker than target | 166 |
| Cool-down | ≤ 8:22 ceiling | 2.11 mi · 8:53 | missed | Under the ceiling | 153 |

Session: `executed` · 3 hit, 1 fast, recoveries honest, no late collapse.
Evidence Engine: threshold `evidence`/moderate/0.55, durability `evidence`/moderate/0.55, `anchorMoveCandidate: false`.
Adaptations in window: none. Plan: `UNCHANGED`.

### Before → after, from the real handlers

```
BEFORE  /api/v5/today          win     "Hit target band on 4 of 4 reps, clean execution."
                               verdict "Tempo done, 8.5 mi total at 8:03/mi, avg HR 162
                                        across the 4 reps."
        /api/runs/[id]/recap   verdict "Tempo done, 4 mi @ 7:03, avg HR 162 across the 4
                                        reps. Work miles landed inside the 7:10/mi window,
                                        7s/mi quick, consistent through the block."
        /api/runs/[id]         404
        "What this did"        This week · 14.7 of 45 mi done · 33%

AFTER   all three              win     "Controlled work"
                               verdict "All four reps landed, with one quicker than the window."
                               facts   ["Work heart rate averaged 162 against a 164 ceiling."]
        decisionVersion        run:-258355938987883|plan:pln_9a57561debb776e5|
                               grade:threshold/executed|evidence:1.0.0   (identical on all three)
        "What this taught the coach"
                               This supports your current threshold range and ability to
                               hold pace late. One session is not enough to move them.
                               The plan is unchanged.
```

One run, one field name, two distances and two paces, live on his phone. That is the brief's first P0 measured rather than argued — and both surfaces called a threshold session "Tempo done".

**The 164.** `workout_spec.rules` carries `{kind:'pass', metric:'hr', op:'<=', scope:'work', value:164}`, authored by `spec-builder.ts` off `thresholdPassHrBpm(lthr)`. No server reader had ever looked at it. The old ladder took `lthr_bpm` 168, correctly marked it "not a hard cap", and said nothing about cost at all.

**Rendered screenshots: none.** §10.

---

## 5 · Run-type corpus

`_postrun_corpus.audit.test.ts` — his 40 most recent canonical rows through the real loader.

```
execution statuses  CONTROLLED 1 · EXECUTED 5 · FAST 7 · PARTIAL_PRODUCTIVE 1
                    SLOW 6 · INCOMPLETE 8 · INDETERMINATE 12
evidence roles      CORROBORATES 17 · CONTEXT_ONLY 23
40 runs · 332 runner-readable strings · 0 findings
```

Shapes exercised: watch with 9 phases, watch with 1, Apple Watch with 0, treadmill indoor, a 0.84-mile activity, an 18-mile long, planned and unplanned. Per state, from the sweep:

| State | What it says |
|---|---|
| Easy, no phases (Apple Watch) | "This run carries no session structure, so there is nothing to grade it against." Cost still reads: "Heart rate averaged 147 against a 151 ceiling." |
| Long, ceiling-shaped | "The work block came in ahead of the ceiling." |
| Treadmill, no prescribed pace | "The work phases carried no prescribed pace, so this is a record of what was run rather than a grade." |
| Unplanned, mixed set | "Some of the reps landed inside the window and some did not." |
| Incomplete | "One of two reps was finished before the session stopped." |
| Nothing demonstrated | "Recovery and circulation. It does not change what the coach believes about your fitness." |

**Not reachable in this window, and said rather than implied:** race, injury return, chosen skip, extra recovery, duplicate-source reconciliation, honest matched comparator. Those are fixtures or nothing.

**Three defects the sweep found on real rows, all fixed in `76d05a0d`:** a ceiling called a window on every long and easy run; "one of two reps were finished"; and an unbounded adaptation window that reported `UPDATED` on five historical days off a note filed a week later about a different run (Rule 14). After bounding it, the one run that still reports `UPDATED` is 2026-08-16 — his Americas Finest City half, whose `vdot_auto_recalc` landed the next day. The run that genuinely moved the plan is the one that says so.

---

## 6 · Strava-reference hierarchy

Implemented: **overview** (unchanged poster) → **briefing** (headline, execution sentence, cost sentence, in the existing recap tile) → **workout analysis** (`RepBreakdownV5`, unchanged) → **splits** → **route/zones** → **what this taught the coach** (new) → **log and share**.

Not implemented: the synchronized chart stack (§4E) and matched effort (§4I). §11.

---

## 7 · Cross-surface consistency

| Field | Today | Run Detail | Recap route | Watch |
|---|---|---|---|---|
| `postRun.decisionVersion` | ✓ | ✓ | ✓ | — |
| execution verdict | shared object | shared object | shared object | recomputed on-wrist, now **identical rule** |
| ceiling slack | phase's own | phase's own | phase's own | phase's own |
| "what this taught" | `PostRunLearnedV5` | `PostRunLearnedV5` (same component) | on the wire | — |

The wrist still grades its own phases live; `CEIL-SLACK-1` made that rule and the server's the same one, and `_watch_grader_parity.test.ts` now checks it on his real authored tolerances rather than on the fallback.

---

## 8 · Accessibility

Done: `accessibilitySummary` on the wire; the "Why" disclosure announces expanded/collapsed and carries a 44pt target over 14pt text; `changeState` is a code so no outcome is colour-only; every absent value draws nothing rather than a zero.

**Not done and not claimed:** no VoiceOver capture, no Dynamic Type pass at accessibility sizes, no reduced-motion check beyond reusing `V5.Motion.expand` (which already returns nil when reduced).

---

## 9 · Falsification

Every gate broken on purpose and watched to fail. Output is in the commit messages; summary:

| # | Falsification | Result |
|---|---|---|
| 1 | pass-rule rung removed from `workHrCeiling` | 4 failed / 29 passed — `expected null to deeply equal { bpm: 164 }` |
| 2 | `UNREAD` collapsed into `INSUFFICIENT` | `expected 'INSUFFICIENT' to be 'UNREAD'` |
| 3 | HR facts restated beside the cost sentence | `expected [ '162', '162' ] to have a length of 1` |
| 4 | `slackSec` removed from `gradeCeilingPhase` | `easy 8:15/mi against a 502 fast edge: expected 'hit' to be 'fast'` |
| 5 | the weekly percentage row put back | `[2640] ZERO_FOR_UNKNOWN · whatThisDidToTheWeek` |
| 6 | CEIL-MEANING-1, first draft | **PASSED — so the pin was a tautology.** It recomputed `mid − halfWidth === lo`, true of every symmetric band. Rewritten to call `expandSpecToPhases`. |
| 7 | CEIL-MEANING-1, rewritten · `bandToleranceSec` broken | `2026-09-06 long · effective ceiling: expected 500 to be 502` |
| 8 | ceiling wording reverted to "window"; plural restored | both new assertions failed with the exact old strings |

Number 6 is the one worth keeping: a gate that passed its own falsification was rewritten rather than shipped.

**What each gate cannot fail on** is written into every file header (Rule 22). In short: none of them can tell you a verdict is *right*; the parity gate passes on two screens agreeing about a wrong sentence; the fixture corpus skips the paths that break; the live audits are one account; and nothing here sees the phone.

---

## 10 · Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run prebuild` (18 gates) | `EXIT=0` |
| `vitest`, whole `web-v2` suite | **8625 passed, 15 skipped, 455 files** |
| `xcodebuild -scheme Faff` iOS Simulator | `** BUILD SUCCEEDED **`, iPhone and watch targets |
| `xcodebuild … test` | 116 tests, 5 failures — **all five pre-existing**, verified by stashing this change, regenerating the project and rerunning to the identical 116/5 baseline (four SignInFlow keychain cases, one V5Contrast week-strip ratchet at 3.055 vs 3.06) |
| `check-xcodeproj-sync` | OK · 216 Swift files, 216 references |
| `check-watch.sh` | `watch OK · 195 test cases` |
| Production | read-only role throughout; **no writes, no plan rebuild** |
| Deployment | **none — branch not merged** |

**Device rendering: NOT DONE.** The simulator build points at `http://localhost:3111` and the integration worktree owns that port. Everything above is server-side or a compile. *The composer returns the new sentences* is proven; *the screen shows them* is not, and this report does not claim it.

Two gates earned their keep in the first pass and both were right: `check-swallowed-failure` surfaced two latent query bugs hiding behind `.catch(() => ({rows: []}))` — `ORDER BY created_at` on `training_plans` and `ORDER BY (source …)` on `post_run_rpe`, neither column existing — which would have read forever as "this runner has no plan" and "no effort logged". `check-generated-content` refused the modules until they had a caller.

---

## 11 · Remaining limits

### Blocking

1. **Nothing has been rendered.** Rule 13's first clause is unmet for every string in this branch. Port 3111 is the blocker and it has one owner.
2. **`loadRunDetail` has no canonical-row predicate.** It can return a merged twin — `CANONICAL_ROW_SQL` is missing from its lookup while `lib/postrun/load.ts` has it. I did not add it because a history row that is currently openable would start 404-ing, which is a behaviour change on a screen I cannot render.
3. **`beliefTension` never fires.** The loader does not resolve a current threshold belief, so the Evidence Engine returns `no_belief_supplied` and the `CHALLENGES` arm — doctrine's "third outcome" — is fixture-only in production. Wiring `resolveThresholdCapacity` in is a cost decision (a corpus load per post-run payload) that wants a measurement first.

### Non-blocking

4. **Charts (§4E) and matched effort (§4I) are not attempted.** Two P1s, both substantial, both untouched.
5. **Cost is HR-only.** No drift, no decoupling, no recovery-HR, no RPE in the sentence (RPE reaches the facts).
6. **The two-day adaptation window is argued, not measured.** A pass that fires 50 hours late reads as `UNCHANGED`.
7. **`intendedStimulus` is null on unplanned runs while the sentence says "prescribed range".** Honest — the wrist did carry a target — but the two read oddly together on a run detail header.
8. **`MODIFIED` is declared and unreachable.** No real row produces it and no fixture asserts it; it is a brief enum member with no producer.
9. **The watch does not consume `postRun`.** Its finish board is unchanged, which the brief says is correct, but the cross-surface version check still has only three of four rows.

### Corrections to the brief, with evidence

- **P0 "execution interpretation is not a first-class object" was already fixed** before this stage, on 2026-09-01: `lib/execution/verdict.ts` is the one grader, `mapWatchPhases` is a mapper over it, and `_workout_verdict_owner.test.ts` scans for a second. What was missing was the session-level runner-facing form.
- **P0 "two post-run compositions can disagree" was half-fixed.** They already shared `deriveRecap`, `deriveWin`, `composeRecap` and `resolveWorkoutVerdict`. What they did not share was one OBJECT — and they did in fact disagree, with the two sentences quoted in §4.
- **P0 "what this taught the brain is mostly absent" was exactly right**, and was the most valuable thing in the brief.
- **The brief's own §6 `EvidenceImpact.role` enum cannot express a failed read.** §3.

### Handed to the coordinator, outside my boundary

- Stage 5's `expandEasy`/`expandLong` finding does not hold: the wire encodes a band as centre plus half-width and both wrist readers subtract the tolerance, so the enforced fast edge already equals the phone's ceiling. I made the change, watched seven tests fail, and reverted. The real defect was one layer down and is fixed as `CEIL-SLACK-1`.
- `targetPaceSPerMi` still means two things under one `paceShape: 'ceiling'`. Not unified; pinned by `CEIL-MEANING-1` so the build says so the day the coincidence stops holding.
