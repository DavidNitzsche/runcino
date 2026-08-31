# faff.run — Project Memory

This project is a multi-surface running app for a competitive marathoner. Three surfaces share one source of truth: **web** (command center), **iPhone** (daily companion), **Apple Watch** (execution layer).

---

## What this app is for (locked 2026-08-30 — read this before anything else)

David's own words. Every rule, decision and plan in this file serves this
statement. If one of them ever contradicts it, the statement wins and the rule
is wrong.

> **"This is a training app not a live in the past app. What's happening week to
> week is what matters. With pace but also with volume. There's a world where I
> or other runners follow the plan, there's a world where we fall short, but
> ideally there's a world where we push forward and the plan has to push us more
> and more. That's what the app is for. To push."**

### What that means when you are writing code

**Three worlds, and the third is the one the app exists for.**

1. **The runner follows the plan.** It proceeds. This is the easy case and it is
   not the product.
2. **The runner falls short.** The plan responds in GRADED fashion — reshuffle
   early in the week when the stimulus still matters, absorb it late. A missed
   run is stated, never judged.
3. **The runner pushes forward — and the plan pushes back harder.** In PACE AND
   IN VOLUME. "More and more." A plan that only ever executes the curve it was
   born with is not coaching, and a plan whose only lever is "do less" is a
   safety system wearing a coach's clothes.

**"Week to week is what matters."** This is a forward-looking product. History
exists to size the next week and for no other reason. His ruling in the same
conversation: *"Past data can be messy, current runs in a plan is not."* Spend
the effort on the live loop — the run lands, the plan responds — not on
archaeology.

**"With pace but also with volume."** Both axes respond, or it is half a
response. An engine that re-anchors paces while the volume curve stays frozen
has answered only half the question.

### The asymmetry to watch for

Nearly every mechanism in this engine reduces: dosing caps, ramp ceilings, spike
guards, cutbacks, deloads, pull-backs, readiness suppression, taper. Measured
2026-08-30 across `lib/plan` and `lib/coach`: **117 files carry reducing
vocabulary against 37 carrying increasing vocabulary.**

That asymmetry is not automatically wrong — the guards are doctrine-cited and
injury-motivated, and Rule 8's corollary is explicit that a guard reading
absorbed tissue load must keep reading the literal recent number. **But a coach
whose only lever is "do less" is not a coach.** When you touch the adaptation
loop, ask whether the upward path fires as reliably as the downward one, and
whether the bar to go UP is higher than the bar to come DOWN. If it is, that is
a defect, and it is the one this app can least afford.

Pushing harder means **spending the headroom doctrine already allows** — never
weakening a guard to manufacture it. Current fitness is a SAFETY FLOOR, not a
ceiling.

---

## Required reading at session start

Read these in order before doing any design or implementation work in this project. Do not skim. Load them into context fully.

### 1. Design source of truth

**iPhone — `/Volumes/WP/06 Claude Code/Faff/design/0819/design_handoff_faff_iphone_app v5/`**

The approved iPhone design, 2026-08-19. **This is the phone product.** Its palette, typography, tokens and copy are final and are NOT to be reconciled against brief v2 — it supersedes brief v2 for the phone outright. Pure black ground, four surface steps, signal orange `#FF5A1F`, attention amber `#F2B03C` (also the `~` mark for a modelled number), fault red `#FF4438`, no green as a grade, six day-state gradients, Instrument Sans + Archivo 800/112.

Read `README.md` there first — it is the spec — and `docs/faff-iphone-design-contract.md` in this repo, which is what the backend can actually feed and the rules the design cannot break.

**Web and watch — `Design/running-app-design-brief-v2.md`**

Still governs those two surfaces only. Where it and the iPhone design conflict — it forbids orange, the phone accent is orange — **the iPhone design wins for the phone and brief v2 wins for web and watch.** Do not cite it as authoritative for the phone.

The complete design language, locked 2026-06-09 and enforced from build 200: the ten-color palette, typography (Oswald ≥16pt display · Inter below · Inter body), mesh doctrine, glass retirement, label grammar, banner caps, and the David-ruled addendum (TweakAccent exemption, phase-identity categorical group). Supersedes v1, which is archived at `Design/running-app-design-brief.md.archived` for reference only.

**Palette parity — corrected 2026-08-30, was stated as unconditional and no longer is.** CI-enforced by `scripts/check-palette-sync.sh`, but the gate has carried an open-ended exemption since 2026-08-18: web is mid-redesign (its own warm-paper-ground, 7-color state system — `docs/design/DESIGN-BRIEF-site-wide-redesign.md`) and every web-side byte-identical assertion is commented out, not deleted, pending re-enable once web's new palette locks and iPhone/watch are redesigned to match it. iPhone↔watch checks are untouched and still enforce byte-identical — that pair was never affected. Separately, the gate reports 49 files under `native-v2` still referencing the legacy phone palette (pre-iPhone-v5); that block self-expires (the assertion flips from "these values exist" to "these declarations must be deleted" once the count hits zero), tracked by the gate itself, not by a date here. Read the gate's own header comment for the live count and exemption state rather than trusting this paragraph's numbers as they age.

### 2. Knowledge base research

Two directories holding training methodology, data model, and domain context. Read everything in them:

- `BuildResearch/`
- `Research/`

The coach runtime pulls from these. Decisions about what each beat of a page should hold should be informed by what's in here, not assumptions.

### 3. Product surface specs

- `APP_FEATURE_SPEC.md` — whole-app surface map. What each surface (web, iPhone, watch) is for and what pages exist.
- `C1-overview-and-today.md` — element inventory for Web Overview and iOS Today, including the conditional layouts that promote, demote, add, and remove elements based on training state.

---

## Operating posture

- **The design brief is authoritative.** If existing components, tokens, or layouts conflict with it, replace them. Do not harmonize. Do not split the difference.
- **Light-theme work in the codebase is abandoned.** The app is dark. The palette in the brief is locked.
- **Composition is state-driven, not template-driven.** Pick what each beat of a page holds based on the C1 inventory and the user's current training state (off-season, base, build, peak, taper, race week, race day, post-race, injury). A page rendered race week and a page rendered four months out should look meaningfully different, not the same page with new numbers.
- **Coach voice, not app voice.** Short, direct, no hype, no exclamation marks, no emoji, no em dashes. See the brief's tone section for canonical examples.
- **Audit before changing.** When starting work on a new surface or component, audit what's already there against the brief and surface every conflict before acting. Don't silently rewrite.

---

## Conventions

- New design files under `docs/design/`.
- Research outputs under `docs/research/`.
- Product decisions documented in `docs/PRODUCT_DECISIONS.md`.
- The brief itself is editable. If you find a real reason to change a token, a rule, or a principle, propose the change explicitly rather than working around it.

---

## Race-data source-of-truth (locked 2026-05-19, citations re-pointed 2026-08-29)

**Before merging ANY component that displays race-related data, answer these four questions:**

1. **Does this display a race result?** (finish time, finish pace, PR, race comparison, aggregate VDOT, race-anchored prediction)
2. **If yes, does it read from `races.actual_result` first?** Curated chip times beat raw training-run elapsed.
3. **If it falls back to training-run data, is that fallback labeled as provisional?** (e.g., "Training effort · race to lock in", not "Personal Record"). Training-run data must never display as authoritative race performance.
4. **Does it skip auto-detected best-effort segments?** A 5K split inside a long run is not a 5K race; pulling `canonicalLabel` directly is how the phantom-5K bug landed in compute-vdot. If a race-result consumer reads `canonicalLabel`, it's likely wrong.

**The historical bugs that motivate this checklist** (all fixed by 2026-05-19, against the pre-rewrite app — table kept as-is for the archaeology):

| Bug | Component | Root cause |
|---|---|---|
| Phantom 5K · VDOT 33.6 in aggregate | `compute-vdot.ts` | LEFT JOIN to `strava_activities` allowed auto-detected splits to leak |
| Missing Sombrero Half | `compute-vdot.ts` | Dedup-by-canonical-distance dropped the slower of two HMs |
| Empty Personal Records card | `/races/page.tsx` | Read ONLY from `strava_activities.canonicalLabel`, never from `races.actual_result` |

**PORT-1 (2026-08-29):** `main` now builds and deploys `web-v2` only (`legacy/web` — where `compute-vdot.ts`, `/races/page.tsx`, `strava_activities`, and the old `audit-races` endpoint below all still live — is retired: root `package.json`'s build script and `railway.json` both point at `web-v2`, and `docs/OVERNIGHT-REPORT.md` confirms it isn't deployed). The bug table above stays as history, but **the schema changed**: there is no `strava_activities` table in `web-v2` — activity data lives in `runs` (`data` jsonb), and `canonicalLabel`/`canonicalFinishS` are present as keys but permanently null on every row (the auto-detected-best-effort mechanism was retired, not renamed — see `web-v2/lib/runs/run-shape.ts`'s `RunData.canonicalLabel` doc comment). `races.actual_result`/`races.meta` are unchanged in shape, now with `user_uuid`. The live implementation of this checklist:

- `web-v2/lib/race/personal-records.ts` — races.actual_result rung 1, training-run fallback rung 2, always `provisional:true` + captioned when it's a fallback.
- `web-v2/lib/race/retrospective.ts` — per-mile splits from `races.actual_result.miles[]` first; never reads `canonicalLabel`.
- `web-v2/lib/race/effort-authority.ts` — the effort-class authority pipeline.
- `web-v2/lib/doctrine/registry.ts` claims `EVIDENCE.chip-time-is-canonical` / `EVIDENCE.race-authority-is-the-effort-class` gate rungs 1-2 in CI on every build.

**Reference docs:**
- `docs/simulations/race-data-source-audit-L6.md` — the 11-component audit confirming clean state as of the pre-rewrite app; treat as historical, not current
- `web-v2/app/api/admin/audit-races/route.ts` — diagnostic admin endpoint for ongoing data drift detection, re-derived 2026-08-29 against the live `races`/`runs` schema (the old `web/app/api/admin/audit-races/route.ts` this pointed to only exists under retired `legacy/web` and is not reachable on the live app)

**Non-race-result consumers** (these correctly use `runs`, not `races`):

- HR readings (`validate-max-hr.ts` reads `maxHr` and `avgHr` from training runs)
- Activity caching / ingest (`web-v2/lib/runs/*`)
- The sync layer itself (Strava/HealthKit ingest routes)

The distinction is *what you're surfacing*: race performance → `races` table; training data → `runs` table. Use the right source for the right job, not "races good, everything else bad."

---

## Operational vs decision vs external (locked 2026-05-19)

The boundary that decides whether the agent acts, asks, or confirms before touching something. Three distinct buckets:

### 1. Operational tasks · self-execute

Run as part of the work. Surface results, not requests to trigger.

- Backfills, internal data populations (e.g., `/api/admin/backfill-splits`)
- Running diagnostics endpoints the agent built (`l7-signal-view`, `audit-races`, `race-hr-diagnostic`)
- Invoking endpoints the agent built itself, including read-only admin routes
- Test runs, typecheck, lint
- Sync checks, status probes
- Reading data that exists in the system to verify its own work

The pattern is: agent built it → agent knows it's safe → agent has rate-limited it → agent runs it. The result goes in the status surface, not a "go run this" instruction. Buttons buried in status docs get missed when shipping fast.

### 2. Decisions · explicitly flag as blockers

Pause. Ask. Resume after answer.

- Combined-rule shapes when multiple valid options exist (e.g., "either signal fires alone vs. softer combined threshold")
- Threshold values where the right answer isn't physiologically obvious
- Architectural splits where the trade-off is real (DI vs. direct DB, lazy vs. eager fetch)
- Scope expansions beyond the explicit queue
- Anything where two defensible answers exist and the wrong one creates structural debt

The pattern is: state the decision, state the options, state the default if no answer, pause. Resume the moment an answer lands.

### 3. Externally-consequential actions · require confirmation

These touch the outside world or cost real money/trust. Confirm before each one.

- Sending email
- Deleting files, rows, or external resources
- Spending money (API costs are usually fine; service-tier upgrades aren't)
- Touching public-facing surfaces (production deploys, public posts, live data the user-facing app reads in a way the user can't undo)
- Anything destructive that can't be reversed by running the inverse command

The pattern is: name the action, name what it touches, name what reverses it, confirm.

**Why this matters:** the bug class is "agent buries an action in a status doc → user misses it → expected outcome never happens → agent's report drifts from reality." Operating boundaries fix the bug class. Buttons in status docs get missed; decisions correctly flagged get answered; external actions correctly gated stay safe.

---

## Per-finding context filters (locked 2026-05-19 round 4)

**When a surface aggregates multiple downstream findings, each finding applies its own context filters concretely. A surface-level guard doesn't protect sub-findings.**

The bug pattern this fixes: V5 Z2 stimulus check has a race-week suppression at the surface level (whole banner suppresses within 7 days of a race). But the *threshold under-reach* sub-finding inside the surface walked workouts independently and picked up a taper workout from 3 days pre-Big Sur — pace in T-band, HR sub-Z4, looked exactly like the "easy days too hard → can't reach Z4" symptom we surface. Was actually intentional taper conservation. The surface's race-week guard would have correctly suppressed the whole banner *if today were 3 days from a race*. But today is 23 days post-Big Sur — the surface fires correctly, and the sub-finding has to apply its OWN race-recency filter to skip the historical taper workout.

**The rule, concretely:**

- A surface that aggregates N findings runs N filter applications, one per finding.
- Inheritance is semantic, not automatic. The parent surface's filters describe *what context distorts this whole story*; each child finding asks *what context distorts THIS specific observation*.
- Same architecture as L7 Signal 1's per-observation filtering: signals walk activities, and each activity gets its own context resolution (heat, race-recency, hr-missing) before contributing to the rollup.

**Where this applies going forward:**

- Readiness scores aggregating sleep + RHR + training load — each input filtered separately
- Weekly summaries pulling daily executions — each day filtered for race-week, illness, weather
- Plan adherence reports — each missed/modified session filtered for context (rain day, sick day, deliberate cutback)
- Season retrospectives — each phase's findings filtered for the conditions specific to that phase
- Any future "explain this trend" surface — each datum filtered, not just the trend window

If you're building a surface that combines multiple observations into a unified story, list out every observation the surface depends on and apply the same context-filter taxonomy to each. The parent's filters don't propagate automatically; you propagate them explicitly.

This rule was caught on first prod run of the V5 Z2 stimulus check. The cost of inheritance-by-assumption: a coaching observation that would have blamed easy-day load for what was actually planned taper conservation. The cost of doing this right: a few extra lines that ask the same race-calendar question for each finding instead of trusting the parent guard.

---

## Rule 6 · Multi-writer jsonb columns require field-level updates, not full-replace upserts (locked 2026-05-19 round 5)

**Promoted from candidate after second instance found in `lib/race-store.ts:saveRaceDB` during the queued pre-emptive audit. Same shape, different column. The candidate-stage discipline worked: the second instance was recognized at first sight instead of looking novel.**

**2026-08-29:** `lib/race-store.ts` only exists under retired `legacy/web` now (see the Race-data source-of-truth section above for why). The live `races.actual_result` write site is `web-v2/app/api/race/result/route.ts`, which applies this exact pattern — the route's own header comment cites "Rule 6" by name and does the merge as `COALESCE(actual_result, '{}'::jsonb) || $2::jsonb`. Verified compliant as of that date; check there, not `race-store.ts`, if auditing this rule against the live app.

When two or more code paths write to the same jsonb column with different field coverage, naive full-replace upserts silently erase fields the active writer doesn't know about. The active writer overwrites the inactive writer's contributions because `SET column = EXCLUDED.column` can't distinguish "writer didn't include this field" from "writer intentionally cleared this field."

### The failure pattern

Three known instances at the time of locking:

| Column | Multi-writer | Detail-only field | Status |
|---|---|---|---|
| `strava_activities.data` (multi-tenant) | `syncSingleActivity`, `syncStravaForUser`, backfill | `splits` | Fixed `d114c35` |
| `strava_activities.data` (legacy single-tenant) | `strava-cache.ts:refreshActivities` | `splits` | Fixed this round |
| `races` (jsonb-shape body) | `saveRaceDB` (editor POST + rebuild) | `actual_result` | Fixed this round |

### The fix pattern

`jsonb_set` (for jsonb columns) or `CASE WHEN ... ELSE` (for whole-jsonb columns) with a guard that preserves the existing field when the new payload doesn't carry it. Always symmetric across all writers.

```sql
-- pattern A · field inside a jsonb column
SET data = CASE
  WHEN strava_activities.data ? 'splits' AND NOT (EXCLUDED.data ? 'splits')
  THEN jsonb_set(EXCLUDED.data, '{splits}', strava_activities.data->'splits')
  ELSE EXCLUDED.data
END

-- pattern B · whole-column jsonb that's detail-only
SET actual_result = CASE
  WHEN EXCLUDED.actual_result IS NOT NULL
  THEN EXCLUDED.actual_result
  ELSE races.actual_result
END
```

To explicitly clear a preserved field, callers must use a purpose-built setter (e.g., `setActualResultDB(slug, null)`). The default save path always preserves — explicit destruction beats silent destruction.

### How to detect this pattern in your code

Grep for `SET <column> = EXCLUDED.<column>` patterns. For each match, ask:

1. **Is the column jsonb (or jsonb-typed)?** If no, skip — non-jsonb upserts have schema-enforced shape.
2. **Are there multiple writers to this column?** If only one writer, the bug can't fire; still consider whether future code might add a second.
3. **Do the writers have different field coverage?** Most importantly: does any writer NOT populate every field that some OTHER writer populates? If yes, the gap is the bug surface.

If 1+2+3 all yes → apply the guard. If 1+2 yes but 3 unclear → audit the field coverage explicitly before deciding.

### How to test

Simulate writer-A-then-writer-B sequences:

1. Writer A inserts row with field F populated.
2. Writer B updates same row, payload lacks field F.
3. Assert field F is still present after writer B's update.

If you can't write this test cheaply, the write path probably has the bug.

### Lesson worth holding

The candidate-stage naming worked. The splits-preservation bug fix in `d114c35` had a one-time feel — "we fixed it, move on." Pre-naming the candidate rule turned the second instance from "huh, weird, another bug" into "oh, that's the same shape as splits, apply the same guard." Time-to-recognize dropped from 45+ minutes (splits) to under 5 minutes (race actual_result). Pattern recognition compounds when patterns are named.

---

## Rule 7 · A constant that asserts physiology carries a registry entry (locked 2026-08-17)

**Nothing in the app should happen that isn't aligned with the doctrine.** The existing gates (`_maint_invariants.test.ts`, `_sweep_allusers.test.ts`) check that a plan is well-*formed* — placement, distance, alignment, counts. Nothing checked that it *agrees with the research*. That gap shipped a defect David caught on his phone: post-race recovery for a half prescribed 15 miles across 14 days, five straight rest days, off a 33 mi/wk base with a goal marathon 16 weeks out. `Research/00b` has two adjacent columns — "total recovery days (no quality)" (half = 10-14) and "days of zero/very-light running" (half = 3-5) — and the engine spent the first as if it were the second, then sized every distance off the marathon reverse taper. Fixed in `52174bcd`.

### The gate

- `web-v2/lib/doctrine/registry.ts` — the claims. Each binds an engine constant to a doctrine file, a **verbatim anchor string** in that file, and a plain-English statement of what doctrine says.
- `web-v2/lib/doctrine/_doctrine_gate.test.ts` — resolves every anchor against the real file and runs every claim's predicate.
- `web-v2/lib/doctrine/_doctrine_lint.test.ts` — scans source for the recurring shapes: a distance category carrying another's value, a doctrine table read at one hard-coded distance, a distance-keyed table with no claim watching it, a `Research/` citation that no longer resolves.
- `scripts/check-doctrine.sh` — CI entry point, sibling of `check-palette-sync.sh`. Wired into `web-v2` `prebuild`, so it runs on every Railway build alongside the palette lock. Also `npm run test:doctrine`.

### Adding a claim when you touch a training-science constant

Append an entry to `DOCTRINE_REGISTRY`. Nothing else needs touching.

1. **Anchor on quoted text, never a line number.** A table header row or a section heading. Line numbers rot on the next edit — the incident's own bug report cites `00b:196-204`, which is already fragile.
2. **Read the numbers out of the doc.** Parse the band from the cited passage at run time and compare the engine against it. A check that hardcodes both sides only proves the test agrees with itself. `RECOVERY.half-protocol-run-days` is the model: it counts the running days in the doc's own 14-day table and asserts the constant equals that count.
3. **Keep the format contract** — one single-line quoted `id:`, `doc:` and `anchor:` per claim. That's what lets the CI script verify citations with no TypeScript toolchain, on a cold container.

### If a claim reveals a real violation

Do **not** loosen the claim. Add a key to that claim's `exempt` map with an honest reason, and say so in your report. Exemptions are checked for staleness: fix the engine and the gate makes you delete the entry. The same applies to the lint's allowlists.

### Not yet seeded — claim areas still unwatched

**2026-08-29 sweep:** this list had gone stale — most of it was already seeded in the ~289-entry registry without the checklist being updated. Re-audited against the live registry; corrected below. Append new areas as the engine audit reaches them, and when you close one, say so with the claim id (the pattern the dosing-caps line set) rather than just deleting the bullet — a bullet that vanishes silently is exactly how this list went stale the first time.

- ~~Daniels' weekly dosing caps~~ — CLOSED 2026-08-28: enforced at authoring (`applyDosingCaps` inside `finalizeComposedPlan`), fatal in `validateComposedPlan` §10, corpus-gated by `_dosing_sweep_gate.test.ts` (full archetype matrix, zero enforced findings), bound by `DOSING.enforced-findings-bind-the-composer`. Taper/race weeks keep their doctrine-cited percentage exemption.
- ~~Polarized intensity distribution (70-80% E, 10-15% M+T, 10-15% I+R)~~ — CLOSED (seeded before this sweep, checklist just never caught up): `INTENSITY.non-easy-remainder` checks both Polarized and Pyramidal TID shapes against the easy-share floor and cross-checks the per-pace weekly caps against it.
- ~~`validate.ts` `longRunWoWMaxPct` / `weeklyVolWoWMaxPct`, and `longRunCapMi`'s absolute per-distance ceilings~~ — CLOSED: `LONGRUN.wow-single-step-cap-is-the-injury-red-line` and `LONGRUN.validator-cap-is-the-elite-band`; `weeklyVolWoWMaxPct` is guarded as *removed* (a claim fails if it reappears).
- The `PLAN_TEMPLATES` table in `plan-templates.ts` — **partially closed**. `TEMPLATE.quality-character-and-volume-match-doctrine` checks `qualityCharacter`/peak-volume/peak-long-run per row against `Research/22`'s own table cells (caught a real Marathon/Half-Marathon row-confusion bug on first run). Still open: the free-text `source` field (e.g. `'Pfitz 18/70-18/85'`) that names which book a row structurally follows is declared but never runtime-checked against what `Research/22` says for that cell — nothing catches a future misattribution there.
- Heat, dewpoint and WBGT adjustments (`Research/06`, `lib/weather/heat-adjustment.ts`) — CLOSED: `HEAT.*` (6+ entries), with one explicit `altitude-trigger-unimplemented` exemption ("no altitude-aware training path for this trigger to sit on").
- Fuelling: carbohydrate g/hr and hydration bands (`Research/18`, `Research/19`) — **partially closed**: `FUELING.race-carb-rate-by-distance` (`Research/18`) is seeded; nothing yet cites `Research/19` (hydration/electrolyte bands) specifically.
- Strength programming dose and taper-week caps (`Research/07`) — CLOSED: `STRENGTH.phase-frequency-cap-matches-the-matrix`.
- HRV / RHR / ACWR readiness thresholds (`Research/15`) — CLOSED: `SAMPLING.*`, `READINESS.*`, `CONVERGENCE.*`.
- Injury walk-run ladders and per-pathology return protocols (`Research/05`, `lib/plan/injury-builder.ts`) — CLOSED: `INJURY.walk-run-ladder-is-encoded-verbatim` (stage-for-stage verbatim) + `INJURY.walk-run-is-priced-at-the-runners-own-easy-pace`.
- Age and sex grading (`Research/13`, `Research/24`) — **still open**. Only 2 entries cite `Research/13` (luteal-phase HR/HRV); nothing cites `Research/24` (VDOT age/sex grading) at all.
- `fitness-trajectory.ts` gain rates (`BASE_BUILD_RATE`, `MAX_BLOCK_GAIN`) — CLOSED: `ADAPTATION.vdot-gain-rate`, `ADAPTATION.single-shot-vdot-magnitudes`.
- Altitude, treadmill and terrain pace conversions (`Research/01` §course/weather) — CLOSED: `TERRAIN.*`.

**Genuinely still open, going forward: age/sex grading (`Research/24`, `Research/14`), hydration bands (`Research/19`), and the `PLAN_TEMPLATES.source` attribution check.**

---

## Rule 8 · A taper or a recovery window is never the runner's normal (locked 2026-08-30)

**Any reader that answers "what does this runner normally do" MUST exclude days
the engine itself prescribed as taper, race week, or post-race recovery.** Not
"should where convenient." Never, in any reader, for any runner.

David, twice, in his own words: *"It cannot look at taper and recover as my
'normal'. Ever."*

### Why this is a rule and not a bug

It has now produced at least six distinct defects in one engine, every one of
them found by the runner and none by any gate, because the outputs were all
well-formed:

| Reader | Read | Truth | What it caused |
|---|---|---|---|
| `recentWeeklyMi` (28-day mean) | 31.6 mi/wk | sustained 43.5 | Marathon block opened at 31 mi/wk |
| `easyDayMedianMi` (14-day) | 4.0 mi | 90-day median 6.0 | Four-mile easy days for a runner whose easy days were 3-7.8 |
| `recentQualityPerWeek` | 0/wk | habit is 2/wk | One quality session in week 1 instead of two |
| `recentLongMi` (28-day max) | 13.5 mi | 18.0 on 2026-07-25 | Long-run ramp anchored to a taper long |
| `resolveRampBase` mean | depressed | — | Return-to-volume ladder switched off entirely |
| `weekly_frequency` derivation | median 5 | runs 6 | Would have capped a six-day runner at five |

The shape is always the same: **the engine measures the runner during a period
IT told him to go easy, and reports the result as his training identity.** The
plan then sizes his next block off his own taper. Every number is arithmetically
correct against its window; the window is the defect.

### What to do

Exclude the window, do not shrink it. A wider average still contains the taper;
it just dilutes it. The excluded range for each race the runner actually ran is
its taper lead-in through its post-race recovery window — `BLOCK_SHAPE[cat]
.taperWeeks` before, `postRaceRecoveryWeeks(cat, priority)` after. Those are the
same numbers `allowedInterruptionWeeksFor` already computes, and they are
doctrine-bound; do not re-derive them.

If excluding leaves too little data to answer honestly, **say so and refuse**.
Falling back to the contaminated window is how every row above happened. A
refusal is a correct answer; a confident number measured off a taper is not.

Corollary, and the reason a surface-level guard is not enough: this is the same
discipline as the per-finding context-filter rule locked 2026-05-19 round 4. A
zero measured inside a prescribed recovery block and a zero measured off a
detrained runner are OPPOSITE FACTS. Code that collapses them into "zero" has
lost the only thing that mattered. Ask *why* the window is low before spending
the number.

### The corollary · which readers this does NOT apply to

**Filter a reader that asks what the runner CAN DO. Do not filter one that asks
what the runner HAS RECENTLY ABSORBED.**

Rule 8 says a taper is never his NORMAL. It does not say the taper did not
happen. Habit and capability are Rule 8 questions; tissue load and injury
exposure are not. Over-applying this rule makes a safety guard MORE permissive
in exactly the situation it exists for — a ramp check measured against a
pre-taper self waves through a jump the legs have not been prepared for.

Two readers hit this fork independently on the night the rule was written, and
both split the same way:

- **`recentPeakLongMi`** was two questions under one name. Its HABIT half is now
  filtered (18.0 mi, his real longest). Its SPIKE-ANCHOR half keeps the literal
  prior-30-day max (13.5 mi), because `Research/00a`'s ">110% of the longest run
  in the prior 30 days = 64% injury risk" writes its own window into the citation.
- **`trailingAvgWeeklyMi`** feeding the validator's ramp check stays unfiltered
  for the same reason: it is an injury guard, and what the connective tissue will
  experience next week is a function of what it actually did, not of what this
  runner normally does.

When a reader turns out to be answering both questions, **split it** rather than
picking one. One name for two quantities is a Rule 16 violation as well.

### Where this is enforced

`lib/training/normal-window.ts` is the shared filter and the only definition —
an in-memory lane, a `NORMAL_TRAINING_DAY_SQL` lane modelled on
`CANONICAL_ROW_SQL`, and a `NormalReading<T>` refusal contract whose refusal
branch carries **no `value` field**, so `reading.value` does not compile until
the caller branches. That makes Rule 11's zero-versus-refusal distinction a type
error rather than a discipline, which is the strongest enforcement available and
the pattern to copy. `scripts/check-normal-window.sh` is its gate, in `prebuild`.

`docs/PRODUCT_DECISIONS.md` records the calls. When you add a reader that
measures habit — frequency, typical distance, typical intensity, typical
anything — apply the filter, and say in the code comment which window you
excluded and why. If you exempt it, say which side of the corollary it falls on.

**The filter, and the gate (2026-08-30).** There is now ONE definition, so no
reader has to get this right on its own:

- `web-v2/lib/training/normal-window.ts` — the shared filter. Two shapes,
  because readers need both: `isPrescribedNonNormal` /
  `excludePrescribedDays` / `representativeDayCount` for code that already
  holds the rows, and `NORMAL_TRAINING_DAY_SQL` (via `normalTrainingDaySql` +
  `normalWindowParams`) for readers that filter in the query — one exported
  constant with a doc comment, modelled on `CANONICAL_ROW_SQL`. It REUSES the
  doctrine numbers rather than re-deriving them: `TAPER_WEEKS_BY_DISTANCE`
  (which `TAPER.trajectory-build-weeks` already pins to
  `BLOCK_SHAPE[cat].taperWeeks` literal-for-literal in CI) and
  `postRaceRecoveryWeeks`. `normalWeeklyMileage` is the habit twin of
  `recentWeeklyMileageMi`; the two are separate functions on purpose, so a
  call site has to say which question it is asking.
- The refusal is a TYPE, not a number. `NormalReading<T>` is a discriminated
  union whose refusal branch carries no `value` field at all, so
  `reading.value` does not compile until the caller has branched. That is the
  clause the one-quality-day defect broke: a zero because the plan prescribed
  recovery and a zero because the runner is detrained are opposite facts.
- `web-v2/lib/audit/normal-window-registry.ts` +
  `_normal_window_scan.test.ts` + `scripts/check-normal-window.sh` (wired into
  `web-v2` `prebuild`, so it blocks a Railway deploy). A scanner finds SQL that
  aggregates the runner's own `runs` over a rolling window and demands the
  filter or an argued exemption; a curated registry carries the readers the
  scanner cannot see, because they aggregate in TypeScript. Both allowlists are
  ratchets, a stale exemption fails until deleted, and a scanner-liveness probe
  fails loudly rather than reporting clean if the predicate stops matching.
- Exemptions can be per STATEMENT, not just per file, because a file can sit on
  both sides of the corollary. `lib/plan/generate.ts` is the case: its habit
  readers are filtered and its two injury guards are excused by SQL fingerprint,
  both citing one shared `ABSORBED_LOAD_NOT_CAPABILITY` text rather than two
  ad-hoc reasons. The file itself is never exempt, so anything else in it still
  fails, and `NORMAL_WINDOW_FILE_PINS` holds its total finding count as a
  backstop against a fingerprint written too broadly.

**Where the two windows in this app disagree, and why (settled 2026-08-30).**
`lib/coach/easy-discipline.ts`'s `raceWindowFor` and the plan engine's tables
both name "days around a race that are not ordinary training", and they diverge
on two rows. Neither citation is wrong — the divergence is entirely
GRANULARITY, and it is written down here so the next pass starts from the
evidence:

- `raceWindowFor` reads DAYS, and matches its two sources exactly: post-race is
  `Research/00b` §"Recovery by Distance" · "total recovery days (no quality)"
  upper bound (5K 5, 10K 7, half 14, marathon 28); pre-race is `Research/08`
  §9.1's taper-length upper bound (5K 7, 10K 10, half 14, marathon 21).
- The engine's `POST_RACE_RECOVERY_WEEKS` and `BLOCK_SHAPE.taperWeeks` are
  WHOLE WEEKS, and round in opposite directions on the two sub-week rows: 10K
  pre-race 7-10 days rounds UP to 2 weeks (14), and 5K post-race 3-5 days
  floors DOWN to 0.
- Consequence for `normal-window.ts`, which inherits the week-granular tables:
  it over-excludes 4 days before a 10K, which is the safe direction (at worst a
  refusal), and **under-excludes up to 5 days after a 5K**, which is not — a
  runner's post-5K no-quality days currently count as his normal. Small, and
  real. Fixing it means changing `POST_RACE_RECOVERY_WEEKS['5k']`, which is a
  doctrine-bound engine constant that also moves plan composition, so it is a
  call for whoever owns that table rather than a patch to the filter.

---

## Rule 9 · A hair's difference in input must never produce a categorically different plan (locked 2026-08-30)

**If two adjacent inputs a tenth of a mile apart produce plans that differ in
kind rather than degree, that is a defect, not a boundary.**

The apparatus could not see this class at all. As the gate audit put it: *every
gate samples the output space at POINTS and asks whether each point is legal.
That is precisely the check a discontinuity passes, because both sides of a
cliff are legal plans. Nothing sampled the derivative.* 11,598 archetypes pass
either side of every cliff below.

Found in one evening, all verified:

| Site | The cliff |
|---|---|
| `resolveRampBase` `lifted` | `0.70 × sustained > mean` switched the whole three-week return ladder on or off. The owner sat 1.15 mi from it — and **the good week he had just run is what pushed him to the worse side** |
| `interruptionWeeks` | An entire BASE phase appears or disappears on **0.20 mi/wk** |
| `generate.ts:3489` long sizing | Two different formulas. Peak 36.3 → 14 mi long; peak **36.5 → 12 mi long**. More volume, shorter long run |
| `achievable-target.ts:196` | A goal at 95.1% of ceiling is prescribed at the goal; at 94.9%, at the ceiling. **Being slightly more ambitious buys a ~25 s/mi slower race pace** |
| `generate.ts:9896` taper restore | 88.2% of target stays; 87.9% is lifted to 100%. Non-monotonic |

Note the recurring signature: **the fitter runner gets the worse plan.** Any
time you find that, you have found one of these.

**To comply:** a behaviour may be discrete (a phase exists or it does not), but
the DECISION must not hinge on a hair. Use hysteresis, or a more robust input,
or interpolate. Widening a tolerance around the same threshold relocates the
cliff, it does not remove it.

**Before smoothing a threshold, ask what question it is actually answering.**
The best fix found on the night this rule was written removed a cliff instead of
smoothing it. `adapt.ts` gated overshoot detection on `scheduledMi >= 5`, and
the walk measured a **40-mile jump in baseline for 0.1 mi of schedule** — the
plan that asked for more got the cut. But `scheduled_mi` came from
`COALESCE(SUM(...), 0)` and is never null, so the five was a MILEAGE proxy for a
**data-presence** question: "did this window have scheduled days at all?" The
query now returns the scheduled-day COUNT, the decision rests on a discrete
honest fact, and there is no threshold on a continuous quantity left to smooth.

A threshold standing in for a question it cannot actually ask is the strongest
form of this defect, and interpolating it would have preserved the confusion in
a nicer shape. Two more from the same pass, both worth recognising:

- **Doctrine's number is a control point, not a step.** ACWR's 1.3 and 1.5 are
  real research figures and stay exactly where they are; only the RESPONSE runs
  continuously through them. `Research/15` says so itself, one paragraph under
  the table — *"not a stop-light … a ratio of 1.4 in itself is not a verdict"* —
  and the old step gave 1.4 the full elevated penalty. That was doctrine
  restored, not bent. (The owner's own ACWR hit **1.303** on 2026-08-24, three
  thousandths past the edge, and crossed 1.3 four more times in thirty days.)
- **A band has ONE edge.** The race-target cliff spent doctrine's 5% band twice
  — forgiving inside it, then snapping back PAST it to the unreduced ceiling —
  which cost **600 seconds of prescribed race target for a one-second change of
  stated goal.** `max(goal, floor)` is continuous and monotone by construction.

**Enforcement:** `_restore_continuity.test.ts` and `_coach_sensible.test.ts`
walk a synthetic runner across each boundary in small increments and assert the
output vector moves continuously and monotonically. **Any new behavioural switch
derived from comparing two computed quantities gets a walk.** Both were falsified
against the unfixed engine before landing.

---

## Rule 10 · A persisted derived value carries its anchor, or it is recomputed (locked 2026-08-30)

**A value derived from a physiological anchor — LTHR, HRmax, VDOT, threshold
pace — that is written to a row and read back as authoritative MUST either carry
the anchor it was computed from, or be recomputed at read time.**

Every existing guard is blind to this by construction. `lib/runs/derived-registry.ts`
has nine families and all nine ask whether a row agrees with ITSELF.
`reconcileHrZones` asks whether five numbers sum to 100. **A stale distribution
is internally perfect — that is exactly why it survives.**

What it cost: `runs.data.hrZonePcts` was frozen at LTHR 162, so an easy 13.5-mile
long run displayed **60% Zone 5** and kept displaying it after the anchor moved to
168 (correct value: 27%). `plan_workouts.workout_spec.hr_cap_bpm` freezes at
authoring across 666 rows; worse, `recompute-paces.ts` reads the frozen
`authored_state.lthr_bpm` rather than `profile.lthr`, so the mechanism meant to
keep a plan current **re-cements the staleness**. `users.max_hr` holds 181 from a
single 2025 sample while the live resolver returns 180.

**To comply:** stamp `{anchor, value, at}` beside the derivation, and at read
time pick one of three postures explicitly — **recompute** (where the inputs
survive), **refuse or label**, or **exempt with an argued reason** (freezing is
sometimes the intent: a watch heat-easing band records what the wrist actually
held, and re-deriving it would be the bug).

**Enforcement:** to build, as a sibling of `check-doctrine.sh` — scan for writes
of a derivation into a persisted column and fail any site with no stamp and no
declared posture. `resolveHrZoneShares` in `lib/coach/hr-zone-bucket.ts` is the
worked example of the recompute posture.

---

## Rule 11 · "Don't know", "measured zero" and "the read failed" are three facts, never one (locked 2026-08-30)

**Code that collapses them has thrown away the only thing that mattered.**

This is Rule 8's corollary generalised, and it is the single most productive bug
shape in this codebase:

- `recentQualityPerWeek` returned a real, correct **0** — the runner had been in
  a prescribed recovery block. `generate.ts` coerced it to `undefined`, the
  caller read that as "no signal", and answered with **full quality density**.
  The safest possible reading of the data produced the most aggressive plan.
- `easyDayMedianMi` swallows a failed read and returns `0`, which silently
  disables the easy-day floor. Its sibling `recentQualityDistanceMi` did the same
  and, by its own header comment, *"the Rule 2 floor never fired since it shipped."*
- `profile.weekly_frequency` NULL — for **8 of 16 production profiles** — reads
  as "legacy, fill every slot" and silently disables **thirteen** mechanisms,
  including the per-easy-day floor and the per-day quality ceiling. The day count
  came out right by accident, so nothing looked wrong.

**To comply:** a reader returns a value, an explicit "no data", or an explicit
failure — three states, distinguishable downstream. **A missing input must never
silently disable a safety mechanism**; if a guard cannot run, that is a refusal
worth surfacing, not a default worth assuming. Ask *why* a number is low or
absent before spending it.

**Enforcement:** `check-swallowed-failure.sh` and its ratcheted
`EMPTIED_BASELINE` cover the catch-and-return-empty half. The coercion half —
`x > 0 ? x : undefined` over a legitimately-zero measurement — is not yet gated
and should be.

---

## Rule 12 · Easy running is sized before quality, never with the remainder (locked 2026-08-30)

**A week is built by giving easy days their doctrine-correct duration first and
fitting quality into what remains — not the reverse.**

This is the rule the whole audit started from. The engine sized the long run and
the quality sessions, then divided the leftovers among the easy days, and handed
a 3:00-goal marathoner **2-mile easy days** — half his own measured easy day.
The floor existed, was computed correctly, and lost every time:
`flooredPerEasy = Math.min(effectiveFloor, perEasyBudgetCap)`.

The runner's verdict, which is the standard: *"a 3 mile easy run for marathon
training seems incredibly short."*

**To comply:** price an easy day in MINUTES at the runner's own easy pace, not in
miles — `Research/00a` §1 gives 20-75 min for easy/recovery and §2 gives 40-75
for general aerobic, and 3 miles is a real run for one runner and a warm-up for
another. Vary them: a week has a short recovery day after the long run and longer
aerobic days elsewhere. Four identical easy days is a template, not a plan, and
CLAUDE.md already requires composition to be state-driven. If quality will not
fit once easy running is honest, the week is over-prescribed — cut quality, not
the aerobic base.

**Enforcement:** `lib/plan/_coach_sensible.test.ts`, which fires on exactly this
and is deliberately red while it is open.

---

## Rule 13 · A fix to something the runner sees is verified by RENDERING it, with real data (locked 2026-08-30)

**Not by reading the code. Not against a sample fixture. Not by asserting the
absence of the bad thing. By looking at the actual screen, with the actual
account's data, after the change.**

This rule exists because it is the failure that has cost the most trust, and it
has recurred:

- The route line was declared fixed **twice** while still invisible. The first
  fix blamed a camera race and verified against the app's SAMPLE fixture — which
  skips the gradient code path entirely. The real cause was a 1.41:1 contrast
  ratio. The owner's response: *"Very concerning fixes are not actually fixed."*
- The trend chart was "fixed" by adding a caption. It was plotting **13 bars
  holding one distinct value**, under a headline that was a different quantity.
- The citation scrub had a test asserting `"Research/"` was absent from its
  output. It passed — while turning *"Cruise intervals · Research/04 §5.3."* into
  **"Cruise intervals.3."**. An absence-only assertion cannot see wreckage.

**To comply:**

1. **Render it.** Build and run the real app against real data. For iOS use the
   simulator tools: attach, build, launch, screenshot, read the screenshot.
2. **Never a sample fixture for a display fix.** Fixtures skip the exact code
   paths that break. If you cannot get real data, say so plainly rather than
   substituting a fixture and calling it verified.
3. **Assert the shape of the result, not the absence of the defect.** "The bad
   string is gone" is satisfied by garbage. Check what the runner actually reads.
4. **Measure, do not eyeball, anything numeric** — contrast ratios especially.
   A colour that "looks fine" shipped at 1.41:1.
5. **Falsify the check.** Run it against the unfixed code and watch it fail
   first. A test that has never failed proves nothing, and this repo has shipped
   gates that reported clean because they scanned zero files.

If a fix cannot be verified this way, report it as unverified. **An honest
"I could not confirm this" is worth more than a confident claim that turns out
to be wrong on the runner's phone** — that is the failure this rule exists to
stop.

---

## Rule 14 · A query names the population it reads (locked 2026-08-30)

**Filtering on the runner is not the same as filtering on the right ROWS.** Three
separate incidents in this project, all the same shape — a query that looked
correct, ran without error, and read a population nobody intended:

- **Archived plan versions.** `clearActivePlansFor` archives a plan and never
  deletes its `plan_workouts`, so a join on `user_uuid` alone reads all 47 of the
  owner's plan versions. It counted **59 "quality sessions" in one week**, which
  made `recentQualityPerWeek` return 36, which made Rule 5's quality-density ramp
  trivially satisfied — so it **had never fired for any runner whose plan had ever
  been rebuilt, which is everyone.** Three more defects from the same omission,
  including six duplicate coach-log cards for one week.
- **`user_id = 'me'`.** A shared legacy sentinel that returns OTHER ACCOUNTS' rows.
  Never filter on it; join `users` on email and use `user_uuid`.
- **`absorbed_into_canonical_at`.** Filtering on the stamp instead of
  `NOT (data ? 'mergedIntoId')` does not shade a day down, it **zeroes it** — 63
  miles across 7 days once vanished this way, including the owner's true peak long
  run. The canonical predicate is `CANONICAL_ROW_SQL` and there is exactly one.

**To comply:** every query states its scope explicitly — the active plan, the
canonical row, this user by uuid — and where a scope has one correct definition it
lives in ONE exported constant that greps find, never re-typed per call site.

**And verify without the app's own filters first.** A verification query that
reuses the reader's filter reproduces the bug instead of revealing it. That
happened here: a confident report of 63 lost miles was produced by a query with
the same defect as the code it was checking. When a number looks wrong, query
raw, then compare.

**Enforcement:** `lib/audit/_active_plan_scan.test.ts` (ACTIVEPLAN-1) and
`lib/runs/_absorption_predicate.test.ts`. Both are ratchets: the allowlist may
shrink, never grow, and a stale exemption fails until deleted.

---

## Rule 15 · A mechanism the test corpus cannot REACH is untested, however many archetypes pass (locked 2026-08-30)

**Coverage is not the count of cases that pass. It is the set of code paths any
case can reach.**

`_sweep_allusers.test.ts` grades **11,598 archetypes** against a research answer
key and is the most-cited quality evidence in this project. Its `Arc` type has no
`dailyMiMostRecentFirst`, no `easyDayMedianMi`, no `recentQualityPerWeek`, no
`isMidBlock`. So `hist` is null for **every archetype**, and therefore:

- `resolveRampBase` is **never called** — `lifted` never exercised
- `rampBaseEvidence` is null → `baseRebuilt` short-circuits true on clause one
- `easyDayMedianMi` is 0 → the easy-day floor never binds
- `recentQualityPerWeek` is undefined → the density ramp never fires

**Four doctrine mechanisms, dark across the entire corpus.** Adding archetypes
would never have helped — the corpus cannot express a runner with a history at
all, and every real runner has one.

**To comply:** when you add a mechanism, ask which corpus case reaches it and
name that case in the test. If none can, the corpus needs the input, not more
rows. A mechanism gated on a field the fixtures never populate is decoration.

**And treat a green sweep as evidence about what it EXERCISED, never as evidence
about the engine.** State coverage in terms of paths reached, not cases run.

---

## Rule 16 · One quantity, one name (locked 2026-08-30)

**If two surfaces show the same label they show the same number, and a sentence
about a measurement is gated on that measurement.**

- The owner's CIM race had **three different projected finishes** live at once —
  `3:22:17` on the list, `3:31:48` on the detail, `3:42:23` in a third rung. All
  labelled "projected". They were three different quantities: forward trajectory,
  current-fitness equivalence, and equivalence plus a marathon-specificity
  adjustment. Each was individually defensible; together they were incoherent.
- The recap printed **"kept it aerobic" unconditionally** — no HR condition at
  all. It said it over a 13.5-mile long run at avg HR 159 against a 145 ceiling.
- The watch resolved race day as "the next A race with a goal", which is always
  the marathon. It would have carried a **3:00:00 marathon goal, a marathon
  strategy label and a 26.2-mile gel ladder to the start line of a 10K.**

**To comply:** resolve a displayed quantity in ONE place and let every surface
call it — the fix for the three projections was `lib/training/race-projection.ts`,
plus a test asserting no route computes it directly, because a behavioural test
alone cannot catch a surface that stops calling the shared resolver. A sentence
asserting a fact about a measurement must be gated on that measurement or not
said. And a surface about an entity resolves THAT entity, not the most important
one in scope.

---

## Rule 17 · The runner reads a sentence once (locked 2026-08-30)

**Repetition is not thoroughness. It is the most common form of bloat in this
app, and it makes real information harder to find.**

Found in one pass over three screens: the same 20-word downhill instruction
appended to **every long run, eleven times in one block**. The pace-ramp legend
printed **twice on one screen**. Average heart rate printed **three times** on
Today. The coach log rendering **six duplicate cards** for a single week. A
catalogue of tempo and hill sessions displayed during a phase whose own coach
line above it read "Easy running only. No quality."

**To comply:** say it once, in the place it is most useful, and refer back rather
than restate. A coach says "run the downhills" when prescribing the block and
then trusts the runner. If a surface repeats a sentence per row, the sentence
belongs to the block, not the row. If two components can both draw a value, one
of them yields — and it yields on the rendered text, not on a row id, because
that is what the runner actually sees.

This is the enforceable half of the owner's standing instruction to strip fluff
and bloat, and of the design contract's rule that no content is printed twice on
one screen. Where a surface contradicts the sentence above it, that is not
redundancy but a correctness bug, and the contradiction is the finding.

---

## Rule 18 · A gate is not trusted until it has been made to fail (locked 2026-08-30)

**Every rule above is worth exactly as much as the check behind it, and this
project has repeatedly shipped checks that could not fail.**

- `check-modelled-mark.sh` contained `[ -d "$V5_VIEWS" ] || mkdir -p "$V5_VIEWS"`
  — **a gate creating the tree it audits.** Guards 1-3 scanned zero files and
  reported clean.
- `check-automatic-mutations.sh` guard 2's tamper-check was `grep -q "GUARD 0"`,
  which **any comment satisfies** — including the one left behind if the suite
  were deleted.
- `PACE.interval-offset` carried `if (exempt(...)) return;` on the line ABOVE its
  only assertion. Granting the exemption did not excuse the known deviation, it
  **switched the claim off entirely**; changing the engine to a wrong value would
  have passed.
- The citation scrub's test asserted `"Research/"` was absent from the output. It
  passed while the scrub corrupted *"Cruise intervals · Research/04 §5.3."* into
  **"Cruise intervals.3."** — an absence-only assertion cannot see wreckage.
- `check-palette-sync.sh` named two files that no longer existed, in the header of
  the script whose entire job is catching exactly that rot.

**To comply, before you trust any check:**

1. **Falsify it.** Break the thing on purpose and watch the gate name it. Then
   restore. Both directions where the gate has two — a new violation must fail,
   and a stale exemption must fail.
2. **Assert liveness.** A scanner states how many files it read and fails on
   zero. Reporting clean because it looked at nothing is the worst outcome
   available, since it also reports confidence.
3. **Never let an exemption bypass the assertion** — guard it with the violating
   condition, so the exempted case is the only thing excused and everything else
   still runs.
4. **Every allowlist is a ratchet and every exemption carries an argued reason.**
   It may shrink, never grow. An exemption whose target is now clean fails until
   deleted. "We might need it" is not a reason; a stale allowlist is how a gate
   quietly stops meaning anything.

A gate that has never failed is a hypothesis, not a guarantee. **Read numbers out
of the cited source at run time rather than hardcoding both sides** — a check that
hardcodes both only proves the test agrees with itself.

---

## Rule 19 · Green is not deployed. Confirm the artifact reached production (locked 2026-08-30)

**A passing gate chain is evidence about the checks, not about production. Verify
the deploy landed.**

Earned the hard way. On 2026-08-30 a `'use client'` component imported one
constant from `lib/training/lthr-reanchor.ts`, which reaches a
`await import('@/lib/db/pool')` three modules deep. A dynamic import is still a
bundled edge, so webpack pulled `pg` into the browser graph and `next build`
died on `fs`/`dns`/`net`/`tls`.

**`main` did not deploy for a full day.** Five merged commits — an entire
marathon block's worth of engine fixes, plus the LTHR re-anchor the runner's HR
caps depend on — were never live, while every session that pushed them believed
they were. `tsc --noEmit` passed. All twelve prebuild scripts passed. The break
was in `next build`, which runs AFTER them, and its failure surfaced only in
Railway, hours later, where nobody was looking.

Two failures, and both are the rule:

**1 · The gate chain stopped before the thing that actually ships.** Twelve
checks verified palette, spacing, voice, doctrine, wire keys, mutations and
swallowed reads — everything except whether the application builds. A gate set
that does not cover the last step is a gate set with a hole exactly where it
matters, and the hole is invisible because everything before it is green.

**2 · Nobody confirmed the artifact.** Every push was treated as a deploy. `git
push` succeeding says the remote accepted the commit and nothing more.

**To comply:**

- **After a push you care about, check the deployment STATUS**, not the push
  result. A deployment can exist and be failed; `success` is the only word that
  means deployed.
- **Cover the last step.** `scripts/check-client-graph.sh` now walks the import
  graph from every `'use client'` entry and fails when it reaches a server-only
  module, following DYNAMIC imports and the full transitive closure — the
  offending edge was three deep and dynamic, so a one-hop static check would
  have reported it clean.
- **A claim in a comment that nothing verifies is not a fact.**
  `lthr-reanchor.ts` asserted in its own header that it "imports no database at
  any depth." It was false, it was false for a day, and no check could tell.
  This is Rule 18 pointed at prose: if a header states an invariant, either gate
  it or delete the sentence.

When work is time-critical — a plan authoring overnight, a cron that fires once —
**confirm the deploy before the deadline, not after.** The cost of assuming is
the entire night's work silently not existing.

---

## Rule 20 · A product rule with no gate is a hypothesis (locked 2026-08-30)

**A decision written down in a doc, a memory or a header comment is not in
force. Only a check is in force.** Every rule above is worth exactly what its
enforcement is worth, and this project keeps proving it.

Four instances, all of them rules that were genuinely decided, written down, and
then violated anyway because nothing could tell:

- **"The coach projects, it never renegotiates a stated goal."** The owner's
  own standing rule, app-wide. A cron generated a live card in his production
  account reading *"Set the revised target to race off the fitness you have"*,
  with an accept action that PATCHes his 3:00:00 CIM goal down to 3:31:48.
  A forced goal decision, which is the one thing that was never to exist.
- **"No content is printed twice on one screen."** In the design contract.
  Average heart rate rendered **three times** on Today, and the pace legend
  twice on one screen.
- **"Imports no database at any depth."** Asserted in `lthr-reanchor.ts`'s own
  header. It was false, it was false for a day, and it kept production
  undeployed while every gate stayed green.
- **Coach voice — no em dashes.** Locked, with a gate. The gate's scope
  excluded `lib/plan`, which authors the sentence attached to every workout, so
  **1,804 rows** carried them.

**To comply:** when you lock a rule, write the check in the same change. If the
check cannot be written yet, say so in the rule text and name what would be
needed — an honest "unenforced" is a known gap; an unmarked one is a rule
everybody believes is holding.

**And when a rule IS violated, fix the gate, not just the instance.** The
instance is one row in one account. The gap is what let it in, and it is still
open the moment you have deleted the row.

The corollary for prose: **a header comment asserting an invariant is
documentation, not enforcement.** Gate the claim or delete the sentence — a
sentence nothing verifies is worse than silence, because it stops the next
reader from checking.

---

## Rule 21 · The plan must be able to get harder — and you must be able to PROVE it has (locked 2026-08-30)

This is the rule the hero statement at the top of this file demands, and it is
locked because the engine currently fails it.

**Measured 2026-08-30 against the owner's entire history: 309 `coach_intents`
rows, 20 distinct reasons, months of real training, and the number of UPWARD
adaptations is ZERO.**

```
plan_adapt_downgrade      5        upgrade / bump / accelerate    0
plan_adapt_long_floor     5
plan_adapt_reschedule     3        vdot_auto_recalc               1
plan_adapt_missed_noted   3        (the pace axis, once, ever)
plan_adapt_overridden     2
plan_adapt_gap            1
plan_adapt_drop_missed    1
```

The push machinery is not missing. All three axes are wired: pace through the
VDOT re-anchor into `recompute-paces.ts`; quality-session shape through
`progression-pass.ts`, whose gate returns TAKE / **ACCELERATE** / HOLD /
BACK_OFF; and volume through `adaptive-ramp.ts`'s `tryAdaptiveBump`, imported by
the `run-adaptations` cron, capped at +5 mi/week with +1 on the long and +1 per
easy day. Doctrine-bound, unit-tested, cron-mounted — **and it has never once
fired for the only real runner this app has.**

That is the third instance of the same class in one night, after Rule 5's
quality-density ramp (never fired for any runner with a rebuilt plan) and Rule
2's easy-day floor ("never fired since it shipped"). **Wired, tested and inert
is this codebase's signature failure**, and it is most damaging on the upward
path, because a coach that cannot push is not a coach.

### To comply

**The bar to go UP may not be higher than the bar to come DOWN.** When you write
or touch an adaptation trigger, put its threshold beside its opposite number's
and justify any asymmetry with a citation. Five downgrades against zero upgrades
is not a runner's record, it is an engine's disposition.

**Prove it fires, on real history.** Per Rule 15, a mechanism no case can reach
is untested. For an adaptation the standard is higher: compute what the runner
would have had to DO to trigger it, then check whether any week they have
actually run would have. If none could, the bar is not a bar, it is a wall.

**Make it observable.** `training_plans.adaptation_log` stores `{"n": 1, "ts":
"..."}` — a counter and a timestamp, and no record of WHAT adapted. So the
engine's own log cannot answer "has this ever pushed up", and establishing the
zero above required querying `coach_intents` sideways. **A log that records that
something happened but not what is not a log.** Every adaptation writes what it
did, in which direction, and on what evidence — otherwise the next person cannot
tell an engine that never pushes from a runner who never earned it, which is
exactly the ambiguity that let this survive.

**Never manufacture push by weakening a guard.** Every ceiling here is
doctrine-cited and injury-motivated, and Rule 8's corollary keeps the
absorbed-load guards reading the literal recent number. Push by spending the
headroom doctrine already allows.

---

## Rule 22 · A gate inherits the bias of whoever wrote it (locked 2026-08-30)

**Coverage is not the same as balance. Ask what your tests CANNOT fail on.**

Measured on this repo, 2026-08-30, counting test files that exercise each
verdict of the progression ladder and each adaptation action:

```
HOLD          29 files          readiness_pullback   6 files
BACK_OFF       1 file           downgrade            5 files
ACCELERATE     2 files          reschedule           5 files
                                mark_upgrade         1 file
```

Twenty-nine files know how to hold a runner back. Two know what it means to
accelerate one. **The tests have the same instinct as the engine**, which is
unsurprising — they were written by the same reasoning, at the same time, by
people worrying about the same failure. And it is exactly why 7,294 passing
tests coexisted with an upward adaptation path that had fired ZERO times in 309
production intents (Rule 21).

**You cannot correct an engine's bias with a test suite that shares it.** A gate
that only ever asks "did you correctly refuse?" will pass an engine that can
only refuse.

### To comply

**When you write a gate, write down what it cannot fail on.** Not what it
covers — what it is structurally incapable of catching. That sentence belongs in
the file header, next to the liveness assertion Rule 18 already requires.

**Check the DISTRIBUTION, not just the count.** For any mechanism with opposing
verdicts — hold vs accelerate, pull back vs push, refuse vs permit, exclude vs
admit — count the cases on each side. A large imbalance is a finding in itself
and should be justified or corrected. Doctrine sometimes licenses an imbalance
(there are more ways to be injured than to be ready); habit never does.

**Beware the corpus that cannot ask the question.** Rule 15's failure is the
extreme form of this one: `_sweep_allusers` grades 11,598 archetypes whose
fixture type has no history fields at all, so four doctrine mechanisms are
unreachable across the entire sweep and no amount of additional cases would
help. A biased corpus at least asks lopsided questions; a blind one asks none.

**And beware the false zero.** Counting coverage by grepping a literal action
string reported `progression_gate: 0` on a mechanism with 43 tests across three
files. Verify a coverage claim the way you would verify a defect — the number
that says "nothing tests this" is exactly the number worth doubting twice.

---

## Rule 23 · A scheduled job guarantees its own preconditions. A schedule is not a guarantee (locked 2026-08-30)

**No job may depend on another job having run. Ensure the precondition, or
refuse loudly — never proceed on the assumption.**

Earned the night the owner's 14-week marathon block was authored. `plan-drift`
stamps every `hr_cap_bpm` in the block from `profile.lthr` at the instant it
runs. `run-adaptations`, scheduled an hour earlier, is what re-anchors that
value — 162 to 168 that night. **`plan-drift` never checks. It assumes.**

And the schedule those two jobs relied on had not been kept once that week:

```
run-adaptations   scheduled 03:00 UTC   actual  09:01  09:50  15:08  13:56
plan-drift        scheduled 09:00 UTC   actual  14:13  14:07  20:37
```

Five to twelve hours late, every day. GitHub Actions cron is explicitly
best-effort under load; treating it as a clock was the defect. Had the order
slipped by one hour, the block would have frozen fourteen weeks of HR ceilings
about 6 bpm low, silently, and nothing anywhere would have reported it. Both
jobs had to be fired by hand to guarantee the sequence — which, as the owner
put it, "defeats the purpose."

**Nobody knew.** No alert, no staleness check. The drift was found because a
human happened to run `gh run list`.

### To comply

**Enumerate what a job assumes another job did, then remove the assumption.**
Prefer *ensure the precondition* over *check and refuse* — `reanchorLthr` is
idempotent and costs nothing when the anchor is already fresh, so authoring
should simply ensure it. Where a job genuinely cannot ensure a precondition, it
refuses loudly rather than proceeding on a stale one. Rule 11 applies: fresh,
stale and absent are three different facts.

**Lateness must be harmless.** A job that runs ten hours late should still do
the right thing. If being late changes the outcome, the job has an ordering or
freshness dependency it has not declared.

**A job that does not run must be NOTICED.** Every scheduled job should be able
to answer "when did I last complete successfully, and is that too long ago",
and something must raise when the answer is bad. `ops_alerts` is the existing
surface. Per Rule 20, a scheduling guarantee with no check is a hypothesis —
and this one was false for a week without anyone noticing.

**Manual triggering is a bridge, never a fix.** If the answer to "will this fire
correctly" is "I will run it myself", the system is not in place.

---

## What to do if a doc referenced above is missing

If any of the required-reading documents is missing or empty when you go to read it, stop and tell me which one is missing. Don't proceed by inference.

---

## Branching & integration — `main` is the working line (locked 2026-05-20)

`main` is the active working line. Build here. **Before writing any code, confirm your base is current:** `git fetch`, then check whether `main` is ahead of whatever branch your worktree started on. A worktree's starting branch is often NOT current.

- The `claude/build-runcino-app-OIRJr` branch and the adjective-noun-hex worktree branches (`funny-chandrasekhar-…`, `objective-black-…`, etc.) are parallel-session branches and may be **behind** `main`. Never assume your worktree's base branch is the source of truth.
- Integrate to `main`. When moving a commit from another branch onto `main`, dry-run the cherry-pick/merge in an **isolated detached worktree** (never the parent checkout another agent may be using), inspect the conflicts, and abort if it would regress. Diverged branches can carry deprecated logic.
- A second agent is frequently committing to `main` at the same time. Fetch immediately before any push, **fast-forward only, never force**. Expect overlap in coach-core files.

### Cautionary example (2026-05-20) — what we almost did

An agent ran a full HR/VDOT/pace audit and fix, built and verified it green on the stale `claude/build-runcino-app-OIRJr` branch, then went to cherry-pick it onto `main`. The cherry-pick conflicted in `web/lib/coach-state.ts` and `web/lib/vdot.ts` because `main` had already moved further in those exact areas:

- `gatherCoachState` on `main` is multi-tenant (`opts.userId`) and already populates `recovery.rhrBpm` (plus HRV/sleep) from HealthKit biometrics. The stale-branch commit would have replaced that with manual-profile RHR and nulled HRV/sleep — a regression.
- `pacesFromVdot` on `main` was re-architected to delegate to `resolveTrainingPaces` (canonical Daniels Table 2). The old `E = M + 75` / `R = mile-pace` formula was deprecated as systematically wrong (see `docs/2026-05-19-sim-sweep.md`). The stale-branch commit would have revived it.

The cherry-pick was aborted in an isolated worktree; `main` was never touched. The fix's *ideas* (personalize HR thresholds off real HRmax, name-or-HR hard-day detection, the dormant marathon VDOT correction) still hold, but they must be **re-derived on `main`'s current architecture**, not transplanted.

**Lesson:** confirm `main` is your base before building, and never transplant a commit across diverged branches without dry-running the merge and reading the conflicts. Building on a stale branch produces work that is redundant (already done better on `main`) or deprecated (already removed from `main`).

## Deployment doctrine — approved fixes go to `main` (locked 2026-06-06)

When a fix is approved (falsifiers passed, David reviewed, explicit go given), **Claude** deploys it — David approves the fix, not the git push:

1. Commit immediately to the working branch with a clear message.
2. Push the branch to origin.
3. Merge to `main` and push `origin/main` (fetch first, fast-forward only).
4. Confirm Railway deploys — the pipeline fires automatically on push to `main`.
5. Run the cluster's smoke-check falsifiers **against prod** and report results.

"Deploy through the normal pipeline" means *you* (Claude) do steps 1–5, not David. **An approved fix that isn't committed and pushed is not deployed** — it's at risk of loss and prod is running the old code. Never leave approved work uncommitted.

**The only exception:** DDL / data writes (direct DB changes) still require David's explicit per-statement go before execution, as always. **Code changes deploy on approval; data writes need a separate explicit go.**

---

## Fully-autonomous mode — no stopping unless mission critical (locked 2026-05-24)

When David says "execute to 100% fully autonomous" (or equivalent — "full autonomous", "go in hard", "fully execute"), that's a hard instruction: **don't stop unless something is mission critical.** This applies to every agent on this app.

### Not mission critical — keep going

- Comfortable stopping points ("I've landed the architecture, time to write the report") — write the report at the END, after you've executed everything you can.
- Build / TypeScript / lint errors — debug and fix them. Per `feedback_verify_by_self_audit.md` you may not have `node_modules` to typecheck locally; that's not a reason to stop, it's a reason to read more carefully + audit by tracing types in the file.
- Merge conflicts during rebase — resolve them or `reset --hard origin/main` + `cherry-pick` your commits.
- Push rejected because main moved — fetch, rebase or reset+cherry-pick, retry.
- Risk concerns about touching big files (v4 component port, etc.) — read the file, make the smallest correct change, ship.
- Other agent's WIP referenced symbols that aren't on main — add the missing definition or work around. Don't punt.
- Decisions where the wrong choice is recoverable — pick using your best judgment ("use your best idea") and document the choice in the commit message.
- A phase has "framework + best example" wins but isn't fully polished — keep going until everything in the spec is at least at framework level, THEN come back for polish.

### Mission critical — stop and ask

- A destructive operation the user hasn't authorized (force push, hard reset of unmerged work, dropping a production table, deleting non-tombstoned data).
- A schema migration that would break the running app for live users (non-additive change, NOT NULL on existing data without backfill, renamed columns).
- Credential / auth change that could lock the user out.
- Money spend over an obvious budget (paid service tier, expensive API calls in a tight loop).
- Genuinely ambiguous input where no reasonable default exists AND the wrong choice cascades.
- A clear infrastructure failure (Railway is down, GitHub auth gone, DB unreachable) — surface and wait.

### Failure mode this rule fixes

The bug class: agent does 30% of the requested work, writes a "where to pick up next session" report, calls it done. The user comes back and asks "I thought you were going to build 100%, what stopped you?" — because nothing actually did stop the agent; it stopped itself at a comfortable point.

Specific anti-patterns:
- Writing the end-of-session report while there's still work in the queue.
- Marking tasks "completed" because they're at "framework level" when the user asked for full execution.
- Stopping after a build failure instead of fixing it.
- Stopping after a rebase conflict instead of resolving via reset+cherry-pick.
- Stopping because "the other agent's code might conflict" — read both, make the call.

The autonomous-mode default is **forward motion**. End-of-session report happens when there's nothing left in scope, not when the agent is tired.
