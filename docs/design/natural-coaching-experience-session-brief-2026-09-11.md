# Natural Coaching Experience — Session Brief

This is a handoff bundle for the dedicated Natural Coaching Experience session. Main (this session) is stopping all further internal coaching-copy edits as of this document — that domain is now fully owned here. Main remains the sole integrator; this session produces work for review and integration, it does not merge to `main` itself.

## Mandate, restated

Own presentation language only — never fitness conclusions, plan decisions, or adaptation logic. Remove engine jargon, redundant explanations, canned transitions, vague pseudo-human phrases. Every message answers only: what happened, what it means, what to do next. Any claimed action must correspond to a real, visible control. Use canonical structured facts and reason codes, never recomputed coaching conclusions. Use David's real runs/plan states as the primary corpus. Requires a separate truth review and rendered UX review before integration.

## In-flight work to inherit

- **`natural-coaching/santa-monica-race-day-v2` @ `b0d7349e7`** — the first work product. Copy delivered (see full report in this session's history), rendered via a new debug harness, falsified, full test suite green. **Pending your truth review and UX review** — neither has been structured or dispatched yet.
- **`fix/santa-monica-race-day-copy` @ `38d090ec8`** — the REJECTED reference case. Held, not merged, kept as the "what not to do" example. David's own critique of it (repetitive phrasing, mechanical/threatening tone, a meaningless "yours to change" claim with no verified control) is the bar every future rewrite is checked against.

## Reference material

- **Lane G's acceptance plan**: `docs/design/ux-ia-acceptance-plan-2026-09-11.md` — the KEEP/REFINE/RESTYLE/UNIFY/REMOVE vocabulary and the 27-area coverage map. Use its Refine/Restyle boundary to self-classify any change.
- **Coach v2.1 + correction log**: `docs/audit-2026-09-09-coach-forensic-audit-v2.1.md`, `docs/audit-2026-09-09-coach-forensic-audit-v2-to-v2.1-correction-log.md` — the accepted Coach packet's findings on factual language, uncertainty, causality, repetition, hierarchy, cross-surface consistency.
- **Brain v2.1 + errata**: `docs/audit-2026-09-10-brain-adaptation-forensic-audit-v2.1-FINAL.md`, `docs/audit-2026-09-10-brain-v2.1.1-errata.md` — the accepted Brain packet's findings on evidence eligibility, canonical ownership, state predicates, grading. Read this before writing any copy that touches a coaching conclusion, so the copy stays a description of what the engine already decided, never a new decision.

## Explicit occupied-file list — do not create new logic here, only presentation strings

- `web-v2/lib/plan/generate.ts` — race-day default sentences (already touched by the held/rejected branch and its replacement)
- `web-v2/lib/race/race-row-note.ts` — coach-voice target-pace clause
- `web-v2/lib/postrun/experience.ts` — post-run "Coach's Read" composer (Lane A touches this file; coordinate, don't duplicate)
- `web-v2/lib/training/course-elevation.ts` / `web-v2/lib/training/race-card.ts` — CIM's informational-card copy (already fixed this session, see below)
- `web-v2/lib/execution/day-resolution.ts` consumers — missed/skipped/moved labels (native-side: `PastDayResolutionHeroV5`, `ChartsV5.swift`'s week-strip badge copy)
- `web-v2/lib/coach/standing-recommendation.ts`, `web-v2/lib/plan/strategy-contracts.ts` — Lane D's convergence/cutback copy (already fixed this session)

## Specific cases to add to your queue

1. **`web-v2/lib/postrun/experience.ts:711`** — a confirmed, real, runner-facing em-dash violation surfaced by this session's widened coach-voice gate (`lib/postrun` is now in scope). Treadmill-target INDETERMINATE branch: *"...not pace — this is a record of what was run rather than a pace grade."* Needs the same treatment already applied to the sibling string in this same file (the "recorded, not graded" idiom). Not yet fixed.
2. **Lane A's eventual recovery wording** — currently shipped (pending merge authorization) as: *"Walk-backs came in short of what was modelled: recorded, not graded."* Full literal rendered evidence, including the surrounding card and "Why" disclosure text, is in `docs/verification/2026-09-11-lane-a-literal-evidence.md`. Review this against your mandate once you're up and running — it was fixed under Main's direct supervision to close a specific product-correctness hold, but it's exactly the kind of string your session should now own going forward.
3. **CIM's informational copy** — already shipped (merged to `main`). Full payload/copy/render evidence in `docs/verification/2026-09-11-cim-elevation/acceptance-evidence.md`. Worth a pass through your mandate's lens even though it's already merged, since it was written under time pressure to close a specific hold, not with your dedicated review.
4. **Missed/skipped/moved labels** — `native-v2/Faff/Faff/ViewsV5/ChartsV5.swift`'s week-strip badge spoken-word/visual labels and `PastDayResolutionHeroV5`'s hero copy for each of the 5 states (completed/moved/skipped/missed/supplemental). Shipped this session, not yet reviewed under your mandate.
5. **Two items found and deliberately left unfixed by the Santa Monica v2 work, named for you**: `generate.ts`'s `'b_effort'` branch and the C-race branch (both carry "B effort"/"C race"/"quality session" jargon, same shape as the fixed default sentence) — left alone to avoid growing that change's blast radius. And `web-v2/lib/race/race-outlook.ts`'s `reasonVsExpected` field ("C race. Run it as the week's hard session...") — flagged but never confirmed to actually reach a render surface; needs tracing.

## Constraints, restated

- Presentation only. If a fix requires recomputing a value or changing what the engine decides, stop and name it — don't implement it here.
- Every claimed control needs verification that it's real and reachable from the screen the copy appears on.
- Real data over fixtures wherever DB access allows.
- Truth review + UX review required before anything here goes to Main for integration consideration.
