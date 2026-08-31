# The absorption/execution reader split — shadow-run report

**Date:** 2026-09-01 · **Status:** shadow-mode only. Nothing promoted, nothing
wired into a live path. Answers `docs/PRODUCT_DECISIONS.md`'s 2026-09-01 "Four
calls" §1 and `docs/reports/handback-2026-09-01.md` §6 point 2 / §12.2.

## TL;DR

- Split landed: `web-v2/lib/adaptation/load.ts` now exports
  `actual_load_absorption` (unfiltered — byte-identical to today's live
  `readAdaptation`) and `representative_execution` (Rule-8-filtered,
  `representativeLookback`-extended) as two named outputs of
  `readAdaptationSplit`. `readAdaptation` itself — the live call — is
  untouched.
- **Corpus:** exactly **one** real account in this database has training
  history (`0645f40c-951d-4ccc-b86e-9979cd26c795`, the owner's own). Every
  other account is a zero-run QA fixture. `_sweep_allusers.test.ts`'s
  archetype corpus cannot express this reader's input **at all** — not just
  thinly, structurally: `AdaptationInput`'s fields don't exist anywhere in
  `Arc`/`ArcHistory`. Five synthetic fixtures fill the gap, built directly at
  the `AdaptationInput` level using the real `normal-window.ts` predicate.
- **Real-account replay (7 dates):** 1 of 7 changed the top-line
  band/decision (2026-08-20, inside AFC recovery: `normal/PROGRESS` →
  `marginal/STAY`); a second (2026-08-31, today) held the same band but on a
  materially different evidentiary basis (2 of 7 sessions read vs. 7 of 11).
- **Rule 9:** no new discontinuity found at either real taper/recovery
  boundary walked day-by-day. Day-to-day volatility exists but lives in
  dimensions (`internal_cost`, `consistency`) this split does not touch, and
  is present identically in both outputs.
- **DURATION vs. VOLUME, resolved separately as required:** DURATION (the
  long-run mileage lever in `adaptation-engine.ts`) is decisively gated
  **today** by `classifyAdaptation`'s band via `absorptionPermitsLoadProgression`
  — this split is the direct fix path. VOLUME's decisive limiter **today** is
  a wholly separate, already-correctly-filtered mechanism
  (`historicalTolerance`, 33.4 mi/wk) that returns before the absorption gate
  is even reached — this split does **not** change VOLUME's current hold,
  though the same code path means it could matter once the plan matures past
  two absorbed weeks.
- **Correction to the handback's own framing:** `adaptive-ramp.ts` does **not**
  consume `classifyAdaptation`'s verdict at all — it reads its own independent
  14-day-window evidence via `loadKeySessionExecutions`. The one confirmed
  live consumer of the unfiltered 42-day fork is `progression-pass.ts`'s
  `resolveProgressionStep`, reached live through `adapt.ts`'s
  `detectProgressionGate`.
- **Note on data cleanliness:** a separate, already-flagged `ownedDaysSql`
  wrong-plan-version defect (`docs/reports/taper-tempo-comparison-basis-2026-09-01.md`)
  was live in this codebase when this investigation started and was **fixed
  by a concurrent session partway through it** (`cc0b081f`, `e76ff593`,
  `docs/reports/owned-days-plan-selection-fix-2026-09-01.md`). The first
  shadow-run pass (§3/§5's original numbers) ran against the buggy resolver;
  every number in this report was **re-run after the fix landed** and reflects
  the corrected plan-version resolution. See §8 for the detail.
- **Recommendation: no promotion yet.** See "Go/no-go" at the end.

---

## 1 · The code

### 1.1 · What changed, where

`web-v2/lib/adaptation/load.ts`:

- `loadAdaptationInput` — **unchanged**. This is what `readAdaptation` calls,
  and `readAdaptation` — the live call `adapt.ts`'s `detectProgressionGate`
  uses — is also unchanged, byte for byte.
- `filterExecutionEvidenceByPrescribedWindow` — **new, pure**. The one
  transform `representative_execution` applies that `actual_load_absorption`
  does not: drop every `keySessionExecutions`/`targetVerdicts` row landing on
  a prescribed taper/race/recovery day (`isPrescribedNonNormal`, from
  `lib/training/normal-window.ts`), then re-derive the narration counts
  (`keySessionsPlanned`/`keySessionsCompleted`) from what survives. Split out
  as its own function specifically so it is falsifiable without a database
  (Rule 18) — the same posture `adaptation-model.ts` takes for the classifier
  itself, and covered directly by
  `web-v2/lib/adaptation/_absorption_split.test.ts` (9 tests, DB-free).
- `loadRepresentativeExecutionInput` — **new**. Reuses `loadAdaptationInput`'s
  unfiltered read for every field the execution dimension does not touch
  (`internal_cost`, `recovery`, `consistency`, `trend` — Rule 8's corollary:
  those ask what has been *absorbed*, not what capability has been
  *demonstrated*, and stay literal). Re-derives only the three fields
  `readExecution` consumes, over a window widened by `representativeLookback`
  when the base 42 days hold too few representative days — the identical
  mechanism `load-adaptation-engine.ts` already uses for PACE and DURATION
  evidence (commit `8b7abc1b`), applied here for the first time to this
  reader.
- `readAdaptationSplit` — **new**. Calls `classifyAdaptation` on both inputs
  and returns `{ actual_load_absorption, representative_execution }`. Not
  called from any live path. Not called from `load-adaptation-engine.ts`
  either — that file was read for this investigation but not touched, since
  wiring `representative_execution` into the Adaptation Engine's shadow-mode
  loader is itself the kind of "promote" decision the sequence in
  `PRODUCT_DECISIONS.md` §1 reserves for a human, after this report.

Scope discipline: only the **execution** dimension's inputs fork. The other
four dimensions (`internal_cost`, `recovery`, `consistency`, `trend`) are
carried through from the unfiltered input unchanged in both outputs. This
matches the defect exactly as named in `handback-2026-09-01.md` §6 point 2
and §12.2 — "classifyAdaptation's execution-quality dimension" — and it is a
deliberate scope boundary, not an oversight: whether `internal_cost` or
`consistency` deserve the same fork is a separate, unargued question, flagged
below in "Open question for a future pass," not decided here.

### 1.2 · Verification

- `tsc --noEmit`: clean.
- `npx vitest run lib/adaptation/_absorption_split.test.ts`: 9/9 pass.
- `npx vitest run lib/adaptation lib/plan/_progression_pass.test.ts lib/training/normal-window`:
  153/153 pass (nothing in the adjacent surfaces regressed).
- `scripts/check-normal-window.sh`, `scripts/check-doctrine.sh`,
  `scripts/check-swallowed-failure.sh`, `scripts/check-automatic-mutations.sh`,
  `scripts/check-anchor-derivation.sh`: all pass.
- `scripts/check-coercion.sh`: passes for everything this session touched.
  Two new argued exemptions were required and added to
  `web-v2/lib/audit/coercion-registry.ts` (`COERCION_ARGUED` +
  `LOAD_BEARING_KNOWN`) for
  `filterExecutionEvidenceByPrescribedWindow::executions.length` (3 sites) and
  `::verdicts.length` (1 site) — the filtered twin of the two exemptions
  `loadAdaptationInput` already carries for the identical reason: an empty
  result here means no session in the window could be *described*, never
  that the runner failed one, and passing it as a measured zero would
  fabricate a judgement in the dimension that gates progression. The gate's
  one remaining failure (`lib/adaptation/shadow-compare.ts::runPaceShadowCompareCycle::catch`)
  is **not mine** — that file is untracked, uncommitted work from a
  concurrent session in this shared checkout (confirmed via `git status`);
  it does not exist in git history and will not appear when this commit is
  verified in isolation.

---

## 2 · Corpus reachability (Rule 15)

Two questions, answered directly:

**How many real accounts have training history?** Exactly one.

```
dnitch85@me.com   270 runs, 48 plan versions, 6 races with results
(every other account: 0 runs — all are qa-*@faff.run fixtures or apple-review@faff.run)
```

**Can the archetype corpus express this reader's input?** No, structurally,
not just thinly. `_sweep_allusers.test.ts`'s `Arc`/`ArcHistory`
(`web-v2/lib/plan/sim-matrix.ts`) carries `dailyMiMostRecentFirst`,
`recentQualityPerWeek`, `recentQualityDistanceMi`, `isMidBlock` — these feed
the **Plan Generator**'s `SimInputs`, a completely different engine with a
completely different input shape. `AdaptationInput`'s fields
(`keySessionExecutions`, `targetVerdicts`, `trainingForm`,
`recoveryPctOfExpected`, `decouplingVerdicts`, `readinessBelowNormalDays`, …)
do not exist anywhere in that corpus. This is Rule 15's finding, confirmed
still open for the Adaptation Model specifically, even after HIST-1
(2026-08-30/31) closed the equivalent gap for the Plan Generator's own
readers (`resolveRampBase`, `easyDayMedianMi`, etc.) — a different corpus for
a different engine, and nobody has yet given the Adaptation Model one.

Per the task's own allowance, five synthetic fixtures were built directly at
the `AdaptationInput` level to partially substitute — see §4.

---

## 3 · Real-account shadow-run

Ran `readAdaptationSplit` against the one real account at seven dates
spanning both real race windows in its history (script:
`web-v2/lib/adaptation/_shadow_run_absorption_split.script.ts`, invoked via
`npx vitest run --config vitest.shadow-run.config.ts`). Numbers below are from
the **second** run, after the concurrent `ownedDaysSql` fix (§8) landed.

| date | context | unfiltered band/decision | filtered band/decision | changed? |
|---|---|---|---|---|
| 2026-04-20 | pre-Big-Sur | poor/MODIFY | poor/MODIFY | no |
| 2026-05-10 | inside Big Sur recovery | poor/MODIFY | poor/MODIFY | no (numerically identical — see note) |
| 2026-06-15 | clean, post-Big-Sur | strong/PROGRESS | strong/PROGRESS | no |
| 2026-07-25 | pre-AFC | normal/PROGRESS | normal/PROGRESS | no |
| 2026-08-10 | inside AFC taper | normal/PROGRESS | normal/PROGRESS | no (numerically identical — see note) |
| **2026-08-20** | **inside AFC recovery** | **normal/PROGRESS** | **marginal/STAY** | **YES** |
| 2026-08-31 (today) | AFC block aging out | marginal/STAY | marginal/STAY | band same, evidence basis different |

**Note on the four "no change, numerically identical" rows:** at several
dates the filtered and unfiltered execution scores land on the *exact same
number* despite different underlying sessions. This isn't a bug in the
filter — `representativeLookback` widens the search until it holds as many
representative days as the base window asked for, and at these dates the
widened, filtered sample happened to average out to the same score as the
raw 42-day sample. It's a coincidence of this particular runner's data, not
a property of the mechanism, and it's a reminder that "no change" at the
band/decision level can hide a different evidentiary basis underneath —
which is exactly what happened on 2026-08-31.

### 3.1 · The one real decision-level change: 2026-08-20

```
unfiltered (actual_load_absorption):
  normal/PROGRESS conf=high step=1 execution=0.03
  "Training is landing about as expected. Continuing on the planned progression."

filtered (representative_execution):
  marginal/STAY conf=high step=0 execution=-0.68
  "Holding the current stimulus rather than adding to it —
   8 of 12 key sessions delivered the full stimulus · 1 partial · 3 not run ·
   0 of 2 quality sessions on target."
```

This is the **opposite direction** from the AFC narrative in
`handback-2026-09-01.md` §6 point 2 (where the unfiltered window was
described as reading a good taper block as poor). Here, at this date, the
unfiltered 42-day window (2026-07-09 → 2026-08-20) blends genuinely poor
in-block execution with ~11 days of clean pre-taper training, and the
*dilution* pushes the average up to `normal`. The filtered reader correctly
recognises that only 2 of the 42 raw days are usable evidence, reaches back
via `representativeLookback`, and finds a real, representative shortfall (8
of 12, 3 not run) that the unfiltered blend was papering over.

**This matters for the report's honesty:** the defect this split fixes is
not one-directional. Sometimes the unfiltered window over-penalises a
runner (masking a good taper as poor, the AFC/DURATION case in §6). Sometimes
it under-penalises one (diluting a real shortfall with unrelated clean
weeks, this case). Both are the same root defect — one window answering two
questions — and the fix is symmetric: it answers the capability question
honestly in both directions, not just the direction that happens to favor
progression.

### 3.2 · 2026-08-31 (today): same band, different basis

```
unfiltered: marginal/STAY  "2 of 7 key sessions delivered the full stimulus ·
  3 partial · 1 replaced by a race · 1 not run · 1 of 4 quality sessions on target"
filtered:   marginal/STAY  "7 of 11 key sessions delivered the full stimulus ·
  1 partial · 3 not run · 0 of 2 quality sessions on target"
```

The top-line decision (`HOLD`, if this fed `progression-gate.ts` today)
would not change. But the *sentence a runner would read* would — from a
7-session read dominated by the AFC race week to an 11-session read spanning
back through representative pre-taper training. A promotion would change
this narrative even on the days it doesn't change the decision, which is
worth knowing before promoting: the diff isn't only measured in flipped
decisions.

---

## 4 · Synthetic fixtures (the Rule 15 partial substitute)

Five fixtures, built directly at the `AdaptationInput` level using the real
`normal-window.ts` predicate (`isPrescribedNonNormal`,
`prescribedWindowsFrom`) — the same transform the loader applies, exercised
without a database. Full detail in
`_shadow_run_absorption_split.script.ts`'s section 3 and locked in as
regression tests in `_absorption_split.test.ts`.

| fixture | shape | result |
|---|---|---|
| **3a** taper+recovery masking a genuinely good runner (David's own AFC shape: 5 clean sessions before a half, 3 missed inside its taper+recovery window) | execution score rises 0.13 → 2.00 filtered; band/decision unchanged (`normal/PROGRESS` both) but the narrative corrects from generic "landing as expected" to the honest "recent sessions look good, not yet enough weeks to call it a trend" | **fix confirmed, direction: more accurate, not just more generous** |
| **3b** genuine detraining, same 3-missed-of-8 shape, **no race anywhere near it** (control case) | numerically **identical** in every field between filtered and unfiltered | **corollary control passes**: absent a prescribed window, real misses stay real misses — the split does not over-apply Rule 8 |
| **3c** clean window, distant race | numerically identical, true no-op | confirms the mechanism is inert when nothing needs filtering |
| **3d** fully-masked window (all 4 sessions inside the prescribed block) | unfiltered: `poor/MODIFY`, execution=-2.00, "0 of 4 delivered, 4 not run." Filtered: `normal/PROGRESS` low-confidence, execution=**null**, "Not enough training evidence yet... Proceeding as planned." | **Rule 11 confirmed**: total absence of representative evidence refuses to a null-and-proceed read, never a fabricated `poor` |
| **3e** two races back to back (compound window, Big Sur + Sombrero) | unfiltered: `marginal/STAY`. Filtered (both windows applied): `normal/PROGRESS`, execution=null, refusal narrative | compound windows compose correctly; nothing survives the double exclusion, and the reader refuses honestly rather than guessing |

---

## 5 · Rule 9 continuity walk

Two real taper/recovery boundaries in the one real account's history, walked
day-by-day, reading `representative_execution` at each date.

**Big Sur Marathon taper START (2026-04-26, marathon, A priority; taper opens
2026-04-05):** `2026-03-30` through `2026-04-11`, execution held flat at
`-2.00` across the entire walk — no jump at 04-05 in the dimension this split
touches. (`internal_cost` shifted 2.00 → -0.50 between 04-05 and 04-07 — but
that dimension is untouched by this split, present identically in both
outputs, and is a pre-existing property of the unfiltered rolling window
already live today. Out of scope for this change; noted, not fixed.)

**Big Sur recovery END (~2026-05-24):** `2026-05-18` through `2026-05-30`,
execution held flat at `-2.00` throughout; `consistency`/`trend` (also
untouched) drifted smoothly, no cliff.

**AFC taper START (2026-08-16, half, A; taper opens 2026-08-02):**
`2026-07-28` through `2026-08-07`. The **combined** verdict's band flips
twice in this window (`normal`→`marginal` between 07-30/08-01, back to
`normal` at 08-07) — but tracing the `execution` component specifically
(-0.47, -0.47, -0.53, -0.53, -0.62, -0.81, -0.13) shows a gradual walk with
no discontinuity locked to the 08-02 boundary itself: the transition from
07-30 to 08-01 happens a day *before* the boundary and moves by 0.06, the
same order of magnitude as every other day-to-day step in this series, and
the value is unchanged AT the boundary (08-01 → 08-02: -0.53 → -0.53). The
band flips are driven by `internal_cost`'s decoupling-verdict rotation
in/out of the raw window — again, untouched by this split, present
identically in `actual_load_absorption` today.

**AFC recovery END (~2026-08-30):** `2026-08-26` through `2026-08-31`,
execution converges smoothly (-0.68, -0.74, -0.74, -0.74, -0.74) and holds
flat straight through the boundary day itself and the day after.

**Conclusion:** no new discontinuity was introduced at any of the four
boundary crossings by the fields this split filters. Day-to-day volatility
exists in the surrounding verdict, but it lives in dimensions this change
does not touch and is identically present in the already-live unfiltered
reader today — it is not a regression this split introduces, and fixing it
would mean touching `internal_cost`/`consistency`, which is outside this
task's authorized scope.

---

## 6 · DURATION vs. VOLUME — the decisive limiter, resolved separately

The handback grouped DURATION and VOLUME as both "held by the 42-day
window." `PRODUCT_DECISIONS.md` §1 flagged this as under-argued and required
tracing each lever's real hold reason separately. Traced by reading
`web-v2/lib/adaptation/adaptation-engine.ts`'s `detectDuration` and
`detectVolume` directly (read-only — this file was not edited, per this
task's constraints).

### DURATION — decisively gated by `classifyAdaptation`'s band, today

`detectDuration`'s **first** check, before it even looks at long-run
evidence:

```ts
// THE SAME GATE VOLUME USES. Both are LOAD-domain levers, so both ask the
// absorption model the same question and get the same answer.
if (!absorptionPermitsLoadProgression(absorption)) {
  return { proposal: null, hold: holdWith(
    [absorption.band === 'poor' ? 'ABSORPTION_POOR' : 'ABSORPTION_MARGINAL'], ...
  ) };
}
```

`absorptionPermitsLoadProgression(v)` is `v.decision === 'PROGRESS' && v.veto == null`
— i.e. band `strong` or `normal`. Today, `actual_load_absorption`'s band is
`marginal` (per §3.2's 2026-08-31 row), so this gate fires and DURATION holds
with `ABSORPTION_MARGINAL` — exactly what §7 of the handback's stress diff
reported. **This split is the direct fix path for DURATION**: once a human
promotes `representative_execution` into this gate, DURATION's hold would be
judged on the representative read, not the taper-diluted one.

### VOLUME — decisively gated by a wholly separate, already-filtered mechanism, today

`detectVolume` has the **identical** `absorptionPermitsLoadProgression`
check, but positioned *after* two earlier branches that return first:

```ts
const planTooYoung = scheduled.length < VOLUME_PROGRESS_MIN_ABSORBED_WEEKS;
const historical = evidence.historicalTolerance;
if (planTooYoung) {
  if (!historical.ok) { return { hold: ... }; }
  if (historical.sustainedWeeklyMi < current * VOLUME_ABSORBED_SHARE) {
    return { proposal: null, hold: holdWith(
      ['CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION', 'LOAD_NOT_YET_ABSORBED'], ...
    ) };
  }
  ...
}
// absorptionPermitsLoadProgression(absorption) is reached only past here
```

For this account today, the plan is one day old (authored 2026-08-31 03:40,
per `training_plans`), so `planTooYoung` is true, and `historical.sustainedWeeklyMi`
(33.4 mi/wk, Rule-8-filtered via `normalWeeklyMileage`, already independent of
`classifyAdaptation`) is below 45 mi/wk × `VOLUME_ABSORBED_SHARE` — so
`detectVolume` **returns before `absorptionPermitsLoadProgression` is ever
called.** `classifyAdaptation`'s band — filtered or not — is not consulted
for VOLUME's current hold. **This confirms the decision doc's suspicion
precisely: VOLUME's hold today is historical tolerance, a different
mechanism, unrelated to this reader's defect. This split does not change
VOLUME's current output.**

**Caveat, for completeness rather than alarm:** this is true of the
account's *present* state, not a permanent fact about the code. Once the
plan accumulates two absorbed weeks (`VOLUME_PROGRESS_MIN_ABSORBED_WEEKS`) or
`historicalTolerance` clears the bar, `detectVolume` reaches the identical
`absorptionPermitsLoadProgression` gate `detectDuration` uses — at that point
this split would start to matter for VOLUME too. The finding is "not the
decisive limiter today," not "structurally irrelevant."

### A naming collision worth flagging, not fixing

`progression-pass.ts`'s live-wired lever (`resolveProgressionStep`, reached
through `adapt.ts`'s `detectProgressionGate`) also calls itself governing
"duration" — but it means **quality-session duration/reps** ("It does not
move WEEKLY VOLUME... Every decision here moves duration, reps or recovery"
— `progression-pass.ts`'s own header), a different quantity from
`adaptation-engine.ts`'s `DURATION` target, which means the **long-run
mileage**. Two different levers share one word. This is a Rule-16-adjacent
naming collision, not a functional bug — noted here because it complicated
tracing "which DURATION" the handback meant, and a future pass may want to
rename one of them.

---

## 7 · Correction to the handback's "two live consumers" claim

`docs/PRODUCT_DECISIONS.md` §1 and `handback-2026-09-01.md` describe the
unfiltered reader as feeding "two live write paths (`progression-pass.ts`,
`adaptive-ramp.ts`) directly." Traced by grep across the whole codebase for
every call site of `readAdaptation`/`classifyAdaptation`/`loadAdaptationInput`:

- **Confirmed live**: `web-v2/lib/plan/adapt.ts`'s `detectProgressionGate`
  calls `readAdaptation` directly (`const { readAdaptation } = await import('@/lib/adaptation/load')`)
  and feeds the verdict straight into `progression-pass.ts`'s
  `resolveWeekProgression` → `progression-gate.ts`'s `resolveProgressionStep`,
  which is switched entirely on `verdict.band`. This is a genuine, currently
  live consumer of the unfiltered 42-day fork.
- **Not a consumer**: `web-v2/lib/plan/adaptive-ramp.ts` does **not** call
  `readAdaptation`, `loadAdaptationInput`, or `classifyAdaptation` anywhere.
  Its upward-ramp gate reads `loadKeySessionExecutions` **directly**, over
  its own independent `QUALITY_LOOKBACK_DAYS = 14`-day window — a separate
  mechanism that happens to share one numeric constant (the 8 mi long-run
  threshold) with `load.ts`, and nothing else. It is unaffected by this
  split, today, structurally.

This doesn't change the authorization or the plan — `progression-pass.ts`
alone is enough to justify treating this as a live-consumer fork — but the
report should say plainly what was actually verified rather than repeat a
claim that didn't hold up under a full grep.

---

## 8 · The `ownedDaysSql` wrong-plan-version bug — fixed mid-investigation

`docs/reports/taper-tempo-comparison-basis-2026-09-01.md` (landed the same
day, read per this task's instructions) found that `ownedDaysSql`
(`web-v2/lib/plan/owned-days.ts`) resolved the **wrong plan version** for
every date in this account's 42-day window — a 21-minute, reverted
2026-06-07 plan outranked the real 2.5-month plan the runner actually
trained under, once both were archived. This feeds
`loadKeySessionExecutions`, which both `loadAdaptationInput` and
`loadRepresentativeExecutionInput` call.

**This bug was live when this investigation's first shadow-run pass ran, and
was fixed by a concurrent session in this shared checkout partway through**
(`cc0b081f`, `e76ff593`; `docs/reports/owned-days-plan-selection-fix-2026-09-01.md`,
"fixed, verified against real production data across every account in the
database, committed"). It was not fixed by this task and is out of this
task's scope — it is a separate, already-flagged defect in a different file.

Because it would not otherwise be clean to report numbers gathered against a
known-buggy resolver, the full shadow-run (§3, §5) was **re-run after the fix
landed**, and every number in this report reflects the corrected plan-version
resolution. The two passes agreed on which decisions changed and in which
direction (§3.1's flip, §3.2's basis change) — only the exact session counts
shifted by one or two, consistent with the fix correcting which sessions were
even visible to the reader. No caveat is carried forward: the numbers above
are clean.

---

## 9 · What was not done

- `readAdaptation` — unchanged, still the only call any live path uses.
- `representative_execution` is not wired into `load-adaptation-engine.ts`,
  `progression-pass.ts`, `adaptive-ramp.ts`, or any cron. It exists only in
  `readAdaptationSplit`, called only by the shadow-run script and its tests.
- `adaptation-engine.ts`, `capacity-resolver.ts`, `spec-builder.ts`,
  `spec-card.ts`, `load-adaptation-engine.ts` — read for this investigation,
  not edited.
- The `ownedDaysSql` wrong-plan-version bug (§8) — not fixed by this task
  (a concurrent session fixed it independently, already tracked in its own
  report); the shadow-run was re-run after that fix landed so this report's
  numbers are clean either way.
- The `internal_cost`/`consistency`/`recovery`/`trend` dimensions' own
  Rule 8 status — not decided here. If a future review wants to fork one of
  them too, that is a separately-scoped, separately-argued decision.

## Open question for a future pass

`internal_cost` (via `decouplingVerdicts`, `lateDriftBpm`) and `consistency`
(via `weeklyPlannedMi`/`weeklyActualMi`, `trainingForm`) both showed real
day-to-day volatility in the Rule 9 walk (§5) that this split does not
address. Per Rule 8's corollary, `internal_cost` is plausibly a genuine
tissue-load question (leave it literal) — but `consistency`'s
planned-vs-actual ratio during a taper week is a closer call: the plan
itself reduced what was "planned," so the ratio may already self-correct, or
it may not. Not argued here; flagged for whoever reviews this report next.

## Go/no-go recommendation

**No-go on promotion, as instructed** — this report is the input to that
decision, not the decision itself. What promotion would concretely change,
for a human to weigh: DURATION's hold would be re-judged on
`representative_execution` instead of `actual_load_absorption`, which on
today's account would very likely flip the `ABSORPTION_MARGINAL` hold (since
the AFC block is exactly the taper-dilution case documented in §6). VOLUME
would not change today, but could once the plan matures. §3.1 shows the
effect is not purely favorable to the runner — it can also surface a real
hold the unfiltered window was diluting away.
