# Weekly re-composition · the committed window and the provisional arc

**Status:** build plan, decisions made. Nothing here ships on 2026-08-30 — the
owner's CIM block authors at 21:00 PT and the authoring path is the one
irreversible thing on tonight's clock.

**Owner's framing, verbatim (2026-08-30):** *"This is a training app not a live
in the past app. What's happening week to week is what matters. With pace but
also with volume. There's a world where I or other runners follow the plan,
there's a world where we fall short, but ideally there's a world where we push
forward and the plan has to push us more and more. That's what the app is for.
To push."*

And: *"Should the plan build a week or two at a time? Make it truly adaptive?"*

---

## 0 · The hypothesis I was asked to test, and the answer

**The hypothesis.** The engine authors a volume curve once, then needs a special
mechanism to deviate upward from it. That mechanism has fired zero times. If
week N+1 were composed fresh from evidence-to-date, pushing would be the default
rather than a feature — a runner who has been crushing it simply gets a bigger
week, with no bar to clear.

**The answer: the hypothesis is half right, and the half that is wrong is the
half that would have been built first.**

Re-composition would NOT have delivered the push on its own, because the reason
nothing pushed was never the architecture. It was two defects in the gate:

- `detectRampSignals` gate 2 queried `runs.data->>'type' IN ('threshold',
  'intervals','tempo')`. That field has never held a session type in the history
  of the table. Over the owner's last 121 days the gate passed on **0 of them**
  and could not have passed on any of them whatever he ran.
- Gate 1 vetoed a bump whenever any ONE readiness pillar sat below baseline for
  two days, while the pull-back that touches the plan needs **three converging
  domains**. His sleep pillar has been below baseline since 2026-08-16 with the
  band reading `ready` throughout.

Both are fixed and deployed (`2351bb3d`, `784c0e75`). The upward path is
reachable for the first time. **That was the real work, and it is done.**

Re-composition is still worth building, but for a different and more honest
reason than "it makes the engine push":

> A bump is a **patch on a curve authored against a runner who no longer
> exists.** Fourteen weeks out, the arc is a guess about someone who has not run
> yet. Re-composition does not make the engine push harder; it makes the thing
> being pushed *current*. The bump then has less work to do, and the residual
> bump is a genuinely small correction rather than the only channel through
> which fourteen weeks of new evidence can reach the plan.

Where the hypothesis is right: the inputs genuinely do move enough week to week
to matter. `resolveRampBase` on the owner's live history returns `sustainedMi
45.0`, `meanMi 31.6`, `heldMi` from a 34.7 mi week — a 13.4 mi spread inside one
authoring. A curve drawn against 31.6 and a curve drawn against 45.0 are
different plans.

Where it is wrong: **re-composition without the anti-ratchet in §3 is actively
dangerous**, and more dangerous than the status quo, because it can walk the
block down while appearing to serve the owner's instruction.

---

## 1 · What is committed and what is provisional

### The decision

**A derived boundary, not a new column.** The commitment horizon is
`min(end of next training week, today + 14 days)`, computed at read time.
Everything on or before it is COMMITTED; everything after is PROVISIONAL.

### Why not a column

`seal.ts` already owns the only state that must be durable — a day the runner
has actually run is immutable, enforced at both the UPDATE path
(`filterUnsealedWorkouts`) and the rebuild path (`snapshotSealedDays`). That is
a fact about the world and it needs storage.

"Committed" is not a fact about the world. It is a policy about how far ahead we
promise not to reshuffle, and policies that live in columns rot: a row stamped
`committed` in week 3 is still stamped `committed` in week 9 when the policy has
moved on. A derived boundary is always current, needs no migration, and cannot
disagree with itself across two rows of the same week.

### Does `seal.ts` give the primitive

Partly, and the gap is real. `seal.ts` answers *"has this day been run"*. It does
not answer *"has this day been promised"*. A Wednesday threshold session the
runner has read on his phone, planned his week around, and told his running
partner about is not sealed, and today a rebuild may freely rewrite it.

**That gap is closed by the boundary, not by a new state.** Inside the committed
window a re-composition may not change a row's `type`, `is_quality`, `is_long`,
or its date. It may change `distance_mi` and `workout_spec` only within the
tolerance in §2. Outside the window it may do anything.

This is deliberately weaker than a persisted "committed" flag and is the right
trade: the promise the runner experiences is *"the shape of my next two weeks
does not move"*, which the boundary delivers, and not *"this exact row id
survives"*, which nobody can perceive.

---

## 2 · What triggers a re-composition, and what stops it churning

### The trigger

**A rhythm, not a problem.** One new trigger: the runner's own week boundary.
The training week ends on `user_settings.long_run_day` (locked 2026-06-16, one
source of truth in `/api/plan/week`), so re-composition fires on the evening the
week closes — the same 21:00 PT slot the authoring cron already occupies, chosen
because the owner said *"I dont want to wake up to change runs · that was
annoying."*

The existing triggers stay exactly as they are. `plan-drift`, `silent-rebuild`
and `auto-rebuild` fire when something is detected wrong; this fires when
nothing is wrong, which is the case that has never had a trigger.

### What stops it churning

Four mechanisms, in the order they bind:

**1 · The committed window is untouchable in shape.** Two weeks of the plan
never move. Whatever the re-composition decides, the runner wakes into the week
he went to sleep expecting.

**2 · A dead band on the destination.** A re-composition that would move the
block's peak weekly by less than **1.5 mi**, or the peak long by less than
**1.0 mi**, writes nothing at all. Below that the runner cannot feel the change
and the only thing it produces is a plan that looks different every Monday for
no reason. `LTHR_MATERIAL_CHANGE_BPM` is the precedent — the LTHR re-anchor
carries a ±3 bpm noise floor for exactly this reason and it stopped that
mechanism churning on rounding.

**3 · Phase boundaries are frozen once entered.** The week a phase starts, its
start date stops being an output. A re-composition may lengthen or shorten a
FUTURE phase; it may not move a boundary the runner is already past or inside.
The taper start date is frozen from the moment the block is authored, full stop
— it is a function of the race date and `BLOCK_SHAPE[cat].taperWeeks`, both of
which are known on day one, and nothing about executing week 4 well should move
it.

**4 · The diff is the deliverable, not the plan.** Every re-composition writes a
`plan_proposals` row recording what changed and why, and the coach's log gets
one line: *"Week 6 onward re-drawn off your last four weeks. Peak moves 58 → 61."*
A change the runner is told about in one sentence is not churn. A change he
discovers is.

---

## 3 · The downward ratchet — the most important section

### The failure mode

Recomposing from current evidence every week can quietly walk the block down. A
bad week lowers the inputs, which lowers next week, which lowers the week after.
The plan gets smaller every Monday, each step individually defensible, and the
destination the runner is training toward erodes without any single decision
having been made to lower it. This is the exact inverse of the hero statement
and it would fail it *while appearing to serve it*.

### What already protects us, verified in source

The engine's volume readers are, mostly, already built against this — largely
because the same class of bug (Rule 8, the taper-as-normal defect) was fought
through this file over the last fortnight.

| Reader | Shape | Ratchet-safe? |
|---|---|---|
| `sustainedMi` | rank-3 week of the look-back (`RAMP_BASE_SUSTAINED_RANK`) | **Yes.** One bad week cannot move a rank-3 statistic. |
| `peakMi` | `resolvePeakWeekly` — max rolling 7-day block over 112 days | **Yes within the window.** A max cannot fall because of a bad week. |
| `heldMi` | better of the two most recent 7-day blocks, capped at `sustainedMi` | **Yes.** Explicitly a FLOOR, "never a ceiling, never a reduction" (CURRENTVOL-1). |
| `baseMi` | `max(liftedBase, heldMi)` | **Yes.** The mean can only bind upward. |
| `meanMi` | 28-day arithmetic mean | **No.** Not outlier-resistant. But it reaches `baseMi` only through `max(…, heldMi)`, so it cannot pull the base below what the runner is demonstrably holding. |
| `cycleBoundedPeak` | `max(min(doctrineTarget, peak × CYCLE_GROWTH_CEILING), measuredPeak, distanceFloorMi)` | **Yes.** Two monotone floors: the runner's own measured peak, and the distance's doctrine floor. |

So a single bad week cannot lower anything. That is a genuinely good starting
position and it is why this is buildable at all.

### The one real hole, and it is not the one that was flagged

`peakMi` is a max over a **rolling 112-day window**. A max cannot fall because
of a bad week — but it falls the moment the week that set it **rolls out of the
window**. Nothing about the runner changed; the calendar moved.

That is a time-driven downward step in the one input that floors the
destination, and today it is harmless because the block is authored once and the
number is read once. **Under weekly re-composition it becomes a slow ratchet
that fires on a date rather than on evidence** — and it is worst precisely for a
runner mid-block after a peak-then-recovery, which is the owner on 2026-08-30.

### The mechanism · a destination that is monotone or justified

**`peakMi` becomes a high-water mark carried on the plan, not a rolling read.**

Concretely, on `training_plans.authored_state`:

```jsonc
"volume_high_water": {
  "peak_weekly_mi": 47.5,
  "at": "2026-07-25",
  "source": "measured",          // measured | inherited | reset
  "window_days": 112
}
```

Rules:

1. **On first authoring**, seed it from `resolvePeakWeekly` exactly as today.
2. **On every re-composition**, the peak input is
   `max(resolvePeakWeekly(daily), high_water.peak_weekly_mi)`. A new bigger week
   raises the high-water mark and is written back. A window that has merely
   rolled forward cannot lower it.
3. **The high-water mark is inherited across a rebuild** of the same block, so
   the archive-and-insert cycle cannot launder a reset.
4. **It expires only on evidence, never on time.** Two mechanisms, both of which
   already exist and are doctrine-bound rather than invented here:
   - `detectTrainingGap` classifying a `rebuild_propose` band (>14 days off) —
     a genuine layoff, where doctrine already says re-author from a lower base.
   - `detectFitnessRegression` firing on a race result — the strongest evidence
     available, and the only thing that should be allowed to say "he is smaller
     than he was".

   Both write `source: "reset"` with the trigger recorded, so the reason a
   destination came down is always answerable.
5. **Rule 8 applies to the read that feeds it.** The daily series must be
   filtered through `normal-window.ts` before it can RAISE the mark — a peak set
   inside a taper is not a training identity. It is not filtered when comparing
   against the existing mark, per Rule 8's corollary: the tissue absorbed what
   it absorbed.

**The property this buys, stated so it can be gated:** across successive
re-compositions of the same block, `peak_weekly_mi` is non-decreasing unless a
`source: "reset"` record names the evidence that lowered it. That is
"monotone or justified", and it is checkable without a database.

### The second-order hole, named

`cycleBoundedPeak`'s `min(doctrineTarget, …)` binds downward when the doctrine
target itself moves — and the doctrine target is a function of `tierTarget`,
which is a function of the runner's assessed level. If a re-composition ever
re-derives the LEVEL from recent evidence, a bad month could demote him a tier
and the peak would fall through a path the high-water mark does not cover.

**Decision: level is frozen for the life of a block.** It is an identity, not a
measurement, it is already on `authored_state.tier`, and re-derivation buys
nothing a peak already measures.

---

## 4 · What breaks

| Gate / test | Assumption | Impact | Load-bearing? |
|---|---|---|---|
| `_maint_invariants.test.ts` | a block is authored once and graded as one artifact | **Extend, do not weaken.** It grades a composed plan; it does not care how many times composition ran. Needs a new case: re-compose twice and assert the committed window is byte-identical. | **Yes** — THE plan-quality gate. |
| `_sweep_allusers.test.ts` (11,598 archetypes) | `Arc` has no history fields, so `hist` is null for every archetype | Unaffected, and that is the problem — per Rule 15 the corpus **cannot reach** re-composition at all. It needs a second axis: the same archetype composed at week 0 and re-composed at week 4 with an executed history. | **Yes**, and it is currently blind here. |
| `_restore_continuity.test.ts` / `_coach_sensible.test.ts` | walks a synthetic runner across boundaries | Directly relevant, and the natural home for the anti-ratchet walk (§6). | Yes. `_coach_sensible` is red by design at 3; do not touch. |
| Owner byte-stability | several changes have deliberately kept his plan byte-identical | **Preserved by construction** in step 1: the committed window is byte-identical, and step 1 touches provisional weeks only. | Yes, and it is the reason for the sequencing in §6. |
| `check-automatic-mutations.sh` | maps every automatic plan mutation to its cron | Needs the new trigger registered. Mechanical. | Yes. |
| `_plan_drift_lifecycle.test.ts`, `_silent_rebuild_undoable.test.ts` | rebuilds are problem-triggered and undoable | A rhythm rebuild must also be undoable — `POST /api/plan/undo` already handles archive/un-archive and its completed-day gate is exactly the protection needed. | Yes. |
| `lib/plan/block-preview.ts` | built 2026-08-18, **no caller**, in `MODULE_ORPHANS` as should-be-wired | This is the provisional-arc surface. Wiring it removes an orphan. | No — it is dead today. |

---

## 5 · What the runner sees

Three registers on one screen, and the boundary is drawn as **confidence, not
uncertainty**:

- **This week and next** — concrete. Distances, paces, HR caps. No marker of any
  kind; this is just the plan.
- **The arc** — the block's shape, always visible: phases, the three races
  placed against CIM, the two 20-milers, where the taper starts, the peak week.
  Rendered as a curve with the committed window solid and the rest drawn in the
  attention-amber `~` register the iPhone v5 design already reserves for a
  modelled number.
- **One line when it moves** — coach voice, in the log: *"Re-drew from week 6.
  Peak moves 58 to 61 — the last four weeks earned it."* Silence when nothing
  moved past the dead band.

The `~` mark is load-bearing and already specified: the phone design uses it for
"this is modelled". A provisional week is exactly that. It should never read as
*"we do not know what you are doing in November"* — the destination is fixed and
visible; only the route to it is being kept current.

---

## 6 · Sequencing · the smallest first step

**The smallest useful step is NOT a weekly rebuild.** It is narrower than the
brief assumed, and it is most of the value at a fraction of the risk:

### Step 1 · Re-derive the volume curve of the provisional weeks only

Weekly, on the week boundary, for the active plan:

1. Recompute `resolveRampBase` and `cycleBoundedPeak` off evidence-to-date, with
   the high-water mark from §3.
2. Re-run `volumeCurve` for weeks after the committed boundary.
3. Scale those weeks' `distance_mi` to the new curve. **Session layout, types,
   dates, quality placement, phases and the taper are all untouched.**
4. Write nothing if the peak moved less than the dead band.
5. Record a `plan_proposals` row and one coach-log line.

**Why this is the right first step**

- It is the axis the owner named first: *"with pace but also with volume."*
- Pace already re-anchors correctly and reaches every remaining week —
  `recomputePacesForPlan` rewrites all rows with `date_iso >= today` and
  preserves the progression block. The volume axis has no equivalent. This gives
  it one.
- It cannot churn the thing the owner would notice. Layout is what he reads;
  layout does not move.
- It ships independently. Nothing in steps 2-4 is a prerequisite.
- It is byte-stable for his current block until his evidence actually moves,
  which is the acceptance criterion that has protected every change in this area.

**First commit, ready to execute:** `lib/plan/volume-high-water.ts` — the
high-water mark, its read/merge/reset rules, and its gate. Pure, no database, no
behaviour change, nothing calls it yet. It is the one piece everything else
depends on and the one piece that is dangerous to get wrong, so it lands alone
and gets falsified alone.

### Step 2 · Wire `block-preview.ts` as the provisional arc

Read-only. The runner sees committed-versus-provisional before anything reshapes
underneath him, which is the correct order: show the concept, then act on it.

### Step 3 · Session-shape re-composition inside provisional weeks

Only after the progression trajectory's `workShape` is persisted for
catalogue-chosen sessions (see the audit's finding on `generate.ts:5883` —
1 of 25 quality days in the owner's CIM block carries a shape, so the
progression gate is dark). Re-composing shapes before that is re-composing
against nothing.

### Step 4 · Full arc re-derivation, phases included

Last, and possibly never. Steps 1-3 may deliver enough that re-drawing phase
boundaries is all risk and no benefit. **Decide this on evidence from steps 1-3,
not now.**

---

## 7 · Doctrine

`Research/22-plan-templates.md` §14 and `Research/00a-distance-running-training.md`
§"Volume progression rules" are the load-bearing citations for the ramp and the
cycle-growth ceiling, and both are already bound in the registry
(`RAMP.cycle-over-cycle-peak-growth`,
`LONGRUN.wow-single-step-cap-is-the-injury-red-line`).

**Neither says how far ahead a block should be planned.** The published plans the
corpus is built from — Daniels, Pfitzinger — are fixed schedules, which is the
same gap `DOCTRINE-BOOK-15` already recorded when the adaptive-bump policy tried
to cite Pfitzinger and could not.

So: **the commitment horizon is a product convention, and it must be declared as
one.** Per Rule 7 it gets a registry entry of the `CONVENTION.*` family — the
same shape as `CONVENTION.adaptive-bump-ceiling` — asserting the property it
actually owes (the committed window is byte-stable across re-composition) rather
than dressing two weeks up as a physiological number. The supporting evidence is
the owner's own: *"my buddy who has a real life running coach gets his schedule
a couple weeks at a time."*

Do not invent a citation for the two weeks.

---

## 8 · Acceptance criteria

1. Re-composing the owner's block twice on consecutive days produces a
   **byte-identical committed window** both times.
2. Across a simulated 14-week block with one deliberately terrible week in the
   middle, the block's peak weekly is **non-decreasing** at every re-composition.
3. The same walk with a genuinely detraining runner **does** lower the peak, and
   the `volume_high_water.source` record names why.
4. A re-composition whose peak moves less than the dead band writes **zero**
   rows.
5. Every gate falsified in both directions before it is trusted (Rule 18), and
   the anti-ratchet walk run against the unfixed engine first.
6. `_coach_sensible.test.ts` still fails exactly 3.
