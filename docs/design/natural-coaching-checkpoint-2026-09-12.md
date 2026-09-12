# Natural Coaching Experience — First Checkpoint (2026-09-12)

**Per the brief's own gate: this is the checkpoint due before broad implementation, not the implementation itself.** One isolated, already-reviewed fix is rendered below as the concrete instance of the replacement pattern; everything else in this document is inventory and proposal, pending go-ahead.

## 1. Base SHA / branch / footprint so far

- **Base:** `origin/main` @ `e13542763` (confirmed current via `git fetch`; this branch had zero divergence from main before this session).
- **Branch:** `claude/faff-natural-coaching-vyloay`, pushed to origin at commit `d1aac49e2`.
- **Committed this session (1 commit):**
  - `web-v2/lib/plan/generate.ts` — race-day default-role sentence (jargon removed)
  - `web-v2/lib/race/race-row-note.ts` — `raceTargetSentence` (dropped false "Yours to change" claim)
  - `web-v2/lib/plan/_midrace_goal.test.ts`, `web-v2/lib/plan/_midrace_role.test.ts` — pinned-string updates for the above
- **No other files touched.** No view/layout/color/spacing files. No calculation added or changed — both sites format values already computed elsewhere.
- **Collision check against main's occupied files:** no branch under `worktree-agent-*` or `task/*` touched `generate.ts`, `race-row-note.ts`, or `postrun/experience.ts` in the last 24h. Re-check before any further commit — this repo runs many concurrent agents and that can change within hours.

## 2. Required source material — reconciliation

Several named sources don't exist verbatim under those titles in this repo. Mapped to the closest real artifact rather than guessed or skipped:

| Named in brief | Resolution |
|---|---|
| Accepted Coach forensic audit v2.1 and correction log | No file literally titled this. Closest real lineage: `docs/audit-2026-09-08-full-status-master-report.md` → `docs/audit-2026-09-08-correction-log.md` → `docs/audit-2026-09-09-canonical-handback.md` → **`docs/audit-2026-09-10-canonical-record.md`** (explicitly supersedes all three prior). Read the final one. |
| Brain/adaptation v2.1 plus v2.1.1 errata | No file with this exact label. `docs/audit-2026-09-10-canonical-record.md` is also the most current Brain-adaptation status document. The closest literal "v2.1" hit in the repo is `docs/audit/runner-data-v2.1-provenance-receipt` (Runner Data, not Brain/adaptation — a different domain). No "v2.1.1 errata" file exists anywhere (`grep -r "errata"` across `docs/` returns nothing). Flagging this as a genuine gap, not a resolved mapping. |
| Canonical v3 draft | Same lineage as row 1 — `docs/audit-2026-09-10-canonical-record.md` is the most recent canonical document (explicitly "supersedes every prior report"). No file calls itself "v3." |
| Lane G UX/IA acceptance plan | No "Lane G" label found anywhere in `docs/` or git history (`grep -r "Lane G"` is empty; only "Lane D" appears, in the rejected Santa Monica commit). Closest real match by content and title: `docs/audit-ux-ia-pass1.md` and, if reachable later (see below), `docs/design/ux-ia-acceptance-plan-2026-09-11.md`. |
| Design-System Phase 2 | Real, exact match: **`docs/audit-design-system-phase2.md`** — read in full. |
| docs/BRAIN_CONSTITUTION.md | Read in full — this is real and current (locked 2026-08-31). |
| natural-coaching/santa-monica-race-day-v2 @ b0d7349e7 | Real. Confirmed, diffed in full, and its copy-logic files cherry-picked onto this branch (§5). |
| Rejected Santa Monica branch 38d090ec8 | Real (`fix/santa-monica-race-day-copy`). Confirmed, diffed in full against both its parent and the accepted fix. |

One more thing worth flagging up front: `docs/design/ux-ia-acceptance-plan-2026-09-11.md` (the doc whose own commit message literally says "UX/IA acceptance plan for next TestFlight candidate" — the strongest candidate for "Lane G") **exists in git history but is not checked out on `main`** — its commit (`27f657581`) is not an ancestor of `main`. I have not read its content; only its commit message. This is a **truth dependency** (§6) — it may carry IA decisions relevant to surface composition that I can't currently verify are still current.

## 3. Seven-surface current copy inventory

Gathered by direct inspection + three parallel targeted searches. File:line, exact current string (trimmed), trigger. This is a representative sample (~75 real citations), not exhaustive — exhaustive was not the goal of a checkpoint.

### Today
- `coach-log.ts:213` — "No miles this week. The plan resumes where you are, not where the calendar says." — zero-mileage week close.
- `coach-log.ts:204` — "Biggest week you have ever logged · {mi} mi · {q}." — all-time high week.
- `acknowledge.ts:145` — "You called yesterday's {n} a grind · today stays truly easy." — runner self-tag feeds today's framing.
- `acknowledge.ts:160` — "You called yesterday's easy day a beatdown. That feeds this morning's call." — subjective/objective disagreement surfaced.
- `readiness-brief.ts:1167` — "The one system reporting is in band." — **single-domain readiness evidence**, replacing a prior "All systems in their normal band" that lied with partial data.
- `readiness-brief.ts:1193` — "Moderate · {Pillar} dipped. A single-day dip is noise; the next reading clears it up." — exactly one pillar flags.
- `health-actions.ts:270` — "Nothing is trending toward a plan change right now. Illness, a niggle flare or a sharp jump in load would override that on their own." — no signal building.
- `health-actions.ts:274` — "{Signal has been …}. It takes about {n} in a row before the plan eases itself back." — signal building, not yet at threshold.
- `reschedule.ts:1426` — "You have already run that day. Completed days do not change." — **move/missed refusal**.
- `reschedule.ts:1429` — "That is a race day. The race does not move and nothing moves onto it." — refusal.
- `TodayBeforeV5.swift:784` — "The breakdown did not load. The score above still stands, we just cannot open it up." — **refusal, reads as a refusal, not an outage** — good existing example.
- `TodayBeforeV5.swift:1142` — "Skip it" / sub "The week loses 6 mi" — honest cost stated plainly, no euphemism.
- `generate.ts:3489` — `cutbackWeekRationale()`: "Cutback week. Every third week comes down while you build back to the volume you have held before." — **genuine cutback** (authored + actually lower).
- `strategy-contracts.ts:550` — "{vol} mi against {prevVol} mi last week. This week was authored lighter, but the total did not come down. The recovery this week is doing has to come from effort and spacing, not from the mileage." — **cutback flagged, mileage did NOT decrease** — this is the named test case and it's handled honestly already (gated by `_cutback_copy_honesty.test.ts`).

### Pre-run
- `spec-card.ts:339` — "Relaxed and fast. Not a workout, so walk back fully between." — **stride footer**.
- `spec-card.ts:708` — "Walk back. Full recovery before the next one." — **intentionally shortened recovery**, named and explained rather than just shown as a short number.
- `expand-spec.ts:334` (`appendStrides`) — default 20s stride / 60s walk-back, ±45s tolerance, because doctrine calls a stride "not a workout."
- `spec-card.ts:237` (`fmtPaceCeiling`) — "no faster than {pace} /mi" — chosen specifically because "≤ 8:22/mi" read backwards as permission to go faster. Good existing precedent for "state the constraint in words, not just the symbol."
- `session-cue.ts:129` — "Hold the line by effort. Heat lifts HR above target at the same pace." — heat-adjusted HR-cap cue.
- `RunLobbyV5.swift:796` — "Run by effort and form. Heart rate will lag these short reps." — short-rep HR caveat.
- `RunLobbyV5.swift:889/905` — treadmill vs outdoor target framing, parallel construction, no jargon.
- `RunLobbyV5.swift:691` — "Today's planned workout couldn't be loaded. You can retry or intentionally record an unstructured run." — **load-failure refusal with a real alternative**, not an outage read.

### Post-run
- `experience.ts:709` — "Work done by treadmill effort, not pace-graded" / "The work phases were prescribed by treadmill speed and incline, not pace — this is a record of what was run rather than a pace grade." — **completed vs gradable distinction**, states uncertainty plainly.
- `experience.ts:732` — "These segment targets are the pace plan you set for this race, not one from the app." — provenance note, self-authored race pacing.
- `experience.ts:1714` — "The plan is unchanged for now. This run is strong enough to act on, so the next review will look at it." — HELD_FOR_EVIDENCE, states what happens next.
- `experience.ts:1735` — "Heart rate ran above the ceiling with no explanation in the conditions. Keep the next easy day genuinely easy." — actionable next step, no invented cause.
- `TodayAfterV5.swift:831/834/835` — "Also today" / "{mi} easy" / "Treadmill · not part of today's session" — **completed vs supplemental run distinction**, clean.
- No rendered "intentionally shortened stride recovery" copy found on the post-run side specifically — the walk-back logic (lines 1097-1135) is described only in code comments, never surfaced in post-run prose. Worth a deliberate decision in implementation: should a shortened-recovery stride show up in the recap, or is silence correct because nothing went wrong? Flagging, not deciding.

### Block/plan
- `generate.ts:8911-8915` — the four-branch race-day ternary (full text in §5).
- `generate.ts:8964` — "{name}. Run it as the marathon pace long, not a race. Warm up, then marathon pace to the line. Hard day, not a peak effort." — role=mp_workout, clean, no jargon.
- `strategy-contracts.ts:688` — "Planned cutback. The reduction is the work." vs `:689` "Authored as a cutback, but the total did not come down. The recovery purpose still governs the week even though the mileage does not show it." — the mileage-didn't-decrease case, already gated correctly.
- `ProposalCardV5.swift:83` — "HOLD" displayed alongside PUSH / PULL BACK / MOVE / RECOVERY / STOP.
- `reschedule.ts:1701-1702` — "Your {workout} comes out. {race} on {date} supplies that week's quality stimulus…" vs "Your {workout} comes out and is not replaced. That is a real loss." — **missed/dropped-workout copy that states the consequence honestly rather than softening it.** Good precedent.

### Races / race morning
- `race-outlook.ts:824-825` — "**C race.** Run it as the week's hard session, not as a race…" — raw internal-tier jargon exposed directly in runner copy. **Confirmed still live**, and explicitly named in `b0d7349e7`'s own commit message as "found and left unfixed, flagged for follow-up."
- `generate.ts:8915` — "{name}. **C race** · this is the week's quality session. Run it as the workout." — same jargon, same pattern, also unfixed.
- `coach-goal.ts:631/632` — "Coach set from your current fitness[, graded for the climb]. Yours to edit." — sits directly under a real "Edit race" button on Race Detail. **This is the honest version of the claim the Santa Monica fix deferred to** (§5).
- `RaceDetailV5.swift:169` — "Training effort · race to lock in. Confirm your chip time below, or correct it if it's wrong." — matches the race-data-source-of-truth checklist in CLAUDE.md exactly (provisional, labeled, not claimed as a PR).

### Adaptation / decision states
- `decision-cards.ts:118-119` — "COACH · NEEDS A DECISION" (amber) vs "COACH · APPLIED" (blue) — **HOLD vs notice is cleanly separated, textually and by color.** Good existing pattern, nothing to fix here.
- **Accepted-proposal-Apply-fails, cross-surface contradiction (real finding):**
  - Web (`TodayView.tsx:1541`): *"That did not apply. The session stands as written."*
  - Native (`CoachDecisionCard.swift:753`): *"Could not save. Check your connection and try again."*
  - These are the same fact — an accept action did not take effect, the session is unchanged — worded as two different claims. Native's wording actively attributes the failure to connectivity, which is a claim this codebase's own rule set forbids ("no telemetry blame") unless the failure is actually known to be a transport error. An `apply_refused` (e.g. Migration 166 gate, stale row) is a different fact from "check your connection," and conflating them tells the runner to do something (check their wifi) that won't fix the real problem. **This is squarely in scope and a clean, bounded candidate for the implementation phase** — one shared resolver, one sentence, both surfaces call it.

### Apple Watch
- `WatchRouterV5.swift:979` — "Pace is on target · hold the effort, not the pace." — clean coach-voice line, watch-appropriate brevity.
- `SpokenCues.swift:210` — spoken heads-up cue deliberately omits the numeric band the board shows — a considered, surface-appropriate asymmetry, not a contradiction (the board gives the number, the voice gives the verb — you can't read a screen mid-stride).
- `WatchRouterV5.swift:1677` — "Expect roughly {lo}-{hi} bpm" — uncertainty stated in the number's own phrasing ("roughly"), not hidden.
- `NotificationsV5.swift:313-314/320-321` — "Session moved" / "Thursday's threshold went to Friday · today is easy 5." and "Race tomorrow" / "Gun at 7:40 · nothing left to do but sleep." — short, specific, no hype. Good precedent for the register this whole pass should match.

## 4. Santa Monica replacement — rendered in context

### Why 38d090ec8 (rejected) fails, pattern by pattern

| Quoted line | Why it fails | What it's an instance of |
|---|---|---|
| "Race it, full effort." | Says the same thing twice ("Race it" already means full effort; stating both is redundant, not emphatic) | Rule 17 — the runner reads a fact once |
| "Recovery follows, then harder training returns." | "Harder training returns" reads as a threat/warning rather than a neutral statement of what's next — voice violation (the brief's own "fake intimacy/no hype" register, and this project's coach-voice rule: direct, never hyperbolic) | Tone, not fact — the underlying schedule fact (full effort today, recovery days, then training resumes) is true; the words frame it as something being *done to* the runner |
| "Coach target … the pace to run today." | Restates the screen's own adjacent "Pace band" stat in different words, two lines away | Rule 17 — repeats a fact already visible beside the message |
| "Yours to change." | False **for the screen it renders on**. The number is genuinely editable, but the edit control lives on a different screen (Race Detail), and this sentence has no slug/button behind it on `PlanSnapshotDayView` | "No action claim without a real visible control" — the exact rule this brief states |

The rejected branch's mistake wasn't any individual word choice — it's that it treated this as a **copy-editing problem on two strings in isolation**. The accepted fix treated it as a **render-path tracing problem**: which screen actually shows this sentence, what controls does that specific screen have, what other stats does that specific screen already draw. The replaceable pattern is "trace before you word-smith" — verify what's true *for the screen rendering the sentence*, not what's true of the underlying data model in the abstract.

### The accepted fix, rendered (now on this branch, commit `d1aac49e2`)

**`generate.ts` — unanswered-role default on a B-priority race:**
- Before: `"{name}. B race · race effort. Recovery days follow before quality resumes."`
- After: `"{name}. Run it at full effort. Recovery comes first, then training continues."`
- Why better: no internal tier label ("B race") the runner has to parse; "race effort" no longer stated twice (once as label, once as instruction); "training continues" is a neutral fact, not a warning.

**`race-row-note.ts` — `raceTargetSentence`, coach voice:**
- Before: `"Coach target {pace}, set from your current fitness. Yours to change."`
- After: `"Coach target {pace}, based on your current fitness."`
- Why better: drops the false claim for the one screen that renders this sentence with no edit control behind it (traced through `PlanSnapshotDayView.swift` → `HostsV5.swift`). Keeps "Coach target" — it's the only provenance carrier a bare `notes` string has. The genuinely-true version of the editability claim already exists, correctly scoped, on Race Detail (`coach-goal.ts`'s "Yours to edit." under a real Edit button) — per the brief's own "if two components can both draw a value, one of them yields" rule, Race Detail keeps the claim and this sentence stops making it.

**Verification done this session (not claimed, actually run):** `_midrace_goal.test.ts` and `_midrace_role.test.ts` (19/19) pass against current `main`; `check-coach-voice.sh` reports clean (379 files scanned). This is source-level + test-level verification — **not** a simulator/device render. Per Rule 13, that gap is disclosed rather than papered over: I have not rendered `PlanSnapshotDayView` on a simulator this session. That's an honest limitation to carry into the implementation phase, not a blocker on the checkpoint itself (no UI/layout changed — this is a pure string substitution inside an existing, already-wired template-literal that was rendering the old string moments ago).

### Left unfixed, explicitly flagged (carried forward from the accepted commit's own notes, independently reconfirmed this session)
- `generate.ts:8915` — the C-race default note still reads `"{name}. C race · this is the week's quality session. Run it as the workout."` — same jargon pattern ("C race," "quality session"), same ternary, untouched by either Santa Monica branch.
- `race-outlook.ts:824-825` — two more "C race." openers in `reasonVsExpected`, confirmed still live.

These are natural next candidates for the broad-implementation phase (same pattern, same fix shape) but are **not done yet** — listed for the go/no-go decision, not claimed as complete.

## 5. Proposed shared language architecture

**Do not build a second coaching brain. Extend what's already here.** This codebase already has the right shape — several narrow, single-purpose, tested copy modules, each owned by one concern:

- `lib/coach/voice-band.ts` — resolves *which register* to speak in (calibration/guided/challenge) from objective signals. Tone selection, not sentence composition.
- `lib/faff/recap-voice.ts`, `lib/faff/why-voice.ts` — compose sentences from canonical facts (post-run recap, "why" explanations).
- `lib/race/race-row-note.ts`, `lib/coach/decision-cards.ts` — the "one owner" pattern already in force for race-row notes and decision-card copy respectively, each with a documented single-sentence contract and a regex/shape test pinning it.
- `lib/audit/sentence-repetition-registry.ts` — the existing Rule 17 gate (no sentence said twice on a screen).
- `lib/coach/settings-copy.ts`, `lib/faff/personal-goal-copy.ts`, `lib/plan/goal-outlook-copy.ts` — smaller surface-specific formatters.

**Proposal for the implementation phase:**
1. **No new "coaching brain" module.** Every fix in scope is a sentence inside an *existing* owner file (`generate.ts`'s embedded notes, `race-outlook.ts`'s `reasonVsExpected`, `decision-cards.ts`/`CoachDecisionCard.tsx`+`.swift`'s apply-failure copy). Fix them in place, same pattern as the accepted Santa Monica commit.
2. **One new, narrow thing is justified: a cross-surface parity contract for Apply-failure copy.** Right now `TodayView.tsx` and `CoachDecisionCard.swift` each hardcode their own apply-failure sentence. This is the same shape `race-row-note.ts` already solves for race-target sentences ("the ONE owner of the appended target-pace clause") — a single exported function (e.g. `applyFailureSentence(reason: ApplyFailureReason): string`) that both the web component and native (via a generated/shared constants file, or by keeping native's string manually pinned to match with a cross-reference test) resolve through. This is presentation-layer composition from a reason code the backend already returns — not a new truth source, consistent with the authority boundary in this brief.
3. **Extend `sentence-repetition-registry.ts`'s enforcement, don't replace it**, to cover the jargon terms found still live (`"C race"`, `"B race"`, `"quality session"` as literal runner-facing substrings) — the existing `check-coach-voice.sh` gate already scans 379 files for voice violations; confirm whether it currently catches internal-jargon leakage or only em-dash/hype violations, and if not, that's a one-line addition to an existing gate rather than a new one (Rule 20: a rule with no gate is a hypothesis).
4. **Every new/changed sentence gets a pinned-string test**, matching the existing convention (`_midrace_goal.test.ts`, `_midrace_role.test.ts`, `_cutback_copy_honesty.test.ts`) — this is already how the codebase falsifies copy changes, and it's the right contract to keep using rather than inventing a new one.

## 6. Truth dependencies that block or qualify copy work

- **`docs/design/ux-ia-acceptance-plan-2026-09-11.md` is not on `main`.** I have only its commit message, not its content. If it contains IA decisions about where "Today" vs "Races" vs a future "Decisions" surface draws which fact, that could change which surface owns which sentence. Flagging as unread rather than guessing at its content.
- **No "Brain/adaptation v2.1.1 errata" exists.** If David has a specific correction in mind under that name, I need the actual content — I can't reconcile against a document that isn't in the repo under any name I can find.
- **The post-run "intentionally shortened stride recovery" case has no current rendered copy to replace** (§3) — this is a real gap, not a wording problem. Whether to add disclosure copy there is a product decision (what should the recap say, if anything, about a recovery interval that ran short on purpose), not a pure language fix, and sits right at my authority boundary: I can word it once someone (Evidence Engine / workout-grading owner) confirms there's a fact to state.
- **The Apply-failure fix (§3, §5) depends on knowing the real set of failure reason codes** (`apply_refused`, `workout_not_found`, `invalid`, transport failure, etc.) and which ones are *actually* connectivity vs application-logic — I can write one sentence per real reason code, but I am not the owner of what those codes mean or when they fire; that's Plan Decisions / Adaptation Policy territory per the authority boundary. Needs a confirmed list from whoever owns `workout-proposals.ts`'s apply path before I commit to final wording, or I mark it BLOCKED per this brief's own instruction rather than invent the taxonomy.

## 7. What happens next

Nothing further has been implemented beyond the one rendered, tested, already-accepted fix in §4. Pending go-ahead on scope (the jargon removals in §4's "left unfixed" list, the Apply-failure parity fix in §3/§5, and resolution of the truth dependencies in §6), the next phase proceeds surface by surface with the same discipline: trace the render path, cite canonical facts, write the falsifying test first, verify against current `main`, and — where a UI file is touched — render it rather than claim it (Rule 13). Two independent reviews (truth-against-canon, and rendered UX/voice) are requested only once that phase is pushed, per the brief.
