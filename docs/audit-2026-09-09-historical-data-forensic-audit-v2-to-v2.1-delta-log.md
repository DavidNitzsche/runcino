# v2 → v2.1 Delta Log — faff.run Historical-Run Data Forensic Audit

A narrow correction pass over v2, not a re-run of the audit. v2 itself is unchanged at `docs/audit-2026-09-09-historical-data-forensic-audit-v2.md`. Organized by the 8 items in the correction brief.

## 1. `[RENDER]` usage corrected

v2 tagged an HTTP call to `/api/v5/today` (executed against a real database copy via the documented local walk-substrate harness) as `[RENDER]`. That's wrong: the call proves the SERVER PAYLOAD is correct — it is `[TEST]`/`[PROD-QUERY]` evidence. It does not prove the Swift client actually drew the expected screen. Every occurrence fixed (§ Evidence limitations, §8, §9, §11a, §12, §14). The now-precise three-part statement, used consistently: **current server payload — proven** (`[TEST]`); **current client source path — traced** (`[SOURCE]`); **actual Swift rendering — still unverified** (`[BLOCKED: no simulator/device render performed]`). No genuine `[RENDER]` evidence survives anywhere in v2.1.

## 2. TestFlight build wording corrected

v2 said build 290 was "the only build ever shipped to this account." False — `git log --all --grep="TestFlight build"` shows a long continuous ship history, including build 275 (`89f602df5`) and build 278 (`9f2ff3f1a`) among many others back through at least build 225. Corrected everywhere: build 290 is the **latest/highest build uploaded as of this pass**. What still holds: no build newer than 290 exists, so 290 was the newest build that could possibly have been installed at the time of the run; which build was actually installed remains `[INFERENCE]` (the exact build number is never transmitted to the server by any code path). Strengthened, not weakened: since `workoutPhasesTile` was live on every build from its introduction (2026-09-04) through 290, any build in that window — not specifically 290 — reproduces the symptom.

## 3. Decision-ledger caller count reconciled — definitive list published

Re-derived fresh against current `origin/main` (`99757c120`), not carried forward from any prior claim. **8 distinct write-caller files, 11 call-site lines** (§2.C row 5 in the register, formerly "10 live sites"). All 8 named with exact file:line. v2's "10" over-counted by including two genuinely READ-ONLY callers (`app/api/admin/decision-ledger/route.ts` — GET-only, every function it calls is a SELECT, confirmed by its own header comment and direct inspection; `lib/runner-state/store/lineage.ts` — imports only `resolvePlanLineage`, a read, and a type, never the write functions) and by risking conflation with `lib/plan/reschedule.ts`'s own unrelated, same-named local `recordDecision(tx, d)` function (different signature, defined in the same file, not the ledger's function at all).

## 4. Historical-mutation transfer completed

New §2.C, 7 named rows, each with mechanism/authority/before-after/scope/audit-trail/status: the 2 applied `plan_mutations` (05-24, 05-25); the June 2 automatic volume rebuild (already established, restated as its own row); the **August 25 automatic long-run rebuild** (new this pass: `plan_proposals` id 54, `long_drift`, `auto_applied`, authored median 7mi → actual 11.5mi, +64.3%, retired mechanism); the adjacent August 26 easy-day automatic DOWNWARD rebuild (surfaced for completeness — same cron, opposite direction, one day later); the September 3 engineer-dispatched `silent_rebuild` that created the current active plan. **The September 2 re-anchor affecting 76 workouts could NOT be confirmed** — `plan_workouts` has no timestamp/audit-trail column and no dedicated re-anchor table exists; the closest evidence (`lthr_bpm=168` on 23 rows total across the two most recent plans, not 76) is consistent with Rule 23's cited re-anchor CLASS having happened but does not confirm the specific count or date. Reported `[BLOCKED]`, not asserted.

## 5. Matcher defect clarified and tested

Attribution corrected: the ambiguity-refusal behavior lives in `ingest/workout/route.ts`'s caller code (`candidates.length === 1` gate), not in `plan-type-stamp.ts`'s `distanceMatchesPlan` itself, which is a pure boolean band predicate. Both matcher implementations were actually executed (not hand-traced) against the 4 required scenarios: ambiguity (the two routes diverge — one silently picks the closer candidate, the other explicitly refuses), under-run (identical behavior — the floor was never touched by OVERRUN-MATCH-1), ordinary match (identical), 37% overrun (**diverge** — `watch/workouts/complete` fails to match the exact real-world Case 5.1 shape today; `ingest/workout` matches). Determined which shipping path reaches which matcher: `watch/workouts/complete` is called from the app's primary live-tracked-workout completion surfaces (belt/phone/watch/treadmill trackers) — the ceiling defect sits on the PRIMARY path, not a peripheral one. Judged **release-blocking execution-identity work** on that basis. One new open thread surfaced, not resolved: Case 5.1's own historical run has a `planWorkoutId` despite exceeding the watch route's ceiling by the same math — which mechanism actually stamped it is undetermined from the stored row (`[INFERENCE]`); v2's "matched via the wider band" overstated certainty here and is corrected.

## 6. Release sequencing fixed

v2 listed "ship a new TestFlight build" as release item 2, ahead of the P0 recovery-honesty fix. Corrected to an explicit sequence: integrate fixes (recovery-honesty field mismatch, pause-comment correction, matcher ceiling propagation, `NEVER_COPY` addition) → run the project's full gate suite → cut a release candidate → physically verify (§9's outstanding render, plus direct confirmation of the recovery-honesty and matcher fixes) → distribute. Shipping is now explicitly the LAST step, not item 2 of an unordered list.

## 7. Pause semantics separated into three questions

New §6.6a: a genuine manual-vs-automatic pause distinction exists in the watch app (`autoPauseEnabled`, speed-threshold-based, default-on) and is tracked in-app via a `pausedAutomatically` flag — but that flag is never transmitted to the server, so the distinction is unrecoverable for every historical row. A third automatic-pause signal (Apple Watch OS's own `.motionPaused`/`.motionResumed`) exists for HealthKit-imported activities specifically. Phone-GPS tracking has no auto-pause by explicit design. New §6.6b names the three separable decisions explicitly: (1) persist the raw fact — close to a pure bug fix; (2) display it — an undecided product/UX question; (3) use it in grading — a separate, undecided product/doctrine question with real evidence-policy stakes. **v2.1 explicitly does not recommend that pause automatically affect grading**; every recommendation in §6.7 and the transfer section now scopes the concrete fix to (1) only, with (2) and (3) named as open decisions requiring sign-off, not implied next steps.

## 8. Artifact provenance added

New §15. Base SHA `8559245496bf498d3d4b0479e1117ae416988c4a`; current `origin/main` at completion `99757c1204f27a1fa86504efd580842bc81c72b2`; v2.1 and delta-log file hashes below. **Not committed** — this pass found the shared working tree currently checked out on `audit/brain-forensic-2026-09-10`, a branch this session did not create, carrying 2 unpushed commits from a different, concurrent session's unrelated work. Committing to it, or switching the shared checkout to a different branch, risked disrupting that session's in-progress work, so this pass made no git-state changes — files were written directly, and the branch/commit decision is surfaced to you rather than made unilaterally.

---

**File hashes (SHA-256), computed after all v2.1 edits were finalized:**

- `docs/audit-2026-09-09-historical-data-forensic-audit-v2.1.md`: *(reported in the chat response, alongside this file's own hash and the final `git status`, to avoid a stale hash recorded before the last edit)*
- This delta log: *(same)*
