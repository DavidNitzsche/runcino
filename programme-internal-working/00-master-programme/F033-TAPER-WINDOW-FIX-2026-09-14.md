# F033 — taper-window granularity fix in the threshold `contextFactor`, live-verified — 2026-09-14

**Status: FIXED, typechecked, unit-tested, doctrine-gated, and live-verified
before/after against `DATABASE_URL_RO` (read-only role, no writes issued).**

Fixes the bug confirmed by
`SEPT1-THRESHOLD-WEIGHTING-INVESTIGATION-2026-09-14.md` and endorsed with no
coaching-judgment objection by the coach consultant
(`2026-09-14-006-progression-mechanism-reconciliation.md`, F033 section):
`web-v2/lib/training/pace-corpus.ts`'s `contextFactor = PRESCRIBED_WINDOW_
AUTHORITY = 0.75` discount was sizing its pre-race "taper" window from
`TAPER_WEEKS_BY_DISTANCE`, rounded to whole weeks (10K → 2 weeks → 14 days),
against a doctrine citation (`Research/08` §9.1) whose real 10K taper tops out
at 10 days. David's 2026-09-01 threshold session — clean HR, every rep beat
target pace, the Evidence Engine's maximum single-activity weight — sat 12
days before the 2026-09-13 Santa Monica 10K: 2 days before the genuine taper
would even open, but inside the rounded 14-day window, so it was discounted to
0.75 for a reason unrelated to its content.

## 1 · The exact fix

`web-v2/lib/training/pace-corpus.ts`:

- Removed the `isPrescribedNonNormal` import from `normal-window.ts` (its only
  call site is the one being replaced).
- Added `import { raceWindowFor } from '@/lib/coach/easy-discipline'`.
- Added a new local function, `insideCitedRaceWindow(iso, windows)`, and
  pointed the `contextFactor` computation at it instead of
  `isPrescribedNonNormal`:

```ts
function insideCitedRaceWindow(
  iso: string,
  windows: readonly PrescribedWindow[],
): boolean {
  for (const w of windows) {
    const daysSinceRace = Math.round(
      (Date.parse(iso + 'T12:00:00Z') - Date.parse(w.raceDateISO + 'T12:00:00Z')) / 86400000,
    );
    if (daysSinceRace > 0) {
      // Post-race recovery · untouched, priority-scaled boundary.
      if (iso <= w.toISO) return true;
    } else {
      // Pre-race taper · F033's fix, day-granular and still priority-blind.
      const taperDays = raceWindowFor(w.raceDistanceMi, false);
      if (-daysSinceRace <= taperDays) return true;
    }
  }
  return false;
}
```

```diff
-    // Context · Rule 8
-    const representative = !(windows && isPrescribedNonNormal(row.date, windows));
+    // Context · Rule 8 · day-granular window (F033) — see `insideCitedRaceWindow`.
+    const representative = !(windows && insideCitedRaceWindow(row.date, windows));
```

Nothing about **how** the discount is applied once a session is correctly
inside a window changed — `PRESCRIBED_WINDOW_AUTHORITY` (0.75) and the
weight-multiplication mechanism (`weight = hrFactor * durationFactor *
evidenceFactor * contextFactor`) are untouched. Only the window's **size**
changed, and only on one side of it (see §2).

## 2 · Consolidated onto `raceWindowFor`, but scoped to the taper side only — and why

The task asked me to consider reusing the existing `raceWindowFor`
(`lib/coach/easy-discipline.ts`) mechanism directly rather than correcting a
second, still-separate table, per this project's one-canonical-resolver
doctrine and CLAUDE.md's own precedent for the sibling `raceWindowFor` vs.
`normal-window.ts` divergence. I did reuse it directly — no third table of
day-counts was created — but **only for the pre-race (taper) side**, not the
post-race (recovery) side. This split was found, not assumed:

My first pass called `raceWindowFor(w.raceDistanceMi, isAfter)` for both
directions. Before shipping it I ran the same live-execution method against
the real account and it found a genuine regression: `postRaceRecoveryWeeks
(cat, priority)` (`lib/plan/goal-tiers.ts`, DOCTRINE-1) scales a lower-priority
race's post-race recovery window *down* — a real, doctrine-motivated property
(a C-priority tune-up recovers faster than an A race) — while `raceWindowFor`'s
post-race day count is **priority-blind** (it was built for
`easy-discipline.ts`'s own habit-flagging purpose, which has never needed
priority-awareness). Live-executing the naive both-sides substitution against
`DATABASE_URL_RO` showed it flipping 2026-05-11 through 2026-05-13 — three days
in the Sombrero half's post-race window, a sub-A-priority race whose
engine-computed recovery is 1 week — from *admitted* to *newly discounted*,
because `raceWindowFor`'s flat 14-day half-marathon post-race count is longer
than that race's own priority-scaled 7-day recovery. That is a new defect of
the exact same shape as F033 (the fitter/more nuanced number replaced by a
coarser one, discounting genuine evidence for a reason unrelated to its
content) — just on the other side of the window and for a different race.

`TAPER_WEEKS_BY_DISTANCE` (the pre-race side) is **not** priority-scaled
either — `normal-window.ts`'s own header states this explicitly ("TAPER IS NOT
PRIORITY-SCALED HERE") — so `raceWindowFor`'s equally priority-blind pre-race
day count is a safe, like-for-like substitution there, with no other behavior
change. The fix was narrowed to that side only. The post-race side is
untouched: `iso <= w.toISO`, exactly as `PrescribedWindow` already computes it
via the existing, priority-aware `postRaceRecoveryWeeks`.

**Net: the taper side is consolidated onto `raceWindowFor` (no second table);
the recovery side keeps its own existing, correct, priority-scaled mechanism,
left alone because F033 never diagnosed a bug there and CLAUDE.md's own
precedent for this exact table pair treats the two sides as independently
argued.**

## 3 · Live-execution falsification (Rule 18) — before / after, real data

Reproduced the investigation's exact method: the real, unmodified
`loadThresholdCorpusInputs()` / `thresholdCorpusFromInputs()` executed via
`node --experimental-transform-types` with a path-alias/extension-resolution
loader, against `DATABASE_URL_RO` (the `faff_readonly` role — no write
capability at the database level, in addition to no write being issued), for
user `0645f40c-951d-4ccc-b86e-9979cd26c795`, `todayISO='2026-09-13'`. No
fixture — the investigation itself notes a fixture carries no race calendar
and would skip the exact branch this fix touches.

**BEFORE** (git-`HEAD` content of `pace-corpus.ts`, imported from a scratch
copy so every one of its own `@/lib/...` imports still resolved against the
real, current worktree):

```json
{
  "date": "2026-09-01",
  "weight": 0.75,
  "authority": { "contextFactor": 0.75, "reasons": [
    "HR_IN_THRESHOLD_BAND", "EVIDENCE_ENGINE_CORROBORATES",
    "SUPPORTING_EVIDENCE_ONLY_NOT_ANCHOR_MOVER", "INSIDE_PRESCRIBED_WINDOW"
  ]}
}
```
`tPaceSecPerMi: 440`, `windowDays: 74` — exact match to the investigation's
own numbers.

**AFTER** (the fixed file, same live execution):

```json
{
  "date": "2026-09-01",
  "weight": 1,
  "authority": { "contextFactor": 1, "reasons": [
    "HR_IN_THRESHOLD_BAND", "EVIDENCE_ENGINE_CORROBORATES",
    "SUPPORTING_EVIDENCE_ONLY_NOT_ANCHOR_MOVER"
  ]}
}
```
`INSIDE_PRESCRIBED_WINDOW` no longer fires for this date. `tPaceSecPerMi: 436`
(down from 440 — faster, i.e. more ready, matching the investigation's §5
predicted direction), `windowDays: 74` (unchanged).

**Confirmed: weight moves 0.75 → 1 for the 2026-09-01 session, exactly as
required.**

## 4 · Regression check (Rule 9 — narrows, never widens)

Checked every OTHER supporting session for David in the same live read, and
separately walked **every prescribed window for every race with an
`actual_result`** in the real database (only one user currently has race
results, so this is a full population check, not a sample):

- **2026-09-08** (5 days pre-race — genuinely inside even the cited 10-day
  10K taper): weight unchanged, `0.7174661047713726` before and after,
  `contextFactor: 0.75` both times. Confirms the fix **narrows** the window
  rather than removing the discount outright.
- **2026-08-30** (14 days pre-race by the old table) now falls **outside**
  Santa Monica's 10-day taper — but it is independently caught by the
  Americas Finest City half's own post-race recovery window (14 days
  post-race, unaffected by this fix), so it correctly stays discounted for a
  *different, still-valid* reason. Confirmed by inspecting `w.raceDateISO` /
  `w.category` on the matching window.
- **2026-07-07** (age-discounted, `stalenessFactor`): unaffected, as expected
  — this fix touches `contextFactor` only.
- **Full-population day-walk** (`loadPrescribedWindows` for every user with a
  race result, comparing old week-rounded membership against the shipped
  fix's membership across each window ± 3 days): **4 flips total, all on the
  Santa Monica 10K's pre-race side (2026-08-30 through 2026-09-02), all in
  the `oldInside:true → newInside:false` direction** — i.e. every flip is a
  narrowing, none is a widening. The Sombrero-half post-race flip that the
  *rejected* both-sides version produced is gone.

## 5 · Test / gate results

- `npx tsc --noEmit` (whole `web-v2` project): **0 errors**, both before and
  after the final (rescoped) edit.
- `npx vitest run lib/training/_pace_corpus.test.ts lib/training/_normal_window.test.ts lib/training/_threshold_evidence_contract.test.ts`:
  **97/97 passed**, unchanged by the fix.
- `bash scripts/check-doctrine.sh`: **350/350 citations resolve**
  ("doctrine OK"); the 14 listed entries are pre-existing, argued,
  ratchet-exempt findings unrelated to this file's taper-window logic (none
  reference `PRESCRIBED_WINDOW_AUTHORITY`, `contextFactor`, or
  `TAPER_WEEKS_BY_DISTANCE`) — confirmed unchanged from the pre-fix run.
- `bash scripts/check-normal-window.sh`: **PASS** (all 4 guards, including the
  1200-recovery-block authoring sweep) — confirms this fix did not touch, and
  did not need to touch, the shared `PrescribedWindow` infrastructure or its
  gate.

## 6 · What did NOT change

- `PRESCRIBED_WINDOW_AUTHORITY` (0.75) — untouched.
- `TAPER_WEEKS_BY_DISTANCE`, `POST_RACE_RECOVERY_WEEKS`,
  `postRaceRecoveryWeeks()` — untouched. These are doctrine-bound engine
  constants that also drive plan composition; touching them was explicitly
  out of scope per the investigation and CLAUDE.md's own precedent.
- The shared `PrescribedWindow` / `loadPrescribedWindows` /
  `excludePrescribedDays` infrastructure in `normal-window.ts`, used by the
  easy-pace HABIT corpus (`resolveEasyPaceCorpus`) and every other caller
  across the app (safety guards, ramp base, adaptation) — untouched. Only
  `pace-corpus.ts`'s own `contextFactor` computation for the THRESHOLD
  capacity reader was changed.
- The post-race side of the window used by `contextFactor` itself — kept on
  the existing, priority-scaled `w.toISO` boundary (see §2).

## Answering the report's specific asks

- **Exact fix**: `insideCitedRaceWindow()` replaces `isPrescribedNonNormal()`
  as the source of the threshold `contextFactor`'s Rule 8 window; it reuses
  `raceWindowFor` (`lib/coach/easy-discipline.ts`) for the pre-race taper side
  only, and keeps the existing priority-scaled `PrescribedWindow.toISO` for
  the post-race side.
- **Before/after weight for 2026-09-01, live-executed**: **0.75 → 1**, real
  data, `DATABASE_URL_RO`, confirmed twice (once on the initial both-sides
  version, again after rescoping to taper-only — the target session's
  before/after numbers are identical across both versions since it is a
  pre-race case).
- **Consolidated or corrected a second table?**: **Consolidated onto
  `raceWindowFor`** for the pre-race/taper side (no third table introduced);
  the post-race side deliberately keeps its own existing, separately-argued,
  priority-aware mechanism rather than being consolidated, because
  consolidating it would have introduced a real regression (found and
  rejected via the same live-execution method, §2).
