# Card library

The coach emits typed cards. Each card kind has a defined schema, when it emits, visual treatment, tap behavior, and backend status. The renderer maps each kind to a component; the LLM picks which kinds to emit per briefing.

The card library extends across all surfaces (TODAY, RACES, TRAINING, HEALTH, etc.). New surfaces add new card kinds as needed.

---

## Visual hierarchy (all surfaces)

Three tiers of card visual treatment:

- **Action cards** (large) — big numbers, big visuals, CTAs. The cadence experiment, sleep deficit, recovery amber.
- **Info cards** (medium) — focused content with one main read + supporting detail. Next workout, race horizon, weight trend.
- **Educational cards** (light, purple-tinted) — `fun_fact` only. FYI not actionable.
- **Slim affordance rows** — `profile_gap` (red, with +Add) and similar persistent ones.

Universal palette + typography pulled from [`docs/architecture/DESIGN_SYSTEM.md`](../architecture/DESIGN_SYSTEM.md) — the design system is locked against the v4 mockup. Pure black canvas, Bebas Neue + Inter, three-color discipline (green / white / blue) with amber for soft warnings, red for runner-attention, purple for educational, orange for race signal. Never invent new tokens or fonts in renderer code; reference the design system.

See [mockups/today-v4-2026-05-24.html](./mockups/today-v4-2026-05-24.html) for the gold standard.

---

## Required vs discretionary emission

Some topics MUST emit when their data condition holds. Others are at the coach's discretion.

| Topic kind | Emit rule |
|---|---|
| `profile_gap` | **Required** — ONE per genuinely-missing field that limits coaching. Loader pre-computes the gap list; LLM emits one card per item. |
| `next_workout` | **Required** — always emit when a planned workout exists after today. Chronologically next, not coach's pick. |
| `fun_fact` | **Required** — emit one per technical term the coach uses in voice (HRV, VDOT, Z2, etc.) — so the runner learns the term. |
| All others | **Discretionary** — emit only when worth a card. |

---

## Universal field: `coach_note`

Every card kind except `fun_fact` and `profile_gap` carries a `coach_note` — a short coaching line. Solution, advice, awareness, confidence, congrats. Cards aren't widgets; they're the coach pointing at something and saying something useful.

`fun_fact` is pure education (its `explanation` field IS the coach's read). `profile_gap` carries its action via the +Add button.

---

## The kinds

### `cadence_experiment`

```json
{ "kind": "cadence_experiment",
  "current_spm": 160,
  "target_spm": 168,
  "reason": "5% bump reduces knee loading ~20% per research",
  "action_label": "Lock in for tomorrow",
  "coach_note": "Focus on quick feet, not pushing pace." }
```

**When emits:** when cadence is worth experimenting with AND profile is complete enough to give a real target (currently requires `height`).

**Suppression rules:**
- If `height` is in MISSING DATA → SUPPRESSED. Coach voice mentions cadence research as a curiosity; the `profile_gap` for height carries the call-to-action.
- The whole card disappears until height is filled. No fallback "experiment without a target."

**Visual:** big "160 → 168 SPM" numbers in blue. Reason below. CTA pill at bottom.

**Tap behavior:** CTA writes to `coach_intent` table (kind=cadence_experiment, target_spm, valid_until). Watch reads on next run start, can vibrate at target SPM. Next briefing reads the intent + the actual cadence of next run + checks if it landed.

**Backend status:** ❌ `coach_intent` table doesn't exist. Need to create + add an endpoint `POST /api/coach-intent`. Watch integration TBD.

---

### `sleep_deficit`

```json
{ "kind": "sleep_deficit",
  "avg7n_h": 6.8,
  "target_h": 7.5,
  "deficit_7n_h": 4.9,
  "last_night_h": 7.7,
  "coach_note": "Aim for 7.5h tonight to start chipping at the deficit. No need to chase it all back in one night — pick two nights this week to bank an extra hour." }
```

**When emits:** when the multi-night sleep pattern is worth flagging (typically `deficit_7n_h > 2`).

**Visual:** big 6.8h in amber, 7-bar chart of last 7 nights with dashed target line, summary line ("About 5h of sleep debt this week"), coach_note at bottom.

**Tap behavior:** opens /health page deep-dive (sleep section).

**Backend status:** ✅ data sources exist (`health_samples.sleep_hours`). Render-only card.

---

### `next_workout`

```json
{ "kind": "next_workout",
  "date": "2026-05-25",
  "dow": "MON",
  "type": "easy",
  "label": "EASY 5.8 mi",
  "distance_mi": 5.8,
  "pace_target": null,
  "coach_note": "Keep it conversational. Shake out the long run, nothing more." }
```

**When emits:** required when a planned workout exists after today.

**Critical rule:** `date` is the **chronologically next** workout, not the coach's pick of the week's marquee session. Tomorrow's easy comes before next-Tuesday's quality.

**Visual:** distance big on right ("5.8 MI" in blue), label + DOW small on left. Coach_note below.

**Tap behavior:** opens the workout detail / start screen.

**Backend status:** ✅ reads from `plan_workouts`. Render-only.

---

### `profile_gap`

```json
{ "kind": "profile_gap",
  "field": "height",
  "why": "Needed to dial in ideal cadence based on leg length" }
```

**When emits:** REQUIRED — ONE per genuinely-missing profile field. Loader pre-checks every data source (`health_samples`, run-derived peaks, `profile` columns) and only lists genuinely-absent fields.

**Critical rule:** **Never emit `profile_gap` for fields the system can observe.**
- HRmax: derived from `health_samples.max_hr` + run-data peak. Never asked.
- RHR: derived from `health_samples.resting_hr` 60-day mean. Never asked.
- Weight: derived from `health_samples.body_mass`. Never asked.
- Sex, age: in `profile` table already. Never asked again.
- **Height**: NOT in any current data source. Genuine gap.

**Visual:** slim red row, label "COACH NEEDS", field name in Bebas, "why" line in mute, +Add pill on right.

**Tap behavior:** inline input on the card; +Add saves, dismisses card. Calls `POST /api/profile/field`.

**Backend status:**
- ❌ `height_cm` column doesn't exist on profile. Need migration.
- ❌ Generic profile-update API doesn't exist (only specific endpoints for existing fields).

---

### `fun_fact`

```json
{ "kind": "fun_fact",
  "term": "HRV",
  "title": "HRV · Heart Rate Variability",
  "explanation": "Your HRV is 66ms today — right around your typical range. HRV measures the variation between your heartbeats. Higher generally means your nervous system is recovered and ready to train hard. Lower can signal fatigue, stress, or illness.",
  "research_doc": null }
```

**When emits:** REQUIRED — one per technical term the coach uses in voice that the runner might not know (HRV, VDOT, RHR, Z2, lactate threshold, cadence-as-physiology, base/build/peak/taper as terms-of-art, etc.).

**Critical rule:** **Must include the runner's current value of the term + interpretation.** No generic "what is HRV" cards. Always anchored to the data ("Your HRV is X today, which means Y. Here's what HRV is...").

**Visual:** purple-tinted card, "ⓘ" icon + title, body, "Read the research →" link.

**Tap behavior:**
- "Read the research →" opens the relevant Research/ doc
- (Future) "Got it" dismisses → writes to `profile.known_terms[]` → suppresses future repeats of that term

**Backend status:**
- ✅ data + research access exist
- ❌ `known_terms` array on profile doesn't exist; dismiss flow TBD

---

### `weight_trend`

```json
{ "kind": "weight_trend",
  "current_lb": 186.1,
  "delta_lb_30d": -3.3,
  "direction": "down",
  "coach_note": "Down ~1lb/week is a sustainable rate, won't undercut recovery. Keep it here." }
```

**When emits:** when weight is trending meaningfully (>1% over 30 days) OR worth a confidence cue.

**Visual:** big current weight, delta + direction, coach_note.

**Tap behavior:** opens /health weight detail.

**Backend status:** ✅ data exists (`health_samples.body_mass`). Render-only.

---

### `race_horizon`

```json
{ "kind": "race_horizon",
  "name": "Americas Finest City",
  "days_away": 84,
  "tone": "building",
  "coach_note": "12 weeks gives us room to add real quality. Threshold work starts this week — time to start applying pressure." }
```

**When emits:** when the race is meaningful context for what's happening now (typically <120 days out for a primary race, or always for race-week).

**Tone values:**
- `comfortable` — race is far enough that it's framing, not pressure
- `building` — quality work is loading
- `tightening` — peak / taper window
- `race_week` — last 7 days

**Visual:** race name + sub-info on left, days countdown big on right (orange). Coach_note below.

**Tap behavior:** opens /races/[slug] for that race.

**Backend status:** ✅ reads from active `training_plans.race_id` + `races` table. Render-only.

---

### `recovery_amber`

```json
{ "kind": "recovery_amber",
  "hrv_ms": 48,
  "hrv_baseline_ms": 66,
  "rhr": 58,
  "concern": "HRV down ~30% vs baseline + RHR up 11bpm — your body's flagging fatigue or incoming illness",
  "coach_note": "Pull tomorrow's easy easier, skip if it's still off. Extra rest day if this holds two more days." }
```

**When emits:** when recovery signals cross flag thresholds (HRV >15% under baseline, RHR >10bpm over baseline, sustained for 2+ days).

**Visual:** amber/red treatment. Concern summary prominent, coach_note below.

**Tap behavior:** opens /health recovery detail.

**Backend status:** ✅ data exists. Threshold logic + emission rule TBD.

---

## Card backend status summary

| Kind | Data exists? | Render component? | Tap action backend? |
|---|---|---|---|
| `cadence_experiment` | ✅ | ❌ React/iOS/Watch components TBD | ❌ `coach_intent` table needed |
| `sleep_deficit` | ✅ | ❌ TBD | ✅ deep-link only |
| `next_workout` | ✅ | ❌ TBD | ✅ deep-link only |
| `profile_gap` | ✅ (loader) | ❌ TBD | ❌ `height_cm` column + profile-update API |
| `fun_fact` | ✅ | ❌ TBD | ⚠️ `known_terms` array for dismiss |
| `weight_trend` | ✅ | ❌ TBD | ✅ deep-link only |
| `race_horizon` | ✅ | ❌ TBD | ✅ deep-link only |
| `recovery_amber` | ✅ | ❌ TBD | ✅ deep-link only |

See [NEXT_BUILD.md](./NEXT_BUILD.md) for the order to build these.

---

## Reply chips (post-run)

Not a card kind — a fixed affordance on POST-RUN state. Three pills under the coach voice:

- `SOLID` (green tint on hover)
- `TIRED` (amber tint on hover)
- `WRECKED` (red tint on hover)

Bebas all-caps, no emojis. Watch-UI style.

**Tap behavior:** writes to `post_run_rpe` table. Next briefing acknowledges ("you said the legs felt solid yesterday, so let's hit the threshold honest today").

**Backend status:** ⚠️ `post_run_rpe` table exists, endpoint wiring TBD.

The ask text is **"How are the legs?"** (past tense / body-state-specific), not "Let me know how it felt" (ambiguous with the briefing itself).

---

## Adding new card kinds

To add a new kind:

1. Define the JSON schema (`kind` + typed fields + `coach_note` if applicable).
2. Add to the prompt's topic library section in `web/coach/prompts/daily-briefing.md`.
3. Document here in CARD_LIBRARY.md (when emits, visual, tap, backend status).
4. Build the React/iOS/Watch component for it.
5. If interactive: build the backend endpoint + storage.

Kinds we'll likely need as we expand to other surfaces:

- `plan_proposal` — coach proposing a strategic change (goal renegotiation, A-race swap)
- `plan_adapted` — coach announces a tactical/operational change that already happened
- `mode_override` — sick / injured / post-race recovery mode prescription
- `fueling_brief` — race-week fueling plan with gel timing
- `course_intel` — race-specific course profile + weather + landmarks
- `pr_celebration` — new PR detected, coach acknowledges
- `streak_recognition` — sustained behavior worth naming ("4 weeks of held mileage")
- `goal_renegotiation` — strategic proposal embedded in voice with inline accept/decline
