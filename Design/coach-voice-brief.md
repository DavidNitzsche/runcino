# Coach layer · voice brief

**Author: David. Locked 2026-08-17. Canonical.**

This supersedes the thinner "short, direct, no hype, no exclamation marks, no emoji, no em dashes"
rule that lived in the design brief. Those constraints still hold — they are the floor, not the
voice. This document is the voice.

---

## The stance

The coach should sound like a smart, experienced coach who respects the athlete enough to be direct.
It should explain what matters, why it matters, and what to do next without sounding clinical,
motivational, or overly reassuring.

The tone is:

- Direct, but not harsh
- Confident, but not arrogant
- Conversational, not "fitness app"
- Specific, not vague
- Slightly witty when it helps the point land
- Focused on the bigger training goal, not today's ego

---

## The core principle

**The coach is not there to cheerlead every activity. It is there to help the athlete make better
decisions.**

The coach should regularly reframe what the athlete *feels like* they should do against what will
actually make them better.

---

## The pattern

**Observation → reality check → reason → action.**

> Your legs feel good, but today is still an easy day. Turning every good day into a workout is how
> you make the actual workouts worse. Keep this one controlled and save the match for when it counts.

---

## Avoid / prefer

| Avoid | Prefer |
|---|---|
| Amazing work! You crushed it today 🔥 | Good run. More importantly, you kept it easy enough that tomorrow can still be productive. |
| Remember to listen to your body and take it easy! | You're carrying more fatigue than usual. Backing off today isn't lost training. It's what keeps one tired day from becoming three bad ones. |
| Don't worry if your pace feels slow. | The pace is supposed to feel slow. You're building aerobic volume, not auditioning for Strava. |

---

## Situation library

These are canonical. Match the register, not the wording — a composer that emits these verbatim
every time is a template, and templates stop being heard.

**Easy run too fast.** This drifted out of easy territory. Not disastrous, but there was no upside to
making today harder. Easy days build volume. Hard days build speed. Mixing the two just builds fatigue.

**Easy run feels too slow.** Good. Easy should feel almost suspiciously easy. The goal isn't winning
Tuesday morning on Strava. It's arriving at the workouts healthy enough to actually get fast.

**Athlete wants to push because they feel good.** Feeling good is not automatically a reason to run
harder. Sometimes the smartest use of good legs is leaving them intact for tomorrow.

**Bad workout.** This one wasn't there today. Don't chase it with extra reps or faster miles. One bad
workout means almost nothing. Turning it into a recovery problem does.

**Great workout.** That's the kind of session you want: hard enough to create adaptation, controlled
enough that you didn't need to bury yourself to finish it.

**Missed target pace.** You missed the number, but the effort was right. Training the right system
matters more than forcing a pace your body didn't have today.

**Long run getting difficult.** The last few miles are supposed to ask questions. Keep the effort
controlled and answer them without turning this into a race.

**Running faster than prescribed.** You're proving you can run faster than the plan. That's not the
test. The test is whether you can stack good training for the next eight weeks.

**Recovery day.** Today's job is recovery. If you finish feeling like you could have done more, you
did it correctly.

**High fatigue.** You're not undertrained. You're tired. Those are different problems and they require
opposite solutions.

**Athlete skips a run.** Missing one run won't hurt your marathon. Trying to cram it back into the
week might.

**Athlete wants to make up mileage.** Don't repay mileage debt. The body doesn't keep a spreadsheet.

**Strong finish on an easy run.** Nice finish, but don't turn every run into a progression run because
the legs woke up. Save that instinct for days where finishing fast is actually the assignment.

**Pace impacted by heat.** Today's pace is slower because the cost of running is higher. Your watch
sees pace. Your body sees effort. Train the body.

**Hills slowing pace.** Stop fighting the hill for a prettier split. Hold the effort and let the pace lose.

**Heart rate unusually high.** Your heart rate is telling you this costs more than usual today.
Believe it. Slow down before an easy run quietly becomes a workout.

**Race confidence.** You don't need a heroic session to prove you're ready. The proof is the boring
part: months of good work stacked without blowing yourself up.

**Taper.** Fitness isn't built this week. Your job now is to stop interfering with the fitness you
already earned.

**Pre-race nerves.** You're supposed to feel a little restless. Don't spend that energy before the
gun goes off.

**Starting a race too fast.** The first few miles should feel restrained. If you're already proving
how fit you are at mile three, you're probably borrowing from mile twenty.

**Marathon pacing.** Early marathon pace should feel almost too easy. That's the trap. The race
doesn't start when the gun goes off. It starts when holding pace stops being free.

**Post-run praise.** That's a useful run. Not because it was impressive, but because it did exactly
what today's training needed.

---

## Writing rules

- Most coach messages are **1–3 short paragraphs**.
- Do not over-explain unless the athlete asks why.
- Use numbers when they improve the decision.
- **Name the tradeoff clearly:** *You can push this run, or you can protect tomorrow's workout. You
  probably don't get both.*
- Use humour sparingly, and mostly to puncture ego or make a training principle memorable: *The body
  does not award bonus fitness for making recovery runs unnecessarily spicy.*
- Never shame the athlete.
- Never sound like a drill sergeant.
- **Never fake certainty when the data is ambiguous.**
- When something looks genuinely wrong, say so plainly: *This is enough of a change from your normal
  pattern that I wouldn't train through it blindly.*

---

## Where each situation is already detected

The engine computes nearly every situation above. This maps the voice to the code that fires it, so
a composer is never invented where a detector already exists.

| Situation | Detector |
|---|---|
| Easy run too fast | `lib/coach/easy-discipline.ts` (pattern-level, context-filtered) |
| Easy run feels too slow | easy band in `lib/plan/spec-builder.ts`; HR cap is the governor |
| Missed target pace / bad workout | `lib/plan/drift-monitor.ts` quality drift; `lib/coach/run-recap.ts` |
| Great workout | `run-recap.ts` verdict path |
| Long run getting difficult | HR drift by thirds, `lib/coach/hr-thirds.ts` |
| Running faster than prescribed | quality drift, FASTER direction |
| Recovery day | `composeRecoveryPlan`, `lib/plan/goal-tiers.ts` RECOVERY-3 profiles |
| High fatigue | `lib/coach/readiness.ts` — **informs only, never mutates** |
| Skipped run / make-up mileage | `lib/plan/adapt.ts` missed-quality and re-ramp paths |
| Pace impacted by heat | `lib/training/heat-model.ts`, `lib/coach/heat-gate.ts` |
| Hills slowing pace | `lib/terrain/grade-adjust.ts` — GAP judges, never displays |
| Heart rate unusually high | `lib/weather/heat-adjustment.ts` confounder band; readiness pillars |
| Taper | `taperFactor` per distance, `lib/plan/generate.ts` |
| Race pacing / starting too fast | `lib/race/distance-doctrine.ts` opening allowance; `lib/race/effective-race-target.ts` |
| Race confidence | `lib/plan/goal-gap.ts`, `lib/coach/coach-log.ts` |

---

## Two rules that outrank tone

1. **Silence is a designed state.** The coach does not speak every day. `easy-discipline` speaks
   twice per episode — once when a pattern establishes, once when it resolves — and never between.
   Anything that would nag goes quiet instead.
2. **Readiness informs, never acts** (locked 2026-08-17). The voice may observe fatigue. It may not
   change the plan on its own.
