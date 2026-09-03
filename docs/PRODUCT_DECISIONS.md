# Product decisions

Decisions taken deliberately, with the reasoning, so they are not silently
re-litigated. Newest first. A decision here is not permanent — it is recorded
so that changing it is a choice rather than an accident.

---

## 2026-09-03 · SEP-1 · the separation rule is typed by the preceding session's demand, not a flat two-day gap. SETTLED.

**What was wrong.** `validate.ts` §9 required intervals to carry 2 easy/rest
days before the next demanding session and everything else (threshold, tempo,
any long run regardless of size) only 1 — a divergence from
`RESCHEDULING_CONTRACT.md` Q32's own table, which had always said "≥1" for
intervals too. `reschedule.ts` knew about the gap and deliberately mirrored the
(wrong) validator number rather than Q32, because a proposal judged against a
different number than the boundary that will actually judge it is worse than
no proposal — flagged in the master program as an open call for David.

**His ruling, in full** (2026-09-03): ordinary interval or threshold session →
at least ONE complete easy or rest day. Long run under ~16mi and fully easy →
at least ONE. Long run 16-18mi → normally ONE to TWO depending on the run's
own authored intensity (a marathon-pace or progression finish reads the top of
the band; a mostly-easy long reads the bottom). Long run 18-plus miles, OR any
long run carrying substantial marathon-pace effort regardless of total
distance → normally TWO. Back-to-back demanding sessions are permitted ONLY
through an explicit authored transaction — the Dodgers-weekend shape already
built in `designed-race-weekend.ts` — never a general validator loophole. Both
easy AND rest days count as low-stress separation.

**What shipped.** `requiredSeparationDays()` in `lib/plan/validate.ts`,
typed off the preceding session's `distanceMi` / `isQuality` /
`raceGoalPaceSec` / `longRunKind` — the same fields `generate.ts`'s
designed-weekend caller already reads to classify a long run's finish, reused
rather than re-derived (Rule 16). §9 now also reads the `placement_compromises`
grant §11c already parses, so a designed weekend's own long run defers to that
transaction's more specific findings instead of being re-litigated by the
generic gap check. `reschedule.ts`'s `requiredRecoveryDaysAfter`, which had
documented the divergence, is realigned to match — intervals is 1 there too now.

**FATAL vs ADVISORY, and why.** The ruling's own wording splits cleanly: "at
least ONE" (ordinary quality, and the immediate-next-day rule for a long run
of any size) is an absolute floor and is enforced as fatal. "Normally TWO" for
an elevated long run is a doctrine target, not phrased as an unconditional
floor, and enforcing it as fatal was falsified against real `buildSimPlan` /
`_combined_stress` composer output before landing: `scheduleQuality` in
`generate.ts` places quality sessions against the OTHER quality sessions'
types, not against the long run's own classification, so real marathon blocks
routinely place tempo/threshold only one day after an 18mi-plus Sunday long —
which a fatal 2-day gate would have rejected, with nothing having told the
composer to avoid it. A narrower composer-side fix (threading the long run's
required gap into `scheduleQuality`) was attempted and reverted: it introduced
a new cross-week `Research/04` §16 violation (`_mp_spacing.test.ts`), because
`scheduleQuality` only reasons about one week at a time and the fuller
2-day band interacts with neighbouring weeks' marathon-pace placement in ways
a single-week search cannot see. The "normally TWO" shortfall is instead
computed and reported through `onStress` as `SEPARATION_BAND_SHORTFALL`
(`enforced: false`) — visible, not silently discarded (Rule 20/21) — pending
that composer follow-up.

**Verification.** `_sep1_boundary_walk.test.ts` — the three worked examples
from the ruling, a Rule 9 boundary walk (0.1mi steps, 14-22mi) confirming the
only discontinuities are the named 1-day steps at 16mi/18mi, the resolved
intervals-vs-threshold divergence, the Dodgers-grant regression (validates
clean with the grant, fatal without it, and a recorded REFUSAL does not
exempt), and the fatal/advisory split itself. Falsified per Rule 18 against
both the actual prior code and a truly universal flat-two-day rule; the
worked-example regressions fail correctly under the latter. Full `lib/plan/`
suite (2,671 tests) green except one pre-existing DB-liveness test this
environment cannot run (`DATABASE_URL_RO` unset).

---

## 2026-09-03 · RUNNERLANG-2 · a sentence true of every row of its kind is said once, and Rule 17 finally has a gate. SETTLED.

**What was wrong.** RUNNERLANG-1 (2026-09-02) answered the owner's instruction
to "remove phrases such as 'Conversational', 'Z2 HR cap' ... replace them with
direct running instructions" by swapping the WORDS. It left the REPETITION
exactly where it was. Measured on a freshly composed fourteen-week marathon
block the day after it shipped, 105 rows carrying notes:

| sentence | before | after RUNNERLANG-1 |
|---|---|---|
| `Conversational.` / its replacement | 33 | 33 |
| `Z2 HR cap.` / its replacement | 33 | 33 |
| `Off.` | 28 | 28 |
| `Sleep, mobility, fuel.` | 27 | 27 |
| the medium-long-run purpose | 11 | 11 |

Thirty-three rows carrying one sentence became thirty-three rows carrying a
longer one. **Nothing in the repository could tell**, because nothing counted:
`check-coach-voice.sh` grades words one at a time, `_block_says_it_once.test.ts`
watches one pair of strings on the Block screen, and `runner-instruction.ts` is
a substitution table that sees one string at a time by construction. Rule 17
had been a hypothesis since the day it was locked (Rule 20).

**The rule, and why the WEEK is the unit.** A runner-facing sentence appears on
at most one row of any one week. The week is the screen the plan surface draws,
and the design contract's standing rule is that no content is printed twice on
one screen. It is also the unit that does not punish a real role line:
"Recovery day after the long run" is a fact about one row a week for fourteen
weeks, where the same sentence on three rows of one week is a fact about none
of them.

**The mechanism, and what it is not.** `BLOCK_STANDING_SENTENCES` (15 entries)
plus `applyRunnerVoice`, a final pass in `finalizeComposedPlan`: a sentence
true of the KIND of row is said once, on the first row that would have carried
it, by the `BlockScopedSpeaker` the terrain fix already introduced. A generic
easy row then says what makes THAT day different, from `EASY_DAY_ROLE_LINES` —
a fixed table of five keyed on `easyDayRole`, a pure function of four booleans
the composer had already resolved. There is no branch on runner state, no
score and no tone, because the owner's binding constraint is that explanations
derive from structured canonical decisions and not from a separate prose brain.

**Three calls worth recording.**

1. **`plain` is the empty string.** A day with nothing particular to say says
   nothing. The row already carries its distance, its pace band and its HR
   ceiling, and those are what the runner acts on; a generic sentence printed
   over them is the bloat, not a service.
2. **`recovery` outranks `primer`, and that order was measured.** With the long
   run on Sunday and quality on Tuesday, Monday is both the day after the long
   run and the day before a session. With `primer` first, `recovery` fired ZERO
   times across a whole block and the most important easy day in the week was
   told "the session is tomorrow". Rule 22: a verdict no case can reach is
   decoration. The gate now counts every verdict.
3. **This pass runs at AUTHORING, where RUNNERLANG-1 runs at the READ.** "Said
   once" needs the whole block in hand, and `week-loader.ts` loads one week at a
   time — `/api/v5/today` calls the same loader and picks a single day out of
   it, so a week-scoped speaker at the read would blank Today's note six days in
   seven. **Consequence, stated rather than hidden: the block already persisted
   keeps its repetition until it is next authored.** Measured on the owner's
   live block as `faff_readonly`, 103 rows: `Conversational.` 35 and `Z2 HR
   cap.` 35. Re-authoring (P0-3) is what spends this fix.

**The gate.** `scripts/check-sentence-repetition.sh`, sibling of
`check-coach-voice.sh` and wired into `web-v2` `prebuild`. Three guards (table
and registry shape, gate present, run it) over
`lib/plan/_sentence_repetition.test.ts`, which composes 11 blocks spanning four
distances, three experience rungs and 2-to-6 run days, reads the RENDERED text
the phone gets, and counts per week. Liveness is stated, not implied: 11/11
blocks composed, 541 rows read, 1249 sentences read. Exemptions live in
`lib/audit/sentence-repetition-registry.ts`, are a ratchet, and carry one
argument only — **a prescription is not prose**: cutting a strides rep count or
a race-week duration would leave the row telling the runner to do less, not
just to read less.

Falsified four ways before it was trusted (Rule 18): disabling the pass
produces **340 findings**; a deliberately stale exemption fails until deleted;
removing the call to `applyRunnerVoice` fails guard 1; deleting the gate file
fails guard 2. The two live exemption patterns are asserted NOT to match the
sentence the whole gate exists for, so granting them cannot switch the check
off.

**A second hole, found while closing the first.** `check-coach-voice.sh`
excludes `lib/plan/runner-instruction.ts` from its scan — correctly, because
that file's regexes spell out the phrases guard 7 forbids — and paid for the
exclusion by scanning the rewrite table's `to` column. RUNNERLANG-2 put two MORE
tables of runner-facing copy in that same file and the payment did not follow
them. Measured: a role line rewritten as *"Short and easy — the session is
tomorrow! Great work."* — an em dash, an exclamation mark and hype, three of
guard four's five bans in eleven words — left the gate reporting **"324
user-facing source file(s) clean"**. Closed by scanning both new tables with the
lexicon's own `scanLayerOne`/`scanPunctuation` AND pinning the module's export
list, so a third table cannot arrive unscanned the way the second one did.

---

## 2026-09-02 · TIEREVIDENCE-2 · the self-declared experience level reaches NO plan decision. SETTLED.

**The ruling this closes**, in the owner's words: *"Add a gate proving that
changing or deleting the self-declared experience level cannot change: Plan
volume. Peak mileage. Long-run progression. Race prescriptions.
Race-plus-long-run permission. Cutback placement. Adaptation eligibility. Any
coaching explanation presented as the evidence supporting those decisions."*
And: *"My actual history — not an onboarding label — must determine appropriate
load."* `_declared_level_inert.test.ts` (DECLAREDLEVEL-0) is that gate, and it
is now green on all eight dimensions plus a whole-block byte comparison, across
four declared values and both absences.

**What was still reading the label, and what replaced it.**

1. **The load row.** `CAPACITY_BAND`, `CAPACITY_CEILING` and
   `GOAL_DEMAND_FLOOR` are DELETED — a floor, a ceiling and a reduction floor,
   all indexed by `profile.experience_level`. `classifyCapacityTier` is now
   `tierFromPace(demonstratedPaceSec)` and its parameter tuple has no level in
   it, which the compile-time seal and `check-goal-volume-leak.sh` guard 3 both
   pin. On the reference runner `authored_state.tier_band_anchor
   .composed_row_band_weekly` moves **[65, 90] → [45, 55]**: his demonstrated
   7:43/mi marathon-equivalent is `Research/22` §"Marathon — Intermediate", and
   §"Marathon — Advanced" opens "Multiple marathons, 50+ mpw base".

2. **The workout library.** `resolvePrescriptions` keeps the label as an
   accepted, unread argument — so the gate can go on proving it inert — and
   filters `levelFit` on `capacityBandFor(classifyCapacityTier(...))` instead.
   The decision the previous pass flagged rather than took is taken: NOT
   `undefined`, which switches the filter off and hands everyone the lowest-id
   template, but the evidence-derived rung, defaulting to the conservative one.

3. **Three smaller readers**: `GENERAL_RAMP_CEILING[level ?? 'intermediate']`
   (three sites → `WEEKLY_STEP_GROWTH`, the trained rung the load contract
   already exports); `mlrTierAllows` and the catalogue's contraindication gate
   (→ the demonstrated capacity band); `isBaseBuildingPlan` (→ LOWVOL-2's
   volume reading alone, with its boundary moved onto
   `TIER_TARGETS[cat].developing.peakWeeklyMileageBand[0]`, the least volume
   doctrine asks of anyone racing the distance).

**TWO QUESTIONS, TWO ANSWERS, DELIBERATELY.** `classifyCapacityTier` falls back
to `UNMEASURED_ROW_TIER` ('intermediate' — COLD-1's own constant, at its own
value) and `demonstratedLoadCeilingTier` to `EVIDENCE_ABSENT_TIER`
('developing'). Collapsing them was tried and backed out: the first asks which
of doctrine's four TEMPLATES an unread runner's block should be shaped like,
and doctrine's middle row is the honest default; the second is a PERMISSION the
adaptation engine binds on, and an unread runner gets none (Rule 11). Measured
cost of collapsing: a 45 mi/wk half-marathoner built to a 39 mi/wk peak against
§"Half Marathon — Intermediate"'s published 35-45. What the constant may no
longer do is FLOOR a runner whose measured pace grades below it.

**RULE 9 · one cliff removed, none added.** With the level gone the tier became
a step function of the runner's demonstrated pace, and
`_cadence_robust.test.ts`'s VDOT walk priced it: **a 177-mile block total
between VDOT 52 and 52.25.** `volumeCurve`'s peak destination is now
`peakWeeklyFloorMi` — `Research/22`'s four published peak floors run as CONTROL
POINTS with a continuous, monotone response between them, anchored at the
CENTRE of each pace band (edges would hand every runner one second inside a
band the faster band's volume). Deleting the band outright was tried FIRST and
backed out, and the measurement is the argument: a 5K runner reporting 15 mi/wk
was then built to 16 instead of doctrine's 25, and `_restore_continuity` found
84 archetypes losing more than a mile of long run because the long sizer's
`weeklyMi x longCap / peakWeeklyMi` had lost its stable denominator.

**What it costs the reference runner: nothing on volume, 6.5 miles of long run
across the block.** Peak week **60 mi/wk either way** — his demonstrated 52.3
mi/wk peak is what sizes his block through `plannedPeakBound`, and always was.
Fifteen-week total 763.2 → 764.2. Peak long 21.5 either way, capped by his own
demonstrated long. The early-block longs come down one mile each (18/19/20/21 →
17/18/19/20), which is the intermediate row's 20-22 band rather than advanced's
22-24.

**What it costs a runner the app has never measured**: on the shape axis,
`Research/22`'s intermediate template rather than whichever row they typed. On
the volume axis, nothing — `max(peakWeeklyFloorMi, base x 1.10)` means their
own reported base governs, exactly as VAR-06 intended.

**Residuals, named rather than quietly chosen.**
- `TIER_PACE_EDGES.5k.advanced` is 360 s/mi where `Research/22` §"5K —
  Advanced" says "sub-20 5K territory" (386). A 19:30 5K runner is graded
  intermediate against a row written for them. Recorded as an argued `exempt`
  on `TIER.pace-edges-cover-the-published-cohorts` rather than moved, because
  moving it moves the composed row, both published bands and the workout
  library rung for every 5K runner between 18:38 and 20:00.
- At the intermediate row's smaller weeks, a DELOAD drops one easy day and its
  strides pair loses a carrier. Pre-existing low-volume layout behaviour
  (Rule 12's territory), newly reachable; scoped out of `_mp_doctrine` and
  `_vocab_doctrine` with the measurement in both files.
- `REBOUND_TO_HELD_LEVEL` is no longer reachable by the archetype corpus (was 8
  of 8,781 plans). A Rule 15 coverage loss, recorded in
  `_combined_stress.test.ts`; the code is still exercised directly.
- `generator-bench`'s cold-start personas declare a `vdotAtStart` that never
  reaches `composePlan`, so the only thing telling the engine who they are was
  the label. Threading it fixes one persona and breaks another; named in the
  file rather than bent.

---

## 2026-09-02 · `goal_realism` is renamed `goal_vdot_sanity`. A boolean is named for its predicate.

**The complaint.** `goal_realism.flag` read `false` on the owner's live CIM
block while the canonical Goal Feasibility owner (`lib/race/race-outlook.ts`
§7, Constitution §L) read `unlikely_currently` against a 19:42 gap, at the same
instant, for the same runner. As he put it, a flag called "goal realism"
reading `false` while a twenty-minute gap stands looks incoherent.

**The finding.** Both numbers were arithmetically correct. The screen only ever
asked "does the typed goal demand a VDOT more than 15% above demonstrated
threshold capacity?" It has **no runway input and no uncertainty input** —
`totalWeeks` is computed six lines away and never passed to it, and the band is
a fixed multiplier, not a confidence interval. So `false` means "inside the
band" and nothing else: not currently demonstrated, and not reachable by race
day. The band is in fact WIDER than the engine's own `MAX_BLOCK_GAIN_VDOT`
(7.17 vs 5.0 VDOT at his anchor), so a goal can sit inside it and still be
beyond a maximal single block — as his is, needing 5.70.

The true→false transition was one input moving: canonical threshold capacity
44.1 → 47.8, which pushed the 15% edge from 50.715 to 54.970, past the goal's
53.5. Nothing about the goal, the runway or the outlook changed.

**The decision.** His ruling was "if the flag answers a narrower question than
its name implies, rename it." The predicate is kept exactly as it was; the name
is not. `authored_state.goal_realism` → `goal_vdot_sanity`, field `flag` →
`beyondSanityBand`, `estimatedCurrentVdot` → `anchorVdot`, API field
`goalRealism` → `goalVdotSanity`. One resolver owns it,
`lib/plan/goal-vdot-sanity.ts`, whose header names the canonical owner of the
wider question so the next reader cannot mistake the two.

Three defects fixed alongside, all found while verifying:

- **Rule 11** · the not-flagged branch dropped `goalVdot` after computing it,
  so one absence carried three meanings. `goalVdot` and `anchorVdot` are now
  always present; `null` means genuinely absent.
- **Rule 10 / Rule 16** · `reanchor-plan.ts` rewrites `pace_blend.
  season_anchor_vdot` in place and left the screen frozen, so the live row held
  47.7 and 44.1 for one quantity and the API served the older one. The read now
  recomputes from the live anchor on the same row and declares its posture via
  `anchorFreshness`.
- **Rule 9** · the boolean flips on 0.01 VDOT (two seconds of marathon
  equivalence) at the crossing point. Not smoothed — the graded answer already
  exists at the canonical owner — but the continuous quantity it steps on
  (`bandExcessVdot`) is now published beside it.

**Gated** (Rule 20): `lib/plan/_goal_vdot_sanity_gate.test.ts` (eight guards, a
liveness probe, a ratcheted allowlist, and a Rule 22 blind-spot declaration)
and `scripts/check-goal-sanity-naming.sh`, wired into `web-v2` `prebuild`. Both
falsified in both directions before being trusted; the falsification found a
real bug in the shell gate itself.

**Unchanged:** the predicate, the 1.15 band, the three-state `assessable`
contract, and the stated goal. Nothing anywhere reads this flag to alter,
renegotiate or downgrade a goal — verified by grep, by there being no consumer
of `/api/coach/read` at all, and now by a gate.

**Still open:** 1.15 has no doctrine claim (there is no `Research/` passage to
bind it to); three producers of a §L feasibility verdict remain, logged as
`ownership-scorecard.md` row 17; and `/api/coach/read` has no consumer, so
deleting it would remove a stale second answer for free.

Full working: `docs/reports/complete-coaching-brain-handback-2026-09-02/rebuild-preview/GOAL-REALISM.md`.

---

## 2026-09-01 · Four calls on the migration handback's open questions. SETTLED.

Response to `docs/reports/handback-2026-09-01.md` §11–§12, after external
review. Governs the next phase of work on the coaching-brain migration.

### 1 · The unfiltered 42-day `classifyAdaptation` absorption window

Confirmed: one reader answering two different questions (Rule 8 fork).
**Actual load absorbed** (taper, races, recovery, illness all still count —
tissue doesn't care why volume was low) stays unfiltered. **Capability
demonstrated / progression earned** needs representative-context filtering,
same discipline as `normal-window.ts` already applies elsewhere.

**Authorized now, but gated, not incidental:** split the reader into
`actual_load_absorption` and `representative_execution`. Sequence —
preserve current live behavior first, shadow-run both across historical
runners and plan archetypes, report how many DURATION/VOLUME decisions
change and in which direction, check for discontinuities at taper/race/
recovery boundaries (Rule 9), promote only after reviewing the diffs. This
is also a **prerequisite for broad Adaptation Engine authority**, not a
parallel, unrelated task.

**Flagged as under-argued in the handback:** DURATION and VOLUME were
grouped as both "held by the 42-day window," but VOLUME's hold in the
regenerated-block table is actually historical tolerance (33.4 mi/wk)
against a 45 mi/wk opening — a different reason. The follow-up must
identify the decisive limiter per lever, not group them.

**Open sub-question, needs real data before the next brief is written:**
for the three "under-executed" 08-04/08-06/07-28/07-30 tempo sessions —
were they compared against their own contemporaneous (possibly
already-taper-reduced) prescription, or against a generic tempo
expectation regardless of what the plan actually asked for that day? If the
plan had already reduced the ask and the runner met the reduced ask,
"under-executed" is an intent/comparison bug, not a windowing problem.

### 2 · Adaptation Engine authority

**Authorized: PACE-only shadow-compare. Withheld: any live mutation, any
other lever.** The engine has earned the next validation stage (real
regenerated-block PACE proposal, representative lookback working,
insufficient-evidence distinct from HOLD, historical tolerance preserved,
compound proposals checked) — but the proposed mutation isn't precise
enough for live authority yet (a cross-phase blended average, unresolved
HR interaction, authoring/recomputation still on different brains, one
account's evidence only).

Shadow-compare means: runs on every eligible cycle, persists proposed
before/after values and reasons, **zero plan mutation**, evaluates
phase-specific targets rather than a blended average, reports false
positives/refusals/reversals/day-to-day stability, and covers
downward/hold/insufficient-evidence cases too — not just the successful
upward one already seen.

**Required before live PACE authority is even reconsidered:**
phase-aware mutation targets, the pace/HR compatibility validator (see
§3), replay across multiple runner archetypes, stable proposals across
repeated daily evaluations, a rollback/audit trail, and an explicit
decision on how authoring and recomputation converge onto one brain.

### 3 · Pace progression and the paired HR ceiling

**Decision: independent resolution, plus a mandatory compatibility
validator. No automatic paired HR increase.** A runner getting fitter often
runs faster at the same physiological intensity — mechanically raising HR
with pace would compound the progression and conflate two genuinely
separate evidence streams (pace capacity, cardiovascular response).

"Independent" does not mean "allowed to silently contradict." Pace
Prescription resolves its range; the HR owner resolves its own guard
independently; a final compatibility check determines whether both can
truthfully describe one intended stimulus. Policy: if the faster pace is
compatible with existing HR evidence, HR stays put; if HR would exceed
ceiling only from adverse conditions, that's a same-day readiness/
environment adjustment, not a capacity-belief change; if repeated
controlled sessions show the HR ceiling itself is stale, update it through
HR evidence, not as a side effect of a pace change; if genuinely
incompatible at prescription time, **refuse or hold the pace progression**
rather than silently moving HR to make it fit.

For threshold work specifically: HR should generally act as a secondary
guard/interpretive range, not a co-equal instantaneous target — it lags
early in reps and moves with heat/fatigue/terrain/hydration/sensor noise,
and a runner shouldn't be asked to simultaneously satisfy a narrow pace
band and a rigid HR ceiling that disagree.

**Open clarification owed on the existing card:** what semantic is
`HR 164-172` on the quality segment — a safety ceiling, an expected
response band, or a target zone? These are different product meanings and
the handback didn't specify which one is live today.

### 4 · The `--no-verify` pre-push bypass pattern

**Decision: isolated-commit verification is an acceptable FORMAL
substitute for the hook, not an unsupervised shortcut — and never an
undocumented one.** A hook that validates the whole dirty shared checkout
is not concurrency-safe; banning any bypass makes parallel agent work
impractical, but a silent, ad hoc `--no-verify` trains the system to treat
a safety boundary as optional. Neither extreme is acceptable.

**An agent may bypass the local hook without stopping only when ALL of the
following hold:** (1) the failure is proven to originate exclusively from
unrelated uncommitted changes; (2) the agent verifies the exact commit in a
clean isolated worktree; (3) it runs the SAME checks the hook would have
run, not a hand-picked subset; (4) results are recorded in the handback or
commit metadata; (5) CI/deployment verification succeeds where available;
(6) no merge/migration/security/destructive-operation check is omitted;
(7) the bypass is explicitly disclosed, not silent.

**Must stop and ask instead when:** the failure's unrelatedness can't be
proven; the hook's checks can't be reproduced in isolation; isolated
verification disagrees with the hook; the hook checks something unavailable
elsewhere; or the push affects shared state other agents may depend on.

**Longer-term tooling fix, not yet built:** per-agent worktrees; the hook
operating on the commit/index rather than unrelated working-tree state; a
supported `verify-commit <sha>` command defined as hook-equivalent; CI
enforcing the non-negotiable checks independently of the local hook.

### What this authorizes going forward

A next brief may direct: (1) a separately-scoped, shadow/replay-gated split
of the 42-day reader, gated as a prerequisite for broader Adaptation Engine
authority; (2) PACE-only Adaptation Engine shadow-compare, explicitly no
live mutation; (3) independent pace/HR resolution with a compatibility
validator, no automatic paired HR movement; (4) the formal isolated-
verification exception above, replacing ad hoc `--no-verify`, pending the
tooling fix. Writing that brief is blocked on one real-data question: the
taper-period tempo sessions' actual-vs-generic comparison basis, above.

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
