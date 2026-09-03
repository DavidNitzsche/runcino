# Questions for external review · round 5

Ten. Q31-Q35 are the coaching bounds the new **rescheduling** capability needs
before it can rank anything. Q36-Q40 are runner-facing consequences of decisions
already made.

**Live case throughout:** his long run is **Sunday 2026-09-06, 15.0 mi**. That
week is Mon easy 4.5 · Tue threshold 8.5 · Wed easy 5.0 · Thu intervals 6.5 ·
Fri easy 5.5 · **Sat rest** · Sun long 15.0. He is away that weekend.

**Each carries the default I will build.**

---

## Q31 · How far may a workout move?

The ranked options need a boundary. Move a long run ±1 day, ±3 days, anywhere in
the same week, or into an adjacent week?

Moving Sunday 09-06 to Monday 09-07 puts it 1 day from Tuesday's threshold and 6
days from the next Sunday long run. Moving it to Saturday 09-05 puts it on a rest
day, 1 day after Friday's easy.

**Default:** ±3 days for a long run, ±2 for a quality session, and only into an
adjacent week when no in-week option preserves the stimulus.

## Q32 · What is the minimum separation between hard sessions?

Central to every reschedule ranking. After a long run of 15+ miles, how many easy
days before the next quality session? And how many after a threshold session
before a long run?

**Default:** ≥1 full easy day either side of a long run under 16 mi, ≥2 for 16+;
≥1 easy day between any two quality sessions. A reschedule that produces
back-to-back hard days is rejected unless the runner has no alternative and the
tradeoff is named.

## Q33 · What happens to the FOLLOWING long run after a move?

If Sunday 09-06 moves to Monday 09-07, the next long run on Sunday 09-13 is only
**6 days later** — and 09-13 is the Santa Monica 10k. Does the following long run
also shift, or is a 6-day gap acceptable once?

**Default:** accept a one-off 6-day gap when the two runs are not both large;
shift the following long run only if both exceed 15 mi or the second is a
marathon-specific session.

## Q34 · May a reschedule move a workout into a cutback week, a race week, or the taper?

These weeks are authored with a deliberate shape. A displaced long run landing in
one could undo it.

**Default:** never into race week or the taper. Into a cutback week only if the
week's total stays within its intended reduction and the runner is told what it
costs.

## Q35 · When is SPLITTING a long run legitimate rather than a compromise?

Listed as an option. Splitting 15 miles into 8 + 7 on consecutive days preserves
volume but arguably destroys the point — the stimulus is sustained time on feet,
and for this runner durability is the whole priority.

Is splitting ever the right answer for a long run, or should it be reserved for
non-long sessions, with "shorten" preferred as the honest last resort?

**Default:** never split a long run whose purpose is durability or
marathon-specific work. Offer it only for base-phase long runs where accumulated
volume is genuinely the point, and label the tradeoff explicitly.

## Q36 · What should the app do with a workout that is simply MISSED?

Missed-training *automation* is deferred, but a missed workout will happen and
the app must show something. The runner did not ask to reschedule; the day simply
passed.

Options: state it plainly and move on · offer a reschedule retrospectively ·
record it as evidence · do nothing at all.

**Default:** state it plainly and offer nothing automatically. It is recorded as
"not completed" with no interpretation, no plan change, and no fitness inference.
The runner may still reschedule a *future* workout, never a past one.

## Q37 · When does the race execution plan LOCK?

Ruled: *"By race week, the system must select one specific execution plan with a
range for uncertainty — not four competing targets."*

When exactly? After the last marathon-specific session? At a fixed number of days
out? After the final tune-up?

**Default:** lock at **10 days out**, after the last session capable of changing
the evidence, with the range retained for uncertainty and no further movement
except a runner-approved change.

## Q38 · What does the runner SEE for each of the five stimulus grades?

Grading now returns FULL · SUBSTANTIAL · PARTIAL · DIFFERENT · INSUFFICIENT. What
should each mean to him on the post-run screen — and does any of them warrant an
explicit "this changes nothing" statement?

**Default:** FULL and SUBSTANTIAL read as the session having done its job, with
SUBSTANTIAL naming what was adjusted for. PARTIAL and DIFFERENT say plainly what
was missed or what actually happened instead. INSUFFICIENT says the data could
not support a judgement — never that the session was bad. All five explicitly say
whether anything in the plan changed.

## Q39 · Should the runner ever see confidence numbers?

The engine carries them — the coaching thesis at 0.51, the expected-improvement
model at 0.585. Internally they are load-bearing. Externally, "we believe this at
0.51" may be worse than useless.

Show them, translate them to words, or keep them internal and show only the
resulting uncertainty range?

**Default:** never show a number. Translate into the range and the honest
sentence — "this rests on a population assumption, not on your measured
response." The number stays in the decision record for audit.

## Q40 · After a move, is it the SAME workout?

If the 15-mile long run moves to a day where only 12 fits, is that the same
workout rescheduled, or a different one? It matters for evidence: a completed
12 against a prescribed 15 is a PARTIAL, but if the reschedule *authored* 12 then
completing 12 is FULL.

**Default:** a reschedule that changes distance or structure re-authors the
workout at the new prescription, so completion is graded against what was
actually asked. The original prescription is retained in the decision record so
the reduction is visible, and never silently.
