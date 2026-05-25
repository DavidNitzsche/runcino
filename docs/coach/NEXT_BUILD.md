# Coach next build · execution plan

The TODAY page POST-RUN mockup ([v4](./mockups/today-v4-2026-05-24.html)) is the gold standard. This doc is the priority-ordered work to apply that standard across the whole app and make the cards actually do things.

---

## The gap between mockup and shipping

What we have:
- Coach pipeline working end-to-end against real prod data (LLM → `{ voice, topics[] }`)
- Voice doctrine locked in `web/coach/prompts/daily-briefing.md`
- Test rig at `web/scripts/test-daily-briefing.mjs` proves the pipeline produces good output
- v4 HTML mockup as the visual + interaction spec
- Card library typed + documented

What's missing:
- Backend tables for interactive cards
- Server-side state loader (the test script is throw-away)
- API wiring of the new payload into `/api/overview`
- React renderers for each card kind
- iOS renderers for each card kind
- Watch renderers (compressed versions)
- Coach memory across briefings (currently context-free per call)
- Other page states (PRE-RUN, REST, SKIPPED, RACE-DAY) validated against the same pipeline
- Other surfaces redesigned against the same model (/races, /training, /profile, /health)

---

## Priority-ordered work

### Phase 1 — Make TODAY POST-RUN real on prod

Goal: David opens www.faff.run + iOS app, sees the v4 mockup rendered with his real data.

**1.1 Backend schema + storage** (a few hours)
- Migration: add `height_cm` (numeric) to `profile` table
- New table `coach_intent`:
  ```sql
  CREATE TABLE coach_intent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    kind text NOT NULL,            -- 'cadence_experiment' etc.
    payload jsonb NOT NULL,        -- { target_spm: 168, ... }
    valid_until timestamptz,
    fulfilled_at timestamptz,
    created_at timestamptz DEFAULT NOW()
  );
  ```
- New column on `profile`: `known_terms text[] DEFAULT '{}'`
- Index: `coach_intent(user_id, kind) WHERE fulfilled_at IS NULL` for fast lookup

**1.2 API endpoints**
- `POST /api/profile/field` — generic profile-field update with validation (height_cm initially; expandable)
- `POST /api/coach-intent` — commit an intent (kind + payload + valid_until)
- `POST /api/coach-intent/:id/fulfill` — mark fulfilled (called by next briefing when intent landed)
- `POST /api/coach-known-terms` — add term to `profile.known_terms` (fun_fact dismiss)
- `POST /api/post-run-rpe` — verify exists; wire if missing

**1.3 Server-side state loader**
- Port the test script's data assembly into a server function: `lib/coach/load-state.ts`
- Same SQL queries, structured as a reusable module
- Returns the same shape the test script uses
- Add caching layer keyed on `(user_id, today, latest_activity_id, latest_checkin_id, plan_revision)` via `coach_today_cache` table

**1.4 Daily briefing function**
- `web/coach/daily-briefing.ts` — currently a stub. Implement against the prompt + state loader.
- Returns `{ voice: string, topics: TypedCard[], meta: { brain: 'llm', model, tokens, elapsedMs } }`
- Cached via `coach_today_cache.payload jsonb`

**1.5 API wiring**
- `/api/overview` returns the new payload: `{ voice, topics, runRecap, weekStrip, ... }`
- Backward compat: keep `coachLine` field (legacy iOS reads it) populated by joining `voice` paragraphs
- Add `topics: TypedCard[]` as the new authoritative payload for new renderers

**1.5b Design tokens — pull from the canon**

All renderer CSS / SwiftUI / WatchKit code pulls palette + typography from [`docs/architecture/DESIGN_SYSTEM.md`](../architecture/DESIGN_SYSTEM.md). The design system is locked against the v4 TODAY mockup (Bebas Neue + Inter, pure-black canvas, the watch-face-derived semantic colors). Never redefine tokens or fonts in component code. If a renderer needs a color or font that isn't in the design system, extend DESIGN_SYSTEM.md first, then use the new token.

**1.6 React renderers** (one component per card kind)
- `web/app/today/_components/CoachVoice.tsx`
- `web/app/today/_components/cards/CadenceExperimentCard.tsx`
- `web/app/today/_components/cards/SleepDeficitCard.tsx`
- `web/app/today/_components/cards/NextWorkoutCard.tsx`
- `web/app/today/_components/cards/ProfileGapCard.tsx`
- `web/app/today/_components/cards/FunFactCard.tsx`
- `web/app/today/_components/cards/WeightTrendCard.tsx`
- `web/app/today/_components/cards/RaceHorizonCard.tsx`
- `web/app/today/_components/cards/RecoveryAmberCard.tsx`
- `web/app/today/_components/RunRecap.tsx`
- `web/app/today/_components/WeekStrip.tsx`
- `web/app/today/_components/ReplyChips.tsx`
- `web/app/today/page.tsx` — orchestrator that consumes the API + renders state-appropriate ordering

**1.7 Replace /overview with the new /today** (or rebuild /overview)
- Decide: new route `/today` or in-place rebuild of `/overview`. In-place is cleaner if we can ship without breaking the existing surface.
- Delete the v1 alert banner stack (`CoachAdaptedIsland`, `StravaGapCard`, `PostRaceCard`, etc.) — absorbed into coach voice + cards
- Delete the 6-tile RUNNING FORM grid from /overview — moves to Run Detail
- Delete the giant readiness ring — becomes small chip top-right

**1.8 iOS renderers**
- Mirror the React component structure in SwiftUI
- API client consumes the same payload shape
- Watch-face DNA scales to native rendering

**1.9 Watch renderers**
- Compressed coach voice (one or two lines) on watch face
- Compressed cards as complications / pages
- Reply chips for post-run buzz
- Locks in cadence target from `coach_intent` for live guidance

---

### Phase 2 — Other TODAY states

The pipeline produces good output for POST-RUN. Validate it for the other states by running it against simulated state inputs. Likely no new infrastructure — same prompt, same card library, different inputs.

States to validate:
- **PRE-RUN** — workout planned, not started. Coach voice frames today; `next_workout`-style card becomes a *today's workout target* card with pace + fueling + route.
- **POST-RUN PARTIAL** — ran but cut short. Honest acknowledgment voice.
- **SKIPPED** — explicit skip or EOD with no run.
- **REST DAY** — no workout planned. Coach voice on recovery + week shape.
- **RACE WEEK** — taper voice + race-prep cards.
- **RACE DAY** — own page; race brief + fueling plan + course intel.
- **MODE: sick / injured / post-race** — overrides; different voice register; different card mix.
- **COLD START** — no plan yet; onboarding voice + setup cards.

For each: run the LLM, eyeball output, iterate the prompt if needed. Add new card kinds as required (e.g., `workout_target`, `race_brief`, `mode_prescription`).

---

### Phase 3 — Coach memory

The biggest current gap: each briefing is context-free. The coach doesn't remember:
- Yesterday's voice (prescribed cadence experiment? acknowledge whether it landed)
- Last week's voice (referenced sleep deficit? acknowledge if trend changed)
- Past race results (referenced in voice when relevant)
- User responses to check-ins (carries forward)
- Proposals accepted/declined

**Plan:**
- New table `coach_briefing_history` — stores every briefing's `voice + topics + intents_referenced`
- Loader pulls last N briefings for context, includes in prompt as "PRIOR BRIEFINGS"
- Coach prompt updated: "when prior briefings mention X and the current data shows Y, acknowledge the loop closing"
- Token budget: last 3 briefings is probably enough; cache friendly

This is what makes the coach a *relationship* not a *daily report*.

---

### Phase 4 — Other surfaces

Apply the philosophy + voice + cards model to existing pages.

**Priority order** (most leverage first):

**4.1 /races** — THE arc. Multi-race view of the calendar. Each race a coach-voice + cards block:
- AFC card: trajectory ("on pace for 1:33 against 1:30 goal"), days out, prep status, coach's read
- CIM card: "marathon prep starts the week after AFC" — coach narrates the bridge
- Past races: results + what we learned + how it informs current build
- New card kinds: `race_trajectory`, `race_prep_status`, `race_retrospective`, `goal_renegotiation`

**4.2 /training** — the plan as a story. Phase by phase with the coach narrating WHY each week is shaped how it is.
- Current week + next week prominent
- Phase context ("we're in BUILD because we just held base for 4 weeks")
- Adaptive markers (where coach moved sessions)
- New card kinds: `phase_context`, `plan_adapted`, `next_quality_session`

**4.3 /profile** — what's holding back better coaching.
- Profile gaps front + center
- Derived values listed transparently (HRmax 181 — observed peak; RHR 47 — 60-day mean)
- Coach commentary on profile completeness
- Settings + preferences

**4.4 /health** — body over time.
- Sleep, HRV, RHR, weight trends across builds
- Coach voice on long-term patterns
- Cards for each metric: current value + trend + coach commentary
- Existing health page architecture in `domain/HEALTH_PAGE_RESEARCH_ARCHITECTURE.md`

---

### Phase 5 — Watch app

Coach voice in the wrist. The watch is the most compressed form factor.

- Pre-run lobby card: today's workout target
- Mid-run: live guidance (pace target, cadence target from intent, fueling cues)
- Post-run: summary buzz + one-line coach voice
- Cards distilled to complications

The watch face inventory at [mockups/watch-faces.html](./mockups/watch-faces.html) is the design source.

---

## Validation / verification work (do alongside phases)

- **VDOT calibration** — verify the engine reads Sombrero half result correctly + projects fitness. Spot check against Daniels VDOT tables.
- **Race goal flow** — confirm AFC goal time exists in race data; loader pulls it; coach can reference it.
- **Run-LLM-against-states** — generate sample outputs for PRE-RUN, REST, SKIPPED, RACE-WEEK. Eyeball voice.
- **Profile gap completeness audit** — list every field the loader checks; verify it's checking every available source before declaring a gap.

---

## Open architectural questions

1. **/today vs in-place /overview rebuild** — clean break (new route) vs in-place refactor. Lean in-place if we can do it without breaking existing iOS clients.
2. **Caching invalidation granularity** — currently we'd invalidate on any state change. Is that aggressive enough? Too aggressive?
3. **iOS payload format** — does the iOS app currently consume a JSON shape we'd preserve, or are we free to change the API contract?
4. **Watch backend** — does the watch hit `/api/overview` directly or via the iPhone bridge?
5. **Multi-user scaling** — current pipeline is single-user (David). At scale, prompt caching strategy + concurrency limits need thought. Defer until we have a second user.

---

## What NOT to throw out

The existing app has a lot of valuable substrate. We're applying the new philosophy + design as a SURFACE layer; the engine underneath stays:

- ✅ Plan engine (13-week plans, phase logic, periodization)
- ✅ Research folder (`/Research/`) — the doctrine the coach grounds in
- ✅ VDOT calibration + pace/zone math
- ✅ Recovery / readiness / fitness state computations
- ✅ Database schema + indexes
- ✅ Strava + Apple Health ingest pipelines (just-fixed dedup)
- ✅ Profile + races + workout_completions tables
- ✅ Existing iOS native app codebase
- ✅ Existing Next.js web app (we redesign pages within it)

This is unification, not rebuild. The engine you spent months on is exactly what the coach needs to be smart. We're putting a single coherent face on it.

---

## Suggested first move

Pick one of:

**(a) Verify data flows + run states** — spend 1-2 hours doing the validation/verification work above. Run the LLM against PRE-RUN / REST / SKIPPED. Confirm race goal + VDOT. Lowest risk, validates the pipeline before building UI.

**(b) Start the backend** — Phase 1.1-1.2. Migrations + endpoints. ~half a day. Then we have something to wire the React renderers to.

**(c) Build the React renderers against the test rig output** — Phase 1.6. Use static JSON from the test script as fixture. Build the components. Wire backend after.

**(d) Mock /races + /training + /health** — Phase 4 first. Get the design model for those surfaces locked before any code. Same approach as TODAY mockup.

David's call. Each has merit. (a) is the safest, (d) is the most product-design value, (b/c) are the most production-progress.
