# Gate verification — reanchor-plan determinism, the spike-rule standing
# test, and a stale-doc sweep (2026-09-01)

Closes the three items `docs/reports/handback-2026-09-01.md` §8 flagged as
"still owed": an explicit determinism proof for `reanchor-plan` (not one
green pass), the deferred sub-five-mile spike-rule standing test, and a
sweep of docs still describing any of this as red/uncommitted.

All work below was run against the live shared checkout at commit
`e8d6c441` (HEAD at write time; several other agents committed to `main`
during this session — none of their changes touch anything cited here).
Per CLAUDE.md's shared-checkout discipline, files outside this task's scope
(`web-v2/lib/adaptation/*`, `capacity-resolver.ts`, `coach-goal.ts`,
`durability-anchor.ts`, `spec-card.ts`/`spec-builder.ts`/`expand-spec.ts`)
were left untouched throughout, including while they were visibly mid-edit
by other agents.

---

## 1 · `reanchor-plan` determinism proof

**Isolated, three consecutive runs, `web-v2/lib/plan/reanchor-plan.test.ts`
alone:**

| Run | Test Files | Tests | Result |
|---|---|---|---|
| 1 | 1 passed | 12 passed | identical |
| 2 | 1 passed | 12 passed | identical |
| 3 | 1 passed | 12 passed | identical |

A fourth run with `--reporter=verbose` confirmed the same 12 named cases
pass every time (`shouldReanchor` × 3, `shouldReanchorRacePrep` × 4,
`refreshedPaceAndSpec` × 5).

**As part of the full `lib/plan/` directory batch (133 test files, the
scope `reanchor-plan.test.ts` lives in), three consecutive runs:**

| Run | Test Files | Tests |
|---|---|---|
| 1 | 127 passed, 6 skipped (133) | 2031 passed, 8 skipped (2039) |
| 2 | 127 passed, 6 skipped (133) | 2031 passed, 8 skipped (2039) |
| 3 | 127 passed, 6 skipped (133) | 2031 passed, 8 skipped (2039) |

Byte-identical file and test counts across all three runs; `reanchor-plan`
never appeared in a `FAIL` line in any of them.

**Root cause of the original non-determinism, confirmed, not guessed:**
`docs/reports/brain-status-2026-08-31.md` recorded two different full-suite
results on two consecutive runs of "the same code" and named
`lib/plan/reanchor-plan.test.ts` as one of the files that failed
differently between the runs — but that report's own working tree was, by
its own admission, committed `main` **plus** a concurrent agent's ~1,700
uncommitted lines including `reanchor-plan.ts` itself mid-edit (confirmed:
`git status` at that audit time listed it as modified). That in-flight work
landed and was committed as `66a5fea5`. Re-run today against a tree where
`reanchor-plan.ts`/`reanchor-plan.test.ts` are both clean/committed, the
instability does not reproduce, in six total runs (three isolated, three
batched). The 2026-08-31 finding was correctly reported for what it was at
the time — a symptom of concurrent uncommitted edits in a shared checkout,
not a flaw in the test or the code — and is now stale as a live concern.

**Full-suite runs during this session did show real, ongoing drift** — but
in a disjoint set of files (`lib/training/lillian-sim.test.ts`,
`lib/training/vdot-goal-floor.test.ts`, `lib/audit/_coercion_scan.test.ts`,
`lib/audit/_swallow_scan.test.ts`, `lib/evidence/_activity_evidence.audit.test.ts`),
never `reanchor-plan`. Checked against `git status` at the time: every one
of those files (or a file it scans/ratchets against) was itself
uncommitted and actively being edited by another agent working in
`web-v2/lib/training/*` and `web-v2/lib/race/*` during this session — the
same shape as the original brain-status finding, on different files. Two
(`_coercion_scan`, `_swallow_scan`) are ratchet gates whose baseline
constant trails a live fix by definition until the fixing agent commits
and re-tightens it (this is Rule 18's ratchet working as designed, not a
bug). This is out of this task's scope (those files are on the explicit
do-not-touch list) and is noted here only to show it was investigated and
attributed correctly, not overlooked.

**Conclusion:** `reanchor-plan` is deterministic. Six consecutive runs (3
isolated + 3 batched) produced byte-identical results. No fix was needed;
the instability report that prompted this check traced to a different,
now-resolved cause (a concurrently-edited working tree), which this
document records so the next reader doesn't have to re-derive it.

---

## 2 · The sub-five-mile spike-rule standing test

CLAUDE.md Rule 9 cites this exact defect: `lib/plan/adapt.ts`'s overshoot
detector used to gate its baseline choice on `scheduledMi >= 5` — a real
cliff (40.0 mi baseline jump for 0.1 mi of scheduled volume, firing the
wrong direction: the plan that asked for more got the runner cut) — fixed
by asking the actual data-presence question (`scheduledDays > 0`) instead
of a mileage-magnitude proxy for it.

**Finding: the standing regression test already exists and is already
committed to `main`.** `web-v2/lib/plan/_overshoot_continuity.test.ts`
(`CONTINUOUS-OVERSHOOT-1`) landed in commit `6c024325`
(`fix(rule9): close the limiter volume finding and the overshoot baseline
cliffs`, 2026-08-30 18:16) — an ancestor of every commit referenced in this
task's brief, including `66a5fea5`. It walks `overshootBaseline`/
`overshootFires` across the boundary in 0.1 mi steps and asserts (a) the
baseline never jumps more than one step, (b) a plan that scheduled *more*
never lowers the bar, (c) firing never flips on from a hair more schedule,
and (d) a caller that can't state `scheduledDays` gets the byte-identical
legacy behavior. `grep` confirms `MEANINGFUL_SCHEDULE_MI`/`scheduledMi >=
5` has exactly one live call site in `lib/`, and it's the tested,
`scheduledDays`-gated one — no second, unguarded instance of the pattern
exists anywhere else in the engine.

The `docs/reports/handback-2026-09-01.md` brief that generated this task
listed this test as "still owed, in flight" as of 2026-09-01 — that
appears to be stale information relative to `main` (the test predates the
handback by a day); it is not a task this session needed to newly do, only
to verify.

**Independent falsification, per Rule 18 (not trusting the file's own
"falsified before landing" comment):**

1. Reverted the fix in `web-v2/lib/plan/adapt.ts` — replaced

   ```ts
   const usedSchedule = ctx.scheduledDays != null
     ? ctx.scheduledDays > 0 && scheduledMi != null
     : scheduledMi != null && scheduledMi >= MEANINGFUL_SCHEDULE_MI;
   ```

   with the pre-Rule-9 proxy:

   ```ts
   const usedSchedule = scheduledMi != null && scheduledMi >= MEANINGFUL_SCHEDULE_MI;
   ```

2. Ran `_overshoot_continuity.test.ts` against the reverted code. **Went
   red, reproducing the exact documented cliff:**
   - `overshoot baseline jumped 40.0 mi at 5.0 mi scheduled: expected 40 to
     be less than or equal to 0.1`
   - `bar FELL from 45.0 to 5.0 as the schedule reached 5 mi`
   - `overshoot STARTED firing as the schedule grew to 5 mi (completed 8
     mi) · the plan that asked for more got the cut`
   - `expected 45 to be 40` (chronic-floor case also broke)
   - 4 failed, 4 passed (8 total)
3. Restored `adapt.ts` from the pre-edit copy (`diff` against git confirmed
   byte-identical restoration — zero residual diff).
4. Re-ran `_overshoot_continuity.test.ts` plus its three sibling
   overshoot-context tests (`_adapt_invariants.test.ts`,
   `_overshoot_race_recency.test.ts`, `_overshoot_recovery.test.ts`):
   **4 files passed, 77/77 tests green.**

**Conclusion:** the fix is in place, the standing gate exists, is
committed, and was independently falsified-then-restored during this
session rather than taken on trust. No code or test change was required.

---

## 3 · Stale-doc sweep

Searched `docs/` (not just the files the task named) for language claiming
the doctrine gate is failing, the `4/658` figure, or the prescription
wiring as uncommitted/in-progress/not-yet-wired, post-`66a5fea5`. Every doc
below was corrected in place with an explicit `UPDATE 2026-09-01` note,
per the standing convention `docs/reports/status-and-answers-2026-08-31.md`
already used (David's own precedent for this style of correction) — the
original text is kept below each note, not rewritten, so the document
still shows what was found and when.

| Doc | Stale claim | Correction |
|---|---|---|
| `docs/PRODUCT_DECISIONS.md` §6 | "The phase-structure gate stays RED. Not loosened." | Fixed same night by `81bf30eb`, the exact remedy (a more robust input) the entry itself called for. `_coach_sensible.test.ts` re-verified 6/6 passing. |
| `docs/spikeroll-1-handback.md` | Title/status line: "HELD BACK... NOT landed on `main`" | Landed via `ecb5972c`. `enforceSpikeRule()` is live; the four protected keys named as the hold-back reason are all green, re-verified (`_sweep_allusers`, `_dosing_sweep_gate`, `_audit_long_ramp`, `_audit_periodization`, `_spike_rule_gate` — 564/564 combined). |
| `docs/reports/brain-status-2026-08-31.md` | "Test / gate health, right now" section: two-different-answers non-determinism, `_doctrine_gate.test.ts` failing, `reanchor-plan.test.ts` failing | Marked the whole section historical — traced to that audit's uncommitted working tree (per its own text), now committed as `66a5fea5`. Re-verified: `_doctrine_gate.test.ts` 651/651, `reanchor-plan` deterministic across 6 runs (§1 above). |
| `docs/reports/plan-generator-external-review-2026-08-31.md` | Finding 2, §4, and the gate-health table row: `_doctrine_gate.test.ts` "654/658 passed, 4 failed" | Fixed by `66a5fea5`. Re-verified 651/651 passed against current `main`, noted at all three locations (finding 2, §4 header, table row) since each is an independent jump target. |
| `docs/reports/workout-provenance-trace-2026-09-01.md` | "the working tree (uncommitted)... this row should move 439 → 430. It has not reached this row yet." | Landed as `66a5fea5`; `docs/reports/handback-2026-09-01.md` §3 confirms the row moved exactly as predicted, read live from production. |
| `docs/reports/handback-2026-09-01.md` §8 | "Still owed, in flight: [these three items]" | Marked landed, pointing back at this document. |

**Left alone, and why:**

- `docs/reports/status-and-answers-2026-08-31.md` — already corrected by
  David directly before this task started; not touched again.
- `docs/reports/to External/*` — an untracked export bundle (a frozen
  snapshot assembled for sending outside the repo, distinct from the
  living `docs/reports/` copies of the same filenames). Treated as a
  point-in-time delivery artifact, not a living reference; left as-is per
  CLAUDE.md's guidance to leave dated point-in-time reports as historical
  record rather than editing them in place.
- `docs/PRODUCT_DECISIONS.md` §1 (the earlier "not yet wired into the plan
  engine" VDOT-corpus entry) — a different, still-genuinely-open mechanism
  (`vdot-corpus.ts`-style per-pace-type readers), not the same wiring as
  `66a5fea5`. Left as an accurate, dated, in-progress entry.
- `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` — checked, no
  `_doctrine_gate` or `658` references; nothing stale found.
- `race-prediction-external-review-2026-08-31.md`,
  `workout-selection-external-review-2026-08-31.md`,
  `capacity-boundary-fix-2026-09-01.md` — checked, no matching stale
  claims found.

---

## 4 · What was NOT touched

Per this task's explicit scope fence, none of the following were edited,
even though several were visibly mid-edit by other agents in this same
shared checkout during this session: `web-v2/lib/adaptation/*`,
`web-v2/lib/training/normal-window.ts`, `web-v2/lib/training/
capacity-resolver.ts`, `web-v2/lib/coach/coach-goal.ts`,
`web-v2/lib/training/durability-anchor.ts`, `web-v2/lib/plan/spec-card.ts`,
`spec-builder.ts`, `expand-spec.ts`. `web-v2/lib/plan/adapt.ts` was
temporarily reverted for the Rule-18 falsification in §2 and restored to a
byte-identical state before any test or commit — confirmed via `git diff`
showing zero residual change.
