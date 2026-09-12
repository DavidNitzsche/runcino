# Handback — Wave 4 (2026-09-11)

New movement only — see `docs/audit-2026-09-11-handback-wave3.md` for everything before this wave.

## 1. Merged and deployed

**All five authorized branches are merged and live.** `origin/main` is now **`e13542763573e17561970b0d1e05ba37a57420e3`**, confirmed via Railway (`SUCCESS` on that exact SHA).

| # | Branch @ tip | Merge commit | Conflicts |
|---|---|---|---|
| 1 | `fix/cim-elevation-integrity` @ `1b31a55ae` | `6c7a99aa0` | `project.pbxproj` GUID churn only |
| 2 | `fix/missed-skipped-moved-state` @ `6db2859d7` | `c97f1ec9f` | none |
| 3 | `fix/progression-pass-race-week-protection` @ `ee6df002d` | `52eabd658` | none |
| 4 | `fix/load-adaptation-week-ahead-race-detection` @ `3d382824c` | `9471b27ab` | none (merged after #3, dependency confirmed) |
| 5 | `fix/replan-scenarios-race-week-protection` @ `c57733696` | `8dff7892b` | none |

**One real regression was caught during integration, not shipped silently.** Branch #3's new DB query (`progression-pass.ts`'s `priorWeekDayTypes` lookup) had a bare `.catch(() => ({rows: []}))`, unratcheted on the swallow-scan gate. A DB failure there would have read identically to "this week has no race" — silently reopening the exact bug this whole session's race-week work exists to close, on the branch's own new code. Caught by the `check-swallowed-failure` gate during the combined-gate run, fixed (`3192f7ac1`, routed through the existing `rowsOrEmpty` helper instead), re-verified. This is exactly the kind of thing full gate chains exist to catch — worth knowing it worked.

**Combined gate results on the fully-integrated tree**: `npm run prebuild` clean, `tsc --noEmit` 0 errors, `next build` clean, full `vitest run` 12,112 passed / 1 pre-existing failure (`_authoring_shadow_compare.audit.test.ts`, named explicitly, not carried as an unnamed number — see §5) / 205 skipped, native `FaffTests` 543/544 passed (1 expected fail, confirmed via `xcresulttool`), `check-watch.sh` OK (234 test cases, 22 boards).

**CIM's acceptance evidence is preserved as a committed artifact**: `docs/verification/2026-09-11-cim-elevation/acceptance-evidence.md`. Contains: confirmation both values are net elevation (not gross — the actual conflict trigger is the gross-gain pair, 100 vs 723 ft, called out explicitly); full source/provenance/confidence table; the exact goal-pace cost math (0→54s); verbatim eyebrow/body copy and the single button; a source-level structural proof that the two-button choice card is unreachable for any curated course. One honest gap: no live simulator screenshot was captured in that pass (simulator-panel access wasn't available), though the merged Swift built clean and the real render path was exercised against CIM's actual traced numbers via a temporary, reverted preview edit. A separate, earlier pass in this same session already produced and confirmed an actual on-device screenshot matching this exact payload character-for-character — that evidence stands alongside this artifact.

## 2. Push mechanics worth knowing

The integration agent correctly declined to authorize and push the final merge itself — its reasoning: an instruction relayed from another agent isn't the same as your direct go-ahead for a production push, and the shipping lock had no live authorization for that specific commit. That's the right instinct in general. Since I had your direct authorization for this exact 5-branch merge, I completed the final step myself: authorized the exact integration SHA via the shipping lock and pushed it. Confirmed via `git ls-remote` and Railway.

One live demonstration of why the node_modules-gate scoping fix (§4) matters: the worktree I used for the final push lacked `web-v2/node_modules`, so it hit the *old*, unscoped gate behavior and silently skipped the web checks on this specific push. Harmless here — the actual content was already fully verified in a separate worktree with `node_modules` present — but a real, live instance of the exact friction that fix exists to close.

## 3. Lane A and CIM holds — resolved with the literal evidence you asked for

**Lane A**: rendered live against David's real workout, not reasoned about. The full literal answer was delivered in-chat — per-phase display (none of the 6 recoveries carries any individual status at all, not "neutral," literally nothing), the exact on-screen Coach's Read card text, confirmation "Plan unchanged" is genuinely zero effect (traced to a real absence of any adaptation-reason row, not a suppressed one), a real correction to the earlier evidence-classification claim (excluded from *anchor-moving* evidence specifically, not evidence generally — it IS classified for durability corroboration, and that classification's own sentence is literally what appears under "Why" on the real card), and confirmation "uneven" never reaches the runner's eyes and has zero effect on future training, verified by tracing every consumer. **Still held pending your explicit merge authorization** — not merged in this wave.

**CIM**: confirmed two ways this session — structurally (the choice card is architecturally unreachable for any curated course) and by actual device screenshot matching the payload character-for-character. **Merged and deployed** as branch #1 above.

## 4. Node_modules gate — scoped, re-reviewed, ready

`fix/pre-push-node-modules-gate` @ `ae7619ea9`. Added `touches_web()`, mirroring the existing `touches_watch()` pattern exactly (including self-including the gate scripts so editing them still forces a check). Both directions independently falsified: the bypass case (docs-only push, no `node_modules`) now correctly skips the check; the false-block case (a web-v2-touching push, no `node_modules`) still correctly refuses. The re-reviewer additionally stress-tested the falsifier's own "self-skip if history changes" safety mechanism three separate ways and confirmed it fails closed every time. **PASS, ready for merge authorization** — not merged yet.

## 5. Named, not carried as a number

**`test-full`'s expected fail is `_authoring_shadow_compare.audit.test.ts`.** It's a Rule 18 liveness-refusal gate, designed to fail loudly whenever `DATABASE_URL_RO` isn't configured in the environment, specifically so a missing credential can never silently read as clean. Confirmed identical, byte-for-byte, across every unmodified checkout of `main` this entire session. Not a regression from anything merged.

## 6. Duplicate September 13 race rows — investigated, benign

Full findings already reported in-chat: two rows, one live (`wko_a69751c4cc8ab89a`, active plan) and one orphaned in an archived plan version from a `silent-rebuild` cron operation. Every production surface (Today, watch delivery, pre-run lobby, week strip, completion matching, adaptation loaders) already scopes to the active plan only — the orphaned row is invisible everywhere it matters, confirmed by tracing the actual queries. Build 290 already has this scoping. **No code repair needed for this incident.** One adjacent, non-urgent gap named for possible separate dispatch: no pruning mechanism exists for orphaned `plan_workouts` rows across plan rebuilds (47 plan versions / 4,130 rows for one user, accumulating unboundedly).

## 7. Natural Coaching Experience — first result delivered

`natural-coaching/santa-monica-race-day-v2` @ `b0d7349e7`. Removed "yours to change" entirely (rather than patching it) after tracing that the real editable control lives on a different screen that already has an honest version of that claim; kept the pace-band/target-pace distinction since both are genuinely real, separate facts. Correctly scoped: found and named (not touched) two adjacent jargon issues in sibling code paths, and one string it honestly couldn't trace to a render site in the session's time budget. **Pending the truth review and UX review you specified** — not dispatched yet, since those review processes weren't fully defined; say the word on how you want them structured.

## 8. Required status report (already given in-chat, restated here for the record)

| Item | Status |
|---|---|
| Lane C (proposal-state) | Never dispatched — was gated on undo-display's integration, which never happened |
| `fix/decision-history-undo-display` @ `6f8a3d28f` | Reviewed PASS long ago, still unmerged |
| `fix/proposal-evidence-as-prose` | Unmerged, not mine, different concurrent session — no file overlap with undo-display, same domain, worth tracking |
| Race-week canonicalization | **Dispatched now** (see §9) — its prerequisite (the 5-branch merge) is satisfied |

## 9. Race-week canonicalization — dispatched

Per your explicit instruction, now that the reviewed race-week branches are merged: dispatched one bounded implementer to cover `strategy-contracts.ts`, `adjudicate.ts`, `live-sequence.ts`, and an exhaustive fresh search of every remaining raw `is_race_week`/`isRaceWeek` read across `web-v2` — required to produce named canonical predicates (race day / race week / post-race recovery / goal race / tune-up race), route every consumer through the right one, preserve doctrine-backed GOAL-only behavior with citations, and add a ratcheted static regression gate so a 10th silent instance can't land again. The report will include the complete call-site inventory as a required deliverable, not optional detail. Independent review to follow once it lands.

## 10. Canonical v3

Dispatched a fold-in of everything in this handback and wave 3 into `docs/audit-2026-09-11-canonical-record-v3-DRAFT.md`, explicitly instructed to keep it labeled DRAFT — active implementations (race-week canonicalization, Natural Coaching Experience reviews) and product holds (Lane A, node_modules gate, undo-display) remain open.

## Still open

- Lane A merge authorization.
- Node_modules gate merge authorization.
- Race-week canonicalization result (in progress).
- Natural Coaching Experience's truth + UX review process.
- Lane C — not started.
- `fix/decision-history-undo-display` — reviewed, unmerged.
- Migration 166/170 — unauthorized.
- No TestFlight candidate authorized.
