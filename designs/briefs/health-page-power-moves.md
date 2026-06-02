# Brief · Health page · power moves · the leap from dashboard to intelligence

**For:** David + design agent
**From:** backend
**Date:** 2026-06-01
**Status:** Proposal · current page is a beautiful dashboard ·
backend has the data to make it the smartest training recovery
system on the market

---

## The honest critique

The page right now is gorgeous and complete. It shows 20+ honest
metrics. But the runner has to do the synthesis themselves: "Sleep
is bad AND HRV is low AND wrist temp is up · is that one story or
three?" That's the work the engine should do.

Every world-class recovery app (Whoop, HRV4Training, Garmin Daily
Suggestion) solves this. None of them have the doctrine layer
Faff already has · Plews HRV, Banister TSB, Saw subjective override,
cycle phase, Joel Friel HRmax, etc. We just don't surface the
SYNTHESIS yet.

What follows is 10 ideas, ranked by leverage × implementation cost.
Most use data we already ship. Three or four of these would put Faff
ahead of any consumer recovery app I've seen.

---

## Tier 1 · ship-tomorrow leverage (free wins)

### 1 · "What these mean together" synthesis card

**Where:** Top of the page, between the 42 gauge and the BODY grid.

**Content:** 2-3 sentence cross-metric story written by the engine
each morning. Pulls the data we already have, finds the dominant
narrative, says it in coach voice.

**Example today:**
> Sleep is the story. 5.9h with HRV down 10 and RHR up 3 · these
> three move together when the nervous system is undersleep-stressed.
> Wrist temp is normal so this isn't illness · it's a deficit you
> can close tonight.

**Why this matters:** Right now the runner sees five red bars and
has to guess which one to act on. The engine already knows · it just
hasn't been told to write it down.

**Data needed:** All on the seed today (readinessBrief.pillars +
readinessBrief.movers + health.wristTemp + health.respiratoryRate).

---

### 2 · Streaks banner (already built, not surfaced)

**Where:** Below the synthesis card, dismissible chip.

**Content:** Persistent multi-day patterns. I built
`readinessBrief.streaks` weeks ago and it's been computing the
3-day-persistence rule for every pillar. Nothing renders it.

**Example today:**
> HRV below baseline 3 days in a row · this is the streak threshold
> per Plews · early functional overreach signal. Pull back today
> regardless of how the run feels.

**Data needed:** `seed.readinessBrief.streaks[]` · already on the
seed.

---

### 3 · "Watching tomorrow" surface

**Where:** Below the BODY grid as a small section, or as chips on
specific tiles.

**Content:** I already built `readinessBrief.watchTomorrow[]` ·
forward-looking "what to verify if it persists" callouts. They've
been on the seed for weeks, nothing renders them.

**Example:**
> Watching: RHR settles after tomorrow's rest day. If it stays
> elevated, that's two yellow flags stacking and we'd want to push
> the next quality session later in the week.

**Data needed:** `seed.readinessBrief.watchTomorrow[]` · already on
the seed.

---

### 4 · Sleep architecture vs sleep quantity framing

**Where:** Sleep stages section (already there).

**Problem:** Right now Deep 68min reads as "WATCH" against target 75
when the actual problem is total sleep was only 5:54. The runner sees
the wrong story.

**Fix:** Compute deep + REM as a percentage of total sleep. If those
percentages are healthy (15-25% deep, 20-25% REM), the architecture
is fine and the problem is just hours. If percentages are off, then
architecture is the issue.

**Suggested copy:**
> Architecture is healthy (19% deep, 24% REM · both in range). The
> issue is hours. Push bedtime 30 min tonight and tomorrow's deep
> sleep allocation will hit target.

**Data needed:** New computation in health-state from existing rows.
Trivial.

---

## Tier 2 · medium-effort, high-impact (1-2 hr work each)

### 5 · Training Form tile alongside readiness

**Where:** Either in BODY or as a paired card with the 42 gauge.

**Content:** I built `lib/coach/training-form.ts` (Banister TSB) ·
the canonical fitness vs fatigue calc. Currently lives on the Train
page. Surface a 1-line summary on Health.

**Example:**
> Training Form −8 · loaded but productive. Body is absorbing load,
> recovery is the bottleneck.

**Why pair it with readiness:** Today's readiness is the snapshot.
Training Form is the trajectory. Pairing them tells the runner
"this is where you are AND where you're heading."

**Data needed:** `lib/coach/training-form.ts` already exists. Just
needs to land on the Health page section.

---

### 6 · Aerobic decoupling trend across the block

**Where:** New section below FORM · "AEROBIC FITNESS"

**Content:** The per-run aerobic decoupling I built last week ·
aggregate the last 8 long runs into a trend chart.

**Example:**
> Aerobic decoupling has improved from 9.2% to 6.1% this block ·
> the engine is getting more efficient. On pace for race-ready by
> week 8.

**Why this matters:** This is the SINGLE BEST proof your aerobic
base is building. Most apps show "VO2 max" which barely moves week
to week. Decoupling moves visibly across a 4-8 week block.

**Data needed:** Aggregate `runDetail.aerobic_decoupling.drift_pct`
across last 8 long runs. Backend just needs to compute the trend.

---

### 7 · Confounder list ("why is this low?")

**Where:** Below each "WHAT IS DRIVING IT" pillar, expandable.

**Content:** I built `readinessBrief.pillars[].confounders` weeks
ago. Currently not surfaced. For each red pillar, surface the
plausible explanations.

**Example for SLEEP -13:**
> Probable contributors:
> · Bedtime drift +42 min over last 4 nights
> · Wrist temp +0.3°C (mild thermal stress)
> · Training load step-up this week
> Less likely:
> · Caffeine (you logged 1 cup yesterday)
> · Alcohol (none logged)

**Data needed:** `seed.readinessBrief.pillars[].confounders` ·
already on the seed.

---

### 8 · Subjective check-in surface

**Where:** Small interactive section · either top of page or
floating CTA.

**Content:** Saw et al. doctrine: subjective wellness > objective
when they disagree by 15+ pts. I built this. Currently captured but
not displayed prominently.

**Example flow:**
> "How do you feel today?" → 1-10 slider
> Runner answers 7/10. Objective shows 42.
> Card surfaces: "You feel solid · the objective says back off.
> When you disagree, trust your body. Today: do the run, listen,
> stop if anything feels off."

**Data needed:**
`seed.readinessBrief.subjectiveCheckin` + `subjectiveOverride` ·
already on the seed.

---

## Tier 3 · big leap (a day each)

### 9 · Heat acclimatization tracker

**Where:** New section · "ENVIRONMENT"

**Content:** Wrist temp + RHR + nighttime HR climb pattern after heat
exposure is the textbook acclimatization signal. Tracks the body
adapting over ~10 days.

**Example:**
> Heat acclimatization · day 4 of 10. Body is adapting (RHR rising
> slower than peak temp · classic Tier-2 marker). Expected HR penalty
> on tomorrow's run: −4 bpm vs day 1 of exposure.

**Data needed:** Heat anomaly detection from
existing weather + runs.data. New computation but uses existing
fields.

---

### 10 · Forecast / trajectory ("if this continues")

**Where:** Per-tile chip OR a forecast section.

**Content:** Each declining metric gets a forward-projection chip:
"If HRV CV keeps rising at this rate, you'll be in overreach band
by Thursday."

**Why this is the killer feature:** Right now Faff says "this is bad."
Whoop says "this is bad." Garmin says "this is bad." No app says
"this is bad AND here's what will happen if it persists." That's
the leap from descriptive to PREDICTIVE.

**Data needed:** Slope detection on the time-series. Backend can
ship.

---

## Sleeper picks (high-leverage but harder to design for)

### 11 · "Compared to last block"

Block-over-block deltas. "Sleep quality this build vs your
peak-fitness build" · proves whether you're recovering as well as
when you ran your best race.

### 12 · Day-of-week patterns

Surface "your HRV is consistently low on Mondays · this is a Sunday
recovery problem, not a training problem."

### 13 · Cycle-phase performance pattern (female users)

"Your peak power efforts land best in ovulation week (day 12-16) ·
the next interval session is scheduled for day 8 (follicular) ·
worth pushing to Thursday?"

### 14 · Run-quality vs recovery correlation

"Your top-quartile runs follow nights where deep sleep > 70min."
Literally surfaces the predictor.

---

## What I'd ship first

If you give me a session, ranked by leverage × cost:

1. **#1 synthesis card** · 30 min · MAX leverage (defines the page's
   intelligence)
2. **#2 + #3 streaks + watchTomorrow surface** · 20 min · already
   built, just needs render
3. **#7 confounder list** · 30 min · same, needs render
4. **#4 architecture-vs-quantity framing** · 30 min · new
   computation
5. **#10 forecasts** · 1 hr · new but uses existing series

That's ~3 hours and the page goes from beautiful dashboard to
"how does it know?"

---

## What other apps DON'T do that we can

- Whoop shows a single recovery % with no synthesis. We can show
  the WHY across 5 pillars + the synthesis statement.
- HRV4Training shows great HRV charts but doesn't tie them to sleep,
  training load, or cycle. We have all four.
- Garmin Daily Suggestion is a template. We can synthesize per-day
  in coach voice.
- Strava has zero recovery story. We can be the recovery story.

The doctrine layer is the moat. We just need to write down what the
engine already knows.

---

## Closing

The current page is honest and beautiful. The opportunity is to make
it the smartest recovery surface in running. Most of the data is
already on the seed and unused. A few hours of work surfaces the
synthesis layer and the runner suddenly has a system that THINKS,
not just a dashboard that DISPLAYS.

Pick the tier you want. Or rank these differently. I'll execute on
whatever order makes sense.

---

## Files referenced

- `lib/coach/readiness-brief.ts` · synthesis composer (has streaks,
  movers, watchTomorrow, confounders, subjective)
- `lib/coach/training-form.ts` · Banister TSB
- `lib/training/aerobic-decoupling.ts` · per-run decoupling
- `lib/coach/health-state.ts` · the data loader for everything else
- `components/faff-app/seed.ts:adaptHealth` · the composer that
  picks what to render
