# F074 — onboarding fitness-background evidence: three fixes

**Date:** 2026-09-14
**Branch:** `fix/f074-onboarding-evidence-2026-09-14` (based on `origin/main` @ `df12260e3`), not pushed/merged — for external review and David's eventual merge authorization, per the standing workflow. David is unreachable tonight; nothing in this branch touches `main`.
**Doctrine authority:** `for coaching consult/consult-log/2026-09-14-017-f074-onboarding-evidence-doctrine.md` (coach-consult ruling, approved for building) + `docs/PRODUCT_DECISIONS.md` `TIEREVIDENCE-2` (2026-09-02, settled — self-reported experience level stays inert, NOT touched by this work).
**Finding this closes:** `for independent product review/reports/IPR-20260914-005-onboarding-fitness-step-mostly-discarded.md` — 3 of 5 onboarding fitness-background answers were discarded before reaching the engine.
**Scope:** backend only (`web-v2/lib`, `web-v2/app/api`) — no native/Swift changes, no `web-v2` frontend changes, no touch to self-reported experience level.

---

## 0 · What the three fields are, and the one doctrine ruling that governs all of them

Native onboarding (`OnboardingV5.swift`) asks a new runner ONE of five questions about their fitness background. Two of five already reach the engine (`.consistent` → `weeklyMi`/`histAvg`; `.new` → `experienceLevel`, deliberately unread per `TIEREVIDENCE-2`). Three do not, and this session builds backend support for all three:

| # | Onboarding mode | Field(s) | Doctrine rung | Mechanism this fix uses |
|---|---|---|---|---|
| 1 | `.recent` — "I have a recent race" | recent race distance + finish time + recency | **Rung 1** (strongest — "recent race" heads Brief 01's fallback ladder) | `races.actual_result`, the SAME pathway every other race result uses |
| 2 | `.effort` — "I know my hard-effort pace" | a pace held ~20 min | Between rung 4 and rung 5 — a concrete falsifiable number, not a vague label | `USER_PRIOR` evidence in `resolveThresholdCapacity`, mirroring the shipped `coldStartThresholdCapacity` self-reported-mileage pattern |
| 3 | `.timeoff` — "I am coming back from time off" | weeks off + pre-break weekly mileage | Rung 4 (historical performance) with a detraining discount | SAME `USER_PRIOR` mechanism as #2, plus a new detraining-discount function |

The consult log's central citation, verbatim: *"Recent race → recent time trial → equivalent-performance model / VDOT → historical performance → self-reported ability → conservative population prior… 'recent race' and 'self-reported ability' are not the same rung… they are the FIRST and SECOND-TO-LAST rungs of a five-rung ladder."* Field 4 (experience level) is separately, dated-ly settled (`TIEREVIDENCE-2`) and this session does not touch it — verified unchanged: `lib/plan/_declared_level_inert.test.ts` (`DECLAREDLEVEL-0`) still passes, byte-identical, 736/736 assertions in that file's suite green before and after.

**Existing shipped precedent this session mirrors throughout**, per the task's own pointer: `coldStartThresholdCapacity` / `priorWeeklyMi` in `lib/training/capacity-resolver.ts` — the mechanism built 2026-09-01 for exactly this shape of problem ("real logged mileage reads zero, but the runner's own onboarding self-report of weekly volume exists"). Fixes #2 and #3 extend this SAME mechanism rather than inventing a second one.

---

## 1 · Fix #1 — recent race time → `races.actual_result`

### What was broken
Native's `.recent` mode collects a race distance and a finish time and then explicitly discards them (`_ = a.recentRaceDistance` in `HostsV5.swift`, `recentRaceTime` never referenced at all) — the screen doesn't collect the recency bucket the backend's `raceHistory` validator requires, so posting the two free-text fields as-is would fail validation entry-by-entry with no error. The backend had no field to accept a "recent race" answer at all.

### Files changed
- **`web-v2/lib/race/onboarding-recent-race.ts`** (new, 143 lines) — the PURE half. `buildRecentRaceWrite(userId, entry, now)` computes the slug, `meta`, and `actual_result` patch with no database, no session, no HTTP (same extraction pattern `complete-inputs.ts` used in 2026-08-24). Exports `RecentRaceWrite`/`RecentRaceWriteResult`.
- **`web-v2/lib/onboarding/complete-inputs.ts`** — `validateRecentRace(raw)` reuses `validateRaceHistory`'s EXACT validator (Rule 16: one validator, not a second one that could drift) on a single-element array; adds `recentRace: RaceHistoryEntry | null` to `OnboardingCompleteInputs`. Deliberately does NOT merge into `raceHistory[]` — that array feeds `profile.race_history`'s low-confidence `user_prior` ladder (`selfReportedPr`), and doctrine is explicit this is a DIFFERENT, higher-confidence rung.
- **`web-v2/app/api/onboarding/complete/route.ts`** — `writeOnboardingRecentRace(userId, entry)` calls the pure builder, then executes ONE SQL statement (the only impure line in the whole fix). Called best-effort, outside the onboarding transaction, same posture as the existing goal-race write and `seedPlan` a few lines below it — a failure here never blocks onboarding.

### The write, precisely
```sql
INSERT INTO races (slug, user_uuid, meta, plan, gpx_text, actual_result)
VALUES ($1, $2, $3::jsonb, '{}'::jsonb, '', $4::jsonb)
ON CONFLICT (slug, user_uuid) DO UPDATE
  SET meta = races.meta || jsonb_strip_nulls(EXCLUDED.meta),
      actual_result = CASE
        WHEN races.actual_result IS NULL
          OR races.actual_result ->> 'source' = 'onboarding_self_report'
        THEN COALESCE(races.actual_result, '{}'::jsonb) || EXCLUDED.actual_result
        ELSE races.actual_result
      END
WHERE races.user_uuid = EXCLUDED.user_uuid
```
- **Reserved, deterministic slug** `onboarding-recent-race-<uuid8>` — distinct from any race the runner adds through `/api/race`, so no collision, and idempotent on re-onboarding.
- **`priority: 'B'`** — a genuine judgment call, made and stated rather than defaulted silently: not `'A'` (would overstate authority for an unverified self-report) and not `'C'` (doctrine's "barely counts" tier, wrong for something the runner explicitly distinguished from a training run). `'B'` is `REPRESENTATIVE_FLOOR` in `lib/race/effort-authority.ts`, the documented middle ground.
- **`provisional: true`, `source: 'onboarding_self_report'`** — honest provenance, NOT `manualResultPatch`'s `source: 'manual'` (that asserts a confirmed chip-time entry, which this is not). `isProvisionalResult` (`races-state.ts`) already treats this flag as "caption it, don't hide it" everywhere, and its own doc comment confirms it is additive to display captions only — never a discount on the evidence's weight in `bestRecentVdot`'s selection.
- **Does NOT call `runPostResultChain`** (`lib/race/result-chain.ts`). That chain archives the active plan, stamps a `vdot_auto_recalc` coach_intent, and generates a next-race plan — all correct for a race the runner just finished mid-plan, all WRONG for a self-reported past race with no plan relationship. Verified structurally: `lib/race/_onboarding_recent_race.test.ts` test 2d isolates `writeOnboardingRecentRace`'s own function body and asserts it never contains the string `runPostResultChain`.

### Date is approximate, honestly
The onboarding screen collects a recency BUCKET (`whenRaced: '<6mo'|'6-12mo'|'1-2yr'|'2+yr'`), not an exact date. The write anchors `meta.date` on that bucket's own midpoint via `whenRacedDaysAgo` — the SAME map `self-reported-pr.ts` already uses for typed PRs (Rule 16) — rather than inventing a precision the runner never gave. This is the honest ceiling on what the current field can support; a future native screen change to collect an exact date is out of scope here (already flagged by the IPR itself as the screen's own follow-up work, not this backend fix's job).

### Verification
- **Rule 6 field-level merge, confirmed structurally**: `lib/race/_onboarding_recent_race.test.ts` test 2b asserts the route contains `COALESCE(races.actual_result, '{}'::jsonb) || EXCLUDED.actual_result` and does NOT contain an unconditional `actual_result = EXCLUDED.actual_result` (the exact bug shape Rule 6 exists to catch).
- **Does not clobber a later real result**: test 2c asserts the CASE guard text is present and its `ELSE` branch is a no-op (`ELSE races.actual_result`) — a since-confirmed real result (any `source` other than `'onboarding_self_report'`) is never downgraded back to provisional by a re-onboarding replay.
- **11 pure tests** in `_onboarding_recent_race.test.ts` (all passing): slug/meta/actual_result shape, recency-bucket-to-date ordering (not a hand-copied date), `'other'` distance handling, per-user slug determinism, and THREE falsification cases (missing recency bucket refuses rather than fabricating a date; non-finite/non-positive time refuses; the injected clock is honored, not the wall clock).
- **14 tests** in `_complete_inputs_evidence.test.ts` covering the intake half, including the falsifier for exactly what the IPR found: an entry with distance+time but NO recency bucket (what the CURRENT native screen would send if wired naively) is refused to `null`, never silently accepted with a fabricated recency.
- **Live, read-only, against `DATABASE_URL_RO`**: confirmed no `races` row exists yet for any account under the `onboarding-recent-race-*` slug pattern (expected — this write path has never fired, since native does not yet send `recentRace`); confirmed the write is genuinely reachable code (route.ts's own `writeOnboardingRecentRace` liveness-asserted via the same test file).

### Falsified
Pre-fix, `body.recentRace` had no validator, no field on `OnboardingCompleteInputs`, and no write path — the value was discarded before any network call could even see it wired server-side (matching the IPR's own finding). Post-fix, a validated `recentRace` entry reaches `races.actual_result` through the identical pathway a manually-confirmed chip time uses, distinguishable by provenance (`source`), and `loadVdotInputs` (the real consumer, `lib/training/vdot-inputs.ts`) picks it up with no changes needed there — it already reads `races.actual_result` for every row in the runner's date window, and this is now one more honest row in it.

### Out of scope, stated plainly
Native (`HostsV5.swift`) does not send `recentRace` today — it still discards `recentRaceDistance`/`recentRaceTime` for the reason its own comment states (the screen lacks the recency-bucket question the validator requires). This backend fix is complete and independently testable; wiring the native screen to collect a recency bucket and post `recentRace` is a separate, smaller native change this task's scope explicitly excludes (backend-only, no Swift changes).

---

## 2 · Fix #2 — effort pace → `USER_PRIOR` evidence in `resolveThresholdCapacity`

### What was broken
Native's `.effort` mode collects a pace string (e.g. "7:45", "a pace you can hold for 20 minutes, honestly") and `effortPace` is "never referenced anywhere outside `OnboardingV5.swift`" (IPR's own words) — dead on arrival, no backend field, no consumer.

### The doctrine mapping (why this is a T-pace, not a race performance)
`Research/01-pace-zones-vdot.md` §"Field-test selection for the Coach" / the field-test protocols table: *"30-min time trial — After 15-min warm-up: run as far as possible in 30 min… Average pace of last 20 min ≈ LT pace."* A self-reported "pace held for 20 minutes" is doctrine's own operational definition of threshold pace — so this reader treats the number directly as a T-pace candidate rather than converting it through a race-distance VDOT formula (there is no distance to convert from).

### New backend field
**`profile.effort_pace_sec_per_mi`** (migration 172, INT, nullable, `CHECK (... BETWEEN 120 AND 1800)`) — the runner's self-reported hard-effort pace in seconds/mile.

### Files changed
- **`web-v2/db/migrations/172_onboarding_evidence_fields.sql`** (new) — adds `effort_pace_sec_per_mi` and `history_layoff_weeks` (fix #3) to `profile`. **NOT YET APPLIED to any database** — DDL requires David's explicit per-statement go per CLAUDE.md's deployment doctrine, and he is unreachable tonight. Confirmed live against `DATABASE_URL_RO`: neither column exists in production as of this report.
- **`web-v2/lib/training/vdot.ts`** — new `parsePaceMinSec(s)`, a dedicated "M:SS pace string → seconds" parser. Deliberately NOT `parseRaceTime`: that function's own H:MM-vs-MM:SS heuristic ("first part ≤9 → H:MM") is correct for a race finish time and WRONG for a pace — it would read "7:45"/mile as 7 hours 45 minutes. Falsified directly: `_complete_inputs_evidence.test.ts` test 2d asserts "7:45" parses to 465 seconds, not 27,900.
- **`web-v2/lib/training/self-reported-pr.ts`** — new `readSelfReportedEffortPace(paceSecPerMi, daysSinceReported)`, structurally a sibling of `readSelfReportedPr`: validated against the SAME `PR_MIN/MAX_PLAUSIBLE_PACE_S_PER_MI` band (Rule 16 — one plausibility band, not two), freshness priced on the SAME `USER_PR_HALF_LIFE_DAYS` (365 days) and the SAME `prPriorWeight` shrinkage function a typed PR uses (no new weight constant). Freshness anchors on `profile.onboarding_completed_at` (when the self-report was made) rather than a race date, since there is no race here to date.
- **`web-v2/lib/onboarding/complete-inputs.ts`** — accepts either the native "M:SS" string (`effortPace`) or a pre-parsed seconds value (`effortPaceSecPerMi`, forward-compatible with a future client), bounded loosely (120–1800s) at intake; the real plausibility gate runs at READ time in `self-reported-pr.ts`.
- **`web-v2/app/api/onboarding/complete/route.ts`** — writes `effort_pace_sec_per_mi` in both the UPDATE and INSERT profile statements, unconditionally overwritten on re-onboarding (same convention as `weeklyMi`/`histAvg` — a correctable current self-report, not a write-once physiological fact like birthday).
- **`web-v2/lib/training/capacity-resolver.ts`** (the resolver wiring — shared with fix #3, see §4 for the exact diff):
  - `VdotFallbackRead.selfReportedEffortPace?: SelfReportedEffortPaceRead` (optional — see §4 for why).
  - `loadOnboardingEffortPace(userId, todayISO)` — new DB reader, `rowOrNull` pattern, reads the column + `onboarding_completed_at` via `to_char(...)` (per `reference_pg_timestamp_tz_parsing` — never a raw JS `Date` parse of a timestamptz).
  - `effortPaceShrunkTPace()` — a sibling of the existing `prShrunkTPace`, refactored to share one `shrinkTowardMileagePrior()` blend function (Rule 16: one blend formula, two callers).
  - `composeThresholdCapacity`'s mileage rung now computes BOTH a typed-PR candidate and an effort-pace candidate and spends whichever has the higher current WEIGHT (not whichever number is faster) — a genuine judgment call, argued in code: averaging two independent unverified self-reports would manufacture false precision (doctrine §38); always preferring one kind over the other regardless of staleness would ignore real information. New reason codes `ONBOARDING_EFFORT_PACE_USER_PRIOR` / `ONBOARDING_EFFORT_PACE_REJECTED`.
  - `ColdStartThresholdInputs.effortPaceSecPerMi?` / `.effortPaceDaysAgo?`, threaded into `coldStartThresholdCapacity` (the pure, no-DB seeder path) via the SAME validator, so the cold-start seeder and the DB-backed resolver cannot disagree about what counts as plausible.

### Before / after resolver output — REAL account, read-only, live against `DATABASE_URL_RO`
Picked live via a read-only query: a real onboarded account with `history_avg_weekly_mi = 30`, 0 logged runs. `resolveThresholdCapacity` called against the real database, pre-migration (today's actual production state):

```
LIVE resolveThresholdCapacity (real DB, today):
  sourceMode: 'user_prior', confidence: 0.15, paceSecPerMi: 503
  reasons: ['NO_DIRECT_EVIDENCE', 'ONBOARDING_MILEAGE_USER_PRIOR']
```
Same real 30 mi/wk mileage prior, fed through the pure `composeThresholdCapacity` core with a realistic effort-pace self-report (7:30/mi) overlaid — simulating "if this runner had answered the `.effort` question" (migration not applied, so this account has no such field today; the mileage-prior half is 100% real, the effort-pace half is the realistic hypothetical the report is honest about):

```
FIX #2 ALONE · same real mileage prior, + effort pace (7:30/mi):
  sourceMode: 'user_prior', paceSecPerMi: 471   (was 503 — 32 s/mi FASTER)
  reasons: [..., 'ONBOARDING_EFFORT_PACE_USER_PRIOR', ...]
```
471 sits strictly between 503 (mileage-only) and 450 (the raw effort-pace claim) — the shrinkage is doing its job: it moves toward the self-report, never all the way to it.

### Verification
- **`_capacity_resolver.test.ts`**, 5 new tests (4a–4e): a validated effort pace moves the prior conservatively as `user_prior` (4a); **falsified** — the identical fallback with the field absent (simulating pre-fix) produces byte-identical output (4b); an implausible pace (90 s/mi) is rejected with a reason and prices nothing (4c); an effort pace never outranks a real observation of the runner running (4d); when both a typed PR and an effort pace are on file, the resolver spends whichever it should trust more (weight), not an average (4e).
- **`tsc --noEmit`**: clean.
- **Doctrine Rule 7 check**: no new registry claim needed. The physiological mapping ("20-min hard effort ≈ LT pace") is cited in code comments to `Research/01`'s field-test table but is a SEMANTIC design choice (which capacity a self-report feeds), not a numeric constant that could silently drift — the actual numbers this reader uses (`PR_MIN/MAX_PLAUSIBLE_PACE_S_PER_MI`, `USER_PR_HALF_LIFE_DAYS`, `USER_PR_MAX_WEIGHT`) are pre-existing, already-argued CONVENTIONS (per `self-reported-pr.ts`'s own header, explicitly not doctrine-derived numbers), not new physiology assertions.

---

## 3 · Fix #3 — time off + prior mileage → `USER_PRIOR` + detraining discount

### What was broken
Native's `.timeoff` mode collects `offWeeks` (weeks off) and `offWeeklyMi` (weekly mileage BEFORE the break) — both "never referenced outside `OnboardingV5.swift`… the backend's own input contract has no field for this evidence at all" (IPR).

### The one genuinely new field
The pre-break MILEAGE half needs **no new field** — it reuses the EXISTING `weeklyMi`/`histAvg` payload keys (already accepted, already wired to `profile.history_avg_weekly_mi` and `loadOnboardingWeeklyMiPrior`/`priorWeeklyMi`'s `USER_PRIOR` mechanism, exactly the fix #2 pattern). The ONLY new field is the layoff length:

**`profile.history_layoff_weeks`** (migration 172, INT, nullable, `CHECK (... BETWEEN 0 AND 208)`).

### The detraining discount — doctrine-cited, continuous, capped
`Research/01-pace-zones-vdot.md` §"Triggers to retest" — the SAME table `vdot-gain-rate.ts`'s existing `MAX_BLOCK_GAIN_VDOT` already cites for the GAIN half of this row:

| Trigger | Action |
|---|---|
| Returning from layoff ≥2 weeks | Drop ~3–5 VDOT |
| Returning from layoff ≥6 weeks | Drop 5–8 VDOT |

New pure function `detrainingDiscountVdot(layoffWeeks)` in `capacity-resolver.ts`, exported: a continuous, monotone curve through the MIDPOINT of each band (4 at 2 weeks, 6.5 at 6 weeks) — ramping in from 0 at 0 weeks, capped at 6.5 beyond 6 weeks (doctrine states no third point; extrapolating past a cited band would be fabrication). No cliff anywhere (Rule 9). Applied ONLY on the mileage rung, ONLY when the self-report actually contributed (`prior.usedSelfReport`), scaled by `(1 − evidenceCoverage)` — the SAME complement that already retires the mileage self-report itself, so the discount fades to zero at exactly the point the self-report it discounts has already retired.

### New doctrine registry claim (Rule 7)
**`ADAPTATION.detraining-discount-knots`** in `lib/doctrine/registry.ts`, a sibling of the pre-existing `ADAPTATION.single-shot-vdot-magnitudes` (same doc, same anchor, same table — that claim reads the layoff row for a GAIN ceiling; this one reads the SAME two rows for a DISCOUNT floor). Asserts, parsed out of the doc at run time (never hardcoded on both sides):
- `LAYOFF_DISCOUNT_START_WEEKS` (2) / `LAYOFF_DISCOUNT_MIDPOINT_WEEKS` (6) match doctrine's stated trigger weeks.
- `LAYOFF_DISCOUNT_AT_START_VDOT` (4) sits inside doctrine's stated 3–5 band; `LAYOFF_DISCOUNT_AT_MIDPOINT_VDOT` (6.5) sits inside 5–8.
- The curve does not run backwards (6-week knot ≥ 2-week knot).

**Falsified before landing**: temporarily set `LAYOFF_DISCOUNT_AT_START_VDOT = 10` (outside the 3–5 band) → the claim failed with `LAYOFF_DISCOUNT_AT_START_VDOT = 10, outside doctrine's 3-5 band at 2 weeks` → reverted, confirmed passing again.

### Files changed
- **`web-v2/db/migrations/172_onboarding_evidence_fields.sql`** — see fix #2 (same file, second column).
- **`web-v2/lib/onboarding/complete-inputs.ts`** — `layoffWeeks: number | null`, bounded 0–208 weeks, `null` distinct from `0` (Rule 11 — "answered no time off" vs. "never answered").
- **`web-v2/app/api/onboarding/complete/route.ts`** — writes `history_layoff_weeks`.
- **`web-v2/lib/training/capacity-resolver.ts`** — `VdotFallbackRead.layoffWeeks?`, `loadOnboardingLayoffWeeks(userId)`, the discount application inside `composeThresholdCapacity` (§ above), `ColdStartThresholdInputs.layoffWeeks?` threaded into `coldStartThresholdCapacity`. New reason code `DETRAINING_DISCOUNT_APPLIED`.
- **`web-v2/lib/doctrine/registry.ts`** — the new claim.

### Before / after resolver output — REAL account, live
Same real account as fix #2 (30 mi/wk self-report, 0 runs), layoff only, no effort pace:

```
FIX #3 ALONE · same real mileage prior, + layoff:
  4 weeks off:  paceSecPerMi: 568   (was 503 — SLOWER, correct direction)
  12 weeks off: paceSecPerMi: 586   (SLOWER STILL — monotone with layoff length)
  reasons include 'DETRAINING_DISCOUNT_APPLIED' at both
```
A longer reported layoff produces a SLOWER (more conservative) prescribed threshold pace, monotonically — verified live on real data, not just in the pure-function sweep.

Combined with fix #2 (effort pace 7:30/mi + 8-week layoff, same real account): `paceSecPerMi: 504`, `reasons` carrying both `DETRAINING_DISCOUNT_APPLIED` and `ONBOARDING_EFFORT_PACE_USER_PRIOR` — the effort-pace self-report pulls the number back down close to baseline despite the layoff discount pushing the mileage anchor up first, a fully explainable interaction (a claimed 7:30/mi hard-effort pace implies materially better fitness than 30 mi/wk alone, even discounted for a two-month gap) rather than a bug.

### Verification
- **`_capacity_resolver.test.ts`**, 7 new tests (5a–5g): the discount reduces the estimate in the conservative direction (5a); **falsified** — identical fallback with `layoffWeeks` absent (pre-fix simulation) produces byte-identical output (5b); a Rule 9 continuity walk across 0–12 weeks in 0.25-week steps finds no cliff (5c); monotone across 0/2/6/20 weeks, capped beyond the 6-week knot rather than extrapolated (5d); the discount fades to zero at the SAME rate the self-report itself retires — full evidence coverage produces `population_prior` with no residual discount artifact (5e); a layoff report never applies when a measured VDOT or below-table anchor already answers (5f); `detrainingDiscountVdot` itself — exact doctrine knot values, capped, monotone across a fine sweep (5g).
- **A real-data edge case found and confirmed correct, not a bug**: on a LOW-mileage account (3 mi/wk), the discount reason fires but the numeric pace does not move — `conservativeVdotFromMileage(3)` is already at the Daniels table floor (VDOT 30), so a further discount correctly clamps at the same floor rather than going negative. Reported transparently rather than cherry-picking only the account where the effect is visible.
- **`tsc --noEmit`**: clean.

---

## 4 · The shared plumbing (capacity-resolver.ts), and why it is one diff

Fixes #2 and #3 land in the SAME functions of `capacity-resolver.ts` (`VdotFallbackRead`, `loadVdotFallback`, `composeThresholdCapacity`'s mileage rung, `ColdStartThresholdInputs`, `coldStartThresholdCapacity`) because they share the exact same admission mechanism doctrine specified — `USER_PRIOR`, mileage rung, `prPriorWeight`-shaped shrinkage. Splitting the two into separate hunks of these functions would be artificial; every touched block carries an explicit `// F074 fix #2` or `// F074 fix #3` (or both, where genuinely shared) comment tag so either fix's contribution can be located and reviewed independently — `grep -n "F074 fix #2"` / `"F074 fix #3"` across the diff finds every site.

**Backward compatibility, made structural, not just tested**: `selfReportedEffortPace` and `layoffWeeks` are OPTIONAL fields on `VdotFallbackRead` and `ColdStartThresholdInputs`. Every existing fixture across the codebase that builds one of these objects literally — `_capacity_resolver.test.ts`, `_cold_start_fixtures.test.ts`, `_brain_acceptance.test.ts`, `authoring-anchors.ts`, `_threshold_round_trip.db.test.ts` — compiles and behaves byte-identically with zero edits required. Confirmed: `tsc --noEmit` clean, and all five files' own test suites pass unchanged.

**Shadow-evidence-epoch re-pin**: `lib/adaptation/shadow-evidence-epoch.ts`'s digest pin on `capacity-resolver.ts` was re-computed and re-pinned WITHOUT an epoch bump (case b — "comments, types, tests or a refactor that cannot move a resolved value"), same classification as the original `coldStartThresholdCapacity` addition it sits beside. Argued explicitly: both new fields are optional, both new DB readers source from columns that do not exist in production today (migration not applied), so every activity any shadow record has ever compared against reads the identical "not on file" default before and after this change — the new branches are structurally unreachable by the current corpus. If the migration lands and a real account populates either field, the first activity that resolves through the new branch is a genuine belief change and earns its own epoch bump then, argued on what it actually moved.

---

## 5 · What must NOT change (verified, not assumed)

Self-reported experience level stays inert, per `TIEREVIDENCE-2`. Not touched by any file in this diff. `lib/plan/_declared_level_inert.test.ts` — 736 assertions across that file's own suite, green, both before this session's changes and after (this session never edited that file, `generate.ts`, `plan-templates.ts`, or anything in the experience-level derivation path in `complete-inputs.ts`, which is unchanged line-for-line — confirmed by `git diff` showing zero touches to the `experienceLevelRaw`/`hasExperienceEvidence`/`experienceLevel` block).

---

## 6 · Full verification run

- **`tsc --noEmit -p tsconfig.json`**: clean, zero errors, at every checkpoint through the session (initial edits, post-refactor, post-doctrine-claim, final).
- **Targeted suites** (`lib/training`, `lib/onboarding`, `lib/race`, `lib/doctrine`, `lib/adaptation/_belief_source_pins.test.ts`, `lib/audit/_coercion_scan.test.ts`, `lib/audit/_generated_content_gate.test.ts`, `lib/audit/_ui_computes_nothing.test.ts`, `lib/plan/_declared_level_inert.test.ts`): all green.
- **Full suite** (`npx vitest run`, whole `web-v2`): starting baseline (before any code touched) had 8 pre-existing failures in this sandboxed environment, none caused by this session — 6 were caused by two mechanical issues this session introduced and then fixed (see below); the remaining 4 were confirmed PRE-EXISTING and unrelated (2 need `DATABASE_URL_RO` — pass when it is set; 2 are in `lib/plan/_rolling_seven_ceiling.test.ts`, a file this session never touched, testing `generate.ts` logic unrelated to onboarding evidence).
- **Two mechanical bugs found and fixed during this session's own verification, both self-inflicted and both fixed**:
  1. `_generated_content_gate.test.ts` / `_ui_computes_nothing.test.ts` flagged false orphans and a false "surface computes a coaching primitive" — root cause: an apostrophe (`reader's`) inside a `//` comment sitting INSIDE a multi-line `import { ... }` clause broke `lib/audit/module-graph.ts`'s deliberately comment-UNAWARE crude import regex (a real, subtle scanner limitation, not a scanner bug to fix — the comment was moved outside the import statement). A second occurrence: my own comment text literally contained the string `bestRecentVdot`, tripping `_ui_computes_nothing.test.ts`'s naive text scan; reworded.
  2. `_coercion_scan.test.ts` flagged `parsePaceMinSec`'s `sec > 0 ? sec : null` as a zero-collapse at an engine module boundary — argued and registered in `COERCION_ARGUED` + `LOAD_BEARING_KNOWN` (`lib/training/vdot.ts::parsePaceMinSec::sec`): a parsed pace of exactly 0 s/mi is physically impossible (unlike a genuine "0 mi/wk" self-report), so there is no distinguishable "answered zero" state to hand a consumer — the collapse is the honest outcome, not an erasure.
- **Live, read-only, against `DATABASE_URL_RO`** (`postgresql://faff_readonly:...@crossover.proxy.rlwy.net:20769/railway`): confirmed migration 172's two columns do not exist in production; confirmed the two new DB-liveness audit tests (`_authoring_shadow_compare.audit.test.ts`, `_f038_reign_scoping.audit.test.ts`) pass when the RO URL is provided (they were only failing in the sandboxed default run because no DB URL was set at all — pre-existing environmental gap, unrelated to this work); ran the before/after resolver comparisons quoted in §§2–3 against a REAL onboarded account's REAL `history_avg_weekly_mi`. **Noted, not a regression**: pointing the shared `DATABASE_URL` at the read-only production role (needed so `resolveThresholdCapacity`'s internal pool could reach real data for the live comparisons above) makes `lib/postrun/_postrun_surface_parity.audit.test.ts` fail its own setup step, which needs to WRITE (expire stale workout proposals) against a genuinely writable scratch database — the production write-barrier correctly REFUSES that write against a real host, exactly as designed (`lib/verify/production-barrier.ts`). This is an artifact of using the RO role for read-only verification queries, not a defect in this branch's own code; the full-suite baseline cited above (§6) was run with no `DATABASE_URL` override at all, which is the representative comparison.
- **New test files**: `lib/race/_onboarding_recent_race.test.ts` (11 tests), `lib/onboarding/_complete_inputs_evidence.test.ts` (14 tests). **Extended existing file**: `lib/training/_capacity_resolver.test.ts` (+12 tests, 4a–4e and 5a–5g). All green; every falsifier confirmed to actually fail against the pre-fix shape before being confirmed to pass post-fix.

---

## 7 · Files touched (complete list)

New:
- `web-v2/db/migrations/172_onboarding_evidence_fields.sql` — NOT APPLIED (DDL awaits David's go)
- `web-v2/lib/race/onboarding-recent-race.ts` — fix #1, pure builder
- `web-v2/lib/race/_onboarding_recent_race.test.ts` — fix #1 tests
- `web-v2/lib/onboarding/_complete_inputs_evidence.test.ts` — fixes #1/#2/#3 intake tests

Modified (every touched block tagged `F074 fix #N` in-line):
- `web-v2/app/api/onboarding/complete/route.ts` — all three fixes' write sites
- `web-v2/lib/onboarding/complete-inputs.ts` — all three fixes' validators/fields
- `web-v2/lib/training/capacity-resolver.ts` — fixes #2 + #3, the resolver core
- `web-v2/lib/training/self-reported-pr.ts` — fix #2, `readSelfReportedEffortPace`
- `web-v2/lib/training/vdot.ts` — fix #2, `parsePaceMinSec`
- `web-v2/lib/training/_capacity_resolver.test.ts` — fixes #2 + #3 tests
- `web-v2/lib/doctrine/registry.ts` — fix #3, `ADAPTATION.detraining-discount-knots`
- `web-v2/lib/adaptation/shadow-evidence-epoch.ts` — re-pin for the capacity-resolver.ts change
- `web-v2/lib/audit/coercion-registry.ts` — argued exemption for `parsePaceMinSec`'s zero-collapse

**Not touched, checked and confirmed**: `web-v2/lib/plan/generate.ts`, `web-v2/lib/plan/plan-templates.ts`, `web-v2/lib/onboarding/state.ts` (the older web "Lilian" onboarding deck — out of scope, native V5 posts to the same `/api/onboarding/complete` route via `complete-inputs.ts` regardless of which UI collected the fields), any file under `native-v2/` (Swift — out of scope per this task).

## 8 · Scope boundary — what this does NOT yet do, stated so nobody assumes it does

1. **Native does not send these fields yet.** `HostsV5.swift`'s `submit()` still discards `recentRaceDistance`/`effortPace`/`offWeeks`/`offWeeklyMi` (confirmed by reading the current file — none of the three new payload keys this backend now accepts appear anywhere in `HostsV5.swift`). This is backend-readiness work; native wiring (plus, for fix #1, adding a recency-bucket question to the `.recent` screen) is separate, smaller, out-of-scope native work.
2. **`generate.ts` (live plan authoring) is not wired to `resolveThresholdCapacity`/these new fields.** This is a PRE-EXISTING, already-documented boundary — `capacity-resolver.ts`'s own file header states plainly: *"NOT WIRED. `generate.ts`... [is] untouched by this change and still resolve[s] paces the old way… Wiring them is the NEXT phase and is scoped separately."* This session's fixes make the evidence correctly reachable at the resolver layer (which is what the task's own verification section asks for and what was verified live in §§2–3); they do not additionally wire the resolver into the plan generator, which was never part of this task's scope and remains a separately-tracked phase.
3. **`ADAPTATION.single-shot-vdot-magnitudes`'s sibling scope**: the new doctrine claim (`ADAPTATION.detraining-discount-knots`) covers only the two new constants this fix introduces; it does not re-litigate the existing claim beside it.

## 9 · Out-of-scope finding surfaced in passing (not fixed, flagged separately)

`lib/plan/_rolling_seven_ceiling.test.ts` fails on `origin/main` today (pre-existing, unrelated to this branch — confirmed via `git status`, this session never touched `generate.ts` or that test file): *"the peak rolling-7 jumped on a hair of demonstrated peak: expected 2.5 to be less than or equal to 1"* — a Rule 9 (no-cliff) signature. Left alone per scope discipline; worth a dedicated look by whoever owns `generate.ts`'s ramp logic.
