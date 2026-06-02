# Today screen · post-run pivot · iPhone

**Author:** backend
**For:** design
**Status:** draft for review

## The problem

The current Today screen is a morning-decision tool. Readiness score + Sleep/HRV/RHR/LOAD pillars + best-training-window + next-hard tiles all serve one question: *"How hard should I go today?"*

Once the runner's run is DONE (swipe-up shows the green DONE chip), that question is settled. The morning content is still on screen but no longer the decision the runner cares about. The natural follow-on question is: **"Am I recovering well enough for what's next?"**

The same screen should pivot to answer that.

## What doctrine says about the post-run window

Three time bands matter (Research/00b § Recovery categories):

| Band | Window | What it governs |
|---|---|---|
| Hours | 0–24h post-session | HRV bounce-back, RHR return to baseline, fueling (0–30min carb+protein), sleep extension |
| Days | 24–72h post-session | Cumulative form (Banister TSB), readiness for next quality, soreness |
| Weeks | 72h+ | Training arc, fitness gain, race trajectory |

Pre-run, the screen focuses on **bands 2-3** (am I recovered + how does today fit the arc). Post-run, focus shifts to **band 1** with a band-2 outlook.

Key doctrinal references:
- **Pfitzinger Faster Road Racing §"Post-workout recovery monitoring":** HRV drops post-hard, returns to baseline within 24–48h; RHR returns within 12–24h; sleep extension of 30–60min the night after a hard session
- **Daniels Running Formula Ch.3 §"Recovery between sessions":** 48h minimum between quality sessions; recovery-pace ceiling 30–90s slower than easy
- **Hudson Run Faster Ch.6:** 24–72h post-hard window is where adaptation indicators show up; morning HRV vs 7d avg is the cleanest signal
- **Research/00b §"Sleep — highest-ROI recovery tool"**: 30–60min sleep extension after high-load days produces measurable performance protection

## Pivot trigger

When the day's prescribed run has `status='done'` (or any run with distance > 1mi is logged for today AND it's after 12pm local time). Stays pivoted until midnight rollover.

Edge cases:
- **AM run + PM run**: pivot stays in recovery mode after first run; second run logs add to today's TSS tally
- **Rest day**: no pivot · morning mode all day
- **Strength-only day**: pivot if a strength session is logged

## The post-run view · 5 sections

The shell, week strip, and bottom workout chip stay where they are. The middle three card-groups pivot.

### A · RECOVERY card (replaces READINESS card)

Big card at top. Same visual weight as the morning's readiness ring.

```
RECOVERY                            RECOVERING

  ╭──╮      Sleep tonight matters.
 │ 64 │      HRV down 18ms · should rebound
  ╰──╯      to baseline by 7 AM.

         View full read →
```

**Score (0–100)** answers "how recovered from TODAY am I" — distinct from readiness which answers "am I ready for the next stressor." Computed from:
- post-run HRV delta vs 14d baseline (45% weight)
- RHR projected delta vs 7d baseline (25%)
- Training form (TSB) change from today's TSS (20%)
- Sleep adequacy projection for tonight (10%)

**Band labels:** RECOVERED · RECOVERING · DRAGGING · DEPLETED.

**One-line copy:** authored by engine, references the dominant pillar driver. Examples:
- "On track to fully recover by 7 AM."
- "Sleep tonight matters · keep tomorrow light."
- "HRV took a hit · expect a slower easy day."

**Data source:** new `lib/coach/recovery-brief.ts` (composes existing `readiness-brief` pillars + `training-form` TSB delta + today's TSS).

### B · RECOVERY pillars (replaces Sleep/HRV/RHR/LOAD bars)

Same visual treatment as morning's pillar row, different content:

```
SLEEP TARGET    ▮▮▮▮▮▮▮░░░    8.5h tonight  (+45min)
HRV REBOUND     ▮▮▮▮░░░░░░    back to base ≈ 7 AM
RHR DELTA       ▮▮▮░░░░░░░    +4 bpm · projected 51 by morning
FUELING         ▮▮▮▮▮▮░░░░    last carb window in 18 min
```

| Pillar | What it shows | Source |
|---|---|---|
| Sleep target | engine-prescribed hours for tonight based on today's TSS (Pfitz +30-60min rule) | training-form.ts (TSS) + Research/00b sleep extension table |
| HRV rebound | today's HRV drop + projected return-to-baseline time | readiness-brief.ts pillar data + 24h decay curve |
| RHR delta | current vs 7d baseline + projected tomorrow morning | readiness-brief.ts |
| Fueling | 0-30min post-session carb+protein window status (countdown if open, "logged" if hit, "missed" if window passed) | new · needs nutrition_log table or manual flag |

### C · Today's training input (replaces nothing · new tile-row)

One-line summary of how today's run affected the training arc. NOT execution mechanics (splits, HR zones, etc · those are in the swipe-up).

```
┌────────────────────────────────────────────────┐
│ +92 TSS  ·  Form −4 → OPTIMAL band  ·  ↗ ARC  │
└────────────────────────────────────────────────┘
```

- TSS delta · today's session score
- Form (TSB) delta · what it shifted
- Arc direction · ↗ on-track · → flat · ↘ slipping (uses goal-gap engine)

Tap → opens block-over-block comparison (Power moves #11 · already shipped).

**Data source:** training-form.ts + goal-gap.ts + lib/plan/simulator.ts.

### D · NEXT HARD countdown (replaces "BEST WINDOW · TO RACE · NEXT HARD" tile trio)

Race countdown moves to the header eyebrow (it's a long-arc number, less time-sensitive). The middle row becomes:

```
┌────────────────┐ ┌─────────────────────┐
│ NEXT HARD      │ │ TRAJECTORY          │
│ THU TEMPO      │ │ SLEEP TONIGHT       │
│ in 47h         │ │ MATTERS             │
└────────────────┘ └─────────────────────┘
```

- **Next hard** · counts down to next quality (Tue tempo, Thu intervals, Sun long)
- **Trajectory chip** · authored sentence about what determines whether the runner hits it. Three flavors:
  - "Trajectory looks good" (HRV trending well, form OK)
  - "Sleep tonight matters" (HRV dropped, recovery hinges on sleep)
  - "Watch HR tomorrow" (RHR elevated, may need to downgrade tomorrow's easy)

**Data source:** training-state.ts (nextQuality) + recovery-brief.ts (trajectory authoring).

### E · WEEK-TO-DATE progress (replaces "THIS WEEK 45mi" tile)

Bottom tile-row. Same width as the existing tiles. Three glances of context:

```
┌────────────┐ ┌────────────┐ ┌────────────┐
│ WEEK MI    │ │ LONG-RUN   │ │ ACWR       │
│ 28 / 45    │ │ SUN · 12mi │ │ 1.02 OK    │
│ ●●●●○○○    │ │ in 5 days  │ │            │
└────────────┘ └────────────┘ └────────────┘
```

- Banked miles vs week target + dot count visualization
- Long-run countdown (when's the next signature day)
- ACWR badge (acute/chronic ratio · OK / WATCH / RAMP-UP)

## What's NOT in the post-run view

- **Execution mechanics of today's run** · splits, HR zones, lap pace · these live in the green swipe-up workout sheet (already covered, runner explicitly called out)
- **Workout chooser / swap UI** · today's decision is made
- **Race day countdown as a tile** · moves to header eyebrow

## Visual treatment notes

- **Color temperature shifts cooler post-run** · morning's amber/blue energy → evening's teal/green settled
- **The big ring** · morning is a "score" ring (static fill); post-run becomes a recovery curve animation (rising arc over 24h projection)
- **Pillar bars** · same shape but the fill represents "% of 24h recovery complete" rather than "% of baseline"
- **Transition** · when pivot fires (run logged or 12pm-with-completion), animate. Don't blink-swap.

## Trigger + mode-switching · the full state machine

The pivot is a state transition, not a clock check. The screen has three modes; runner sees exactly one at a time.

| Mode | When it shows | What it answers |
|---|---|---|
| **MORNING** | No run logged today; rest days; strength-only days; sick / injury days | "How hard should I go today?" |
| **POST-RUN** | Today's first run logged DONE (any distance > 1mi or completed scheduled workout) | "Am I recovering well enough for what's next?" |
| **LONG-RUN POST** | Today's logged run is the week's planned long run | "What's the recovery window from this peak session?" |

Transitions:

```
MORNING ──run done──► POST-RUN ──midnight──► MORNING (next day)
MORNING ──long done─► LONG-RUN POST ──midnight──► MORNING
POST-RUN ──2nd run done──► POST-RUN (recompute, same mode)
```

Key rule: **the screen never pivots BACK from POST-RUN to MORNING within the same day.** Once today's stressor lands, the decision space is recovery + prep for tomorrow. That doesn't change.

### Answers to specific edge cases

**1. Early-AM runs (6am).** Pivot fires immediately on run completion. Runner views POST-RUN mode the rest of the day. This is correct: the data is about recovery from THIS session and prep for TOMORROW, which stays valid through 11pm. Midnight rolls to next day → MORNING mode again.

**2. Long-run day variant (LONG-RUN POST mode).** Distinct mode, same 5 sections, different defaults:

| Section | Standard POST-RUN | LONG-RUN POST |
|---|---|---|
| Recovery score | 24-48h window weighting | 48-72h window weighting |
| Sleep target | TSS-prescribed (+30-60min) | bumps to 9.0-9.5h (sleep banking mandatory) |
| Fueling pillar | 0-30min carb+protein window | Adds a 24h carb-window emphasis (glycogen restoration) |
| Trajectory chip | "Tomorrow's easy" framing | "Monday's easy will determine Tuesday quality" framing |
| Next hard countdown | typically next quality 24-48h | typically Tuesday quality · 48h+ |

Detection: today's plan_workouts row has `is_long=true` AND runner logged a run of ≥80% of the prescribed long-run distance.

**3. Strength sessions.**

| Scenario | Mode |
|---|---|
| Strength + run same day | POST-RUN (run drives the pivot; strength TSS adds to today's load) |
| Strength only, no run | MORNING (no pivot · strength is too local a stressor to flip the frame) |

Doctrine (Pfitz Appx A): strength is a localized neuromuscular stressor, not systemic aerobic. Its recovery window is 24h, doesn't affect tomorrow's easy-run capability the way a tempo does. Morning mode stays valid.

If strength is logged on a strength-only day, the morning's load pillar updates (small bar fill increase) but the screen mode doesn't change.

**4. Rest days.** MORNING mode all day.

Single content tweak: if today is a planned rest day AND tomorrow has a hard quality workout, the readiness one-line copy adopts a "banking" frame:
- standard rest: "Resting up. Easy by design."
- banking-for-tomorrow: "Banking for Thursday tempo · sleep is the multiplier."

This is a one-line copy variant, not a layout change. Engine authors it via `lib/coach/readiness-brief.ts` checking tomorrow's plan_workouts row.

**5. Two-a-day handling.** Pivot stays in POST-RUN after the first run. Second-run recomputes the recovery score + pillars live · no mode flip.

The trajectory chip gets a two-a-day-aware copy variant when the runner has TWO consecutive run rows today:
- "Second session: +47 TSS · plan for 9h sleep tonight"
- "Two sessions today · HRV will run low tomorrow morning"

Detection: count(plan_workouts WHERE date_iso = today AND type IN ('easy','recovery','tempo','threshold','intervals','long') AND distance_mi > 1).

**6. Missed workout (extra · not explicitly asked but relevant).** Plan said TEMPO but runner skipped. No DONE state fires. Screen stays in MORNING mode. The adapter cron may reschedule overnight; the morning frame remains valid (runner can still decide today, can still see what was planned).

**7. Sick / injury day.** MORNING mode. Readiness one-line copy adopts an explicit "hold" frame ("Illness logged · plan paused. No expectations today.") and the workout chip shows REST. No pivot.

## How the pivot mechanically fires

```
Trigger: run logged with distance_mi > 1 AND date = today (local TZ)
   OR    plan_workouts row for today flips to status='done'

Backend writes:
  · coach_state.today_run_done = true
  · coach_state.today_run_long = (is_long === true)

Frontend reads coach_state on app foreground or pull-to-refresh.
Pivot animates · 240ms transition · no blink-swap.

Reverse trigger: midnight in user's local TZ.
  · coach_state.today_run_done = false (computed live, not stored)
```

No new tables. `coach_state` already exists; two new computed booleans.

## Data sources · all shipped

- `lib/coach/training-form.ts` · Banister CTL/ATL/TSB · existing
- `lib/coach/readiness-brief.ts` · pillar data · existing
- `lib/coach/synthesis.ts` · cross-metric authored copy · existing
- `lib/coach/run-recap.ts` + `lib/coach/run-win.ts` · today's session synthesis · existing
- `lib/plan/goal-gap.ts` · trajectory arc · existing
- `Research/00b-recovery-protocols.md` · doctrine · existing

**New module to build:** `lib/coach/recovery-brief.ts` · composes the above into the recovery-side authored content. ~150 lines, no new DB queries (reads from already-loaded brief data).

## Citations

- Pfitzinger Faster Road Racing §"Post-workout recovery monitoring"
- Daniels Running Formula 3rd ed Ch.3 §"Recovery between sessions"
- Hudson Run Faster Ch.6 §"Adaptation indicators"
- Research/00b-recovery-protocols.md §"In-Week Recovery" + §"Sleep — The Highest-ROI Recovery Tool"
