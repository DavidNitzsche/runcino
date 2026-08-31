# faff.run — Reference Case: Inferring Structure From an Unlabeled Long Run

**Real run, David's account, 2026-08-30. `runs` table, `user_uuid =
0645f40c-951d-4ccc-b86e-9979cd26c795`, canonical row id `-245190372869167`,
source `watch`, 13.49mi, 6163s (1:42:43), avg HR 159, `workoutType: 'long'`.
Locked as a doctrine regression fixture, paired with
`docs/reference-cases/easy-run-warm-conditions-2026-08-31.md`.**

## The real per-mile data (already in the DB — richer than a manually-read TCX, includes HR)

| Mile | Pace | HR |
|---|---:|---:|
| 1 | 8:25 | 145 |
| 2 | 8:10 | 142 |
| 3 | 7:50 | 147 |
| 4 | **6:52** | **166** |
| 5 | **7:22** | **166** |
| 6 | 8:38 | 149 |
| 7 | **7:16** | **166** |
| 8 | **7:33** | **164** |
| 9 | **7:54** | **166** |
| 10 | **7:27** | **168** |
| 11 | 8:30 | 168 |
| 12 | 8:21 | 161 |
| 13 | 8:25 | 163 |

Whole-run average: ~7:37/mi. David's own analysis, done outside faff from a
TCX export (no HR in that file), independently identified the same
structure from pacing alone. The DB's HR data goes further than that
analysis could: **miles 11-13 ease in pace (8:21-8:30/mi) but HR stays
elevated (161-168)** — some cardiovascular cost persisted into the close
even as external output backed off. This is real signal the pacing-only
read couldn't see, and the fixture should hold the implementation to seeing
it too.

## Part 1 — Inferring structure without a label (the general capability)

### The learning

Sometimes faff will not know the intended workout structure. That must not
mean the activity gets reduced to "13.5 miles at 7:37/mi." The engine
should examine the activity and infer: where effort changed; whether those
changes were structured; whether there were repeated work/recovery blocks;
what physiological systems were likely trained; what useful evidence the
run produced. The activity itself can tell a story.

### Do not depend on labels

A generic recorded run may contain easy running, threshold blocks,
intervals, progression, race-pace work, recovery segments, a fast finish.
The engine identifies those patterns from the data, using intended
structure (when available) as a useful PRIOR, never a prerequisite.

### Reconstruct the activity

Use pace, power, heart rate, grade, duration, recoveries, transitions,
pauses, subjective effort when available, to segment the run:

```
RAW RUN
  → remove pauses / bad samples
  → detect meaningful intensity changes
  → group sustained segments
  → identify work / recovery pattern
  → classify likely physiological intensity
  → extract evidence
```

For this run specifically, the inferred structure is: easy → sustained
quality block (mi 4-5) → recovery (mi 6) → sustained quality block (mi
7-10) → easy finish with residual elevated HR (mi 11-13).

### Infer physiology, not workout names

The system does not need to reconstruct "this was a Broken Long Run with 3
LT blocks." It should say internally: "there are sustained higher-intensity
blocks inside a long-duration session," then evaluate what those blocks
actually demonstrate.

```
ObservedSegment {
  duration
  pace
  power        // not available for this run — note the gap, don't fabricate
  heart_rate
  grade
  relative_intensity
  physiological_classification   // easy aerobic | steady aerobic | threshold-like | high-intensity | recovery | race-specific | unknown
  confidence
}
```

Use confidence. Do not fake certainty.

### One run can tell multiple stories

This activity provides: threshold-LIKE evidence (from the sustained faster
blocks — corroborating, not sufficient alone to set an exact number);
durability evidence (whether similar quality survives late in a 100+ minute
run — the stronger signal here); recovery evidence (how the runner responds
between blocks — mile 6's HR drop to 149 before climbing again); training-
load evidence (the whole session). It should not be forced into one bucket
called "Long Run."

### Sequence matters

A strong block 70 minutes into a run is different evidence from the same
block 10 minutes in. Ask: did output hold up as accumulated duration
increased? If later blocks remain similar → quality is surviving duration
well. If later blocks deteriorate substantially → threshold-like ability
may be present, but carrying it late appears to be a limiter. Neither
conclusion requires knowing the planned workout. **For this run:** the
second quality block (mi 7-10, 4 miles) held up about as well as the first
(mi 4-5, 2 miles) on pace, but ran at comparably high HR for longer — that
itself is meaningful durability evidence (sustained quality-adjacent effort
across TWO separate blocks late into a long run, not just one).

### Whole-run averages are secondary

For structured or variable runs, average pace/HR/power are summary
statistics, not primary evidence. The primary evidence is the SHAPE of the
run. Doctrine: understand the pattern before interpreting the average. The
7:37/mi whole-run average for this run is close to meaningless on its own —
it blends two genuinely different physiological demands (easy aerobic
running and sustained threshold-adjacent work) into one number that
describes neither honestly.

### Pattern detection should be conservative

Do not turn every pace fluctuation into a workout block. A meaningful
segment requires: sustained duration, meaningful intensity change, enough
data quality, relative stability within the segment, separation from
neighboring effort, physiological support where available. Stoplights,
hills, GPS noise and brief surges should not become "intervals." (Note: this
run has real splits, not raw GPS points — segment detection here operates
at mile-split granularity, coarser than second-by-second; say explicitly
what granularity was actually used and what that limits.)

## Part 2 — What specifically to conclude from THIS run (David's own analysis, worked)

### 1. Threshold/sustained-speed evidence: positive, corroborating, NOT sufficient alone

There is substantial fast running embedded in a 103-minute run — not one
lucky fresh mile, but repeated periods in the low-7s/high-6s separated by
easier running, continuing well into the session (miles 7-10 are still
7:16-7:54 after the mile-6 recovery). Treat as meaningful corroborating
threshold evidence. **Critical distinction: evidence that an existing
threshold estimate may be too conservative is NOT the same as enough
evidence to set threshold to an exact new number.** One run, however
strong, does not set the anchor — it takes independent corroboration per
the existing corroboration-count discipline already built tonight.

### 2. The stronger signal is durability

This is exactly the question the durability anchor exists to answer: how
much of the runner's shorter-duration capacity survives accumulated
running? Faster portions well into the run, followed by completing the full
13.5 miles, is POSITIVE evidence — this is not a runner with decent short
speed who loses it once duration accumulates. Weight this into the
durability ledger with meaningfully MORE weight than an ordinary easy run
(compare: `docs/reference-cases/easy-run-warm-conditions-2026-08-31.md`'s
"low-to-moderate supporting" weight — this run's structured, repeated,
sustained-into-late-duration quality work should weigh distinctly higher).

### 3. Quality-under-fatigue is a concept to explicitly preserve

A 7:00-ish effort at minute 15 and a 7:00-ish effort after an hour of
running are NOT equivalent observations. The latter carries information
about durability, fatigue resistance, ability to recruit threshold-ish
capacity after accumulated load, and race-specific endurance. This run
provides that evidence (the mile 7-10 block, well after the mile 4-5
block). Valuable specifically for half-marathon and marathon prediction.
**Implementation requirement: the evidence output must be able to express
WHERE in the accumulated-duration timeline a quality block occurred, not
just that one occurred** — this is what makes sequence matter, per Part 1.

### 4. The easy portions matter too — and the HR nuance the pacing-only read misses

Miles 11-13 (8:12→8:04→8:07 in David's TCX read, 8:30/8:21/8:25 in the DB's
canonical splits — close enough to be the same pattern, minor GPS/source
variance) show no obvious late-run pacing collapse; the runner returned to
normal-looking aerobic pace and continued rather than falling apart into
9:00-10:00 pace. That supports "the quality work was controlled, not
destructive." **But the DB's HR data adds a real qualifier a pacing-only
read cannot see: HR in those closing miles stayed at 161-168, not settling
back toward the 142-149 seen in the opening easy miles.** That's a mild,
real signal of accumulated cardiovascular cost outlasting the pace
reduction — worth carrying as a distinct, lower-weight observation
alongside the "no pacing collapse" conclusion, not silently dropped because
the pacing story alone looks clean.

### What NOT to conclude

Do not say "threshold is definitely 6:45/mi, or 6:52/mi" — insufficient
clean, isolated physiological data for that exact a number from one mixed
run. Do not treat this as a large upward fitness jump. **Do not take the
7:37 whole-run average, compute a VDOT from it, and call that fitness** —
David's own words: "that would be garbage because the activity deliberately
mixes easy and quality running." This is the exact failure mode
`vdot-corpus.ts` already guards against for the aggregate corpus reader;
this fixture proves the SAME discipline must apply inside a single
multi-segment activity, not just across a runner's history of activities.

### Target evidence-engine output shape for this run

```
Threshold: positive corroborating evidence (not anchor-setting)
High-intensity: little/no meaningful evidence (blocks are threshold-adjacent, not VO2/rep-pace)
Durability: meaningful positive evidence, weighted above an ordinary easy run
Quality under accumulated load: positive evidence
Late-run deterioration: no pacing collapse; MILD residual HR elevation (161-168 vs opening 142-149) — a distinct, lower-weight observation
Fitness adjustment: NONE by itself — see the belief-challenge behavior below
Confidence: improved (this observation strengthens the CASE for re-examination, does not itself resolve it)
```

## Part 3 — The critical behavioral principle: evidence can challenge a belief without updating it

This is the most important lesson from this run, and it must become an
explicit, named behavior distinct from both "update the anchor" and "ignore
the observation":

> **Evidence doesn't only update fitness. Evidence can tell the model that
> its existing belief deserves re-examination.**

Concretely: suppose the current threshold-capacity belief is ~7:15/mi. This
activity arrives, showing repeated sustained running meaningfully faster
than that, well into a long run, without collapse. A naive system either
(a) ignores it because one run isn't corroboration, or (b) overreacts and
resets threshold off one data point. **Neither is correct.** The correct
behavior is a THIRD outcome: the belief is NOT changed, but the system
notes explicitly that this observation is in tension with the current
estimate, and that tension should make the NEXT corroborating observation
(if one arrives — e.g. two or three more recent sessions showing sustained
~6:45-7:00 work) resolve decisively rather than needing to independently
re-clear the full corroboration bar from zero. If this run is a genuine
early signal of improved fitness, the system should become measurably
*more* receptive to the next piece of confirming evidence, not treat it as
an unrelated fresh data point.

**Implementation requirement:** the evidence-engine output for a single
activity should be able to carry a flag/field expressing "this observation
sits in tension with an existing capacity belief" (e.g.
`CONTRADICTS_CURRENT_ESTIMATE` or equivalent, alongside a note of the
magnitude and direction) — distinct from the corroboration-count mechanism,
and it must NOT itself move the anchor. This is a signal for the Runner
Model layer to consult (a lower future corroboration bar, or elevated
attention) when it next resolves the capacity, not an instruction to update
anything right now. Whether that consuming behavior gets built in this
phase or is explicitly named as a follow-up for the Runner Model layer is
your call — but the SIGNAL must exist and be computed here, in the Evidence
Engine's output for this activity, because this is the ownership layer that
sees the raw comparison.

### The coaching line this produces

Not: "your threshold pace is now 6:52/mi." Better:

> **Strong endurance work.** You produced several sustained faster efforts
> throughout a 100+ minute run and continued running normally afterward.
> That's useful evidence that your sustained-speed fitness carries well
> into longer efforts. This supports both your threshold and durability
> picture. One workout isn't enough to redefine your fitness, but it
> strengthens the case that your current capacity may be higher than older
> estimates alone suggest.
>
> Fitness evidence: Threshold ↑ (watching) · Durability ↑
> Confidence: Improving
> Plan: No immediate change — corroborate with upcoming quality work.
