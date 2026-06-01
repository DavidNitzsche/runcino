# Brief · standing recommendation · accept endpoint

**For:** backend / plan-adapter
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Awaiting backend implementation · web ships read surface in tandem
**Parent:** `designs/briefs/standing-recommendation-after-override-landed.md`

---

## TL;DR

The standing-recommendation read surface is live on Today (commit
following this brief). Runners now see the engine's current view of a
restored quality workout. No Accept action yet · the parent brief
offered "either route through existing proposal-accept OR add a
dedicated endpoint." Web's call: **add the dedicated endpoint.** The
proposal route requires generating a proposal row first, which is
state the standingRecommendation envelope doesn't carry.

---

## What we want

```
POST /api/plan/workout/[id]/accept-standing
  body: { suggestion: { proposedType?, proposedDistanceMi?, proposedDateIso? } }
  returns: { ok: true, workoutId, applied: { type, distanceMi, dateIso } }
```

Behavior:
1. Look up the active row for `workoutId`. Reject 404 if missing.
2. Apply the suggestion fields to `plan_workouts` (type / distance /
   date_iso, whichever are non-null in the body).
3. Write a `plan_adapt_accepted` row to `coach_intents` with the
   workoutId in `value.workoutId` so `checkAcceptedProposal` clears
   the standing recommendation on next render (the composer already
   reads this · see `standing-recommendation.ts`).
4. Mirror the existing adapter mutation path · same provenance fields,
   same audit trail. The runner accepted the engine's recommendation;
   it should look identical to an auto-applied adaptation in history.

Authorization · same as `/api/coach/proposal/[id]/accept`: must own
the workout.

---

## Why not route through proposals

The proposal-accept path is `POST /api/coach/proposal/[id]/accept` ·
keyed on a `plan_proposals.id`. The standingRecommendation envelope on
`seed.week[].standingRecommendation` has no proposal id (composer is
read-only, doesn't write proposals). Going through proposals would
mean:
1. Web POSTs to a new "create proposal from standing" endpoint
2. Backend creates the proposal row
3. Web POSTs to /accept on the new id

Two round trips, two backend endpoints, one new table row per Accept.
The dedicated endpoint is one round trip, one mutation, zero new rows
outside `coach_intents`.

---

## Why we shipped the read surface ahead of action

Per CLAUDE.md fully-autonomous doctrine · no stopping at comfortable
points. The read surface is value on its own · David can see what the
engine thinks even without an Accept button. Adding the button is a
follow-up commit once this endpoint lands. Less than a day's gap.

---

## Where the read surface is mounted

`web-v2/components/faff-app/views/TodayView.tsx` · below `<PlannedHeroV2>`,
between the hero and the metric tiles. Two severity styles:
- `sev-advisory` · cool slate-blue left edge
- `sev-firm` · warm amber left edge (matches the warn token elsewhere)

When the endpoint lands, two CTAs go inside the `.standrec-body` block:
- `[ Accept ease ]` · POSTs to the new endpoint with `suggestion`
- `[ Proceed ]` · no-op dismiss for this session only (no DB write ·
  re-renders the advisory next page load if signals still hold,
  which is the correct doctrine: the runner overrode their override,
  the engine respectfully holds its view)

---

## Acceptance criteria

- [ ] Endpoint accepts the suggestion payload + applies to plan_workouts
- [ ] Writes `plan_adapt_accepted` to coach_intents (workoutId in value)
- [ ] standing-recommendation composer clears the row on next render
- [ ] Existing adapter intent stream (CoachActivityTimeline) picks it
      up as a normal accept event
- [ ] Returns the applied fields so the frontend can optimistically
      update the hero card without a full re-fetch

---

## Related

- `designs/briefs/standing-recommendation-after-override-landed.md` ·
  the read surface (already shipped)
- `designs/briefs/restore-original-workout-endpoint-landed.md` · the
  override path that this is the second-opinion to
- `web-v2/lib/coach/standing-recommendation.ts` · the composer +
  `checkAcceptedProposal` filter
