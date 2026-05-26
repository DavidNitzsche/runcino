# NEEDS_DAVID

A running list of things I've intentionally parked because they deserve
your eyes before I rip into them. I keep building everything else
autonomously — these are the items where decisions cascade and a wrong
call wastes a lot of work.

When you have a sec, react to any item (Slack message, voice memo,
edit this file, whatever) and I'll unblock it next session.

---

## 0. THE PLAN SITUATION — RESOLVED

You had a real AFC plan you were 2 weeks into, hitting 40-50 mpw.
I (Claude) overwrote it during P8 smoke-testing → my v1 regen.

**Now (2026-05-25):** restored your original plan
`8599e3a1-07ab-4610-9f77-eae6a6f80032` (13 weeks, current week W1 =
43.8 mi, peak W10 = 55.5 mi). My v1 regen is archived, not deleted.

**Locked rules going forward:**
- Plan changes are USER-INITIATED ONLY. I never auto-regenerate.
- "Plan deletions" during my own testing archive rather than drop.
- v2 generator (per your A2/B2/C3 answers below) will be opt-in via
  the Regenerate button when ready. The current plan is yours and
  will become the **starting point** for v2 adaptation work —
  v2 won't replace it, it'll evolve from it.

## 0.5. YOUR P8 v2 ANSWERS (locked in)

From `docs/plan-generation-mockup-2026-05-25.html`:

- **A2 — Target-driven volume ramp.** v2 sizes peak by
  experience tier × race distance (advanced + marathon ≈ 70-90 mpw
  peak), starts from current capability, ramps aggressively but
  capped at 10%/wk. Implementation: needs `experience_level` (have
  it = advanced) and `weeklyAvg8w` (your current plan has 29.1; need
  to refresh from recent runs which are ~40-50).
- **B2 — Auto-rewrite next 7 days on trigger events.** Triggers from
  Research/00b: missed key workout, killer-effort divergence, RHR
  spike, sleep crater, illness flag. Rewrite is bounded (next 7
  days), narrated by coach voice with citation, undoable.
- **C3 — Structured prescriptions + coach prose WHY.** Each quality
  day gets a typed structure (paces from VDOT/LTHR) AND a
  one-sentence WHY in the coach voice. Watch can load the structured
  side, the runner reads the prose.

**Next step from you when you want v2:** click Regenerate on
/training (after I ship v2). Until then, your restored plan is the
source of truth and the coach builds from it.

---

## 1. P8 Plan generation — design pass before v2

v1 algorithmic generator shipped (block periodization, Daniels-style,
cited to /Research/). It works but it's rough:

- Volume curve is conservative — peaks at ~38mpw from a 34mpw base.
  For sub-3 marathon goal that's nowhere near where you need to be.
- Quality session prescriptions are template strings
  ("3×1mi @ T pace · 2:00 jog") not adaptive to current VDOT.
- Adaptation triggers (missed run, killer effort, RHR spike) are NOT
  wired — plan is static until you regenerate.
- Pace targets come from goal time only, not from LTHR/VDOT.
- No LLM voice integration on weekly rationale yet.

**Decision points I need from you:**
- Do you want volume to ramp aggressively toward known marathon peak
  ranges (70-90mpw for sub-3) even if you're currently at 34mpw, or
  keep the "respect current base" rule strictly?
- Adaptation: auto-rewrite the next 2 weeks when a key workout is
  missed, or just flag it and let you decide?
- Quality prescriptions: TrainingPeaks-style structured intervals
  (paces in s/mi for every rep based on VDOT), or coach voice in
  prose ("controlled tempo, just below threshold")?
- Mockup deck before I touch v2? I'll lay out the plan in HTML
  showing the structure, the voice, and what a missed-run mid-week
  adaptation looks like.

**My recommendation:** mockup deck first. The current v1 is fine as a
placeholder — it doesn't lie, just doesn't push hard enough. Mockup,
you review, I rebuild.

**Deck shipped:** [`docs/plan-generation-mockup-2026-05-25.html`](plan-generation-mockup-2026-05-25.html)
shows v1 in action plus three concrete A/B/C decision points
(volume ceiling, adaptation triggers, quality prescriptions) plus
a sample voice-narrated weekly briefing. Open it in a browser.

---

## 2. Strava push (not pull) — destination architecture

You said: watch + Apple Health are source of truth, Strava is push-only.

**Server side is done:**
- `POST /api/ingest/workout` — iPhone reads a fresh HKWorkout and posts it
  here. Idempotent on `client_workout_id` (HKWorkout.uuid). Writes into
  the existing strava_activities table so all readers work unchanged.
- `POST /api/ingest/health` — batch sleep/HRV/RHR/VO2/weight from
  HealthKit. Idempotent on (user, type, sample_date, recorded_at).
- `POST /api/run/manual` — fallback when watch missed it.

**Still needed on the iOS side (separate Swift work):**
- iOS app needs an HKObserverQuery on HKWorkoutType that fires when the
  watch sends a new HKWorkout. Handler reads splits/HR zones/route then
  POSTs to /api/ingest/workout.
- iOS app needs a nightly HKSampleQuery for the past 30 days of sleep,
  HRV, RHR, VO2, weight. POSTs to /api/ingest/health.
- Both run in background via WKBackgroundModes: workout-processing.

**Questions for you:**
- Do you want the Strava post to include coach-voice race recap
  (post-race), or just the raw HR/pace data + your title?
- For non-race runs, just the activity itself with no commentary?
- Should we keep the existing strava-webhook receiver as a fallback
  for runs not done with the watch (e.g. treadmill on Peloton)?
- When iOS sends a workout, do you want the previous Strava webhook
  copy (if any) to take precedence, or always the watch version?

---

## 3. Experience level — what drives max weekly mileage?

You said: Beginner / Intermediate / Advanced / Advanced+. Each tier
should cap max weekly mileage.

**Proposed defaults:**
- Beginner    → 25 mpw cap, no doubles
- Intermediate → 50 mpw cap, optional doubles
- Advanced    → 80 mpw cap, doubles + 2 quality sessions
- Advanced+   → 110 mpw cap, doubles + 2-3 quality + strides

React if any of these are wrong. I'll wire them in unless you say
otherwise.

---

## 4. LTHR + true MaxHR — how do we figure out yours specifically?

I'm building a calculator that derives LTHR from your race data:
- Half-marathon avg HR ≈ LTHR
- Marathon avg HR + 5-8 bpm ≈ LTHR
- 10K avg HR - 3-5 bpm ≈ LTHR

You said Big Sur + LA Marathon you averaged "high 150s/low 160s for
hours" — that puts your LTHR ~160-165, and your true MaxHR ~185-190
(not the 181 we had).

**Need from you:**
- Do you have actual avg HR for those races? If yes I'll use them
  directly. If no I'll guess 162 and you correct on profile.
- Or: 30-min all-out time-trial. You willing to do one? Avg HR over
  the final 20 min = LTHR.
- True MaxHR: do you remember the highest HR you've ever seen on the
  watch? That's a good lower bound.

Defaulting to LTHR 162, MaxHR 188 until you say otherwise.

---

## 5. Birthday vs age

Switching profile to store birthday (ISO date). Age computes
on-the-fly. Need: your birthday. Until then I'm storing the
existing age as-of-today and back-computing 1990-01-01 as a
placeholder.

---

(updated automatically by Claude as work progresses)
