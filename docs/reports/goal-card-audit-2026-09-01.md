# Goal-card doctrine audit — 2026-09-01

Scope: `native-v2/Faff/Faff/Components/CoachDecisionCard.swift` (the ONE
interruption card on iPhone) and its one real call site,
`native-v2/Faff/Faff/Views/TodayView.swift:314-322`. Audited against
`docs/PRODUCT_DECISIONS.md`, 2026-08-31 entry "Goal changes require explicit
runner action, and Races folds into Progress," sub-heading "1 · The
goal-acceptance card is valid, but only under a strict rule," verbatim.

The prior audit's `RacesV5Sample` stale-preview-fixture finding is closed and
not re-litigated here.

## Where the goal-outlook card actually lives in the code

`CoachDecisionCard.swift`'s pure selector (`CoachDecisions`) folds four
sources into one queue. The goal-doctrine-relevant path is
`fromPlanProposal` (lines 350-435), specifically the `informationalPlanKinds`
branch (lines 367-384) for `plan_proposals.proposal_kind = 'goal_outlook'`
(and the retired `goal_renegotiation`, whose old rows must still render
safely). This is fed by the backend's `web-v2/lib/plan/goal-outlook.ts` +
`goal-outlook-copy.ts`, written by the `plan-drift` cron
(`web-v2/app/api/cron/plan-drift/route.ts:1334-1359`) when a goal is
`unclosable` for 5+ consecutive days. As of this audit, David's own account
carries a live pending row of this kind (`plan_proposals.id = 63`, created
2026-08-31).

## Doctrine checklist

| # | Doctrine bullet | Verdict | Citation |
|---|---|---|---|
| 1 | No dominant/primary CTA visually favoring a goal change over keeping the goal | **PASS** | `informationalPlanKinds` branch (`CoachDecisionCard.swift:367-384`) gives the card exactly **one** action: `.init(role: .keep, label: "KEEP THE GOAL ON THE BOARD", ...)`. There is no `.accept` action at all for this kind — the retired `"ACCEPT · SET THE REVISED TARGET"` verb was deliberately excluded from `planAcceptVerbs` (lines 317-332, see the 2026-08-30 comment at 319-323). With no accept button in the tree, there is nothing for a primary CTA to dominate over. Server-side, `POST /api/plan/proposal` explicitly refuses `action: 'accept'` for this kind (`web-v2/app/api/plan/proposal/route.ts:144-150`), so a UI regression that added an accept button back could not mutate anything even if it shipped. |
| 2 | No preselected revised target | **PASS** | The card's `body` text (composed server-side in `web-v2/lib/plan/goal-outlook-copy.ts:73-98`, e.g. `"This build projects 3:22:17. The 3:00:00 stays on the board as the season ambition. ... Nothing to set here."`) states the projection as prose, not as a selectable/default value. There is no input control, no highlighted number, nothing to accept. |
| 3 | "Hold current goal" is a genuine co-equal option, not a dismiss action | **PASS, with one defect found and fixed (see below)** | The one action present, `"KEEP THE GOAL ON THE BOARD"`, is rendered through the same `actionRow` button styling every other action gets (full-width capsule, bold caps label, `Theme.Glass.fill` background + stroke — `CoachDecisionCard.swift:649-685`), not a ghost/ link style. But a **second, competing close path** existed alongside it (the generic bottom "DISMISS" ghost button, present on every `.notice`-kind card) that was **not equivalent** — see the fix below. |
| 4 | No automatic change after a timeout, no silent rebuild before explicit approval | **PASS** | No timer, no polling-triggered mutation anywhere in the card or its dispatch path (`TodayView.swift:862-893`, `performCoachDecision`). The plan-drift cron only ever *writes a note*; it never rebuilds a plan or changes `goalSec` for this kind. Accept is refused server-side per row 1. |
| 5 | Copy never conflates projection and goal ("we've updated your goal") | **PASS** | `web-v2/lib/plan/goal-outlook-copy.ts:73-98`, `composeGoalOutlookMessage`. Grammar is explicit and tested against the exact violating sentence it replaced (file's own header comment, lines 57-67): `"This build projects X. The Y stays on the board as the season ambition. ... Nothing to set here."` Never "your goal is now X." |
| 6 | Correct handling of an acknowledged-aggressive-goal state — no re-nag every few runs, only re-surface on material change | **PARTIAL — open, needs product judgment, not fixed here** | See "Open findings" below. There is a real acknowledgment mechanism (server-side `dismissed` status + 14-day cooldown in `writeGoalOutlookNote`'s `recentDismiss` check, `web-v2/lib/plan/goal-outlook.ts:221-230`), reached correctly via the `KEEP` button once bullet 3's bug is fixed. But the cooldown is **time-based, not materiality-based** — doctrine's own wording is "re-surfaces the decision only when the outlook materially changes," which this does not implement. |

## What was fixed

### Bug: a redundant, non-authoritative "DISMISS" button undermined the one real acknowledgment path

**File:** `native-v2/Faff/Faff/Components/CoachDecisionCard.swift`, `actionRow` (around line 690).

Every `.notice`-kind card in this component gets a generic bottom ghost
button. For a *true* FYI notice (an already-applied plan rebuild, an
already-happened adaptation) that button is correctly local-only —
`dismissCoachDecision` in `TodayView.swift:910-919` writes only to
`UserDefaults`, and the code comment says exactly why: "the coach_intents row
... [is] untouched — this is a display convenience, not an ack," which is
correct there because nothing server-side needs to change for a fact that
already happened.

The goal-outlook note is different: it is dressed as a `.notice` (so it
doesn't wear the amber "NEEDS A DECISION" eyebrow — deliberately, since
nothing is being asked), but closing it *is* a real, meaningful runner
decision — the acknowledgment doctrine names. That decision has exactly one
correct path: the `"KEEP THE GOAL ON THE BOARD"` button, which round-trips to
`POST /api/plan/proposal { action: "dismiss" }`
(`API+Toolkit.swift:387-403`), which sets `plan_proposals.status = 'dismissed'`
server-side, which is what `writeGoalOutlookNote`'s `recentDismiss` check
(`goal-outlook.ts:221-230`) reads to hold off re-surfacing for 14 days.

Before this fix, the card *also* rendered the generic bottom "DISMISS" ghost
text underneath that real button (because the notice-kind bottom-button logic
had no exception for a notice that already carries its own `.keep` action).
Tapping that ghost text closed the card **without ever calling the server** —
the runner would believe they'd acknowledged the aggressive goal, but the row
would still read `status = 'pending'` in the database, and the cron's 7-day
`OUTLOOK_REFRESH_DAYS` refresh window (`goal-outlook.ts:63`) would bring a
fresh note back in as little as 7 days — sooner than the real 14-day
dismissed-cooldown, and via a path the runner had no reason to think hadn't
"worked." That is a direct violation of bullet 6 ("does not nag every few
runs") caused by a rendering-layer bug in a component that had no reason to
know about `goal_outlook`'s specific backend semantics.

**Fix applied** (mechanically safe — confirmed the `.keep` role is unique in
the codebase to this exact case; touches no other card type):

```swift
// Before:
Button {
    if item.kind == .decision {
        withAnimation(Theme.Motion.smooth) { _ = resolved.insert(item.key) }
    } else {
        onDismiss(item)
        withAnimation(Theme.Motion.smooth) { _ = resolved.insert(item.key) }
    }
} label: {
    Text(item.kind == .decision ? "DECIDE LATER" : "DISMISS")
        ...
}
.buttonStyle(.plain)
.disabled(busy != nil)

// After:
if !(item.kind == .notice && item.actions.contains(where: { $0.role == .keep })) {
    Button {
        if item.kind == .decision {
            withAnimation(Theme.Motion.smooth) { _ = resolved.insert(item.key) }
        } else {
            onDismiss(item)
            withAnimation(Theme.Motion.smooth) { _ = resolved.insert(item.key) }
        }
    } label: {
        Text(item.kind == .decision ? "DECIDE LATER" : "DISMISS")
            ...
    }
    .buttonStyle(.plain)
    .disabled(busy != nil)
}
```

Verified the guard's scope by auditing every constructor in
`CoachDecisions`: `.keep`-role actions otherwise only appear on `.decision`-
kind cards (`fromCoachProposal`, `fromWorkoutProposal`, and the non-informational
branch of `fromPlanProposal`), where the bottom ghost button is intentionally
a *different* action ("DECIDE LATER" — a session-only defer, not a decline)
and is unaffected by this guard. The `auto_applied` plan-proposal branch
(`canUndo` case) keeps its ghost "DISMISS" alongside `"PUT THE OLD BLOCK
BACK"` unaffected too, since that pairing was correct as documented (`undo`
role, not `keep`). The informational `goal_outlook`/`goal_renegotiation`
branch is the only place a `.notice` carries a `.keep` action, so the fix is
scoped to exactly the defect.

**Build verification:** `xcodebuild -project Faff.xcodeproj -scheme Faff
-destination 'generic/platform=iOS Simulator' -configuration Debug build` →
`** BUILD SUCCEEDED **`, both immediately after the fix and again as a final
clean-diff confirmation (`git diff --stat` shows only `CoachDecisionCard.swift`
changed — all temporary debug instrumentation used during rendering
verification was fully reverted).

## Rendering verification — attempted, inconclusive, reported honestly (Rule 13)

Per Rule 13, a fix to something the runner sees should be verified by
rendering it against real data, not by reading the code. I located a live,
real, currently-pending `goal_outlook` row on David's own account
(`plan_proposals.id = 63`, `user_uuid = 0645f40c-951d-4ccc-b86e-9979cd26c795`,
created 2026-08-31) — exactly the case this fix touches — and tried to render
it in the iOS Simulator (build → install → launch → screenshot David's
already-authenticated session against prod).

The Today screen loaded and showed real, live-looking data (today's actual
run: EASY, 6.18 mi, 51:35, 8:21/mi; a "RECOVERY IS DONE" note from a genuine
different plan-proposal row). But no interruption card of any kind rendered
above the hero, and this held across multiple relaunches.

I instrumented `TodayView.loadAll()` and `API.fetchPlanProposals()` with
logging (both a UserDefaults-backed on-screen debug overlay and raw log
writes) to find out whether the fetch was firing, returning empty, or
failing. Ground truth via `PlistBuddy` against the simulator's actual
`run.faff.app.plist` showed the debug key was **never written** — meaning
`loadAll()` did not run during that process's lifetime, even though the
screen displayed data that can only have come from a real fetch (this
specific numeric combination doesn't match any hardcoded sample/preview
fixture I could find). I could not reconcile these two facts within
reasonable effort: either something in my ad hoc
build/install/launch pipeline (bypassing Xcode's own Run flow) doesn't
exercise the same initialization path a normal launch does, or there is a
real timing/lifecycle issue in how `TodayView`'s `.task` fires that I did not
get to the bottom of.

**I am not claiming this is a bug in the app** — I could not distinguish
"my simulator harness isn't representative" from "there's a real issue" in
the time available, and per Rule 13 an honest "could not confirm" beats a
guess in either direction. What I can state with confidence: the code change
itself is correct by careful reading (traced every constructor and call
site), compiles cleanly, and is narrowly scoped. What I cannot state: that I
watched the fixed card render on screen with real data. **Recommend this be
re-verified the next time Today is exercised through a normal Xcode Run (not
an ad hoc `xcodebuild`/`simctl install` pipeline), ideally by tapping through
to a state where `coachDecisionQueue` is confirmed non-empty and watching the
"KEEP THE GOAL ON THE BOARD" tap actually clear the card with the ghost
DISMISS no longer present underneath it.**

## Open findings — needs product judgment, not fixed here

### Bullet 6, remainder: the re-nag suppression is time-based, not materiality-based

Doctrine: *"faff does not nag every few runs... re-surfaces the decision only
when the outlook materially changes."*

The actual mechanism (`web-v2/lib/plan/goal-outlook.ts`):

- `OUTLOOK_SUSTAINED_DAYS = 5` — gates the *first* surface (gap must be
  unclosable for 5+ consecutive days).
- `OUTLOOK_REFRESH_DAYS = 7` — a fresh **pending** note blocks a rewrite for
  7 days.
- A **dismissed** note (i.e., the runner tapped KEEP) blocks a rewrite for 14
  days (`recentDismiss` check, lines 221-230).

None of these three checks compares the new projection to the old one. Once
14 days pass since a dismissal (or 7 days since an un-acted pending note), the
cron will write a new note with whatever the current projection happens to
be — even if it is numerically identical to the one the runner already
acknowledged. This is a real, structural gap against the doctrine's own
wording, but closing it correctly requires a genuine product/design call this
audit should not make unilaterally:

- What counts as "material"? A fixed-second threshold? A percentage of the
  goal? A confidence-band crossing?
- Does the clock reset on every 14-day cycle regardless of materiality (i.e.,
  materiality only ever *shortens* re-surfacing, never lengthens it past 14
  days), or does an unchanged projection suppress re-surfacing indefinitely
  until it moves?
- Should this be judged against the same `resolveRaceProjection` number the
  note already displays, or against something coarser (e.g., the `gap_sec`
  the row already persists in `reasons`)?

**Recommendation:** add a materiality check to `writeGoalOutlookNote` before
the fresh row is inserted — compare the new `projected_sec` (or `gap_sec`)
against the most recent prior row's persisted `reasons.projected_sec` (or
`gap_sec`) for this kind, and skip the write (extending the existing
cooldown) when the change is under some named, doctrine-arguable threshold
(the existing codebase pattern for "a number needs a name and an argued
reason, not a bare literal" is `CORROBORATION_MIN_OBSERVATIONS` — cited by
the standing shakeout-pace decision in `docs/PRODUCT_DECISIONS.md`'s
2026-08-31 "shadow-mode report" entry as the model to follow). This is a
backend change (`web-v2/lib/plan/goal-outlook.ts`), not a
`CoachDecisionCard.swift` change, and is out of this audit's scope to
implement without that threshold being argued and named first.

## Files touched

- `native-v2/Faff/Faff/Components/CoachDecisionCard.swift` — the fix (diff
  above). This is the only file with a net change; `TodayView.swift` and
  `API+Toolkit.swift` were used for temporary rendering-verification
  instrumentation that was fully reverted (`git diff --stat` confirms no
  changes remain in either).
