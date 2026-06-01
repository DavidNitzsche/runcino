# In-run information audit — what's clear vs what's missing

**Companion to** `01-DESIGN_BRIEF.md` (data + routing layer) and
`02-VISUAL_HANDOFF.md` (visual primitives).

This doc is **the moment-by-moment scrutiny pass**. For every in-run moment,
what does the runner actually need to know in 1.5 seconds at hard effort?
What does the current face show? What's missing or buried?

David's specific ask: "make sure the info is clear and surfaced. gels,
remaining distance and/or time, intervals, etc."

The audit below is organized as:
1. **The runner's questions per moment** — what they're actually asking
2. **Per-face audit** — what's shown, what's missing, recommendation
3. **Cross-cutting gaps** — patterns across faces
4. **Hierarchy proposal** — the dominant-info principle per moment

Design's job: confirm what's right, fix what's missing, decide what the
new takeover/strip/badge looks like for each gap.

---

## 1. The runner's questions, by moment

What runners actually ask their watch, listed in priority order per moment.
The first question is the dominant one — design should ensure it's the
highest-contrast, biggest-numbers thing on the face.

### Warmup
1. **How much further until the work starts?** (distance OR time)
2. What's the first work interval going to ask of me? (preview)
3. Am I warming up at a reasonable pace? (loose, not enforced)

### Work rep (interval)
1. **Am I on pace right now?** Color + delta = dominant question.
2. **How much of THIS rep is left?** (distance OR time — depends on `repUnit`)
3. What's the target pace?
4. What rep number am I on out of total? (`REP 2/4`)
5. Is my HR ok or am I redlining?
6. What's the NEXT move? More reps, or recovery?

### Recovery between reps
1. **How much rest left?** (time, dominant)
2. What's the next rep's target pace?
3. Did my HR come down enough to start again?

### Cooldown
1. **Distance to go.** (the runner is mentally done with hard work)
2. Current pace (informational, not enforced)
3. Total elapsed (am I close to "done"?)

### Easy / long run
1. **HR vs Z2 ceiling.** If you're in Z2, you're winning. If you're over, slow down. Dominant.
2. **Current pace.** Loose target band but not strict.
3. **What mile am I in?** (long runs are mentally chunked by mile)
4. **Distance / time to next fueling moment.** If a gel is coming, when?
5. Total distance so far.
6. Total elapsed.
7. Cadence (form check — drops late = form breaking).

### Race day
All of the above PLUS:
1. **Am I on goal pace?** (delta vs goalSec or vs targetPaceSPerMi)
2. **Current course phase.** ("BUILD", "HOLD", "KICK")
3. **Distance to next course phase boundary.**
4. **Distance/time to next fuel.**
5. **Total elapsed vs goal.** (predicted finish time)
6. **Distance remaining to the line.**

### Fueling moments
**Before** the fuel mark (3-5 min before):
1. Heads-up that fuel is coming (currently NOT surfaced — gap)

**At** the fuel mark:
1. Take it NOW
2. What number gel in the sequence (so the runner remembers it)
3. With water (reminder)

**After:**
1. Confirmation it's logged
2. Distance/time to next fuel

### Mile auto-lap
1. **Mile number** just completed (so the runner can chunk mentally)
2. **Mile pace** for that mile
3. Cumulative distance (already on main face — not needed here)

### Phase boundary heads-up (last 0.25 mi / 10 s of phase)
1. How much left before the change (already surfaced)
2. What's next? Implied — could be more explicit.

### Pause
1. What was I doing? (frozen state of last face)
2. How much rest am I burning?
3. How to resume

---

## 2. Per-face audit

Format per face:

```
FACE NAME              · what runner is asking · current shown · gaps · recommendation
```

The "current shown" data comes from `Faces.swift` in the code folder.
"Gaps" is what the runner needs but the face doesn't show.

### WarmupFace

| Slot | Currently shown |
|---|---|
| Top label | `WARMUP` |
| Row 1 | livePace · `.live` role |
| Row 2 | targetPace · `.ink` (reference white) |
| Row 3 | distance · `.dist` (blue) |
| Bottom | `until rep 1: 4:30` style |

**Runner asks:** how much further to work?

**Gaps:**
- Bottom label IS what they want, but it's small (8% H). The DOMINANT info
  ("time/distance to first work") is the smallest text on screen.
- Preview of first work target is in the bottom label as a string — design
  could surface this more cleanly.

**Recommendation:**
- Promote "to next phase" up to a big row (replace targetPace which is
  loose during warmup anyway). Rows become: distance · time-to-work ·
  pace. Bottom label becomes "Next: 6:31 · 1mi" (the rep preview).

### WorkIntervalFace

| Slot | Currently shown |
|---|---|
| Top label | `REP 2/4` (derived from stripStates) |
| Row 1 | livePace · `.live`/`.goal`/`.over` (drift zone) |
| Row 2 | targetPace · `.ink` |
| Row 3 | totalDistance · `.dist` (cumulative for the workout) |
| Row 4 | repCounter · `.ink` (`0:24` time-left OR `0.30` mile-left) |
| Strip | Per-rep states |

**Runner asks:** on pace? · how much rep left? · what's next?

**Gaps:**
- **HR is not on the work face at all.** A runner cooking themselves at 95%
  max won't see it until they collapse. **Design call:** add HR as a 5th
  row (would break 4-row max convention) OR a corner badge OR replace
  totalDistance with HR.
- **Next move preview is missing.** "Next: REST 1:30" would tell the runner
  to plan their last 50m of the rep.
- repCounter (row 4) and topLabel (`REP 2/4`) carry overlapping info — the
  strip already shows progress. Could one of these go?

**Recommendation:**
- Add HR as a corner badge in red when over a per-workout HR ceiling, hidden
  otherwise. Doesn't compete with main rows.
- Promote "next move" preview into the bottom label slot (currently empty
  on this face). Example: `next: REST 1:30 → 6:34`.

### LiveRaceFace

| Slot | Currently shown |
|---|---|
| Top label | `PHASE n/m` (orange) |
| Row 1 | livePace · pace-zone color |
| Row 2 | targetPace · `.ink` |
| Row 3 | distanceToGoal · `.dist` (distance left to finish) |
| Row 4 | elapsed · `.ink` |
| Strip | Race-phase progress |

**Runner asks:** on goal pace? · current phase · distance to next phase · next fuel?

**Gaps:**
- **Distance to next course phase NOT shown.** During "BUILD" phase the
  runner wants to know "build ends in 1.2 mi". This is a major gap on a
  primary race face.
- **Distance/time to next fuel NOT shown** until the FuelFace takeover
  fires. Runners pre-position fuel mentally; "next gel: 1.8 mi" is
  high-value info.
- **Predicted finish time NOT shown** — runner asks "am I on track for
  goalSec?" Currently they have to do mental math: elapsed × (distance /
  totalDistance).
- HR not shown.

**Recommendation:**
- Replace row 4 (elapsed) with a smarter "elapsed / predicted" composite:
  `1:42:18 → 4:08:42` (elapsed → predicted finish at current pace).
- Add **two badges**: gel-icon + distance-to-next-gel · phase-icon +
  distance-to-next-phase-boundary. Top corners of the face, small.
- Bottom label becomes the current phase strategy: `HOLD · 6:31 target`.

This is the most data-dense moment in the app. Worth making it dense.

### EasyFace / EasyFace (HR-over variant) / EasyFace (no-GPS variant)

| Slot | Currently shown (EasyFace) |
|---|---|
| Top label | `EASY` |
| Row 1 | livePace · `.live` if reasonable |
| Row 2 | guardrail · HR or cadence (rotating per `displayHint`) |
| Row 3 | totalDistance · `.dist` |
| Bottom | `1.0 mi · 6:47` (mile pace from last lap?) |

**Runner asks:** Z2 (HR vs ceiling)? · current pace · mile · next fuel?

**Gaps:**
- **HR ceiling reference NOT shown.** Runner sees `145` HR but can't tell
  if that's under their 152 ceiling without remembering. Should show
  `145 / 152` or have a small ceiling indicator.
- **Next gel distance/time NOT shown** for long easy runs (which often
  have `fueling.atMins[]` set — see WorkoutEngine fuel paths).
- **Mile NUMBER unclear.** Bottom label currently shows the last completed
  mile pace, but the runner mentally tracks "I'm in mile 7 of 12" — a
  current-mile / total-miles indicator would help.
- "1.0 mi" in bottom label is confusing — is that mile-1 pace, or last-mile
  pace? Design needs to disambiguate.

**Recommendation:**
- Replace row 2 (guardrail) with a 2-up: HR/ceiling on the left
  (`145 / 152`), cadence on the right (`178`). Both small, both visible.
  OR keep rotating but add a tiny ceiling reference under the HR number.
- Bottom label becomes `mile 7/12 · gel in 1.8`. The runner now knows
  exactly where they are in the run and when the next fuel is.

### HRFace

| Slot | Currently shown |
|---|---|
| Top label | `MAF` (or whatever method label) |
| Rows | HR · target · distance · counter |

**Runner asks:** HR ok? · how much further?

**Gaps:**
- `MAF` label is jargon. Open question already in handoff doc §opinions.
- "Target" HR is shown but not "ceiling" — they're different concepts
  (target = where you should be; ceiling = where you must not go).

**Recommendation:**
- Generalize the label to the current workout's HR doctrine: `MAF`,
  `Z2`, `AERO`, `HEAT` — pick at workout-construction time, ship in
  `WatchWorkout.displayHint`.
- Show both target AND ceiling when both exist: `target 138 · ceiling 152`
  could be a two-line guardrail.

### RestFace (recovery)

| Slot | Currently shown |
|---|---|
| Top label | `REST` (calm blue) |
| Row 1 | timeLeft · `.ink` |
| Row 2 | nextTarget · `.ink` |
| Row 3 | distance · `.dist` |
| Bottom | (likely empty) |

**Runner asks:** rest time left · next target

**Gaps:**
- **No HR.** Runners look at HR during rest to confirm they're recovering.
  "HR dropped to 128" is a strong signal vs "HR still at 168 after 60s
  of rest" (you cooked yourself).
- **No "next rep length" preview.** Knowing "next rep: 0.5 mi @ 6:31" lets
  the runner mentally prepare.

**Recommendation:**
- Add HR as a row, possibly replacing distance (which is less relevant
  during recovery). Row order becomes: time-left · HR · next-target.
- Bottom label gets the next rep length: `next rep: 0.5 mi`.

### SteadyRunFace (cooldown / overtime)

| Slot | Currently shown |
|---|---|
| Top label | `COOL DOWN` or `OVERTIME` |
| Row 1 | livePace |
| Row 2 | elapsed |
| Row 3 | distance (purple in OVERTIME) |

**Runner asks:** distance to go (cooldown) · how much further (overtime)

**Gaps:**
- **Cooldown distance-to-go NOT shown.** Runner asks "how much cool down
  is left?" but face shows total distance not distance-remaining.
- **In overtime, the runner has no plan — face should just be informational**
  which it is. No gap there.

**Recommendation:**
- For cooldown specifically: replace distance with "distance-to-cooldown-end".
  Bottom label could carry total cumulative distance as a less-prominent
  reference.

### StridesFace

| Slot | Currently shown |
|---|---|
| Top label | `STRIDES` |
| Rows | livePace · counter |
| Strip | Stride progress |

**Runner asks:** how many strides left · am I sprinting

**Gaps:**
- Minimal. Strides are 20-30 s efforts; the face is appropriately spare.

**Recommendation:**
- No major changes. Consider showing "next: jog 60s" in bottom label.

### FuelFace

| Slot | Currently shown |
|---|---|
| Top label | `FUEL` (amber) |
| Row 1 | "Gel 2 of 3" or similar |
| Persistent until swipe |

**Runner asks:** take it now · which one · how much

**Gaps:**
- **Water reminder is in the design but probably not as prominent as it
  should be.** Gels without water sit in the gut.
- **No pre-warning before fuel** (this is the bigger gap — see Cross-cutting).

**Recommendation:**
- FuelFace stays simple at the moment of fueling.
- Add a **pre-fuel countdown** as a strip badge on the preceding main face
  ("next gel: 0.5 mi"). When distance crosses 0, takeover fires.
- Bottom label on FuelFace: `with water · sip 3-5 oz`.

### MileSplitFace

| Slot | Currently shown |
|---|---|
| Top label | `MILE n` |
| Rows | mile pace |
| 2 s auto-dismiss |

**Runner asks:** what was that mile's pace

**Gaps:**
- **Already-flagged-as-bug:** fires during work reps. Should be gated
  to non-work phases.
- Last 3 miles' rolling pace COULD be added for context but adds
  complexity. Skip for v1.

**Recommendation:**
- Gate to non-work phases (engine fix, already flagged).
- Otherwise keep as-is.

### HeadsUpFace

| Slot | Currently shown |
|---|---|
| Amber 2.6 s flash | "0.25 LEFT" |

**Runner asks:** how much before the change

**Gaps:**
- **Next phase preview missing.** Runner knows "the rep is ending in 10s"
  but not what's coming next. "Next: REST 1:30" or "Next: REP 3/4 @ 6:31"
  would let the runner prepare.

**Recommendation:**
- Two-line takeover: top = "0.25 LEFT" (current), bottom = "next: REST 1:30".

### PhaseChangeFace (race day)

| Slot | Currently shown |
|---|---|
| Top | "PHASE 2 OF 5" + mountain glyph |
| Big | new phase name |
| Sub | strategy |
| 3 s auto-dismiss |

**Runner asks:** what's the new phase · what's the new strategy

**Gaps:**
- Probably none — phase change is a planned, low-frequency moment.

**Recommendation:**
- No changes.

### LandmarkFace (race day)

| Slot | Currently shown |
|---|---|
| Calm blue wash | landmark name + glyph |
| 3 s auto-dismiss |

**Runner asks:** what landmark · is this where I push

**Gaps:**
- Could include distance-to-finish or distance-to-next-phase but landmarks
  are intentionally informational, not actionable.

**Recommendation:**
- No changes.

### LivePauseFace

| Slot | Currently shown |
|---|---|
| Greyed-out | last face's data, dimmed |
| Resume capsule |

**Runner asks:** what was I doing · how to resume

**Gaps:**
- **Pause time elapsed NOT shown.** Runner pauses at a crosswalk for 30s,
  comes back — they want to know they paused for 30s, not 5 minutes.
- Already-flagged-in-handoff: should it conform to NumberFace or keep the
  greyed treatment?

**Recommendation:**
- Add small "paused 0:42" indicator either as top label or bottom subtitle.

### LobbyFace

| Slot | Currently shown |
|---|---|
| Top | workout name |
| Rows | summary numbers |
| START button |

**Runner asks:** is this the right workout · readiness · go

**Gaps:**
- **Readiness score not shown on LobbyFace** (it's on ReadinessGlanceView,
  the swipe-prior face). If the runner went straight to lobby they don't
  see readiness.
- **Workout details could be richer:** "12 mi · 4 × 1mi @ 6:31" is
  glanceable; just "Long run" is not.

**Recommendation:**
- Add a readiness score chip to LobbyFace top corner.
- Make the summary line explicit about phases when relevant.

### CompleteFace

| Slot | Currently shown |
|---|---|
| Workout type label | top |
| Summary numbers | distance · pace · elapsed |
| Done button |

**Runner asks:** did I do it · what were my numbers · sync confirm

**Gaps:**
- **No sync confirmation** (silent durable retry — handoff doc open question).
- Avg HR not shown (might already be — verify).

**Recommendation:**
- Add a small `synced ✓` chip at the bottom once the PhoneSync queue
  confirms 2xx. Until then, no chip — silent retry continues.

### CalibrateFace

| Slot | Currently shown |
|---|---|
| Mile-stepper for race-day GPS re-sync |

**Runner asks:** is this the right mile

**Gaps:**
- Probably none.

**Recommendation:**
- No changes.

### IdleView / ReadinessGlanceView / SummaryView

These are flagged for **palette token touch-ups** in `MIGRATION_PLAN.md`
(not yet on the new locked palette). Visual modernization needed.

**IdleView** runner asks: "no workout — what do I do?"
- Currently shows a "no workout cached" message
- Could show last run summary as a fallback
- Could show "tap to start free run" CTA → JustRunFace

**ReadinessGlanceView** runner asks: "should I do this run?"
- Shows readiness score + label
- Could surface the workout summary + start button → skip LobbyFace
- Open question already in design brief §7: should lobby be skippable?

**SummaryView** — post-run sumary on the watch
- May overlap with CompleteFace — design opinion: are both needed?

---

## 3. Cross-cutting gaps

Patterns that appear across multiple faces:

### Gap A · Fuel pre-warning

**Problem:** FuelFace fires AT the fuel mark with no warning. Runner is
mid-stride, can't gracefully grab a gel from their belt. By the time they
read FuelFace and reach for the gel, they're 200m past the planned mark.

**Pattern needed:** every main face during a run with `gelsMi[]` or
`fueling.atMins[]` should show a small chip/badge: `gel in 0.5 mi` or
`gel in 4:30`. When distance crosses 0, FuelFace takes over.

**Where it lives:** likely a small badge in a corner of EasyFace,
LiveRaceFace, WorkIntervalFace. SteadyRunFace too (cooldown could include
a "recovery drink in X min" cue).

### Gap B · HR visibility on non-HR faces

**Problem:** WorkIntervalFace shows no HR. Runner cooking themselves doesn't
see it.

**Pattern needed:** HR available as small badge or corner indicator on every
in-run face. Color-coded vs `hrCeilingBpm`.

### Gap C · Next-move preview

**Problem:** Runner finishing a rep doesn't know if the next move is rest
(easy) or another rep (hard) until the next face renders.

**Pattern needed:** bottom label or last row carries `next: <thing>` on:
- WorkIntervalFace (next: REST 1:30 or next: REP 3/4)
- WarmupFace (next: REP 1/4 @ 6:31 · 1mi)
- RestFace (next: REP 3/4 @ 6:31)
- HeadsUpFace (next: REST 1:30)

### Gap D · Distance to next phase boundary

**Problem:** During a long-form phase (a 5 mi build, a 3 mi hold), runner
doesn't know how much of THIS phase is left.

**Pattern needed:** repCounter (already on WorkIntervalFace) extended to
race-day phases. LiveRaceFace gets a "phase left" indicator.

### Gap E · Predicted finish / pace-vs-goal

**Problem:** Race-day runner can't see "am I on track for my goal" without
mental math.

**Pattern needed:** LiveRaceFace bottom label: `elapsed / predicted finish`
or `+0:42 ahead of goal pace`.

### Gap F · Mile-number context on long runs

**Problem:** EasyFace shows total distance (`7.21`) but the runner mentally
operates in "I'm in mile 7 of 12" terms. The current-mile number is
implicit but the total-target is missing entirely.

**Pattern needed:** somewhere on EasyFace + SteadyRunFace, show
`mile 7 / 12` or `7.2 / 12.0`. Likely in the bottom label.

### Gap G · Cumulative time pacing during easy runs

**Problem:** Long-run runner asks "how long have I been out here?" but
EasyFace shows current pace + distance. Elapsed time is on InRunStatsFace
which requires swiping.

**Pattern needed:** add elapsed as a rotating guardrail option, or surface
it on the main face.

### Gap H · "Synced" affordance

**Problem:** Post-run sync is silent. Runner doesn't know if their run
made it to the iPhone / backend.

**Pattern needed:** small `synced ✓` chip on CompleteFace once 2xx
confirmed. Until then, nothing — silent retry continues.

---

## 4. Hierarchy proposal — dominant-info principle

Every face has ONE dominant question the runner is asking. Design should
ensure the dominant info is the biggest, brightest, highest-contrast
thing on the face. Everything else is reference.

| Face | Dominant question | Should be biggest |
|---|---|---|
| Warmup | how much further to work | distance/time to work |
| Work rep | on pace? | livePace (with drift color) |
| Recovery | rest time left | timeLeft |
| Cooldown | how much cooldown left | distance to cooldown end |
| Easy | HR vs Z2 ceiling | HR (color-coded) |
| Long run | mile number / distance remaining | mile-count or distance-to-go |
| Race | on goal pace? | livePace OR pace-vs-goal-delta |
| Strides | strides left | counter |
| HR | HR vs target/ceiling | HR (color-coded) |
| Fuel | take it now | gel name + "now" |
| Mile-split | the mile's pace | mile pace |
| Heads-up | how much left | "0.25 LEFT" |
| Pause | how to resume | Resume button |
| Lobby | is this the right workout | workout name |
| Complete | did I do it | done check + summary |

Currently most faces lead with livePace, which is right for work reps but
not for easy/long runs (where HR is dominant) or warmup (where time-to-work
is dominant). The audit recommendations above swap the dominant slot
per-face.

---

## 5. Deliverable for design — in-run audit pass

In addition to the visual + routing pass deliverables in
`01-DESIGN_BRIEF.md` §6, the in-run audit produces:

1. **Per-face mockup** for every face that the audit recommends changes to.
   Hero scale, brand fonts, on a real device frame.
2. **Cross-face badge system** — the corner/strip indicators for fuel,
   HR-over, phase-boundary, and any other cross-face gaps. Specify size,
   position, color, dismiss behavior.
3. **The pre-fuel badge** specifically — what does "gel in 0.5 mi" look
   like as a chip on the main face? Where does it go? When does it dismiss?
4. **Decision** on each Gap A-H above: ship it, defer it, or kill it.
   Each decision is one of:
   - Ship as proposed
   - Ship modified (describe how)
   - Defer to v2 (note why)
   - Kill (the runner doesn't actually ask this)

---

## TL;DR

The watch shows pace, target, distance. It does NOT consistently show:
- **HR** on non-HR faces
- **Next move** previews
- **Distance to next phase boundary** on race day
- **Distance/time to next gel** before the fuel cue fires
- **Pace vs goal** on race day
- **Mile-number context** on long easy runs
- **Cumulative time** without swiping to a stats face
- **Sync confirmation** post-run

Design pass should add these as small badges, chip rows, or bottom-label
substitutions — without breaking the 9 locked layout rules in
`02-VISUAL_HANDOFF.md`. The faces are already dense; new info goes in via
edges (corners, bottom labels, rotating guardrails) not by stuffing rows.

The dominant info per face is mostly right today, but Warmup and Easy/Long
specifically need their dominant slot rethought (time-to-work and HR-vs-Z2
respectively — not livePace).
