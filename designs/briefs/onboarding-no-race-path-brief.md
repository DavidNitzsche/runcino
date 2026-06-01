# Brief · Onboarding · No-race goal path (Step 1b)

**Audience.** Design agent · full mockup file expected.
**Surface.** `web-v2/app/onboarding/page.tsx` — currently a stub that redirects to `/today`. The whole onboarding flow is deferred; this brief covers the **no-race branch** specifically. David locked the decision to ship the 7-field intake this cycle.
**Why this brief exists.** The race-anchored onboarding path (5K / 10K / Half / Marathon) is the polished default. When the runner picks **"No specific race"**, the state machine routes them to `step=goal-details` — a richer 7-field intake that gives the plan generator something to anchor on. The fields, the schema, and the API are all built. The screens are not.

---

## 1. Why this branch matters

A beginner runner who's not training for a specific race still needs:
- A measurable goal so the coach has something to project against.
- A volume target so the plan-builder knows how much load is welcome.
- Some history so the coach doesn't ramp a 35 mi/wk plan for someone running 8.

Without these, the plan-builder falls back to a generic "MAINTENANCE" plan (legacy/web/coach/plan-builder.ts). That works, but it's the worst version of the coach.

The race-anchored path collects the goal as a finish time at a known distance. The no-race path needs to substitute that with a **time-trial goal** (1 mi / 5K / 10K) + **explicit volume/frequency targets** + **3 history fields** for ramp safety.

---

## 2. The exact 7 fields to collect

All chip-based, all bucketed. The state machine + schema + write path are already built in `lib/onboarding/state.ts` and `app/api/onboarding/complete/route.ts`. Don't invent new field types; design against these:

### 2.1 Time-trial distance — `ttDistance`
Chip values: `'1mi'` · `'5k'` · `'10k'`
- 1 mi = absolute beginner anchor (track day, neighborhood loop)
- 5 K = casual runner anchor
- 10 K = intermediate anchor

### 2.2 Time-trial goal time — `ttTime`
String form: bucketed range chip ladder (NOT freeform). Examples per distance:
- 1 mi: `'<6:00'` · `'6:00-7:00'` · `'7:00-8:00'` · `'8:00-9:00'` · `'9:00+'`
- 5 K: `'<18'` · `'18-22'` · `'22-25'` · `'25-30'` · `'30+'`
- 10 K: `'<40'` · `'40-45'` · `'45-50'` · `'50-60'` · `'60+'`

Designer should decide the actual ladder values; the schema only requires "a string chip value." Keep ladders to 4–5 chips for legibility.

### 2.3 Weekly mileage target — `weeklyMi`
Chip values: `15` · `25` · `35` · `45` · `55` (numeric).
- These are the runtime-bucketed values the coach reads. Don't add 20 or 30.

### 2.4 Weekly frequency — `weeklyFreq`
Chip values: `3` · `4` · `5` · `6` (numeric). Number of running days per week.

### 2.5 History · avg weekly miles (last 3 months) — `histAvg`
Chip values: `'0-5'` · `'5-15'` · `'15-25'` · `'25-35'` · `'35+'`

### 2.6 History · longest recent run (last 30 days) — `histLong`
Chip values: `'0-3'` · `'3-6'` · `'6-10'` · `'10+'`

### 2.7 History · years running — `histYears`
Chip values: `'<1'` · `'1-3'` · `'3-7'` · `'7+'`

---

## 3. The state machine + flow

Code: `web-v2/lib/onboarding/state.ts`. URL-driven, no sessionStorage. Every answer lives in `searchParams` so refresh + back-button work cleanly.

```
Step transitions:
  landing
    → ?step=goal               (Step 1 · race distance picker)
    → ?step=goal-details       (Step 1b · 7-field intake · ONLY when distance='none')
    → ?step=signals            (Step 2 · connect Strava / Apple Health)
    → ?step=confirm            (Step 3 · name + timezone + start training)
    → ?step=done               (post-write success screen)
```

The no-race branch enters at `?step=goal-details` after the runner picks "No specific race" on Step 1. It must collect all 7 fields before it can advance to `?step=signals`. **No partial saves** — fields are URL-encoded, the API ignores unknown shapes.

On submit, POST to `/api/onboarding/complete` with the body shape documented in the route. Server writes to `profile.tt_goal_distance`, `profile.tt_goal_time`, `profile.weekly_mileage_target`, `profile.weekly_frequency`, `profile.history_avg_weekly_mi`, `profile.history_longest_recent_mi`, `profile.history_years_running` (migration 118).

---

## 4. Constraints + non-negotiables

- **Dark-first, brand-mesh aware.** Onboarding sits over the `--mesh-targets` race-red palette by default. Anything new must hold contrast on a luminous warm mesh.
- **No fake data.** If a field isn't picked yet, the chip ladder shows but doesn't pre-fill. No "let's guess what you want."
- **No em dashes**, no emoji, middot separator (·) for inline pause.
- **No back-fill from previous onboarding.** Each step is URL-driven; refresh must work.
- **Single screen or step-paginated?** Designer's call. 7 fields on one screen is dense; 3-4 steps is friendlier on mobile.
- **Skip CTAs are not allowed on this branch.** Every field is required to enter the no-race path. If the runner doesn't want to commit, the right move is the back button → pick a race distance instead.
- **Plain English copy.** Never "TT" by itself; "time-trial goal" or "what time you can already run." Cite Research/00a periodization where helpful for plain English context.
- **Toolkit components available.** `.fa-sheet` · `.fa-field` · `.fa-pickrow .opt` · `.fa-submit` from the toolkit handle the visual primitives. Designer can reuse or design fresh.

---

## 5. Plausible directions (designer picks one)

### Direction A · Single dense screen
All 7 fields on one screen, vertical scroll. Pros: runner sees the full ask up front. Cons: 7 chip ladders is a lot on mobile.

### Direction B · 3-step paginated
- Step 1b.1 — Goal (`ttDistance` + `ttTime`)
- Step 1b.2 — Volume (`weeklyMi` + `weeklyFreq`)
- Step 1b.3 — History (`histAvg` + `histLong` + `histYears`)
- Pros: each step has a clear theme. Cons: 3 extra back-button taps if the runner second-guesses.

### Direction C · Guided story (recommended starting point)
Frame the 7 fields as a conversation, not a form. E.g.:
- "What time can you run today?" → `ttDistance` + `ttTime`
- "How much do you want to run each week?" → `weeklyMi` + `weeklyFreq`
- "And where are you coming from?" → 3 history fields
- Show a live plan preview as fields fill (e.g., "Sounds like you want a 25 mi/wk plan").

### Direction D · Hybrid (B + a preview)
3 paginated steps + a tiny sticky preview at the bottom showing what the coach will plan ("Coach will start you at 22 mi/wk, building to 28 by week 6").

---

## 6. Acceptance criteria for the mockup

A successful mockup shows ALL of these states:

1. **Fresh entry** — `?step=goal-details` with all 7 fields empty.
2. **Partial fill** — runner has picked `ttDistance='5k'` but not `ttTime`. CTA disabled.
3. **All filled** — runner can advance.
4. **Validation** — what happens if the runner picks an unrealistic combo? (e.g., `histAvg='0-5'` + `weeklyMi=55` — the coach can't ramp that safely.) Show how the screen flags it.
5. **Reduced motion** — same screen with no animation. Brand still reads.
6. **Plan preview** — if the chosen direction surfaces a live coach preview, show what it says.
7. **Back from `?step=signals`** — runner returned to edit. Existing answers pre-fill from URL.

---

## 7. Adjacent surfaces worth designing in the same file (optional)

- **Step 1 (race distance picker)** with the "No specific race" tile highlighted — for context on how the runner reached Step 1b.
- **The "done" screen** (`?step=done`) tailored to the no-race outcome ("Your maintenance plan is ready. First run is tomorrow.").
- **A post-onboarding nudge** in case the runner wants to add a race later — points at `/races` "+ Add target."

---

## 8. Deliverable

Mockup file under `designs/from Design agent/onboarding-no-race/` with:
- One hero file showing the final design at full fidelity in dark mode over the race-red mesh.
- One states file showing all 7 acceptance-criteria states stacked.
- Optional: short markdown rationale on the directional choice (A/B/C/D) + what toolkit components were reused vs new.

When the mockup is ready, the web agent will recreate it in `web-v2/app/onboarding/page.tsx` (currently a redirect stub) against the data contracts in §2 and the state machine in `lib/onboarding/state.ts`.

---

## 9. Files the designer should read first

- `web-v2/lib/onboarding/state.ts` — full state machine + every chip value.
- `web-v2/app/api/onboarding/complete/route.ts` — POST body shape + persistence.
- `legacy/web/coach/plan-builder.ts` — what the coach does with these inputs (MAINTENANCE plan vs race-anchored).
- `web-v2/app/onboarding/page.tsx` — current stub (delete on cutover).
- `designs/from Design agent/design_handoff_faff_toolkit/COMPONENTS.md` — the `.fa-sheet`, `.fa-pickrow`, `.fa-submit` reference shapes.
- `web-v2/components/faff-app/toolkit/sheets.tsx` — Live implementations of `NewGoalSheet` and `LogNonRunSheet` that follow the same chip-pick pattern. Strong precedent.

Brief authored 2026-05-31 · web agent · in response to David locking "design + ship the 7 fields this cycle."
