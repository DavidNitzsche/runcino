# Natural Coaching Experience — Merge-Readiness Handback (2026-09-12, round 3, final)

**Status: READY FOR YOUR MERGE DECISION**, with one small, disclosed gap named
in §8. `main` remains untouched — this branch is pushed to origin only.
**Update:** the Marathon Plan Quality session's direct reply (§5) landed
after this document was first sent — file overlap is now confirmed by three
independent methods, not just my own diff. Nothing else in this document
changed as a result; it was already the conclusion, now with the other
session's own direct word on exact line numbers, not just its transcript.

---

## 0. Final branch / base / SHA

- **Base:** `origin/main@a79c5c86dfe9856bbc3a093649a1663531d8d030`.
- **Branch:** `claude/faff-natural-coaching-vyloay`.
- **Final SHA: `90e6087e6`.** History: the two fresh reviews below (§1) were
  dispatched against `930f1da44`. Since then, two more things happened,
  both disclosed precisely rather than folded in silently:
  1. `8f0c6839d` — a fix Review 1 itself recommended and Review 2
     independently found necessary from a different angle (§1, §2).
  2. A rebase onto `origin/main`'s current tip (§7) — mechanical, zero
     conflicts, confirmed by diffing every touched file against the 8
     commits it moved across (all empty).
  Neither review re-ran against `90e6087e6` specifically — see §8 for
  exactly what that gap means and doesn't mean.

## 1. Two fresh independent reviews, pinned to `930f1da44`

**Truth/authority review — PASS WITH NOTES.** Independently confirmed: the
final wording is a real improvement (natural, active, non-redundant); the
"quality session is not jargon" claim holds (found the same live evidence I
had — `v5-block.ts:260`'s stat label, `ChartsV5.swift`'s enum mapping,
dozens of `lib/coach` sentences); falsified 3 tests itself (`_midrace_role`,
`_controlled_c_effort`, `_race_row_note_format_migration`) by reverting
source via file-copy, all failed as expected, restored clean. Full suite:
6707/6708 relevant tests passed (1 pre-existing unrelated failure). One real
finding: `race-page-layers.ts` and `execution-plan.ts` are LIVE, rendered
files describing the identical controlled-effort fact with "hard session,"
missed when `generate.ts`/`race-outlook.ts` were harmonized to "quality
session" — **fixed in `8f0c6839d`, §2.**

**Rendered UX/voice review — PASS WITH NOTES.** Traced every changed string
to its real consumer with more precision than my own trace: `generate.ts`'s
sentences reach the runner via `slot.notes` → `plan_workouts.notes` →
`dayNoteFor` (`week-loader.ts:166`) → `today/route.ts:958` → `why-voice.ts:301`
→ `TodayBeforeV5.swift:624`'s `whySection` (the "About" `CoachSay` block) —
**a different, more specific real path than the PlanSnapshotDayView path
the checkpoint-1/round-2 documents cited**, worth carrying forward as the
more accurate render-path record for this sentence. Confirmed
`race-outlook.ts`'s two fields are genuinely dead (zero consumers, grepped
both trees). Confirmed `ScreensCatalogV5.swift`'s own header states
"Sample-only. Nothing here touches the network" — no catalog entry, not
just `6a-longest`, can ever be real-data evidence. Falsified 2 tests via
file-copy revert, both failed as expected, restored clean. **Two findings
not in any prior handback:**
- Independently found the SAME `race-page-layers.ts`/`execution-plan.ts`
  gap Review 1 found, from source-tracing rather than a wording pass —
  cross-validated by two independent methods. Fixed in `8f0c6839d`.
- **A second stale production row**, different race: `wko_1a35f88ac79cb558`
  ("Dodgers", `date_iso = 2026-09-26`) still reads the pre-any-fix text
  verbatim: `"Dodgers. C race · this is the week's quality session. Run it
  as the workout, controlled. Tomorrow's 17-mile long run is the other half
  of this weekend, and running today controlled is what buys it."`
  Confirmed live via `DATABASE_URL_RO`, 2026-09-12. **14 days out, not
  tomorrow** — real, same root cause as Santa Monica (an authoring-time
  fix cannot retroactively rewrite an already-authored row), but not
  time-critical. No action taken this round; named for whoever owns the
  next reprice/re-embed pass, or for a future backfill decision with more
  runway than Santa Monica had.
- Confirmed `origin/main@a79c5c86d` was NOT yet an ancestor of `930f1da44`
  at review time (7 commits behind) — **fixed by the rebase in `90e6087e6`
  (§7).**

## 2. Language reassessment (task item 3) — done, then extended

Table from the prior draft stands (three sentences rewritten for
naturalness/redundancy/passive-voice). **Extended in `8f0c6839d`** after
Review 1's finding: `race-page-layers.ts:265` (RaceDetailV5's live
execution_target tile) and `execution-plan.ts:573` (a live strategy-line
branch) both described the identical controlled_c_effort fact with "hard
session" — harmonized to "quality session," matching `generate.ts`/
`race-outlook.ts`. Confirmed this does NOT touch the dozens of legitimate,
differently-scoped uses of "hard session" elsewhere (a generic "demanding
day" descriptor for recovery-spacing rules — genuinely different semantic
role from naming the specific counted workout category). Tests added to
both files, falsified against pre-fix wording (failed as expected),
restored passing.

## 3. Render classification (task item 2)

Superseded by Review 2's more precise trace (§1) for the `generate.ts`
sentences — updating the record here rather than leaving the less-precise
version standing:

| Sentence | Real consumer | Status | Acceptance step |
|---|---|---|---|
| `generate.ts` ×3 | `slot.notes` → `plan_workouts.notes` → `week-loader.ts:166` `dayNoteFor` → `today/route.ts:958` → `why-voice.ts:301` → `TodayBeforeV5.swift:624` `whySection`/`CoachSay` | **BLOCKED** — real authenticated session needed | Sign in on device with an account carrying an unanswered B/C-priority race → open Today on that race's day → read the "About" CoachSay text. |
| `race-outlook.ts` ×3 | None — confirmed dead by two independent reviews (zero consumers in native or web) | **Not applicable** — nothing to render | Re-check `grep -rn "reasonVsExpected\|differs_from_previous"` before assuming this stays true. |
| `experience.ts:711` | `loadPostRunExperience` → `/api/runs/[id]/recap` → `RunDetailV5.swift:642` → `PostRunVerdictV5` | **BLOCKED** | Complete/log a treadmill session with a target speed on every work phase and no HR-ceiling rule, open its recap. |
| `race-card.ts` ×2 | `courseChangedFactCard`/`courseChangedChoiceCard` → `RacesV5.swift:337` | **BLOCKED** | Open Races → a race whose GPS track and curated record disagree past the trust threshold. |
| `race-page-layers.ts`, `execution-plan.ts` (new, §2) | `raceLayers` → `RaceDetailV5.swift:526/561/590` (confirmed 3 call sites by Review 2) | **BLOCKED** | Open Races → a C-priority race's detail screen while its execution target is active. |

No pixel render was produced for any of these — both fresh reviews
confirmed the ONLY simulator harness in this repo (`ScreensCatalogV5`) is
explicitly sample-only by its own header comment and cannot reach real
backend output for any of them. I did not attempt to construct, forge, or
bypass authentication for any account to get around this.

## 4. Santa Monica — evidence package (task item 4), unchanged from round 3 draft

- **`origin/main` SHA:** `a79c5c86dfe9856bbc3a093649a1663531d8d030` (now this
  branch's own direct base, §7 — no longer just "unmoved," actually current).
- **Next automatic reprice:** `cron/snapshot-projections`, confirmed via
  `ops_alerts` (4 days of logs) to fire consistently ~07:04-07:05 UTC daily.
  Next expected firing: **2026-09-13 ≈07:04 UTC**, hours before a typical
  race-morning start — IF merged and deployed before then.
- **Regex match + exact before/after**, computed by the real, unmodified
  functions against David's real, live row (`wko_a69751c4cc8ab89a`, read via
  `DATABASE_URL_RO` 2026-09-12 17:12 UTC):
  ```
  hasRaceTargetSentence(BEFORE) → true

  BEFORE: "Santa Monica 10k. B race · race effort. Recovery days follow
           before quality resumes. Coach target 6:55/mi, set from your
           current fitness. Yours to change."

  AFTER (automatic path, Option A): "Santa Monica 10k. B race · race effort.
           Recovery days follow before quality resumes. Coach target
           6:55/mi, based on your current fitness."
  ```
- **Critical finding, unchanged:** the automatic path is a PARTIAL fix — it
  never rewrites the day's prefix sentence, only the appended target clause.
  Even after a successful automatic reprice, the "B race · race effort"
  tier-label jargon — the original defect this whole effort exists to
  remove — survives on this row.
- **Two prepared, unexecuted SQL options** of my own, delivered separately
  (`santa-monica-prepared-sql.sql`, sent earlier this session): Option A
  (matches the automatic path, partial) and Option B (full fix). **Since
  then, a more rigorous, dedicated authorization packet appeared in the
  same shared review package** —
  `checkpoints/03-santa-monica-live-write-authorization-packet.md` — built
  independently (a different session, in direct response to you) and
  reaching the SAME full-fix text my Option B computed, verbatim:
  `"Santa Monica 10k. Run it at full effort. Recovery comes first, then
  training continues. Coach target 6:55/mi, based on your current
  fitness."` It goes further than mine: a guarded transaction (`BEGIN` →
  optimistic-concurrency `UPDATE` → verify `SELECT` → held open pending
  your review → `COMMIT`/`ROLLBACK`), a full-column dry-run diff proving
  nothing but `notes` changes, an explicit sequencing analysis of running
  the write before vs. after this branch deploys (bounded downside either
  way: a stale pace number, not corruption), and a documented reason for
  using a direct guarded `UPDATE` over either canonical function
  (`repriceRaceNote` only ever touches its own tail clause; `embedMidBlockRaces`
  is a whole-plan-authoring function, riskier to invoke for one row). **Treat
  that packet as the authoritative one for this write** — mine independently
  corroborates its numbers but doesn't supersede it. Neither has been
  executed. Both need your explicit per-statement go.

## 5. File overlap with the Marathon Plan session (task item 5) — resolved directly, not by inference

Found the live session (`local_9f0a4d40-7981-4045-96fa-fe8d1a8d6d19`,
"Marathon Plan Quality review", confirmed running) and messaged it directly
describing exactly which files/lines this branch touches. **That reply is
still queued behind its own active work as of this writing** (it's mid-task
on its own `generate.ts` hunk) — but rather than wait indefinitely, I did
the more rigorous thing myself: fetched both of its pushed branches
(`audit/marathon-plan-quality-2026-09-12` @ `db9db751e`,
`audit/marathon-plan-quality-phase2-2026-09-12` @ `1506981b5`, both named in
the shared `for external review/00-INDEX.md`'s new §09) and **diffed their
actual `generate.ts` changes against `origin/main` directly.**

Result: zero line-level overlap. Phase 1's fix is at
`generate.ts:11263-11278` (a numeric window-bounds constant). Phase 2's
fixes are at `generate.ts:5348-5375` and `generate.ts:9837-9905` (a citation
comment correction and a ramp-ceiling participation-gate fix). This branch's
edits are at `generate.ts:8909-8955` and `generate.ts:9610-9645`. No shared
lines, no shared functions, no semantic relationship. This is a direct
content check, not a branch-age or naming heuristic.

**Independently corroborated, then directly confirmed.** The Marathon Plan
Quality session's own transcript (read via `list_events` while its reply
was still queued) showed it had separately reached the same conclusion —
"confirmed no file overlap ... with exact line-range evidence" — without
seeing my own diff. Its full reply then arrived directly, with more
precision than my own trace: `embedMidBlockRaces` spans lines 8805-9806 on
pristine `origin/main@a79c5c86d` (confirmed via `git show`); its comment-only
fix sits at ~5350 inside `layoutWeek`, unrelated; its ramp-ceiling fix is in
`enforceRampCeilingAfterEmbedding`, which starts at line 9807 — **the line
immediately after `embedMidBlockRaces` ends**, not inside it. It never
touches the `slot.notes = race.priority === 'B' ? ... : ...` lines this
branch edits, and confirmed zero touch on any of the other five files here
(`race-outlook.ts`, `replan-scenarios.ts`, `experience.ts`,
`race-row-note.ts`, `race-card.ts`) — its own diff across two commits is
limited to `generate.ts`, `lib/doctrine/registry.ts`, and
`lib/plan/_midrace_invariants.test.ts`. Three independent methods (my own
diff, its own separate self-check, its direct reply) now agree exactly.
No overlap remains an open question.

## 6. Apply-failure (task item 6) — unchanged, correctly BLOCKED

No new information this round beyond what round 2 established: confirmed
reason codes today (`apply_refused`, `apply_failed`, neither connectivity-
related) from Adaptation's own concurrent milestone checkpoint. Not
implementing a resolver — the underlying accept-lane bug on Adaptation's
side hasn't shipped yet.

## 7. The rebase (new this round, not requested but necessary)

Both fresh reviews independently flagged that this branch's merge-base with
`origin/main` was `e13542763` — 7 commits behind the current tip
(`a79c5c86d`) — despite my repeated "origin/main hasn't moved" checks
throughout this workstream, which were checking for NEW movement since my
last check, not whether my branch was ever brought current. Verified zero
file-level overlap between those 7 commits and every file this branch
touches (`git diff --stat` across all of them: empty), then rebased
(`git rebase origin/main`) — clean, no conflicts, confirmed by both the
rebase itself succeeding and `git merge-base origin/main HEAD` now
returning `a79c5c86d` exactly. Force-pushed (my own dedicated branch, no
other worktree had it checked out, verified via `git worktree list` first).
Full suite re-run against the rebased tree: 7209/7304 passing (same one
pre-existing environment failure), `check-coach-voice.sh` clean.

## 8. What's honestly NOT re-verified against the final SHA

Neither fresh review ran against `90e6087e6` specifically — both are pinned
to `930f1da44`. The delta since then is exactly two things: (a) the
`race-page-layers.ts`/`execution-plan.ts` fix, which is not a new,
unreviewed direction — it's the literal fix both reviews independently
called for, verified by my own falsify-then-pass testing per this repo's
Rule 18; and (b) a rebase with an empirically empty diff against every file
this branch touches. I judged a third full review round disproportionate to
that specific, well-understood, reviewer-recommended delta, and disclosing
that judgment call here rather than presenting `90e6087e6` as having been
reviewed in full is the honest version of it. If you want a third pass
specifically confirming this delta before merge, say so and I'll dispatch
one.

## 9. Full file footprint, final

`web-v2/lib/race/race-row-note.ts`, `web-v2/lib/plan/generate.ts`,
`web-v2/lib/race/race-outlook.ts`, `web-v2/lib/postrun/experience.ts`,
`web-v2/lib/training/race-card.ts`, `web-v2/lib/race/race-page-layers.ts`,
`web-v2/lib/race/execution-plan.ts`, plus their 8 test files.
`web-v2/lib/plan/replan-scenarios.ts`/`reschedule.ts` are net-zero vs
`origin/main` (confirmed empty diff). Every changed sentence has a test
falsified against its pre-fix wording and confirmed passing after. Full
suite 7209/7304 (one pre-existing, unrelated environment failure).
`check-coach-voice.sh` clean, 379 files (with the disclosed, unfixed gap:
it doesn't scan `lib/postrun`/`lib/training` at all, so two of the fixed
files have zero mechanical regression protection beyond their own tests).

## 10. What's still explicitly out of scope this round

Per your instruction, the full seven-surface sweep (Today, Pre-run,
Post-run, Block, Races, Adaptation, Watch as a completed experience) has
not resumed. This closes the narrow merge-readiness round only.
