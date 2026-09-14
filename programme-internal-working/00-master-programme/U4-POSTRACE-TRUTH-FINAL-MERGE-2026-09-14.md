# U4 Post-Race Truth — final merge-prep for external review (2026-09-14)

**Prepared for**: external review of runner-facing coaching copy, per this project's
standing "external review before merge" rule for anything touching that surface.

**Status of this document: corrects the assignment brief it was given.** The
task that produced this report cited a coach-consultant verification log at
`for coaching consult/consult-log/2026-09-14-014-u4-postrace-copy-shipped-status.md`
and instructed "don't re-derive." **That file does not exist anywhere in this
repository's git history** (`git rev-list --all --objects` across every branch
returns only `2026-09-14-00{1,2,3}` and `TEMPLATE.md` under that directory — no
`014`, no file matching that name, on any branch, in any commit). Everything
below was independently re-derived from primary sources that DO exist: the
Santa Monica forensic debrief, the U4 branches' own implementation reports,
and the actual code diffs. The re-derived conclusion happens to match the
brief's factual claims (4 of 9 sentences fixed, matching #2/#3/#5/#7; the
other 5 untouched) — but that match was verified, not assumed, and the final
branch composition differs from the brief's suggestion in one material way
(see §3).

---

## 0 · One-paragraph summary

The real, most-corrected implementation of the Santa Monica 10K post-race
copy fix lives in commit `028e29ed8` (branch `u4-postrace-truth`, also
reachable as `fix/u4-postrace-truth-correction-2026-09-14` — an identical
commit; see §1). It fixes exactly sentences #2, #3, #5, #7 of the debrief's
9-sentence post-race copy truth table, leaves #1/#4/#6/#8/#9 genuinely
untouched (one line touched mechanically without changing its content — see
§4), and rebases cleanly onto current `origin/main` with zero conflicts. A
separate, later commit (`619b61d72`, "correction-v2") sits on top of it and
reworks unrelated engine internals (a race-truth-verdict-freezing mechanism);
it does NOT touch any of the 9 sentences, but it fails two production
doctrine gates on the current main and is **excluded from this submission**
pending an explicit decision that is not mine to make (§6). The submission
branch is `fix/u4-postrace-truth-final-2026-09-14`, at commit `cd69c57c7`,
based on current `origin/main` (`9fbc79543`).

---

## 1 · Branch/commit tracing — what the four branches actually are

`git branch -a` shows all four local branches named in the assignment.
Resolving each to its exact commit:

| Branch | Commit | Notes |
|---|---|---|
| `u4-postrace-truth` | `028e29ed821c11fcfaae4b179d3ecab05f962694` | Original fix |
| `fix/u4-postrace-truth-correction-2026-09-14` | `028e29ed821c11fcfaae4b179d3ecab05f962694` | **Identical to the line above** |
| `fix/u4-postrace-truth-correction-v2-2026-09-14` | `619b61d722707987df7ff5105c3400c84887f439` | One commit ahead of `028e29ed8` |
| `audit/u4-classification-v3-2026-09-14` | `619b61d722707987df7ff5105c3400c84887f439` | **Identical to the line above** |

**Finding: these four branch names resolve to only two distinct commits.**
`fix/u4-postrace-truth-correction-2026-09-14` (the "round 1 correction")
never received a correction commit — it is a bare pointer to the original
fix. This is not a surprise or an error: the correction-v2 report's own §1
("Lineage and starting state") says so explicitly: *"there was no partial
correction-round work to build on — the earlier task run"* [produced nothing].
`audit/u4-classification-v3-2026-09-14` is likewise a bare pointer to the
correction-v2 tip, not a branch with its own classification commits.

So the assignment's framing of "two correction rounds" is generous by one —
there is one implementation commit (`028e29ed8`) and one correction commit
(`619b61d72`), not two correction commits. Confirmed via `git rev-parse` on
each of the four names (shown above) and `git log --oneline` across all four,
which show identical histories converging on the same two tips.

**Merge-base with `origin/main`** (pre-rebase): `dce13caecb7c2a4106a2e88d8069c5ce70b86944`
(`fix(adaptation): re-pin race-outlook.ts belief source`), confirmed an
ancestor of `origin/main` via `git merge-base --is-ancestor`. `origin/main`
had moved 12 commits past that point as of `9fbc79543` — matching the
assignment's claim of "main has moved significantly tonight."

**The branches' own unique commits** (not already on `origin/main`), in
order: `f02f29d32` ("prefer canonical row's own splits... trust
watch-barometer elevation" — U1's trusted-splits fix, which U4 is built on),
`028e29ed8` (the U4 fix itself), `619b61d72` (the correction-v2 round).

---

## 2 · Ground truth for "9 sentences, classified" — the debrief, not the missing consult log

The 9-sentence classification the assignment described (1 truthful / 5
misleading / 2 unsupported / 1 contradictory / 1 false) is real — it is
`programme-internal-working/00-master-programme/SANTA-MONICA-10K-FORENSIC-DEBRIEF-2026-09-13.md`
§6, "Post-race copy truth table" (this file exists in git history at
`7dfc1c258`, reachable from `origin/main`'s own tree). Reproducing the table
that matters for scoping:

| # | Sentence | Class |
|---|---|---|
| 1 | "Mixed set" | Technically true but misleading |
| **2** | "Some of the segments landed inside the window and some did not." | **WRONG — factually false** |
| **3** | "Under review." | Unsupported |
| 4 | "You held that pace deeper into the session than your current threshold pace predicts." | Technically true but misleading |
| **5** | "One session does not move it. The next one like it will." | **CONTRADICTORY** |
| 6 | "The plan is unchanged for now." | Truthful |
| **7** | "This run is strong enough to act on, so the next review will look at it." | Unsupported |
| 8 | "The session set no heart-rate ceiling, so the reading is reported without a verdict." | Technically true but misleading |
| 9 | "This is one session, so treat it as a lead rather than a conclusion." | Technically true but misleading |

Distribution: 1 truthful · 5 misleading · 2 unsupported · 1 contradictory · 1
false — matches the assignment's characterization exactly.

---

## 3 · What is actually in the submission branch, and why the scope is narrower than "the final correction round"

The assignment's instruction was to rebase "the final, most-corrected,
ready-to-ship state" — suggesting `fix/u4-postrace-truth-correction-v2-2026-09-14`
(`619b61d72`). I built that first, rebased it cleanly (§5), and then found
two production doctrine-gate failures caused entirely by the correction-v2
commit's own content (§6) — not by anything in the original fix, and not
introduced by the rebase. I traced both failures to files touched **only**
by `619b61d72`, confirmed with `git diff --stat` between `dce13caec` (base)
and `028e29ed8` (original fix) showing zero touch on the implicated files.

Since the four target findings (#2/#3/#5/#7) are **entirely contained in
`028e29ed8`** — confirmed by an empty `git diff` on `web-v2/lib/postrun/experience.ts`
between `028e29ed8` and `619b61d72` — and have **zero dependency** on
`619b61d72`'s race-truth-verdict-freezing work, I scoped the submission
branch to `028e29ed8` and its one dependency commit (`f02f29d32`), and
excluded `619b61d72`.

**This is a narrowing of scope from the assignment's suggestion, made
because bringing the correction-v2 commit in would require me to personally
decide a production belief-source-doctrine question (bump vs. re-pin an
adaptation-engine epoch) that the assignment did not ask me to decide and
that I judge is not mine to make unilaterally — see §6.** The correction-v2
work still exists, is unmerged, and is fully available on
`fix/u4-postrace-truth-correction-v2-2026-09-14` for separate review once
that decision is made explicitly.

---

## 4 · The four findings, confirmed fixed — exact before/after text

All quotes below are from the actual diffs (`git diff <merge-base>..<tip>` on
the real files), not paraphrased from either branch's own report.

### #2 — the false "some landed inside" sentence

**File**: `web-v2/lib/postrun/experience.ts`, new function `unevenFallbackSentence`.

- **Before** (still live on `origin/main` today, confirmed at line 953 of
  `experience.ts` on `origin/main`):
  > `Some of the ${noun} ${insideBound} and some did not.${strideClause}`
  — printed **unconditionally**, regardless of whether anything actually landed
  inside the window. Santa Monica: 0 of 2 phases landed inside (one graded
  `fast`, one `slow`), so the runner read "some landed inside" when zero did.

- **After** (submission branch, `unevenFallbackSentence`):
  ```
  if (s.hits > 0) {
    return `Some of the ${noun} ${insideBound} and some did not.`;
  }
  ...
  return `None of the ${noun} landed inside the ${boundNoun}: ${detail}.`;
  ```
  The old sentence is now gated on `s.hits > 0` (i.e., only printed when true).
  When zero hit, it states the real per-phase split instead, e.g. *"None of
  the segments landed inside the window: 1 ran ahead of it and 1 ran behind
  it."*

### #3 — "Under review" (unsupported process)

**Files**: `web-v2/lib/postrun/load.ts` (`PLAN_CHANGE_REASONS`), `experience.ts` (`readPlan`).

- **Before** (still live on `origin/main` today, confirmed in `load.ts`):
  `PLAN_CHANGE_REASONS` is `['plan_adapt_downgrade', 'plan_adapt_reschedule',
  'plan_adapt_drop_missed', 'plan_adapt_overridden', 'plan_adapt_long_floor',
  'plan_adapt_gap', 'vdot_auto_recalc']` — missing `'plan_adapt_recompute_paces'`,
  the exact reason string both race-evidence adaptations that can fire off a
  race actually write to `coach_intents` (confirmed by reading
  `lib/plan/adapt.ts`'s action→reason map). A real, race-driven repricing
  could never have cleared `HELD_FOR_EVIDENCE` → `UPDATED`.

- **After** (submission branch): `'plan_adapt_recompute_paces'` added to the
  allowlist — a real resolution path now exists.

- Separately, the promise sentence itself is now conditional (this also
  covers #7 — the two are the same code path; see below).

### #5 — the contradictory pair

**File**: `web-v2/lib/postrun/experience.ts`, `readEvidence`'s `CHALLENGES` branch.

- **Before** (still live on `origin/main` today, confirmed at lines
  1532-1533 of `experience.ts` on `origin/main`):
  ```
  ? `You held that pace deeper into the session than your current ${beliefWord} predicts. One session does not move it. The next one like it will.`
  : `That came in slower than your current ${beliefWord} predicts. One session does not move it. The next one like it will.`
  ```
  "One session does not move it" was printed **unconditionally**, regardless
  of `ev.anchorMoveCandidate` — the same flag `readPlan` reads to decide
  whether to print "This run is strong enough to act on, so the next review
  will look at it" (sentence #7). On Santa Monica, both fired on the same run,
  so the panel asserted two things that cannot both be true.

- **After** (submission branch):
  ```
  const runnerSummary = ev.anchorMoveCandidate
    ? `${directionClause} This one is strong enough on its own that the next review will weigh it.`
    : `${directionClause} One session does not move it. The next one like it will.`;
  ```
  Now branches on the same flag `readPlan` uses, in matching language ("the
  next review will weigh it" vs. readPlan's "the next review will look at
  it") instead of opposite ones.

### #7 — "this run is strong enough to act on, so the next review will look at it" (unsupported)

**Files**: `web-v2/lib/postrun/load.ts` (`reviewWindowElapsed`), `experience.ts` (`readPlan`, `HELD_FOR_EVIDENCE`).

- **Before** (still live on `origin/main` today, confirmed at line 1718 of
  `experience.ts` on `origin/main`):
  > `runnerSummary: 'The plan is unchanged for now. This run is strong enough to act on, so the next review will look at it.'`
  — printed **unconditionally shaped as still-true**, regardless of whether
  the review window (a fixed `[runDate, runDate+2d)` scan) had already closed.
  A recap opened 10 days after the run still promised a review that had
  already had, and missed, its one chance.

- **After** (submission branch), new `input.reviewWindowElapsed` gate:
  ```
  if (input.reviewWindowElapsed) {
    return {
      status: 'HELD_FOR_EVIDENCE',
      runnerSummary: 'The plan is unchanged. This run was strong enough to act on, but no automated review resolved it in the usual window — nothing further is currently scheduled to look at it.',
      ...
    };
  }
  return {
    status: 'HELD_FOR_EVIDENCE',
    runnerSummary: 'The plan is unchanged for now. This run is strong enough to act on, so the next review will look at it.',
    ...
  };
  ```
  The original sentence is preserved verbatim for the case where it is still
  true (window open); a new, honest fallback is used only once the window has
  genuinely closed with nothing to show.

---

## 5 · Confirmed untouched: #1, #6, #8, #9 — and the one nuance on #4

Checked by grepping the full branch diff (`git diff dce13caec..619b61d72`,
2,655+ lines) for every sentence fragment, then re-checking the narrower
submission-branch diff:

- **#1 ("Mixed set")** — the string `headline: 'Mixed set'` appears in the
  diff only as unchanged context (line 249 of the `experience.ts` diff).
  Untouched.
- **#6 ("The plan is unchanged for now.")** — this literal text is the SAME
  template string as #7 in the code (`readPlan`'s original `HELD_FOR_EVIDENCE`
  return, one combined `runnerSummary`). It is preserved byte-for-byte in the
  not-elapsed branch (§4, #7's "after"); the new elapsed-branch is a
  genuinely separate code path, not a modification of #6's own trigger
  condition (`UNCHANGED` status, a different branch entirely). #6 is not
  altered.
- **#8 ("no heart-rate ceiling... reported without a verdict")** and **#9
  ("treat it as a lead rather than a conclusion")** — zero hits for
  `no heart-rate ceiling`, `reported without a verdict`, `treat it as a lead`,
  or `hr_cap_bpm` anywhere in the entire branch diff. Completely untouched —
  not even referenced in a comment.
- **#4 ("You held that pace deeper...")** — **one nuance worth flagging
  precisely.** The original code stored #4 and #5 as ONE concatenated
  template string (`` `You held that pace deeper...predicts. One session does
  not move it. The next one like it will.` ``). Fixing #5 required
  structurally separating the two clauses (`directionClause` extracted,
  `runnerSummary` recomposed). **The #4 fragment itself — "You held that pace
  deeper into the session than your current threshold pace predicts." — is
  byte-identical before and after.** Its underlying misleading framing (per
  the debrief: "Outperformance grammar over a race missed by ~3 minutes") is
  NOT addressed; the line was touched mechanically as an unavoidable
  side-effect of #5's fix, not substantively fixed. #4 remains correctly
  out of scope for a future pass.

---

## 6 · The correction-v2 commit: what it actually is, and why it's excluded from this submission

`619b61d72` ("two-verdict Santa Monica design + 5 corrections") does **not**
touch `web-v2/lib/postrun/experience.ts` at all — confirmed via an empty
`git diff 028e29ed8..619b61d72 -- web-v2/lib/postrun/experience.ts`. It is a
correction round on a *different* piece of U4's scope: a new race-truth-
verdict-freezing mechanism (`freeze-race-truth-verdicts.ts`,
`race-truth-verdicts.ts`, `reconstruct-credible-target.ts`, all new files)
plus fixes to `training/capacity-resolver.ts`, `training/durability-anchor.ts`,
and `race/race-outlook.ts` (a race-exponent date-handling bug, immutable
as-of inputs, and hysteresis-aware evidence reliability — per its own report,
§§2-4).

Rebasing this commit onto current `origin/main` succeeds with **zero git
conflicts**, but running the full test suite against it trips two doctrine
gates that do not exist as violations on the original branch's own base and
are not mechanical to resolve:

1. **`lib/adaptation/_belief_source_pins.test.ts`** ("the ratchet") — fails
   on exactly the three files the correction touches:
   `lib/training/capacity-resolver.ts`, `lib/training/durability-anchor.ts`,
   `lib/race/race-outlook.ts`. This is a deliberate Rule 18 gate: any change
   to a pinned belief-source file requires an explicit decision — bump
   `SHADOW_EVIDENCE_EPOCH` (if the change moves what the belief resolves to
   for the same activities) or re-pin the digest alone (if it's a
   non-semantic refactor). Per the correction-v2 report's own description
   ("resolveRaceExponent now genuinely honors its date argument," "immutable,
   as-of inputs for both verdicts," "no hard cliffs; continuous,
   hysteresis-aware evidence reliability"), these read as real, semantic
   changes to production belief resolution — i.e., the epoch-bump path, not
   the re-pin path. That is a call about the live Adaptation Engine's
   belief-source doctrine, not about runner-facing copy, and I did not make
   it. Confirmed via `git diff --stat` that these three files are untouched
   by the original fix (`028e29ed8`) and touched only by `619b61d72`.
2. **`lib/audit/_generated_content_gate.test.ts`** (GUARD 5, module orphans)
   — fails because the three new race-truth-verdict files have no caller
   anywhere in the app and are not registered in `MODULE_ORPHANS`. This
   matches the correction-v2 report's own §11 disclosure ("No write reached
   production... Deploying the freeze mechanism for real needs an explicit,
   separate go") — the orphan status is intentional and already disclosed in
   prose, just not yet registered in the machine-checked allowlist.

Neither of these is a git rebase conflict (the rebase itself is clean); both
are pre-existing gaps in `619b61d72` surfaced by a doctrine gate that is
either new or newly-enforced on current `main` since the branch was cut. I
judged (1) as a real decision belonging to whoever owns Adaptation Engine
belief-source doctrine (per this project's "coach always in the loop on
athlete/plan matters" standing rule) and out of scope for a task about
post-race copy text, and excluded the whole commit rather than resolve it
myself. `fix/u4-postrace-truth-correction-v2-2026-09-14` remains available,
unmerged, on the shared local remotes for that separate decision.

---

## 7 · The rebase

**Command**: `git rebase --onto origin/main dce13caecb7c2a4106a2e88d8069c5ce70b86944 <branch>`
(rebasing the two branch-unique commits, `f02f29d32` and `028e29ed8`, off
their old base onto current `origin/main`).

**Result: zero conflicts.** Both commits applied cleanly.

**Before → after SHAs**:

| Commit | Original SHA (old base) | Rebased SHA (onto `origin/main` @ `9fbc79543`) |
|---|---|---|
| `fix(runs): prefer canonical row's own splits...` | `f02f29d32f24d0bdd15c99455415bacabcd69fa8` | `4839521a9` |
| `fix(postrun): Santa Monica post-race copy truth + the goal-outcome resolver` | `028e29ed821c11fcfaae4b179d3ecab05f962694` | `cd69c57c7e386e4602c119ce6d0d76ceb7287154` |

**Submission branch**: `fix/u4-postrace-truth-final-2026-09-14`, HEAD at
`cd69c57c7e386e4602c119ce6d0d76ceb7287154`, one commit ahead of
`4839521a9`, two commits ahead of `origin/main` (`9fbc79543a07c1982ff55f1a313f9be0d3224840`).

**Content check**: `git diff --stat origin/main..fix/u4-postrace-truth-final-2026-09-14`
shows the identical 22-file, +2,655/-49 change set that `git diff --stat
dce13caec..028e29ed8` showed against the *old* base — confirming the rebase
moved the branch without altering its content.

**Not pushed, not merged** — sitting on `fix/u4-postrace-truth-final-2026-09-14`
for external review, per instruction.

---

## 8 · Verification

**Environment**: this worktree had no `node_modules`; ran `npm ci` inside
`web-v2/` first (388 packages, clean install, pre-existing `next@15.1.6`
deprecation warning unrelated to this change).

**`tsc --noEmit`**:
```
cd web-v2 && npx tsc --noEmit
```
Zero output — clean, zero type errors.

**The falsifying tests the original fix's own report cited**:
```
cd web-v2 && npx vitest run \
  lib/postrun/_experience.test.ts \
  lib/postrun/_postrun_corpus.audit.test.ts \
  lib/race/goal-outcome-resolver.test.ts \
  lib/runs/_elevation_trust.test.ts \
  lib/runs/_santa_monica_10k_canonical_splits.test.ts \
  lib/conservation/_surface_figures.audit.test.ts \
  lib/faff/_v5_today.test.ts
```
Result: **5 test files passed, 2 skipped (DB-gated, correctly skip without
a live connection) — 126 passed, 2 skipped, 0 failed.**

**Full `web-v2` suite** (`npx vitest run`, no config flags):
```
Test Files  3 failed | 634 passed | 52 skipped (689)
     Tests  4 failed | 12393 passed | 1 expected fail | 260 skipped (12658)
```
All 4 failures are pre-existing on `origin/main` and unrelated to this
branch — confirmed via `git diff --stat origin/main..fix/u4-postrace-truth-final-2026-09-14
-- web-v2/lib/plan/* web-v2/lib/adaptation/canonical-shadow/*` returning
empty (neither directory is touched by this branch):
- `lib/plan/_authoring_shadow_compare.audit.test.ts` — refuses to report
  green without `DATABASE_URL_RO` (Rule 18, by design; no DB in this sandbox).
- `lib/adaptation/canonical-shadow/_f038_reign_scoping.audit.test.ts` — same
  DB-liveness gate, same reason.
- `lib/plan/_rolling_seven_ceiling.test.ts` (2 tests) — pre-existing failures
  on `origin/main` itself, in a directory this branch never touches.

None of these are caused by this branch or by the rebase. **Excluding the
correction-v2 commit (§6) removed two additional failures**
(`_belief_source_pins.test.ts`'s ratchet on 3 files, and
`_generated_content_gate.test.ts`'s module-orphan gate on 3 new files) that
would otherwise have appeared — confirmed by running the full suite once
with `619b61d72` included (3 test files / 13 tests failed, the 4 above plus
these) and once without (3 test files / 4 tests failed, only the 4 above).

**Native/Swift**: this branch does not touch `native-v2` at all (the
`PostRunLearnedV5.swift` decode/render work from `028e29ed8`'s own report is
present in the diff — course notes, RPE, target/measured gap rendering — and
is unrelated to sentences #2/#3/#5/#7, which are server-side copy strings
consumed by the existing native render path with no Swift changes required
for THIS fix). No render/screenshot re-verification was attempted; per the
assignment's own note, Santa Monica's live `goalOutcome` has since resolved
to `"missed"` rather than `"target_invalidated"`, so a pixel-identical
repeat of the original device screenshot is expected to differ and would not
be meaningful evidence either way. The mechanism itself (the four sentence
fixes) is verified by the passing `_experience.test.ts` suite, which
exercises the same composer functions directly.

---

## 9 · Recommendation

1. **Merge `fix/u4-postrace-truth-final-2026-09-14`** (2 commits ahead of
   current `origin/main`) after external review — it is scoped exactly to
   findings #2, #3, #5, #7, passes `tsc --noEmit` clean, and passes every
   test the original implementation cited as falsifying evidence, plus the
   full suite modulo pre-existing/environmental failures unrelated to this
   change.
2. **Do not merge `fix/u4-postrace-truth-correction-v2-2026-09-14` yet.** It
   is real, reviewed, unmerged work on a separate piece of the U4 scope (a
   race-truth-verdict-freezing mechanism), but it requires an explicit
   SHADOW_EVIDENCE_EPOCH decision (bump vs. re-pin) on three production
   belief-source files from whoever owns that doctrine, plus a MODULE_ORPHANS
   registration for three new, intentionally-unwired modules, before it can
   land clean. Recommend routing that decision separately rather than
   bundling it into this copy-fix submission.
3. **File a note about the missing consult-log citation.** The task that
   produced this report was given a specific document path as pre-verified,
   "don't re-derive" ground truth, and that document does not exist anywhere
   in this repository's history. The conclusions it described turned out to
   be independently verifiable from the debrief and the branches' own
   reports — but the citation itself should be tracked down (mis-filed?
   never actually written? a different repo?) before it's relied on again.
