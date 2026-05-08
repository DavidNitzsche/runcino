# Morning Summary — 2026-05-08

What landed overnight while you were asleep. Everything is on `main`,
deployed via Railway (now correctly tracking `main` after we set it
up earlier). Open the dashboard + a race detail page and the changes
are live.

## TL;DR

10 commits + 1 audit doc. ~2,500 lines of code change. Three big
arcs: (1) make VDOT meaningful, not just a number; (2) bridge
"today's prescription" to "the race calendar" with new dashboard
surfaces; (3) start consuming doctrine that the audit flagged as
fully extracted but invisible.

## Commit log

| SHA | What | Why |
|-----|------|-----|
| `a35a305` | VDOT C1 — tier doctrine + freshness window + testing cadence | Research/01 extended; tier classification, 56-day freshness, field-test protocols, calendar triggers all moved to cited doctrine |
| `1207464` | VDOT C2 — UX states (badge, staleness, no-data) | Dashboard tile shows tier (NOVICE/INTERMEDIATE/ADVANCED/ELITE), freshness chip (FRESH/STALE SOON/STALE/EXPIRED), and a NoVdotPanel listing field-test options when no recent race exists |
| `cf95b30` | VDOT C3 — age + sex grading + runner profile | New Research/24 doc; doctrine/grading.ts; localStorage runner profile (birth year + sex) editable on /profile; age-graded VDOT renders on the dashboard tile when known |
| `fb42263` | Coach plans a 5K time trial when VDOT is stale | New `vdot_test_5k` workout type; pickRun() swaps the next quality day for a TT when shouldPromptVdotTest fires; guards on TAPER + POST_RACE |
| `2f69332` | Next-30-days dashboard tile | simulateNext30Days() + NextSerialDaysTile; color-coded strip with race flags, month dividers, today ring; bridges "today" and "the race calendar" |
| `eb2604e` | Daily training brief on dashboard + "why?" affordance | New coach.briefDailyTraining() method (LLM + deterministic); CoachDailyBrief replaces the old WHY one-liner; same why-toggle now also on the race brief revealing citations + rationale |
| `cf8fc42` | Readiness banner — surface verdict + cite recovery doctrine | ReadinessAssessment grew signals + recommendedAction fields keyed to INCOMPLETE_RECOVERY_DECISION_MATRIX; new ReadinessBanner on the dashboard with green/yellow/red + expandable signals panel |
| `3d8e61d` | Hydration tile from Research/19 | HydrationTile on race detail: 24h/2-4h/final-hour pre-race plan, distance×temp ml/hr table, EAH guardrails. Direct response to audit's #2 finding |
| `269f8d9` | Brief owns description column (earlier in session) | Static narrative paragraphs killed; coach brief becomes the section's content; horizon-aware framing |
| `9f72bb9` | Brief reads training state — on-track/headroom/stretch (earlier) | trainingContext flows VDOT vs goal + volume picture into the brief prompt |

`docs/AUDIT-2026-05-08.md` — 511-line audit covering research
coverage, UI surface inventory, state flow, coach prompt inventory,
gap analysis (info we have but don't show), gap analysis (info we
want but don't have), and a prioritized recommendations queue.

## What you'll see

**Dashboard (`/`):**
- New: **READINESS banner** above the daily prescription — green/yellow/red
  with expandable signals (heavy block, ACWR, easy/hard imbalance, etc.)
- New: **COACH SAYS brief** — voice paragraph above the engine WHY
  one-liner; ▸ WHY? toggle reveals citations + rationale
- New: **NEXT 30 DAYS strip** — color-coded by workout type, race
  flags, distance numbers in cells ≥8 mi
- Updated: **VDOT tile** now shows tier (e.g. "INTERMEDIATE"),
  freshness chip ("FRESH"), age-graded VDOT line if profile is set,
  or a NoVdotPanel with test options when there's no recent race

**Race detail (`/races/[slug]`):**
- New: **HYDRATION tile** below splits + fueling — pre-race plan +
  during-race ml/hr table by temp band
- Updated: **brief** has a ▸ WHY? toggle revealing citations

**Profile (`/profile`):**
- New: **RUNNER PROFILE** section above training schedule —
  birth year + sex inputs (both optional), localStorage-backed,
  feeds the age-graded VDOT layer

**Engine:**
- VDOT pulls from a 56-day window now (was 28d), strongest race wins
- Coach prescribes a 5K TT when VDOT is stale or absent
- Readiness verdict cites Research/00b decision matrix

## Audit findings worth your attention

Top gaps the audit surfaced that I did NOT close overnight (high
value, scoped enough to deserve a focused session):

1. **`recovery_protocols.ts` is still mostly unconsumed.** The
   readiness banner taps INCOMPLETE_RECOVERY_DECISION_MATRIX, but
   POST_RACE_BY_DISTANCE, RACE_PRIORITY_RECOVERY, MARATHON_BIOMARKER_TIMELINE,
   REVERSE_TAPER_PROTOCOL — all defined, none consumed. The
   engine still has its own ad-hoc post-race ladder in
   `lib/coach-engine.ts:228-278`. Audit recommends consolidating.

2. **`/workout/[date]` page is entirely static placeholder.** Audit
   §2 §163 — this is on the dashboard's TODAY tile click-through
   path and is fake. Should render the actual day's prescription.

3. **`/health` page has 4 hardcoded "M2 placeholder" cards.** HRV,
   RHR, Sleep, Recovery score — all fake. HealthKit integration
   would unlock those plus 4 unwired CoachState fields.

4. **`/profile` long-run-day picker doesn't persist.** Local component
   state only. The runner profile I added (birth year + sex) DOES
   persist (localStorage); the picker should switch to the same.

5. **4 Coach methods still throw stubs.** paceStrategy, taperDepth,
   fuelingFor, retrospect, adjustForReality. The site has direct
   API paths bypassing each — Audit §4 details which.

6. **No HRmax / LTHR in CoachState.** The engine assumes 152 bpm
   for "yesterday hard" detection (190 × 0.80 hardcoded). Profile
   needs an HRmax field; assessReadiness would benefit immediately.

7. **Two parallel daily-card surfaces** — dashboard `CoachTodayCard`
   and `/training` `DailyBriefing`. Show overlapping but not
   identical content. Worth consolidating.

## Test status

- Typecheck clean (full `tsc --noEmit` runs in seconds, no errors)
- 96 tests pass across 11 suites (1 unrelated suite skipped — missing
  fixture `public/big-sur-3-50.runcino.json`, predates this session)
- New: 9 grading tests, 4 VDOT tier/freshness tests
- Total VDOT coverage: 30 assertions across vdot, vdot-sanity, grading

## Railway

- Source branch is `main` (we set this up earlier in the session)
- Latest deploys all passing — no crash emails since the source
  switch. Most recent ACTIVE is `cf8fc42`; `3d8e61d` was building
  when I checked at the end.

## Suggested next reads

- `docs/AUDIT-2026-05-08.md` for the full picture
- Try the dashboard, then a race-detail page, then `/profile` —
  fill in birth year + sex on the profile and watch the age-graded
  VDOT appear on the dashboard
- The brief is now adaptive on the race-detail (Course brief at 100
  days, Race-morning brief at 0 days, with training context woven
  in either way) — open AFC and a closer race to compare

## Open questions for you

- The Research/24 decline tables are Daniels-extrapolated. Long-term
  fix is vendoring the full WMA age-grading tables. Worth scoping?
- Recovery readiness uses ACWR-only signals today. The doctrine's
  signal matrix has 6 quantitative + 8 qualitative signals — most
  need HealthKit. Wire HealthKit next, or build Mock-HealthKit toggles
  for testing the matrix path?
- The engine's recovery ladder duplicates `recovery_protocols.ts`.
  Worth a focused refactor session to consolidate?
