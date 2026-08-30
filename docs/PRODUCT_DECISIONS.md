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

---

## Standing constraints referenced above

- Paces come from evidence. The goal stays visible and never distorts training.
- Current fitness is a safety floor, not a ceiling; the app's job is forward progress.
- The coach projects and never renegotiates a stated goal via a card or button.
- Modelled numbers are marked as modelled. Showing a modelled gain as measured is
  the one unforgivable error.
