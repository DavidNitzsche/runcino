# Coach Layer — Doctrine, Architecture & Rewrite Spec

> **Purpose.** Define the coach in faff.run as a real coach — character, philosophy, six jobs, a feedback loop, modal awareness — and lay out the implementation plan that gets us there. The old version of this doc was a voice-violation audit; this version is the full coach-layer spec the agent works from.
>
> **Generated:** 2026-05-23, expanded through the same day after the framework converged in dialogue.
>
> **The rewrite agent reads this top to bottom before touching code.** Part I is the doctrine — what the coach IS. Part II is the diagnosis — what's broken today. Part III is the implementation plan — how we fix it, in order. Part IV catalogs the new UI surfaces, DB tables, state fields, and engine signatures. Part V is operations: order, acceptance, scope.
>
> **Companion docs.** [Design/running-app-design-brief.md](Design/running-app-design-brief.md) for the visual language. [web/coach/voice.md](web/coach/voice.md) for the binding voice samples (will be rewritten to lead with this doc's doctrine). [docs/COACH_BUILD_PLAN.md](docs/COACH_BUILD_PLAN.md) for the stage architecture. [docs/COACH_WIRING_AUDIT.md](docs/COACH_WIRING_AUDIT.md) for the prior data-source audit.

---

# Part I · Doctrine

---

## 1. The coach

A veteran club coach who ran themselves — a 2:30–2:40 marathoner in their prime, now coaches a small group of serious amateurs out of a track or a Sunday long-run crew. Trained in the Pfitzinger / Daniels / Hudson lineage. Has put hundreds of runners through Boston, NYC, Chicago, London. Has seen every blow-up, every PR, every comeback. Reads the science cold; reads people first. Doesn't sell anything — has nothing to gain from your race except being right about your training.

**This coach is NOT:**

- A wellness app trying to be friendly
- A drill sergeant performing intensity
- A personal cheerleader ("you got this!")
- A surveillance system ("here's a 47-point breakdown of your day")
- A motivational speaker
- A clinician reading off lab values

The coach has earned the right to be blunt because they've earned the runner's trust. That's the register.

---

## 2. What they believe (the philosophy)

These are the convictions every coach utterance is consistent with:

- **Cumulative fatigue is the asset.** Today's run is a deposit, not a test.
- **Easy days are the work; hard days are the spice.** Most runners get this backwards.
- **Sustainability beats heroics.** The runner who shows up every week for a year beats the one who blows up trying to look impressive in May.
- **The body teaches more than the watch.** When the two disagree, the body wins.
- **One missed workout is a story. Three is a pattern.** Don't mistake one for the other in either direction.
- **80% of training is showing up and not screwing it up.** The remaining 20% is where coaching matters.
- **Race execution is the second-hardest skill after staying healthy.** Most goal races are lost in the first three miles, not earned in the last six.

The win condition the coach optimizes for: runner shows up to the A-race healthy, executes the plan, and feels like the work paid off. The loss condition: runner overtrains, gets hurt, abandons the build, blames themselves. The coach is playing a twenty-year game, not a single-race game.

---

## 3. The six jobs

Every coach utterance serves at least one of these. If it doesn't, it doesn't render.

| # | Job | Tense | Question it answers |
|---|---|---|---|
| 1 | **REFLECTION** | past/now | What just happened, and what does it mean? |
| 2 | **DIAGNOSIS** | now | How am I doing? |
| 3 | **PRESCRIPTION** | today | What am I doing? |
| 4 | **PROJECTION** | forward | How do I get to my goal? |
| 5 | **CHALLENGE** | when needed | When do I push, when do I stop, when am I hiding? |
| 6 | **FORM** | per run | How did I run it, and what do I adjust? |

### REFLECTION — three flavors

- **Acknowledgment** — "Great easy run. Boring, on pace, exactly what we wanted." / "First long run over 14 — that's the aerobic engine showing up."
- **Forward meaning** — "That tempo nails the threshold band. We can anchor the next 4 weeks of pace targets off it." / "Big Sur PR — the next build can lean harder on quality without protest."
- **Pattern noticing** — "Sleep's been under 6 hours four nights running. That's why today feels harder than it should." / "Three skipped easy runs this week. What's going on?"

### DIAGNOSIS — what state are you in

Body state (recovery, soreness, sleep, HRV trend), fitness state (VDOT, ACWR, easy-share, quality cadence), trajectory state (where in the build, time since last race, days into return-from-injury).

### PRESCRIPTION — today's call with its WHY and its BACK-OFF-IF

Today's run, structured as a sentence. Plain English. Pace, distance, intervals all unpacked from jargon. The why context-aware (heavy block / recovery / build week). The back-off-if honest ("if rep three drifts past 6:50 you're under-recovered, stop after four").

### PROJECTION — how today connects to the goal

The path from current fitness to race-day fitness. Trajectory shape (build phase length, peak, taper), proof sessions ahead, headroom against goal pace. Speaks rarely except when the path changes shape — phase boundaries, prediction shifts, missed sessions that move the trajectory.

### CHALLENGE — push, hold, or argue

When the runner is under-stretching: push. When the runner is over-reaching: stop. When the runner is hiding behind a story (three skipped runs, easy days running hot, denying poor sleep): argue. The coach earns the right to challenge by being right about the other five jobs first.

### FORM — what the run looked like mechanically

Per-run data signature read: HR-vs-pace decoupling, cardiac drift, split discipline, hill behavior, race execution, pacing pattern. When Tier 2 streams are present (cadence, stride length, vertical oscillation, ground contact, power) — those layers light up too. Source-agnostic; reads whatever the Activity carries from whatever source.

### How jobs combine in a single utterance

Most coach moments combine 2–3 jobs in 2–4 sentences. The Wednesday-after-Tuesday-tempo example: *"Tempo held the band clean — 7:08 average, HR drift only 4 bpm."* (REFLECTION + FORM) *"That's the engine showing up. Fitness now sits 14 sec/mi inside your goal — real progress."* (DIAGNOSIS + PROJECTION) *"Today's easy stays easy; we don't compound off one good day."* (PRESCRIPTION + CHALLENGE)

The agent doesn't compose by stitching one sentence per job. The engine method outputs prose that serves the jobs it needs to serve. The jobs framework is for engineering rigor (which methods feed which slots) and for the relevance filter (does this utterance serve any job?), not for assembly.

---

## 4. The relevance filter

Every coach utterance has to clear all four questions to render:

1. **Is this signal, not chrome?** Anything the page header, calendar, countdown, or stat tile already shows is chrome. The coach doesn't re-narrate chrome. The coach speaks when something *changed*, *conflicts with current behavior*, *just crossed a meaningful line*, or *the runner needs to act on it today*.
2. **Is it actionable or contextual?** Either say what to DO about it, or give context that changes how they THINK about it. Pure facts already shown elsewhere are recitation.
3. **Is it proportional?** A 5-mile easy run doesn't get celebrated like a PR. A single high RHR doesn't earn an alarm. Comments scale to the event.
4. **Would a coach actually say this NOW?** A real coach doesn't ping you daily with "your VDOT is 49.2." They speak when there's a reason. **Silence is a valid coach output.** When there's nothing meaningful, the coach line is null and the card renders without it.

### The 88-day countdown — canonical example

| Moment | Coach says |
|---|---|
| Day 88, mid-base, nothing different about today | **nothing.** The countdown is chrome. |
| Day 88, but it's the day the build phase starts | "Build starts today. 12 weeks to AFC. The shape changes — long run gets serious, one quality session a week." |
| Day 14, taper begins | "Two weeks. The work is done. Volume drops, intensity holds. Don't try to find another hard session." |
| Day 7, race week | "Race week. Trust the lower mileage. The legs are supposed to feel weird — that's freshness." |
| Day 88, but you're 20% behind on volume | "88 days out and the long run hasn't crossed 14. Saturday's the day to push it — the trajectory needs that mile." |
| Day 88, otherwise nominal | **nothing.** |

The countdown number itself is never the message. The *state behind it* is the message — and only when the state has something to say.

### The "no take today" rule

When `coach.<readMethod>()` would return a generic, restated, or pattern-less read, it **returns null**. The UI renders without the coach line. Better silence than fake-friend filler. The dead `synthesizeContextLine` in the existing codebase has the right instinct (don't fill the slot when there's nothing) but the wrong placement (sitting unused). The right pattern: coach method returns prose or null; surface renders conditionally.

---

## 5. The closed loop

**The coach is a feedback-driven system.** Every utterance is aware of what the coach said before and what the runner actually did. Prescriptions get acknowledged. Pushes that landed get recognized in the next prediction. Pushes that didn't land get named honestly. Goals shift when fitness has moved enough to warrant it, and the coach proposes the shift rather than imposing it.

### The six loop steps

| # | Loop step | Today's status |
|---|---|---|
| 1 | **State propagates** — yesterday's run is visible to today's coach | ✅ `gatherCoachState` re-reads activities every request |
| 2 | **Acknowledgment** — coach speaks to what was actually done | ✅ partial via `composeVoiceLead`'s `ranToday` override and `runRead`/`coachRead` for runs and races |
| 3 | **Prediction recalibrates** — race-finish prediction shifts on real fitness | ❌ `raceFitnessPrediction` is a Stage-7 stub returning `goalTime × 0.98` |
| 4 | **Trajectory recalibrates** — path-to-race shifts on real volume/quality | ⚠️ `pathToRace.nextMove` partly real; `trajectory14wk` is a hardcoded curve |
| 5 | **Plan mutates** — the actual calendar of workouts shifts | ❌ `coach.adjustForReality()` throws (Stage A pending) |
| 6 | **Goal renegotiates** — coach proposes faster/slower goal when fitness has moved | ❌ no engine surface exists for this yet |

Steps 3–6 are the gap that today makes faff.run an open loop. Phase 6 of the implementation plan (§23) closes them.

### Loop trumps filter

The relevance filter says silence is a valid output. The closed loop says every utterance is aware of what came before. **When the coach issued a prescription and the runner acted on it (positively or by skipping), the next coach speaking moment MUST acknowledge.** The filter governs unsolicited reads; it does not let the coach forget what it asked for. A prescription is a contract; closing the contract is non-negotiable.

### Goal renegotiation as the highest expression of the loop

When fitness has moved meaningfully against the current goal for 2+ consecutive weeks, the coach surfaces a proposal: *"Trajectory says you could run 1:33 instead of 1:35. Want to bring the goal time down, or hold the goal and bank the buffer for race-day heat? Your call."* The coach proposes; the runner decides. Once accepted, every downstream coach utterance flows from the new goal. If declined, the buffer becomes the story.

---

## 6. Event-driven surfacing

**Reads are computed once per event and cached. Surfaces consume the cache.**

When the runner finishes a run, the activity lands (faff watch upload, Strava webhook, HealthKit ingest, manual entry). At that moment the engine computes the relevant reads — `formRead(activity, state)`, `reflectOnRun(activity)`, `afterPrescriptionRead(activity, recentPrescriptions)` if there's a prescription to close the loop on — and writes them to the cache. Every downstream surface reads the SAME computed strings:

| Surface | When | What |
|---|---|---|
| **Watch finish screen** | T+0, on the wrist | Numbers + 1–2-word verdict chip + audio/haptic. **No sentences** (design brief bans coach prose on watch). |
| **iOS post-run sheet** | T+30sec, phone out of pocket | Full FORM + REFLECTION prose read |
| **Web Run Detail page** | T+evening, at the laptop | Same prose read, larger layout, splits + map |
| **Overview / Training daily card next morning** | T+next day | The REFLECTION line surfaces in the COACH-WATCHING strip; the FORM read is available on the Run Detail link |

Same engine read, same data, different temporal/formal surface. The morning card is not a fresh computation — it's the read from last night's activity, consumed in the morning context. This is what makes the closed loop feel live: runner finishes the work, opens the app, the coach is right there with the take. Not "check back tomorrow."

The cache architecture is detailed in §8.

---

## 7. Coach modes

The coach has a posture that changes with the runner's macro state. Eight modes; one is active at any time. Each mode rewrites how the six jobs behave.

### 7.1 ONBOARDING (cold start → first plan active)

Sub-stages:

| Stage | Trigger | Coach posture |
|---|---|---|
| `cold_start` | No profile, no activities, no race, no plan | Only invitations. "Connect Strava or log your first run — the coach gets sharper with every input." |
| `connected_no_data` | Data source linked, no activities synced yet | "Strava connected. Once your first run lands, fitness lights up." |
| `data_no_goal` | ≥2 weeks of runs, no A-race set | "You've got a base building. Set an A-race in /races and the path-to-race appears." |
| `data_with_goal_no_plan` | A-race set, no plan generated | "Race is locked. Generate a plan in /training and the daily card starts speaking." |
| (exits to `active`) | All four exist | Normal coach operation |

In ONBOARDING, the six jobs effectively all return invitations rather than reads. The TodayCard, RaceCountdownCard, PathToRaceCard, etc. each have an ONBOARDING-variant copy. The COACH-WATCHING strip explains what's needed next. **The app is not silent at onboarding**; it speaks in the coach's voice about what to do to unlock the rest. Onboarding exits when a goal exists AND ≥2 weeks of data AND a plan is generated.

### 7.2 ACTIVE (the default)

Runner has a goal, a plan, recent data. The six jobs all operate normally. This is what the bulk of this spec describes.

### 7.3 MAINTENANCE (no A-race set, plenty of data)

Runner has plenty of training history but no upcoming A-race. **PROJECTION goes silent** (no goal to project to). PRESCRIPTION centers on consistency and base. CHALLENGE shifts to "add an A-race when you're ready — training without a target is maintenance, not progress." REFLECTION still fires on runs, but framed as base-building.

Sample: *"No A-race on the calendar. The body's holding fitness fine, but training without a target is maintenance. Set one when you're ready — the rest of the system wakes up the moment you do."*

### 7.4 INJURY (active injury logged)

Runner has reported an injury. The framework shifts:

- **PROJECTION pauses.** Race goal goes "on hold" with explicit framing. PathToRace card grays out.
- **PRESCRIPTION** sourced from `injury_return.ts` doctrine — return-to-run protocol per injury site/severity. Walk-jog progressions, cross-training, mobility.
- **FORM** doesn't render on returning runs that don't have meaningful streams. Cross-training sessions render reflection but no FORM.
- **CHALLENGE** softens: "Don't be a hero. Coming back early is how the next 8 weeks evaporate."
- **REFLECTION** fires on each cross-training session, walk-jog session, return-protocol step.
- **DIAGNOSIS** shifts to injury-specific signals (pain level, days into protocol, days to expected return).

UI requirements: an active-injury banner at the top of every page; TodayCard becomes the return-protocol step; an `InjuryLogModal` to log; an `InjuryReturnProgressCard` showing the protocol.

### 7.5 ILLNESS (active illness logged)

Runner is sick. The framework shifts:

- **PROJECTION** may pause if severe and within 3 weeks of race day. Coach surfaces a "race re-plan recommendation" if it threatens the build.
- **PRESCRIPTION** shifts to rest or minimal per illness severity. The "above-the-neck-no-fever" rule from voice.md is honored: easy if mild, rest if fever or chest. Don't try to hero through.
- **FORM** doesn't render.
- **CHALLENGE** softens.
- **REFLECTION** fires on the first run back.

UI requirements: an active-illness banner; TodayCard becomes the rest/easy prescription; `IllnessLogBanner` to log; auto-resolves after 14 days with a "still sick?" prompt.

### 7.6 RACE-WEEK (≤7 days from A-race)

The coach shifts to taper-protective posture. CHALLENGE goes quiet ("the work is done"). PRESCRIPTION reduces volume per `taperDepth` doctrine. REFLECTION on recent quality work that confirms readiness. PROJECTION shifts from "how do we get there" to "what does race day look like."

### 7.7 RACE-DAY (race-day -12h to race-finish + 2h)

A distinct mode. The Overview/Training pages collapse to a single `RaceDayCard`.

- **PROJECTION** silent (race is happening).
- **PRESCRIPTION** = the race-morning brief (already wired via `briefRaceMorning`).
- **DIAGNOSIS** reduced to warm-up readiness only.
- **FORM** silent until post-race.
- **CHALLENGE** silent (don't second-guess; runner's at the line).
- **REFLECTION** fires post-finish via `coachRead` within hours.

The RaceDayCard carries: brief at top, pace strategy, fueling plan, weather conditions, a single "GO RACE" CTA. Post-finish: the card flips to a "log your race" affordance, then to a recap.

### 7.8 POST-RACE (race-finish + 1 day → race-finish + 1 month)

A graduated three-window mode:

| Window | Coach posture |
|---|---|
| 0–3 days | REFLECTION + rest prescription. PROJECTION silent. CHALLENGE soft. |
| 3–10 days | REFLECTION extended (retrospective insight via `coach.retrospect` when it lands). Light return-to-easy prescription. PROJECTION starts surfacing the next horizon ("what's next?"). |
| 10–30 days | Back toward ACTIVE. Re-plan if a next race exists; MAINTENANCE if not. |

Auto-resolves into ACTIVE or MAINTENANCE on day 30 post-race.

### 7.9 MULTI-RACE (multiple A-races in overlapping build windows)

When 2+ A-races have overlapping plan windows, the coach surfaces a conflict and proposes a primary. PROJECTION cycles through races: the nearest A-race is primary, the next is shown as "after" in the PathToRace. If parallel races (HM + M same period), the longer/harder race takes priority for plan shape and the coach speaks to that tradeoff.

UI requirement: `RaceConflictBanner` on Overview when conflict exists, with proposal to confirm priority.

### Mode selection

`coach.activeMode(state, today) → CoachMode` is the single source of truth. Modes are evaluated in priority order:

1. RACE-DAY (any race today)
2. ILLNESS (active illness)
3. INJURY (active injury)
4. POST-RACE (within 30d of last race)
5. RACE-WEEK (≤7d from next A-race)
6. ONBOARDING (any onboarding sub-stage)
7. MULTI-RACE (multi-race conflict active)
8. MAINTENANCE (no A-race set, has data)
9. ACTIVE (default)

Every page's render dispatches off mode first, then runs the per-job reads.

---

## 8. Coach cadence (TTLs and cache architecture)

The relevance filter says when to speak. The cadence rules say how often the SAME read refreshes. Without these, the coach risks staleness (yesterday's read still showing) or chatter (different reads every app-open).

### TTLs per read kind

| Read | TTL | Refresh trigger |
|---|---|---|
| `PRESCRIPTION` (today's call) | 24h | 4am local daily cron; or plan mutation; or new activity within last 6h |
| `DIAGNOSIS` (readiness, body systems, fitness state) | 24h | Same as above; or new activity ingest |
| `PROJECTION` (path-to-race, trajectory, predictions) | 7d | A race added/edited; significant volume shift (>20%); plan mutation; goal change |
| `CHALLENGE` (push/back-off prompts) | per-event | Fired by signal (e.g. 3 missed quality sessions in 2 weeks); held until signal clears |
| `REFLECTION` on a run | per-activity, forever | Computed once at ingest, cached on the activity, never recomputed unless the activity is edited |
| `FORM` on a run | per-activity, forever | Same as REFLECTION |
| `PATTERN` reads (sleep trend, missed-quality cluster, RHR drift) | until signal changes | Delta-driven; recomputed when the underlying pattern's signature shifts |
| `MODE` selection | computed per-request | Cheap; runs on every page request |

### Cache architecture

A `coach_reads` table or Redis cache with rows:

```
(runner_id, read_kind, key, content, computed_at, ttl_at, recompute_after, source_state_hash)
```

- `key` — read-kind-specific identifier (e.g. `activity_id` for FORM/REFLECTION reads; `today_iso` for daily reads; `race_slug` for PROJECTION reads)
- `content` — the full coach prose, plus any length variants (see §9)
- `computed_at` — when written
- `ttl_at` — when it becomes stale
- `recompute_after` — when the next computation should fire (background)
- `source_state_hash` — hash of the inputs that produced it, for change detection

### Computation triggers

| Event | What recomputes |
|---|---|
| Activity ingest | REFLECTION + FORM for the activity; DIAGNOSIS; PROJECTION; afterPrescriptionRead if a prescription was due in last 36h |
| Daily 4am job | PRESCRIPTION + DIAGNOSIS for every active runner |
| Race added/edited | PROJECTION; trajectory; predictions |
| Plan mutated | PRESCRIPTION + PROJECTION + downstream |
| Goal accepted | All goal-anchored reads |
| Check-in logged | Today's PRESCRIPTION (may re-prescribe); DIAGNOSIS |
| Injury logged | Mode shift + all reads recomputed in the new mode |
| Illness logged | Same |
| Mode shift | All reads recomputed |

### Reading from cache

Pages call `coach.read(runnerId, readKind, key)` which returns:

- Cached content if `now < ttl_at`
- Triggers recomputation + returns the new content if `now > ttl_at`
- Returns null if nothing exists yet

Pages never compute reads directly. **One coach computation per event; consumed everywhere.**

### Freshness affordance

A tiny `computed Xmin ago` timestamp on the COACH-WATCHING strip and on the daily card so the runner knows whether they're looking at a fresh read or a held one. Not prominent — just honest.

---

## 9. Cross-page consistency

**Single source of truth for coach text.** A REFLECTION on Tuesday's tempo is the same string on Run Detail, Log feed, Wednesday's Overview, and the iOS post-run sheet. No page-local copy synthesis.

Engine methods that emit text return multiple length variants in one call:

```ts
coach.runRead(activity, state) → {
  verdict: string,           // 1–2 words for chips and watch tokens
  oneLineSummary: string,    // <80 chars for log feed rows
  fullBody: string,          // 2–4 sentences for Run Detail + iOS sheet
  watchToken: string,        // 1 word, all-caps, for the watch (e.g. "PR", "ON TARGET")
}
```

Same for `formRead`, `reflectOnRun`, `coachRead`, `assessReadiness.message + messageShort`, `pathToRace.nextMove + nextMoveShort`, etc.

Pages map:

| Surface | Variant |
|---|---|
| Watch finish screen | `watchToken` |
| Log feed row collapsed | `verdict` |
| Log feed row expanded | `oneLineSummary` |
| iOS post-run sheet | `fullBody` |
| Web Run Detail | `fullBody` |
| Web Overview COACH-WATCHING strip | `oneLineSummary` |
| Web daily card body | `fullBody` |

Audit pass after the rewrite: grep page.tsx/data.ts for coach-flavored strings that don't trace to a `coach.<method>()` call. Each violation is a fix.

---

## 10. Autonomy contract

The coach is not a passive observer. It modifies the plan, prescribes adjustments, proposes goal changes. Three classes, each with a different consent model:

### 10.1 Coach can do UNILATERALLY (with notification)

- Adjust today's prescription within ±20% mileage and ±1 zone intensity, when a clear signal demands it (illness signal, RHR spike, missed sleep, weather)
- Move today's quality session to tomorrow when today is force-recovery
- Cap a long-run length to 110% of recent peak when the prescribed long would over-shoot the trajectory
- Apply taper depth without asking (race-week protocol)
- Soften or firm a prescription's tone register based on check-in signal

Every unilateral change shows up in the "Coach Adapted" feed (PlanAdaptedCard) with the trigger + reasoning.

### 10.2 Coach MUST PROPOSE (require runner accept)

- Goal time changes (faster or slower) when fitness has moved >X sec/mi for 2+ weeks
- Multi-week plan re-shapes
- Race priority changes when 2 A-races conflict
- Build phase length changes
- Dropping a race from the calendar
- Skipping the long run entirely (vs shortening)
- Changing the long-run day

Each proposal becomes a `ProposalCard` on Overview with accept/reject buttons. Until accepted/rejected, the existing plan holds. If rejected, the coach acknowledges and doesn't re-propose for ≥2 weeks unless the signal strengthens.

### 10.3 Coach MUST NOTIFY (explain what's happening)

- Any time the coach shifts mode (entering POST-RACE, exiting ONBOARDING, etc.)
- Pattern reads that drive recommendations
- Any time the coach softens or firms a prescription (even within unilateral bounds)

Notifications surface in the COACH-WATCHING strip + a daily digest line at the top of Overview.

### Storage

`coach_actions` table: `(id, runner_id, action_type, mode: 'unilateral'|'propose'|'notify', payload, status, created_at, responded_at)`. Renders into the PlanAdaptedCard timeline, the ProposalCard surface, and the WATCHING strip respectively.

---

## 11. Tone register

The coach matches the room. Five registers; selected per-utterance by `coach.selectTone(state, context) → Tone`.

| Tone | When | Voice |
|---|---|---|
| `quiet` | Recovery weeks, illness windows, missed-run weeks, runner self-reports stress/poor in check-in | Soft, fewer words, no challenge. "Easy today. Nothing to prove." |
| `plain` | Default. Build phase, base phase, normal operation | Direct, plain, no flourish. "Easy 5 today. Hold the conversational pace." |
| `firm` | Quality days, peak phase, runner hiding behind a story (easy days running hot, skipped quality) | Honest pressure. Can swear when it fits. "Easy 5. SLOW. Three of the last five easies landed at tempo pace — that's not easy." |
| `celebratory` | PRs, milestones, breakthrough workouts | Recognition without hype. Voice.md still bans corny celebration. "Four-minute PR. That's the cleanest race execution you've put down this year." |
| `urgent` | Injury signals, severe over-reach, missed taper, illness escalation | Direct, action-first, no padding. "Calf is barking. Stop. We don't bully soft-tissue stuff." |

### How tone is selected

Each engine method calls `coach.selectTone()` with its context and passes the selected tone down to the voice template:

```ts
function selectTone(state, ctx): Tone {
  if (ctx.injuryActive || ctx.illnessActive) return ctx.severity === 'major' ? 'urgent' : 'quiet';
  if (ctx.recentPR || ctx.milestoneCrossed) return 'celebratory';
  if (ctx.skippedQualityCluster || ctx.easyDaysHot) return 'firm';
  if (ctx.checkinPoorMultiday || ctx.recoveryWeek) return 'quiet';
  if (ctx.qualityDay || ctx.peakPhase) return 'firm';
  return 'plain';
}
```

Voice templates have a tone variant per branch. LLM prompts in `llm.ts` pass tone as part of the system context so the model picks register accordingly.

---

## 12. Confidence calibration

The coach makes certainty-graded claims. A real coach hedges when guessing and states plainly when certain. Every engine read carries a `confidence: 'high' | 'medium' | 'low'` field. Voice templates hedge per confidence.

### Confidence rules

| Confidence | Triggers |
|---|---|
| `high` | Race result within 8 weeks, ≥4 weeks of consistent data, signal directly observed |
| `medium` | Race result 8–16 weeks old, 2–4 weeks of consistent data, signal inferred |
| `low` | Race result >16 weeks, <2 weeks of data, wildly inconsistent signal |

### Hedging in voice

| Read | High | Medium | Low |
|---|---|---|---|
| Fitness | "Fitness sits at VDOT 50.4." | "Fitness reads around VDOT 50." | "Hard to call fitness yet — only 2 weeks of data." |
| Race prediction | "Predicts 1:32:14." | "Predicts around 1:33." | "Not enough recent racing to predict yet." |
| Trajectory | "On track for the goal." | "Looks on track, but the picture has some noise." | "Trajectory unclear — need 3 more weeks." |

### Visual hint

Surfaces also reflect confidence visually:

- HIGH: solid stat
- MEDIUM: dashed underline on the stat
- LOW: `~` prefix or "estimated" label

No new UI cards; this is a property on existing stat displays.

---

## 13. Runner input loop

The closed loop has two halves. Coach output we've covered. **Runner input is the other half — and it's mostly missing today.** The coach has to be able to RECEIVE input and RESPOND. Five inputs to surface:

### 13.1 Daily check-in (mood, energy, soreness, stress)

Exists in design today; needs DB wire-up. Sliders for energy / soreness / stress (1–10) + optional emoji-free mood tag. Coach reads on next compute and may soften/firm today's prescription.

UI: `DailyCheckinCard` on Health (already in design). Banner on Overview if not logged by mid-morning.

Engine: `coach.respondToCheckin(state, checkin) → {coachLine, planAdjustment?}`. Surfaces in REFLECTION ("you logged poor sleep — today stays easier than written").

### 13.2 Post-run RPE + notes

After a run lands, a sheet prompts: "How hard was it?" (1–10) + free-text ("calf tight", "felt great", "windy"). Skippable. Stored on the activity.

UI: `PostRunRpeSheet` — modal/sheet after run finish on iOS, and a banner on Run Detail web. Quick: tap a number, optional note, submit.

Engine: `coach.runRead` now takes `subjectiveRpe?` as input. When present, the FORM read incorporates it ("HR-pace says easy but you logged a 7 RPE — likely fatigue, easy stays easier this week").

### 13.3 Skip reasons

When the runner taps "Skip today" on TodayCard, or when end-of-day passes with no logged run, surface a quick "why?" sheet with chips (tired / sick / schedule / not feeling it / other) + optional free text.

UI: `SkipReasonModal` triggered from TodayCard skip button or end-of-day nudge.

Engine: `coach.respondToSkip(state, skip) → {coachLine, planAdjustment?}`. Coach may move workout, soften next day, or challenge a pattern ("third skipped easy this week — real reason or excuse?").

### 13.4 Free-text "talk to the coach" notes

Accessible from the Health page (or a top-bar affordance). Lets the runner journal a note that the coach reads as context ("calf is starting to bark", "race got moved to October", "feeling burned out").

UI: `TalkToCoachSheet` — a simple textarea + recent coach responses visible (so the runner sees the coach engaging with what they said). Notes are stored and surface in coach context for ≥30 days.

Engine: `coach.respondToNote(state, note) → {coachLine, action?}`. Coach may:
- Acknowledge the note in voice
- Trigger an injury logging flow if injury keywords detected
- Trigger a re-plan proposal if schedule keywords detected
- Just hold it in context with a brief acknowledgment

### 13.5 Accept/reject on coach proposals

When a `ProposalCard` is rendered (goal change, race priority, etc.), the runner sees the proposal + reasoning + accept/reject buttons. Acceptance triggers downstream recomputation; rejection acknowledges and doesn't re-propose for ≥2 weeks.

UI: `ProposalCard` on Overview when `state.coachProposals.pending.length > 0`. Renders proposal + reasoning + actions.

### Storage

| Input | Table |
|---|---|
| Daily check-in | `daily_checkins` |
| Post-run RPE | `post_run_rpe` |
| Skip reason | `workout_skips` |
| Free-text note | `runner_notes` |
| Proposal response | `coach_proposals` (with `status: 'accepted'|'rejected'`) |

All inputs roll into `gatherCoachState` so they propagate into every downstream read.

---

## 14. Source-agnostic FORM

Runs flow in from multiple sources — primarily the faff Apple Watch app, plus Strava, HealthKit, manual entry, future Garmin sync. The coach reads activities, not pipes.

### Tier 1 streams (almost always present)

Distance, time, per-mile splits + pace, per-mile HR (when wearable has HR on), GPS polyline + elevation.

Gives: pacing discipline, HR-vs-pace decoupling, cardiac drift, hill behavior, race-execution patterns, fade location. The bulk of useful FORM reads come from Tier 1.

### Tier 2 streams (present when watch/app captures them)

Cadence (steps/min), stride length, vertical oscillation, ground contact time/balance, running power, continuous HR (not just per-mile averages).

For runs from the faff watch app, Tier 2 should be available natively (Apple Watch carries cadence and stride out of the box). For Strava-ingested runs from a Garmin user, Tier 2 may come through. For a phone-only runner, only Tier 1.

### The Activity abstraction

`coach.formRead(activity: Activity, state: CoachState)` reads from a unified `Activity` shape with optional stream fields. Presence of `activity.streams.cadence` triggers the cadence section; absent, no cadence read. Same for every other stream. **Silence at the data-availability level — no faking "cadence unknown" comments.**

The agent should verify the `Activity` type lives in a shared location (likely `web/lib/`) and audit the ingest pipelines (faff watch upload route, Strava sync, HealthKit ingest) all normalize into it. If today everything is still `strava_activities`-shaped, the unification is part of Phase 6.

---

## 15. Non-running coverage

The six jobs explicitly include non-run training. Strength, mobility, cross-training, recovery modalities (sauna / cold plunge / yoga / massage / nap), sleep, nutrition. Doctrine covers all of these (`strength.ts`, `cross_training.ts`, `mobility.ts`, `recovery_protocols.ts`, `hydration.ts`).

### How non-running maps to the six jobs

| Job | Non-running surface |
|---|---|
| PRESCRIPTION | Coach prescribes strength (2x/week per Research/07), mobility (daily), cross-training (when injured or active recovery) |
| REFLECTION | Coach acknowledges logged strength, recovery modality, cross-training session |
| FORM | N/A for strength/yoga/sauna. Applies to instrumented cross-training (cycling HR/power) when streams are present. |
| CHALLENGE | "Strength sessions haven't fired in 3 weeks — the build is going to expose it." |
| DIAGNOSIS | Reads recovery modalities into recovery state (sauna/yoga credit toward recovery) |
| PROJECTION | Long-term strength gap shows up as injury risk in the build |

### UI surfaces needed

- `LogStrengthCard` / quick log from Today or top-bar (type + duration + notes)
- `LogCrossTrainingCard` (bike, swim, hike, etc. — modality + duration + intensity)
- `LogRecoveryModalityCard` — already exists in some form, verify it surfaces credits to coach

### Engine methods

- `coach.strengthRead(state) → {coachLine, lastSession, prescription, gapDays}`
- `coach.recoveryRead(state) → {coachLine, modalitiesLast7d, creditTotalMinutes}`
- `coach.crossTrainingCredit(state) → {hrAdjustment, fitnessPreservation, coachLine}` — used when in INJURY mode

---

## 16. Engine method → jobs mapping

The complete map. Every engine method tagged with the job(s) it serves. The agent uses this to know which method to wire to which slot.

| Method | Jobs served | Status |
|---|---|---|
| `prescribeWorkout(input)` | PRESCRIPTION | Real |
| `assessReadiness(input)` | DIAGNOSIS | Real |
| `bodySystems(input)` | DIAGNOSIS | Real (rationale strong; under-surfaced) |
| `pathToRace.nextMove(input)` | PROJECTION + CHALLENGE | Real |
| `nextPushes(input)` | CHALLENGE | Real |
| `weekDeltas(input).coachNote` | DIAGNOSIS + PROJECTION + CHALLENGE | Real (under-surfaced) |
| `runRead(input)` | REFLECTION + FORM | Real (un-wired to Log + Run Detail) |
| `coachRead(input)` | REFLECTION + FORM + CHALLENGE | Real (un-wired to Races index) |
| `formRead(activity, state)` **NEW** | FORM | To build |
| `reflectOnRun(activity)` **NEW** | REFLECTION | To build |
| `reflectOnPattern(state, kind)` **NEW** | REFLECTION (pattern flavor) | To build |
| `reflectOnMilestone(state)` **NEW** | REFLECTION (acknowledgment flavor) | To build |
| `afterPrescriptionRead(activity, recentPrescriptions)` **NEW** | REFLECTION (closed-loop specific) | To build |
| `proposeGoalAdjustment(state)` **NEW** | CHALLENGE + PROJECTION | To build |
| `raceFitnessPrediction(input)` | PROJECTION | **Stub today; P0 to replace** |
| `trajectory14wk(input)` | PROJECTION | **Stub today; P0 to replace** |
| `taperDepth(input)` | PRESCRIPTION + PROJECTION | Real |
| `briefRaceMorning(input)` | PRESCRIPTION (race-day modality) | Real |
| `retrospect(input)` | REFLECTION + DIAGNOSIS + PROJECTION | **Throws today; pending** |
| `adjustForReality(input)` | PRESCRIPTION (plan mutation) | **Throws today; P0 to land** |
| `paceStrategy(input)` | PRESCRIPTION (race-pacing) | Real |
| `fuelingFor(input)` | PRESCRIPTION (race-day) | Real |
| `engineDetails(state)` | DIAGNOSIS (profile-page meta) | Real (bypassed by Profile route) |
| `proofSessions(state)` | PROJECTION (proof workouts en route) | Real (stub for now) |
| `onboardingStage(state)` **NEW** | (mode selector) | To build |
| `onboardingNudges(stage, state)` **NEW** | All jobs in onboarding modality | To build |
| `injuryMode(state)` **NEW** | DIAGNOSIS + PRESCRIPTION (injury modality) | To build |
| `illnessMode(state)` **NEW** | DIAGNOSIS + PRESCRIPTION (illness modality) | To build |
| `raceDayMode(state, today)` **NEW** | PRESCRIPTION (race-day) | To build (wraps existing methods) |
| `raceConflict(state)` **NEW** | PROJECTION + CHALLENGE | To build |
| `bRaceClassification(b, a, phase)` **NEW** | PROJECTION (B-race role) | To build |
| `respondToCheckin(state, checkin)` **NEW** | DIAGNOSIS + PRESCRIPTION | To build |
| `respondToNote(state, note)` **NEW** | REFLECTION + (maybe trigger) | To build |
| `respondToSkip(state, skip)` **NEW** | REFLECTION + CHALLENGE + PRESCRIPTION | To build |
| `strengthRead(state)` **NEW** | REFLECTION + CHALLENGE + PRESCRIPTION (non-running) | To build |
| `recoveryRead(state)` **NEW** | DIAGNOSIS + REFLECTION (non-running) | To build |
| `crossTrainingCredit(state)` **NEW** | DIAGNOSIS (during injury) | To build |
| `selectTone(state, ctx)` **NEW** | (cross-cutting) | To build |
| `activeMode(state, today)` **NEW** | (mode selector) | To build |
| `computeAndCache(...)`, `read(...)` **NEW** | (infrastructure) | To build |
| `coach-narrative.narrativeLine(state)` | REFLECTION (pattern) + DIAGNOSIS | Real |
| `composeVoiceLead(ctx)` | PRESCRIPTION body | Real (gold standard) |
| `plan-builder.notesFor(workout)` | PRESCRIPTION (per-workout copy) | Real |
| `plan-builder.weekRationale(phase)` | PROJECTION (week shape) | Real |

### Inverse view — by job

| Job | Methods that feed it |
|---|---|
| REFLECTION | `runRead`, `coachRead`, `reflectOnRun`, `reflectOnPattern`, `reflectOnMilestone`, `afterPrescriptionRead`, `narrativeLine`, `respondToNote`, `respondToSkip`, `respondToCheckin`, `strengthRead` |
| DIAGNOSIS | `assessReadiness`, `bodySystems`, `weekDeltas.coachNote`, `engineDetails`, `respondToCheckin`, `injuryMode`, `illnessMode`, `recoveryRead`, `crossTrainingCredit` |
| PRESCRIPTION | `prescribeWorkout`, `composeVoiceLead`, `plan-builder.notesFor`, `taperDepth`, `briefRaceMorning`, `paceStrategy`, `fuelingFor`, `adjustForReality`, `respondToCheckin`, `respondToSkip`, `injuryMode`, `illnessMode`, `raceDayMode`, `strengthRead` |
| PROJECTION | `pathToRace.nextMove`, `raceFitnessPrediction`, `trajectory14wk`, `proofSessions`, `weekDeltas.coachNote`, `proposeGoalAdjustment`, `raceConflict`, `bRaceClassification`, `plan-builder.weekRationale` |
| CHALLENGE | `nextPushes`, `pathToRace.nextMove`, `coachRead`, `proposeGoalAdjustment`, `respondToSkip`, `weekDeltas.coachNote`, `strengthRead`, `raceConflict` |
| FORM | `runRead`, `coachRead`, `formRead` |

If a page slot needs a CHALLENGE read, the agent picks from the CHALLENGE row. If a method is listed under multiple jobs, its return carries the prose serving those jobs in 2–4 sentences.

---

# Part II · Diagnosis (today's state)

---

## 17. The three root failure patterns

Carried over from the original audit; the implementation phases below all attack one of these:

### 17.1 The bypass

Pages reach past the coach. `api/profile/route.ts` calls `gatherCoachState()` then implements its own `buildEngineBlock()`, `stubVdot()`, `stubHrBlock()`, `stubPrefs()`, `buildTier()` — each producing flatter local copy than the matching `coach.engineDetails()`, `coach.runRead()`, `coach.weekDeltas()`. The Log feed never calls `coach.runRead()`. The Health composite ring discards `assessReadiness.message` and rebuilds a one-word `headlineLabel`. Overview ReadinessCard `.slice(0, 40)`s the message mid-sentence.

### 17.2 Silent reciters (false-coach lies)

Coach-shaped slots filled with hardcoded constants the user trusts as reads: `'CLIMBING'` (always-on tier pin), `'FRESH'` (always-on VDOT pin), `'12/12 RULES OK'`, `'SUSTAINABLE'`, `'92% EASY / 8% HARD ✓'`, `'TUNE-UP'`, `'HARD STRETCH'`, `'FITNESS PEAKING'`, `'ACTIVE'`, `'EASY · ABSORB'`. RPE column on the Log feed is per-category constants masquerading as effort signal. TodayCard HR cap = `130 + zone × 8` arithmetic, not a real HRmax read.

### 17.3 Voice doctrine violations

Emoji 😴🚀🙂🤕😌😣 on the Health check-in sliders; `(Plews §5)` / `(Saw 2016)` / `(Research/00b §…)` inline citations in prose; "Coach says:" / "the Coach prescribes…" third-person framing; untranslated `Z2 / T-pace / @ HMP / VDOT / CTL-ATL-TSB / RHR / HRV / ACWR / aerobic engine` jargon; proof-session structures like `"4 × 1MI @ T · 90s float"` which voice.md bans explicitly.

---

# Part III · Implementation phases

The fix is mostly wiring + deletion + filling holes the doctrine demands. The engine voice mostly exists; the UI throws it away. Phases are ordered for dependency and risk.

---

## 18. Phase 1 — Voice violations cleanup (mechanical)

Zero logic dependency. Single commit. No new copy required — delete, replace token, or unpack jargon in-place.

### 18.1 Emoji removal

| File:line | Action |
|---|---|
| `web/app/health/page.tsx:371-389` (SliderRow energy/soreness/stress) | Remove 😴🚀🙂🤕😌😣. Keep numeric scale + label-pair (`1 · DRAINED · 10 · PEAK`). |

Greps: `rg -P '[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]' web/app web/coach` returns no user-facing-string hits.

### 18.2 Section-number / citation removal from prose

Body prose strips all `§`, `(Plews 2017)`, `(Saw 2016)`, `(Research/00b §…)`, `Research/00a §…`. Citations live in the `Citation[]` data array, surfaced only via the "why?" tooltip.

| File:line | Strip |
|---|---|
| `web/coach/coach.ts:1808` | `(Research/00b §Recovery by Distance…)` |
| `web/coach/plan-builder.ts:793, 795, 811-812, 816-818` | `(Research/04 §I-pace)`, `(Research/22 §3)`, `(Research/08 §9.3)` |
| `web/app/training/page.tsx:1500` | `"cite · /Research/00a §Training Intensity Distribution"` foot |
| `web/app/overview/page.tsx:1586` | `"Research/00b §Decision Matrix"` row |
| `web/app/overview/page.tsx:1125` | `"Research/00b · /22 → live coach read"` foot |
| `web/app/health/page.tsx:1010-1019, 977-980` | `(Plews §5)`, `LnRMSSD` |
| `web/app/api/health/route.ts:1084-1089` | `(Saw 2016)` |

### 18.3 Third-person coach voice → first-person/imperative

Pattern: kill `"Coach …"` as the subject. The coach speaks; doesn't describe itself.

| Pattern | Replace |
|---|---|
| `"Coach says: stable"` | `"Stable. Keep doing what you're doing."` |
| `"Coach says: elevated — watch sleep + load"` | `"RHR is up. Watch your sleep and pull back the easy days a notch."` |
| `"COACH IS USING TODAY'S READINGS"` | `"USING TODAY'S READINGS"` |
| `"COACH MOVED THE PLAN"` | `"PLAN MOVED · {N} CHANGES"` |
| `"Coach is pulling back"` | `"Pulling back today — body's louder than the watch."` |
| `"Coach defers"` | `"Waiting on today's check-in"` |
| `"Coach holds the wearable line"` | `"Body says go, signals say steady. Holding to the steady side today."` |
| `"COACH READS THESE"` | Drop. Per-goal coach response is the proof. |
| `"The Coach prescribes every run inside..."` | `"Every run sits inside one of these 5 pace bands."` |
| `"The Coach won't prescribe a long run over..."` | `"Long run capped at 9.0 mi next week. Keeps the jump safe."` |
| `"COACH DETAILS · WHAT THE ENGINE IS USING"` | `"COACH DETAILS"` |

### 18.4 Jargon translation

Labels can be short; every running-science acronym must expand on the same row or get replaced. Table from the original audit (unchanged):

| Jargon | Replacement |
|---|---|
| `Z1 EASY / Z2 AERO / Z3 TEMPO / Z4 THRESH / Z5 VO2` | `EASY / AEROBIC / TEMPO / THRESHOLD / MAX` (drop the Z) |
| `T-pace`, `@ T` | `at threshold pace (7:08/mi)` — always pace inline |
| `@ HMP` | `at half-marathon pace (7:14/mi)` |
| `MP+20` | `20 seconds per mile slower than marathon pace` |
| `VDOT 49.2` headline | Translate or relegate. Don't surface bare. |
| `RHR` card label | `MORNING HEART RATE` |
| `HRV` card label | `RECOVERY (HRV)` — parenthetical first time |
| `CV 8%` | `Steadiness 8%` |
| `FORM · CTL/ATL/TSB` (Health card) | `FORM · FITNESS vs FATIGUE` — frees the word "FORM" for the FORM job |
| `CTL · 28D 47` | `FITNESS · 28-DAY 47` |
| `ATL · 7D 52` | `FATIGUE · 7-DAY 52` |
| `TSB · {CTL} − {ATL}` | `FORM = FITNESS − FATIGUE` |
| `ACWR 1.12` | `LOAD 1.12 (last 7 vs last 28)` |
| `SUBMAX HR DRIFT · EASY PACE` | `EASY-PACE HEART RATE TREND` |
| `LnRMSSD` | Drop. Use "HRV" alone. |
| `+ STR` chip | `+ STRENGTH` |
| `▾ADJ` chip | `▾ ADJUSTED` |
| `INT` (intervals) | `INTERVALS` |
| `HMP / MP` calendar labels | `HALF-PACE / MARATHON-PACE` |
| `macrocycle` | `season` |
| `aerobic engine` (when used as verdict) | `endurance` or unpack ("your body's ability to run easy at this pace is rising") |
| `polarized` | "Easy on easy days, hard on hard days — 80/20 mix." (translate at least once per surface) |

Proof-session structure strings get full English rewrites (covered also in Phase 5):

| Old | New |
|---|---|
| `"4 × 1MI @ T · 90s float"` | `"4 hard miles at threshold pace, 90 seconds easy jog between each"` |
| `"3 × 2MI @ HMP · 60s jog"` | `"3 two-mile reps at half-marathon pace, 60 seconds easy jog between"` |
| `"8 MI continuous @ HMP"` | `"8 continuous miles at half-marathon pace"` |

### 18.5 Acceptance for Phase 1

```
rg -i '§|coach says:|the coach |as your coach|crushing it|locked in|let.s go|let.s crush|send it|dig deep|today.s session is' web/app web/coach
rg -P '[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]' web/app web/coach
rg -w '(Z[1-5]|HMP|MP\+|VDOT|LnRMSSD|CTL|ATL|TSB|ACWR|RHR)\b' web/app
```

Returns only intentional exceptions (translated-inline, or in citation data fields).

---

## 19. Phase 2 — Wire existing engine voice through

The engine writes the voice; the UI bypasses or truncates. Each wiring fix replaces a local synthesizer with the engine call, deletes the local synthesizer, and renders the long-form prose.

### 19.1 W1 — `coach.runRead()` → Log feed + Run Detail

**Today:** Log feed (`api/log/route.ts:buildRunRow`) emits one-word categories + constant-per-category RPE. Run Detail (`runs/[id]/page.tsx`) is a Strava-mirror with zero coach text.

**Wire:**
- Activity ingest pipeline calls `coach.runRead()` and caches (`runRead.verdict`, `oneLineSummary`, `fullBody`, `watchToken`) on the activity.
- Log feed row: `verdict` collapsed, `oneLineSummary` on row expand. Drop the constant RPE column.
- Run Detail: new `CoachReadCard` near top, above splits. Renders `verdict + fullBody + unlockPin + deltas`. FORM section below splits (when `formRead` lands).

### 19.2 W2 — `coach.assessReadiness().message` → Health composite + Overview Readiness

**Today:** Health composite discards `message`, rebuilds one-word `headlineLabel` + stub signal bars. Overview ReadinessCard truncates `.slice(0, 40)`.

**Wire:**
- `buildReadinessComposite` passes `assessReadiness.message` through as `coachRead` field.
- Overview ReadinessCard renders the full message (no slice). If layout demands shorter, use engine's `messageShort` (added in §22).
- Stub signal bars (`+0.25 / 0.00 / −0.25` hardcoded) → wire to real `state.volume.deltaPct4v4`, `state.intensity.easyShare14d`, etc. If signal is null (HealthKit unwired), render empty state, not fake number.

### 19.3 W3 — `coach.bodySystems().rationale` → 3 BodySystems cards

**Today:** Overview, Health, Races BodySystems cards render dot-grid + healed dates + hardcoded `'HARD STRETCH'` foot. Rationale fetched and never rendered.

**Wire:**
- Add coach-prose body to BodySystemsCard above dot rows, rendering `rationale`.
- Drop hardcoded `'HARD STRETCH'` foot.
- `contextLabel` (`RECOVERED / EARLY REPAIR / REBUILDING / LATE REPAIR`) only as side chip, never primary.

### 19.4 W4 — `coach.weekDeltas().coachNote` → WeekStripCard + PlanAdaptedCard

**Today:** WeekStripCard shows only the rationale `"PROJECTING 22.1 MI · +1.5 OVER PLAN."`. PlanAdaptedCard hardcodes `"Doctrine-grounded adaptations…"`.

**Wire:**
- WeekStripCard renders `coachNote.body` as primary; math projection sidelined to a stat tile.
- PlanAdaptedCard on Overview + Training renders `weekDeltas.coachNote.body` (or `coach.recentAdjustments().rationale` until `adjustForReality` lands).

### 19.5 W5 — `coach.engineDetails()` → Profile Coach Engine card

**Today:** Profile bypasses `engineDetails()`; ships flatter local `buildEngineBlock()`. Pace zones tile renders empty even when VDOT exists; cutback tile hardcoded `'Every 3 WKS'`; easy-share tile says `"At least 80%. You're at 73%."` without prescription.

**Wire:**
- Profile route replaces `buildEngineBlock` with `coach.engineDetails()` passthrough.
- Pace zones tile renders from `vdotSnapshot.paces`.
- Drop hardcoded `'low-band mileage tier'` text — engineDetails returns tier-specific.
- Drop the always-12/12 plan-integrity tile until a real validator lands. **Lying validator is worse than silent.**

### 19.6 Other wirings

| W# | Method → Surface | Action |
|---|---|---|
| W6 | `coach.pathToRace().nextMove` → Path To Race card | Already wired; verify. |
| W7 | `coach.nextPushes().action` → NextPushCard | Already wired; verify. |
| W8 | `coach.raceFitnessPrediction()` no-VDOT branch → Races A-RACE hero empty | Surface the rationale (`"No recent race logged — fitness can't be inferred. Log a recent 5K/10K/HM…"`). |
| W9 | `coach.raceFitnessPrediction()` VDOT branch rationale → Races HEADROOM tile | Add prose row below tile. |
| W10 | `coach.coachRead()` → Races index Latest Result | Replace data.ts `synthesizeCoachRead` with `coach.coachRead()`. |
| W11 | `coach.taperDepth()` → Races taper banner | Verify rendering when nextA ≤21d. |
| W12 | `coach.fuelingFor()` → Race detail fueling card | Wire. |
| W13 | `coach.retrospect()` → Races recent results | Out of scope until Stage R lands. Render `coachRead.body` as interim. |
| W14 | `coach.adjustForReality()` → Plan Adapted card | Out of scope until Stage A. Render empty state until then. |

### 19.7 The bypass-deletion checklist

After W1–W5 land, delete:

- `api/log/route.ts:buildRunRow.kind / sublabel / rpe` constant-per-category logic
- `api/profile/route.ts:buildEngineBlock` (replaced by passthrough)
- `api/profile/route.ts:stubVdot, stubHrBlock` (replaced)
- `api/health/route.ts:buildReadinessComposite.headlineLabel / signal labels` (passthrough)
- `app/races/data.ts:synthesizeCoachRead` (replaced)
- `app/races/data.ts:tuneupTag` hardcoded `'TUNE-UP'` (replaced by `coach.bRaceClassification()` in Phase 7)

---

## 20. Phase 3 — Fill silent reciters with new coach voice

Slots that have no engine method today. Each gets a new engine method (preferred — cacheable, consistent) or inline copy with a TODO to migrate.

### 20.1 New engine methods

| Method | Inputs | Returns | Surfaces |
|---|---|---|---|
| `coach.dailyConditionsNote(state, weather, workout)` | weather + today's prescription | `{coachNote, hrCap, hrCapReason}` | TodayCard Conditions tile |
| `coach.bRaceClassification(b, a, phase)` | B-race + A-race + current phase | `{role, coachLine}` | UP NEXT B-race inset on Overview + Races |
| `coach.classifyClimb(grade, distMi)` | per-mile grade + distance | `{category, label, coachNote}` | Run Detail per-mile climbs |
| `coach.recentResultRead(result, plan)` | finished race + plan context | `{coachLine}` | Result rows on Races |
| `coach.upcomingRaceContext(race, plan, today)` | upcoming race + plan + today | `{coachLine}` | Upcoming rows on Races (replaces dead `synthesizeContextLine`) |
| `coach.prContext(pr, allPrs, currentVdot)` | one PR + all-time + current VDOT | `{coachLine}` | Profile + Log PR shelves |
| `coach.yearHighlightRead(kind, value, context)` | "biggest week" / "longest run" / etc | `{coachLine}` | Year-in-Running highlight tiles |
| `coach.yearShape(state)` | full-year activity rollup | `{coachLine}` | Log greet, Year-in-Running footer |
| `coach.cardStateRead(card, state)` (generalist) | card id + state | `{coachLine \| null}` | Fallback for any silent-reciter slot |

The generalist takes an enum of card IDs (e.g. `'overview.weekly_miles'`, `'overview.load_gauge'`, `'overview.vdot'`, `'profile.identity_lifetime'`, `'health.sleep_today'`, `'health.rhr_today'`, etc.). Returns one sentence keyed off the runner's actual current state, or `null` for "no take today."

### 20.2 Per-page slot fills

(Refer to §21 per-page checklists for the full enumeration of which card gets which read.)

---

## 21. Phase 4 — Per-page rewrites

The agent's per-page task list. One commit per page. Each row maps a surface to its action.

### 21.1 Overview (`app/overview/`)

| Card | Action |
|---|---|
| Greet eyebrow / tiles | Pass — stat tiles. Verify state-driven (not hardcoded). |
| Coach watching strip | Pass — already voice-shaped. |
| TodayCard hero | Pass — `composeVoiceLead` is gold. WHY line replaces trigger-restatement with real coach prose. |
| TodayCard KPI sub "DURATION CONVERSATIONAL" | State-aware; don't fire on intervals. |
| TodayCard KPI sub "PACE DANIELS E" | Say "EASY". |
| TodayCard HR cap row | Wire to real HRmax (after `runner_profiles` table lands) or drop the row. **No fake-precision fake personalization.** |
| TodayCard structure rows | Pull real structure from prescribed workout; drop generic "Warm-up · easy aerobic". |
| ReadinessCard signal bars hardcoded | W2 — wire to real signals or drop. |
| ReadinessCard message truncation | W2 — remove `.slice(0,40)`. |
| RaceCountdownCard headroom line | W9 — add coach prose. |
| RaceCountdownCard FINISH tiles FLOOR=GOAL=STRETCH | Bug — read three different values. |
| PathToRaceCard | Pass; translate `T-pace`. |
| NextPushCard | Pass; translate `T-pace`. |
| WeekStripCard rationale | W4 — replace with `coachNote.body`. |
| CoachThisWeekCard | §3.3 — strip "the engine"; delete debug foot. |
| TrajectoryCard rationale (number salad) | Replace with coach line. |
| PlanAdaptedCard | W4 + §3.3. |
| BodySystemsCard | W3. |
| PaceZonesCard `'92% EASY / 8% HARD ✓'` hardcoded | §2.2 — wire to real or drop. |
| PaceZonesCard `E/M/T/I/R` single letters | §3.4 — translate. |
| VdotCard `'FRESH'` pin | §2.2 — derive from recency or drop. |
| LoadGaugeCard `'SUSTAINABLE'` foot | §2.2 — derive or drop. |
| LoadGaugeCard generic bandLine | Make per-runner. |
| WeeklyMilesCard foot | §5.2 — add coach line via `cardStateRead`. |
| LongRunCard footRight `'—'` | §5.2 — add coach line. |
| UpNextBRaceCard `'TUNE-UP'` hardcoded | New method `bRaceClassification`. |
| YearInRunningCard highlights | `coach.yearHighlightRead`. |
| YtdCard projected EOY | `coach.cardStateRead`. |

### 21.2 Training (`app/training/`)

| Card | Action |
|---|---|
| TrainingGreet `'EASY · ABSORB'` hardcoded | Derive from real today + phase, or drop. |
| PlanIntegrityBanner | Pass — only on-voice surface today. Verify §-numbers stripped. |
| TodayCard (mirrors Overview) | Same as 21.1. |
| TodayCard HR row `145 = 130 + zone × 8` | Wire to real HRmax or drop. |
| TodayCard structure rows | Pull real structure. |
| TodayCard ACTIVE RECOVERY tiles hardcoded | State-aware via mode + recovery context. |
| TodayCard conditions tile | New method `dailyConditionsNote`. |
| GoalTrackingCard headline | Add coach prose row. |
| GoalTrackingCard FitnessCell sub | Add coach line. |
| Proof Sessions structures `"4 × 1MI @ T · 90s float"` | §3.4 — rewrite plain English. |
| Proof Sessions labels `"First T tempo"` | "First tempo at threshold pace." |
| ThisWeekCard rationale | W4. |
| HrZonesCard | §3.4 — translate; extend headline with prescription. |
| NextFourWeeksCard | Pass — `BlockCell.rationale` is voice-OK. |
| BuildCurveCard rationale | Coach line replacing number salad. |
| WorkoutDetailPopup | Pass after §3.2 cleanup. |

### 21.3 Races (`app/races/`)

| Card | Action |
|---|---|
| ARaceHeroCard empty | "macrocycle" → "season". |
| ARaceHeroCard FITNESS PREDICTS `"VDOT 50.4"` token | §3.4. |
| ARaceHeroCard HEADROOM tile | W9. |
| ARaceHeroCard BUILD STARTS tile | Wire to real trajectory. |
| UP NEXT B-race inset | New `bRaceClassification`. |
| LatestRecapCard COACH READ body | W10. |
| LatestRecapCard AVG HR `"Z3 STEADY"` | §3.4. |
| LatestRecapCard `"▲ AEROBIC PROVEN"` foot | §3.4. |
| LatestRecapCard place / conditions tiles | Drop until real (don't render empty). |
| SeasonTimelineCard | Add coach overlay via `yearHighlightRead` or new `seasonShape`. |
| UpcomingListCard "macrocycle" | §3.4. |
| Upcoming row sublines | New `upcomingRaceContext`. |
| Dead `synthesizeContextLine` | Delete (replaced by `upcomingRaceContext`). |
| Result row sublines | New `recentResultRead`. |
| `bodySystems` fetched but unrendered (race ≤14d) | W3. |

### 21.4 Health (`app/health/`)

| Card | Action |
|---|---|
| HealthGreet sub formulaic | `assessReadiness.message`. |
| Daily check-in sliders emoji | §3.1. |
| Daily check-in commit `"COACH IS USING…"` | §3.3. |
| Subjective Agreement labels | §3.3. |
| Subjective Agreement tieBreakerNote `(Saw 2016)` | §3.2. |
| ReadinessCompositeCard ring + bars | W2. |
| ReadinessCompositeCard signal labels jargon | §3.4. |
| BodySystemsCard | W3. |
| HrvDetailCard verdict pin | `cardStateRead` adds coach line. |
| HrvDetailCard `"CV 8% (Plews §5)"` | §3.2 + §3.4. |
| SleepCard | `cardStateRead`. |
| RhrCard `"Coach says: …"` | §3.3 + `cardStateRead`. |
| RhrCard label `RHR` | §3.4. |
| FormCard label `CTL/ATL/TSB` | §3.4 → `FITNESS vs FATIGUE`. |
| FormCard tiles | §3.4 — translate. |
| FormCard footer add runner-specific coach line | `cardStateRead`. |
| IllnessEarlyCompositeCard | `cardStateRead` when 3+ markers fire. |
| Vo2MaxCard `"TREND WINS · NOT ABS"` sub | Unpack. |
| BodyMassCard pin `'▼ DROP'` when warningTriggered | `cardStateRead`. |
| SubmaxHrDriftCard label | §3.4. |
| SubmaxHrDriftCard verdict panel | Pass — strong utterance. |
| CycleCard `loadAdjustmentRec` | New `coach.cycle()` once wired. |
| FerritinCard verdict line | Pass; tighten to single sentence. |

### 21.5 Log (`app/log/`)

| Card | Action |
|---|---|
| Greet stat stitch | New `yearShape` or `assessReadiness.message`. |
| Greet KPI quad | One coach line below row. |
| YearInRunningCard footer | `yearShape` replaces static legend. |
| MonthlyVolumeCard footer | Same. |
| PersonalBestsCard | `prContext` per PR. |
| RecentRunsCard rows | W1 — `runRead` per row; drop constant RPE column. |
| RecentRunsCard footer | Coach line on shape-of-week. |

### 21.6 Profile (`app/profile/`)

| Card | Action |
|---|---|
| IdentityHeroCard KPI quad | Coach line under EVEREST stat. |
| LifetimePrsCard `'▲ FITNESS PEAKING'` foot | §2.2 — derive or drop. |
| LifetimePrRow pins | `prContext` per PR. |
| PersonalGoalsCard header `'COACH READS THESE'` | §3.3. |
| PersonalGoalsCard goals fallback filler | §3.3 — blank instead. |
| PersonalGoalsCard ACTIVE pill | Derive from real status or drop. |
| VdotCard `'FRESH'` pin | Derive from race recency. |
| VdotCard detailLine | Extend with freshness + projection. |
| HrCard 5-zone table | Add coach line; drop `Z1..Z5` jargon. |
| TierCard `'CLIMBING'` pin | Derive from trend sign. |
| TierCard | Add coach line. |
| ConnectionsCard | Coach line on gaps. |
| ShoeRotationCard | Pass — voice-OK foot. |
| CoachEngineCard | W5. |
| Pace zones tile empty | W5. |
| Plan-integrity tile | Drop entirely until validator lands. |
| VO2max island | Pass — gold standard. |

### 21.7 Run Detail (`app/runs/[id]/`)

| Surface | Action |
|---|---|
| New CoachReadCard above splits | W1 + FORM read below splits. |
| Best Efforts PRs | `prContext` per chip. |
| Splits table | One coach line below reading splits ("Last three miles dropped 18 sec…") via `formRead`. |

---

## 22. Phase 5 — Engine-side fixes

Engine bugs that fake personalization or trip voice rules. Without these, even perfectly-wired UI renders lies.

### 22.1 `runRead` HRmax hardcoded 180

`web/coach/coach.ts:1984`. Read `state.profile.hrMax` (verify field path via `gatherCoachState`). If null, omit the `(% max)` clause. Don't fall back to 180.

### 22.2 `engineDetails().planIntegrity` always 12/12

`web/coach/coach.ts:1939-1942`. Either implement real validator or return null. **No always-passing validator.** Profile route's caution at `route.ts:1111-1118` is correct; engine should match.

### 22.3 `coach.fuelingFor()` heatNote raw "65°F" threshold

`web/coach/coach.ts:1136-1138`. Fold into main prose ("Heat's high — bumping carbs to 90 g/h") or move to citations.

### 22.4 `proofSessions` jargon structure

§3.4 fix at source (`coach.ts:1519-1564`). Plain-English `structure` strings, with shorthand on a sibling field if needed for watch JSON.

### 22.5 Self-referential framing in `engineDetails`

`coach.ts:1888-1929`. §3.3 — speak, don't describe the coach.

### 22.6 Citation parentheticals in body fields

`coach.ts:1808`, `plan-builder.ts:793, 795, 811-812, 816-818`. Strip.

### 22.7 `assessReadiness.message` length variants

Add `messageShort: string` (one sentence, ≤120 chars) to the return so UI picks without truncation. Drop all `.slice()` truncation site-side.

### 22.8 Add length variants to other engine returns

Per §9 cross-page consistency rule:

- `runRead` → `{verdict, oneLineSummary, fullBody, watchToken}`
- `formRead` → `{verdict, oneLineSummary, fullBody, watchToken}`
- `reflectOnRun` → `{verdict, oneLineSummary, fullBody}`
- `coachRead` → `{verdict, oneLineSummary, fullBody, watchToken}`
- `pathToRace.nextMove` → `{nextMoveShort, nextMoveFull}`
- `weekDeltas.coachNote` → `{headline, bodyShort, bodyFull}`

---

## 23. Phase 6 — Closed-loop wirings (the L-series)

The closed loop doesn't close today because predictions, trajectories, and plan mutations are stubs. These five work items close it.

### 23.1 L1 — `coach.raceFitnessPrediction()` real implementation

**Today:** `coach.ts:873` returns `goalTime × 0.98`. Stub.

**Build:**
- Read `state.runner.vdotSnapshot` (already exists in `lib/vdot.ts`)
- Apply Riegel + Daniels per `race_prediction.ts` doctrine (Research/02)
- Apply course/grade adjustments per `course.ts` (Research/11)
- Apply weather adjustment per `weather.ts` (Research/06) when forecast is within 7 days
- Return `{predictedFinishS, paceSPerMi, headroomSPerMi, confidence, rationale, rationaleShort}`

**Acceptance:** prediction changes when a new race result lands. Confidence drops to `low` if last race >16 weeks. Returns rationale in voice with proper hedging.

### 23.2 L2 — `coach.trajectory14wk()` real implementation

**Today:** `coach.ts:725` returns hardcoded `plannedSeries` array.

**Build:**
- Read goal race + distance + days-out + `state.volume.weeklyAvg8w` baseline
- Pull plan template per distance + experience tier from `plan_templates.ts` (Research/22)
- Project planned volume per week (base → build → peak → taper)
- Project actual volume from real `state.volume.weeklyHistory`
- Return `{plannedSeries, actualSeries, phaseBoundaries, peakWeek, peakMileage, cutbackWeeks}`

**Acceptance:** trajectory shape changes when goal race changes. Series anchored on the runner's actual baseline. Phase boundaries used downstream (BUILD STARTS tile on Races no longer hardcoded `return 14`).

### 23.3 L3 — `coach.adjustForReality()` Stage A

**Today:** `coach.ts:386` throws.

**Build:** Plan mutation engine — when state signals demand a plan shift, propose or execute per autonomy contract (§10):
- Missed quality session → move to next available day, soften following day
- Multi-day skip → cutback this week's volume by 30%
- ACWR spike → drop today's intensity by one zone
- Sleep debt cluster (3 nights <6h) → today's prescription drops to easy regardless of plan
- Recovery signal pattern (3+ flagged) → 50% volume + no quality for 3-5 days per `recovery_protocols.ts`

Returns `{adjustedPrescription, rationale, mode: 'unilateral'|'propose'|'notify', changes: PlanChange[]}`. Surfaces drive the PlanAdaptedCard.

**Acceptance:** PlanAdaptedCard renders real adaptations with real triggers and real rationales. The "Doctrine-grounded adaptations…" hardcoded copy goes away.

### 23.4 L4 — `coach.proposeGoalAdjustment(state)` new

**Build:** Fires when (predicted − goal) > X sec/mi for 2+ consecutive weekly checkpoints OR <-X sec/mi (behind goal).

Returns `{shouldPropose: boolean, currentGoal, proposedGoal, rationale, options: 'faster'|'slower'|'hold_with_buffer'}`. When `shouldPropose` is true, surfaces a `ProposalCard` on Overview.

**Acceptance:** When a runner's fitness has moved >15 sec/mi against goal for 2 consecutive weeks, a proposal appears. Runner accept → goal updates + all downstream reads recompute. Reject → no re-propose for ≥2 weeks unless signal strengthens.

### 23.5 L5 — `coach.afterPrescriptionRead(activity, recentPrescriptions)` new

**Build:** Triggered by activity ingest. Looks back at coach prescriptions within last 36h. Compares prescribed vs done across mileage, intensity, structure. Returns `{ackLine, complianceDelta, recommendationForNext}`.

**Acceptance:** When runner finishes a prescribed tempo, the next time the coach speaks (immediately on iOS post-run, Wed morning Overview, etc.) the prose acknowledges. "Tempo held the band" if it landed. "Threshold dropped to easy by rep 3 — under-recovered. Tomorrow's easy stays easy" if it didn't. Never silent on a prescription's outcome.

### 23.6 Closed-loop dependency

UI claims that depend on the loop being closed (predictions that shift, paths that update, plans that adapt) DO NOT SHIP until L1, L2, L3 land at minimum. Until then, dependent surfaces render `"calibrating"` empty states rather than fake-recalibrating. **Half-loop is worse than no loop.**

### 23.7 Cache architecture (also Phase 6)

Per §8. Build:
- `coach_reads` table or Redis schema
- `coach.computeAndCache(runnerId, readKind, key)` wrapper around all engine methods
- `coach.read(runnerId, readKind, key)` reader
- Computation triggers (activity ingest, 4am cron, plan mutation, race edit, check-in)

---

## 24. Phase 7 — New modalities (B1, B2, B5, S4 implementations)

### 24.1 ONBOARDING mode (B1)

**Engine:**
- `coach.onboardingStage(state) → OnboardingStage`
- `coach.onboardingNudges(stage, state) → {primary: string, secondary: string[], ctaLabel, ctaHref}`

**UI:**
- New `GetStartedCard` — top-of-Overview, replaces everything else in `cold_start`. Renders `onboardingNudges.primary` + CTA button.
- New `OnboardingNudgeStrip` — variant of WATCHING strip with onboarding copy
- Page-level conditionals: if `mode === 'onboarding'`, every other card collapses to its onboarding-variant empty state.

**Voice samples (per stage):**

| Stage | Coach voice |
|---|---|
| `cold_start` | "Welcome. The coach gets sharper with every run, race, and check-in you give it. Start with a recent race if you have one, or connect Strava — that's the fastest way to wake the system up." |
| `connected_no_data` | "Strava is connected. Once your first run lands here, fitness signals start lighting up. Go log a mile if you haven't yet today." |
| `data_no_goal` | "You've got two weeks of running in. Set an A-race in the Races tab and the path-to-race appears. Without a goal, this is just a logbook." |
| `data_with_goal_no_plan` | "AFC Half is locked. Generate a plan in /training and the daily card starts speaking — until then I don't know what to prescribe." |

**Acceptance:** Cold-start runner opens the app and gets a single GetStartedCard with a clear next action. App is never silent during onboarding. Exits to ACTIVE the moment all four conditions are met.

### 24.2 INJURY mode (B2)

**Engine:**
- `coach.injuryMode(state) → {active, protocol, currentStep, daysIntoProtocol, nextStep, coachLine}`

**State + DB:**
- `state.health.activeInjury: {site, severity, returnProtocol, startDate, expectedReturnDate}`
- `runner_injuries` table: id, runner_id, site, severity, return_protocol, start_date, expected_return_date, resolved_date

**UI:**
- New `InjuryLogModal` — body-diagram input (body-map exists in design brief), severity, when it started. Coach references `injury_return.ts` to pick protocol.
- New `ActiveInjuryBanner` — top-of-every-page banner when injury active. "Calf strain · day 3 of return protocol · expected back May 30."
- New `InjuryReturnProgressCard` — current step of protocol, days into, next milestone, coach prescription for today.
- TodayCard becomes return-protocol step or rest prescription.
- PathToRaceCard grays out with "paused" framing.

**Voice samples:**

> "Calf is barking. Day 1 of the return protocol: rest today, ice 20 minutes twice. Walk if you want, no running. Coming back early is how the next 8 weeks evaporate. We'll re-check tomorrow."

> "Day 7 of return-to-run. Today: 2 miles walk-jog, 1 minute jog / 1 minute walk × 10. If anything pinches, walk home — no debate. If it holds clean, day 9 we go 3 miles continuous easy."

**Acceptance:** Runner logs injury → mode shift → all pages render the InjuryBanner + protocol step. PathToRace pauses with explicit framing. Resolves on user resolve action OR 4 weeks with prompt.

### 24.3 ILLNESS mode (B2)

**Engine:**
- `coach.illnessMode(state) → {active, prescription, coachLine, raceImpact}`

**State + DB:**
- `state.health.activeIllness: {kind, severity, startDate}`
- `runner_illnesses` table

**UI:**
- New `IllnessLogBanner` — quick "sick today?" input → kind + severity.
- New `ActiveIllnessBanner` — top of every page when active.

**Voice samples:**

> "Head cold, above the neck, no fever — you can run, just not what's on the calendar. Cut today in half, ease the pace, see how you feel after a mile. If it gets worse, walk home."

> "Fever and chest congestion. Don't run. Sleep, fluids, real food. The fitness will hold; the immune system is the priority. Re-check in 48 hours."

**Acceptance:** Runner logs illness → mode shift → today becomes rest/easy per severity. Race impact surfaces if within 3 weeks of A-race. Auto-resolves after 14 days with "still sick?" prompt.

### 24.4 MULTI-RACE handling (B5)

**Engine:**
- `coach.raceConflict(state) → {hasConflict, races, recommendation, coachLine}`
- `coach.bRaceClassification(b, a, phase) → {role, coachLine}` (also in §20.1)

**UI:**
- New `RaceConflictBanner` — on Overview when 2+ A-races have overlapping build windows.
- `RaceConflictBanner` renders proposal + accept (sets primary) or reject (acknowledge and let both race).

**Voice samples:**

> "Two A-races inside an overlapping 12-week window — AFC Half on Aug 31 and CIM on Dec 7. Hard to peak twice that close. My read: AFC primary, CIM as the long-race-prep B effort. Want me to shape the plan around AFC?"

**Acceptance:** Setting 2+ A-races inside conflicting build windows surfaces the banner. Runner accepts → primary set, secondary downgraded to B-with-context. Reject → coach acknowledges the runner's call and adjusts plan to balance.

### 24.5 RACE-DAY mode (S4)

**Engine:**
- `coach.raceDayMode(state, today) → {active, raceId, hoursToStart, brief, paceStrategy, fueling, weather}`

**UI:**
- New `RaceDayCard` — Overview/Training collapse to this layout when mode active. Renders: brief at top, pace strategy, fueling plan, weather, single "GO RACE" CTA. Post-finish: flips to "log your race" → recap with `coachRead`.

**Voice samples (already in voice.md):**

> "Morning. The training is done. 78°F start — about 2.4% slowdown vs cool baseline. First three miles slower than you want, then lock in. Aid station every two miles, gels at 5 and 10. You don't need a hero day to hit your goal. You need an honest one."

**Acceptance:** Race-day arrival → all pages collapse to RaceDayCard. Post-finish → RaceDayCard flips to recap mode.

---

## 25. Phase 8 — Runner input surfaces (S1 implementation)

The other half of the closed loop. Inputs the coach can RESPOND to.

### 25.1 Daily check-in

**Already in design.** Needs DB wire-up.

- Table: `daily_checkins(runner_id, date, energy, soreness, stress, mood_tag, notes, created_at)`
- API: POST `/api/checkin/today`
- State: `state.checkins.last7d`
- Engine: `coach.respondToCheckin(state, checkin)` — may soften today's prescription, surface in REFLECTION
- UI: `DailyCheckinCard` on Health (exists in design). Banner nudge on Overview if not logged by mid-morning.

### 25.2 Post-run RPE + notes

- Table: `post_run_rpe(activity_id, rpe, notes, logged_at)`
- API: POST `/api/activity/{id}/rpe`
- UI: New `PostRunRpeSheet` — modal/sheet after run finishes (iOS) and Run Detail banner (web). Quick: tap a number, optional note, submit. Skippable.
- Engine: `coach.runRead` and `coach.formRead` accept `subjectiveRpe?` input. When present, incorporated into FORM read.

### 25.3 Skip reasons

- Table: `workout_skips(workout_id, reason, logged_at)`
- API: POST `/api/workout/{id}/skip`
- UI: New `SkipReasonModal` — triggered from TodayCard skip button OR end-of-day nudge ("you didn't log a run today — was it planned?").
- Engine: `coach.respondToSkip(state, skip)` — may move workout, soften next day, or CHALLENGE a pattern.

### 25.4 Free-text "talk to the coach"

- Table: `runner_notes(id, runner_id, text, created_at, kind)`
- API: POST `/api/coach/note`
- UI: New `TalkToCoachSheet` — accessible from Health page (and a top-bar affordance). Textarea + recent coach responses visible.
- Engine: `coach.respondToNote(state, note)` — acknowledges, may trigger injury/illness logging flow, may trigger re-plan proposal.

### 25.5 Coach proposals (accept/reject)

- Table: `coach_proposals(id, runner_id, type, payload, status: 'pending'|'accepted'|'rejected', responded_at)`
- API: POST `/api/coach/proposal/{id}/respond`
- UI: New `ProposalCard` — on Overview when `state.coachProposals.pending.length > 0`. Renders proposal + reasoning + accept/reject buttons.
- Engine: Each `coach.<method>()` that proposes (e.g. `proposeGoalAdjustment`, `raceConflict`, `injuryReturnGraduation`) writes a `coach_proposals` row. Acceptance triggers downstream recompute.

### 25.6 Coach awareness of recent inputs

`gatherCoachState` propagates all of the above so every read can reference them:

- "You flagged poor energy in the last 3 check-ins" surfaces in TodayCard rationale (via `coach.respondToCheckin`)
- "Calf note from yesterday" surfaces as a guard in PRESCRIPTION
- Skip reason surfaces in REFLECTION ("third missed easy this week — said scheduling, but it's a pattern")

---

## 26. Phase 9 — Strengthen-but-not-blockers (S2, S3, S5, C3)

### 26.1 Tone register (C3) — covered in §11

Add `tone: Tone` to every engine method. Voice templates have tone variants. `coach.selectTone(state, ctx)` returns the register.

### 26.2 Confidence calibration (S2) — covered in §12

Add `confidence: 'high'|'medium'|'low'` to every engine read. Voice templates hedge accordingly. UI applies visual hint (dashed underline / `~` prefix).

### 26.3 Non-running coverage (S3) — covered in §15

- New tables: `strength_sessions`, `cross_training_sessions`. `recovery_sessions` exists; verify.
- New state: `state.crossTraining.last14d`, `state.recovery.modalities7d`, `state.strength.last14d`
- New UI: `LogStrengthCard`, `LogCrossTrainingCard`, verify `LogRecoveryModalityCard`
- New engine: `coach.strengthRead`, `coach.recoveryRead`, `coach.crossTrainingCredit`

### 26.4 Autonomy contract (S5) — covered in §10

- `CoachAction` type with `mode: 'unilateral'|'propose'|'notify'`
- `coach_actions` table
- Renders into PlanAdaptedCard (unilateral), ProposalCard (propose), COACH-WATCHING strip + daily digest (notify)

---

# Part IV · UI surfaces, DB tables, state fields, engine signatures

---

## 27. New UI surfaces catalog

Every new component the agent will build. Locations are `web/app/components/` unless noted.

| # | Component | Page | Trigger | Purpose |
|---|---|---|---|---|
| U1 | `GetStartedCard` | Overview | `mode === 'onboarding' && stage === 'cold_start'` | Cold-start welcome + CTA |
| U2 | `OnboardingNudgeStrip` | All pages | `mode === 'onboarding'` | Stage-specific nudge in WATCHING-strip slot |
| U3 | `CoachReadCard` | Run Detail | Always (with prose from `runRead`) | Renders REFLECTION + FORM above splits |
| U4 | `PostRunRpeSheet` | iOS post-run + web Run Detail banner | After run ingest, before RPE logged | Quick 1–10 RPE + note input |
| U5 | `SkipReasonModal` | TodayCard skip button + end-of-day nudge | Tap skip OR EOD with no run | Reason chips + free text |
| U6 | `TalkToCoachSheet` | Health + top-bar | Tap affordance | Free-text journal to coach |
| U7 | `ProposalCard` | Overview | `pending proposals exist` | Render coach proposal + accept/reject |
| U8 | `InjuryLogModal` | Health + top-bar | Tap "report injury" | Body-diagram + severity input |
| U9 | `ActiveInjuryBanner` | All pages | `mode === 'injury'` | Top-bar banner |
| U10 | `InjuryReturnProgressCard` | Today (replaces TodayCard) + Health | `mode === 'injury'` | Current return-protocol step |
| U11 | `IllnessLogBanner` | Health + top-bar | Tap "report illness" | Kind + severity input |
| U12 | `ActiveIllnessBanner` | All pages | `mode === 'illness'` | Top-bar banner |
| U13 | `RaceConflictBanner` | Overview | `raceConflict.hasConflict` | Conflict + propose primary |
| U14 | `MaintenanceModeCard` | Overview (replaces RaceCountdownCard) | `mode === 'maintenance'` | "No A-race set — set one when you're ready" |
| U15 | `RaceDayCard` | Overview + Training | `mode === 'race-day'` | Brief + pace strategy + fueling + GO CTA |
| U16 | `LogStrengthCard` | Profile + top-bar quick-log | Tap "log strength" | Type + duration + notes |
| U17 | `LogCrossTrainingCard` | Profile + top-bar quick-log | Tap "log cross training" | Modality + duration + intensity |
| U18 | `DailyCheckinCard` | Health | Always on Health (already in design) | Energy / soreness / stress sliders, no emoji |
| U19 | `CoachReadFreshnessChip` | COACH-WATCHING strip | Always | "computed Xmin ago" timestamp |
| U20 | `ConfidenceVisualMarker` | Any stat with confidence | Always | Dashed underline or `~` prefix per confidence level |
| U21 | `WatchPostRunSummary` | Apple Watch face | Run finish | Numbers + 1–2-word verdict chip + audio/haptic (no prose) |

---

## 28. New DB tables

| Table | Purpose | Columns |
|---|---|---|
| `users` / `runner_profiles` | Identity + biometric anchors | `id, name, age, sex, hr_max, rhr, weight, units, created_at` |
| `user_prefs` | Training preferences | `runner_id, long_run_day, quality_days[], rest_day, plan_aggressiveness` |
| `personal_goals` | Goals coach reads | `id, runner_id, type, current, target, deadline, rationale, status` |
| `daily_checkins` | Mood/energy/soreness/stress | `runner_id, date, energy, soreness, stress, mood_tag, notes` |
| `post_run_rpe` | Subjective effort per run | `activity_id, rpe, notes, logged_at` |
| `workout_skips` | Skip reasons | `workout_id, reason, logged_at` |
| `runner_notes` | Free-text journal | `id, runner_id, text, kind, created_at` |
| `coach_proposals` | Pending coach proposals | `id, runner_id, type, payload, status, created_at, responded_at` |
| `coach_actions` | Audit log of coach modifications | `id, runner_id, action_type, mode, payload, created_at` |
| `runner_injuries` | Active injuries | `id, runner_id, site, severity, return_protocol, start_date, expected_return_date, resolved_date` |
| `runner_illnesses` | Active illnesses | `id, runner_id, kind, severity, start_date, resolved_date` |
| `strength_sessions` | Strength logs | `id, runner_id, date, type, duration_min, notes` |
| `cross_training_sessions` | Cross-training logs | `id, runner_id, date, modality, duration_min, intensity, notes` |
| `coach_reads_cache` | Computed read cache | `runner_id, read_kind, key, content (jsonb), computed_at, ttl_at, recompute_after, source_state_hash` |

`recovery_sessions` exists; verify schema and propagation.

---

## 29. New state fields on `CoachState`

(`gatherCoachState` must populate these before the coach can read them.)

```ts
type CoachState = {
  // existing...
  runner: {
    profile: {
      hrMax: number | null,
      rhr: number | null,
      age: number | null,
      sex: 'M'|'F'|'NB' | null,
      weight: number | null,
      units: 'imperial'|'metric',
    },
    prefs: {
      longRunDay: Weekday | null,
      qualityDays: Weekday[],
      restDay: Weekday | null,
      planAggressiveness: 'conservative'|'standard'|'aggressive',
    },
    goals: PersonalGoal[],
  },
  onboardingStage: 'cold_start' | 'connected_no_data' | 'data_no_goal' | 'data_with_goal_no_plan' | 'active',
  mode: CoachMode, // computed from state.activeMode
  health: {
    activeInjury: ActiveInjury | null,
    activeIllness: ActiveIllness | null,
  },
  checkins: {
    today: CheckIn | null,
    last7d: CheckIn[],
  },
  notes: {
    recent: RunnerNote[],
  },
  coachProposals: {
    pending: CoachProposal[],
  },
  recovery: {
    // existing fields
    modalities7d: RecoverySession[],
  },
  strength: {
    last14d: StrengthSession[],
  },
  crossTraining: {
    last14d: CrossTrainingSession[],
  },
  vdotSnapshot: VdotSnapshot, // from lib/vdot.ts — promote into state
}
```

---

## 30. Engine method signatures (the canonical list)

```ts
// MODE
coach.activeMode(state, today): CoachMode
coach.onboardingStage(state): OnboardingStage
coach.onboardingNudges(stage, state): {primary, secondary[], ctaLabel, ctaHref}
coach.injuryMode(state): {active, protocol, currentStep, daysIntoProtocol, nextStep, coachLine}
coach.illnessMode(state): {active, prescription, coachLine, raceImpact}
coach.raceDayMode(state, today): {active, raceId, hoursToStart, brief, paceStrategy, fueling, weather}
coach.raceConflict(state): {hasConflict, races, recommendation, coachLine}

// READS — DIAGNOSIS
coach.assessReadiness(input): CoachDecision<{level, message, messageShort, signals, confidence, tone}>
coach.bodySystems(input): CoachDecision<{contextLabel, rationale, systems[], qualityReturnsISO, confidence, tone}>
coach.engineDetails(state): CoachDecision<{tiles[], planIntegrity?, confidence, tone}>

// READS — PRESCRIPTION
coach.prescribeWorkout(input): CoachDecision<{label, structure, paceTarget, hrZone, distanceMi, voiceLead, tone}>
coach.composeVoiceLead(ctx): string (already returns full prose)
coach.taperDepth(input): CoachDecision<{depthPct, rationale, tone}>
coach.briefRaceMorning(input): CoachDecision<{brief, tone}>
coach.paceStrategy(input): CoachDecision<{rationale, perSegmentPaces, tone}>
coach.fuelingFor(input): CoachDecision<{plan, notes, tone}>
coach.adjustForReality(input): CoachDecision<{adjustedPrescription, rationale, mode, changes[], tone}>
coach.dailyConditionsNote(state, weather, workout): {coachNote, hrCap, hrCapReason, tone}

// READS — PROJECTION
coach.pathToRace(input): CoachDecision<{nextMoveShort, nextMoveFull, gap, headroom, tone}>
coach.raceFitnessPrediction(input): CoachDecision<{predictedFinishS, paceSPerMi, headroomSPerMi, rationale, rationaleShort, confidence, tone}>
coach.trajectory14wk(input): CoachDecision<{plannedSeries, actualSeries, phaseBoundaries, peakWeek, peakMileage, cutbackWeeks, rationale, tone}>
coach.proofSessions(state): CoachDecision<{sessions[], latestCompleted, rationale, tone}>
coach.weekDeltas(input): CoachDecision<{rationale, coachNote: {headline, bodyShort, bodyFull}, planned[], actual[], tone}>
coach.proposeGoalAdjustment(state): CoachDecision<{shouldPropose, currentGoal, proposedGoal, rationale, options, tone}>
coach.bRaceClassification(b, a, phase): {role, coachLine, tone}

// READS — REFLECTION
coach.runRead(input): CoachDecision<{verdict, oneLineSummary, fullBody, watchToken, unlockPin?, deltas[], confidence, tone}>
coach.coachRead(input): CoachDecision<{verdict, oneLineSummary, fullBody, watchToken, confidence, tone}>
coach.reflectOnRun(activity): {verdict, oneLineSummary, fullBody, tone}
coach.reflectOnPattern(state, kind): {coachLine | null, tone}
coach.reflectOnMilestone(state): {coachLine | null, tone}
coach.afterPrescriptionRead(activity, recentPrescriptions): {ackLine, complianceDelta, recommendationForNext, tone}
coach.recentResultRead(result, plan): {coachLine, tone}
coach.upcomingRaceContext(race, plan, today): {coachLine, tone}
coach.prContext(pr, allPrs, currentVdot): {coachLine, tone}
coach.yearHighlightRead(kind, value, context): {coachLine | null, tone}
coach.yearShape(state): {coachLine, tone}
coach.respondToCheckin(state, checkin): {coachLine, planAdjustment?, tone}
coach.respondToNote(state, note): {coachLine, action?, tone}
coach.respondToSkip(state, skip): {coachLine, planAdjustment?, tone}
coach.strengthRead(state): {coachLine, lastSession, prescription, gapDays, tone}
coach.recoveryRead(state): {coachLine, modalitiesLast7d, creditTotalMinutes, tone}

// READS — CHALLENGE
coach.nextPushes(state): CoachDecision<{pushes[], rationale, tone}>

// READS — FORM
coach.formRead(activity, state): {verdict, oneLineSummary, fullBody, watchToken, sections[], confidence, tone}
coach.classifyClimb(grade, distMi): {category, label, coachNote, tone}

// CROSS-CUTTING
coach.selectTone(state, ctx): Tone
coach.cardStateRead(card, state): {coachLine | null, tone}

// INFRASTRUCTURE
coach.computeAndCache(runnerId, readKind, key, args): CachedRead
coach.read(runnerId, readKind, key): CachedRead | null
coach.invalidate(runnerId, readKinds[]): void
```

Every `CoachDecision<T>` carries `{answer: T, rationale, citations[], tone, confidence}`. The `T` type has the surface-relevant fields.

---

# Part V · Operations

---

## 31. Order of phases

Strict ordering for risk control. Some phases ship in parallel; some block others.

```
Phase 1 (voice cleanup) ───────────┐
                                   ├── ship in parallel
Phase 5 (engine bug fixes) ────────┘   (no overlapping files)

Phase 2 (W1-W5 wirings) ────────── after Phase 1 + 5

Phase 3 (silent reciter fills) ─── after Phase 2 partial — fill as engine methods land

Phase 4 (per-page rewrites) ────── after Phase 1, 2, 3 partial

Phase 6 (closed-loop L1-L5 + cache) ── independent workstream, parallel to 1-4
  ├── L1 raceFitnessPrediction
  ├── L2 trajectory14wk
  ├── L3 adjustForReality (largest)
  ├── L4 proposeGoalAdjustment (depends on L1)
  ├── L5 afterPrescriptionRead (depends on cache)
  └── Cache architecture (cross-cutting; deploy with L1 ready)

Phase 7 (modalities) ── after Phase 6 cache lands
  ├── ONBOARDING (B1)
  ├── INJURY (B2)
  ├── ILLNESS (B2)
  ├── MULTI-RACE (B5)
  └── RACE-DAY (S4)

Phase 8 (runner inputs) ── after Phase 6 cache + DB tables
  ├── Check-in wire-up
  ├── Post-run RPE
  ├── Skip reasons
  ├── Free-text notes
  └── Proposal accept/reject

Phase 9 (tone, confidence, non-running, autonomy) ── overlay on all of the above
```

Each phase is multiple commits. One commit per page in Phase 4; one commit per L-item in Phase 6; one commit per modality in Phase 7. **Always push to main after every commit.**

---

## 32. Acceptance criteria

### Per phase

- **Phase 1:** greps in §18.5 return zero hits in user-facing prose.
- **Phase 2:** W1–W5 wirings in place. Log feed, Run Detail, Health composite ring, Body Systems cards (3 pages), WeekStripCard, PlanAdaptedCard, Profile Coach Engine all render engine voice. Bypass synthesizers deleted.
- **Phase 3:** Every card in §21 has a coach line wired OR has the slot deliberately deleted. **Zero hardcoded coach-shaped constants** in the codebase.
- **Phase 4:** Per §21 row checked off, page by page.
- **Phase 5:** Engine bugs gone — `runRead` no longer uses 180; `engineDetails` no longer fakes 12/12; citations no longer in body prose anywhere in `coach/`.
- **Phase 6:** Cache reads land. L1–L3 ship real implementations. Closed-loop UI claims render with real data, not fake. L4/L5 add proposal + acknowledgment.
- **Phase 7:** Each mode triggers correctly. Onboarding renders GetStartedCard. Injury logs render banner + protocol. Illness same. Race conflict surfaces. Race day collapses pages.
- **Phase 8:** Every input table populates from UI. Each input surfaces in coach reads downstream.
- **Phase 9:** Tone selection happens per-utterance. Confidence applied. Non-running surfaces. Autonomy contract honored.

### Per-utterance acceptance (the five-question test)

Pick any coach-shaped string in the rendered app:

1. **Does it speak as the coach (not about the coach)?**
2. **Plain English, no untranslated jargon?**
3. **Contextualize, prescribe, or motivate — not just recite a bin?**
4. **Could a runner read it and know what to do or what to think?**
5. **Does it show awareness of what came before?** (For prescribed-action follow-ups — closed loop.)

Fail any → fix or delete.

### The stranger test

A runner who isn't David screenshots any page, sends to a coach who didn't build the app, the coach reads it. Reaction should be "yes, that's what I'd say" — not "what does Z3 mean," "why does it talk about itself in third person," "what is 12/12 rules," "the body says nothing about my actual run."

### The closed-loop test

Runner does a coach-prescribed workout. The next time the coach speaks (immediately on iOS post-run, evening on web Run Detail, Wed morning on Overview):

1. The prose acknowledges what was done relative to what was prescribed
2. Affected predictions reflect the new fitness
3. Affected trajectory updates
4. If a goal threshold was crossed, a proposal surfaces

If any of these fails, the loop isn't closed.

---

## 33. iOS + Apple Watch propagation

**iOS Today shells:** consume `oneLineSummary` and `verdict` variants of coach reads. Engine fixes propagate automatically; UI passes are a separate audit after web lands.

**Apple Watch:** strictly stat-only per design brief. Watch consumes `watchToken` (1–2 word) only. No prose. Audio cues + haptics carry meaningful moments. Run-finish screen: numbers + token + audio/haptic. **A separate audit confirms no prose leaks onto watch faces.**

**faff watch app upload pipeline:** Phase 6 cache wraps the ingest. When the watch app uploads an activity, the same `computeAndCache` path fires that Strava ingest uses. Activity-source-agnostic by design.

---

## 34. Out of scope (this rewrite)

- iOS UI rewrite (post-web)
- Watch face redesign (post-web)
- Stage R (`retrospect`) implementation — pending; render `coachRead.body` as interim
- HealthKit M2 ingestion — Health card empty states stay until HealthKit lands
- Brand color / accent system
- Race CRUD / Strava sync DB schema changes beyond what runner-input tables require
- LLM model migration

---

## 35. The principle

**The coach is a character with a philosophy, six jobs, a relevance filter, a closed loop, and modal awareness. The engine writes in voice; the UI either surfaces it or stays silent — never recites. Inputs come from many sources; reads come from one place; the cache holds the truth. When the coach prescribes, the loop closes. When fitness moves, the goal renegotiates. When something hurts, the coach pivots. When there's nothing real to say, the coach says nothing. That's the whole thing.**

---

*End of spec. The rewrite agent reads this top to bottom before touching code. Memory pointers: [project-coach-voice-rewrite.md](memory/project_coach_voice_rewrite.md), [coach-build-plan.md](memory/coach_build_plan.md), [feedback-engine-match-research.md](memory/feedback_engine_match_research.md). Companion: [docs/COACH_BUILD_PLAN.md](docs/COACH_BUILD_PLAN.md), [docs/COACH_WIRING_AUDIT.md](docs/COACH_WIRING_AUDIT.md). Voice doctrine binding: [web/coach/voice.md](web/coach/voice.md).*
