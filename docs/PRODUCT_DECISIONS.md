# Product decisions

Decisions taken deliberately, with the reasoning, so they are not silently
re-litigated. Newest first. A decision here is not permanent — it is recorded
so that changing it is a choice rather than an accident.

---

## 2026-08-30 · CIM block audit · coaching decisions

Taken while auditing the 14-week California International Marathon block that
auto-authors 2026-08-30 21:00 PT. Four calls made as coach rather than as
engineer, two of them overruling a recommendation from an audit.

### 1 · The demonstrated VDOT ceiling does NOT change the block's paces. HELD.

**The finding.** `seasonalVdotCeiling` takes only current VDOT, which is bounded
by an 84-day pace-freshness gate. The block's modelled best case is therefore
VDOT 46.85, and the runner ran **VDOT 48.0** at the Disney Half on 2026-02-01.
A grep for `seasonBest|lifetimeBest|peakVdot|demonstratedCeiling` returns zero
matches: nothing in the engine carries a demonstrated ceiling at all. Anchoring
on Disney would lift the ceiling to 50.75, bring the 3:00 goal inside the 5%
optimism tolerance, and swing every marathon-pace segment from 7:41 to 6:52.

**Decision: do not.** Disney is one race. The other five cluster 42.8–45.9, and
Rose Bowl two weeks earlier was 45.9. This is not a detrained 48-runner; it is a
44–46 runner who had one excellent February day. Training marathon-pace segments
at 6:52 would prescribe a pace ~70 s/mi faster than his most recent half-marathon
race pace — the classic way to wreck a marathon build. The engine's conservatism
is correct here and the audit's implied fix would have made the block worse.

**What is genuinely wrong, and is follow-up work rather than pre-authoring work:**
the ARCHITECTURAL gap is real. A runner returning from injury after a VDOT 60
season is capped at current + 5.0 with no memory of what they have done. Doctrine
supports the distinction — `Research/01` §"Testing cadence" models a layoff as
"Drop 3-5 VDOT; rebuild then test", i.e. prior fitness is a level you fall from
and rebuild toward, not one that is erased. A demonstrated ceiling should bound
the block's DESTINATION while leaving today's PACES on current evidence. Not
built tonight; nothing about it is urgent for this runner.

### 2 · The long-run curve is unchanged. HELD, on the owner's ruling.

The 110%-of-prior-30-days rule scores week 5's 19-miler as a 122.6% spike. The
owner accepted it explicitly: "a 19 miler in week 5 feels okay for me if week 1
starts with a 14 mile long run." He is right on the merits and the rule is what
misleads: **he ran 18.0 miles on 2026-07-25**, 36 days out and therefore invisible
to a 30-day window. Against demonstrated capability the week-5 long is +5.5%, not
+22.6%. Left untouched.

### 3 · The taper is doctrine-correct. VERIFIED, no change.

Checked because a prior note claimed the taper should be 70/55/40 of peak.
`TAPER_DESCENT_SHAPE` with the marathon's `TAPER_RACE_WEEK_PCT_OF_PEAK` of 0.45
yields **82% / 60% / 45%**, and the authored block runs 47.5 / 33.5 / 18 against a
59.5 peak. That is the doctrine shape. The earlier concern was unfounded and the
70/55/40 note refers to a superseded revision.

### 4 · `level: advanced` is the right label. VERIFIED, no change.

Research/22's Advanced Marathon row wants a 50+ mi/wk base, a 65–90 peak and a
22–24 mi long; the block delivers 59.5 and 21.5 off a 43.5 sustained base, all
below that band. This is `cycleBoundedPeak` working correctly — `CYCLE_GROWTH_CEILING`
of 1.15 against a measured 52.3 peak gives 60.14, and the block lands just under
it. A runner cannot go from a 52 peak to 65–90 in one cycle. The label is
aspirational on the volume axis and safely bounded.

It is **not** inert, so it should not be removed as bloat: `level === 'advanced'`
gates the medium-long run, which is a Research/22 advanced key workout and appears
in weeks 6–11. Given multiple marathons, a time goal, and a correctly embedded
tune-up half, advanced is right.

### 5 · Marathon-pace label truth. CHECKED, already correct.

Investigated on suspicion that the prose "Marathon effort at the fitness you have
shown" was printed over a modelled pace. It is not. `MPLABEL-1` (2026-08-25)
already split `resolveMarathonPace` into an explicit `'goal' | 'current_fitness'`
source and the prose is selected from it. Three tiers are correctly distinct:
MP segments at current fitness (~7:56/mi), race-day target 7:41 from the modelled
ceiling with `basis_modelled: true`, and the stated 3:00 goal untouched on the
wall. This is exactly the owner's stated rule — paces from evidence, the goal
never distorts training. Recorded so the next auditor does not re-open it.

### 6 · The phase-structure gate stays RED. Not loosened.

`_coach_sensible.test.ts` asserts zero phase-structure discontinuities across a
walk, and it fails: `interruptionWeeks` is an integer count of leading weeks
below the resume level, so an entire BASE phase appears or disappears on a
**0.20 mi/wk** change in the runner's 28-day mean.

The fixing agent argued the gate is stricter than doctrine supports, because a
phase is binary — you cannot author half a BASE block — so SOME boundary must
exist. That is true and it is not the point. The defect is not that the phase
list is discrete; it is that a whole training phase turns on a hair-thin,
arbitrary crossing of one noisy statistic. The honest fixes are hysteresis or a
more robust input, not a wider tolerance around the same cliff.

So the gate stays red and named. CLAUDE.md is explicit that a claim revealing a
real violation is never loosened — you add an argued exemption or you fix the
engine. A red gate that names an open question beats a green one that hides it.
Not fixed tonight because it does not affect this block: the owner sits clearly
on the QUALITY side of the boundary, not near it.

### 7 · Easy days are uniform where a coach would vary them. TOP FOLLOW-UP.

After the volume fixes, week 1 authors four easy days of exactly 4.0 miles each.
That is his measured easy-day median and a defensible first week back — but four
identical easy days is not what a coach writes. A real week has a short recovery
day after the long run and longer general-aerobic days elsewhere.

Doctrine draws that line: `Research/00a` §1 prices an easy/recovery run at 20-75
min, §2 prices general aerobic at 40-75 min. At his 8:34/mi easy pace a 4-mile
day is 34 min — a legitimate EASY run, and below the general-aerobic floor. So
the block currently authors every easy day as a recovery day.

The cause is structural and named: `flooredPerEasy = min(effectiveFloor,
perEasyBudgetCap)` in `layoutWeek` caps the demonstrated-easy floor by whatever
budget the long run and quality sessions left over, so the floor can never bind
when the budget is tight. Easy running is the residual. Fixing it means
reordering how a week is budgeted, which moves the archetype sweep — deliberately
NOT attempted hours before a live block authored. Gate first, fix next.

### 8 · Deployment call, recorded because an agent declined it.

The agent that fixed the ramp declined to merge its own work to `main`, on the
grounds that a production deploy is externally consequential. That caution is
right as a default and wrong here: CLAUDE.md's deployment doctrine says Claude
does the git and the owner approves the fix, not the push, and the owner had
explicitly handed over autonomous code deployment for this session. Data writes
remain his, and none were made. I merged it.

---

## 2026-08-30 · The block is built whole and flexes on two axes. SETTLED.

**The question.** Should the plan build a week or two at a time, to make it truly
adaptive?

**The answer, David's, and it is narrower than what was being designed:** *"I
think the whole block should be built but week to week there can be shifts in
pace or distance as needed. So there's still confidence there in seeing
everything but adaption to the runner."*

### What that settles

- **All fourteen weeks are authored and visible.** He wants to see the arc — the
  peak, the two 20-milers, the taper date. No shortened horizon, and no
  committed-window / provisional-arc split in the UI.
- **Layout, session types, dates, phases and taper are FIXED once authored.**
  This is now a constraint rather than a risk to mitigate. That fixity is what
  makes the block trustworthy instead of churning, and churn was the thing he
  named first when he said he did not want to wake up to a plan he did not
  recognise.
- **Pace and distance flex on the weeks not yet run.** That is the whole
  adaptation surface.

### Why this supersedes the weekly re-composition design

`docs/design/weekly-recomposition-committed-window-and-provisional-arc.md`
(2026-08-30) was written to a broader brief. Its committed-window and
shortened-horizon sections are superseded; its anti-ratchet work is not and
should survive — `resolvePeakWeekly` is a max over a rolling 112-day window, so
the block's peak falls when the week that set it **rolls out of the window**
rather than when the evidence changes. That is a time-driven regression, and it
would directly betray "seeing everything" by quietly walking the arc down.

**The audit reached the same conclusion independently, and argued against me.**
My hypothesis was that re-composition would dissolve the push problem. It would
not have: the reason nothing ever pushed was two gate defects, not the
architecture — a gate querying `data->>'type'`, a field that has never held a
session type, and a bump veto three domains stricter than the pull-back it
mirrors. Both fixed 2026-08-30. Recording that the agent was right and the
hypothesis was wrong, because the alternative was a large re-architecture that
would not have fixed the thing it was aimed at.

### What this makes the real work

A block that cannot flex is a printout, so the adjustment layer IS the product:

1. **The progression gate is dark** — 25 quality days in his block, one carries a
   `workShape`, and that one has `lever: null`, so ACCELERATE is unreachable by
   construction. 5 of 4,536 rows database-wide.
2. **Missed-session grading is unimplemented** — the graded rule (reshuffle early,
   absorb late) has neither implementation nor gate, and `chooseRescheduleDate`
   can push a Thursday miss into the following week.
3. **Provisional-week volume re-derivation** — the "distance shifts" half of his
   sentence, and the narrowest useful version of the original design.

---

## Standing constraints referenced above

- Paces come from evidence. The goal stays visible and never distorts training.
- Current fitness is a safety floor, not a ceiling; the app's job is forward progress.
- The coach projects and never renegotiates a stated goal via a card or button.
- Modelled numbers are marked as modelled. Showing a modelled gain as measured is
  the one unforgivable error.
