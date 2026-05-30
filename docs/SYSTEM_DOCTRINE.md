# System Doctrine

The consolidated, locked-in learnings of the Faff coaching system. Every
rule below is **doctrine for all users** — David is the first runner,
not the only one. Every future sign-up inherits this doctrine without
re-deriving it.

The rules fall into five buckets:

1. **Data-handling rules** — how the system writes and reads its own data
2. **Coaching rules** — how the engine produces prescriptions
3. **Inputs & onboarding rules** — what the coach needs per runner and where it comes from
4. **Engine rules** — how the LLM-free deterministic chain behaves
5. **Voice + UX rules** — how the coach speaks and how the page is composed

Every rule has a citation. When a rule changes, the citation must be
updated; the rule itself is append-only inside the active session — never
silently mutated.

---

## 1 · Data-handling rules

### 1.1 · Race-data source-of-truth ladder

**Locked 2026-05-19.** When reading a race finish time, the canonical
order is:

1. `races.actual_result.finishS` — curated chip time
2. `races.meta.finishTime` — legacy stored time
3. Strava activity match (date ± 1 day, distance within ±2mi) — provisional fallback

Strava-source data must never display as authoritative race performance.
Curated chip times beat raw Strava elapsed every time.

Citation: `CLAUDE.md §Race-data source-of-truth (locked 2026-05-19)`,
fixed bugs in `compute-vdot.ts`, `/races/page.tsx`. Implementation:
`web-v2/lib/coach/race-header.ts:loadCurrentVdot`,
`web-v2/lib/coach/profile-state.ts` VDOT block.

### 1.2 · Multi-writer JSONB columns require field-level updates

**Locked 2026-05-19 round 5.** When two or more code paths write to the
same JSONB column with different field coverage, full-replace upserts
silently erase fields the active writer doesn't know about. Use
`jsonb_set` or `CASE WHEN` guards to preserve unwritten fields.

Citation: `CLAUDE.md §Rule 6 · Multi-writer jsonb columns`. Examples:
`strava_activities.data` splits preservation; `races` actual_result
guard.

### 1.3 · Per-finding context filters

**Locked 2026-05-19 round 4.** When a surface aggregates N findings, run
N filter applications — one per finding. Inheritance is semantic, not
automatic. The parent surface's filters describe what context distorts
the whole story; each child finding asks what context distorts its
specific observation.

Citation: `CLAUDE.md §Per-finding context filters (locked 2026-05-19 round 4)`.

### 1.4 · Operational vs decision vs external

**Locked 2026-05-19.** Three buckets for agent actions:

- **Operational** (run diagnostics, backfills, internal data populations) — self-execute
- **Decisions** (combined-rule shapes, threshold values, architectural splits) — explicitly flag as blockers
- **Externally-consequential** (email, deletion, money, public-facing surfaces) — confirm before each

Citation: `CLAUDE.md §Operational vs decision vs external`.

### 1.5 · Identity is layered

**Locked 2026-05-30.** The runner's data is split across three tables:

- `users` — auth + identity primary (id, email, name, age, sex, location, timezone, max_hr/resting_hr from HealthKit, admin status, status)
- `profile` — extended runner data (LTHR, height_cm, experience_level, fueling, Strava OAuth tokens, notification_prefs JSONB)
- `user_prefs` — weekly schedule (long_run_dow, quality_dows, rest_dow)

The legacy `user_id='me'` column on `profile` + `user_prefs` is reserved
for the founder's row only. New sign-ups: UUID-only.

Citation: `docs/2026-05-30.html §2 L1 — Identity & auth`.

---

## 2 · Coaching rules

### 2.1 · Race priority system

The runner tags each `races.meta.priority`:

| Priority | Meaning | VDOT weight | Plan effect |
|---|---|---|---|
| **A** | Goal race · trained for · tapered for | 1.0 | Drives the active plan; race_horizon topic surfaces from 60d out |
| **B** | Supporting race · hard tune-up | 1.0 | Plan adjusts for taper-lite; doesn't reset the arc |
| **C** | Low-priority · run as training | excluded | Plan barely flexes; coach narrates as training-effort day |
| **training-run** | Listed but run for fun (anniversary, club run, celebration) | 0.2 | Coach treats as a long training run, not a race |
| **hilly-excluded** | Real race result, elevation-distorted (e.g., Big Sur) | excluded | Excluded from VDOT aggregate so course doesn't drag fitness number down |

The 'training-run' and 'hilly-excluded' tags exist because David's runs
through 2026 surfaced these specific cases. They are now first-class
priorities every user can use.

Citation: `legacy/web/lib/db.ts` data migration `2026-05-19-race-priorities-and-rose-bowl-r2` + `2026-05-23-sombrero-training-run`. Code: `web-v2/lib/training/vdot.ts:bestRecentVdot` priority filter.

### 2.2 · VDOT computation rules

**Cap at [30, 85].** Daniels' Running Formula 4th ed. table extends to
85. Values outside the range return null. (Memory: `project_daniels_vdot_cap.md`.)

**Sources** (combined per `bestRecentVdot`):
- Race candidates: from past A/B races (180d window), priority='C' excluded, hilly-excluded skipped.
- Training run candidates: from quality runs (last 60d), distance ≥ 4mi, gated on `QUALITY_RUN_TYPES` membership OR HR ≥ 80% MaxHR. Race-date matches excluded.

**Tiebreak:** race VDOT at face value; training VDOT - 1 point. A single
real race always wins ties against a training estimate.

**Predict:** invert Daniels formula via binary search; cap [30, 85].

Citation: `web-v2/lib/training/vdot.ts` (vdotFromRace, vdotFromRun, bestRecentVdot, predictRaceTime). Doctrine: `Research/01-pace-zones-vdot.md`, `Research/22-plan-templates.md`.

### 2.3 · Readiness scoring algorithm

Weighted composite 0-100, banded into READY / MODERATE / BACK-OFF / REST.

| Input | Weight | Source |
|---|---|---|
| Sleep (7-night avg vs 7.5h target) | 25% | `health_samples` sample_type=sleep_hours |
| HRV (today vs 28d baseline) | 25% | `health_samples` sample_type=hrv |
| RHR (today vs baseline) | 20% | `health_samples` sample_type=resting_hr |
| Check-in (last 1-2 reply chips) | 15% | `check_ins.rating` |
| Load (ACWR = acute7 / chronic28) | 15% | computed from `strava_activities` |

Bands: ≥70 READY, 50-69 MODERATE, 30-49 BACK-OFF, &lt;30 REST.

Citation: `web-v2/lib/coach/readiness.ts`. Implementation: `briefings.payload._state.readiness.inputs`.

### 2.4 · ACWR injury-risk threshold

Acute-to-Chronic Workload Ratio ≥ 1.5 = elevated injury risk (Gabbett
2016). The Load pillar of readiness penalizes scores in this band.

Citation: `Research/00a-distance-running-training.md` §ACWR, `Research/15-wearable-data.md` §Training Load Metrics.

### 2.5 · Plan-builder phase structure

Race-prep plans default to: **BASE → BUILD → PEAK → TAPER → RACE_WEEK**.
Each phase has citation back to `Research/22-plan-templates.md` + the
Advanced Training Research §13.x sections.

Cutback weeks: every 4th week within build/peak. Race week: final 7 days,
volume drops ~50%.

Citation: `web-v2/lib/plan/generate.ts`, `Research/22-plan-templates.md`,
training_plans data migration log.

### 2.6 · Race-week mode thresholds

Coach surface modes by proximity to next A-race:

- **building** — &gt; 60 days out
- **sharpening** — 30-60 days out
- **race-week** — ≤ 7 days out (volume drops, race-day machinery surfaces)
- **post-race** — ≤ 14 days after (recovery hero, reverse-periodization)

Citation: `web-v2/lib/coach/router.ts:resolveRaces` + `:resolveRaceDetail`.

### 2.7 · Health watch-mode thresholds

`health` surface mode is computed from RHR deviation + sleep deficit:

- **steady/green** — no signals
- **watch-amber** — RHR baseline + 5 bpm, OR persistent sleep deficit
- **watch-red** — RHR baseline + 8 bpm AND sleep deficit ≥ 5h (illness/overtraining flag)

Citation: `web-v2/lib/coach/router.ts:resolveHealth`.

### 2.8 · Notification taxonomy is closed at 7

Push categories are a closed set: `race_day`, `race_eve`,
`weekly_checkin`, `streak`, `niggle_sick`, `skip_recovery`,
`strava_reconnect`. Plus master_enabled (kill switch) + quiet_hours
window. Adding a new category requires both a new pref flag AND a new
APNs payload kind — never coach-decided at runtime.

Citation: `web-v2/lib/notifications/prefs.ts`, `migration 121_notifications.sql`.

---

## 3 · Inputs & onboarding rules

### 3.1 · Input tiers — what the coach asks for per runner

**Locked 2026-05-30.** Every runner is described by **six tiers** of input. Every signed-up user — David, the next runner, the 1000th — arrives at first coaching with the SAME inputs filled. The PATH to fill them differs (Apple Health auto-fills some; manual entry fills others), but the SET of fields is fixed.

| Tier | Status | Fields | Gates |
|---|---|---|---|
| **T1 · Identity** | REQUIRED at onboarding | name, email, timezone, user UUID | Plan generation, greeting, time-aware UX |
| **T2 · Physiology** | REQUIRED for accurate coaching | age (birthday), sex, height_cm, experience_level | HR zones, age-grading, cadence thresholds |
| **T3 · Connected-source** | AUTO when connected, MANUAL fallback when not | max_hr, resting_hr, LTHR, sleep, HRV, weight, VO2 max, HR recovery, cadence, run power, etc. | Readiness, training load, form metrics |
| **T4 · Volume + history** | REQUIRED for plan generation | weekly_mileage_target, weekly_frequency, history_avg_weekly_mi, history_longest_recent_mi, history_years_running | Plan-builder's volume target + level inference |
| **T5 · Schedule + units** | REQUIRED before first plan (defaults exist) | long_run_dow, quality_dows, rest_dow, units, briefing_time | Workout day-of-week, distance / pace / temp units |
| **T6 · Pro features** | OPTIONAL | fuel_brand, fuel_target_g_per_hr, cross_training_modes, notification prefs per category | Fueling, cross-training credits, push categories |

Citation: `docs/ONBOARDING_AUDIT.md`, `learn_articles.slug='doctrine-input-tiers'`.

### 3.2 · Fallback ladder — physiology fields

**Locked 2026-05-30.** For every physiology field, the resolution order is:

1. **MANUAL OVERRIDE** — `users.*_override` or `profile.*` set explicitly. Wins everything else.
2. **AUTO from CONNECTOR** — Apple Health ratchets `users.max_hr`; 60d avg fills `users.resting_hr`; race avg HR derives `profile.lthr`.
3. **POPULATION FORMULA** — `220 - age` for max HR. Always wrapped in a hedge.
4. **PROFILE_GAP CARD** — coach surfaces "we need X to coach Y better" on TODAY.

The contract: the coaching engine never crashes for missing inputs. Every code path has a fallback, defers gracefully, or surfaces a gap card.

Citation: `learn_articles.slug='doctrine-fallback-ladder'`.

### 3.3 · Apple Health is recommended, not required

**Locked 2026-05-30.** Apple Health auto-flows 19 sample types when connected. The system MUST work without it. Manual-fallback coverage today: max_hr / resting_hr / LTHR have manual paths; weight / sleep / HRV / HR recovery / cadence / run power do NOT (open gaps).

Citation: `learn_articles.slug='doctrine-apple-health-optional'`.

### 3.4 · Onboarding minimum-viable set

**Locked 2026-05-30.** Minimum inputs to coach safely: T1 identity in full; T2 physiology (birthday, sex, experience_level — height is recommended); T4 volume (Strava 4+ weeks OR onboarding history chips); a goal (race OR maintenance). Without a verified anchor (max_hr OR LTHR OR race-derived estimate), the coach defers rather than publishes wrong HR zones.

Citation: `learn_articles.slug='doctrine-onboarding-min-set'`.

---

## 4 · Engine rules (deterministic)

### 4.1 · Coach is briefing-driven, not chat-driven

The engine produces structured briefings per (surface, mode) — never a
chat thread. Runner replies via typed reply chips on briefing cards
(written to `check_ins.rating + extras` and `coach_intents`).

Citation: `docs/2026-05-30.html §READ THIS FIRST`, no chat tables in
schema, no `conversations`/`messages`/`tool_call_log`/`kb_chunks` tables.

### 4.2 · Doctrine lives in files, not the DB

The 28 Research markdown files under `/Research/` are the canonical
reference. The engine reads them at runtime. No RAG, no embeddings, no
pgvector — the corpus is small enough to load relevant sections directly
at prompt-assembly time. `learn_articles` is the runner-facing summary
surface, not the engine's retrieval source.

Citation: `Research/INDEX.md`, `docs/2026-05-30.html §8 L2 — Research / doctrine layer`.

### 4.3 · Truth contract — prereqs gate topics

Every topic kind has a `prereqs(state)` function. Topics whose prereqs
fail are filtered before the LLM ever sees them. Examples:
`cadence_experiment` requires `profile.height_cm`; `race_horizon`
requires `nextARace` not null; `run_recap` requires
`latest_activity.date === today`.

Citation: `web-v2/lib/topics/types.ts`, `docs/2026-05-30.html §10`.

### 4.4 · Race wins ties (training vs race VDOT)

Race candidates carry VDOT at face value. Training-run candidates carry
VDOT - 1 for sort purposes. A single real race always wins ties against
a training estimate.

Citation: `web-v2/lib/training/vdot.ts:bestRecentVdot` sortKey.

### 4.5 · One voice — locked

"Direct" voice — honest, time-aware, no hype, no exclamation marks, no
emoji, no em dashes. Voice variants (encouraging / technical) are NOT
supported. Coach voice extends across every surface and every client.

Citation: `docs/coach/PHILOSOPHY.md §Voice`,
`Design/running-app-design-brief.md §Tone of voice`.

### 4.6 · Cap-at-85 ceiling

Both `vdotFromRace` and `vdotFromRun` return null when computed VDOT is
outside `[30, 85]`. This is the Daniels' table boundary (extended through
85 per project memory). Predicted race times clamp the inverse search to
the same window.

Citation: `web-v2/lib/training/vdot.ts:rawVdot` clamp, memory
`project_daniels_vdot_cap.md`.

---

## 5 · Voice + UX rules

### 5.1 · Three locked principles (coach philosophy)

1. **Let the coach decide** — the page is what the coach decided to show, not a template the coach fills in.
2. **Truth contract** — never invent; speak qualitatively about unreliable numbers; defer prescriptions when data-limited.
3. **Cards coach too** — every card except `fun_fact` and `profile_gap` carries a `coach_note`.

Citation: `docs/coach/PHILOSOPHY.md §Three locked principles`.

### 5.2 · The page is alive

Composition is state-driven, not template-driven. A page rendered at race
week and a page rendered 4 months out look meaningfully different. Beats
and elements promote / demote / appear / disappear based on training state
(off-season / base / build / peak / taper / race-week / race-day / post-race / injury).

Citation: `CLAUDE.md §Operating posture`,
`Design/running-app-design-brief.md §The page is alive`,
`BuildResearch/C1-overview-and-today.md §Conditional layouts`.

### 5.3 · Three questions, in order

Every surface answers, in this order:

1. **What should I do today?** (prescription)
2. **How am I doing it?** (body state)
3. **How am I doing overall?** (trajectory)

If the page doesn't answer these three in 2 seconds at a glance, the
hierarchy is wrong.

Citation: `Design/running-app-design-brief.md §The three questions`.

### 5.4 · Color is semantic, not decorative

Five locked accents, each with ONE job: `recovery` (green), `active`
(blue), `race` (orange), `warn` (rose), `milestone` (gold). Plus the
phase palette for terrain encoding. No ornamental multi-color.

Citation: `Design/running-app-design-brief.md §Color palette`.

### 5.5 · One hero per screen

Hero = display-type, accent color, real silence. One per screen, maximum.
Equal weight across the page is failure.

Citation: `Design/running-app-design-brief.md §Hierarchy`.

---

## How learnings become doctrine

The propagation flow when David (or any user) surfaces a new pattern:

1. **Pattern emerges** in conversation, code review, or live use (e.g., "Big Sur was elevation-distorted; we need to exclude it from VDOT").
2. **Rule is drafted** in CLAUDE.md, the appropriate code module, or the relevant Research file with citations to the prior incident.
3. **Code is updated** to enforce the rule (e.g., `bestRecentVdot` skips `priority='hilly-excluded'`).
4. **`learn_articles` row is seeded** with eyebrow='SYSTEM DOCTRINE' so coach engine + every client can read it.
5. **Every future user inherits the rule** automatically — they don't have to re-derive Big Sur's elevation problem from their own data.

The doctrine is **append-only within the active session**. Rules that
turn out to be wrong are explicitly revised with a citation linking
old → new — never silently mutated.

---

## Where each client reads doctrine

| Client | Access |
|---|---|
| **Coach engine** (server-side) | Reads `/Research/*.md` directly at prompt-assembly time + the code-encoded rules in `web-v2/lib/`. |
| **Web app** | Reads `learn_articles` via `GET /api/learn/[slug]` for runner-facing explainers. Doctrine surfaces as "Read the research →" links on briefing cards. |
| **iOS app** | Same — `GET /api/learn/[slug]` via Bearer auth. Renders in the in-app reader. |
| **Watch app** | No direct access. Doctrine never renders on the watch (watch is reductive — numbers + prescription only). The coach engine has already applied the doctrine before sending the prescription. |

All three clients hit the **same API routes**. The clients differ only
in how they render the response — not in which doctrine they consume.

---

*This document is the contract. When a new rule is locked, add it here
with the date + citation. When a rule is revised, link the revision back
to the original. Never silently delete.*
