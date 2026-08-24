# Heat and dewpoint on the wrist — a decision document

Proposal only; nothing here is implemented. Every claim about the current build
cites `file:line`; every physiological claim quotes
`Research/06-weather-adjustments.md`.

## Recommendation

**Adjust `targetPaceSPerMi` on the server, in `build-workout.ts`, before the
payload is built. Never `tolerancePaceSPerMi`. Never on the watch. Never
mid-run. Say it once, in the lobby's `note` register, and say nothing at all on
a running face.**

Four parts:

1. Call the existing shared model (`effortSlowdownPct`,
   `web-v2/lib/training/heat-model.ts:256`) once per payload against the day's
   forecast for the runner's home point, and shift every phase's target by the
   returned percentage.
2. Leave tolerance alone. `Research/06` says nothing about band width, so any
   widening would be an invented constant.
3. Above doctrine's time-on-feet threshold, emit **no target at all** rather than
   a slow one. The payload supports this and the watch draws it correctly
   (`WatchRouterV5.swift:909-912`).
4. Skip the path entirely when `isRace`. Race pace is priced elsewhere, and
   pricing it twice is a bug this codebase has already shipped once.

## 1 · What exists today

**The model is complete and correct.** `heat-model.ts` holds the Research/06 §1
Maughan table verbatim (`heat-model.ts:56-71`), the §12 dewpoint surcharge
(`:123-126`), the §3 solar bump (`:175-184`), the §2 interval halving (`:214`),
and one entry point composing them, `heatEffort` (`:236-249`);
`heat-adjustment.ts:57-77` wraps it as `applyHeatToPace`. Five surfaces consume
it: `lib/race/execution-plan.ts:441`, `lib/training/race-conditions.ts:222`,
`lib/coach/weather-adjust.ts:149`, `lib/plan/drift-monitor.ts:652`,
`lib/race/representativeness.ts:930`.

**None of it reaches the watch.** `lib/watch/build-workout.ts` imports nothing
from `lib/weather` or `lib/training/heat-model`. Phase targets come from the
plan's authored `workout_spec` bands, parsed as strings (`:315-332`) and written
at plan-generation time, weeks before the run. Both places the file mentions
temperature pass null on purpose: `tempF: null` at `:1684`, and `tempF: null, //
forecast wiring is the weather-cron fix's job (M-15)` at `:1739`. So
`WatchFueling.heatAdjusted` (`WatchWorkoutModels.swift:1173`) is decoded by the
watch and is always `false`.

The wire has no weather field: `WatchWorkout`'s `CodingKeys`
(`WatchWorkoutModels.swift:364-369`) and `WatchPhase`'s (`:232-235`) carry none,
and the completion payload refuses to send one back — *"NOT carried:
temperature. Nothing here has a thermometer"* (`:1011-1015`).

One heat signal reaches the wrist indirectly. `detectHeatBail`
(`lib/plan/adapt.ts:2833-2889`) runs the §3 WBGT gate against today's forecast
and proposes a plan change — but only at `easy_time_on_feet` or `cancel`
(`:2863`), i.e. red/black flag. If applied, the reason surfaces on the lobby via
`loadSessionMoved` (`build-workout.ts:1041-1079`). An ordinary warm morning
produces nothing.

**Also found, out of scope here:** `app/api/today/purpose/route.ts:169-170`
carries `~1 bpm per 2°F over 65°F baseline` attributed to `Research/06 §heat`.
Research/06 has no bpm rate anywhere (its only bpm figures are the §4 acclimation
table's *reductions*) and no section named "heat". Same fabrication class that
`heat-adjustment.ts:100-113` documents removing from `weatherContext`. Needs its
own fix.

## 2 · Where the adjustment belongs

### Rejected — computed on the watch

Apple Watch has no ambient thermometer. Any watch-side number would be inferred
from HR against pace — a *response*, not a condition — and would move a
prescribed band from the runner's own physiology mid-run. The codebase already
ruled on the principle in the completion payload
(`WatchWorkoutModels.swift:1011-1015`): sending a modelled temperature from the
wrist *"would launder a model into a reading."*

### Rejected — a separate factor the watch applies

Four independent call sites read `targetPaceSPerMi`/`tolerancePaceSPerMi` and
each would need the factor applied identically: the live band strip
(`WatchRouterV5.swift:909-919`), the phase-change moment's band string
(`:887-894`, drawn at `:963`), the lobby band register (`:1247-1266`), and the
grader (`PaceDrift.swift:66`). That is exactly the shape `heat-model.ts:11-32`
was written to end. Worse, watch decoders are deliberately lenient — an unknown
key is ignored, not an error (`WatchWorkoutModels.swift:242-246`) — so a
deployed watch predating the field would grade against the **unadjusted** band
while the lobby claimed it was adjusted. Silent from both sides.

### Recommended — the phone, at payload-build time

The stale-session objection is smaller than it looks. When the watch app opens
it sends `{"request": "today"}` (`PhoneSync.swift:219-225`) and the phone
**re-fetches `/api/watch/today` live** in the reply handler
(`WatchSync.swift:602-608`); the same happens on phone foreground
(`FaffApp.swift:190`) and on reachability change (`WatchSync.swift:572-574`).
`buildWatchToday` runs per request, so the normal case is minutes old. The
pushed-context copy is bounded at 14 hours by `expiresAt`
(`build-workout.ts:1439-1442`), past which the poster already draws
`"N DAYS OLD"` (`WatchRouterV5.swift:1276-1281`).

**What it costs.** The band is a forecast, not a measurement; conditions that
change over a two-hour long run are not tracked; and a runner starting with the
phone out of range may be on a forecast up to 14 hours old. All acceptable
against the alternative, which is a band wrong by the *whole* slowdown rather
than by the forecast error.

## 3 · What the runner sees

**On a running face: nothing.** FACE-QC rule 5 forbids labels outright; rule 13
reserves colour for coaching state. The band itself is the disclosure — rule 7:
*"A graded metric needs its band … the lit segment is the target."* The eased
band **is** the eased ask, drawn where the runner already looks. A word naming
heat would cost type size on all four rows (rule 3) and say something the runner
cannot act on, because the correction is already made.

**No in-run moment either.** Every moment in `IN-RUN-CUES.md`'s table earns its
place by being un-inferable from the board underneath; this one is inferable,
the band is on screen. A heat cue at second zero would also land on top of `.go`
(`WatchRouterV5.swift:959-960`).

**In the lobby: one sentence, in `note`.** `V5LobbySession.note`
(`FacesLobbyV5.swift:128-130`) is *"the coach's one sentence. Used where the
session has already changed and the reason is stated once."* An eased band is a
session that has already changed. Precedence: `sessionMoved` wins when present
(larger change, and on a black-flag day it already says "heat"); heat takes the
register otherwise. Two lines would be two registers answering one question.

**Wording.** The temperature is a forecast for a grid square and an hour bucket,
so the copy says `Forecast`, per the standing rule that a modelled number is
never presented as measured:

> `Forecast 76°F, dewpoint 66. Band eased 11 s/mi.`

Coach voice, no hype, states the two inputs and the one consequence. When the
adjustment is immaterial the line is absent entirely; a lobby that says "eased 0
s/mi" is worse than silence. When the target is dropped for time-on-feet:

> `Forecast 84°F, dewpoint 72. Run this by effort.`

**Not red.** FACE-QC rule 13: *"red names a sensor in words and never a figure."*
Heat is not a sensor reading on this device and this is not a fault. Neutral.

## 4 · The constants

Every number below already exists in the engine and is bound in
`lib/doctrine/registry.ts`. **The proposal introduces no new physiological
constant** — only a new *binding site*, the watch payload, for which Rule 7 asks
two new claims (below).

| # | Constant | Where it lives | `Research/06` passage, quoted |
|---|---|---|---|
| 1 | Slowdown by air temperature and ability | `heat-model.ts:56-71` | `\| Tair (°F) \| Tair (°C) \| Elite slowdown \| 3:30 marathoner \| 4:30+ marathoner \|` — §1. Read at run time by `HEAT.maughan-slowdown-table` (`registry.ts:4058-4090`), which parses the doc's own rows and column headings. |
| 2 | Dewpoint surcharge | `heat-model.ts:123-126` | `and +1% per 10°F dewpoint above 60°F` — §12. Parsed, not restated, by `HEAT.dewpoint-surcharge` (`registry.ts:3999-4021`). |
| 3 | Repeats take half | `heat-model.ts:214` | `For repeats with ≥1:1 work:rest, apply **half** the continuous-run adjustment` — §2. Bound by `HEAT.interval-adjustment-is-half` (`registry.ts:4022-4042`). |
| 4 | Materiality gate | `lib/race/representativeness.ts:282-283` | `Apply Td/Tair table whenever (Tair + Td) > 110°F or Td > 60°F` — §11. Already bound (`registry.ts:5562-5563`). |
| 5 | Drop the pace target | `lib/coach/heat-gate.ts:118` | `\| Td ≥70°F \| Quality sessions: time-based, RPE-driven \|` — §11 "When to convert to time-on-feet". |
| 6 | Solar bump | `heat-model.ts:175-184` | `solar_correction: full_sun = +5°F, partial = +2°F, overcast = 0°F` — §3. |

**The tolerance band: the research is silent.** Nothing in `Research/06` states a
band width, a tolerance, or how tightly a runner should be held in heat. So
tolerance does not move — the whole band shifts, its width unchanged. Widening it
would invent a physiological constant, the defect Rule 7 exists to catch.

**Not proposed, though doctrine supports it:** §10's *"Pace early miles 5–10
s/mi slower than total adjusted pace; reassess at 5K and 10K"* is a race-pacing
strategy, and `buildRacePacing` (`build-workout.ts:1540-1556`) already owns
per-phase race targets. Folding it in would put two authors on one number.

**Proposed registry claims** (format per Rule 7 — one single-line quoted `id:`,
`doc:` and `anchor:`):

- `WATCH.heat-band-halves-for-repeats` — binds the payload's use of
  `intervalStyle`, anchored on §2's halving sentence. `build-workout.ts` already
  computes `sessionClass` (`:1256-1259`); the claim asserts `interval`/`threshold`
  pass `intervalStyle: true` and easy/long do not. Otherwise the flag is a
  boolean nobody watches — exactly the half-remembered pre-processing step
  `heat-model.ts:14-27` catalogues.
- `WATCH.heat-drops-target-at-doctrine-dewpoint` — binds the no-target branch,
  anchored on §11's `Td ≥70°F` row, reading the threshold out of the doc's table
  rather than restating 70.

## 5 · What could go wrong

**A treadmill run graded against an outdoor band.** The phone cannot know the run
will be indoors; `isTreadmill` comes from `tracker.distanceSourceUnavailable`
and only after the start (`WatchRouterV5.swift:314`). **This bug already exists,
unadjusted.** The router suppresses the band *strip* on a treadmill (`:692`),
but `bandParts` (`:887-894`) still draws the band string at every phase-change
moment and `PaceDrift` still grades the same target (`PaceDrift.swift:66`) —
neither checks `isTreadmill`. Heat adjustment makes an existing wrongness worse
by 2-8%. **Prerequisite:** extend the treadmill suppression to `bandParts` and
the grader before shipping any heat shift.

**A race band that disagrees with the runner's own goal.** On `isRace` the lobby
draws `Goal 3:29:59` and the pace beneath it (`WatchRouterV5.swift:1342-1345`)
from `raceGoalSec` (`build-workout.ts:1591`), while `/api/v5/race/[slug]`
already shows a heat-adjusted target via `computeRaceConditions`
(`lib/training/race-conditions.ts:222`) and the execution plan prices heat again
(`lib/race/execution-plan.ts:441`). Adjusting the watch band too is the
6.4%-versus-9.35% split `heat-model.ts:23-27` records. **`isRace` must
short-circuit the heat path entirely.**

**A stale forecast.** Bounded at 14 hours by `expiresAt`
(`build-workout.ts:1439-1442`), usually seconds old via the live re-fetch
(`WatchSync.swift:602-608`). Residual case: phone unreachable at the trailhead
with an evening context push. The lobby's `ageLabel` already says the plan is
old; the heat line carries the same honesty by naming the forecast.

**A band that moves mid-run.** It must not, and nothing here lets it. The engine
walks a fixed phase array; do not add a recompute. Conditions deteriorating past
a bail threshold mid-run is the `rules` path (`WatchWorkoutModels.swift:86-125`),
which asks rather than silently re-scoring.

**A silent double-count.** `prescriptionFor` applies `applyHeatToPace` itself
when `p.weather.tempF` is set (`lib/training/prescriptions.ts:202-216`).
`build-workout.ts:1249-1254` passes no `weather` today — but if anyone adds one,
the band gets the slowdown twice. Apply the shift at exactly one place in the
file, after all phase-building branches, and assert that.

**A silent no-op.** If `resolveHomeLatLng` returns null (no GPS runs yet) or the
Open-Meteo call fails, everything degrades to the unadjusted band. Correct — but
the lobby line must then be absent, not "eased 0 s/mi", and the payload must not
claim `heatAdjusted: true`.

## Decisions (David, 2026-08-24)

**1 · Current temperature, or the feature does not get built.** Not the day's
peak, not a morning forecast for an evening run. This is a hard gate, and it is
achievable: Open-Meteo's forecast endpoint serves a `current=` block alongside
the `hourly=` this codebase already requests (`lib/weather/openmeteo.ts:126`),
and the watch payload is not stale the way the proposal assumed — the watch asks
the phone for today at launch and the phone re-fetches live before replying, so
a payload built at that moment carries conditions minutes old. The work is to
request current conditions in `build-workout.ts`, which fetches no weather at
all today. If that ever degrades to a forecast, the adjustment must be dropped
rather than quietly served stale.

**2 · The eased band goes back to the phone.** Wrist and phone say the same
prescribed pace. A runner who checks the phone before leaving and the watch on
the road must not be given two different numbers for the same session — the
wrist is the one being obeyed, so the phone follows it.

**3 · The completed run is judged against the EASED band.** The band the runner
was asked to hold is the band they are graded against. The recap must therefore
stop pricing heat a second time (`lib/coach/run-recap.ts:466`) — forgiving an
eased execution against an eased band and then forgiving it again is the
double-pricing this document already names, and it would let a hot run read
better than the same effort in the cold.

**4 · `WatchFueling.heatAdjusted` is wired in the same pass.** It is on the
wire, decoded, and has been permanently `false` since it shipped for exactly
the same reason the band is unadjusted: nothing on this path reads weather.

**5 · The runner says "indoors" before starting; it is not inferred.** An
explicit choice at Start is the tell — if they did not say indoors, it is an
outdoor run. This replaces inference as the source of truth for
`isTreadmill`, which today is `tracker.distanceSourceUnavailable`: a signal
that arrives minutes late, cannot be trusted early, and reads a lost GPS fix
and a treadmill as the same thing. It also removes the risk this document
called its biggest — the phone cannot know the run is indoors at build time,
but the runner can say so at Start, and the watch can then refuse the
adjustment locally.

## Open questions

1. **Which temperature drives it?** `detectHeatBail` uses `temp_max_f ??
   temp_start_f` (`lib/plan/adapt.ts:2859`) — the day's peak, right for a safety
   gate, wrong for a 06:30 run. `fetchDayForecast` accepts a `workoutWindow` and
   returns `temp_start_f`/`temp_end_f` (`lib/weather/openmeteo.ts:449-461`), but
   the watch payload has no start-time hint. Where does the window come from?
2. **Does the eased band go back to the phone's Today card?** If wrist and phone
   disagree on today's prescribed pace, the wrist is the one being obeyed.
3. **Is the completed run judged against the eased band or the written one?**
   The post-run verdict already prices heat independently
   (`lib/coach/run-recap.ts:466`), so grading an eased execution against an eased
   band and then re-forgiving it in the recap forgives twice.
4. **Wire `WatchFueling.heatAdjusted` at the same time?** Already on the wire,
   already decoded (`WatchWorkoutModels.swift:1189`), permanently `false` since
   it shipped, for the same reason.
5. **Does the runner get a way to say "indoors" before starting?** That resolves
   the treadmill risk properly rather than by suppression.
