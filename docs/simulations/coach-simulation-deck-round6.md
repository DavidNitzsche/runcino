# Coach Simulation Deck · Round 6 (2026-05-19 closing)

## Headline · web app phase closed, iPhone phase open

Round 5 closed the coaching-presence arc — finding-bearing surfaces across `/overview`, `/races`, `/profile`. Round 6 closes the **iPhone-readiness trifecta**:

- **V6** · One coach across every surface · `lib/coach-voice.ts` + alignment pass
- **V7** · Surfaces reference each other coherently · five earned cross-references with relation-strength discipline
- **S6** · API surface categorized + tier-1 contracts documented + iPhone integration brief

That's the structural foundation for native development. The web-app arc closes here. iPhone backend prep opens next.

## The trifecta

### V6 · Coach voice unified

Audit found 13 tonal patterns drifting across surfaces. Five-axis drift map. Worst: **seven different verbs for one architectural job** (`revise` / `weaken` / `lift` / `drop` / `switch` / `reconsider` / `raise`).

`lib/coach-voice.ts` codifies:
- Three voice modes: second-person (body/state) · impersonal (data observation) · "we" (coach verdicts)
- Canonical `FALSIFIER_PREFIX` = "What would change our mind:" (already used by 3/4 banner surfaces — locked into one source)
- Two falsifier verbs only: `we'd revise` (category flips) + `would weaken this read` (evidence-strength drops)
- Shared phrases: `COLLECTING_EVIDENCE`, `SIGNALS_CONFLICTED`, `INJURY_SUSPENDED`
- `EVIDENCE_SOURCES` constants for uniform signal-source noun naming
- `formatFalsifier`, `formatRevisionThreshold`, `formatReversal`, `formatDiagnosis`, `formatCrossReference` helpers

Alignment pass: V3 trajectory Rule 2 violation fixed (tooltip-only → inline), 7 falsifier verbs collapsed to 2 across `race-trajectory.ts` / `validate-race-feasibility.ts` / `validate-max-hr.ts`, C5 PR coaching lines consolidated from inline-in-render to `lib/pr-coaching.ts`.

### V7 · Cross-surface reference layer

Five earned cross-references wired. Each carries a concrete relevance check (Rule 1 from the V7 cross-reference discipline rules added to `coach-voice.ts`):

| # | Source → Target | Relation | Relevance check |
|---|---|---|---|
| 1 | V5 Z2 stimulus → C6 readiness | `consistent with` | state is yellow/red + V5 firing + at least one fatigue-family input pushed C6 down |
| 2 | Signal 4 PR → VDOT verdict | `contributing to` | s4FiresUp AND prsInWindow non-empty |
| 3 | V3 BEHIND → C8 substitution menu | `tied to` (structural) | trajectory state literally changes `recommendedIndex` in same render — "TIED-TO SEMANTIC CHECK" test enforces |
| 4 | Suspect ceiling → Z2 sparkline | `tied to` (three-case window) | predates window → null · recent half → hedged · older half → clean |
| 5 | E1/E4 injury → L7 signals | `INJURY_SUSPENDED` constant | banner dismisses with explanation rather than silent disappearance |

Cross-references are **earned, not decorative**. Topic overlap alone never fires. Three discipline rules locked in module-level docs:
1. Earned not decorative · every caller has a code-level relevance check
2. Relation strength hierarchy · `see also` < `consistent with` < `contributing to` < `tied to` · weakest accurate wins
3. One cross-reference per surface per render · frequency cap

Grammatical asymmetry of `contributing to` (causal — subject inversion) locked as a test ("the Disney HM on /races is contributing to this" — not "contributing to the Disney HM on /races"). Navigation `href` threaded through every cross-reference for iPhone deep-link readiness.

### S6 · API surface stable

89 routes categorized into four stability tiers:

| Tier | Count | iPhone treatment |
|---|---|---|
| 1 · Stable public | ~30 | Direct consumption |
| 2 · Web-app-internal | ~40 | Build iPhone-specific equivalents |
| 3 · Admin-only | 22 | Off-limits |
| 4 · Experimental | 2 | Off-limits |

Six docs files in `/docs/api/`:
- `README.md` — index + maintenance + audit
- `tier-1-stable-public.md` — full per-endpoint docs for the ~30 iPhone-callable routes
- `tier-2-internal.md`, `tier-3-admin.md`, `tier-4-experimental.md` — one-liner inventories
- `iphone-integration-brief.md` — **the actionable handoff**

Audit clean: no Rule 1 / 2 / 5 violations across tier-1. One shape concern (`/api/overview` SSR envelope · iPhone composes from granular tier-1 instead). Three duplicate-naming cleanup candidates flagged (not blocking).

## Six-rule architecture status

| Rule | Status | Round 6 evidence |
|---|---|---|
| 1 · L6 source-of-truth | ✅ locked | All tier-1 audit checks confirm correct source per data domain |
| 2 · falsifier-required | ✅ locked | V6 codified `FALSIFIER_PREFIX` + helper · V3 inline-render fix · empty-falsifier throws at runtime |
| 3 · surface attribution | ✅ locked | API tier categorization IS the attribution matrix for backend |
| 4 · operational vs decision vs external | ✅ locked | All round-6 work self-executed (audit, lift planning, documentation) |
| 5 · per-finding context filters | ✅ locked | V5 → C6 cross-ref only fires when fatigue-family inputs present (not topic overlap) |
| 6 · multi-writer jsonb preserves fields | ✅ locked | No new instances this round (clean) |

Six structural rules hold. Each is a bug class encoded out of the system. The compounding cost-of-rule-encoding paid off: V6 + V7 + S6 were the largest single-round delivery yet, and the discipline made each subsequent step faster than the previous one.

## L7 four signals · current state (honest)

| Signal | What it measures | Status | Awaiting |
|---|---|---|---|
| Signal 1 · threshold workouts | 3+ T workouts trended faster at controlled HR | 🟡 framework live | first 3-workout sample meeting threshold + HR criteria |
| Signal 2 · Z2 pace at fixed HR | 5 s/mi pace drift over 4 weeks vs prior 4 | 🟡 framework live | 10+ Z2 mile-splits per 4-week window |
| Signal 3 · interval pace adherence | 3+ interval sessions trending faster than I-pace | 🟡 framework live | next 3 interval sessions hitting threshold |
| Signal 4 · PR trajectory (NEW R6) | 2+ race PRs in 8 weeks (soft) · 3+ (strong fire) | 🟡 framework live | David's next race finish |

Combined verdict status: silent. Three signals below their per-signal thresholds; Signal 4 has the soft-positive shape (1-2 fresh PRs) but doesn't fire individually. The system holds when evidence is insufficient — that's the discipline.

## Cross-reference firing matrix · which surfaces observed in production

Naming honestly: this is a NEW capability shipped this round. None of the five cross-references have been observed firing in production yet because the underlying conditions (V3 BEHIND, V5 firing + C6 yellow, etc.) haven't happened during the live data window. The framework + test coverage proves the conditions correctly produce the right output; live observation is a 2-3 race / 8-week wait.

| Cross-ref | Will fire when |
|---|---|
| V5 → C6 | V5 fires (Z2 share <40% × 3+ runs) + C6 yellow/red on a fatigue input |
| Signal 4 → VDOT | David logs 3+ race PRs in any 8-week window |
| V3 BEHIND → C8 | Race A-race set with goal + 3+ signals firing DOWN |
| Suspect ceiling → Z2 sparkline | Next max HR validation accepts a new value while sparkline window is active |
| E1/E4 → L7 | David marks himself injured |

The tests cover every shape. First-fires are observable telemetry.

## API surface map summary

```
                            89 routes total
                                  │
        ┌───────────┬─────────────┴────────────┬──────────────┐
        │           │                          │              │
    Tier 1       Tier 2                    Tier 3         Tier 4
   (~30)        (~40)                      (22)            (2)
    │             │                         │              │
  iPhone-      Web SSR +                 Admin-          Experi-
  callable     auth + OAuth +            only            mental
               page bundles
    │             │                         │              │
  Settled       Optimized                  Off-          Don't
  contracts     for one                    limits        depend
                page each
```

## Product framing decision · same product, two surfaces, iPhone-leaning

David's answer (logged this session):

- **iPhone is where the coach gets USED** — daily-touch, in-pocket, before/after runs, push notifications when verdicts fire
- **Web is where the coach was BUILT and lives** — plan editing, race planning, full Coach Reads breakdown, retrospectives, settings, integrations
- Both first-class but optimized for different jobs
- Same intelligence stack underneath — V6 voice, L7 signals, compute-vdot serve both identically

What this means for the tier-2 → tier-1 lifts: they get a slight priority bump because they scale **both** surfaces. iPhone composes from them directly; web eventually migrates away from SSR-envelope patterns to consume them too. Compounding value, not throwaway work.

The `/api/overview` shape concern from the S6 audit becomes long-term cleanup, not urgent for iPhone shipping.

## Five gaps to close before iPhone client development

From the S6 iPhone integration brief, in priority order:

1. **Token auth** (`POST /api/auth/token` + refresh + revoke) — gates every authenticated request · ~3-5 days
2. **Tier-2 → tier-1 lifts** — 7 computations exposed as standalone GETs (`/api/profile/activity-gap`, `/api/health/readiness`, `/api/health/z2-coverage`, `/api/health/z2-sparkline`, `/api/races/[slug]/trajectory`, `/api/races/[slug]/projection`, `/api/adaptive/vdot-verdict`) · ~2-3 days
3. **HealthKit ingest** (`POST /api/health/ingest`) — batched samples from iOS · ~1 day
4. **Push notifications** — APNs subscription + verdict-firing fan-out hooks · ~3-5 days
5. **Mobile OAuth + onboarding** — JSON twins of existing redirect flows · ~3 days

Rough total: ~2 weeks of backend work before iPhone client can be meaningfully developed.

Plus the three naming-duplicate cleanups (`goal`/`goals`, `race-retrospect`/`retrospective`, `health/checkin`/`checkin`) — 30-minute cleanup, queue before or alongside the tier-2 lifts.

## What David sees when he opens the app today (final web-app state)

**`/overview`**:
1. Coach strip · check-in
2. **StravaGapCard** — silent (no gap)
3. **PostRaceCard** — silent (outside any recovery window)
4. Hero TodayCard:
   - Left: today's workout · V2 conditional pace · V1 briefing · V5 Z2 stimulus check (firing: 0/6 in Z2, 22% share) inside `#z2-stimulus-check` anchor (V7 ready)
   - Right: **C6 readiness ring** + **V7 V5→C6 cross-reference** ready to fire on next fatigue-day · readiness recommendation
5. **HeroActions** — OPEN WORKOUT · SKIP TODAY · **⇄ Substitute** (matched-size buttons, fixed today)
6. Week strip
7. WhyThisWorkoutTooltip on the prescription

**`/training`**:
1. Phase Hero + Plan Arc · 14 weeks
2. Full Schedule volume curve · **miles-in-the-bank chip** (relocated from `/overview` to `/training` per surface fit)
3. 14-week calendar grid
4. Plan Adapted feed
5. Your Paces

**`/races`**:
1. Coach strip with E3 logic
2. A-race hero "Path to the Line"
   - Current Fitness · Gap to Goal · **V3 Trajectory** (now with **falsifier rendered inline**, not tooltip — V6 fix)
3. **C9 race projection chart** (maintain vs plan lines, goal line reference)
4. Personal Records grid with **C5 coaching lines** (consolidated to `lib/pr-coaching.ts`) inside `#personal-records` anchor (V7 ready)

**`/profile` Coach Reads**:
1. VDOT 46.6 + race contributors
2. **AdaptiveVdotBanner** — uses canonical `FALSIFIER_PREFIX` from coach-voice.ts · ready to surface **V7 Signal-4 → VDOT cross-reference** when next PR contributes to a bump
3. VdotShiftBanner · silent (baseline)
4. **MaxHrValidationBanner** — canonical falsifier prefix · inside `#max-hr-validation` anchor (V7 ready) · MaxHr Apply now stamps `max_hr_updated_at` for Z2 sparkline's three-case window check
5. **Z2 Sparkline** — V7 recalibration cross-ref ready (settled / hedged / clean)
6. **Adaptive signals suspended notice** — fires when injury is marked (V7 item 5)
7. Pace bands

The coach speaks one voice across all four surfaces, references findings across surfaces when relevance is earned, and never goes silent without explanation when state changes.

## iPhone phase definition

**Phase 1 · backend gap work** (~2 weeks):
- Token auth → tier-2 lifts → HealthKit ingest → push notifications → mobile OAuth/onboarding
- Three naming-duplicate cleanups alongside the lifts
- Final state: every iOS screen has a documented tier-1 endpoint to call

**Phase 2 · iPhone client development** (opens after Phase 1):
- iOS app consumes tier-1 endpoints exclusively
- Web continues to use tier-2 SSR envelopes (no rewrite required)
- Push notifications wire to L7 verdict firings, large-shift guards, race-day reminders
- HealthKit ingest streams resting HR, sleep, VO2max passively

Same intelligence stack underneath — V6 voice, L7 signals, compute-vdot, every cross-reference — serves both surfaces identically.

## Commits this round (sample)

| Commit | Scope |
|---|---|
| `8dc7de4` | V6 · coach voice unified · lib/coach-voice.ts + first alignment pass |
| `bbd9882` | V6 refinements · split inconclusive-state + C5 consolidation + V7 hook |
| `8e20d30` | V7 item 1 · V5 → C6 cross-reference + nav hook + discipline rules |
| `cc2b69d` | V7 item 2 · Signal 4 PR → VDOT explainer cross-reference |
| `a594631` | V7 item 3 · V3 trajectory → C8 substitution menu (tied-to verified) |
| `3bf5a70` | V7 item 4 · suspect ceiling → Z2 sparkline · three-case window logic |
| `585a3fb` | V7 item 5 · INJURY_SUSPENDED state explicit in UI |
| `fbacc4e` | S6 · API surface categorized + tier-1 docs + iPhone integration brief |

Plus the C7 chip relocation (`9ffee04`), substitute-button size fix (`aea371c`), and various V6 doc scrubs along the way.

## Lessons that compound across rounds

1. **The "tied to" semantic check is the right discipline test for cross-reference relations.** Without it, any topic overlap could claim to be "tied to" anything. Item 3's "BEHIND → ON-TRACK changes output in same render" test enforces structural derivation permanently. Future agents can't weaken the relation without explicitly downgrading it.

2. **Earned-not-decorative beats every comprehensive-feeling impulse.** The V5 → C6 cross-reference fires only when fatigue-family inputs reduced C6. Topic overlap alone is silent. The runner trusts the coach more when cross-references mean something concrete.

3. **The three-case window logic in item 4 is a discipline of the system being honest about what data it's looking at.** Telling a runner "zones recalibrated" when the recalibration is settled history outside their visible window would erode trust faster than well-earned cross-references build it.

4. **Categorization IS half the work.** Without S6's tier categorization, iPhone development would build against routes that were never meant to be stable. The act of bucketing each route into tier 1/2/3/4 forced the question: "would I bet on this contract?" — and that question is the actual API governance.

5. **Documentation grouped by domain reads faster than documentation by endpoint.** The tier-1 docs grouped by Profile / Fitness / Plan / Races / Shoes / Runs / Health / Connectors / Adaptive are scannable in 5 minutes. The same content as 30 separate files would be unnavigable.

6. **The iPhone integration brief is the deliverable that makes S6 actionable.** Categorization without the brief is academic; the brief turns "we have ~30 stable routes" into "here are the 5 gaps to close before iPhone client work starts, in priority order, ~2 weeks total."

## Closing observation

This arc closes the web-app phase. From "race-result database with explainer copy" (round 1) to "one coach speaks across surfaces, surfaces reference each other coherently, API stable + documented" (round 6) — six rounds, ~110 commits, ~16 weeks of session-time.

The compounding pattern:

- **Round 1-2**: foundational data plumbing (L1-L6), reliability discipline
- **Round 3**: adaptive philosophy made operational (L7 framework, suspect-ceiling)
- **Round 4**: first coaching finding surfaces in production (V5 firing)
- **Round 5**: coaching presence multiplies across daily-touch surfaces; Rule 6 promoted
- **Round 6**: voice unified, cross-references earned, API stabilized for native consumption

Six structural rules hold. Four L7 adaptive signals are framework-complete and awaiting first-fires on live data. Five cross-references are wired and waiting for their relevance conditions to land in production. The API surface is categorized, documented, and mapped to iPhone needs.

What David sees when he opens the app today: a coach that speaks like one person, observes its own data across surfaces, and tells him what would change its mind. The work to make it native opens next.

**Web-app phase closed. iPhone phase open.**

*Round 6 deck generated 2026-05-19 evening. Diff baseline: `coach-simulation-deck-round5.md`. Session boundary: this deck closes the session.*
