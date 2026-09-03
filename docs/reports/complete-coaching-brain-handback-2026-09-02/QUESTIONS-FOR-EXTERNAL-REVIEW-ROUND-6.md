# Questions for external review · round 6 (final)

Twenty. Deliberately broader than the plan engine, because the rulings so far
have settled *what the plan is* and left *how the runner meets it* largely open —
watch, post-run, proposals, notifications, and the edges.

**Each carries the default I will build.** "Defaults are fine" is complete.

---

## Watch and execution

**Q41 · How does the watch show a marathon-effort segment now that it is a range plus an HR ceiling?**
A range and a ceiling are two numbers on a small screen mid-run.
**Default:** show the pace range as the primary target, the HR ceiling as a
secondary field that turns amber when exceeded, and no grading on the wrist.

**Q42 · What should the watch do when he goes off-plan mid-run?**
He runs 18 when 15 was prescribed, or stops the structured workout and keeps
running.
**Default:** never interrupt, never stop recording, never truncate. The watch
records what happened; interpretation belongs to post-run.

**Q43 · Should the watch grade sessions at all, or only record?**
It currently grades on the wrist. Grading now depends on five outcomes, HR
corroboration and data-quality judgement — none of which the watch can do well.
**Default:** the watch shows live guidance only. All grading moves server-side
where the full evidence contract lives.

## Post-run

**Q44 · What is a "matched workout" compared against?**
The reference screenshots show matched-run comparison. Same workout type? Same
distance? Same phase of a previous block? Same session earlier in this block?
**Default:** the same session family within this block first, falling back to the
nearest comparable session in the last 180 days, with the basis always named.

**Q45 · Should post-run state the plan consequence immediately, or wait?**
Adaptation arbitrates at the weekly boundary, so on most days post-run has
nothing final to say.
**Default:** post-run always states the consequence honestly, including *"nothing
changes today; this is recorded as evidence and reviewed at the end of the
week."* Silence would read as "nothing happened."

**Q46 · How much should the app say per day?**
Rule 17 says the runner reads a sentence once. There is now a great deal the
engine could say.
**Default:** one coach paragraph on Today, one on post-run, one per week on
Block. Anything else is available on demand, not pushed.

## Races and evidence

**Q47 · How much should a tune-up race move the CIM projection?**
Santa Monica (B), Dodgers (C, controlled), Run Malibu (B half). A half four weeks
out is the strongest single predictor available.
**Default:** the half may move the projection materially; a B 10K moves it
modestly; the controlled C race does not move it at all, since it was not run as
a test.

**Q48 · How long does evidence stay valid?**
Doctrine says decay confidence, not value.
**Default:** full weight to 28 days, decaying confidence to 90, and beyond 90 it
informs but cannot alone authorise a change.

**Q49 · What happens when the watch and Strava record the same run differently?**
Distance, pace and HR can all disagree.
**Default:** one canonical row per run — the existing dedup — preferring the
watch record for structure and phases and Strava for route, with the disagreement
recorded rather than averaged.

**Q50 · What if he races something that is not in the plan?**
An unplanned parkrun, or a hard group run.
**Default:** it counts as evidence for the levers it genuinely tests, exactly
like any other session, but never re-phases the block. If it displaces a
prescribed session, that is a rescheduling question he initiates.

## Adaptation experience

**Q51 · Where does he see a pending proposal?**
**Default:** on Today when one is live, on Block for anything affecting future
weeks, and on the post-run screen of the session that triggered it — the same
decision rendered in three places, never three different claims.

**Q52 · Can he reject a proposal permanently, or only defer it?**
**Default:** both, explicitly. "Not now" re-offers when new evidence arrives;
"no" suppresses that specific proposal for the block and is recorded as his
decision, not as a refusal by the engine.

**Q53 · What does adaptation say before any evidence exists?**
In week 1 there is nothing to evaluate.
**Default:** it says so plainly — what it is waiting for and roughly when it
expects to have an opinion. Not silence, and not a fabricated "on track."

**Q54 · Should he be able to edit a workout directly?**
Distinct from rescheduling: changing a session's content rather than its date.
**Default:** no direct edit in this version. Rescheduling covers the real need,
and an unconstrained edit would silently invalidate the evidence contracts.
Worth revisiting once adaptation is trusted.

## Notifications and cadence

**Q55 · What should the app tell him proactively, if anything?**
**Default:** almost nothing. A proposal awaiting his decision, and a data problem
he can fix. No streaks, no encouragement, no daily nudge.

**Q56 · Is the weekly coach log worth keeping?**
It exists and has produced duplicate cards before.
**Default:** keep exactly one weekly entry — what the week asked, what he did,
what it changed — and delete the rest of the surface.

## The block and beyond

**Q57 · How much of the plan should he see at once?**
**Default:** the current week in detail, the block in outline, and any future week
on demand. Future weeks are labelled as forecast, since they will change.

**Q58 · Does the app do anything after CIM?**
**Default:** a retrospective and nothing else. No automatic next block. Starting
another build is his decision.

**Q59 · What happens if he gets injured?**
Injury automation is removed and the walk-run ladder is sealed. He will still get
hurt.
**Default:** he can pause the plan. It stops prescribing, keeps history intact,
and resumes when he says so. No diagnosis, no return-to-run ladder, no inference.

**Q60 · What is the single thing the app should be best at?**
Not rhetorical — it decides what gets polished first when time is short.
**Default:** telling him what today's session is for, and whether the last one
moved him toward the race. Everything else is secondary to those two sentences.
