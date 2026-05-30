# Open Questions for David

Questions surfaced during the full-auto audit pass that need your input.
Each one names the simulation that surfaced it, the candidates considered,
and the default I'd pick if no answer arrives.

---

## Q-01 · Beginner-runner volume floor (SIM-02)

**Where:** `web-v2/lib/plan/generate.ts:177` —
`let weekVol = Math.max(15, baseMi)`.

**The issue.** The plan generator floors weekly volume at 15 mpw for
race-prep. A true beginner running 5-8 mpw who picks a goal race would
get an immediate jump to 15 mpw in week 1 — way over the 10% rule.

**Candidates.**
- A · Scale floor by experience_level: beginner 10 / intermediate 15 / advanced 20 / advanced_plus 25.
- B · Use the runner's `history_avg_weekly_mi` from onboarding as the floor (no fallback ramp).
- C · Set a single low floor (e.g. 10) and let the ramp do the work.

**My default if no answer:** A — scaling by experience_level matches doctrine.

---

## Q-02 · 5K and 10K plan structures (SIM-02)

**Where:** `web-v2/lib/plan/generate.ts:118` — `isMarathon = raceDistanceMi >= 20`.

**The issue.** The only distance differentiation in the plan generator
is marathon vs not-marathon. 5K, 10K, HM all share the same QUALITY +
RACE-SPECIFIC structure. But doctrine (Research/22 plan templates) says:
- 5K: more VO2max work (intervals 6× at I pace), shorter base
- 10K: more threshold work, moderate base
- HM: balanced threshold + race-specific MP
- M: long-run progression dominant

**Candidates.**
- A · Build distance-specific phase mixes (5K-favoring intervals, 10K-favoring threshold, HM/M-favoring race-pace work).
- B · Keep the current "not-marathon" lump but tune the quality mix per distance.
- C · Defer until we have real 5K/10K runners (David is HM/M only today).

**My default:** A — but only worth doing once a real 5K/10K user shows up. Document the gap in the meantime.

---

## Q-03 · ILLNESS-mode trigger threshold (SIM-06)

**Where:** `web-v2/lib/plan/adapt.ts` doesn't have a sick_episode trigger today.

**The issue.** When a runner logs a sick_episode, what should the plan do?
- Above-the-neck cold, no fever → still train easy
- Below-the-neck OR fever → suspend hard work
- Severe → suspend all running

**Candidates.**
- A · Auto-downgrade all quality workouts in next 7d to easy when `sick_episodes.severity >= 'moderate' OR has_fever = true`.
- B · Always surface as a proposal (coach_proposals row) for runner accept/reject — don't auto-modify.
- C · Light touch: tag the workout with a hedge in coach voice but don't modify the plan.

**My default:** B — propose, never silently change the plan when illness is involved. Runner agency matters.

---

## Q-04 · Where does NIGGLE_REPORTED downgrade threshold (SIM-06)

**Where:** `lib/plan/adapt.ts` — no niggle trigger today.

**The issue.** What severity of niggle should cancel/modify the next quality session?

**Candidates.**
- A · Severity ≥ 5 (out of 10) → next quality day becomes easy.
- B · Severity ≥ 7 → suspend all running for 48h; ≥ 5 → downgrade quality.
- C · Always propose, never auto-modify (same as Q-03).

**My default:** B — graduated response. Doctrine (Research/05): pain ≥ 5/10 means stop the planned session; ≥ 7 means rest the area entirely.

---

## Q-05 · Race-added auto-plan-generate trigger (SIM-06)

**Where:** `POST /api/race` fires `bustBriefingCacheForEvent` but doesn't
call `generatePlan` for the new race.

**The issue.** When a user adds a new A-race, should the plan
auto-generate, or wait for explicit /api/plan/generate?

**Candidates.**
- A · Auto-generate when the new race is A AND there's no active plan OR the active plan's race_id ≠ new race.
- B · Always surface as a proposal — runner reviews + accepts.
- C · Generate only when the runner explicitly opts in during the Add Race flow.

**My default:** A — if no plan exists, auto-author. If plan exists tied to a different race, surface as proposal.

---

## Q-06 · Legacy → web-v2 RPE route migration (SIM-04)

**Where:** `legacy/web/app/api/activity/rpe/route.ts` exists; no v2 equivalent.

**The issue.** The iOS app's post-run RPE chip needs an endpoint. The
v2 deployment doesn't include legacy routes. The pattern in the data
plan is `/api/runs/[id]/rpe` — should I port it as-is or extend?

**Candidates.**
- A · Port verbatim to `/api/runs/[id]/rpe` (preserves iOS contract).
- B · Extend: capture RPE + felt-effort + notes in one route; write to `post_run_rpe` AND `check_ins`.
- C · Make it part of `/api/runs/[id]` PATCH so a single edit covers RPE + shoe + notes.

**My default:** A first (unblock iOS), then evolve to B in a follow-up. The check_ins integration matters for closed-loop coaching.

---

## Q-07 · users.timezone vs profile.timezone (SIM-01)

**Where:** Onboarding body writes `profile.timezone`; the data plan
says `users.timezone` is canonical.

**The issue.** Two columns hold timezone. Code reads from `users.timezone`
primarily (state-loader, briefing time logic), but onboarding writes
to `profile.timezone`. Result: a new user's timezone never lands in the
canonical column unless they hit a settings save later.

**Candidates.**
- A · Fix /api/onboarding/complete to write `users.timezone` as well.
- B · Drop `profile.timezone` from schema; read only `users.timezone`.
- C · Have `users.timezone` lazy-read from `profile.timezone` as fallback.

**My default:** A — minimal fix; keep both columns for back-compat, write to both.

---

*New questions appended below as the audit continues.*
