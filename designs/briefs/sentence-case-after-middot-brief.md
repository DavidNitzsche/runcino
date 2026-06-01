# Brief · sentence case after the middot separator

**For:** frontend (faff-web)
**From:** backend / David call
**Date:** 2026-06-01
**Status:** Copy convention · trivial fix wherever you author helper text

---

## TL;DR

David: *"This 'productive but watch sleep + recovery.' is all lower
case. I want it and stuff like this to be sentence case. ALL-CAPS is
usually fine how its being used."*

When a sentence has two clauses joined by ` · ` (middot), the second
clause starts a new sentence. Capitalize it.

ALL-CAPS labels (LOADED, OVERREACH, PRODUCTIVE etc.) stay · those
are headers, not sentences. Only the descriptive copy below them
needs sentence case.

---

## The rule

```
WRONG  "Running hot · productive but watch sleep + recovery."
RIGHT  "Running hot · Productive but watch sleep + recovery."

WRONG  "Building your baseline · 5 more nights"
RIGHT  "Building your baseline · 5 more nights"   ← number, ok as is
       (only lowercase letters trigger the rule)
```

The middot acts like a period · capitalize what follows when it's
the start of a new clause.

---

## Where this lands

The composer copy that backend ships is now sentence-case (commit
`de55546b`). Helper copy that frontend authors needs the same sweep.

Known offender · the Training Form card helper copy from my prior
brief (`training-form-banister-frontend-brief.md`):

```
WAS                          NOW
DETRAINING        "Too fresh for too long · fitness eroding. Build back up."
              →   "Too fresh for too long · Fitness eroding. Build back up."

RACE-READY        "Primed for a race. Don't add new load this week."
              →   (unchanged · single sentence)

PRODUCTIVE        "Productive training · fatigue and fitness balanced."
              →   "Productive training · Fatigue and fitness balanced."

LOADED            "Running hot · productive but watch sleep + recovery."
              →   "Running hot · Productive but watch sleep + recovery."

OVERREACH         "Acute load above your baseline. Pull back this week."
              →   (unchanged · single sentence)

BUILDING          "Building your baseline · more data coming."
              →   "Building your baseline · More data coming."
```

---

## Where it doesn't apply

- Inline qualifiers and units: `Easy · Z2`, `Z4 · tempo`, `acute 10.9 ·
  chronic 6.0 mi/day` · these aren't sentences, the middot is just a
  separator
- Labels with descriptors: `A-goal · stretch but possible` · this is
  a label + qualifier, not two sentences
- Headers / titles: `RUNNING FORM`, `KEY WORKOUTS TO RACE` · stay
  in their existing case

The rule fires when both clauses would be standalone sentences with
a period replacing the middot.

---

## How to respond

1. Sweep any frontend-authored helper copy that violates the rule.
2. PR link when done · backend reads from your renderers via the
   composer string, no contract changes needed.

---

## Related

- `designs/briefs/training-form-banister-frontend-brief.md` · the
  brief with the old helper copy that needs the sweep
- `designs/briefs/em-dash-copy-sweep-brief.md` · same shape, different rule
- `designs/briefs/no-citations-lock-and-restore-uuid-cast.md` · same shape
