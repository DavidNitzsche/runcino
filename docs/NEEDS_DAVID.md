# NEEDS_DAVID

A running list of things I've intentionally parked because they deserve
your eyes before I rip into them. I keep building everything else
autonomously — these are the items where decisions cascade and a wrong
call wastes a lot of work.

When you have a sec, react to any item (Slack message, voice memo,
edit this file, whatever) and I'll unblock it next session.

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

---

## 2. Strava push (not pull) — destination architecture

You said: watch + Apple Health are source of truth, Strava is push-only.

This changes the whole sync model:
- Currently: web reads strava_activities table populated by Strava webhook
- New: iOS uploads watch HealthKit workouts → our API writes strava_activities
- Then: our API pushes the same workout to Strava as a public post

**Questions:**
- Do you want the Strava post to include coach-voice race recap
  (post-race), or just the raw HR/pace data + the user's title?
- For non-race runs, just the activity itself with no commentary?
- Should we keep the existing strava-webhook receiver as a fallback
  for runs not done with the watch (e.g. treadmill on Peloton)?

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
