# Race Prediction & Goal Feasibility — external review

**2026-08-31. Prepared for an outside second opinion, matching the spirit of
the earlier fitness-architecture-summary review that already produced real
course corrections tonight.**

Everything below comes from reading the actual current files on `main` and
tracing real import/call graphs (`grep`, not memory), and from running the
real test suite. Where a claim in `CLAUDE.md`, `docs/PRODUCT_DECISIONS.md`, or
the `docs/audits/ux-bloat-audit-2026-08-31.md` synthesis turned out to be
stale against what the code actually does right now, that discrepancy is
called out explicitly rather than silently reconciled.

---

## 1. Problem / context

Race Prediction and Goal Feasibility are two of the twelve owning systems in
`docs/BRAIN_CONSTITUTION.md`:

> **§J Race Prediction** — "what could this runner realistically race right
> now?" ... `{ expected_result, likely_range, confidence, primary_limiter }`.
> Does NOT define fitness — translates fitness + preparation into
> distance-specific performance. **Race prediction is an output of the model,
> not the model itself.**
>
> **§L Goal Feasibility** — "how does the runner's goal compare with the
> current race outlook?" Consumes Goal + Race Prediction. Does NOT change the
> goal, fitness, or pace directly.

`CLAUDE.md` Rule 16 exists *because of* a real incident in this exact area: on
2026-08-30, the owner's CIM block showed **three different "projected"
finish times live at once** — 3:22:17 on the Races list, 3:31:48 on the race
detail screen, 3:42:23 in a third rung — all for the same race, same goal,
same day. `lib/training/race-projection.ts` was written specifically to close
that gap. This review asks: is it actually closed, everywhere, tonight — and
has the new durability-anchor work (built earlier tonight, a personally-fitted
Riegel exponent replacing the flat population 1.06) reached this system at
all?

**Headline answer, stated up front:** the canonical resolver is real and does
its one job correctly. But there are **at least four genuinely independent
code paths that can still produce a race-prediction-shaped number** for a
runner today, one of them a confirmed live divergence between what Today's
morning brief says and what Races/Progress say for the same race. Durability
is **not wired into race prediction or goal feasibility at all** — it is
wired into pace *prescription* only. And the goal-renegotiation boundary,
which the standing memory says was fixed, is now **more thoroughly closed
than either the memory or tonight's own UX audit gives it credit for** — the
audit's Top Priority #1 finding appears to describe a state the live code
left five days earlier.

---

## 2. Current architecture — what actually computes a projection

### 2.1 The canonical resolver, and what feeds it

```
computeGoalProjection()          ← lib/training/goal-projection.ts (2,477 lines)
  │  VDOT/Daniels equivalence + execution-scaled "trajectory" + a flat
  │  +5% one-sided marathon-specificity adjustment (population, not personal)
  │  + a real confidence interval (computeConfidenceInterval) that is
  │  COMPUTED but then never threaded onward (see §5)
  ▼
resolveRaceProjection()          ← lib/training/race-projection.ts (145 lines)
  │  precedence: trajectory.projectedSec → vdotProjectionSec → raw
  │  predictRaceTime(vdot, distance). Pure, single quantity + `basis`.
  │  THE canonical resolver Rule 16 was written to be.
  ▼
consumed by:
  · app/api/v5/races/route.ts        (Races list "Projected")
  · app/api/v5/race/[slug]/route.ts  (race detail "Projected")
  · components/faff-app/views/TargetsView.tsx      (web, paused)
  · components/redesign/season/SeasonClient.tsx    (web, paused, orphaned nav)
  · lib/plan/goal-outlook.ts         (the informational goal-outlook note)
```

`_race_projection.test.ts` and `_goal_immutability.test.ts` both assert (by
regex on the import statement) that `goal-outlook.ts` imports
`resolveRaceProjection` and never recomputes its own number — a real,
falsifiable gate, not just a convention.

### 2.2 The other three families answering adjacent-but-different questions

**`lib/training/goal-assessment.ts` (`assessGoal`)** — "is my stated goal
realistic, and what is this build genuinely worth (safe/stretch)?" This is a
**legitimately distinct question** from "where do I land on race day" — it
needs the full doctrine gain band at variable confidence levels (safe = slow
edge × execution, stretch = fast edge), which `resolveRaceProjection`'s fixed
precedence cannot express. It computes its own VDOT equivalence
(`currentEquivalentSec = predictRaceTime(currentVdot, distanceMi)`) rather
than delegating, but that's defensible: it's a different quantity (today's
equivalence, not race-day trajectory) used for a different purpose (the
feasibility verdict), and `race-projection.ts`'s own header explicitly notes
`assessGoal().currentEquivalentSec` is "byte-identical" to its own rung-3
fallback, not a competing claim.

**`lib/fitness/fitness-model.ts` (`resolveFitness`)** — "what could I race at
canonical distances (5K/10K/HM/M), as a range with a confidence tier, given
whatever evidence exists?" **Correction to this task's own briefing and to
prior session memory:** this module is **not orphaned**. It is live, wired
into Today's "Where you are" section via `lib/faff/fitness-read.ts`
(`buildFitnessRow`), which renders `estimate.races[key]` as a genuine
`loSec–hiSec` range with a `modelled: true` flag, or a plain-language refusal
when confidence is `'low'`. This is the one place in the whole system that
implements Brief 09's own worked example ("Expected: 1:32. Likely:
1:30-1:35. Confidence: High") correctly. It is a distinct question from
race-projection (generic current fitness vs. a specific goal race, scaled to
race day) and the two do not compete on the same screen.

What *is* still true: `GET /api/coach/read`, the route this module was
originally built for, has **zero callers** anywhere in `web-v2` or
`native-v2` — confirmed by grep, and `lib/faff/fitness-read.ts`'s own header
says so ("Its only importer is `/api/coach/read`, and nothing calls that.").
The route is dead; the underlying model is not.

**`web-v2/lib/race/coach-goal.ts` (`deriveCoachGoal`)** — "what should the
coach set as A/B/C targets when the runner hasn't stated a goal?" This is
**a fourth, fully independent race-prediction pathway**, live and consumed by
`app/api/v5/race/[slug]/route.ts` → `RaceDetailV5.swift`'s `coachGoalSection`
(iPhone), `app/api/targets/projection/route.ts`, `lib/plan/generate.ts`, and
`lib/watch/build-workout.ts`. It only fires when `statedGoalSec` is null, so
it never competes head-to-head with `resolveRaceProjection` on the same
field — but it carries **its own, separate implementation of a personal
Riegel exponent** (`fitPersonalExponent`, `predictWithPersonalExponent`,
`PERSONAL_EXPONENT_MIN/MAX = [1.03, 1.13]`, two-race log-ratio fit, 56-day
window), built before tonight and apparently unaware of tonight's
`durability-anchor.ts` work. See §3 — this is the single most important
architectural finding in this review.

**`lib/training/achievable-target.ts` (`achievableRaceTarget`)** —
**included in this review's file list but is not actually a race-prediction
or goal-feasibility function.** It answers "what pace may the plan
*prescribe* for a race-relative workout" (the 5%-of-ceiling authoring bound
that stopped a 3:00 marathon goal from rehearsing marathon-pace work at
6:52/mi off a block that never touched it). Consumers are exclusively plan
generation (`generate.ts`, `recompute-paces.ts`, `prescription-resolver.ts`).
It shares `predictRaceTime` with the prediction stack but answers a different
question for a different audience (the plan author, not the runner reading a
projection). Scoping note for whoever reads this review: don't fold this
into the "how many projection paths exist" count.

### 2.3 Two more paths that DO answer "what will I run," found while tracing consumers

**`lib/plan/goal-gap.ts`'s `GoalGap.trajectorySec`.** This field is **not**
resolved through `resolveRaceProjection`. It is `latest.projectionSec`,
read from the `projection_snapshots` table — and that table is written daily
by `app/api/cron/snapshot-projections/route.ts` as a **raw VDOT equivalence**
(`predictRaceTime(vdot, d)`), not the execution-scaled trajectory. This is
precisely rung-2/3 of `resolveRaceProjection`'s own precedence, stored under
a field named `trajectorySec`. `goal-outlook.ts`'s own header comment
identifies this exact defect in its own predecessor code ("`GoalGap
.trajectorySec` is the projection SNAPSHOT ... wearing the word
'trajectory'") and deliberately routes around it. **But the fix is local to
`goal-outlook.ts`.** Two live siblings still read the field directly:

- `lib/coach/readiness-brief.ts` → `lib/plan/gap-report.ts`'s
  `composeHeadline` — the **morning brief's own headline**
  ("Tracking 1:32:30 · 2:30 behind your 1:30:00 goal"). Consumed on iPhone
  via `TodayBeforeV5.swift`/`ReadinessBriefSheet.swift` (confirmed those
  files import the readiness-brief payload), though I could not confirm the
  Swift models currently decode `gapReport` specifically — worth a follow-up
  check before calling this "on screen today." On web it **is** rendered:
  `components/faff-app/views/TrainView.tsx` reads `gapReport` directly, which
  is the exact instance `docs/audits/ux-bloat-audit-2026-08-31.md`'s "Web
  findings" section already flagged (its own code comment names it "the Rule
  16 defect") — this review corroborates that finding independently and adds
  the root cause: it traces back to `goal-gap.ts`'s field, not just a stale
  UI fallback.
- `app/api/cron/plan-drift/route.ts`'s `goal_gap_widening` proposal — writes
  `trajectory_sec: goalGap.trajectorySec` straight into a persisted
  `plan_proposals.reasons` payload. This proposal kind has a real title
  ("The gap to your goal is widening") and action ("REBUILD THE PLAN") in
  `lib/coach/decision-cards.ts`, so it is a live, titled coach-card kind —
  I did not fully verify whether its rendered copy surfaces the raw number or
  just the title/action, so I'm flagging the stored field as wrong with high
  confidence and the "does the runner see the number" question as open.

**`lib/race/retrospective.ts`'s `nextRace.predictedSec`.** Computed directly
as `predictRaceTime(anchorVdot, nextA.distance_mi)` — confirmed, bypasses
`resolveRaceProjection` entirely, exactly the shape this review was asked to
check for. Its only consumers are `components/redesign/races/
RaceDetailClient.tsx`, `components/races/RaceRetrospective.tsx`,
`components/faff-app/views/RaceView.tsx` (all web, currently paused per
CLAUDE.md's locked scope), plus the read-only admin diagnostic
`app/api/admin/audit-races/route.ts`. Real, unfixed instance of the bug
class; currently not iPhone-facing.

**`lib/training/goal-projection-resolve.ts`'s `resolveNextAGoalProjection`.**
A fifth function, and its own header is candid about what it is: a **hand
copy** of `resolveRaceProjection`'s precedence logic ("Mirrors
`app/api/v5/races/route.ts`'s inline resolution, minus its cold-start
fallback"), not a call to the shared resolver. It currently agrees with
`resolveRaceProjection` because it was written with that in mind, and it
feeds the projection-change push notification and the `goal_projection_
snapshots` table (a *second*, separate snapshot table from `projection_
snapshots`, storing the correct trajectory-precedence number for the push
diff and "the Races chart's series"). Nothing enforces that this copy and
the canonical resolver stay identical — no test equivalent to `_goal_
immutability.test.ts`'s import-regex check exists for this file. Lower
severity than the `goal-gap.ts` finding (currently correct, not currently
divergent) but the same shape of risk Rule 16 exists to prevent.

---

## 3. The durability integration — the most important finding

**Direct answer: no code in the race-prediction or goal-feasibility stack
consumes `lib/training/durability-anchor.ts`, at all.**

Verified by grepping every importer of `durability-anchor.ts`:

```
lib/audit/active-plan-exemptions.ts
lib/audit/generated-content-registry.ts
lib/training/capacity-resolver.ts      ← pace/prescription side
lib/evidence/activity-evidence.ts      ← evidence classification side
lib/training/prescription-resolver.ts  ← pace/prescription side
lib/doctrine/registry.ts               ← doctrine gate bookkeeping
```

None of `race-projection.ts`, `goal-projection.ts`, `goal-assessment.ts`,
`achievable-target.ts`, `goal-gap.ts`, or `goal-outlook.ts` import it, cite
it, or reference "durability" in any comment. Every one of those files still
projects cross-distance purely through `predictRaceTime` — Daniels' VDOT
table equivalence, which itself encodes a *fixed*, population-average
cross-distance relationship functionally equivalent to the very assumption
`durability-anchor.ts` exists to correct — plus, in `goal-projection.ts`, a
flat **population** +5% one-sided marathon-specificity nudge (Research/02
§13.1) that is not personalized either. `docs/PRODUCT_DECISIONS.md`'s
2026-08-31 marathon-tempo-pace decision *does* adopt the new personal
exponent (7:55/mi vs 7:37/mi) — but that decision routes through
`prescription-resolver.ts` for what the plan tells the runner to *run in
training*, not through anything that tells the runner what they'll *run on
race day* or whether their *goal* still fits.

**Compounding finding:** `lib/race/coach-goal.ts` already has its own
personal-Riegel-exponent system (`fitPersonalExponent`), built before
tonight, live, and feeding the iPhone's coach-set A/B/C race tiers. It is
**not the same mechanism** as `durability-anchor.ts`'s `fitRaceExponent`:

| | `coach-goal.ts` (existing) | `durability-anchor.ts` (tonight) |
|---|---|---|
| Fit method | 2-race log-ratio, most recent + nearest qualifying by distance ratio | Recency-weighted fit across up to 6 races, shrunk toward the 1.06 prior by evidence quality |
| Window | 56 days | 180-day lookback, 84-day half-life |
| Valid band | reject outside [1.03, 1.13] | shrinkage toward prior, no hard reject band stated the same way |
| Consumer | `deriveCoachGoal`'s no-stated-goal A/B/C tiers | `capacity-resolver.ts` / `prescription-resolver.ts` (training paces) |

Neither file's header mentions the other. So the honest state tonight is not
"durability is unwired into race prediction" — it's **"race prediction
already had an ad hoc personal-exponent concept, a new and more rigorous one
was built alongside it for a different consumer, and nobody has reconciled
the two."** This is very likely the single highest-value question to put in
front of an external reviewer: which one should race prediction actually be
rebuilt on, and should `coach-goal.ts`'s implementation be retired in favor
of `durability-anchor.ts`'s once the latter is proven out?

---

## 4. Goal Feasibility's actual logic

`assessGoal()` in `goal-assessment.ts` is cleanly separated from projection
computation — it does not call `resolveRaceProjection` or `computeGoal
Projection`, and per §2.1 that's defensible (different question). The real
enum:

```
comfortable | realistic | ambitious | aggressive | out-of-reach
| open-ended | date-passed | unreadable
```

(Not the `COMFORTABLE/REALISTIC/AGGRESSIVE/UNLIKELY_CURRENTLY` named in
`BRAIN_CONSTITUTION.md` §L or Brief 09's `conservative/on track/aggressive/
unlikely/no longer realistic` — three different vocabularies for the same
concept across three docs and the code. Worth reconciling the wording, even
though the underlying tiering is sound.) Each verdict is fully unit-tested
(`_goal_assessment.test.ts`), with per-finding context filters that
independently gate on taper/race-week, post-race recovery, anchor staleness,
and marathon-specific-block absence — a real implementation of CLAUDE.md's
"per-finding context filters" rule, not just a citation of it.

`composeCautions`/`composeStatement` produce house-voice prose; `safeTargetSec`
/`stretchTargetSec` are clearly labelled `basis: 'projected'` throughout the
type. No leakage of feasibility logic into projection computation was found —
the separation §L asks for is real in this file.

---

## 5. Precision/confidence honesty — a genuine, unflagged gap

Brief 09, verbatim: *"Avoid fake precision. Prefer 'Expected: 1:32. Likely:
1:30-1:35. Confidence: High' over a bare point estimate."*

`resolveFitness` (§2.1) does this correctly — range + confidence tier,
rendered as a range on Today.

**`resolveRaceProjection` does not, and structurally cannot.** Its output
type is `{ projectedSec: number | null; basis: RaceProjectionBasis | null }`
— a single number. `computeGoalProjection` *does* compute a real confidence
interval (`computeConfidenceInterval`, tested, reused elsewhere) and a
confidence label, but `RaceProjectionInput`'s type only destructures
`trajectory.projectedSec` and `vdotProjectionSec` from the goal-projection
result — the confidence interval is discarded before it reaches the
resolver. Confirmed by grep: neither `app/api/v5/races/route.ts` nor
`app/api/v5/race/[slug]/route.ts` (the Races list and race detail — the
surfaces that show "Projected") reference `confidenceInterval` or
`confidenceLabel` anywhere. Only `app/api/targets/projection/route.ts` (the
paused web Targets surface) computes and returns them, and even there,
`TargetsView.tsx` does not render them — zero matches for `confidenceInterval`
in that component.

So: **every live "Projected" figure in this app — the number Rule 16 was
written to make trustworthy — is a bare point estimate**, formatted with an
amber tilde (the app's "this is modelled" mark) but never a range, never a
confidence word, on any surface, iPhone included. This is a real doctrine
gap the UX audit did not name (it focused on raw VDOT decimals, which — see
§6 — turned out to be a different, and largely stale, issue). The
machinery to fix it (a real CI, already computed) exists; it just stops one
function short of the runner.

---

## 6. Correction to the prior UX-bloat audit's Top Priority #1 and #2

This review reads as a genuine, material correction to
`docs/audits/ux-bloat-audit-2026-08-31.md`, which is dated the same day as
this review and was the explicit required reading for it.

**The audit's claims:** the Races decision card's "Stretch target"/"Safe
target" tiles come from `composeRaceCard`/`goal-assessment.ts` and disagree,
unlabelled, with the panel's own "Projected" stat; a "Take 3:16:45" button
renegotiates the goal via `answerGoalCard`; raw VDOT decimals ("VDOT reads
at 51.2 against a goal that only needed 49.8") appear in the decision-card
question copy.

**What tracing the live code actually shows, tonight:**

- `lib/training/race-card.ts`'s `composeRaceCard` — the one function that
  builds the card the audit describes — was **restructured on 2026-08-26**,
  five days before the audit. Its own header documents why, quoting the
  owner directly across three escalating rulings that day ("there is no
  reason that in Aug I have to accept defeat on a race in December" → "if we
  fix this right ... there is no decision" → "we dont even need ANY of
  this"). The live function now **returns `null` unless one of four
  fact/choice triggers fires** (heat forecast, course-elevation conflict,
  chip-time lock, two colliding A races) — it structurally cannot produce a
  `.decision` shape, a safe/stretch tile pair, or a "Take" answer any more;
  `safeTarget`/`stretchTarget` are hardcoded `null` in its only return path.
- `POST /api/v5/goal-answer/route.ts` — the live handler for
  `answerGoalCard` — has an `ACTIONS` allowlist of exactly `['not_now',
  'acknowledge', 'repace', 'confirm', 'leave', 'choose_race']`. There is no
  `'take'` or `'hold'` action; the route's own header states they were
  "removed 2026-08-26 per David's ruling."
- Grepping the live routes and `RaceDetailV5.swift`/`RacesV5.swift` for the
  string "VDOT" that would produce the audit's quoted copy finds **zero
  matches in any live rendering path.**

The "Take 3:16:45" buttons and "VDOT reads at 51.2 against a goal that only
needed 49.8" copy the audit quotes verbatim **do exist verbatim in the
codebase** — but only inside `RacesV5Sample`, a `MARK: - Preview samples`
enum in `RacesV5.swift` explicitly built "so a preview exercises the exact
decode path a real payload would go through" for Xcode canvas previews. It
is dead-for-production fixture data, not the live wire path. It appears the
most likely explanation is that the audit read this file and treated its
preview fixtures as representative of live behavior.

**This does not make the audit wrong to have flagged the area** — a
five-day-old fix landing right before an audit is exactly the kind of thing
that's easy to miss, and the stale fixture is a real, if low-severity, issue
in its own right (Rule 20's territory: dead code sitting in a file next to a
live doctrine comment about what it must never do is a landmine for the next
person who wires a preview into something real). But as a factual matter,
**the specific correctness bug the audit called "the single highest-value
fix in this audit" does not currently exist in the live app.** Recommend the
fixture be updated to match the current five-day-old contract (no `.decision`
shape, no safe/stretch, no `take`) so it can't mislead a future reader or
reviewer the way it appears to have misled this one.

What *is* still real and worth doing: the audit's raw-VDOT-decimal finding
in `evidence row`/`schedule-row` contexts elsewhere on the Races screen was
not re-verified in this pass (out of this review's scope) and should not be
assumed cleared by the above — only the specific `RaceDecisionCardV5`
question-copy instance was checked and found to be preview-only.

---

## 7. The goal-renegotiation boundary — verified closed, more thoroughly than expected

Traced every write path a goal value can take:

- **`GOAL_MUTATION_ROUTES`** (`lib/plan/goal-immutability.ts`, itself a
  data-only, DB-free, gate-readable declaration): exactly two routes —
  `PATCH /api/race/[slug]` (`races.plan.goal.finish_time_s`) and
  `POST /api/profile/goal` (`profile.tt_goal_*`).
- `PATCH /api/race/[slug]` hard-validates `source` against
  `RUNNER_INITIATED_GOAL_SOURCES = ['manual', 'onboarding']` — any other
  value, including the retired `'renegotiate'`, is rejected with a 4xx
  before the query runs. Confirmed in the live route.
- `POST /api/plan/proposal`'s `accept` action calls
  `isInformationalProposalKind(proposal.proposal_kind)` and **refuses**
  before doing anything for `goal_outlook` (live) and `goal_renegotiation`
  (retired, but historical rows still exist and must still refuse). Confirmed
  in the live route — this is a server-side gate, not merely an absent
  button on the client.
- The historical incident's exact mechanism — a cron writing a
  `goal_renegotiation` proposal with `accept_path: PATCH /api/race/[slug]
  { goalSec, source: 'renegotiate' }` — is fully retired. `lib/plan/goal-
  outlook.ts` is its replacement: same trigger condition (sustained
  unclosable gap), but its payload carries **no `accept_path` and no
  alternative target to set**, and it resolves its number through
  `resolveRaceProjection` specifically to avoid re-introducing Rule 16 (see
  §2.3 for the sibling that didn't get the same fix).
- `answerGoalCard`'s live action set (§6) never writes `goalSec` at all —
  every action either suppresses a trigger, confirms an already-server-
  resolved chip time, or reassigns race priority (A/B) between two existing
  races. None of the six actions can move a stated goal number.

**Conclusion: the boundary is closed on every path checked**, and closed
more completely than either the standing memory ("fixed once, watch for
recurrence") or tonight's own UX audit ("needs an explicit policy decision")
currently credit it for — because both predate the 2026-08-26 removal of the
decision-card mechanism that the audit's open question was actually about.
There is no live "opt-in three-way card" needing a policy ruling; that
mechanism doesn't exist in the current build. The policy question the audit
raised has been overtaken by a more thorough engineering answer than
citing.

---

## 8. Test coverage

Ran the real suite (`cd web-v2 && npx vitest run`) against every test file
touching this scope, found by actually listing `lib/training`, `lib/plan`,
`lib/race`, and `lib/fitness` rather than guessing filenames (the file names
the task brief suggested — `goal-gap.test.ts`, `goal-outlook.test.ts`,
`achievable-target.test.ts` — do not exist; there is no direct unit test file
for any of those three modules under that name):

```
lib/training/_race_projection.test.ts
lib/training/_goal_assessment.test.ts
lib/training/_goal_assessment_sample.test.ts
lib/training/_race_card.test.ts
lib/training/_race_authority_durability.test.ts
lib/training/goal-projection.test.ts
lib/training/goal-projection-ahead.test.ts
lib/training/goal-projection-belowtable.test.ts
lib/training/goal-ready.test.ts
lib/training/goal-ready-belowtable.test.ts
lib/fitness/_fitness_model.test.ts
lib/plan/_goal_immutability.test.ts
lib/plan/_audit_slow_goal.test.ts
lib/plan/_goal_framing_card.test.ts
lib/race/coach-goal.test.ts
lib/race/_race_doctrine.test.ts
```

**Result: 16 test files, 317 tests, all passed. Zero failed, zero skipped.**
(One `stderr` line during `_goal_framing_card.test.ts` is an intentional
negative-path assertion — "the dedupe guard fails CLOSED · an unreadable
guard writes nothing" — verifying a simulated DB failure is handled safely,
not a real failure.)

**What this coverage does and does not tell you:** every module discussed in
§2 that has a dedicated test file is well and honestly tested at the unit
level — `_goal_assessment.test.ts`'s per-finding-context-filter tests in
particular are a genuine implementation of the CLAUDE.md rule, not just a
citation of it. But **`goal-gap.ts`, `goal-outlook.ts`, `achievable-
target.ts`, and `race-projection.ts`'s actual consumers (the routes) have no
dedicated test file at all** — `_race_projection.test.ts` tests the pure
resolver function in isolation and correctly, but nothing tests that
`goal-gap.ts`'s `trajectorySec` and `resolveRaceProjection`'s output agree
(they don't, per §2.3) or that `goal-projection-resolve.ts`'s hand-copy stays
in sync with the canonical resolver (per §2.3, nothing currently checks
this). Per CLAUDE.md Rule 15, a green suite here is evidence about what it
exercised, not evidence the two numbers agree — and in the `goal-gap.ts`
case, the code paths in question were never within test reach at all.

---

## 9. Open questions for the external reviewer

1. **Should `coach-goal.ts`'s `fitPersonalExponent` be retired in favor of
   `durability-anchor.ts`'s `fitRaceExponent`, or do they answer different
   enough questions (a single race-pair fit for coach-set tiers vs. a
   shrinkage-weighted multi-race fit for pace prescription) to coexist
   deliberately?** If they should converge, which one is more correct, and
   what does the migration path look like given `coach-goal.ts` already has
   a live tested consumer on iPhone?

2. **Should race prediction be rebuilt on `durability-anchor.ts` directly,
   now that it exists as a real, evidenced, separately-confident anchor?**
   Currently `predictRaceTime`'s Daniels-table equivalence is the entire
   cross-distance mechanism behind every rung of `resolveRaceProjection`
   (and behind `goal-assessment.ts`'s safe/stretch targets). A runner whose
   own race history says he fades faster than the population assumption
   (documented for the account this app runs against: personal exponent
   ~1.10 vs. population 1.06) currently gets an *optimistic* marathon
   projection from the very system Rule 16 elevated to be trustworthy, even
   though the block he trains has already been corrected to price his real
   durability into his prescribed paces.

3. **Is `assessGoal`'s independent VDOT-equivalence computation
   (`currentEquivalentSec`) a legitimate second source, or should it call
   `resolveRaceProjection`'s rung-3 fallback directly instead of
   re-deriving a value the resolver's own header already calls "byte-
   identical"?** Currently correct by coincidence (same formula, same
   inputs) rather than by construction (shared call) — the exact shape Rule
   16 exists to make impossible elsewhere.

4. **Should `resolveRaceProjection`'s output type carry the confidence
   interval `computeGoalProjection` already computes?** (§5.) The doctrine
   text this whole system cites verbatim asks for a range; the canonical
   resolver returns a scalar. This looks like a small, contained fix (thread
   `confidenceInterval`/`confidenceLabel` through the resolver's output type
   and render it wherever "Projected" appears) rather than a design
   question, but it touches every consumer, so a reviewer's sign-off before
   touching Rule-16-protected code seems warranted.

5. **What should happen to `GoalGap.trajectorySec`?** (§2.3.) Renaming it
   won't fix the readiness-brief/gap-report/plan-drift consumers still
   reading it as if it were the trajectory. The two honest repairs are: (a)
   make `computeGoalGap` resolve `trajectorySec` through
   `resolveRaceProjection` the same way `goal-outlook.ts` now does for its
   own read, and stop writing raw equivalence into `projection_snapshots`
   for this purpose, or (b) rename the field to something honest
   (`equivalenceSec`) and make every consumer decide explicitly which
   quantity it actually wants, the way `race-projection.ts`'s `basis` field
   already forces every caller of the canonical resolver to do. Given how
   many places read this field, (a) seems lower-risk, but it's exactly the
   kind of change that should get a second opinion before it ships, since it
   touches the morning brief, the drift cron's persisted proposals, and the
   simulator sanity-check in one move.

6. **Should the `docs/reports` finding in §6 change how the UX-bloat audit's
   punch list is triaged?** Its "Top Priority #1" (Rule-16 recurrence on
   Races) and its goal-card policy question both appear to describe a state
   that shipped and left before the audit ran. Worth deciding whether to
   update that audit's own document (it's dated the same day, from the same
   session) rather than let two same-day documents disagree about the
   current state of the same screen.

7. **Vocabulary drift across docs.** `BRAIN_CONSTITUTION.md` §L names
   `COMFORTABLE/REALISTIC/AGGRESSIVE/UNLIKELY_CURRENTLY`; Brief 09 names
   `conservative/on track/aggressive/unlikely/no longer realistic`; the live
   code's `GoalFeasibility` type is `comfortable | realistic | ambitious |
   aggressive | out-of-reach | open-ended | date-passed | unreadable`. The
   underlying tiering logic is sound and well-tested (§4); only the naming
   across the three documents has drifted. Low priority, but worth a pass so
   a future reader doesn't waste time hunting for a status value that
   doesn't exist in the code.

---

## Appendix — files read in full or in substantial part for this review

`web-v2/lib/training/race-projection.ts` · `goal-assessment.ts` ·
`goal-projection.ts` (partial, the parts governing §2, §5) ·
`goal-projection-resolve.ts` · `durability-anchor.ts` (header + exports) ·
`achievable-target.ts` · `web-v2/lib/fitness/fitness-model.ts` ·
`web-v2/lib/faff/fitness-read.ts` · `web-v2/lib/plan/goal-gap.ts` (partial) ·
`goal-outlook.ts` · `goal-immutability.ts` · `web-v2/lib/plan/gap-report.ts`
(partial) · `web-v2/lib/race/coach-goal.ts` (partial) ·
`web-v2/lib/race/retrospective.ts` (partial) · `web-v2/lib/training/race-
card.ts` · `web-v2/app/api/v5/goal-answer/route.ts` ·
`web-v2/app/api/v5/races/route.ts` (partial) · `web-v2/app/api/v5/race/
[slug]/route.ts` (partial) · `web-v2/app/api/race/[slug]/route.ts` (partial)
· `web-v2/app/api/plan/proposal/route.ts` (partial) ·
`web-v2/app/api/cron/snapshot-projections/route.ts` ·
`web-v2/app/api/cron/plan-drift/route.ts` (partial) ·
`native-v2/Faff/Faff/ViewsV5/RacesV5.swift` (partial) ·
`native-v2/Faff/Faff/ViewsV5/RaceDetailV5.swift` (partial) ·
`docs/BRAIN_CONSTITUTION.md` §J/§L · `docs/PRODUCT_COACHING_DOCTRINE.md`
§18-20 · `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md` Brief 09 ·
`docs/PRODUCT_DECISIONS.md` (all 2026-08-31 entries) ·
`docs/audits/ux-bloat-audit-2026-08-31.md` (full) · `CLAUDE.md` (Rules 16, 9,
11, 13, and the hero statement).
