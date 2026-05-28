# Coach architecture — 2026-05-27

Brief for a new agent picking up the coach. Read once, then go.

---

## TL;DR

**/today is deterministic. Zero LLM calls. Rules + templates over CoachState.**

Other surfaces (`/training`, `/races`, `/health`, `/profile`, `/race-detail`) still use the LLM tool-use loop in `lib/coach/engine.ts`. They'll migrate to templates next; the architecture supports both paths simultaneously.

---

## The big shift (2026-05-27)

We spent months tuning LLM voice and hit a wall: every brief had to be defended from drift, hallucination, stale-cache fingerprints, and prompt-version invalidation. The deterministic data was always right; the LLM was the unreliable layer narrating it.

David's call: **rip the LLM out of /today**. Replace with templates that read CoachState and emit the same `BriefingResponse` shape.

What that bought us:
- **Zero drift.** Same data → same brief, every time.
- **Zero cost.** $0/render instead of paying per generation.
- **Instant.** No 3-second LLM wait.
- **Snapshot-testable.** Every (state, data) combo is a string we can lock.
- **Debuggable.** "Why did the coach say X?" → "this branch matched in `postRun()`, line N."

What we gave up: stochastic word choice. Templates feel templated after enough exposure. Solve with variants (`hash(date + run.id) % 4`) if needed — not yet built.

---

## The voice spec

Lives in `docs/` as **"RunCore — Coach Note Agent Rules"** (David authored it during this session — paste-quote it inline if you need to). Key invariants:

1. **One flowing paragraph.** 3-6 sentences, spoken-aloud, single `voice[0]` string. No bullets, no headers, no stat dumps.
2. **Arc**: verdict → defining metrics → place in week → THE LIMITER → next action. Don't label sections; just write them in order as natural speech.
3. **Always cite the athlete's bands, never absolutes.** "dead in your Z2 band" not "141 is a low heart rate."
4. **Stat → meaning first.** Lead with what the number means; cite the number softly afterwards.
5. **Signal vs noise.** Small variance is noise — mention lightly and defuse ("nothing to chase"), or skip. Only signal earns ink. Cadence ±3 spm from baseline = skip. ±4-7 = mention + defuse. ±8+ = real callout.
6. **Single ranked limiter.** Pick ONE thing this week. Priority: `niggle > sleep deficit > load high > under-load > recurring TIRED > nothing`. When recovery is the limiter, say it outranks the training. Never manufacture concern — a clean day stays clean.
7. **Headlines**: caps-locked scoreboard style. `EASY RUN DONE` / `THRESHOLD ON DECK` / `REST DAY` / `RACE DAY` / etc.

---

## Code map

### Where the deterministic template engine lives

```
lib/coach/templates/today.ts        ← the template engine
lib/coach/engine.ts                  ← dispatches /today → templates,
                                       other surfaces → LLM
lib/coach/router.ts                  ← resolveMode(surface, state, race?)
                                       returns { surface, mode, candidateTopics }
```

The dispatch in `engine.ts:generateBriefing()`:

```ts
if (resolved.surface === 'today') {
  const { renderTodayBriefDeterministic } = await import('./templates/today');
  return renderTodayBriefDeterministic(state, resolved, userId, eligible);
}
// ... fall through to LLM tool-use loop for other surfaces
```

### Inside `templates/today.ts`

- **Mode dispatcher** (`renderTodayBriefDeterministic`): branches on `resolved.mode` → `post-run | pre-run | rest-day | race-day`.
- **Per-mode renderers** (`postRun`, `preRun`, `restDay`, `raceDay`): build the brief as a sequence of sentences then `.join(' ')` into a single paragraph.
- **Sentence-level builders**:
  - `verdictSentence` — opening line characterizing the run/day
  - `hrReadSentence` — HR vs Friel-zone band, stat → meaning translation
  - `cadenceSentence` — returns null for noise (±3), defused for moderate (±4-7), real callout for signal (±8+)
  - `weekPlacementSentence` — load + week vs plan + long-run outlook
  - `limiterSentence` — picks ONE from the priority queue
  - `nextActionSentence` — tomorrow + type-specific directive
- **Helpers**: `zoneOf(state, hr)` returns `'z2' | 'z2-top' | 'z3' | ...`; `headlineForCompletedRun(type)` returns the caps headline.

### Input: CoachState

Loaded by `lib/coach/state-loader.ts:loadCoachState(userId)`. The full shape is in `lib/topics/types.ts:CoachState`. Key fields the template engine reads:

- `latest_activity` — today's run (if `date === today`)
- `todayWorkout` — today's planned workout
- `nextWorkout` — tomorrow (or next non-rest planned day)
- `nextARace` — next A-race with `days_to_race`
- `currentWeekDays` — Mon-Sun planned + done mi
- `weekDone`, `weekPlanned`
- `loadAcwr`, `loadAcute7`, `loadChronic28`
- `sleep7Deficit` (used in limiter)
- `recentCheckIns` (for repeated-TIRED limiter detection)
- `activeNiggle` (priority-1 limiter; currently always null — see "What's NOT done")
- `profile.lthr` (used to compute Friel zones)
- `cadenceBaseline`

### Output: BriefingResponse

Defined in `lib/coach/engine.ts`. The template returns the same shape as the LLM path:

```ts
{
  surface: 'today',
  mode: 'post-easy' | 'pre-run-easy' | ...,
  lead: 'EASY RUN DONE',           // headline
  voice: [ '... one paragraph ...' ],  // ONE string in v1
  topics: [],                       // empty in v1 (right rail uses other components)
  proposed_alternative?: {          // optional swap proposal (deterministic rule)
    alt_type, alt_distance_mi, alt_label, reason,
  },
  _state: {                         // metadata for UI + debug
    user_id, today, candidateKinds, eligibleKinds,
    weekDone, weekPlanned, phaseLabel,
    sleep7Avg, sleep7Deficit, rhrCurrent, rhrBaseline,
    cadenceBaseline, nextARaceName, daysToARace,
    readiness, todayWorkoutType, todayRunId,
    toolTrace: [],                   // empty for deterministic path
    promptVersion: 'deterministic-v2',
  },
}
```

---

## Swap proposal rule

Deterministic — not LLM judgment. In `templates/today.ts:maybeSwapProposal()`:

```
trigger when:
  loadAcwr > 1.5
  AND (sleep_deficit >= 5h  OR  recent TIRED count >= 2)
  AND user hasn't already declined a swap today
```

If triggered, recommends a recovery run at `min(4, planned * 0.65)` mi with a templated reason citing whichever signals fired.

The acceptance/decline flow logs an intent to `coach_intents` table; the resolver checks `pendingIntents` next render.

---

## /today page wiring

`app/today/page.tsx` is the page composition:

```
<TopNav />
<HeroStrip>
  <ReadinessRing /> + <Hit /> + <RaceBreadcrumb />
</HeroStrip>
<WeekStrip />               ← components/today/WeekStrip.tsx
<Cols>
  <CoachBlock />            ← left col: the voice (via BriefingLoader)
  <Stack>                    ← right col:
    <AtAGlanceCard />        ← 2×3 status-dot tile grid (NEW today)
    <TodayPlannedCard />     ← planned/done bar
  </Stack>
</Cols>
```

The right rail used to render LLM-emitted topic cards; that's gone. `AtAGlanceCard` (`components/today/AtAGlanceCard.tsx`) is now the primary right-column component — six tiles: SLEEP · HRV · RHR · LOAD · WEEK MI · RACE. Each has a status dot (green/amber/red) based on per-metric band logic.

---

## What's explicitly NOT done (and why)

1. **Niggle / sick / post-race detection.** Punted. `activeNiggle` is always null because we killed the free-text check-in that produced it. The limiter has a `niggle` branch but it never fires. When detection is rebuilt (chips/sliders, not free-text), the branch is ready.

2. **Check-in UI.** Removed from /today entirely (`BriefingLoader.tsx`: `showCheckin={false}` hard-coded). The post-run "How'd the run go?" textarea + chip picker is gone. David will bring it back as chips/sliders only, no LLM extractor.

3. **MISSED state detection.** Mocked in `docs/app-mockups-2026-05-27.html` but not wired. Would need plan.scheduled vs actual.ran comparison, plus a CATCH UP / MOVE ON button hero + plan-adapt logic. Worth doing in a dedicated batch.

4. **Other surfaces still use the LLM.** `/training`, `/races`, `/health`, `/profile`, `/race-detail` all hit the tool-use loop in `engine.ts`. They have the same architectural problems we just fixed for /today — drift, cost, latency, cache invalidation drama. Migration plan: each surface gets its own `templates/<surface>.ts` file with the same dispatch pattern.

5. **Right-rail topic-prereq system.** The whole `lib/topics/` apparatus (topic kinds, payload schemas, prereq functions, candidate-topic mapping per mode) is still wired through `engine.ts` for non-/today surfaces. Don't delete it. For /today specifically, route around it — the right rail now renders state-based components directly, not topic cards.

6. **Voice variants.** Single template per (state, condition) — no rotation yet. If the prose feels formulaic after a few weeks, add `hash(date + run_id) % N` variant selection in each sentence builder.

7. **Race-detail surface** has its own `mode` resolution (`race-week | sharpening | building | post-race`). Still LLM-driven.

---

## Recent gotchas (read these before changing data flow)

### 1. Run dedupe

`lib/runs/merge.ts:canonicalMileageByDay()` is the read-time defensive dedupe. The merge *writer* (also in `merge.ts`) flags duplicate `strava_activities` rows with `mergedIntoId`, but it only runs from a few ingest paths — Strava webhook → direct row insert doesn't trigger it. Duplicates pile up.

Every aggregation downstream (`loadGlanceState`, `loadCoachState`, ACWR query) now routes through `canonicalMileageByDay` so un-flagged dups don't inflate. If you write new aggregation, **don't `SUM(distanceMi)` directly from `strava_activities` GROUP BY day** — use the helper.

### 2. Cluster matching has TWO rules

In `clusterDuplicates()`:
- **Tight rule**: same-day distance within 5% → cluster regardless of start time. Catches Faff-watch-app vs Apple-Watch-Workout duplicates (their timestamps can be >30min apart).
- **Original rule**: same-day, start within 30 min, distance within 15% → cluster. Catches looser matches.

A real same-day double (e.g., morning + evening, different distances) won't be within 5% — it stays separate.

### 3. ACWR > 1.5 = the swap card

If load looks suspiciously high (drove a phantom swap proposal), check the dedupe first. We hit a 1.80 ACWR earlier today that turned out to be a duplicated Wed run inflating the acute window. After dedupe, 1.42.

### 4. Brief cache

`lib/coach/cache.ts` only caches LLM responses. The deterministic path bypasses cache entirely — computation is fast enough. If you add a deterministic surface, don't wire it through `readCachedBriefing`.

### 5. The week strip

`components/today/WeekStrip.tsx` has the color-coded mileage rule: done = green, easy = purple, long = cyan-blue, quality = amber, race = orange, rest = dim. Number color matches the day's strip-color at the top of each tile. If you add a new workout type, add its color to both `styleFor()` (strip) AND the `miColor` switch in `DayTile`.

### 6. Glance state vs Coach state

Two different loaders. `loadGlanceState` is the fast (~200ms) summary for /today page render. `loadCoachState` is the deeper state for the briefing engine. They overlap a lot. If you need a field in the briefing, add it to both — they're separately maintained.

---

## How to add a new state to the template

Example: you want a "post-tempo" variant that differs from generic post-quality.

1. **Add a branch to the verdict function.** In `verdictSentence()`, add a clause `if (planned === 'tempo' && zone === 'z3') return 'Tempo done — you put real work in.';`
2. **Add a headline if it differs.** In `headlineForCompletedRun(type)`, the case for `'tempo'` already returns `'TEMPO DONE'` — no change needed.
3. **Test locally.** `npm run dev` and hit `/today` with a fake post-tempo state, or write a snapshot test that calls `renderTodayBriefDeterministic` directly.

That's it. No prompt edits, no cache bust, no prompt-version bump. Same data → same output → ship.

---

## How to add a new limiter

Example: you want to detect "HRV crash" (3+ days of HRV >10ms below baseline).

1. **Compute the signal.** Add the calculation either in `loadCoachState` (if it needs DB access) or in `limiterSentence()` directly (if it can derive from existing CoachState fields).
2. **Add a branch in `limiterSentence()`.** Insert it in the priority order — HRV crash probably ranks between sleep and load (above load, below sleep). Return the 1-2 sentences elevating it.
3. **Decide what voice it gets.** "What I'm watching is the HRV trend — three days running 10+ below your baseline. The body's not bouncing back from the work. Pull back intensity until the number turns."

The priority ordering is documented in the spec — keep it: `injury > sleep > load_high > under_load > execution_miss > none`.

---

## Testing

No formal test suite yet. The fastest verification loop:

1. Open `/today` locally (`npm run dev` in `web-v2/`)
2. Refresh — the voice renders synchronously since there's no LLM call
3. If a beat reads wrong, change the corresponding sentence builder, save, refresh
4. Compare to `docs/today-web-mockups-2026-05-27.html` and `docs/at-a-glance-directions-2026-05-27.html` for design fidelity

Snapshot tests would be the next big win — every (state, data) combo locked. Not built yet.

---

## Files to read first if you're new

In order:

1. `docs/COACH_ARCHITECTURE.md` ← you're here
2. `lib/coach/templates/today.ts` ← the actual engine
3. `lib/coach/engine.ts` ← the dispatcher + LLM loop (for other surfaces)
4. `lib/topics/types.ts:CoachState` ← what data the template can read
5. `app/today/page.tsx` ← how it composes on the page
6. `docs/app-mockups-2026-05-27.html` ← what the visual system looks like
7. The RunCore — Coach Note Agent Rules doc David authored — voice spec
