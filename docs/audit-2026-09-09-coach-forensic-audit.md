# Coach Forensic Audit — 2026-09-09

Consolidated report of a four-track, read-only forensic audit of faff.run's
runner-facing **coaching-language layer** (translation of engine facts into
prose — not the underlying decision mechanics, which are the separate
Brain/Adaptation audit's territory). No code, config, or production data was
modified anywhere in this audit; nothing was merged; no branch was pushed.

**Tracks, each run by an isolated investigator with its own sub-agents, cross-checked against each other where scope overlapped:**

1. [`track-1-architecture.md`](reports/coach-audit-2026-09-09/track-1-architecture.md) — generated-language architecture (50-row ledger)
2. [`track-2-corpus-truthfulness.md`](reports/coach-audit-2026-09-09/track-2-corpus-truthfulness.md) — corpus truthfulness, claim falsification, both known bugs re-proven
3. [`track-3-cross-surface.md`](reports/coach-audit-2026-09-09/track-3-cross-surface.md) — cross-surface consistency (Today/Block/Decisions/Race/notifications/Watch)
4. [`track-4-voice-usability.md`](reports/coach-audit-2026-09-09/track-4-voice-usability.md) — voice, hierarchy, usability

This document is the consolidated deliverable; the four linked files carry the
full evidence trail (file:line citations, raw test output, exact strings) for
every claim summarized below. Where a finding below abbreviates a track's
work, the full trace is in that track's file — this report does not repeat
citations that don't change the verdict.

**Evidence tags used throughout, inherited from the four tracks:** `[SRC]`
(source read directly), `[TEST]` (real code executed, output shown),
`[PROD-RO]` (live read-only DB query), `[RENDER]` (a real UI/API surface
rendered), `[DEVICE]` (iOS Simulator, real data), `[INF]` (traced by hand,
not executed), `[BLOCKED: reason]` (could not verify, reason stated).

---

## 1. Executive verdict

**The coach can explain some things briefly and truthfully. It cannot yet do
so consistently, and in at least four confirmed places it invents a fact the
underlying evidence contradicts.**

The architecture is not uniformly bad — it is bimodal. A meaningful set of
statement families (race projection, personal records, heat-band
consolidation, goal-outlook's forced-goal-renegotiation fix, the
provisional-finish-label constant, recovery-phase messaging,
training-influence's pace-tolerance unification, the accepted/declined/stale
proposal vocabulary) are genuinely well-built: single canonical owner, honest
refusal states, doctrine citations that were checked against the doctrine
text at run time rather than hardcoded on both sides. These are cited below
as the patterns to replicate, not as evidence the job is done.

Against that, this audit independently reproduced, by direct code execution
against real archetypes and real production data (not by reading diffs and
trusting comments):

- **Two previously-known bugs, confirmed still live on `main`** at
  measured scale (a false "longest easy run" claim on a tie, firing on
  **32.2% of all composed weeks**; a primer-sentence collision it
  unmasks) — fixed on an unmerged branch, verified fail-before/pass-after,
  but not yet on `main`.
- **Three new, previously-unreported false-claim defects**, each confirmed
  by direct execution: a session that ended early but ran *faster* than
  planned is told "0s slow... weaker than the plan calls for"; a cutback-week
  sentence asserts "down"/"reduction" against a week whose mileage the
  fixture set to go *up*; a proposal that was accepted but failed to apply
  is permanently misreported as "accepted" or "expired," never "failed."
- **A confirmed live invented-causality claim**, found independently three
  separate times by three isolated passes: "[HR rose] not because you're
  slowing down" is asserted while the same function has already computed a
  genuine ≥25s/mi pace fade and chosen not to mention it.
- **A confirmed second brain on the phone**: `HowItWentPanel.swift` computes
  its own post-run HR-drift verdict client-side, with two internally
  inconsistent threshold ladders in the same file, and never once reads the
  backend's actual canonical decoupling-trend resolver.
- **A confirmed live Rule-2 (multi-domain convergence) doctrine violation**:
  `standing-recommendation.ts` fires a runner-facing "ease this run"
  recommendation off a single readiness domain, contradicting the app's own
  stated three-domain convergence rule — and unlike its sibling
  `recommendation.ts` (caught before shipping), this one is wired and live.
- **A confirmed live cross-surface contradiction**: the identical pending
  adaptation proposal reads as calm/no-action on Block and as an amber
  "WAITING ON YOU" item under "STILL OPEN" on Decisions History.
- **A confirmed, systemic Rule-11 collapse in the adaptation-proposal outcome
  vocabulary**: "accepted-then-failed," "accepted-then-undone,"
  "never-answered," and — most seriously — a **safety override that
  correctly beat a push** ("superseded") all collapse into the same word
  ("pending"/"expired") the runner reads for an ordinary unanswered card. A
  deliberate `SAFETY_STOP` decline refusal renders as an ordinary transport
  failure telling the runner to retry — which can never succeed.
- **A confirmed defect class in the cutback/race-week engine**: mid-block
  tune-up races cause the shared `is_cutback` flag to mark race weeks as
  deloads while missing the real deload weeks entirely; a **C-priority race
  is told "rest is the work now,"** directly contradicting the app's own
  explicit ruling that a C race is never treated as a taper week.
- **A confirmed defect in the moved-run/travel-week surface**: the reason a
  session moved never reaches the runner regardless of the actual cause
  (travel, weather, life, or none all produce byte-identical copy); a
  "the only day that takes it" claim is provably false against the very
  fixture that produced it.

None of this is evenly distributed. It clusters in exactly the places this
audit's brief predicted: runtime-concatenated fragments the string-literal
gate cannot see, engine jargon (`VDOT`, `ACWR`, `limiter`) leaking through
directories the jargon scanner doesn't cover, and independently-maintained
"why is this happening" vocabularies that were never forced through one
resolver.

**Bottom line for the closing question:** not yet, on three of its four
conditions — truthfully (fails on confirmed false claims), consistently
(fails on confirmed cross-surface contradictions), without duplicating the
Brain (fails on the second-brain HR-drift panel and the five independent
readiness narrators). It *can* speak briefly, and where it is well-built it
does not require backend interpretation. See §17 for the full answer.

---

## 2. Method note

- Four isolated agent tracks, each spawning further isolated sub-agents for
  scope too large for one pass (Track 1 split by directory; Track 2 split by
  scenario cluster; Track 3 traced concrete real workouts; Track 4 checked
  the enforcement gates directly).
- Toolchain was live and used: `web-v2/node_modules` present, `vitest` ran
  real code throughout. Multiple tracks built adversarial fixtures and drove
  the actual composer functions rather than reading source and inferring
  behavior — this is called out per finding below with `[TEST]`.
- Read-only production DB access (`DATABASE_URL_RO`) was used for
  `[PROD-RO]` claims, scoped to David's own account
  (`0645f40c-951d-4ccc-b86e-9979cd26c795`). Zero writes issued (Track 4's own
  write-barrier log: 8 attempted, 8 refused, 0 issued).
- **Device/render tier is the weakest tier in this audit, honestly.** The
  installed iOS Simulator build talks to an unreachable `localhost:3111` dev
  server; standing up a real dev server against production data was judged
  out of scope for a same-day, read-only text/number-consistency audit.
  Every claim in this report is `[SRC]`/`[TEST]`/`[PROD-RO]` unless marked
  `[RENDER]` (confirmed against the exact Swift `Text(...)` call site) or
  explicitly flagged `[BLOCKED: no phone session]`. Per Rule 13, this is
  reported as an honest gap, not papered over with a fixture screenshot.
- All measurements against the unmerged fix branch
  (`origin/fix/coach-voice-tie-and-primer`) were taken in detached git
  worktrees, never the shared `main` checkout.

---

## 3. Coaching-source ledger (condensed — full 50-row ledger in Track 1)

For every statement family found, Track 1 recorded: surface, generator,
canonical owner, inputs, fallback behavior, whether facts are recomputed
locally, and a verdict. The table below carries only the rows that changed
the executive picture; **read Track 1 in full for the other ~35 rows**,
several of which are exemplary and worth replicating.

| Statement family | Generator | Verdict | Why it matters |
|---|---|---|---|
| Post-run HR-drift/pace-fade verdict | `native-v2/.../HowItWentPanel.swift` (client, Swift) | **DUPLICATED — most severe finding in the whole audit** | Computes its own categorical verdict with two internally-inconsistent threshold ladders in the same file; never reads `lib/training/decoupling-trend.ts`, the backend's actual canonical resolver for this exact concept. A repo-wide grep for "decoupl" in `native-v2` returns zero hits. |
| Readiness/Today narrative | `synthesis.ts`, `readiness-brief.ts` (×2 functions), `morning-brief.ts`, `health-actions.ts` | **DUPLICATED — 5 independent composers of one `ReadinessBreakdown` object** | Different, uncoordinated numeric thresholds; at `weight = -5` for HRV, one composer says "fine," another says "dipped." Only one is ever shown, with no guarantee the hidden four would agree. |
| Standing readiness recommendation ("ease this run") | `standing-recommendation.ts` | **DUPLICATED / DOCTRINE VIOLATION — live, wired** | Fires a runner-facing recommendation off ONE domain alone, contradicting the app's own stated Rule 2 (three domains must converge). Its sibling `recommendation.ts` (finding below) has the identical shape and was caught before shipping; this one wasn't. |
| Pre-run workout-purpose sentence | `run-purpose.ts`, `session-cue.ts`, `runner-instruction.ts` | **DUPLICATED — 3-way, live, one screen** | Three independently-maintained "why is today's run structured like this" vocabularies. Two are rendered together on the same `/api/today/purpose` payload and have already drifted (one carries an HR-drift clause the others lack). This is the audit's own named ownership question, answered in the negative. |
| Aerobic/HR-ceiling verdict on a completed run | `lib/postrun/experience.ts#readCost` vs `lib/coach/run-recap.ts#aerobicEarned` | **DUPLICATED — live, unresolved** | Two independent recomputations of "did this run stay under its HR ceiling," different grace bands (0 vs +1bpm), reachable through the same route for the entire ungraded-run population — reproduces the historical "kept it aerobic" bug class today. |
| `lib/coach/recommendation.ts` ("Model C") | held out of production | **DUPLICATED-AND-KNOWN (positive contrast)** | Same single-signal-vs-convergence mistake as `standing-recommendation.ts` above — caught, named, and deliberately never wired. Proof the doctrine *can* work when review catches the instance. |
| `plan_weeks.rationale` | dead writer at `generate.ts:6444` vs a materially better historical writer in `seed-from-onboarding.ts` | **DUPLICATED-AND-KNOWN** | Two writers, one column; the live one restates two already-visible facts (phase, week number). Product decision owed, not a code defect. |
| "Longest run" fact | 4 independent computations: race PR (`personal-records.ts`, well-gated), recent-block stat (`v5-evidence-prose.ts`), all-time training max (`coach-log.ts`'s `first_ever`, re-typed `CANONICAL_ROW_SQL` by hand), native Activity-tab range-scoped tiles (`ActivityView.swift`, **zero data-quality gating**) | **OPEN — naming collision** | Same words, four different quantities, no screen distinguishes "recent" from "ever" from "in this date range." No disagreement demonstrated yet, but the ambiguity is exactly what Rule 16 exists to prevent. |
| Threshold-durability limiter naming | `threshold-pattern.ts` | **OPEN** | Names a specific limiter without importing `lib/coach/limiter.ts`'s canonical `diagnoseLimiter` — which has documented prior-art for exactly this class of disagreement (`coaching-thesis.ts`'s own header cites a real, shipped instance where the two picked different limiters for the same runner). |
| Race projection number | `race-outlook.ts` → `race-projection.ts` (pure mapping) | **ROUTED (exemplary)** | 10+ confirmed callers, a static-analysis gate naming every allowed consumer, a live-production cross-check test. Cite as the pattern. |
| Race projection *label/framing* | `RacesV5.swift` (List) vs `RaceDetailV5.swift`+`race-page-layers.ts` (Detail) | **OPEN — see §9** | Same number, different name, different actionability, different presence of a range. |
| `check-coach-voice.sh` jargon scan | scope: native ViewsV5/DesignV5, `lib/faff`, `app/api/v5`, `notifications/templates.ts` | **GATE GAP** | Does **not** scan `web-v2/lib/plan` or `web-v2/lib/coach` for jargon (`VDOT`/`ACWR`/`limiter`) — confirmed by direct read of the script. This is why Defects A/B in §12 and the `ACWR`/`limiter` leaks in `lib/coach` (below) survive every existing check. |

---

## 4. Representative generated corpus — required scenarios

Each scenario below cites the real generated text and the real structured
inputs behind it, per the master brief's evidence requirements. Full traces
(including hand-built adversarial fixtures and raw test output) are in
Track 2 and its scenario sub-audits.

### Two easy runs in one week / tied longest runs (the primer collision)

**[TEST]**, full 8,781-archetype corpus (matches the fix branch's own cited
corpus size):

```
weeks with an EXACT tie for longest easy: 62,464 (83.2% of weeks-with-easy)
weeks where a tied day FALSELY got "longest": 32,222
   → 32.2% of ALL composed weeks, 42.9% of weeks with ≥2 easy days
```

On `main`, unfixed: *"Easy enough to talk in full sentences. **The week's
longest easy run.** This is where the aerobic volume comes from."* is printed
on a day that is, in fact, tied with another day at the identical distance.
On `origin/fix/coach-voice-tie-and-primer` (unmerged): **0.0%**. Fixing the
tie in isolation exposes a second bug — two tied days both falling through
to *"Short and easy. The session is tomorrow."*, byte-identical, twice in
one week — reproduced exactly (8 findings, same two archetypes) as the fix
branch's own commit comment claims. The branch's own cited "63%" headline
figure could not be reproduced under any of three natural denominators tried
(32.2% / 42.9% / 51.6%) — flagged as an unverified number, not as evidence
against the fix.

### Cutback week

`plan_weeks.is_cutback` is the sole gate on every cutback sentence in the
app, and it is **not** "this week is a scheduled deload" — it's "mileage
dropped >15% vs. last week, and it isn't the goal-race week or a taper
week." **[TEST]**, driving the real composer on an owner-shaped 14-week CIM
block with and without mid-block tune-up races:

```
no mid-block races:  is_cutback fires on weeks [3, 7]  (the real deloads)
+ 2 tune-up races:    is_cutback fires on weeks [1, 3]  (the two RACE weeks)
```

With tune-up races present, the flag marks the race weeks as deloads and
misses the actual deloads entirely. Consequence, confirmed on the owner's
own live block, one week, one screen:

```
Block-screen chip     => "Race week"
plan_weeks.rationale  => "Cutback week. Every fourth week comes down..."
strategy role         => CUTBACK / "Planned cutback. The reduction is the work."
whyLongRun            => "No long run this week. The race day is the long effort."
whyQuality            => "1 structured session. They sit either side of the long run..."
day note              => "Santa Monica 10K. B race · race effort..."
```

Three contradictory framings of one week. Separately, **[TEST]** an
adversarial fixture (mileage authored to go **up**, `isCutback: true` left
set) still produces: *"Down from 30 mi... The reduction is deliberate."* —
the "down"/"reduction" language is asserted unconditionally on the authored
flag, never checked against `vol < prevVol`. And **[TEST]** a full sweep
(1,200 composed blocks, 2,080 recovery weeks) found **48 post-race recovery
weeks** persisting the cutback sentence — a Rule 8 violation (a prescribed
recovery week is never the runner's "normal," and here it's being called a
"planned cutback" instead of what it is).

### Race week vs. a non-race tune-up

The core distinction (`resolveRaceWeekRole`) is correct and gated against
the owner's real production fixtures — CIM resolves `goal`, Santa Monica
resolves `tuneup`, Dodgers resolves `controlled`. **But**: `embedMidBlockRaces`
(`generate.ts:9664`) fires *"Race week for a tune-up · rest is the work
now"* for **B and C races alike**, with no priority branch — **[TEST]**,
5 of 140 swept compositions hit this, 3 of the 5 on **C races**, directly
contradicting the app's own explicit ruling recorded in
`race-week-role.ts:28-30`: *"CONTROLLED — a C-priority race... **never
treated as a taper week**."* The stated cause is also wrong: the trigger is
a frequency cap, not a taper decision — the honest sentence two lines above
it (*"{race} takes the usual rest slot; rest moves here"*) is never used.
And the Block-screen label collapses the distinction entirely: `'Race
week'` is returned identically for a C tune-up and the A goal race
(`_race_week_label.test.ts`'s own header calls this an "open decision for
the owner").

### A supplemental run

The **owning resolver is correct**: `classifyDay` (`day-resolver.ts`)
structurally cannot assign a scheduled workout's identity to an
unmatched run, and the post-run composer's honest path is confirmed
**[TEST]** — a 3.1mi shakeout on a 9.5mi tempo day correctly returns
`execution.status: INDETERMINATE`, `"Work done, no target to read it
against."` **The pre-fix shape was genuinely dishonest** (same fixture,
before `POSTRUN-DATE-GRADE-1` landed: the shakeout was named *"Tempo"* with
`stimulusDelivered: FULL`) — confirmed as the actual falsifier, now fixed
at `lib/postrun/load.ts`.

**But the fix is not complete across the app.** The **Evidence Engine's own
resolver** (`load-activity-evidence.ts:275-289`) still does the exact
date-only lookup the fix was built to retire — `WHERE pw.date_iso = $2`,
with no reference to which run is being classified — so a supplemental run
can still borrow the scheduled workout's `plannedIntent`, silently
affecting fitness-evidence weighting (`executionDivergedFromIntent`,
`anchorMoveCandidate`). **[TEST]** confirmed the intent inheritance directly
against a real production fixture; the downstream anchor-eligibility flip
is `[INF]`, not yet demonstrated on a run whose evidence weight clears the
anchor threshold. A stale code comment in `detail-load.ts` (misdirecting to
the wrong file) survived the very commit that fixed the real one. Separately,
`computeTodayExecution` (`glance-state.ts`) still grades the day's biggest
canonical run — which, when nothing matched, is by construction the
supplemental run — against the *prescription's* spec, and a file comment
claiming "no runner has actually read a wrong word yet" is **false as
written**: three of its four consumers produce real runner-facing strings
("CAME UP SHORT.", "PARTIAL"); it survives only because the one wired
caller currently discards the result. This is Rule 20's corollary — a
header asserting an invariant nothing gates.

### A duplicate or absorbed run

The predicate-level mechanism (`CANONICAL_ROW_SQL`,
`NOT (data ? 'mergedIntoId')`) is sound and gated — 9/9 passing, no
unguarded windowed coach-copy reader found in a 106-site hand-classified
sweep. **A latent gap confirmed by source, currently at zero live
instances**: `canonical-ref.ts`'s `dangling_pointer` branch (Rule 14's own
motivating incident — a survivor marked absorbed into nothing) returns the
**non-canonical row** on its success branch with a `via` field distinguishing
this fact — and **every one of its four callers discards `via`**, including
the recap route and run-detail. If a dangling pointer or a two-hop pointer
chain ever recurs (the existing gate would not notice one appearing — its
own header admits this), the recap screen would compose coaching copy from
the discarded half of a merge with nothing on the runner's screen saying so.

### An early-ended recovery run / session end during the final recovery interval

**Fixed the same day as this audit** (`WALKBACK-2`, landed on `main`
2026-09-09). **[TEST]** 9/9 passing, verified in both directions: a
deliberate, correct early stop during a walk-back recovery now grades
`'executed'` rather than being capped at `'uneven'`; a genuine unrecorded
lapse mixed with one recorded choice still correctly fails.

### Incomplete and interrupted workouts (general case)

**[TEST]** — the general-case sibling of the two findings above, and the
audit's clearest fabricated numeric claim: `composeTrainingInfluence()`
routes any `'incomplete'` session (a pure completion fact) through the same
branch as `'off_target'` (a pure pace fact), and floors a negative
(faster-than-planned) pace delta to zero via `Math.max(0, delta)`. Fixture:
a long-run work phase cut short, actual pace **10s/mi faster** than
planned →

> *"Long-run pace 0s slow. Endurance signal weaker than the plan calls
> for."*

The literal opposite of what happened. By contrast, the correctly-scoped
per-phase label (`phaseVerdictLabel()`) already keeps `'incomplete'`
("Ended early") and `'slow'` ("Slower than target") as separate verdicts —
its own header cites the historical bug this guards against. The
conflation is reintroduced one layer up, in the session-trajectory summary
only.

### Missing pace / missing or flatlined HR

Missing pace: **silent-correctly** — every pace clause is ternary-gated,
nothing fabricates a value, though the app says less rather than stating an
explicit refusal (defensible). Missing/too-short-rep HR: a genuine,
**[TEST]**-verified three-state Rule 11 contract. **Flatlined/carried-forward
HR is a confirmed real gap**: a sample-and-hold detector
(`hr-trace-credibility.ts`, built directly off a runner complaint) correctly
flags this artifact — but its `credible:false` verdict is consumed **only**
by the adaptation/dosing pipeline. A repo-wide grep across `lib/coach`,
`lib/postrun`, `lib/execution` for the credibility function returns **zero
hits** — `run-recap.ts` can still print "avg HR 103 · controlled" built from
exactly the artifact the app already knows how to detect elsewhere.

### Treadmill

**Fixed the day before this audit** (2026-09-08). `winTreadmill` speaks only
mph/incline, never "pace" — **[TEST]** 5/5 passing, confirms both directions
of a fixed incline-reading bug (a genuinely flat segment no longer reads
`null`; a genuinely graded segment no longer fails to register).

### Hot-weather HR drift without proven causality

**Confirmed live, found independently three times.** **[TEST]**:

> *"Your HR climbed 12 bpm by the end (151 → 163). That's normal in heat
> like this · the body works harder to cool itself, **not because you're
> slowing down**."*

— rendered while the same function has already computed a genuine ~50-58s/mi
pace fade in the last third and chosen not to surface it
(`run-recap.ts:1088`'s guard means the code never inspects the `fade`
variable it already has). Bounded: fires only when heat is material **and**
HR drift ≥8bpm **and** pace also faded >25s/mi — but when it fires, a
runner who is genuinely both hot and fatigued is told confidently that
fatigue isn't a factor. A second instance of the identical shape exists in
`heat-band.ts`'s `heatAwareDrift()`, whose function signature **takes no
pace parameter at all**.

### Hilly race performance

**Best-designed causal-separation area found in the codebase.** The real
(unadjusted) pace is always displayed; a terrain-adjusted number is
internal-only, used only to pick the correct verdict. **[TEST]** 45/45
passing including hilly-easy-run and net-downhill cases. A historical
elevation-model disagreement (two models, 3-6x apart, one fabricated) was
consolidated into one doctrine-cited model. One non-defect gap: PR cards
carry no terrain caveat — a defensible real-world convention, tagged
silent-correctly.

### Good execution without fitness progression / poor execution without evidence of lost fitness

Shares the `training-influence.ts` conflation above. No broader "does one
bad session trigger a false fitness-loss claim" pattern was substantiated
beyond that specific bug — multi-session/ACWR-gated language elsewhere is
correctly scoped to repeated evidence.

### Accepted, declined, deferred, and failed adaptation proposals

Accepted, declined, and deferred each have specific, honest per-kind
reasons and are structurally well-modeled at the domain layer (`decline-facet.ts`'s
13 per-kind decline sentences; a proper `NormalReading`-style refusal type
for staleness). **But the transport and the outcome vocabulary destroy this
at the surface**, confirmed by direct execution of the real mapping
functions and a live Rule-18 gate falsification:

- **A deliberate `SAFETY_STOP` decline refusal (422) renders identically to
  an actual outage**: *"That did not go through, and nothing has changed.
  Try again."* — because the phone decodes only `refusal`/`reason` keys and
  the routes send `error`/`detail`. Nine distinct server-side facts
  (including "the read failed," which the server goes out of its way to
  keep separate) collapse into this one sentence, and retrying can never
  succeed.
- **`'accepted'`, `'accepted-then-failed'`, `'accepted-then-undone'`, and
  `'never-answered'`** all render as the same thing. `acceptProposal()`
  writes `status='accepted'` **before** attempting the apply; nothing
  rewrites it to `'failed'` if the apply breaks (grepped the full path,
  zero `SET status = 'failed'` statements exist). Even if a `'failed'`
  status were ever written, the outcome-mapping switch has no case for it
  and falls through to `'expired'`.
- **`'superseded'`** — the outcome when an evidenced, safety-motivated
  decision correctly overrides a pending push — also renders as
  `'expired'`. A Rule-18 falsification was run live: adding the missing
  `'superseded'` case to the gate's own status enumeration and re-running
  it **still passed**, because the assertion checks "truthy," not
  "the correct word." The gate cannot fail on this class of bug even when
  correctly told to look. So a runner whose push was overruled for safety
  reads that his request "expired," not that safety intervened.
- **Stale-proposal detection only fires after the tap.** Six distinct
  machine-readable reasons collapse into one generic sentence that also
  promises a re-raise the engine's own dedup logic will not honor for up
  to 14 days.

### Apply unavailable (ledger not set up / stale / expired)

**One exemplary pattern, two failing ones.** The "ledger not yet available"
case (`v5-proposals.ts`) removes the action button entirely and states the
exact reason in-voice — cited as the pattern the other two should copy.
Stale detection (above) fires only after the tap. Expired proposals simply
vanish between refreshes with no notice of any kind, and two genuinely
different expiry causes ("the day passed" vs. "you left this 14 days")
collapse into the identical `'expired'` status — despite the underlying
module's own type deliberately keeping them apart one layer down.

### A moved run / travel week

**[TEST]** — drove the real generator four times on an identical fixture
with four different stated reasons (travel / weather / life / none given):
**every runner-facing string was byte-identical across all four.** The
runner's own typed reason (`note`) is dropped by the primary move API
(`POST /api/plan/move` calls `resolveConstraint` with two arguments, never
three) and, even where accepted, is never read by any composer. `travel`
and `life` collapse into the same code path at the replan route. A weather-
forced move has no reason code at all (a genuine gap, but *correct silence*
— nothing invents a weather claim where none exists). Two further confirmed
overclaims:

- *"which is the only day in that week that takes it"* — **[TEST]** false
  against the exact fixture that produced it (`planTravel` takes the first
  viable slot and breaks; a second candidate existed and was never
  evaluated).
- *"This is a calendar change, not a training change"* — **[TEST]** printed
  unconditionally on every ranked option, including the one where the
  same screen's own "What you give up" section lists a dropped quality
  session and 4.5 uncovered miles. Rule 17's own words: *"Where a surface
  contradicts the sentence above it, that is not redundancy but a
  correctness bug."*

The Watch-side envelope also mislabels: *"was long"* fires on a pure
date-move (nothing about type changed) while the actual change (the date)
is never spoken; `originalDateIso` is carried on the wire and never spent.

### Stated goal vs. projection vs. execution target

One genuine owning resolver (`race-outlook.ts` → `race-projection.ts`),
correctly basis-aware (trajectory vs. equivalence produce structurally
distinct copy, never conflated). One acknowledged-but-dormant second
producer (`achievable-target.ts`'s authoring-time ceiling) is logged as
`DECISION NEEDED` in the app's own quantity-owner registry rather than
silently ignored — currently agreeing only because no prescribed race pace
is stamped, not reconciled by design. **See §9** for the confirmed live
List-vs-Detail label divergence on this exact number.

### Post-race recovery and fitness-anchor updates

**No conflation found.** Fitness-anchor-move copy (VDOT re-anchor) and
recovery-state copy (days-since/percent-recovered) are produced by disjoint
code with disjoint vocabulary — no VDOT/LTHR/fitness token appears anywhere
in the recovery-message composer. An explicit code-level guard exists for
the adjacent goal-change case (`fromVdot: null` with the comment "the paces
moved because the GOAL moved, not because fitness did"). This is the
scenario's specific risk correctly avoided.

---

## 5. False-claim & unsupported-causality findings — claim-risk summary

*(Full matrix with every example, frequency, and falsification result in
Track 2 §Part 3. Consolidated here to the claim types that resolved with a
confirmed finding.)*

| Claim type | Finding | Falsification | Severity |
|---|---|---|---|
| **longest** | Tied easy day falsely called unique "longest" | **FALSIFIED**, 32.2% of all composed weeks, `[TEST]`, fixed-but-unmerged | High |
| **because / weather / terrain** | "Not because you're slowing down" while a computed fade is suppressed | **FALSIFIED**, `[TEST]`, found 3× independently | Medium (bounded) |
| **execution** | "0s slow" on a faster-but-incomplete session | **FALSIFIED**, `[TEST]` | High |
| **plan impact / cutback** | "Down from X mi... deliberate" on a week whose mileage went up | **FALSIFIED**, `[TEST]` (adversarial fixture) | Medium |
| **execution (proposal outcome)** | Accepted-then-failed reports as "accepted"; superseded reports as "expired" | **FALSIFIED**, `[TEST]`, gate falsification confirms it can't be caught | Medium-High |
| **race week vs. tune-up** | A C-priority race told "rest is the work now" | **FALSIFIED**, `[TEST]` (3 of 5 hits in a real sweep were C races) | High (contradicts an explicit named ruling) |
| **moved run reason** | "Only day that takes it" claim, unevaluated second candidate | **FALSIFIED**, `[TEST]` against its own fixture | Medium |
| **fastest / best / improved / ready / fitness / fatigue** | No live unsupported superlative found; several exemplary implementations found (see Track 1 #6/#46/#47/#48/#49, Track 2's `coach-log.ts` "longest ever" and `decoupling-trend.ts` "improving") | Not falsified | Low, cite as pattern |

---

## 6. Repetition & contradiction findings

**Confirmed repetition (Rule 17), live today:**

- `readiness-brief.ts`'s streak drawer: the same day-count restated three
  times, "sleep below baseline" restated twice, before any new information
  (`Drawer.tsx:418-428`).
- `heat-acclimatization.ts`'s gate headline is prepended onto its own
  `message`, then both are rendered adjacently — a full sentence repeated
  byte-for-byte, back to back, on the same card, traced end-to-end from
  composer to render call — the strongest concrete Rule-17 hit found in
  this audit.
- `recovery-brief.ts`'s `authorBigCopy` concatenates two independently
  clean functions into *"HRV is down. Tomorrow stands as written. HRV down
  14ms · should rebound to baseline by 06:00."* — the same fact stated
  twice, three words apart, invisible to any per-function test.
- `health-actions.ts`'s TSB-band action/cite pair: byte-identical template
  literal assigned to both `action` and `cite`, rendered adjacently.
- `EASY_DAY_ROLE_LINES.primer`'s two-tied-days collision (§4).
- `FAMILY_NOTES` tail in `generate.ts` appends a fixed sentence to *every*
  hills-family quality day for the whole block — the same repetition class
  as the historical "20-word downhill instruction ×11" bug, currently
  ungated because the existing repetition test only checks within-week.
- `accessibilitySummary` in `postrun/experience.ts`: *"Easy run complete.
  Easy run stayed controlled."* — the same completion judgment twice, from
  two upstream fields nothing cross-checks (unlike `recap-voice.ts`'s
  sibling de-duplication logic, which only covers its own code path).
- `BLOCK_STANDING_SENTENCES`'s hand-maintained table is missing several
  sentences the multi-week post-race-recovery composer repeats once per
  week across a whole recovery block ("Off. Recover.", "Long run back ·
  easy effort.", etc.) — the exact defect class the table exists to close,
  for un-tabled strings.

**Confirmed contradiction (Rule 16), live today:**

- **The HOLD-proposal Block-vs-Decisions-History contradiction** — see §7,
  the strongest cross-surface finding.
- **Race projection List-vs-Detail label divergence** — see §9.
- The `HowItWentPanel.swift` second brain (§3) is architecturally a
  standing contradiction risk against `decoupling-trend.ts`, even though no
  side-by-side screen currently shows both.
- Two backend citations for one concept: `APIV5.swift`'s comment attributes
  work-scoped HR/cadence to `lib/runs/work-averages.ts` and calls it
  "shared with run detail"; `RunDetailV5.swift`'s own comment attributes
  the identical concept to a different file, `lib/coach/reading-scope.ts`.
  Not independently resolved on the backend in this pass — flagged as a
  direct follow-up.
- `RunDetailV5.swift`'s per-piece HR reads "HR 128"; `TodayAfterV5.swift`'s
  reads "128 bpm" — the same quantity, self-acknowledged in the code's own
  comment as a wording split, never unified.
- `RunDetailV5`'s `toleranceLine` ("Held the pace window for X of Y of
  graded work") reaches the shared verdict card's "Why" disclosure only
  when opened via RunDetail; the identical component call from Today never
  passes it — same run, same day, different disclosure depending which
  screen opened it.

---

## 7. Cross-surface consistency matrix

*(Full matrices with every traced field in Track 3. Headline findings only
below.)*

| Fact | Surfaces compared | Call |
|---|---|---|
| Completed tempo run's verdict (Workout B, 2026-09-08) | Today after-run vs. RunDetail | **CONSISTENT by architecture** — both render off the identical `lib/postrun/experience.ts` object, a documented 2026-09-01/02 fix for this exact bug class |
| A pending HOLD (no-op) adaptation proposal | Block vs. Decisions History | **CONTRADICTS, confirmed `[SRC]`** — Block shows a neutral "NOTICE" with no buttons (correct); Decisions History shows amber "WAITING ON YOU" under "STILL OPEN" (wrong), because `v5-decisions.ts`'s outcome mapping checks for `deferral` but never `notice`/`RECORD_ONLY`, unlike its sibling `v5-proposals.ts` which checks correctly |
| CIM race projection number | Races-list vs. Race-detail vs. push | **CONSISTENT on the number** (`[PROD-RO]`-verified live, 3:20:12) — **CONTRADICTS on label/actionability/range**; see §9 |
| Watch race-day resolution | Watch vs. push (race-day/eve) | **RESOLVED, fixed** — both now match by calendar date, not "next A race with a goal" (the historical bug is gone) |
| Watch HR-guidance framing | Watch vs. `RaceDetailV5` | **CONSISTENT** — both trace to the same `resolveRaceHrGuidance` object, verbatim wording |
| Completed-run verdict via push notification | Push vs. Today/RunDetail | **CONSISTENT-BY-DESIGN** — no push ever states a completed run's grade at all (the only run-adjacent push is a self-report nudge), so no channel exists for a contradiction |
| Forced-goal-renegotiation pattern | any surface | **RESOLVED, closed** — no action verb exists for informational proposal kinds; a build gate enforces it |
| CITESCRUB-2 citation-corruption bug | Any surface reading `plan_workouts.notes` | **VERIFIED FIXED** against a real production string, not just a fixture |
| A single-block quality session's "hit" verdict vs. its ~49.5%-out-of-tolerance internal raggedness | Today/RunDetail | **RESOLVED — real, scoped gap, not a contradiction.** Average-based "hit" grading is doctrine-intentional and correct here. The tolerance-ratio composer (`winTimeInTolerance`) requires ≥2 work-phase splits before it will speak — a single-block session has exactly one, so the raggedness is computed, stored, and structurally unreachable by the only composer built to say it, for that entire workout class, on every surface |

**Not fully covered — honestly flagged:** a line-by-line diff of the Watch's
Faces/Notifications verdict vocabulary against the phone's exact wording,
and the literal Swift `Text(...)` call sites for two specific traced runs'
composed recap sentences, were not confirmed to device-render certainty in
this pass. The architecture-level "same object" finding is source-solid;
the literal on-screen text for those two runs is not quoted verbatim.

---

## 8. Supplemental-run truthfulness — analysis

Covered in full in §4. Summary: the **primary fix is real and holds** under
direct execution (post-run copy for a supplemental run is honest,
falsified-then-fixed against the exact historical bug shape). The fix is
**not uniform across the app** — the Evidence Engine's separate date-only
resolver, `computeTodayExecution`'s fallback-to-biggest-canonical-run
grading path, and a stale defensive code comment all still carry variants
of the same "the plan row for this date" mistake the fix was meant to
retire everywhere. None of these are currently wired to a *shown* surface
today (confirmed for the `glance-adapter.ts` case: the claim that "no
runner has read a wrong word yet" is literally false — three of four
consumers produce real strings — but survives by luck, because the one
wired caller discards the result). **This is a live landmine, not a live
defect**, and should be treated with the same urgency as one, per Rule 20's
"fix the gate, not just the instance."

---

## 9. Race-language coherence — analysis

The **number** is genuinely unified: `race-outlook.ts` is the single real
computation, `race-projection.ts` is a verified pure mapping, a static gate
(`_race_projection.test.ts`) names every allowed consumer and fails if a
new one calls the retired resolver directly, and the current CIM projection
(3:20:12) was confirmed **[PROD-RO]** identical across the Races list, Race
detail, and the resolver any push notification would use.

**The framing of that number is not unified**, and this is the closest
surviving relative of the original Rule-16 "nine CIM numbers" incident:

- **List**: the value *is* the headline, labeled bare **"Projected"** — a
  point number, no range, no confidence.
- **Detail**: the *identical* field is demoted to a non-actionable context
  row labeled **"Where this block is built to get you,"** explicitly
  captioned as a forecast rather than fact, **shown with a proper lo-hi
  range** — while a *different* field (`execution.targetSec`, "Race it
  at") becomes the screen's one actionable number.

`docs/PRODUCT_COACHING_DOCTRINE.md` §18 prefers exactly the Detail
treatment (expected + range + confidence) over the List's bare point value.
Each layer is individually well-documented and internally coherent — this
is not an accidental duplicate-computation bug like the original incident —
but a runner tapping from the list they were just told to watch into the
race's own detail page sees that same number relabeled, reframed, and
subordinated, while a different number takes over as "the" number. Neither
route surfaces `confidenceLabel`/`confidenceInterval` at all (confirmed
zero matches in both); the `~` "modelled" glyph is the only uncertainty
affordance either carries through.

**Two additional exposures found, neither currently live in production**:
a legacy `/api/targets/projection` route (once had the identical bug,
fixed, but not on the enforcement gate's consumer list — reachable only via
a legacy launch flag not present in the shipped app) and
`lib/race/retrospective.ts` (a past-race narrative that calls the
explicitly forbidden `predictRaceTime()` directly, currently harmless
because it's gated to a different, historical quantity on past-race-only
screens where the live outlook never computes anyway).

---

## 10. Fact / Interpretation / Uncertainty / Action assessment

Ten representative real sentences were classified (full table in Track 4
§Step 4). Findings:

- **A clean, compliant pattern exists** and should be the reference: *"You
  called yesterday's tempo a grind · today stays truly easy."* (FACT — the
  runner's own subjective input — plus ACTION, no invented interpretation).
  Milestone statements ("Biggest week of the block · 42.1 mi · both quality
  days landed.") are similarly clean, telemetry-shaped but earned.
- **A recurring pattern of interpretation delivered with the full grammar
  of settled fact**, no hedge, no confidence marker: the Coaching Thesis's
  daily "why" opener ("Holding your pace late in a race is the thing to
  move right now...") is a genuine limiter-classification interpretation
  stated flat. **This is not automatically a defect** —
  `PRODUCT_COACHING_DOCTRINE.md` §30 explicitly models confident, unhedged
  coaching language as the house style, and the amber `~` mark is scoped to
  numbers, not prose. Whether these specific instances *should* carry a
  confidence signal depends on the actual confidence behind `thesis.limiter`
  on those dates — **this audit cannot see that from the wire payload
  alone.** Classified **BLOCKED ON BRAIN TRUTH** (see §11).
- **The same interpretive opener repeats verbatim across non-adjacent days**
  addressing the same limiter (2026-09-08 and 2026-09-18, 10 days apart,
  `[PROD-RO]`) — the composer has ≥2 phrasing variants proven to exist
  (2026-09-13 uses a different one) but doesn't rotate them across
  non-adjacent thesis-days.
- **Engine jargon standing in for an interpretation the sentence never
  actually gives**: "VDOT" appearing bare where doctrine's own canonical
  example ("You're consistently outperforming these targets. It's time to
  move them") is plain language — detailed in §12.

---

## 11. Rendered evidence / verification tier

Per Rule 13, this section states plainly what was and was not confirmed by
looking at an actual screen.

- **`[RENDER]`-confirmed** (exact Swift `Text(...)` call site traced from a
  real composed value): the VDOT-jargon leak into `DecisionHistoryV5.swift`
  and `CoachLogCard.swift` (§12 Defect A/B); the heat-acclimatization
  headline/message double-render (§6); `PostRunVerdictV5`'s shared-component
  consumption by both Today and RunDetail.
- **`[PROD-RO]`-confirmed** (live account data): the CIM 3:20:12 projection
  across surfaces; the readiness/"why" sentences captured on six real dates;
  the pending HOLD proposal's cross-surface contradiction; the tempo
  workout's 49.5%-out-of-tolerance work phase.
- **`[TEST]`-confirmed** (real composer functions executed against
  fixtures, including full 8,781-archetype corpus sweeps): both known bugs,
  all three new false-claim defects, the cutback-flag defect, the C-race
  taper-language defect, the moved-run reason-collapse defect, the proposal
  outcome-collapse defect, the Rule-18 gate falsification.
- **`[BLOCKED]`, honestly**: full device-level simulator verification of
  any screen (no reachable dev server this session); the exact confidence
  value behind `thesis.limiter` on the captured dates (Brain-truth
  dependency, §11); a full line-by-line Watch-vs-phone verdict-vocabulary
  diff.

No claim in this report substitutes a sample fixture for a display-fix
verification, and no claim asserts a defect is fixed on the strength of a
comment alone — every "fixed" verdict above cites either a fail-before/
pass-after test execution or a live production data point.

---

## 12. Severity-ranked fixes — recommendation matrix

Classification legend: **KEEP** / **REFINE** / **UNIFY** / **REMOVE** /
**BLOCKED ON BRAIN TRUTH**. Priority: release blocker / high-frequency
high-trust / material / polish / later-expansion.

| # | Finding | Classification | Priority | Evidence |
|---|---|---|---|---|
| 1 | `HowItWentPanel.swift` computes its own HR-drift verdict client-side, ignoring the canonical `decoupling-trend.ts` resolver, with two internally-inconsistent thresholds in the same file | **REMOVE** the client computation, call the backend resolver | **Release blocker** | Track 1 #32, `[SRC]` |
| 2 | Adaptation-proposal outcome vocabulary collapses failed/undone/never-answered/superseded into pending/expired; a SAFETY_STOP refusal renders as a retryable outage | **REFINE** the transport (decode `error`/`detail`, not just `refusal`/`reason`) and the outcome mapping (write `'failed'`, add its case; keep `'superseded'` distinct from `'expired'`) | **Release blocker** | Track 2B, `[TEST]`, gate falsification |
| 3 | `standing-recommendation.ts` fires a live, single-domain "ease this run" recommendation, contradicting the app's own three-domain convergence rule | **REFINE** to require the same convergence gate its sibling doctrine already enforces elsewhere, or **REMOVE** and route through the existing convergence-gated adaptation surface | **Release blocker** | Track 1 #44, `[SRC]`, live and wired |
| 4 | Both known bugs (false "longest" tie-claim, primer collision) confirmed present on `main` at 32.2% of composed weeks; fix exists, unmerged | **Cherry-pick** the two commits' `generate.ts`/`runner-instruction.ts` changes onto `main` in an isolated worktree — **do not merge the branch**, which would regress ~50 unrelated files | **Release blocker** | Track 1 §0, Track 2 §Part 1, `[TEST]` |
| 5 | Mid-block tune-up races cause `is_cutback` to mark race weeks as deloads and miss real deloads; a C-priority race told "rest is the work now" against an explicit doctrine ruling | **REFINE** `embedMidBlockRaces` to branch on priority; **REFINE** `is_cutback` derivation to not fire on a week containing a race | **Release blocker** | Race-week/cutback sub-audit, `[TEST]` |
| 6 | `training-influence.ts` fabricates "0s slow... weaker than the plan calls for" on a faster-but-incomplete session | **REFINE** — route `'incomplete'` through a distinct "ended early" copy path, matching `phaseVerdictLabel`'s already-correct vocabulary | **High-frequency high-trust** | Track 2A, `[TEST]` |
| 7 | Cutback-week copy asserts "down"/"reduction" unconditionally on the authored flag, never checked against actual mileage | **REFINE** — gate on `vol < prevVol`; if disagreeing, state the disagreement or fall back to a flag-only sentence with no directional claim | **Material** | Track 2B, `[TEST]` |
| 8 | Readiness/Today has 5 independent narrators of one `ReadinessBreakdown`, with disagreeing numeric thresholds | **UNIFY** into one owning composer, or at minimum align thresholds via a shared constant | **High-frequency high-trust** | Track 1 #42, `[SRC]` |
| 9 | Heat-drift copy asserts "not because you're slowing down" while suppressing a computed genuine pace fade | **REFINE** — check `fade` before asserting; if both fire, say both facts | **Material** (bounded firing condition) | Track 2, found 3×, `[TEST]` |
| 10 | Systemic "VDOT" jargon leak on the doctrine's flagship upward-adaptation moment (5 call sites) + a second "VDOT haircut" instance on comeback-from-injury copy | **REMOVE** the token from every template; **REFINE** the gate to cover `lib/plan`/`lib/coach` or scan every `why:`/`reason:` literal feeding `coach_intents.value.why` | **High-frequency high-trust** | Track 4 Defects A/B, `[SRC]`+`[RENDER]` |
| 11 | Literal `ACWR`/`limiter` jargon leaks in `web-v2/lib/coach` (health-actions.ts, readiness-brief.ts) with zero gate coverage, because the jargon scanner never targets that directory at all | **REFINE the gate** first (widen `jargon_targets()`), then remove the literals it surfaces | **Material** | `lib/coach` composer sub-audit, `[SRC]` |
| 12 | Duplicated aerobic/HR-ceiling verdict (`readCost` vs. `aerobicEarned`), different grace bands, live for the ungraded population | **UNIFY** on one resolver | **Material** | Track 1 #18, `[SRC]` |
| 13 | HOLD adaptation proposal renders calm on Block, "WAITING ON YOU"/STILL OPEN on Decisions History | **REFINE** — add the missing `notice`/`RECORD_ONLY` branch to `v5-decisions.ts`'s outcome mapping | **Material** | Track 3 §3, `[SRC]` |
| 14 | Race projection List vs. Detail: same number, different label/actionability/range | **REFINE** the List to show a range and confidence per doctrine §18, or explicitly reconcile which field is "the" number a runner should track across both screens | **Material** | Track 3 §4, `[PROD-RO]` |
| 15 | Moved-run/travel-week copy never states the actual reason (byte-identical across travel/weather/life/none); "only day that takes it" claim is false against its own fixture; "calendar change, not training change" prints even when a quality session is dropped | **REFINE** — surface the runner's own typed `note`; check the claimed uniqueness before asserting it; gate the calendar-only line on whether anything besides the calendar actually changed | **Material** | Moved-run sub-audit, `[TEST]` |
| 16 | Evidence Engine's `load-activity-evidence.ts` still resolves a day's prescription by date only, letting a supplemental run inherit `plannedIntent` | **REFINE** to match by run identity, mirroring the fix already applied in `lib/postrun/load.ts` | **Material** | Supplemental-run sub-audit, `[TEST]` |
| 17 | `computeTodayExecution` grades the day's biggest canonical run (often the supplemental run) against the prescription's spec; its own comment's "no runner has read a wrong word" claim is false as written (survives only because the one wired caller discards the result) | **REFINE** — exclude the supplemental-run fallback from prescription grading; fix or delete the false comment | **Material** | Supplemental-run sub-audit, `[SRC]` |
| 18 | Three-way "why this run" vocabulary duplication (`run-purpose.ts`, `session-cue.ts`, `runner-instruction.ts`), two shown together on one payload, already drifted | **UNIFY** onto one resolver | **Material** | Track 1 #35/#36, `[SRC]` |
| 19 | Four independently-computed "longest run" quantities share identical wording with no qualifier distinguishing recent/ever/date-range; native Activity-tab tiles have zero data-quality gating (the sibling "fastest pace" tile in the same function was already fixed the same way) | **REFINE** — apply the same fix pattern to the three remaining tiles; **UNIFY** naming with an explicit qualifier | **Material** | Track 1 #14/#21/#33/#39, `[SRC]` |
| 20 | `EASY_DAY_ROLE_LINES`'s `BLOCK_STANDING_SENTENCES` table is hand-maintained and missing several multi-week recovery-block sentences that repeat once per week across a whole block | **REFINE** — add the missing sentence IDs | **Polish** | Track 1 #3, `[SRC]` |
| 21 | `FAMILY_NOTES` tail concatenates a fixed sentence onto every hills-family quality day for the whole block, ungated because the repetition test is within-week only | **REFINE** the repetition gate to check across weeks, or vary the sentence | **Polish** | `lib/plan` copy sub-audit, `[SRC]` |
| 22 | `accessibilitySummary` restates the completion judgment twice from two upstream fields with no cross-check | **REFINE** — apply the same de-duplication `recap-voice.ts` already has | **Polish** | `postrun`/`faff` composer sub-audit, `[SRC]` |
| 23 | Watch/phone verbatim reuse of 15-23-word reasoned sentences on the mid-run bail-decision board (a deliberate, documented consistency choice) | **KEEP or REFINE** — the choice is intentional; consider a shorter watch-specific variant if on-wrist legibility complaints arise | **Polish** | Watch copy sub-audit, `[SRC]` |
| 24 | `layerOne`'s 2-of-3 clause cap silently drops the plan-impact/action clause from the primary post-run sentence whenever verdict+reason are both present | **REFINE** — raise the cap or prioritize differently so the action clause reliably reaches Layer 1 | **Material** | `postrun`/`faff` composer sub-audit, `[SRC]`+`[TEST]` |
| 25 | `health-state.ts`'s four-pillar `percentRecovered` structure still computes and serves a "fake precision" API contract the client already diagnosed and stopped rendering in June | **REFINE at the source** (the client fix papered over the instance, not the gap) | **Later expansion** (currently latent, zero live consumers) | Track 2, `[SRC]` |

**Positive patterns to replicate**, cited throughout and consolidated here:
race projection's single-resolver + consumer-list gate; `personal-records.ts`'s
three-rung, absorption-safe, tie-safe race-PR ladder; `goal-outlook-copy.ts`'s
fix for the historical forced-goal-renegotiation incident (a sentence that
can no longer be persisted); `coach-log.ts`'s "longest run ever" claim
(0.2mi margin, 10-run minimum, absorption-filtered); `decoupling-trend.ts`'s
"improving" claim (canonical dedup, heat exclusion surfaced not hidden,
tightened threshold); `heat-band.ts`'s single-owner heat taxonomy
(consolidated from four disagreeing ones); `training-influence.ts`'s own
pace-tolerance unification (ironic given finding #6 above lives in the same
file — the tolerance fix and the completion/pace conflation are
independent); `v5-decisions.ts`'s accepted/declined/deferred vocabulary
(careful, Rule-11-compliant, apart from the `'failed'` gap); the
ledger-unavailable Apply-disabled pattern in `v5-proposals.ts`; the
recovery-phase message's shared, five-consumer canonical resolver;
`achievable-target.ts`'s verified-continuous Rule-9 fix.

---

## 13. Blocked on Brain truth

This audit does not resolve underlying fitness/adaptation/execution-grading
semantics — that is the separate Brain audit's territory. The following
coaching-language questions cannot be closed without its findings:

1. **The Coaching Thesis daily "why" opener's unhedged interpretive
   language** (§10, Finding F/G in Track 4) — whether flat declarative
   language is earned depends on the actual confidence behind
   `thesis.limiter` on the captured dates, which this audit cannot see from
   the wire payload.
2. **`achievable-target.ts`'s dormant second producer** for a race-target
   number — the app's own registry already logs this as `DECISION NEEDED`,
   agreeing with `race-outlook.ts` only because no prescribed race pace is
   currently stamped; whether and how to reconcile it is a Brain-side
   ownership call.
3. **Whether the confidence-weighted, three-anchor fitness doctrine should
   reach the runner-facing Profile VDOT display at all**, or whether that
   doctrine is correctly scoped to internal decisions only — a product
   decision, not a copy bug, once the Brain audit states which is intended.
4. **The dangling-pointer/duplicate-merge latent risk** (§4, duplicate/
   absorbed run) — whether the current zero-live-instances count is
   durable depends on how the Brain audit's canonical-run-identity work
   evolves; the coaching-language fix (make every consumer check `via`)
   should land regardless, but its urgency is a Brain-side call.
5. **`threshold-pattern.ts` naming a specific limiter without routing
   through the canonical `diagnoseLimiter`** — resolving which resolver
   should own this is a Brain Constitution ownership question, not a
   language-layer fix.

---

## 14. Recommended implementation order

1. **Land the two known-bug fixes** — cherry-pick, not merge, onto `main`
   (item 4). Lowest risk, highest-confirmed-frequency, fix already written
   and tested.
2. **Fix the three release-blocker doctrine violations** — the
   `HowItWentPanel.swift` second brain (item 1), the single-domain
   readiness recommendation (item 3), and the proposal-outcome/transport
   collapse (item 2). These are the findings most likely to produce a
   runner-visible wrong or unsafe statement, and none require new product
   decisions — they require routing existing correct data to where it
   already should have gone.
3. **Fix the cutback/race-week engine defect** (item 5) — it produces a
   confirmed, doctrine-contradicting statement ("rest is the work" on a C
   race) on a surface every runner with a mid-block tune-up race will hit.
4. **Fix the three new false-claim defects** confirmed by direct execution
   (items 6, 7, plus the moved-run reason collapse, item 15) — each is a
   scoped, single-file change with an existing adversarial fixture to
   regression-test against.
5. **Close the jargon-gate gap and the specific VDOT/ACWR/limiter leaks it
   let through** (items 10, 11) — widen `jargon_targets()` first (one
   config change protects every future addition), then remove the current
   leaks.
6. **Unify the readiness narrators and the "why this run" three-way
   vocabulary** (items 8, 18) — larger refactors, schedule after the above.
7. **Everything classified Material/Polish** (items 12-14, 16-17, 19-24) —
   batch into a cleanup pass; several are one-line gate or branch additions.
8. **Item 25** (`health-state.ts` fake-precision pillars) — later expansion,
   currently latent with zero live consumers; fix at the source before any
   new surface is tempted to consume the API contract as-is.

---

## 15. Exact next-TestFlight blockers

Before the next TestFlight build ships, this audit recommends confirming:

- **Item 3 is not live-fireable in the shipping build** — a wired,
  single-domain safety-adjacent recommendation contradicting the app's own
  convergence rule is the highest-risk item in this report for a runner
  who acts on bad advice.
- **Item 2's SAFETY_STOP-renders-as-retryable-outage path** — a runner who
  hits this cannot successfully retry and receives no correct information
  about why; this degrades trust in the entire decisions surface on
  exactly the interaction (a safety refusal) doctrine cares most about
  getting right.
- **Item 5's C-race "rest is the work now" claim** — directly contradicts
  a ruling the team itself recorded as settled; will visibly fire for any
  runner whose block includes a C-priority race mid-block.
- Items 6 and 7 (fabricated "0s slow" and false cutback "down/reduction"
  claims) are both confirmed-reachable, both high-specificity (they
  substitute real numbers, which makes the false claim read as more
  credible, not less).

Everything else in §12 is real and worth fixing but does not rise to the
same "ship risk" bar — most are either latent (zero current live
consumers), bounded to rare trigger conditions, or naming/consistency risks
without a demonstrated live disagreement yet.

---

## 16. Transfer section for the main programme lead

- **This audit's scope was strictly the translation layer.** Every finding
  above assumes the underlying facts it traces are themselves correct;
  where a finding depends on an underlying fact's correctness (§13), it is
  marked Blocked on Brain truth rather than asserted either way.
- **The unmerged fix branch (`origin/fix/coach-voice-tie-and-primer`) is
  correct in its two targeted changes and unsafe to merge as a whole** — it
  is behind `main` in ~50 unrelated files and would regress real,
  unrelated work if merged directly. The two commits' `generate.ts`/
  `runner-instruction.ts` changes plus their new test files should be
  cherry-picked onto `main` in an isolated worktree.
- **Every claim in this report carries a file:line citation in its source
  track file.** Where this consolidated report abbreviates a finding, the
  full trace — including raw test output, exact adversarial fixtures used,
  and the specific query text for `[PROD-RO]` claims — is preserved in the
  four linked track files under `docs/reports/coach-audit-2026-09-09/`.
- **Do not treat a "ROUTED"/"KEEP" verdict above as permanent.** Several of
  the strongest positive findings (race projection, the readiness/decision
  vocabulary) are exemplary specifically because they were built with a
  gate that would fail if broken again — the absence of an equivalent gate
  is itself flagged wherever this audit found one missing (items 2, 10, 11,
  13 above all include "fix the gate" as part of the recommended change,
  not just the instance).
- **Two gate-level infrastructure gaps were found that apply beyond any
  single finding in this report**: (a) `scripts/check-coach-voice.sh`'s
  jargon scanner does not cover `web-v2/lib/plan` or `web-v2/lib/coach` at
  all, meaning any future jargon leak in either directory ships silently;
  (b) `_v5_decisions.test.ts`'s outcome-mapping gate was demonstrated live
  to be structurally incapable of catching a status mapped to the wrong
  (but plausible) word, even when the missing case is added to its own
  enumeration. Both should be treated as standing debt independent of the
  specific findings that exposed them.

---

## 17. Final verdict

**Can the coach explain the runner's training briefly, truthfully and
consistently without inventing facts, duplicating the Brain, or requiring
backend interpretation?**

**Briefly:** Partially. Where the architecture is sound (race projection,
personal records, the accepted/declined proposal vocabulary), the copy is
short and specific. Where it isn't (the comeback re-ramp sentence's seven
raw numbers, the injury protocol's four-sentence self-referential
disclosure, the VDOT-jargon leaks), it either recites telemetry with no
decision attached or names an internal concept the runner was never taught.

**Truthfully:** No, not yet, on the evidence in this report. Two known
false claims are confirmed still live on `main` at material scale (32.2% of
composed weeks); three new false claims were found and confirmed by direct
execution in this audit alone; one invented-causality pattern was found
independently three times.

**Consistently:** No, not yet. A live cross-surface contradiction exists
today (the HOLD proposal reads calm on one screen and urgent on another for
the identical row); a subtler but real inconsistency survives in the race
projection's framing across two screens showing the same number; four
independently-computed "longest run" facts share identical wording with no
disambiguating qualifier.

**Without duplicating the Brain:** No. The clearest violation in this
entire audit is architectural, not textual: a native Swift panel computes
its own physiological verdict client-side and never asks the backend's
canonical resolver for the answer it already owns. A second, adjacent
violation is live and wired: a single-domain readiness recommendation
directly contradicts the app's own stated multi-domain convergence rule.

**Without requiring backend interpretation:** Where it is well-built, yes
— the exemplary patterns cited throughout this report consume structured
conclusions and do not re-derive them. This is proof the standard is
achievable in this codebase, not a hypothetical: several of the findings
above are literally the same defect class as a sibling function that got
it right, in the same directory, sometimes the same file.

**The honest summary**: this is not a codebase that lacks discipline — it
has doctrine, gates, ratchets, and a real history of catching and fixing
exactly this class of bug (the race-projection rewrite, the
forced-goal-renegotiation fix, the terrain/pace separation). What it has
not yet done is apply that discipline evenly. The gaps found in this audit
are concentrated exactly where the brief predicted them: runtime-assembled
fragments no string-literal gate can see, jargon in directories the jargon
scanner doesn't cover, and independently-maintained vocabularies that were
never forced through one resolver. None of the findings in this report
require inventing new architecture to fix — every one of them has a
correct sibling pattern already living somewhere else in this same
codebase.
