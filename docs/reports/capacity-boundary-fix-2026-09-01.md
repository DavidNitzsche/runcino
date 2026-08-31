# Capacity/goal boundary fix — 2026-09-01

Fixes the one live, confirmed doctrine violation named in
`docs/reports/brain-status-2026-08-31.md` (Contradiction risk item 2 /
Genuine open risk item 2): `goalRunFloorMiForUser` let the runner's stated
GOAL distance decide whether one of their own training runs was admissible
fitness evidence.

## The violating path (before)

`web-v2/lib/training/vdot-inputs.ts:789` — `goalRunFloorMiForUser(userId)`:

```ts
export async function goalRunFloorMiForUser(userId: string): Promise<number> {
  const row = (await pool.query<{ grd: string | null; ttd: string | null }>(
    `SELECT goal_race_distance AS grd, tt_goal_distance AS ttd
       FROM profile WHERE user_uuid = $1`,
    [userId],
  ).catch(() => ({ rows: [] as ... }))).rows[0];
  const code = (row?.grd && row.grd !== 'none') ? row.grd : row?.ttd;
  return vdotRunFloorMi(goalDistanceMiFromCode(code));
}
```

`vdotRunFloorMi(goalDistanceMi)` (`vdot.ts:707`, pre-fix):
`Math.min(4, Math.max(3, goalDistanceMi * 0.9))` — 5K goal → 3.0mi,
10K/Half/Marathon/unknown → 4.0mi.

This is the "honest-effort distance floor" a training run must clear to be
read as a VDOT candidate at all (`bestRecentVdot`'s `minRunDistanceMi`). Live,
wired call sites, all confirmed by `await goalRunFloorMiForUser(userId)` or
`vdotRunFloorMi(goalDistanceMiFromCode(...))` before this fix:

- `lib/plan/generate.ts:13847` (plan authoring)
- `lib/plan/drift-monitor.ts:498` (drift detection)
- `lib/plan/seed-from-onboarding.ts:845` (onboarding VDOT seed)
- `app/api/v5/race-authority/route.ts:123` (next-best-anchor fallback)
- `app/api/cron/snapshot-projections/route.ts:63` (daily VDOT/projection cron)
- `app/api/targets/projection/route.ts:328` (below-table projection)
- `app/api/coach/read/route.ts` (inherited via `loadVdotInputs`'s default arg)

The legitimate job it was doing: FLOOR-1 (2026-06-15) fixed a real bug where a
flat 4mi floor rejected every 5K-goal runner's ~3.1mi quality efforts, leaving
them with a mileage-fabricated VDOT instead of a measured one. The fix
(FLOOR-1) picked the wrong axis to key the relief on — the runner's *goal*
rather than the *effort's own length* — so it traded one bug for a doctrine
violation: the same 3.4-mile hard effort was admissible evidence for a
5K-goal runner and inadmissible for the identical runner, on the identical
day, after they changed their goal to a marathon.

`web-v2/lib/training/capacity-resolver.ts` (the new, still-shadow Runner
Model layer) had already independently identified and avoided this exact leak
— its own header (§3, "THE LEGACY VDOT FALLBACK") named
`goalRunFloorMiForUser` explicitly and passed a flat `CAPACITY_RUN_FLOOR_MI =
3.0` instead, arguing "admissibility is a property of the EFFORT, not of the
runner's ambition." That resolver was never itself in violation — it is
unwired/shadow (confirmed by the prior audit) and structurally goal-isolated
(compile-time-asserted 2-argument signature, `_capacity_resolver.test.ts`
§1). The violation was entirely in the OLD, LIVE engine's call sites above.

## The fix

Replaced the goal-keyed floor with the flat, evidence-only constant the new
Runner Model layer had already adopted and argued for:

`web-v2/lib/training/vdot.ts` — `vdotRunFloorMi(goalDistanceMi)` deleted;
replaced with:

```ts
export const EVIDENCE_RUN_FLOOR_MI = 3.0;
```

No parameter, no goal input, no DB read — a constant, matching
`capacity-resolver.ts`'s `CAPACITY_RUN_FLOOR_MI` value and reasoning
(kept as a separate constant in the lower-level file rather than importing
across the shadow/live boundary; flagged as a follow-up below).

`web-v2/lib/training/vdot-inputs.ts` — `goalRunFloorMiForUser` deleted
entirely (no more `profile.goal_race_distance` / `tt_goal_distance` read for
this purpose). `loadVdotInputs`'s default argument changed from
`await goalRunFloorMiForUser(userId)` to `EVIDENCE_RUN_FLOOR_MI`.

All 6 live call sites updated to pass `EVIDENCE_RUN_FLOOR_MI` explicitly
(or rely on `loadVdotInputs`'s new default, for the one site — `coach/read`
— that already omitted the argument): `generate.ts`, `drift-monitor.ts`,
`seed-from-onboarding.ts`, `race-authority/route.ts`,
`snapshot-projections/route.ts`, `targets/projection/route.ts`. The
"projection cron, drift monitor, and plan generator must all gate
identically" property `goalRunFloorMiForUser`'s own doc comment cared about
is preserved — they now all resolve to the same flat constant instead of
all resolving to the same (goal-keyed) function call.

Legitimate filtering preserved: `passesRunHonestyGate`'s HR/quality-label
gate and `bestRecentVdot`'s corpus-corroboration ceiling are untouched — a
short brisk jog still doesn't qualify, and a single training read still can't
outrun what other sessions corroborate. Only the *goal* input is gone; a
half/marathon-goal runner's 3.0–3.9mi hard efforts are now admissible at the
fallback tier where the live engine used to exclude them (the same cost the
new resolver's header already argued was acceptable).

## The falsifying test

`web-v2/lib/training/_goal_floor_isolation.test.ts` (new, committed) asserts
the fixed behavior: for an identical runner, identical training history (one
honest 3.4-mile tempo effort), and an extreme goal swap (5K vs. marathon),
the resolved floor, admissibility, VDOT value, evidence id and considered-set
are all identical.

**Falsified against the pre-fix code first, per Rule 18.** Before applying
any fix, a temporary falsifier (`_PREFIX_falsifier_tmp.test.ts`, using the
original `vdotRunFloorMi(goalDistanceMiFromCode(...))` API, not committed —
deleted after use) was run against the unmodified `vdot.ts`:

```
FAIL  vdotRunFloorMi returns a DIFFERENT floor for a 5K goal vs a marathon goal
  AssertionError: expected 3 to be 4
FAIL  the SAME 3.4mi hard effort is admissible under a 5K goal and INADMISSIBLE under a marathon goal
  AssertionError: expected true to be false
```

Confirmed the violation was real and observable, not just a theoretical
reading of the code. The 13 changed files were reverted to `HEAD` via
targeted `git checkout --` (not `git stash`, to avoid sweeping up other
sessions' concurrent uncommitted work in this shared checkout — confirmed via
`git status` that unrelated files, e.g. `lib/plan/goal-gap.ts`,
`lib/plan/progression-spec.ts`, `lib/race/coach-goal*.ts`, were being edited
by another agent throughout and were never touched by this fix), the
falsifier ran red as shown above, then the fix was re-applied from a saved
patch and the real test file (`_goal_floor_isolation.test.ts`, targeting the
post-fix API) was run and passed:

```
Test Files  1 passed (1)
     Tests  3 passed (3)
```

## Verification run

- `npx tsc --noEmit` — clean (one pre-existing, unrelated error in
  `lib/race/coach-goal-durability.test.ts` from another session's concurrent
  work; not touched by this fix).
- `npx vitest run lib/training/` — **53 files / 749 tests passed**, including
  the falsifying test, `_capacity_resolver.test.ts` (all 4 doctrine
  invariants), `vdot-goal-floor.test.ts` and `lillian-sim.test.ts` (both
  updated to the new evidence-only API — their real-data assertions about
  Justin's and Lillian's actual runs are unchanged, only the goal-framing
  language and the way the floor is obtained changed).
- `npx vitest run` targeted at every test file that imports `loadVdotInputs`
  (`_race_authority_durability.test.ts`, `_vdot_inputs_provisional.test.ts`,
  `vdot-inputs-window.test.ts`, `_vdot_corpus_anchor.test.ts`) — all pass.
- Grepped the full `web-v2` tree for any remaining reference to
  `goalRunFloorMiForUser` or a goal-parameterized `vdotRunFloorMi(` call —
  none found; all remaining hits are doc comments explaining the fix.

## Files changed

- `web-v2/lib/training/vdot.ts` — `EVIDENCE_RUN_FLOOR_MI` constant replaces
  `vdotRunFloorMi(goalDistanceMi)`; stale doc comments on `goalDistanceMiFromCode`,
  `vdotFromRun`'s `minDistanceMi`, and `bestRecentVdot`'s `minRunDistanceMi`
  updated.
- `web-v2/lib/training/vdot-inputs.ts` — `goalRunFloorMiForUser` deleted;
  `loadVdotInputs`'s default floor is now the constant.
- `web-v2/lib/training/capacity-resolver.ts` — header comments updated to
  reflect the live engine now matching the shadow layer's already-correct
  behavior (no functional change — this file was never in violation).
- `web-v2/lib/plan/generate.ts`, `drift-monitor.ts`, `seed-from-onboarding.ts`
  — call sites updated.
- `web-v2/app/api/v5/race-authority/route.ts`,
  `app/api/cron/snapshot-projections/route.ts`,
  `app/api/targets/projection/route.ts`, `app/api/coach/read/route.ts` —
  call sites / comments updated.
- `web-v2/lib/training/_capacity_resolver.test.ts`,
  `vdot-goal-floor.test.ts`, `lillian-sim.test.ts` — updated to the new API
  and framing; no assertions about real data weakened.
- `web-v2/lib/training/_goal_floor_isolation.test.ts` — new, the falsifying
  test described above.

## Out of scope — flagged, not fixed

- **`CAPACITY_RUN_FLOOR_MI` (capacity-resolver.ts) and `EVIDENCE_RUN_FLOOR_MI`
  (vdot.ts) are now two separately-declared constants that happen to hold the
  same value (3.0) for the same reason.** Rule 16 ("one quantity, one name")
  would prefer one canonical export. Left as two because unifying them means
  either the shadow Runner Model layer importing from the old VDOT module (it
  already does, for other things) or the reverse — a real but small
  architectural call, not needed to close the violation, and safer left to
  whoever owns the wiring-phase migration named in `capacity-resolver.ts`'s
  own header.
- **The follow-up `capacity-resolver.ts` already names in its own header**:
  "the right long-term answer is a floor keyed to the distances this runner
  has actually RACED — a runner-model question, answerable without the
  goal." Not attempted here; this fix closes the goal leak, it doesn't build
  the better long-term floor.
- **Contradiction risk item 1 from the prior audit** (pace prescription vs.
  `generate.ts`'s goal-blended cascade, once the in-flight
  `recompute-paces.ts` wiring lands) is unrelated to this fix and was not
  touched — still open, per the prior report.
- Two files unrelated to this fix were seen mid-edit by another concurrent
  session throughout this work (`web-v2/lib/plan/goal-gap.ts`,
  `web-v2/lib/plan/progression-spec.ts`, `web-v2/lib/race/coach-goal*.ts`,
  `web-v2/app/api/cron/plan-drift/route.ts`, a new
  `web-v2/lib/training/coaching-thesis.ts`) — noted for the record, not
  touched, not this fix's to judge.
