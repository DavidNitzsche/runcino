# Brief · no research citations in surfaced copy · drop unlikely confounders

**For:** backend / coach-engine agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Two locked product calls · frontend shipped defensive
guards today; backend should fix at the source.

---

## David, 2026-06-01

> "should never surface things like the 'Research/00b says' ever."

> "lets remove all 'also worth checking' · it's just noise"

---

## 1 · Strip research citations from every authored string

Backend currently writes copy like:

> "Sleep below the 7.5h target 8 nights running. Cumulative debt
> compounds · Research/00b says single short nights don't matter,
> sustained dips do."

The `Research/00b says` clause has to go. Doctrine citations are for
the engine's logic, not for the runner's screen. The `pillar.citation`
field is already documented as "do not render"; the same rule applies
to ANY user-facing string the composer authors.

### Surfaces where citations have been seen / are likely

- `ReadinessBriefSeed.streaks[].meaning`
- `ReadinessBriefSeed.streaks[].short` (possible · need audit)
- `ReadinessBriefSeed.pillars[].meaning`
- `ReadinessBriefSeed.pillars[].confounders[].explanation`
- `ReadinessBriefSeed.trendNote`
- `ReadinessBriefSeed.watchTomorrow[]`
- `ReadinessBriefSeed.subjectiveOverride.advice`
- `ReadinessBriefSeed.coldStart.note`
- `coach_intents.body`
- `plan_proposals.message` / `reason`
- Anywhere else the composer authors prose

### Patterns to strip at the source

```
· Research/00b says single short nights don't matter, sustained dips do.
per Research/15 §HRV approach
Research/15 §Subjective Measures locks this in.
Research/12 notes ...
```

Simplest fix: when the composer drafts a string, never include
`Research/XX` references. The math + doctrine reference live in code
comments; the runner-facing string carries the human meaning only.

### Frontend defensive guard (shipped today)

Until backend lands the source-side fix, frontend's drawer applies
`stripCitations()` to every visible string from the readiness brief
envelope. Strips four patterns:

1. ` · Research/XX says ...` (middot-prefixed clause to next period)
2. ` per Research/XX §...` (inline reference)
3. `Research/XX says/notes/reports/finds/shows ...` (sentence-leading)
4. Any bare `Research/XX` reference + trailing tag-like content

The strip is a backstop, not the structural fix. When backend ships
clean copy, the helper becomes a no-op. The helper stays as defense
against regression.

---

## 2 · Drop unlikely-confounder emission entirely

Per the screenshot David shared, the drawer's "ALSO WORTH CHECKING"
section showed three confounders for SLEEP — schedule debt, late
caffeine, race-week travel — all marked `likely: false`. None of them
were actually the cause; they're "alternative explanations the engine
can think of." The runner reads them as noise.

### What frontend just did

Removed the entire `ALSO WORTH CHECKING` rendering. The drawer now
surfaces only `confounders.filter(c => c.likely)` under "MOST LIKELY
BEHIND IT". Unlikely confounders sit dormant in the seed payload.

### What backend should consider doing

Two options:

**Option A · Stop emitting unlikely confounders entirely.** If a
confounder isn't probably-causal, it doesn't earn its place on the
seed. The engine still considers all candidates internally; only the
ones the model genuinely backs (i.e. `likely: true`) get emitted.

**Option B · Keep emitting them but bump the bar on `likely`.** If
the threshold for marking `likely: true` is currently low (e.g. >30%
probability), raise it so the surfaced ones are meaningful (e.g. >55%).

Frontend recommends **Option A**. Simpler, less data shipped, and the
"`likely: false` confounder" concept doesn't add value · if it weren't
worth surfacing, why emit it.

If you keep them around for future surfaces (e.g. a "diagnostic
explorer" view), document where they'll be used. Otherwise the field
is dead weight.

---

## How to respond

1. Confirm sweep of all composed strings removes `Research/XX`
   references (and any other doctrine notation like `§...`).
2. Confirm preferred option for confounders · A or B.
3. PR link when shipped · frontend keeps the defensive guard live
   either way; if you also want the guard removed once your sweep
   lands I can do that in a follow-up.

---

## Related

- `designs/briefs/em-dash-copy-sweep-brief.md` · same shape, different
  character. Same locked principle: copy rule lives at the copy layer.
- `designs/briefs/readiness-brief-field-additions.md` · the original
  ask that landed the trend/meaning/etc. text in question.
- `designs/from Design agent/readiness-drawer/README.md` · explicitly
  says "No research citations anywhere" on the rendered panel · this
  brief generalizes that doctrine to all surfaces.
