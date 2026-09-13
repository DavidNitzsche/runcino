# Natural Coaching Experience — Handback (2026-09-12)

**Status: CHECKPOINT COMPLETE, IMPLEMENTED — VERIFICATION INCOMPLETE on one rendered fix, BROAD IMPLEMENTATION NOT STARTED.** This is a status handback for external review of the checkpoint methodology and the one landed change — it is not a request to review a finished body of copy work, because that work hasn't been done yet. Full detail lives in `docs/design/natural-coaching-checkpoint-2026-09-12.md`; this document is the compact summary of it plus what's actually been committed.

**Evidence-type key** (this repo's own convention, reused here): `[SRC]` source inspection · `[TEST]` automated test, run this session · `[SIM]`/`[DEVICE]` simulator/physical-device render · `[PROD]` production query · `[INF]` inference · `[BLOCKED: reason]`.

---

## 0. What this role is and isn't

Per the brief: owns how canonical product truth is *expressed* (copy, tone, presentation) across seven runner-facing surfaces. Does **not** own fitness calculations, evidence eligibility, plan decisions, adaptation policy, race projections, workout grading, or safety decisions — those are consumed as canonical facts and reason codes, never recomputed in copy. Where the underlying truth is unavailable or contradictory, the correct output is **BLOCKED**, not an invented explanation. That boundary is why several items below are marked blocked rather than fixed.

## 1. Base / branch / what's actually committed

- **Base:** `origin/main` @ `e13542763` [SRC] — confirmed current via `git fetch`, zero divergence before this session started.
- **Branch:** `claude/faff-natural-coaching-vyloay`, pushed to origin, currently at `4b098205d`. Not merged or pushed to `main`.
- **Two commits, both pushed:**
  1. `d1aac49e2` — cherry-picked the copy-logic half of the already-accepted Santa Monica fix (`natural-coaching/santa-monica-race-day-v2@b0d7349e7`, itself not yet on `main`) forward onto current `main`. Touches exactly two source files (`web-v2/lib/plan/generate.ts`, `web-v2/lib/race/race-row-note.ts`) and their two pinned tests. No calculation, layout, color, or spacing changed.
  2. `4b098205d` — the first-checkpoint document itself.
- **Deliberately dropped from the cherry-pick:** the native Xcode project file and a test-only SwiftUI harness from the source commit. That diff conflicted in `.pbxproj` on unrelated GUID churn; hand-resolving an Xcode project file I don't own, for a test harness this checkpoint didn't need, was judged out of scope and riskier than the value it added. [SRC] — conflict markers inspected directly, confirmed cosmetic/unrelated to the copy change.

## 2. What's verified, and how [TEST]

- `_midrace_goal.test.ts`, `_midrace_role.test.ts` — 19/19 pass against current `main` with the cherry-picked change applied.
- `check-coach-voice.sh` — clean, 379 user-facing source files scanned.
- **Not done:** a simulator or device render of the screen this sentence actually reaches (`PlanSnapshotDayView.swift`). This is disclosed per this repo's own Rule 13, not assumed clean — the change is a pure string substitution inside a template literal that was already rendering the adjacent (old) string seconds before the edit, so the render-path risk is low, but "low risk" and "rendered" are different claims and only the first one is true right now.

## 3. Why the rejected branch failed, and what replaces it (the one rendered example)

`fix/santa-monica-race-day-copy@38d090ec8` was rejected for four distinct reasons, each a named pattern rather than a wording problem:

| Quoted line | Failure pattern |
|---|---|
| "Race it, full effort." | Says the same thing twice (Rule 17 — a fact stated once) |
| "...then harder training returns." | Neutral fact framed as a threat — tone, not fact |
| "...the pace to run today." | Restates an adjacent on-screen stat in different words |
| "Yours to change." | An action claim with no control behind it on the screen that renders it |

The accepted replacement (`b0d7349e7`, now on this branch) fixed all four by **tracing the render path** — which exact screen shows this sentence, what that specific screen can and can't do — rather than editing the two strings in isolation. That's the pattern to carry forward, not the four specific words.

## 4. What's inventoried but NOT yet fixed (explicitly still open)

Confirmed still live this session [SRC], carried forward from the accepted commit's own "left unfixed" note:

- `web-v2/lib/plan/generate.ts:8915` — `"{name}. C race · this is the week's quality session. Run it as the workout."` — same internal-jargon pattern ("C race," "quality session") as the fixed B-race line.
- `web-v2/lib/race/race-outlook.ts:824-825` — two more `"C race."` openers in `reasonVsExpected`.

One real cross-surface contradiction found and not yet fixed:

- **Accepted-proposal-Apply-fails.** Web (`TodayView.tsx:1541`): *"That did not apply. The session stands as written."* Native (`CoachDecisionCard.swift:753`): *"Could not save. Check your connection and try again."* Same underlying fact, two different claims — and native's wording blames connectivity, which this repo's own rule set forbids unless the failure is actually known to be transport-layer. **BLOCKED on the real failure-reason-code taxonomy** (`apply_refused`, `workout_not_found`, `invalid`, transport) — writing final copy requires knowing which of those is genuinely connectivity vs. application logic, and that's Plan/Adaptation territory, not mine to infer.

Full ~75-citation seven-surface inventory (Today, Pre-run, Post-run, Block/plan, Races, Adaptation, Watch) is in the checkpoint doc, not repeated here.

## 5. Truth dependencies / genuine gaps in the source material

- `docs/design/ux-ia-acceptance-plan-2026-09-11.md` exists in git history but **is not on `main`** — only its commit message was available, not its content. Unread, flagged rather than guessed at.
- No file anywhere in the repo matches "Brain/adaptation v2.1.1 errata" (`grep -r "errata" docs/` returns nothing). If a specific correction exists under that name, it isn't in this repository as far as I can find it.
- No "Lane G" label exists anywhere in `docs/` or git history. Nearest real match by content is `docs/audit-ux-ia-pass1.md`.
- The post-run surface has **no existing rendered copy at all** for "intentionally shortened stride recovery" — the logic exists in code comments only. Whether the recap should say anything about it is a product decision outside this role's authority, not a wording gap I can close unilaterally.

## 6. What's being asked of reviewers at this stage

This handback is scoped to what's actually done — the checkpoint methodology and the one rendered fix — not a finished pass. Two things are useful to review now, ahead of the larger push:

1. **Truth review, narrow scope:** does dropping "Yours to change." from `raceTargetSentence`'s coach-voice branch (§3) correctly respect the authority boundary (no fact invented, no control claimed that doesn't exist), and does the cherry-pick (§1) carry no calculation drift from the original accepted commit?
2. **Methodology review:** is the proposed shared-language architecture (extend `voice-band.ts`/`recap-voice.ts`/`race-row-note.ts`/`decision-cards.ts`; one new narrow resolver for cross-surface Apply-failure copy) the right shape before it's built out across the remaining surfaces, or should the approach change before more time goes into it?

The two full reviews named in the original brief (truth-against-canon, and rendered UX/voice across all seven surfaces) are requested once broad implementation is pushed — that hasn't happened, and this document does not claim otherwise.
