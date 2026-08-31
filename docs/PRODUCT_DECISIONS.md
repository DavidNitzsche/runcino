# Product decisions

Decisions taken deliberately, with the reasoning, so they are not silently
re-litigated. Newest first. A decision here is not permanent — it is recorded
so that changing it is a choice rather than an accident.

---

## 2026-08-31 · The Pace Prescription layer is WIRED, on the flex path. Four calls made during the wiring. SETTLED.

`lib/plan/recompute-paces.ts` and `lib/plan/reanchor-plan.ts` — the mechanism
that rewrites pace on a live block's unrun weeks, per the 2026-08-30 "built
whole, flexes on two axes" decision — now price every zone through the four
canonical capacity resolvers and `resolveCapacityPrescription`. They no longer
call the VDOT cascade at all. `generate.ts`'s full-block authoring path is
deliberately still on the old cascade and is its own scoped pass; the flex runs
daily and is the last writer on every unrun day, so a block authored on the old
numbers converges rather than showing two answers at once.

Four decisions were required to land it, all made with full authorization while
David was away.

### 1 · The shakeout pad is 30 s/mi, and it is READ rather than chosen

The 2026-08-31 shakeout decision settled the shape and left the number "to be
set in the wiring phase, argued as a named convention ... since no doctrine
source prices this distance to a number." One does.

`Research/04` §1's Variations row names the session — "Recovery shakeout
(15-20 min)" — so a shakeout is a RECOVERY run in the corpus's own vocabulary,
not a fast easy day. `Research/01` §"Hansons pace methodology" then prices both
bands against one shared MP anchor, two adjacent rows: Recovery MP+90-120, Easy
MP+60-90. The recovery band begins exactly where the easy band ends, so the pad
is 90 − 60 = **30 s/mi**, differenced out of two doctrine cells at run time by
`PACE.shakeout-ceiling-is-the-recovery-band`.

This is also what the engine already did, one anchor over: `spec-builder`'s
shakeout branch has always opened the band at `easyHi`. What changed is only
where that rule is anchored — on the runner's measured easy ceiling instead of
on a threshold-derived offset.

### 2 · The current→goal threshold blend is DELETED from the flex path, not softened

`blendedTPaceForWeek`, `measuredProgressFraction`, `tPaceFromGoal` and
`maxSeasonalVdotGain` ran a per-week ramp from measured fitness toward a
goal-derived ceiling. On the flex path that is gone entirely. The Brain
Constitution's §G hard rule is "goal ≠ current training capacity" and the
standing constraint is "paces come from evidence, the goal never distorts
training"; a threshold pace that moves because of a stated goal is that
distortion in its purest form. The four functions stay exported because
`generate.ts` still calls them.

Same reasoning killed two smaller goal leaks in the same files: the
`goalIPaceEligible` gate (a 5K/10K/HM goal earned a true Daniels I-pace, a
marathon goal got the slower cruise default — a marathoner's 800s run slower
than a 5K runner's at identical fitness), and `refreshedPaceAndSpec`'s
`ttDistance` parameter, which did the same thing on the maintenance arm.

### 3 · Long runs share the easy ceiling; only the band WIDTH differs

The live block paced every long run at 8:36/mi against an easy band opening at
9:02 — a long run prescribed FASTER than an easy day. `spec-builder` already
states the doctrine for the HR cap in its own words ("LONG IS EASY EFFORT, just
more volume"); the pace targets simply had not followed. One ceiling for both
now, with long keeping its own narrower width.

### 4 · An incoherent anchor set REFUSES; it is never clamped and never falls back

`composePaceAnchors` checks the six anchors as a SET — repetition faster than
interval faster than threshold, slower than marathon, slower than the easy
ceiling, slower than the shakeout ceiling — and refuses the whole write if the
order breaks. It does not clamp, because a clamp hands the plan a well-formed
set assembled out of a contradiction; and it does not fall back to the VDOT
cascade, because that is Constitution §8's "sometimes old, sometimes new."
Leaving the plan untouched is a safe, inspectable state.

Worth recording: the gate turned out to be a BACKSTOP rather than the primary
defence. The per-prescription contradiction clamps already bind most adjacent
pairs, so an absurd high-intensity read comes back clamped rather than
incoherent. Established by trying to make the gate fail and failing, and written
into the test that documents it.

**Not touched:** the Adaptation Engine. It stays unwired and reaches no live
path, pending a separate review of the progression gates.

---

## 2026-08-31 · Goal changes require explicit runner action, and Races folds into Progress. SETTLED.

Two decisions from the UX audit's flagged open questions, David's own call on
both, resolving the doctrinal tension the audit correctly refused to guess
at.

### 1 · The goal-acceptance card is valid, but only under a strict rule

The historical violation was the app *renegotiating* the goal for the
runner — a card that functionally overwrote a stated goal. An opt-in card
with genuinely co-equal choices is different in kind: the coach isn't
changing the goal, it's saying "here's my current projection, your goal is
still yours, you may update it if you want."

**Doctrine, verbatim: "A projection can challenge a goal. Only the runner
can change the goal."**

Concretely, this means:

- Race projection and stated goal are two separate concepts, never
  conflated. faff may project a different outcome, say a goal is
  aggressive/unlikely, recommend reconsidering it, or offer an explicit
  goal-change action.
- faff may NEVER: silently change the goal, treat a projection as the new
  goal, preselect a revised target, rebuild the plan around a revised goal
  before explicit approval, or visually pressure the runner toward accepting
  the recommendation (no primary "Accept new goal" CTA with "Keep goal"
  buried as secondary text, no preselected value, no auto-change on
  timeout).
- "Hold current goal" must remain a genuine, equal-weight option — not a
  dismiss action.
- Copy: never "we've updated your goal." Always "your current projection is
  slower than your goal" — projection and aspiration stay grammatically
  separate.
- A runner can knowingly hold an aggressive goal. If they do
  (`runner_acknowledged_gap: true`), faff does not nag every few runs — it
  trains intelligently toward the goal from current fitness, and re-surfaces
  the decision only when the outlook materially changes.

### 2 · Races folds into Progress; it does not keep a standalone tab

Today and Plan are primary surfaces because runners use them constantly.
Race prediction is a specialized expression of "is this working" — it
belongs inside Progress, not beside it. A standalone Races tab gives race
prediction outsized product weight and risks making the app feel like it's
constantly forecasting outcomes rather than coaching training.

Target structure: **Today · Plan · Progress**. Progress reads: current
fitness → what's improving → current limiter → race outlook → goal status →
recent meaningful changes. Tapping the race outlook opens a rich detail
screen (goal, current projection, confidence, primary limiter, goal status,
what would improve the outlook, the goal-decision card when warranted) — so
Race gets real depth without permanent bottom-nav real estate.

**The one condition that would flip this back:** if faff becomes genuinely
race-centric — runners regularly managing multiple races, race calendars,
A/B/C event structures, race-specific plans, course intelligence, pacing
strategy, taper, race-day execution, results, all as a real recurring
domain, not just "upcoming race + goal + prediction + decision card." Not
the case today. **Navigation hierarchy should reflect runner frequency and
importance, not implementation history** — a fourth tab doesn't get kept
just because it currently exists.

---

---

## 2026-08-31 · Two calls from the pace-prescription shadow-mode report. SETTLED.

The shadow-mode comparison (`prescription-resolver.ts`, run against David's
real live 103-row CIM block) surfaced five divergences between the old
VDOT-cascade output and the new capacity-resolver-driven output. Three were
mechanical gaps (sub-threshold zone folded into threshold instead of using
the existing `ST_OFFSET_S_PER_MI`; segmented sessions need one resolver call
per segment, not one per row; high-intensity capacity still has no
direct-evidence reader, so it stays a flagged, honest VDOT fallback) — those
are execution items for the wiring phase, not judgment calls. Two were real
decisions, made here because Claude had full authorization and David was
away.

### 1 · Marathon-specific tempo pace: adopt the new number (7:55/mi, was 7:37/mi)

The live plan prices `tempo @ MP` segments at a flat population offset,
`T + 18 s/mi`, applied identically regardless of who's running. The new
resolver derives marathon pace from David's own fitted durability exponent
(1.0869, evidenced by 5 graded races including his real 3:31:40 LA
Marathon) rather than the population default of 1.06 — he demonstrably fades
more than average from threshold-effort distance out to marathon distance.

**Decision: adopt the new, personally-evidenced number.** This is not a
close call once stated plainly — the old rule is exactly the "one formula
for every runner" pattern the entire night's rework exists to replace, and
the new number is slower, which is the safe direction: it stops rehearsing
marathon-pace segments at a pace his own race history says he can't hold for
26.2 miles. Applies to his two remaining marathon-pace rehearsal sessions,
2-3 weeks before CIM (`2026-11-17`, `2026-11-24`).

### 2 · Shakeout pace gets its own ceiling, not the shared easy ceiling

Routing shakeout runs through the general easy-pace ceiling (8:22/mi vs the
live plan's 9:42/mi floor) was the single largest shadow-mode divergence
(−80 s/mi) and removed a guard rail specifically on the days closest to a
race, where the entire point of the session is staying loose without
spending anything — a different purpose from ordinary easy-day aerobic
development.

**Decision: shakeout is its own purpose with its own, deliberately tighter
ceiling** (padded meaningfully slower than the general easy ceiling), not an
alias for `easy`. Exact offset to be set in the wiring phase, argued as a
named convention the way `CORROBORATION_MIN_OBSERVATIONS` is, since no
doctrine source prices this distance to a number.

---

## 2026-08-31 · Fitness-vector architecture: external review corrections. SETTLED.

An external review of the fitness-vector design (recorded in the entry below)
came back largely confirming the direction while catching real gaps. These
corrections are now locked; applied to in-flight work by direct mid-task
correction rather than waiting to redo it after landing.

**1. Capacity, current state, and prescription stay three separate concepts,
never merged.** Fatigue/readiness/recovery is NOT a fourth fitness anchor. A
runner can have excellent threshold fitness and durability while carrying
heavy accumulated fatigue — folding fatigue into a fitness anchor would let a
hard training week read as *becoming less fit*, which is a different fact
(the same Rule 11 discipline — three facts, never collapsed to one — already
enforced elsewhere in this engine). Model: `capacity + current state +
workout purpose → today's prescription`. Current-state inputs (load, HR
anomalies, illness, injury, subjective fatigue) modify prescription; they
never write into a capacity anchor's value.

**2. Anchor decay reduces confidence, not the value.** The original design's
`half_life` field could be read as "the estimate itself drifts down with
staleness" — corrected. Staleness widens uncertainty / lowers confidence over
time. It must never mechanically lower a fitness estimate on its own. "We
haven't recently confirmed this" and "the runner got less fit" are different
facts, and only the second one may move the number — and only when there's
actual evidence of it (a new race, a real interruption, a documented pattern
of regression), never as a function of the clock alone.

**3. The Riegel exponent's population default (1.06) is a named, revisable
CONVENTION, not physiology.** A personal exponent fit from race pairs shrinks
toward this prior, weighted by evidence QUALITY (how representative/clean
each race was — reuse `lib/race/effort-authority.ts`'s existing grading,
don't invent a second one) rather than by race count alone. Two clean races
should outweigh three questionable ones. The prior itself may later be
conditioned on more than a flat constant (training history, specialization);
not built now, just named so today's heuristic can't calcify into doctrine by
accident.

**4. Decoupling is longitudinal evidence, not a single-run reading.** One long
run's pace/HR drift is weak evidence on its own — it takes multiple
comparable qualifying long runs agreeing before it says anything about
durability. Onset (when drift begins, not just how much) is a valuable
second signal where cheaply available, named as a real follow-up rather than
required immediately.

**5. Two-stage evidence, not one classifier doing both jobs.** Stage 1
(eligibility) stays binary — is this observation admissible at all — and the
binary-refusal readers already built stand as this stage, not something to
discard. Stage 2 (reliability weighting) is continuous and layers on top
later. The requirement THIS locks in now: every reader must preserve the
metadata a later confidence layer will need (sample duration, source,
how well HR matched a target zone — not just pass/fail, recency) rather than
collapsing straight to a bare value-or-refusal. Losing that metadata now means
rebuilding the readers later instead of just layering on top of them.

**6. HR informs evidence, it doesn't get unilateral veto power.** A
observation that's otherwise strong (right duration, right pace, clearly a
work effort) should not be discarded outright for a borderline HR reading —
HRmax and zone boundaries carry their own uncertainty (see the HRmax fix
below), and treating a zone boundary as a hard gate propagates that
uncertainty as a false rejection instead of a lower weight.

**Anchor naming refinement:** "Speed" → **"High-Intensity Capacity"** — avoids
conflating short neuromuscular speed with 5K-adjacent capacity; to be applied
during the wiring phase, not urgent enough to interrupt in-flight work for.

**Confirmed unchanged:** the three-anchor decomposition itself (speed/
high-intensity, threshold, durability — no fourth fitness axis), easy pace as
a ceiling not a band, goal never redefining current-fitness training paces,
VDOT surviving as fallback/derived-display rather than disappearing, race
prediction as its own service returning a range with confidence rather than a
point estimate, and adaptation proposing rather than silently imposing.

---

## 2026-08-31 · Fitness is read from the training corpus, not one race. Easy pace is a ceiling, not a band. SETTLED.

Two decisions from the same conversation, both David's, both direct correction
of the app's core coaching posture.

### 1 · Stop treating VDOT as the single number every pace derives from

The architecture up to this point: collapse every signal — races, training
runs — into one VDOT scalar, then derive every prescribed pace (easy,
threshold, marathon, interval) from that one number through Daniels' formula
table. A first fix (`vdot-corpus.ts`, 2026-08-30) stopped that scalar from
being race-anchored — it now reads a corroborated level off the training
corpus instead. David's follow-up, verbatim: *"That's one fix but continuing
to anchor fitness in VDOT that is based off of the same things we've been
working with will continue to get us wrong times and information. It needs to
be anchored in evidence and runs. Maybe we are making VDOT too much of a
king."*

**Decision:** each pace type reads its own evidence directly where evidence
exists — easy pace from classified easy-effort runs, threshold pace from
classified threshold-effort runs — rather than being derived from one shared
scalar via formula. VDOT/the Daniels table becomes the fallback for whichever
pace type has no direct evidence yet (marathon pace, interval pace), not the
source every number is required to pass through. Work in flight as of this
entry: `lib/training/vdot-corpus.ts`-style corroborated readers, one per pace
type, not yet wired into the plan engine.

Important scoping note from the same conversation: David was explicit that a
specific number he mentioned (a ~6:45-7:00/mi tempo effort he ran "for a bit"
the day before) is not a claimed threshold pace to hit — it's one data point.
*"I don't know if that's my threshold pace I just know I did that yesterday
for a bit... I want to rely on data not just numbers that get set (VDOT) in a
vacuum of races and that's it."* The readers compute from the evidence and
report whatever comes out, refusing when there isn't enough corroboration —
they do not work backward from an assumed target.

### 2 · Easy pace is a ceiling with feel-based guidance, not a prescribed band

Prompted by David setting up a comparison plan in a competitor app (Runna) and
sharing screenshots. The instructive difference wasn't the exact numbers —
it's the SHAPE of the prescription. Runna states easy pace as a single ceiling
("no faster than 8:10/mi") with explicit copy: *"This is a limit, not a
target - run at whatever pace feels truly easy!"* Our engine instead prescribes
a narrow band ("9:02-9:42/mi") as something to hit.

A band implies a target to land inside; a ceiling plus feel-based guidance
implies a boundary not to cross, with the runner's own sense doing the rest.
Given David's real easy pace is naturally ~8:00-8:13/mi day to day, a ceiling
tracks that lived reality without the engine ever needing to nail an exact
number — the runner's feel fills the gap a rigid band cannot.

David confirmed both: "1 yes we can get this" (adopt the ceiling model) and
"2 yes mostly I'm commenting on the paces Runna set" (confirming the complaint
is concentrated on pace numbers, not plan structure/volume — Runna's weekly
volume and long-run placement are structurally similar to what this engine
already produces).

**Decision:** the easy-pace evidence reader's output becomes a single ceiling
(the fastest pace corroborated at genuinely-easy effort), surfaced with
feel-based coach copy in this app's voice (no exclamation marks per the
standing tone rule), not a `{lo, hi}` band to hit. To be applied in the wiring
phase once the evidence readers land.

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

**UPDATE 2026-09-01: fixed, entry closed.** Commit `81bf30eb`
(`fix(rule9): the last cliffs — an interruption is measured in weeks OFF,
and easy running stops quantising the week`) landed the same night this
entry was written, by exactly the remedy this entry called for — a more
robust input (`interruptionWeeks` now counts weeks off, not a hair-thin
crossing of the 28-day mean) rather than a wider tolerance around the same
cliff. `_coach_sensible.test.ts` passes 6/6, including both continuity
walks this entry names. Found stale by the plan-generator external review
(`docs/reports/plan-generator-external-review-2026-08-31.md` §3) and
re-verified independently by running the gate before appending this note.
Rest of the entry below is the original write-up, kept as the record of
why the gate was red and what it took to close it.

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
