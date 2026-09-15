# F057 — the remaining four sentences (#1, #4, #8, #9), implemented (2026-09-15)

**Source**: `for coaching consult/consult-log/2026-09-15-028-f057-remaining-four-sentences.md`
(coach consultant's full diagnosis + proposed copy for items never in U4's
scope). Implemented against **current `origin/main`** (`a1eab3a9b`, "merge:
F110 (pace-bail starvation fix) + F124 (treadmill takeover refusal)"), in a
fresh branch off that commit (`f057-remaining-four-sentences`) inside this
worktree — the worktree's own checked-out branch predates `web-v2` entirely,
so `origin/main` had to be pulled in explicitly to get the target files at
all.

**Not committed, not pushed, not merged** — left as uncommitted changes in
the worktree per instructions, for a separate process to review and land.

**Files touched**:
- `web-v2/lib/postrun/experience.ts` — items #1, #4, #8, #9
- `web-v2/lib/postrun/load.ts` — item #8 (thread `workHrCeilingSource`)
- `web-v2/lib/prescription/hr-ceiling.ts` — item #8 (the actual resolution site)
- `web-v2/lib/postrun/_experience.test.ts` — updated + new tests, all 4 items
- `web-v2/lib/postrun/_tension_direction_and_voice.test.ts` — updated for #4

---

## #1 — "Mixed set" headline

**Location matched the log exactly**: `experience.ts`, headline literal at
line 1148, `input.raceMatched` already read one line above at 924 (both
unchanged from the log's citation).

**Implemented exactly as proposed**:
```ts
headline: input.raceMatched ? 'How the race broke down' : 'Mixed set',
```

**Tests added** (`F057-#1` describe block in `_experience.test.ts`), built on
the real Santa Monica fixture (`santaMonicaVerdict()`, which produces this
exact `uneven`/`PARTIAL_PRODUCTIVE` fallback once the target is valid):
- a race gets `'How the race broke down'`, never `'Mixed set'`.
- FALSIFIER: the identical uneven shape with `raceMatched: false` still gets
  `'Mixed set'` — proves the branch is real, not vacuous.

No copy/logic disagreement with the log here — this was the cleanest of the
four.

---

## #4 — outperformance-framing bug (`observation_stronger_than_belief`)

**Location drifted slightly**: the log cited line 1789; current source has
`beliefWord`/`directionClause` at lines 1792–1795 (before edits) — a ~3-line
shift from unrelated work landing on `main` since the log was written.
Confirmed the diagnosis against `readBeliefTension` in
`lib/evidence/activity-evidence.ts`: the `stronger` arm fires whenever
`observedPace <= believed + marginSec` (up to `BELIEF_MATCH_MARGIN_PCT`
slower, not only faster) — exactly as the log traced.

**Implemented the log's proposed replacement, with one change**: the log's
copy used an em dash (`"...predicts — it didn't cost more..."`). Coach voice
forbids em dashes in runner-facing copy (`scripts/check-coach-voice.sh`,
guard 3 — "the house punctuation is the middot (·) for a break and a full
stop for a sentence"). Split it into two sentences instead:

```ts
? `This deep into the session, your effort still matched what your current ${beliefWord} predicts. It didn't cost more than your fitness says it should.`
```

Note: `experience.ts` is not currently inside `check-coach-voice.sh`'s scanned
scope (only `web-v2/lib/faff`, `lib/coach`, `lib/plan`, etc. are — see the
script's own `targets()` function), so the gate would not have caught this
either way. Fixed it anyway since it's still runner-facing copy and the
project's house style applies regardless of gate coverage; flagging the scope
gap separately as worth a future `check-coach-voice.sh` widening (not done
here — out of scope for this task, and doing it risked surfacing unrelated
pre-existing violations in files never audited).

**Tests updated** (existing coverage, corrected rather than added net-new):
- `_tension_direction_and_voice.test.ts`'s `STRONGER` case — updated the
  exact expected string to the corrected wording.
- `_experience.test.ts`'s Rule 21 `CHALLENGES` test — was asserting
  `toContain('deeper into the session')` (the buggy wording); updated to
  assert the corrected substring.

---

## #8 — suppressed HR verdict for race rows (the open question, now resolved)

**This is where the real work was**, and where the log's own diagnosis
needed a real correction, not just a location confirmation.

### What the log got right
`readCost` (`experience.ts`) resolves `ceiling` purely from
`input.workHrCeilingBpm` / `input.overallHrCeilingBpm`, and `overallHrCeiling`
(then in `lib/prescription/hr-ceiling.ts`, confirmed as the real owner) reads
`hr_cap_bpm` only — which `spec-builder.ts`'s `case 'race'` sets to `null` on
purpose. The log's overall diagnosis (a missing fallback SOURCE, not a
missing measurement) was correct, and it correctly flagged that it had not
traced the actual resolution site.

### What the log got wrong (the disclosed open question)
The log guessed the fix belonged in `overallHrCeiling` alone. **It does not,
by itself, fix the real case.** Traced `readCost`'s scope selection:

```ts
const hasWork = input.verdict.work.count > 0;
const scope = hr == null ? null : hasWork ? 'work' : 'overall';
const ceiling = scope === 'work' ? input.workHrCeilingBpm : ... overallHrCeilingBpm ...
```

`work.count` comes from `gradeStoredPhases` counting phases typed `'work'` —
and the real Santa Monica 10K row (`_experience.test.ts`'s own
`santaMonicaVerdict()`, built from the actual recorded phases) has
**`work.count === 2`** (its two real graded race segments, "Miles 1-2" /
"Miles 3-6.2"). That makes `hasWork` **true**, so `readCost` resolves scope
**`'work'`**, reading `workHrCeilingBpm` — not `overallHrCeilingBpm` at all.
A fix aimed only at `overallHrCeiling` would never reach this run.

And `workHrCeiling()` has the identical gap: it only reads a `pass`/`hr`/
`<=`/`work` rule from `spec.rules`, and `spec-builder.ts`'s `case 'race'`
never authors one (only `threshold`/`tempo`/`intervals`/`race_week_tuneup`
do). So **both** ceiling functions returned `null` for every race, regardless
of which scope a given race's phase typing produced.

### The actual fix
Traced the real band source: `spec-builder.ts`'s `case 'race'` comment names
it directly — `lib/race/race-row-refresh.ts` writes `workout_spec.race_hr`
onto every race row, right after authoring and on every recompute
(`lib/race/race-hr-guidance.ts` computes it). Its shape, confirmed against
that file and its own test suite (`_hr_ownership.test.ts`,
`_race_outlook_contract.test.ts`):

```
race_hr.expected_range_bpm: [lo, hi]   // doctrine's %LTHR band for the distance
race_hr.late_allowance_bpm             // expected_range_bpm[1] + drift allowance
race_hr.checkpoint_abort_bpm           // the hard mid-race abort trigger
```

This matches the log's cited "[168,176] band, 179 abort" shape closely
(`expected_range_bpm` = the band, `checkpoint_abort_bpm` ≈ the abort).

Added a shared helper `raceHrBandUpperBound()` in `hr-ceiling.ts` and wired
the fallback into **both** `workHrCeiling()` and `overallHrCeiling()` — since
which scope a real race actually resolves to depends on its phase typing, and
the band is genuinely a whole-race-effort quantity that pairs honestly with
either. A real `hr_cap_bpm` / pass rule always wins over the band when both
exist. Threaded a new `workHrCeilingSource` field alongside the existing
`overallHrCeilingSource` through `PostRunInput` (`experience.ts`) and
`load.ts`'s `overallCeiling`/`workCeiling` resolution, and `readCost` now
checks whichever scope it actually resolved:

```ts
const fromRaceBand = scope === 'work' ? input.workHrCeilingSource === 'race_hr_expected_range_upper'
  : scope === 'overall' ? input.overallHrCeilingSource === 'race_hr_expected_range_upper'
  : false;
```

**Copy for the fallback-and-inside-it case** — used the log's exact proposed
wording, mirroring the existing `EXPECTED` branch's own wording exactly as
instructed:
```
`${word} averaged ${hr} against a ${ceiling} ceiling from the session, inside it the whole way.`
```
No new copy for the over-ceiling case, as the log specified — the existing
`HIGHER_EXPLAINED`/`HIGHER_UNEXPLAINED` branches now simply receive a real
ceiling number for a race and behave correctly unchanged.

### Tests added (`F057-#8` describe block)
- `workHrCeiling`/`overallHrCeiling` unit tests: band fallback fires on both
  scopes; a genuine `hr_cap_bpm` / pass rule always wins; FALSIFIER — no
  `hr_cap_bpm`/pass-rule and no band still returns `null` on both scopes.
- **"THE REAL SANTA MONICA SHAPE"** — `readCost` against `santaMonicaVerdict()`
  confirms scope resolves `'work'` (not `'overall'`) and the fallback reaches
  it there, with the exact expected summary string.
- FALSIFIER — the identical reading/ceiling from a genuine pass rule reads
  the plain (unchanged) sentence, proving the new wording is gated on source,
  not on the numbers alone.
- A second test covers the `'overall'`-scope fallback directly, for a race
  graded with no `'work'`-typed phase at all (an edge case the Santa Monica
  shape doesn't exercise, since its real data happens to resolve `'work'`).

**Disclosure, as instructed**: the consult log's exact mechanism (fix
`overallHrCeiling` alone) does not fit the real shape — the actual, more
open-ended tracing needed to also touch `workHrCeiling` and add a second
source field. Implemented what the real code requires; flagged here rather
than forcing the log's narrower mechanism onto a shape it doesn't cover.

---

## #9 — contradicting-confidence bug (`certaintyFor`)

**Location drifted slightly**: log cited lines 2038–2043; current source has
the function at lines 2081–2075 (before the fix) — same small drift pattern
as #4, unrelated intervening commits. Confirmed `explanation.ts`'s own header
("`certainty` IS SUPPLIED, NOT DERIVED") and the sibling `NEW_ANCHOR_CANDIDATE`
role check at `experience.ts` (readEvidenceImpact's own `ev.anchorMoveCandidate`
branch) exactly as the log traced.

**Implemented exactly as proposed**:
```ts
function certaintyFor(execution: PostRunExecution, evidence: PostRunEvidenceImpact): Certainty {
  if (evidence.role === 'UNREAD') return 'UNKNOWN';
  if (execution.status === 'INDETERMINATE' || execution.status === 'SENSOR_LIMITED') return 'UNKNOWN';
  if (evidence.role === 'NEW_ANCHOR_CANDIDATE') return 'SUPPORTED';
  if (execution.confidence === 'HIGH') return 'SUPPORTED';
  return 'TENTATIVE';
}
```
No changes needed in `explanation.ts` itself, as the log predicted — it only
renders whatever `certainty` it's handed.

**Tests added** (`F057-#9` describe block), using the Santa Monica valid-target
fixture (which has `execution.confidence === 'MODERATE'`, not `'HIGH'` — the
exact condition that exposed the bug, since pre-fix only `'HIGH'` could reach
`SUPPORTED`):
- `anchorMoveCandidate: true` + non-`HIGH` confidence → `certainty: 'SUPPORTED'`,
  and the false hedge ("This is one session, so treat it as a lead rather
  than a conclusion.") is absent from `layerTwo(out.briefing)`.
- FALSIFIER: the identical non-`HIGH`-confidence run with
  `anchorMoveCandidate: false` still reads `'TENTATIVE'` with the hedge
  present — proves the fix is gated on the real flag, not a blanket upgrade.

---

## Verification

**`npx tsc --noEmit`** (in `web-v2/`, after `npm ci` since this worktree had
no `node_modules`): **clean, zero errors.**

**`bash scripts/check-coach-voice.sh`**: **passes** — `385 user-facing source
file(s) clean`. (Note: `lib/postrun` and `lib/prescription`, where all the
new/changed copy actually lives, are not in this script's scanned scope
today — see the em-dash note under #4. Manually verified no em dashes, no
exclamation marks, no emoji in any string literal I added or changed.)

**Targeted suites** (`lib/postrun/`, `lib/faff/`, `lib/prescription/`,
`lib/race/`): all pass —
- `lib/postrun/` + `lib/faff/`: **660 passed, 23 skipped** (0 failed)
- `lib/prescription/` + `lib/race/`: **640 passed, 5 skipped** (0 failed)

**Full `web-v2` vitest suite**: **12431 passed, 1 expected fail, 260 skipped,
4 failed**, out of 12696 total.

Of the 4 failures:
- 2 are DB-liveness-gated audits that require `DATABASE_URL_RO`
  (`lib/plan/_authoring_shadow_compare.audit.test.ts`,
  `lib/adaptation/canonical-shadow/_f038_reign_scoping.audit.test.ts`) — these
  explicitly refuse to report green without a live DB connection (Rule 18),
  exactly the known/expected sandbox gap named in the task.
- 2 are in `lib/plan/_rolling_seven_ceiling.test.ts` (a rolling-7-mile plan
  ceiling growth-cap suite) — **unrelated to this task**: that file imports
  only from `lib/race/distance-category`, `lib/plan/load-progression-contract`
  and a local goal-pace fixture, nothing from `experience.ts`, `load.ts`,
  `hr-ceiling.ts` or `explanation.ts`. Not touched by any of the 4 items
  here; flagging per instructions rather than silently ignoring, but this
  predates and is independent of this change.

## Not done / explicitly out of scope
- Widening `check-coach-voice.sh`'s scope to cover `lib/postrun` and
  `lib/prescription` (noted under #4) — real gap, but a scope change to a
  shared build gate is its own decision, not bundled into a copy fix.
- No commit, push, or merge — left uncommitted in the worktree as instructed.
