# Status and answers — 2026-08-31

This is not your briefs sent back to you. This is what actually happened to
each one: decided / saved / built / shadow / live / still open — with the
real findings, not a restatement of the question.

---

## 1 · Workout library & evidence coverage (your brief 01)

Saved as design direction (`docs/design/plan-evidence-coverage-2026-08-31.md`).
**Not built.** No catalogue expansion or evidence-coverage scoring exists yet.

## 2 · Product & Coaching Doctrine — master (brief 02)

Saved verbatim, canonical: `docs/PRODUCT_COACHING_DOCTRINE.md`. Required
reading item 0 in `CLAUDE.md`. **Applied**, not just filed — the four
capacity resolvers, the `sourceMode` discipline, and every shadow-mode build
tonight trace directly to this doc.

## 3 · Twelve companion briefs (brief 03)

Saved: `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md`. Ownership boundaries feed
the Brain Constitution's ownership table (item 12 below).

## 4 · Doctrine Enforcement & Clean Implementation (brief 04)

Saved: `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`. Its own gate
(`_doctrine_gate.test.ts`) is **currently failing 4/658** — the
prescription-resolver refactor moved pace-formula code in `spec-builder.ts`
without updating the Rule 7 citation regex. Found by the Plan Generator
report, **not yet fixed.** Flagging again because it's a live regression in
a gate this doc itself created.

## 5–6 · Reference cases (briefs 05–06)

Saved: `docs/reference-cases/easy-run-warm-conditions-2026-08-31.md`,
`docs/reference-cases/structured-long-run-2026-08-30.md`. Worked examples,
not mechanisms — no build attached.

## 7 · UX Simplification Doctrine (brief 07)

Saved: `docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md`. The bloat audit it
called for ran: `docs/audits/ux-bloat-audit-2026-08-31.md`. Real findings
came back — repeated content, at least one stale-fixture false alarm
(caught and corrected, see item 11) — **not yet acted on**, per your hold.

## 8 · Adaptation & Progression mechanics (brief 08)

Saved: `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`, explicitly gated on the
Evidence Engine landing first. **The Evidence Engine has now landed**
(shadow mode, confirmed by tonight's brain-status report) — so this brief is
unblocked but **still not started**.

## 9 · Coaching Brain Consolidation (brief 09)

Saved as reference per your own correction, not a gate:
`docs/COACHING_BRAIN_CONSOLIDATION_BRIEF.md`.

## 10 · Stats & Paces (brief 10)

Design doc drafted: `docs/design/stats-and-paces-2026-08-31.md`, with the
Strava/Garmin competitive-reference section you asked for added. **Not
built.**

## 11 · Goal-acceptance card + Races navigation (brief 11)

**Both decisions locked**, verbatim as you wrote them, in
`docs/PRODUCT_DECISIONS.md` under "Goal changes require explicit runner
action, and Races folds into Progress. SETTLED."

**Real implementation status, checked just now, not assumed:**

- Races is **still a standalone live tab** — `ShellV5.swift` /
  `RacesV5.swift` on `native-v2` have not been touched. The fold-into-Progress
  decision is doctrine, not yet shipped.
- `CoachDecisionCard.swift` exists and is the live goal-card surface. The
  Race Prediction report's flagged "renegotiation" violation traced to a
  **stale SwiftUI preview fixture** (`RacesV5Sample`), not this live
  component — `composeRaceCard` was restructured 5 days before that audit
  ran and can no longer produce the violating card. That clears the
  specific historical concern, but nobody has yet re-audited
  `CoachDecisionCard.swift` line-by-line against the new co-equal-choices
  rule (no primary CTA, no preselected target, `runner_acknowledged_gap`
  state). **Open, not closed.**

## 12 · Brain Constitution (brief 12)

Saved: `docs/BRAIN_CONSTITUTION.md`, required reading item 0, ahead of
everything else. Its ownership table is what the brain-status report (item
13 below) was graded against.

## 13 · Adaptation Engine — your 7-point review, before authority (brief 13)

**Still in flight.** The agent reviewing all seven points against real
production history (`a7d779da67a54ef45`) has not finished. This is the
biggest open item — the Adaptation Engine does not get authority until this
comes back and you've seen it. Will report the moment it lands, point by
point against what you actually asked, not a summary that skips the hard
ones.

## 14 · Tomorrow's workout — full provenance trace (brief 14)

**Just landed.** Full document: `docs/reports/workout-provenance-trace-2026-09-01.md`
(committed `7f906109`). Reproduced your screenshot exactly from the real DB
row, not a fixture. Direct answers:

- **Why 4×1mi:** correct, and doctrine-driven — Daniels' 10% weekly at-pace
  share cap on a 45mi week forces 6 reps down to 4. Real math, not arbitrary.
- **Why 7:19: you were right to be suspicious.** It's the **old VDOT cascade**,
  not the new resolver — the plan row was authored 11 hours before
  `capacity-resolver.ts` even existed in the repo. The new resolver's actual
  answer is **430** (7:10/mi), direct evidence, confidence 0.727, three
  named corroborating sessions. The 9-second gap is two errors partly
  cancelling: the old scalar VDOT reads 13 s/mi slow against your real
  threshold evidence, offset by a 4 s/mi goal-facing grace that shouldn't be
  there either.
- **Why 9:03 three times: worse than one reused pace.** It's not even a
  correct easy pace — it's the midpoint of a band whose own code comment
  says only the *low end* is the meaningful ceiling (per the "ceiling not a
  band" decision already settled 2026-08-31). And that band itself derives
  from the same legacy threshold scalar, offset by +100. So **9:03 = old
  cascade + 100**, not real easy-run evidence at all. Today's actual easy
  ceiling resolver returns 8:22 (direct evidence) — the screen is running
  41–51 s/mi slow on every easy segment.
- **Warm-up/cool-down "2.1 mi":** not a warm-up judgment — it's leftover
  weekly mileage, halved and split. Both are identical by construction on
  any day with slack, which is why they matched.
- **Warm-up contradiction confirmed, and there's a third contradicting
  line you didn't see on screen:** the spec also carries an HR cap of
  "≤139," on a card that says build into 7:19/mi work at a flat 9:03 pace.
  Three numbers on one row, two of them fighting the third.
- **Coaching Thesis:** confirmed, zero implementation anywhere in the
  codebase. Nothing has an opinion about what this Tuesday is *for*.
- **Which numbers are new brain vs. legacy:** structure (identity, rep
  count, rep length, recovery duration) is new and doctrine-bound. Every
  single pace on the card — the 7:19, and all three 9:03s — is legacy. The
  wiring that would fix this (`resolvePrescribedPaceAnchors`) exists but is
  **uncommitted, in progress, on a different agent's branch** — it has not
  reached this row yet.
- **One fix landed already:** the punitive cooldown copy ("Do not skip it,
  it shortens tomorrow") is now "Easy jog. Part of the workout, not extra
  mileage." Tests green, pushed.
- **One new bug the trace found that you didn't ask about:** the watch
  grades execution against a 7:11–7:27 band, but the phone only ever shows
  the single midpoint number — you're being graded against a range you're
  never shown.

---

## What's genuinely still open, no hedging

1. **Adaptation Engine authority** — blocked on your 7-point review, agent
   still running. Nothing ships here until you've seen it.
2. **Pace Prescription wiring into live recompute** — a separate agent is
   mid-flight on this now; not yet committed.
3. **`_doctrine_gate.test.ts` 4/658 failure** — real regression, not fixed.
4. **`goalRunFloorMiForUser`** — a live violation of "goal data physically
   excluded from capacity resolvers," self-disclosed in its own comments,
   not fixed.
5. **Coaching Thesis** — doesn't exist. Every "why" a runner reads is either
   a static per-family string or absent.
6. **9:03-everywhere bug** — real, worse than suspected, root-caused, not
   yet fixed (the fix depends on the in-flight wiring work above landing
   first, so the easy-ceiling resolver actually reaches this code path).
7. **Races-tab fold and CoachDecisionCard re-audit** — decided in doctrine,
   neither one built or re-checked against the new rule yet.
