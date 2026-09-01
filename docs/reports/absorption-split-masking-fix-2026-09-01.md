# MASKING-1 · the total-evidence-masking risk in `representative_execution`, fixed

**Date:** 2026-09-01 · **Status:** fix landed and verified against the real
account and the real synthetic fixtures. Shadow-mode only —
`readAdaptationSplit`'s outputs are still not promoted into any live path;
this task does not authorize promoting them.

`docs/reports/absorption-dual-log-2026-09-01.md` §7.2 named a real risk and
did not fix it: a synthetic edge case where `representative_execution` could
be MORE PERMISSIVE than `actual_load_absorption` — never observed on the
owner's real 90-date season history, but flagged as worth fixing before any
promotion. This report finds the exact mechanism, falsifies it against the
pre-fix code, fixes it structurally in `web-v2/lib/adaptation/load.ts`, and
confirms the real account's history is unchanged.

---

## 1 · The mechanism, precisely

`representative_execution` (`loadRepresentativeExecutionInput` in
`web-v2/lib/adaptation/load.ts`) is the Rule-8-filtered twin of
`actual_load_absorption`. It reuses the unfiltered `loadAdaptationInput` for
every dimension except `execution`, and for that one dimension it re-reads
`keySessionExecutions`/`targetVerdicts` over a widened window
(`representativeLookback`) and drops every row landing on a prescribed
taper/race/recovery day (`isPrescribedNonNormal`, via
`filterExecutionEvidenceByPrescribedWindow`).

The bug lived entirely in that one function. Before the fix:

```ts
const executions = keySessionRows
  .filter((s) => s.readable && s.read != null && !isPrescribedNonNormal(s.dateISO, windows))
  .map(...)
```

Every row landing inside a prescribed window was dropped, unconditionally —
**including rows that were themselves negative evidence** (a genuine `MISSED`
session). When a window's readable rows were ENTIRELY inside a prescribed
block (fixture 3d: four `MISSED` sessions, all inside the AFC taper+recovery
window), the filter erased all four, leaving `keySessionExecutions: null`.
`adaptation-model.ts`'s `readExecution` then returned `score: null` for
`execution`. With too few dimensions left known
(`MIN_DIMENSIONS_FOR_VERDICT = 2`), `classifyAdaptation` fell through to its
Rule-11 safety net:

```ts
if (known.length < MIN_DIMENSIONS_FOR_VERDICT) {
  return {
    band: 'normal',
    confidence: 'low',
    decision: 'PROGRESS',
    ...
    summary: 'Not enough training evidence yet to read how you are absorbing the work. Proceeding as planned.',
  };
}
```

That default exists for a runner this reader truly **cannot see** — a
brand-new account, a reader that failed to load. It is the wrong answer for a
runner whose every visible session in the window **was measured, and was a
real shortfall**, and just happened to also land on a prescribed day. The
unfiltered `actual_load_absorption` read the same four `MISSED` sessions
honestly and scored `poor/MODIFY`. The filtered reader, meant to be a
*stricter, more honest* read of capability, ended up *more permissive* than
the read it was supposed to improve on — `normal/PROGRESS`, licensing a
progression step the runner had done nothing to earn.

**Why this is not the same failure mode as removing dilutive evidence.** The
prior report (`absorption-reader-split-2026-09-01.md` §3.1) documents the
filter working as designed: diluting a real shortfall with 11 clean pre-taper
days makes the unfiltered window read `normal` when the truth is worse, and
filtering correctly recovers the honest, harsher read. MASKING-1 is a
different shape entirely — not "the filter recovered a truth the average was
hiding," but "the filter deleted the ONLY evidence there was, of EITHER kind,
and a downstream safety net built for silence answered as if there had been
none." The task's working hypothesis was exactly right: removing a genuinely
bad session that happened to fall inside a filtered-out window deletes
**negative** evidence, not just **total** evidence — and Rule 8's exclusion
was never supposed to reach that far.

---

## 2 · The distinction the fix rests on

Rule 8 says a prescribed day must not be used to **prove** a runner's normal
capability — a good session during taper does not show the runner can handle
full load, and crediting it would inflate a "can this runner progress" read
on evidence that was never asked to carry that weight. Rule 8's corollary
(same file) is explicit that the injury/tissue-load-type readers must stay
literal; `representative_execution` is deliberately the CAN-DO reader, so
excluding a good taper day from the capability pool is exactly correct.

Rule 8 does **not** say a genuine failure on that same day is excused from
counting against progression. A session that went badly is still evidence
against progression, and the calendar it fell on does not launder that away.

Those are two different operations, and the pre-fix code only had one lever
to express both with:

- **Exclude a day from the pool that CORROBORATES readiness** — correct for
  Rule 8, and the entire reason this reader exists.
- **Exclude a day's NEGATIVE signal from ever being counted** — never Rule
  8's intent, and the actual bug.

The fix performs only the first operation, with one exception: when applying
it would erase **every** readable row a window holds, the rows about to be
erased are inspected, and any that are themselves negative evidence survive.
Positive-valence rows are **never** rescued this way, taper day or not — the
fix only ever pulls evidence back in on the side that makes the read more
conservative, never the side that would let a good taper session inflate it.
That asymmetry is deliberate: it is the reason the fix cannot become a second
way to over-credit a taper block.

**"Negative" was calibrated to what the execution dimension itself already
treats as depressing the score**, not literally reused from
`lib/execution/interpret.ts`'s finer-grained `evidence.adaptation` taxonomy
(which serves a different question — whether a session earns *progression
credit*, not whether it constitutes a *measured shortfall*). Concretely:

- **`MISSED`** — `stimulusCompletion: 0`, the most negative reading the
  completion scale has. Its own per-session `evidence.adaptation` is
  `'unknown'` (interpret.ts genuinely doesn't know *why* nothing happened),
  but that "why" question is orthogonal to whether the session is a measured
  zero. Rule 11 distinguishes "we don't know" (no row exists) from "we know,
  and it's zero" (a row exists reading `MISSED`) — a `MISSED` row is the
  second, and erasing it collapses that exact distinction the rule exists to
  hold apart.
- **`PARTIAL_FAILED`** — `interpret.ts` marks this state
  `evidence.adaptation: 'negative'` explicitly ("stopping cooked is evidence
  the prescription was at or above capacity that day").
- **Preserved as positive, never rescued**: `AS_PLANNED`, `EQUIVALENT`,
  `PARTIAL_PRODUCTIVE` (all `earnsProgressionCredit`-eligible), `REPLACED` (a
  race — good fitness evidence, not a failure), `EXTRA`.
- **Target verdicts**: `'slow'` (missed the assigned pace) is preserved on
  total washout; `'on'`/`'fast'` are not — `'fast'` is explicitly "not a win"
  per doctrine but is not negative capability evidence either, so it stays
  excluded like `'on'`.

---

## 3 · The fix

`web-v2/lib/adaptation/load.ts`:

```ts
function isNegativeKeySessionSignal(read: RawExecutionRow['read']): boolean {
  return read != null && (read.state === 'MISSED' || read.state === 'PARTIAL_FAILED');
}
function isNegativeVerdictSignal(row: RawVerdictRow): boolean {
  return row.verdict === 'slow';
}

function applyRepresentativeWindow<T>(
  readableRows: readonly T[],
  isExcluded: (row: T) => boolean,
  isNegative: (row: T) => boolean,
): T[] {
  const representative = readableRows.filter((r) => !isExcluded(r));
  if (representative.length > 0) return representative;
  return readableRows.filter(isNegative);
}
```

`filterExecutionEvidenceByPrescribedWindow` now routes both the key-session
and target-verdict selections through `applyRepresentativeWindow`. The
fallback only ever fires on **total** washout — the instant any row survives
the plain exclusion, that surviving set is used unchanged and the fallback
never runs. This is what keeps the primary, well-verified mechanism (fixture
3a: a taper/recovery block correctly dropping OUT of a read that also has
real clean evidence outside the window) completely untouched — confirmed
below.

**Rule 16 follow-through.** `buildAdaptationComparisonRecord`'s
observation-selection helpers (`selectExecutionObservations`,
`selectVerdictObservations` — used only by the shadow-comparison log's
"which reader kept this row" reporting, not by the verdicts themselves) were
a *second*, independent restatement of the window-exclusion logic. Left
alone, they would have kept reporting the pre-fix selection after the
verdict-producing code was fixed — the log would silently start lying about
which rows `representative_execution` actually used. Both were updated to
call the same `applyRepresentativeWindow` helper, so there is one definition
of "did `representative_execution` keep this row," not two that can drift.

**Fidelity fix in the report-support scripts.** Both
`_shadow_run_absorption_split.script.ts` and
`_season_sweep_absorption_duration.script.ts` had their own *third*
reimplementation of the filter (`sessions.filter((s) =>
!isPrescribedNonNormal(...))`) for the synthetic fixtures, instead of calling
the real exported `filterExecutionEvidenceByPrescribedWindow`. That local
copy could not reflect this fix (or any future one), and it also built the
filtered `AdaptationInput` by recomputing `distinctEvidenceWeeks` from the
*filtered* session list — which is not what production does.
`loadRepresentativeExecutionInput` only overrides
`keySessionExecutions`/`keySessionsPlanned`/`keySessionsCompleted`/
`targetVerdicts`; `distinctEvidenceWeeks` (trend) and every other dimension
carry through **unchanged** from the unfiltered base
(`{ ...base, ...filtered }`). The scripts' own trend-goes-null-in-lockstep
behavior was an artifact of the fixture harness, not something the real
loader does — fixed so both scripts now call the real production function and
build the filtered input the same way the real loader does.

---

## 4 · Falsification (Rule 18) — before and after

Added to `web-v2/lib/adaptation/_absorption_split.test.ts`, run against the
pre-fix code first:

```
 FAIL  MASKING-1: a fully-masked window whose only evidence is real failures keeps that evidence, never nulls it
 FAIL  MASKING-1 applies to target verdicts too: a fully-masked window of real "slow" misses keeps them
 FAIL  MASKING-1 falsifier: a fully-masked window of real failures must not flip the decision toward MORE permission
   AssertionError: expected 'PROGRESS' not to be 'PROGRESS'
 Tests  3 failed | 10 passed (13)
```

The 10 pre-existing tests passing confirmed the risk was narrow before I
touched anything — including the corollary test (added alongside the
falsifiers) proving fixture-3a-shaped scenarios were never at risk. After the
fix, all 13 pass:

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### The real production classifier, not a hand-picked verdict

Through the actual exported `filterExecutionEvidenceByPrescribedWindow` and
the real `classifyAdaptation`, fixture 3d (four `MISSED` sessions, entirely
inside the AFC window):

| | before | after |
|---|---|---|
| unfiltered (`actual_load_absorption`) | `poor/MODIFY` execution=−2.00 | `poor/MODIFY` execution=−2.00 (unchanged) |
| filtered (`representative_execution`) | **`normal/PROGRESS`** execution=**null** — "Not enough training evidence yet... Proceeding as planned." | **`poor/MODIFY`** execution=**−2.00** — "0 of 4 key sessions delivered the full stimulus · 4 not run." **Identical to unfiltered.** |

Fixture 3e (Big Sur + Sombrero compound window, both races' windows applied —
the shape that erased even the two `AS_PLANNED` sessions along with the three
`MISSED` ones):

| | before | after |
|---|---|---|
| unfiltered | `marginal/STAY` execution=−1.00 | `marginal/STAY` execution=−1.00 (unchanged) |
| filtered | **`normal/PROGRESS`** execution=null | **`poor/MODIFY`** execution=**−2.00** — "0 of 3 key sessions delivered the full stimulus · 3 not run." **Stricter than unfiltered**, not just no-longer-permissive — because the two rescued `AS_PLANNED` rows are correctly excluded (positive evidence, never rescued) while the three `MISSED` rows are correctly kept. |

Fixture 3a (David's AFC shape — 5 clean sessions before the race, 3 `MISSED`
inside the taper+recovery window), re-run through the real production path
end to end, **unaffected**, exactly as the corollary test predicted:

```
--- 3a taper+recovery masking   (no change) ---
  unfiltered: normal/PROGRESS execution=0.13 :: Training is landing about as expected.
  filtered:   normal/PROGRESS execution=2.00 :: Recent sessions look good, but it is not yet enough weeks to call it a trend.
```

Identical numbers before and after the fix, because 5 real rows survive the
plain exclusion — the fallback never fires. The primary mechanism this reader
exists for is completely intact.

---

## 5 · Confirmation: the real 90-date history is unchanged

Re-ran, against production (read-only role), the exact real-account
sequences the two prior reports built their numbers from:

**`_shadow_run_absorption_split.script.ts`'s 7-date real-account replay** —
byte-identical to `absorption-reader-split-2026-09-01.md` §3, including the
one real disagreement (2026-08-20: `normal/PROGRESS` unfiltered →
`marginal/STAY` filtered, same direction, same numbers) and all four Rule-9
boundary walks (Big Sur taper-open/recovery-close, AFC taper-open/recovery-close)
— every score identical to the pre-fix numbers already on record.

**`_season_sweep_absorption_duration.script.ts`'s AFC recovery-interior daily
walk (2026-08-13 → 2026-08-24)**, through the comparison-log code path
(`buildAdaptationComparisonRecord`, whose observation-selection helpers I
also touched) — reproduces `absorption-dual-log-2026-09-01.md` §5.1's table
exactly: the 8-day disagreement episode 2026-08-16 → 2026-08-23,
`decisiveLimiter=representative_execution` every day, `excluded=3-4,
reached-back=4-6` matching the report's own quoted counts, and clean
agreement on 08-13/14/15 and 08-24. No new disagreement, no changed count, no
different verdict anywhere in the window.

This is the expected result, not a coincidence: MASKING-1's fallback fires
only on **total** washout of a window's readable rows, and per
`absorption-dual-log-2026-09-01.md` §7.2, that shape "did not fire once
across 90 real dates this season" — `representativeLookback`'s widening
mechanism always found *some* real evidence to fall back on for this account.
The fix cannot change a code path that was never reached on real data; it
only changes what happens on the path that fixtures 3d/3e reach and the real
account, so far, never has.

**New JSONL evidence**: the AFC daily-walk re-run appended 12 new comparison
records to the git-tracked
`docs/reports/adaptation-shadow-log/0645f40c-951d-4ccc-b86e-9979cd26c795.absorption-duration.jsonl`
(this task's own verification output — committed alongside the fix). A
concurrent session's unrelated growth to the sibling PACE-lever
`...9979cd26c795.jsonl` file was present in `git status` before this task
started and is **not** part of this change; not staged.

---

## 6 · Verification

- `tsc --noEmit`: clean.
- `npx vitest run lib/adaptation/_absorption_split.test.ts`: 13/13 pass
  (falsified first against the pre-fix code — §4).
- `npx vitest run lib/adaptation lib/plan/_progression_pass.test.ts lib/training/normal-window`:
  176/176 pass, 8 test files — no regression anywhere in the split, the
  classifier, the progression pass, or `normal-window.ts`.
- `npx vitest run --config vitest.shadow-run.config.ts lib/adaptation/_shadow_run_absorption_split.script.ts`:
  10/10 pass, real production DB, read-only role — full output quoted in §4/§5.
- `npx vitest run --config vitest.shadow-run.config.ts lib/adaptation/_season_sweep_absorption_duration.script.ts -t "AFC recovery-interior"`:
  1/1 pass (the other 12 tests in that file were intentionally not re-run in
  full — the whole-season weekly sweep and all-six-races boundary walk are
  each 10-40+ real DB round trips and were not needed to answer this task's
  specific question; the AFC window is the one place real disagreement has
  ever existed, and it was walked at full daily resolution against the code
  path this fix touches).

## 7 · What was not done

- Nothing promoted. `readAdaptation` (the live call) is untouched;
  `representative_execution` is still reachable only through
  `readAdaptationSplit`/`readAdaptationSplitWithLog`, called only by these
  scripts and their tests.
- `adaptation-engine.ts`, `shadow-compare.ts`, `generate.ts` — not touched,
  per this task's scope.
- The full whole-season weekly sweep and the boundary walks for the other
  five real races were not re-run end to end (§6) — the targeted re-runs in
  §5 answer the specific question this task asked (does MASKING-1 change
  anything on real history) without re-spending the DB cost of the full
  sweep the prior report already ran once.
- The `internal_cost`/`consistency`/`recovery`/`trend` dimensions' own Rule 8
  status, and whether a DURATION progression opportunity actually existed in
  the live plan for the AFC episode — both still open per the prior report,
  not reopened here; out of this task's scope.
