# The absorption/execution dual-reader log — ongoing comparison, not promotion

**Date:** 2026-09-01 · **Status:** logging mechanism shipped and run against
real production history; shadow-mode only, nothing promoted.

This report is the account owner's follow-up to
`docs/reports/absorption-reader-split-2026-09-01.md`. His ruling on that
report's go/no-go: **do not promote `representative_execution` into the live
progression path yet.** Instead, build ongoing logging that compares the two
readers over time — not a one-time report — and run it against the whole
season plus tonight's synthetic fixtures, then answer the disagreement rate,
the distribution of what changes when they disagree, the boundary behavior
day by day, which lever is actually affected, and an honest per-disagreement
coaching-quality read. This report is that answer.

## TL;DR

- **The mechanism**: `web-v2/lib/adaptation/load.ts` gained
  `buildAdaptationComparisonRecord` / `readAdaptationSplitWithLog` — a
  sibling of `readAdaptationSplit` that builds a structured
  `AdaptationComparisonRecord` (dated observations each reader kept or
  dropped, a `durationLever` block naming whether each side would gate
  `detectDuration`'s progression check, and which side is decisive) and
  appends it as one JSON line to a git-tracked file on every call.
  `adaptation_shadow_log` (migration 160, applied mid-task by a concurrent
  session for the PACE mechanism, schema expanded the same commit) is
  checked again against its applied, expanded shape and still isn't a fit —
  every column is PACE-lever-typed, not general-purpose — rejected in §1.3,
  so this follows the same JSONL fallback pattern the PACE mechanism itself
  used before that table existed.
- **Run against 90 distinct real dates** spanning 2026-01-02 → 2026-09-01
  (the whole season, not the prior report's 7), plus day-by-day walks across
  all **six** real race windows this account has run this season (not just
  the two the prior report covered), plus the same five synthetic fixtures
  re-verified with exact `permitsLoadProgression` numbers.
- **Disagreement is rare and concentrated, not distributed**: exactly one
  contiguous episode all season — **8 consecutive days, 2026-08-16 through
  2026-08-23**, inside the Americas Finest City half's post-race recovery
  window. Every other sampled date across the whole season — the entire
  chained rose-bowl→disney→la-marathon→Big-Sur/Sombrero spring racing block,
  and every clean-window date in between — agrees exactly, band and
  decision.
- **When they disagree, it is one-directional in this runner's real data**:
  all 8 real disagreement days move the SAME way — `representative_execution`
  is the more conservative reader (`marginal/STAY`) against
  `actual_load_absorption`'s `normal/PROGRESS`. Zero real dates found where
  filtering moved the verdict toward more progression. The synthetic
  fixtures are where the opposite direction shows up (§4, §7) — a real
  finding worth stating plainly rather than smoothing over.
- **The lever is DURATION, confirmed, no exception found**: `durationLever`
  was computed on all 90 real dates and all 5 fixtures; every flip is a
  `permitsLoadProgression` flip, matching `detectDuration`'s own gate. No
  case where the disagreement would instead have moved a VOLUME-gating
  quantity, because this reader was never in VOLUME's call path (confirmed
  again directly, §6).
- **Why the disagreement clusters where it does**: reachable evidence, not
  chance. The spring block agrees because it's THIN, not because filtering
  doesn't matter there — `representativeWindow.reachedOuterBound: true`
  fires repeatedly through Jan–May, meaning the widened lookback hit its
  120-day ceiling without finding enough unprescribed days, because five
  races in 4.5 months chain their taper/recovery windows almost
  continuously (2026-01-04 → 2026-05-24 is one near-unbroken 140-day
  prescribed stretch). AFC in August is the one race with a long clean gap
  behind it (June 15 – Aug 1), so there's real, recent, unprescribed
  evidence for the widened window to find — which is exactly when the two
  readers can actually say something different.
- **Recommendation: still no promotion.** The finding that changes since the
  prior report: filtering's real-world effect on this account, so far, has
  only ever made the engine MORE conservative, never less — which is
  reassuring for safety but means this reader's real behavior has not yet
  demonstrated the "push harder when earned" half of the mission statement.
  See §7 for the honest, mixed read on whether the one real episode is
  better coaching.

---

## 1 · The logging mechanism

### 1.1 · What was built, where

`web-v2/lib/adaptation/load.ts` — extended, not replaced. `readAdaptationSplit`
(the function `docs/reports/absorption-reader-split-2026-09-01.md` built) is
**untouched**: still calls the same three functions, still returns the same
shape, still called by nothing live.

New, additive:

- **`buildAdaptationComparisonRecord(userUuid, todayArg)`** — a superset of
  `readAdaptationSplit`. It calls the exact same
  `loadAdaptationInput` / `loadRepresentativeExecutionInput` /
  `classifyAdaptation` for the two verdicts, so the log can never disagree
  with the split it describes, then does a **second, best-effort fetch**
  purely to recover the dated rows each reader's selection kept or dropped —
  information `AdaptationInput.keySessionExecutions` throws away once it
  reaches the classifier (it carries `state`/`stimulusCompletion`/
  `earnsProgression`, never `dateISO`). That second fetch is wrapped so its
  failure can never affect the verdicts, which are already computed by the
  time it runs (Rule 11: an observation-detail failure is a different fact
  from a verdict failure, and the record says so rather than collapsing them
  into one outcome).
- **`selectExecutionObservations`** / **`selectVerdictObservations`** — two
  PURE functions (Rule 18: falsifiable without a database) that restate
  `loadAdaptationInput`'s own row selection (`readable && read != null`,
  bounded to a window) and `filterExecutionEvidenceByPrescribedWindow`'s
  selection (the same, plus the `isPrescribedNonNormal` exclusion), so there
  is one definition each reader's "what counts as an observation" question
  is answered by (Rule 16), reused for both sides by varying only the window
  bounds and whether a `windows` list is supplied.
- **`AdaptationComparisonRecord`** — the structured record. Per call:
  `absorptionWindow` / `representativeWindow` (with `extendedByDays` and
  `reachedOuterBound` from `representativeLookback`), the runner's
  `prescribedWindows` for that date, a dated `observations[]` list marking
  each key-session/target-verdict row `inAbsorption` / `inRepresentative`
  with an explicit reason when they differ
  (`prescribed_non_normal` when absorption kept a row representative
  dropped; `representative_lookback_reach` when representative kept a row
  absorption never even looked at, because the base 42-day window doesn't
  reach that far back), both full verdicts, a `durationLever` block (§1.2),
  and `disagreesOnBandOrDecision`.
- **`persistAdaptationComparisonRecord`** / **`readAdaptationSplitWithLog`**
  — the sibling of `readAdaptationSplit` that logs. Every call builds a
  record and appends it as one line to a git-tracked JSONL file before
  returning. Still not called from any live path.

### 1.2 · DURATION, named directly — not VOLUME

The task was explicit that this reader gates DURATION (the long-run mileage
lever in `adaptation-engine.ts`'s `detectDuration`), confirmed by the prior
report's §6, not VOLUME (held today by the separate, already-filtered
`historicalTolerance` mechanism). Rather than re-derive that finding by
prose, this record makes it checkable on every date:

```ts
function permitsLoadProgression(v: AdaptationVerdict): boolean {
  return v.decision === 'PROGRESS' && v.veto == null;
}
```

restated from `adaptation-engine.ts`'s own (unexported)
`absorptionPermitsLoadProgression` — not imported, because that file is
owned by a concurrent session tonight and is on this task's do-not-touch
list; flagged in the code as a restatement that could go stale if the source
predicate ever changes, the same posture the original shadow-run script
already accepted for its own `progressionLean` helper.

`durationLever.decisiveLimiter` is computed per record:

- **`'agree'`** — both readers reach the same permit/block answer.
- **`'actual_load_absorption'`** — absorption blocks, representative would
  permit. This is what's actually gating DURATION live today, whenever it
  occurs.
- **`'representative_execution'`** — the reverse: representative blocks,
  absorption would permit. This is a counterfactual today (nothing reads
  `representative_execution` live) — it names what WOULD newly hold
  DURATION back if this were promoted.

### 1.3 · Persistence — why not `adaptation_shadow_log`

`db/migrations/160_adaptation_shadow_log.sql` started this task as a
drafted-but-not-run migration. Mid-task, a separately-authorized session
**applied it** (`0fce624f`, David's explicit per-statement go, reviewed
against all seven of his DDL criteria — `docs/reports/shadow-log-production-2026-09-01.md`)
and then **expanded its schema** the same commit: convergence-guard columns,
`representative_observations`/`excluded_observations`, HR-compatibility
verdict, capacity belief, a per-cycle mutation checksum. The table is live
in production — confirmed directly (read-only role, `SELECT count(*) FROM
adaptation_shadow_log` → 2 rows as of this check).

That widened schema is close enough in NAME to warrant a second look before
concluding it still isn't a fit — `representative_observations`/
`excluded_observations` sound exactly like what this record needed. Checked
again against the applied (not just drafted) schema, and the answer is
unchanged: every column is still typed for the **PACE lever specifically**,
not for a general dual-reader comparison. `engine_previous`/`engine_proposed`
are `PaceMagnitude` jsonb; `phase_breakdown` is `PacePhaseOutcome[]`;
`workout_family` defaults to `{threshold,tempo,cruise}` (the PACE lever's own
session scope, not the general key-session set DURATION reads);
`hr_compat_verdict`/`capacity_belief` are PACE/HR-specific questions with no
DURATION analogue; even the newly-added `representative_observations` /
`excluded_observations` are scoped to the same threshold/tempo/cruise
quality-session family, not the general `keySessionExecutions` this record
reads. Its own table comment still says so directly: "Adaptation Engine
PACE-lever shadow-compare log." Inserting a DURATION-lever record here would
either violate the column types or force a lossy reshape into columns named
for a different question — not a clean additive fit, applied or not. This
task is also not authorized to draft or run a second migration of its own
(CLAUDE.md: DDL needs David's explicit per-statement go; the only migration
even provisionally in scope for a DIFFERENT session to run tonight was 160,
and it's already been applied and closed out for its own purpose).

So persistence here follows the **exact fallback pattern**
`lib/adaptation/shadow-compare.ts` used before 160 was applied (same
problem, same shape of answer): one JSON line appended per call to
`docs/reports/adaptation-shadow-log/0645f40c-951d-4ccc-b86e-9979cd26c795.absorption-duration.jsonl`
— a distinct filename from the PACE mechanism's `<uuid>.jsonl` in the same
directory, so the two shadow logs never interleave two different record
shapes inside one file. Same caveat as the PACE mechanism carried before its
own table existed: this is real, inspectable persistence for tonight's
verification work, not a production answer — a Railway/Vercel filesystem is
ephemeral, so this would need its own DURATION-scoped table (a sibling of
`adaptation_shadow_log`, not a repurposing of it) before ever being wired
into a cron. Nothing here is wired into a cron today. Given `adaptation_shadow_log`
just went through a full seven-criterion DDL review and came out the other
side applied and working, a DURATION-scoped sibling migration — same
review process, same additive-only shape — is a reasonable next step for
whoever picks up the promotion decision this log is feeding; not run here.

### 1.4 · Verification

- `tsc --noEmit`: clean (one pre-existing error in an untracked, unrelated
  concurrent-session scratch file — `_scratch_partA_audit_2026-09-01.test.ts`
  — confirmed via `git status` to not be this task's file, and to predate
  this task's changes).
- `npx vitest run lib/adaptation lib/plan/_progression_pass.test.ts lib/training/normal-window`:
  153/153 pass — nothing in the split, the classifier, or the progression
  pass regressed.
- The new pure functions (`selectExecutionObservations`,
  `selectVerdictObservations`, `permitsLoadProgression`) are restatements of
  already-tested logic (`filterExecutionEvidenceByPrescribedWindow`,
  `absorptionPermitsLoadProgression`), not new judgment calls, so no new unit
  test file was added for them — they were instead exercised directly,
  end to end, on 90 real production dates (below), which is a stronger check
  than a synthetic unit test for the same reason Rule 13 argues for
  rendering over reading.

---

## 2 · The season-wide sweep

`web-v2/lib/adaptation/_season_sweep_absorption_duration.script.ts` (new,
wired into `vitest.shadow-run.config.ts` alongside its sibling
`_shadow_run_absorption_split.script.ts`). Three parts, every real-account
call going through `readAdaptationSplitWithLog` so it also logs:

1. **Bi-weekly cadence, whole season** — 2026-01-08 → 2026-08-31, 17 dates.
   Coarse, but spans the entire account history rather than a hand-picked
   sample.
2. **Boundary walk, all six real races** — `rose-bowl-half-2026` (2026-01-18,
   A), `disney-half-2026` (2026-02-01, A), `la-marathon-2026` (2026-03-08,
   A), `big-sur-marathon` (2026-04-26, hilly-excluded), `sombrero-half`
   (2026-05-03, C), `americas-finest-city` (2026-08-16, A) — every real
   race with a recorded result this account has ever run
   (`loadPrescribedWindows`'s own predicate; races without a result yet,
   `santa-monica-10k` onward, open no prescribed window and are correctly
   excluded). Each walked ±2 days around its taper-open and recovery-close
   boundary, plus race day itself.
3. **A dedicated daily walk, 2026-08-13 → 2026-08-24** — added after the
   coarser boundary walk above (which samples the window's OPEN/CLOSE edges,
   not its interior) landed exactly on the AFC disagreement the prior report
   already knew about, at 2026-08-16 and 2026-08-20. This is the fine-grained
   walk that actually resolves the transition day by day (§5).

Plus the same five synthetic fixtures the prior report built
(`_shadow_run_absorption_split.script.ts` §3), re-run here specifically to
compute the exact `permitsLoadProgression` boolean on both sides rather than
infer it from band/decision prose (§4, §7).

**Combined: 90 distinct real dates** (`docs/reports/adaptation-shadow-log/...jsonl`,
deduped by date — a few dates were sampled by more than one of the three
parts above and logged twice; the analysis below uses the latest record per
date) spanning **2026-01-02 through 2026-09-01**, plus 5 synthetic fixtures.

**A methodological caveat, stated plainly rather than left implicit**: this
sample is not uniform-random. Part 3 above deliberately concentrated daily
resolution on the one week the prior report had already flagged. So "8 of 90
sampled dates disagreed" (§3) is not a base rate applicable to a random day
— it is closer to "1 of 90 SAMPLED WINDOWS (the AFC recovery week) disagreed,
and that window happened to get resolved down to the day." Both framings are
in §3; neither is hidden.

A concurrent session was running its own heavy read load against the same
production database for part of this sweep (`_shadow_compare.audit.test.ts`,
confirmed via `ps aux` and CLAUDE.md's own warning that this checkout is
shared), which slowed — but did not corrupt — the run; every date below
completed a real, successful read.

---

## 3 · Disagreement rate

| | count | rate |
|---|---|---|
| Real dates sampled (deduped) | 90 | — |
| Real dates where band/decision disagreed | 8 | 8.9% of sampled dates |
| Real dates where the DURATION gate flipped | 8 | 8.9% of sampled dates (identical set — see §6) |
| Distinct real EPISODES of disagreement | **1** | one contiguous 8-day stretch |

The 8 disagreement dates are **2026-08-16 through 2026-08-23 inclusive, with
no gap** — the day AFC was run through the seventh day of its post-race
recovery window. Every other date sampled — the bi-weekly whole-season pass
(17 dates, only 2026-08-20 disagreed, which is inside this same episode),
every boundary-edge date around the other five real races, and every date
outside the AFC window in the fine daily walk (08-13 through 08-15 agree;
08-24 onward agrees again) — matched exactly, band and decision.

Full day-by-day ledger (deduped, `A` = `actual_load_absorption`, `R` =
`representative_execution`):

```
2026-01-02 .. 2026-05-28  (54 dates sampled)     A=poor/MODIFY        R=poor/MODIFY        (all agree)
2026-06-11, 2026-06-25                            A=strong/PROGRESS    R=strong/PROGRESS    (agree)
2026-07-09, 2026-07-23                            A=normal/PROGRESS    R=normal/PROGRESS    (agree)
2026-07-31 .. 2026-08-06  (6 dates, AFC taper)    A=marginal/STAY      R=marginal/STAY      (agree)
2026-08-13, 08-14, 08-15                          A=normal/PROGRESS    R=normal/PROGRESS    (agree)
2026-08-16 .. 2026-08-23  (8 dates)               A=normal/PROGRESS    R=marginal/STAY      <<< DISAGREE
2026-08-24 .. 2026-09-01  (6 dates)               A=marginal/STAY      R=marginal/STAY      (agree)
```

The spring block's 54-date run of identical `poor/MODIFY` is not a sign
filtering never matters there — see §6's structural explanation: the
account's own history is largely chained prescribed windows that January
through May, so both readers are frequently equally evidence-starved, not
equally clean.

---

## 4 · What changes when they disagree — the distribution

**Real account (8 disagreement days, 1 episode):** 100% move the same
direction. `representative_execution` is `marginal/STAY` against
`actual_load_absorption`'s `normal/PROGRESS` on every one of the 8 days.
Zero real dates found where filtering moved the verdict toward MORE
progression. This is a genuinely different picture from the prior report's
framing (its §3.1 called the effect "not one-directional," contrasting this
AFC finding against a *different* case in a *different* document — the
`handback-2026-09-01.md` narrative, not this reader's own real-account
behavior). Within THIS reader's actual behavior on THIS account's actual
season, every real disagreement found so far pulls the same way: toward
holding, never toward pushing.

**Synthetic fixtures (5 fixtures, re-run with exact `permitsLoadProgression`
values):**

| fixture | absorption | representative | duration gate |
|---|---|---|---|
| 3a — taper+recovery masking a genuinely good runner | `normal/PROGRESS` permits=true | `normal/PROGRESS` permits=true | agree (narrative improves, decision doesn't move — see the prior report's own §4 note on this) |
| 3b — genuine detraining, no race (control) | `normal/PROGRESS` permits=true | `normal/PROGRESS` permits=true | agree (correct: nothing to filter) |
| 3c — clean window, distant race (no-op) | `normal/PROGRESS` permits=true | `normal/PROGRESS` permits=true | agree (true no-op, confirmed) |
| 3d — fully-masked window | `poor/MODIFY` permits=**false** | `normal/PROGRESS` permits=**true** | **FLIPS toward MORE permission** |
| 3e — compound window (Big Sur + Sombrero) | `marginal/STAY` permits=**false** | `normal/PROGRESS` permits=**true** | **FLIPS toward MORE permission** |

So the full picture, combining real and synthetic: **2 of 7 total
disagreement cases move toward more progression, and both are synthetic,
both are the SAME mechanism** — a window so completely masked that every
session inside it is excluded, and the classifier correctly refuses to
fabricate a score (Rule 11) rather than defaulting to `poor`. With
`execution: null` and every other dimension already null in these
hand-built fixtures, the classifier's honest "not enough evidence, proceed
as planned" answer is `normal`, low confidence — which happens to also be a
`PROGRESS` decision. **This exact shape has not fired on the real account in
90 sampled dates** — `representativeLookback`'s reach-back mechanism has, so
far, always found at least some real evidence to fall back on (§6) — but it
is a real, load-bearing edge case in the mechanism, not a hypothetical, and
§7 argues both sides of whether it's actually safe.

---

## 5 · Boundary walks, day by day

### 5.1 · The AFC episode, at daily resolution (the one real disagreement)

```
2026-08-13  A=normal/PROGRESS  R=normal/PROGRESS   (agree)
2026-08-14  A=normal/PROGRESS  R=normal/PROGRESS   (agree)
2026-08-15  A=normal/PROGRESS  R=normal/PROGRESS   (agree)
2026-08-16  A=normal/PROGRESS  R=marginal/STAY     <<< race day — disagreement STARTS here
2026-08-17  A=normal/PROGRESS  R=marginal/STAY     <<<
2026-08-18  A=normal/PROGRESS  R=marginal/STAY     <<<
2026-08-19  A=normal/PROGRESS  R=marginal/STAY     <<<
2026-08-20  A=normal/PROGRESS  R=marginal/STAY     <<< (the prior report's own finding)
2026-08-21  A=normal/PROGRESS  R=marginal/STAY     <<<
2026-08-22  A=normal/PROGRESS  R=marginal/STAY     <<<
2026-08-23  A=normal/PROGRESS  R=marginal/STAY     <<< last disagreement day
2026-08-24  A=marginal/STAY    R=marginal/STAY     (agree — absorption catches up)
```

No discontinuity WITHIN either reader — this confirms the prior report's
Rule 9 finding rather than reopening it. The interesting behavior is not a
cliff in either series individually; it's that the two series, which track
each other exactly for weeks before and (eventually) after, separate
cleanly on race day and re-converge 8 days later. Mechanically, at
2026-08-16 (from the persisted record):

- `absorptionWindow`: `2026-07-05 → 2026-08-16` (fixed 42 days).
- `representativeWindow`: `2026-06-21 → 2026-08-16` (widened 14 days —
  `representativeLookback` reaching back because the taper/race days it
  drops need replacing).
- 3 rows dropped as `prescribed_non_normal` (2026-08-04, 08-06, 08-11 — all
  inside the AFC taper), a 4th (2026-08-16 itself, `REPLACED` — the goal-race
  day) drops the same way once the walk reaches race day itself.
- 4-6 rows added via `representative_lookback_reach`, reaching back to
  2026-06-18 through 2026-07-07 to replace them.

`actual_load_absorption`'s execution score on 08-16 is `+0.28` ("6 of 10 key
sessions delivered the full stimulus · 3 partial · 1 not run") —
`representative_execution`'s is `-0.74` ("7 of 11 · 1 partial · 3 not run ·
0 of 2 quality sessions on target"). Every OTHER dimension
(`internal_cost`/`recovery`/`consistency`/`trend`) is identical between the
two by construction (§1.2 of the prior report — only execution forks), so
the whole band/decision flip rides on this one 0.3-weighted dimension moving
by roughly 1.0 point.

### 5.2 · The other five real race windows — no disagreement, and why

Walked identically (±2 days around taper-open and recovery-close, plus race
day) for `rose-bowl-half-2026`, `disney-half-2026`, `la-marathon-2026`,
`big-sur-marathon`, and `sombrero-half`. None showed any disagreement at any
sampled date. This is not because filtering is inert there — it's because,
per the records, both readers are frequently reading from an equally thin
pool of evidence. Concretely:

- `rose-bowl-half-2026` window: `2026-01-04 → 2026-02-01`.
- `disney-half-2026` window: `2026-01-18 → 2026-02-15` — **opens on
  rose-bowl's own race day**. A real, production compound window, not just
  the synthetic 3e fixture's construction.
- `la-marathon-2026` window: `2026-02-15 → 2026-04-05` — opens the day
  disney's window closes.
- `big-sur-marathon` window: `2026-04-05 → 2026-05-24` — opens the day
  la-marathon's window closes.
- `sombrero-half` window: `2026-04-19 → 2026-05-10` — entirely NESTED inside
  Big Sur's window.

Chained end to end, `2026-01-04` through `2026-05-24` is one near-unbroken
140-day prescribed stretch — the account's entire spring racing block. At
`2026-04-20` (inside this stretch), `representativeWindow.reachedOuterBound`
is `true`: the widening mechanism reached its 120-day ceiling
(`REPRESENTATIVE_LOOKBACK_MAX_DAYS`) and still could not clear enough
unprescribed days, so both readers land on the identical execution score
(`-2.00`, "1 of 8 quality sessions on target") — not because the filter
didn't run, but because there was nowhere clean left for it to reach.

AFC in August is structurally different: **June 15 – August 1 is a long,
genuinely clean six-week gap** (both readers read `strong/PROGRESS` or
`normal/PROGRESS` identically through it), so when AFC's taper opens on
2026-08-02, `representativeLookback` has real, recent, unprescribed evidence
to reach back into — and finds a real answer, one that DIFFERS from what the
fixed unfiltered window sees. **The disagreement doesn't happen everywhere a
race occurs; it happens specifically where there's a clean recent stretch to
recover into.** That is itself a finding worth carrying forward: this
account's racing calendar this season was structured such that the reader
this task is evaluating almost never got to prove itself, and the one time
it did was informative.

---

## 6 · Which lever — confirmed DURATION, not VOLUME

`durationLever.permitsLoadProgression` was computed on every one of the 90
real dates and 5 fixtures using the restated
`absorptionPermitsLoadProgression` predicate (§1.2). Every single
band/decision disagreement (8 real + 2 synthetic) is ALSO a
`permitsLoadProgression` disagreement — the two sets are identical, with no
exception. This is expected rather than a coincidence: `permitsLoadProgression`
is `decision === 'PROGRESS' && veto == null`, and every real disagreement in
this account's data is a `PROGRESS`-vs-`STAY` split with no veto on either
side, so the boolean necessarily tracks the decision split.

VOLUME was re-confirmed unaffected by direct re-reading of
`adaptation-engine.ts`'s `detectVolume` (read-only, not edited — see the
prior report's §6 for the full trace, unchanged tonight): for this account,
`detectVolume` returns via `planTooYoung`/`historicalTolerance` before it
ever reaches the `absorptionPermitsLoadProgression` check both DURATION and
VOLUME share, so `classifyAdaptation`'s band — filtered or not — is never
even consulted for VOLUME's current hold. No exception to this was found in
tonight's data; it wasn't expected to be, since the sweep didn't change
`detectVolume`'s inputs, only exercised `classifyAdaptation` on more dates.

---

## 7 · Per-disagreement coaching-quality read

### 7.1 · The real episode — 2026-08-16 through 2026-08-23

**The decision itself (HOLD instead of PROGRESS on DURATION) is defensible
on its face — the runner had just raced a half marathon.** Holding long-run
mileage steady rather than growing it in the days right after an A-priority
race is ordinary, doctrine-sanctioned coaching, independent of any execution
question. If that were the whole story, this would be a clean win for
promoting `representative_execution`.

**But that is not the reason the model actually gives, and the reason
matters.** The verdict doesn't reference the race directly — DURATION's gate
has no separate "just raced" veto; it flows entirely through the execution
dimension's reconstructed narrative: *"7 of 11 key sessions delivered the
full stimulus · 1 partial · 3 not run · 0 of 2 quality sessions on target."*
Read at face value, that sentence tells the runner he is executing poorly,
not that he is appropriately recovering from a race he just ran. Digging
into which sessions produced it (§5.1's observation list) shows the
representative set's 3 "not run" sessions are the two pre-taper misses on
2026-06-30 and 2026-07-02 plus one more — real shortfalls, but **6 to 7
weeks old relative to the date being judged**, pulled back into view
specifically because `representativeLookback` needed to replace the 3-4
sessions it excluded for being inside the AFC window.

This is a genuine, arguable tension, and I don't think it resolves cleanly
in either direction:

- **In favor of the representative read**: those pre-taper misses are real.
  They happened, they were genuine shortfalls in execution, and Rule 8 is
  explicit that a taper is never counted as normal — which means the honest
  answer to "how has this runner actually been executing key sessions" has
  to come from SOMEWHERE, and 6-7 weeks isn't stale for a marathoner's
  demonstrated capability. The unfiltered reader's `normal/PROGRESS` on
  these same days is arguably the one telling a polite fiction — averaging a
  taper/race/recovery block that structurally couldn't produce a clean
  quality session with nothing, and calling the wash "about as expected."
- **Against it**: CLAUDE.md's own mission statement is explicit that "week
  to week is what matters" and that "past data can be messy, current runs in
  a plan is not" — a forward-looking product, deliberately not an
  archaeology one. A DURATION hold in the week after a half marathon,
  justified by sessions from late June, is coaching by look-back rather than
  by look-forward, and if surfaced to the runner as the sentence above, it
  reads as a rebuke for something almost two months distant rather than an
  acknowledgment of "you just raced, this is expected." The mechanism is
  doctrinally correct (Rule 8's exclusion is exactly right) but its
  NARRATION is not doing the thing Rule 8's own corollary and this file's
  mission statement both ask for — crediting what's actually true about the
  runner's immediate situation.

**My honest read: the DECISION (hold) looks like reasonable coaching for
this specific week; the REASON given is not the reason a coach would
actually give a runner three days after his own half marathon, and that gap
is worth fixing before promotion, not after.** A promoted
`representative_execution` should not tell a runner who just raced that he's
under-executing quality sessions when the actual, sufficient, honest reason
is "you just raced, this is a scheduled recovery week" — that's a
Rule-16/Rule-17-shaped problem (the sentence doesn't say the thing that's
actually true) layered on top of an otherwise defensible Rule-8 mechanism.

One more caveat worth stating rather than hiding: this account's plan
composer already de-loads long-run distance during a prescribed recovery
block, independent of this classifier. I did not check whether a DURATION
progression opportunity was actually queued for 2026-08-16 through
2026-08-23 in the live plan — it's plausible the unfiltered reader's
`PROGRESS` signal, even acting live, would have had nothing to act ON that
week, which would make this particular episode lower-stakes in practice than
the band/decision diff alone suggests. Flagged as open, not resolved here.

### 7.2 · The synthetic edge case (3d, 3e) — total masking defaults to PROGRESS

**This is the one I'd flag hardest before any promotion.** When every
observation in a window falls inside a prescribed block, `representative_execution`
correctly refuses to fabricate a `poor` score (Rule 11) — but the
consequence, in these fixtures, is that ALL FIVE dimensions read null and
the classifier's honest "not enough evidence, proceed as planned" default
happens to BE a `PROGRESS` decision. That is a defensible answer to "what
should the model say when it knows nothing" in isolation. It is a much less
comfortable answer to "should DURATION be allowed to grow this week"
specifically, because "we don't know" and "go ahead" are different claims,
and the current design collapses them for this one lever. Genuinely
reassuring: this exact shape did not fire once across 90 real dates this
season — every real window this runner's `representativeLookback` needed to
reach past always found SOME real evidence to fall back on, never a total
void. But "hasn't happened yet in one account's one season" is a much
weaker guarantee than "cannot happen," and a newer account, or a runner with
back-to-back races and no clean gap between them (unlike this account's
lucky June–August window), would hit it far more easily. Worth a real
answer — HOLD rather than PROGRESS when representative evidence is entirely
absent, rather than defaulting through the "proceed as planned" rule
designed for a different situation — before this reader is trusted to gate
an upward lever unattended.

---

## 8 · What was not done

- `readAdaptation` — unchanged, still the only call any live path uses.
- `representative_execution` — still not wired into
  `load-adaptation-engine.ts`, `progression-pass.ts`, `adaptive-ramp.ts`, or
  any cron.
- `adaptation-engine.ts`, `shadow-compare.ts`, `pace-hr-compatibility.ts`,
  `lib/plan/generate.ts`, `db/migrations/160_adaptation_shadow_log.sql` —
  on this task's do-not-touch list, not edited.
- No DDL was run. The comparison log is a git-tracked JSONL file only.
- The `internal_cost`/`consistency`/`recovery`/`trend` dimensions' own
  Rule 8 status — still not decided, per the prior report's own open
  question; this task did not reopen it.
- Whether a DURATION progression opportunity actually existed in the live
  plan for 2026-08-16 – 08-23 (§7.1's caveat) — not checked; would need a
  separate read of `plan_workouts` for that week.
- The synthetic-fixture "total masking defaults to PROGRESS" edge case
  (§7.2) was found and named, not fixed — that's a design decision for
  whoever owns `adaptation-model.ts`'s Rule-11 default, not something to
  patch inside this task's logging-only scope.

## Recommendation

**Still no promotion**, consistent with the account owner's original
ruling — this report doesn't change that call, it deepens the evidence
behind it. What's new since the prior report:

1. The disagreement rate over a full season, at the resolution needed to
   find it, is one real 8-day episode — small, but now measured rather than
   inferred from 7 hand-picked dates.
2. In this account's real data, filtering has so far ONLY ever made the
   engine more conservative — a materially different, more precise claim
   than the prior report's "not one-directional," which was comparing across
   two different documents rather than within this reader's own real
   behavior.
3. The one real episode's DECISION looks reasonable but its stated REASON
   does not credit the thing that's actually true (the runner just raced) —
   worth fixing in the reader's narration before it's trusted to speak to
   the runner directly.
4. The synthetic total-masking edge case is the one place filtering could
   push the wrong way, and it has a clean, nameable fix (HOLD-on-absence
   rather than PROGRESS-on-absence for this one lever) that a future
   promotion decision should require, not just note.

This logging mechanism is intended to keep running — every future call to
`readAdaptationSplitWithLog` appends another comparison record, so the next
review of this question has more than one season's worth of AFC-shaped
episodes to draw on, not just this one.
