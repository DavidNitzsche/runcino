# Post-run experience — round 9, final narrow corrections

**Branch:** `feat/postrun-experience-lead`
**Status:** final closure pass — no further post-run feature expansion after
this, per instruction.

This is the handback for the five narrow corrections requested after
reviewing round 8 at original resolution, plus the item-6 reconciliation
against a now-green `main`.

---

## 1 · Meaningless plan-impact language removed

**Root fix, `web-v2/lib/postrun/load.ts`:** the fallback that manufactured
`"The plan was adjusted."` whenever an adaptation's own `why` text had
nothing runner-safe left after the citation scrub is gone.
`PostRunAdaptation.display` is now `string | null` — a real, distinguishable
fact, not a guess dressed as one.

**`readPlan` (`web-v2/lib/postrun/experience.ts`):** `changes` now contains
only adaptations with a genuine readable description
(`.filter((d): d is string => d != null)`). A new field,
`descriptionContractSatisfied: boolean`, is `false` on `UPDATED` whenever at
least one firing adaptation had no readable description — the caller can
now tell "nothing changed" apart from "something changed and the engine
cannot say what," which the old code collapsed into one manufactured
sentence.

**Recorded, not silently dropped:** the moment `runnerSafeWhy` returns null
for a real adaptation, `load.ts` writes a `console.warn` naming the
`coach_intents.reason` — the internal contract-defect record the
instruction asked for, at the one place the gap is actually visible
server-side.

**Test, proving the exact claim:** two new cases in `_experience.test.ts`
— one all-null, one mixed readable/unreadable — assert `changes` never
contains `"The plan was adjusted"` (by pattern, not just by checking the
array is empty, so a *different* future placeholder would also be caught)
and that `descriptionContractSatisfied` is `false` in both.

**Verified live, real server data (not a stale fixture):** re-fetched the
Americas Finest City run directly from the walk-substrate after this fix
landed. The underlying adaptation for that run turned out to have no
readable `why` at all — a genuine real-world instance of the gap this item
exists for. The compact row now reads:

> ↻ **Plan updated.**

— alone, no bullet, no filler — and "Why" surfaces the real reason instead
(`describeAdaptationCause`'s own clause, independent of the missing
per-adaptation description): *"The plan changed because your race result
recalculated your fitness baseline directly."*

---

## 2 · Why no longer repeats the compact plan-status line

`WorkoutResultV5.swift`'s `change` (the text rendered inside "Why") is now
`nil` specifically when `changeState == "UNCHANGED"`, where it used to
restate the compact row's "Plan unchanged." word for word as "The plan is
unchanged." — exactly the repetition flagged from the screenshot. `UPDATED`
and `HELD_FOR_EVIDENCE` keep their sentences, which carry real information
the compact row's bare status word does not.

**Verified live:** the interval fixture's Why now shows only the HR context
and the relocated tolerance sentence — no restated plan status.

---

## 3 · Provenance moved fully behind Why

The primary Coach's Read card no longer shows the `"Compared with:
Watch-built workout"` line. That reasoning (PROVENANCE-1, "the fact stays
visible, not behind Why") is superseded by this instruction. The full
sentence is unchanged and still lives in Why. The now-dead short-label
derivation (`targetProvenanceShortLabel`) was deleted rather than left
unused.

**Verified live:** the race fixture's primary card is down to one verdict
and one sentence; the full provenance sentence — *"These segment targets
are the pace plan you set for this race, not one from the app."* — now
appears first inside Why.

---

## 4 · Skip reporting is transparent

`repCompletionSummary`'s denominator no longer shrinks by subtracting a
chosen skip. A skip has a real phase record and is one of the *prescribed*
reps, not one fewer of them — the exact "3 of 3 completed" defect named in
the review.

Four reps with one chosen skip now reads:

> **3 of 4** completed
> 1 intentionally skipped

never "3 of 3." The full distinction — prescribed / completed / partial /
skipped / missing / extra — is preserved:

- `total` (the denominator) is `planned` when known, else the raw recorded
  count (which already includes a skip's own entry).
- `sub` lists every applicable qualifier in order: ended-early count,
  intentionally-skipped count, missing count.
- "extra" (more recorded than planned) still returns `"Recorded"` / the
  total, never a completed/planned fraction against a number the plan
  never set.

Two unit tests updated/added for the exact shape from the review
(`testChosenSkipNamedAgainstTheFullPrescribedCount`,
`testFourPrescribedOneChosenSkipReadsAsThreeOfFour`), plus the
skip+partial-combined case. No real fixture on hand has a chosen skip on
its primary page, so this is proven at the resolver level, same posture as
the rest of `RepCompletionSummaryTests.swift` from round 8 — see that
file's own header for why hand-editing a fixture to fake one would be the
wrong kind of verification.

---

## 5 · Dead `toleranceLine` interface deleted

`RepBreakdownV5`'s `toleranceLine` parameter — every live call site already
passed `nil` since round 8 moved its content into `PostRunVerdictV5
.analysisNote` — is gone: the stored property, its dead rendering branch,
and the argument at all three call sites. `RunDetailV5.toleranceLine` (the
computed property that produces the *text*, now feeding `analysisNote`)
is unrelated and unchanged.

---

## 6 · Reconciliation

**Main was red, then corrected by another session, confirmed independently
before merging.** Checked `lib/adaptation` in an isolated worktree at the
tip that carried the fix (`46c2fe85`, "re-pin race-outlook.ts belief-source
digest"): **all 6 previously-failing tests now pass, 0 failures.** Did not
take ownership of that fix — flagged the standing-red state clearly in the
round-8 handback and waited for the actual owner, per instruction, rather
than merge past it or describe the chain as green before it actually was.

- Re-fetched and merged `origin/main` twice this round as it moved:
  `626a4414` (round 8 base) → `46c2fe85` (adaptation fix landed) →
  `92a5b8f9` (`7baf4e85`, plan-sealing logic, unrelated to this branch's
  area, merged cleanly with no conflict). Final merge base: `92a5b8f9`.
- Two real merge conflicts total, both in `project.pbxproj` (the two times
  main carried native-project changes) — resolved by regenerating from
  `project.yml` via `xcodegen generate`, never by hand-merging the
  generated file.
- **Full shipping chain, run clean at the final merge base:**
  - `tsc --noEmit`: clean.
  - `xcodebuild ... build` (full `Faff` scheme, watch target included):
    `** BUILD SUCCEEDED **`.
  - `xcodebuild ... test` (full `FaffTests`): clean at the final merge —
    `** TEST SUCCEEDED **`, all suites, network fence intact. (One
    transient failure in an unrelated fuzz test,
    `DecodeSweepTests.testWireCorpusSurvivesOneCorruptionAtATime`, a
    1500+-case randomized decode sweep, appeared once during an earlier
    intermediate run and passed on immediate reruns in isolation and in
    full — a non-reproducing flake, not tied to this branch.)
  - `vitest run` (full suite, web-v2): **10026 passed, 24 skipped. Three
    deterministic failures, all pre-existing on `origin/main` independent
    of this branch — see below. Everything else green.**

### The two remaining vitest failures — diagnosed, not this branch's

`lib/faff/_today_thesis.audit.test.ts` and `lib/faff/_voice_live.audit.test.ts`
both fail on the identical root fact: the live Today "why" text for
**2026-09-06** (an aerobic/easy day) reads *"You're in the part of the
block where the hard sessions do the work. Aerobic day."* where both tests
require it to contain *"the thing to move right now"* — the Layer-1
phrasing the coaching-thesis composer (`why-voice.ts`) is supposed to use
whenever a day's prescription addresses the runner's current limiter.

**Confirmed, not assumed, pre-existing and unrelated:**

- Zero file overlap — `git diff` between this branch and its merge-base
  touches no file either failing test imports, directly or transitively
  (`why-voice.ts`, the thesis composer, and everything under
  `lib/training/thesis*` are untouched by this pass).
- Reproduced **byte-for-byte identical** — same failing assertion, same
  received string, same date — running these two tests against
  `origin/main` alone (`92a5b8f9`) in an isolated worktree, against the
  SAME live, read-only production account this branch's own run used. Not
  a different account, not a stale cache: the identical live payload
  produces the identical gap on main with none of this branch's commits
  present.
- Two OTHER tests that failed on one earlier full-suite pass
  (`lib/adaptation/_shadow_compare.audit.test.ts`,
  `lib/training/_coaching_thesis.audit.test.ts`) did **not** reproduce on
  either main or this branch on two subsequent isolated reruns — both hit
  live production data with real timing sensitivity (one explicitly runs
  three live round-trips checking for non-mutation); treated as transient
  flakes under load, consistent with the pattern already established this
  session for `DecodeSweepTests` and the watch-simulator contention.

**Ownership:** this is the Today coaching-thesis "why" composer
(`why-voice.ts`), governed by the Coaching Thesis row of
`docs/BRAIN_CONSTITUTION.md`'s ownership table — not the post-run
truthfulness/completion-state/plan-impact work this branch owns. Per this
task's own rule 3 ("do not create a second resolver... coaching brain")
and rule 6 ("reuse and reconcile landed work from other streams, do not
take ownership of unrelated systems"), this is flagged for the owner of
that composer, not fixed here. It does not block this branch: the failure
is proven, by identical reproduction, to exist on `main` independent of
every commit in this branch.

### The third — `lib/runs/_run_shape_lint.test.ts`, a stale allowlist entry

Two more failures, same file, same root cause: `lib/plan/seal.ts` is still
listed in `RAW_ACCESS_ALLOWED` and the merged-filter allowlist, but the
`7baf4e85` plan-sealing rewrite (merged into this branch from `main`, not
authored here) apparently stopped needing either exemption — the lint's own
message says so verbatim: *"These files no longer read raw jsonb — delete
their RAW_ACCESS_ALLOWED entries."* This is Rule 18's exact "a gate is not
trusted until it has been made to fail" shape, on the author side: the
ratchet is doing its job, the entry just hasn't been pruned yet.

Confirmed pre-existing on `origin/main` alone (checked at `b45d80eb`,
independent of this branch): identical two failures, same file, same
message. `lib/plan/seal.ts` does not appear anywhere in this branch's own
diff. Flagged for whoever owns `lib/plan/seal.ts`'s recent rewrite —
pruning two allowlist lines, not a design decision, but not this branch's
file to edit.

**Handing off:** ready for the programme lead / Coaching Thesis owner to
pick up the `why-voice.ts` gap, and whoever owns `seal.ts` to prune its two
now-stale allowlist entries, separately from this branch. See the
top-level verdict below for what was actually executed here.
