# Overnight Session Status · 2026-05-19

State of the world after the "Last push of the night" queue. Diff vs end-of-round-2.

## ✅ Shipped to `main`

Newest first. All commits pushed to `origin/main` immediately per CLAUDE.md.

| SHA | Title | Scope |
|---|---|---|
| `0ee8b84` | Max HR · fix two-surfaces-two-answers bug | Bug fix · `MaxHrIsland` ↔ `CoachReadsCard` desync after suspect-ceiling Apply |
| `85f31c4` | Round 3 simulation deck · closing artifact | `docs/simulations/coach-simulation-deck-round3.md` · 5 verdicts upgraded |
| `fb58f48` | A1/A2/A3 audits + S1 HR zones consolidation | Audit doc + shared `lib/hr-zones.ts` utility |
| `33f2b34` | V2 + V4 · workout-range guidance + migration banner before/after | Coach voice builds |
| `054bea3` | L7 · Passive VDOT updater · Signal 1 (T workout adherence) | The "alive" half of "alive but not nervous" |
| `50fd08e` | Round-2 deck · refresh inline sections to final 46.6 state | Doc correctness |
| `275fc23` | CLAUDE.md · race-data source-of-truth checklist | Four-question gate for future agents |

Pre-overnight context (already on `main` going in):
- `7cd908c` L6 systemic race-data audit — 11 components clean
- `18cb512` L5 Personal Records card races-first
- `82d0c01` Round 2 hotfix (prod build + Big Sur exclusion)
- `ec5d5b6` Round 2 L1 verified + L2/L3/L4 + U1 race-effort editor

## 🔧 Done · what got built

### L7 — Passive VDOT updater (Signal 1)
- **Schema**: 3 new columns on `users`
  - `vdot_manual_override` NUMERIC(4,1)
  - `vdot_manual_override_at` TIMESTAMPTZ
  - `adaptive_vdot_dismissed_at` TIMESTAMPTZ
- **Signals module** `web/lib/adaptive-vdot-signals.ts`
  - Signal 1 (T workout adherence) — **fully implemented**, 6-week lookback, Z4 HR check, faster/slower tagging
  - Signal 2 (pace-at-fixed-HR drift) — stubbed (needs per-mile HR streams)
  - Signal 3 (interval pace) — stubbed (mirrors Signal 1 pattern)
- **Verdict module** `web/lib/adaptive-vdot-verdict.ts`
  - Locked thresholds: UP needs 3 obs + 2.5 weight; DOWN needs 2 obs + 1.5 weight
  - Race-week suspension (within 7 days of A race)
  - Caps proposed bump at 1.5 VDOT points per banner
- **API route** `web/app/api/profile/adaptive-vdot/route.ts`
  - POST actions: `apply`, `dismiss` (30-day suppress), `clear-override`
- **Banner UI** `web/app/profile/AdaptiveVdotBanner.tsx`
  - Matches suspect-ceiling shape (evidence + reasoning + math + recommendation + falsifier + agency)
  - `window.location.reload()` on Apply (consistent with other banners)
- **Override semantics in `compute-vdot.ts`**
  - Honors `vdot_manual_override` if no fresh race post-dates it
  - Auto-clears when newer race lands → race-first source-of-truth preserved

### V2 — Conditional pace guidance on TodayCard
- `overview/page.tsx` renders coaching line under pace tile for easy/recovery/long days
- "Target X/mi if feeling good. Back off toward the slower end if legs heavy / HR drifts above Z2 / temp >75°F."
- No render for threshold/interval (those are locked to specific paces)

### V4 — Migration banner before/after table
- `PaceMigrationBanner.tsx` accepts optional `beforeAfter` prop
- Compact Zone / Previous / Now / Δ table with color-coded deltas
- Display-only utility `web/lib/legacy-paces.ts` preserves the OLD formula for the comparison

### S1 — HR zones shared utility
- New `web/lib/hr-zones.ts` with `buildHrZonesBundle()` + `buildFitnessHrZones()`
- HRR (Karvonen) when resting HR known; %max fallback
- Removed inline duplication in `fitness-resolver.ts` AND `profile/page.tsx` (both used to compute zones separately)

### Max HR two-surfaces-two-answers fix (the most recent regression)
- **Root cause**: `MaxHrValidationBanner.onApply` called `router.refresh()` — re-renders server components but doesn't remount client islands → `MaxHrIsland` kept stale `useState`
- **Fix 1**: `window.location.reload()` (matches `PaceMigrationBanner` + `AdaptiveVdotBanner` pattern)
- **Fix 2**: `MaxHrIsland` accepts optional SSR `initial` prop so first paint matches Coach Reads
- **Fix 3**: Unified label "Set manually" → "Manual override · applies across the app"

## 🔍 Audits passed

`docs/simulations/audit-passes-2026-05-19.md`

| Audit | Scope | Verdict |
|---|---|---|
| A1 | Every adaptive banner follows the suspect-ceiling shape | ✅ no holdouts |
| A2 | Every VDOT-derived surface reads aggregate, not stale | ✅ 14 consumers verified |
| A3 | Every race-effort-level consumer honors the weight multiplier | ✅ honored at `compute-vdot` |

`docs/simulations/race-data-source-audit-L6.md` (pre-overnight):
- All 11 race-RESULT consumers read from `races.actual_result`
- Non-race consumers (HR validator, sync, caching) correctly use `strava_activities`

## 🧪 Simulations & tests run

- **Round 3 simulation deck** — `docs/simulations/coach-simulation-deck-round3.md`
  - 5 verdicts upgraded vs round 2 (A4, D6, A3, F3, audits)
  - 0 verdicts downgraded
  - Tracks "framework → real fire" pattern week over week
- **L7 unit tests** — `web/lib/__tests__/adaptive-vdot.test.ts` — 13 new tests pass (bump-points math, thresholds, signal shape, T1 scenarios)
- **NEXT 4 WEEKS monotone check** — `web/lib/__tests__/no-monotone-easy-stretches.test.ts` — 7 tests pass across 30/50 mpw base mode + post-race (HM/marathon) + BUILD + REBUILD + 4-fixture matrix
- **Full suite snapshot** — 158/158 passing (1 pre-existing failure on missing `big-sur-3-50.runcino.json` fixture, unrelated)
- **TypeScript** — `tsc --noEmit` clean

## 🟢 Confirmed working

- L7 framework wired end-to-end; banner renders if Signal 1 fires (awaiting real-data fire)
- Max HR Apply flow — both surfaces now show same value
- Migration banner before/after table renders for users with VDOT drift
- HR zones single source of truth across `/profile` + fitness-resolver
- Adaptive banner shape consistency (suspect-ceiling template) across all surfaces
- Source-of-truth discipline: race results read from `races.actual_result`; HR/sync from `strava_activities`
- Effort-multiplier honored: A=1.0, B=0.7, C=0.4, tune-up=0.4, training-run=0.2, hilly-excluded=0.0
- `NEXT 4 WEEKS` never shows monotone easy stretches (engine post-processes via `enforceStreakCap`)

## 🟡 Built but not yet fired with real data

- **L7 Signal 1 banner** — framework live; same "queued for tomorrow → live, awaiting fire" status that suspect-ceiling had pre-2026-05-19
- **Migration banner before/after** — only renders when there's a delta to show; needs a VDOT-changing event to surface naturally

## 🔴 What's left to do

### Tier-1 next-session priorities
- **V1 — Pre-workout briefing on TodayCard** *(#1 next build per round 3 deck)*
  - Needs weather + shoe + last-similar-session integration
  - Deferred because it touches more surfaces than V2/V4
- **L7 Signal 2** — pace-at-fixed-HR drift
  - Needs per-mile HR streams from Strava API (not currently pulled)
- **L7 Signal 3** — interval pace adherence
  - Pattern mirrors Signal 1; should be straightforward once Signal 2 lands the streams API
- **Ongoing large-shift guard** for VDOT changes
  - Currently only the one-time migration banner exists
  - Want a "your VDOT moved >2 pts since last login — review?" surface

### E-tier edge cases (E1-E6, queued)
- E1 — Stale Strava signal (no sync in N days)
- E2 — Morning-after-race awareness
- E3 — No-upcoming-race UX
- E4 — Miss-3-days coaching
- E5 — Cycle transition (Aug 17 next one)
- E6 — Race-week taper logic

### C-tier nice-to-haves (C1-C9)
- C1 — Why-this-workout tooltip
- C2 — HR-pace sparkline
- C3 — PR trajectory as adaptive signal
- C4 — PR-anchored race feasibility
- C5 — PR coaching lines
- C6 — Daily readiness score
- C7 — Plan vs actual mileage
- C8 — Workout substitution menu
- C9 — Race result projection chart

### S-tier systemic cleanup
- S3 — Race-priority editor cache invalidation (queued, not urgent)
- S4 — Elevation-adjusted finish times
- S5 — Rose Bowl auto-migration visibility
- VDOT 61–72 second-source verification

### L7 Signal 1 enhancements
- Heat / sleep / load context filters in `adaptive-vdot-signals.ts` (currently only attenuates for missing HR)

## 🌿 Worktree-only (not yet on main)

The `claude/objective-black-8f3e69` worktree has 80+ commits ahead of `origin/main`. Most-recent ones relevant to tonight:

| SHA | Title | Notes |
|---|---|---|
| `1d5fc8c` | fix(engine): tier-aware consecutive-non-rest cap in `next30Days` | Built + tested + verified earlier this turn |
| `339dbbf` | Merge `origin/main` into worktree | Pulled in the overnight `main` commits |

These need a fast-forward merge from this branch to `main` before they ship. Worth surfacing because the `enforceStreakCap` fix lives only here right now.

## 🩺 Prod health

- `https://faff.run` — brief 70-second blip 09:53:24Z → 09:54:34Z (connection-failure → 301 recovered)
- Consistent with deploy restart or transient edge issue, not a sustained outage
- No action needed

## 🔍 Morning verification (run against current `main`)

| Item | Verified | Evidence |
|---|---|---|
| Coach Reads VDOT = 46.6 | ✅ | `scripts/calc-david-aggregate.ts` recomputes to **46.6**. Weight shares: Disney HM (A) 53.3%, Disney HM (C) 21.3%, Pasadena HM (A) 14.0%, LA Marathon (A) 11.4%, Big Sur (hilly-excluded) 0.0%. Matches round-2 final state. |
| Max HR Apply syncs both surfaces | ✅ | `MaxHrValidationBanner.tsx:69` calls `window.location.reload()` on success; `MaxHrIsland.tsx:59` accepts `initial` prop; `profile/page.tsx:429` passes `{ value, source }` from `resolveFitness` (same call Coach Reads uses) |
| TodayCard V2 conditional guidance for easy days | ✅ | `overview/page.tsx:248–268` — renders for easy/recovery/long only; threshold/interval days skip the helper copy |
| L7 banner gating logic correct | ✅ | `adaptive-vdot-verdict.ts` constants verified: `UP_OBS_MIN=3`, `UP_WEIGHT_MIN=2.5`, `DOWN_OBS_MIN=2`, `DOWN_WEIGHT_MIN=1.5`, `RACE_WEEK_SUSPEND_DAYS=14`; `buildAdaptiveVdotVerdict` runs at SSR in `profile/page.tsx:173`, banner only renders when `hasFinding && !dismissed && recommendation.kind ∈ {bump, downgrade}` |

**L7 fire-status cannot be probed locally** — `.env.local` has no `DATABASE_URL`, so the live signal evaluation runs only in prod. When you open the app: banner present → 3+ threshold workouts in last 6w with 2.5+ weight tagged faster, or 2+/1.5+ tagged slower. Banner absent → gating correctly waiting for evidence. Either is a valid pass.

## 🗑️ Worktree status — stale parallel timeline, abandon

The `claude/objective-black-8f3e69` worktree is **NOT a candidate for fast-forward**. Investigation:

- **Worktree tip**: `339dbbf` (2026-05-12) — a merge of `origin/main` into the branch
- **Main tip**: `0ee8b84` (2026-05-19)
- **Divergence**: worktree is 97 commits **ahead** of main on a stale timeline AND 365 commits **behind** main on the post-May-12 work (round 2, L1–L7, V2/V4, S1/S6, A1–A3)
- **Architecture has diverged**: the worktree's `enforceStreakCap` fix targets a day-level `simulateNext30Days()` function in `coach-engine.ts` that **does not exist on main**. Main's `NEXT 4 WEEKS` is built from `trajectory14wk` (weekly aggregates from `training/data.ts:607`), not a day-by-day projection. The "monotone easy stretch" failure mode is specific to the old architecture.

**What the 97 worktree commits contain** (all 2026-05-08 → 2026-05-12):
- Dashboard redesign (hero layout, card grids, body-context cards, SVG infographic icons) — superseded by main's current dashboard
- VDOT improvements (best efforts, time-decay, tier badges) — replaced on main by cycle-aware compute-vdot + race-effort weighting
- Hub unification (`RunnerHub`) — present in both branches but evolved differently
- Plan-integrity validator — main has its own plan-validator + adaptive-pattern guardrails
- Phase-aware dashboard tiles, daily briefs, run-detail prescription-vs-actual — main has equivalents via Coach Reads + workout-descriptions
- `enforceStreakCap` (`1d5fc8c`, 2026-05-12) — solves a problem that doesn't exist in main's architecture

**Recommendation**: archive the worktree. No cherry-picks needed. The work it represents was conceptually re-done (and improved) on the `main` timeline via the round 1/2/3 + L1–L7 push. Keep the branch reference in case anything is genuinely lost, but treat `main` as the authoritative timeline going forward.

If you disagree with any of the above and want a specific commit pulled forward, name it and I'll do the cherry-pick with conflict resolution against current main.

## 🎯 Next-session priorities — REVISED per David's feedback

In strict order:

1. **L7 Signal 1 context filters** — *promoted to top priority*
   - Skip workouts in heat >78°F (need weather data source — check if already pulled per-activity)
   - Skip workouts within 7 days of any race (race-recency filter — race calendar already in state)
   - Skip workouts with poor sleep flag IF data source available — otherwise queue for when sleep ingestion lands
   - Without these, a fast workout in 78°F could fire a VDOT bump that shouldn't. Conservative-on-the-upside principle depends on these filters.
2. **V1 — Pre-workout briefing on TodayCard** — #1 unshipped item per round 3 deck (weather + shoe + last-similar-session)
3. **L7 Signal 2** — pace-at-fixed-HR drift (blocked on per-mile HR streams from Strava ingestion)
4. **L7 Signal 3** — interval pace adherence (mirrors Signal 1 once Signal 2's streams API lands)
5. **Ongoing large-shift guard** — "VDOT moved >2pts since last login — review?" surface (currently only one-time migration banner exists)
6. **C2 — HR-pace sparkline** — coordinate with Signal 2 if streams pulled together
7. **E-tier edge cases** (E1–E6) as time allows
8. **C-tier nice-to-haves** (C1, C3–C9)
9. ~~Worktree merge / cleanup~~ → **resolved: abandon, see above**

## 🧠 Pattern notes (worth preserving)

- **State desync across rendering boundaries**: when an Apply flow touches both server-rendered and client-island surfaces showing the same data, `router.refresh()` alone leaves client `useState` stale. Pattern fix: either pass SSR initial state to the island, or use `window.location.reload()` on success. The max HR validator was the inconsistency tonight; flag this whenever a new Apply flow lands.
- **"Framework → live → fires" transition**: L7 Signal 1 is now in the same phase suspect-ceiling was in 24h ago. The pattern is repeatable. Banner UIs ship before real data fires them, and the gating logic is what gets verified between ship and first-fire.

## 📁 Doc index

- `docs/simulations/audit-passes-2026-05-19.md` — A1/A2/A3 audit verdicts
- `docs/simulations/coach-simulation-deck-round3.md` — closing artifact for the overnight push
- `docs/simulations/coach-simulation-deck-round2.md` — refreshed to final 46.6 state
- `docs/simulations/race-data-source-audit-L6.md` — race-data source-of-truth map
- `docs/ADAPTIVE_STATE.md` — snapshot of "alive but not nervous" architecture
- `CLAUDE.md` — race-data four-question checklist (added overnight)
