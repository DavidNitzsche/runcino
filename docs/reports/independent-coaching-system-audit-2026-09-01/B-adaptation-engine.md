# Independent audit — faff.run Adaptation Engine + owner-only PACE canary

**Auditor:** Agent B (independent). **Date:** 2026-09-01.
**Base:** isolated worktree at `main` tip `7cac80f0` (`git rev-parse HEAD` = `7cac80f006cca1e1718bdb9dfdff48a3e22f4166`, `web-v2/` and `native-v2/` both present). Branch under review: `origin/pace-canary-infrastructure-20260901` @ `a0051439`, reviewed in a separate isolated worktree.

> **Worktree provenance.** This worktree was created from the stale `claude/build-runcino-app-OIRJr` line at `f43fb7a7`, which has no `web-v2/` or `native-v2/`. I detected this before reading any code (`ls web-v2` → absent), ran `git fetch origin main` + `git reset --hard 7cac80f0`, and verified the tree. **Every finding below was produced against `7cac80f0`, not the stale line.**
**DB access:** `faff_readonly` role only, verified with `select current_user` before every query batch. No writes attempted, none possible.
**No mutation was enabled anywhere. No commits, no pushes.** Worktree left clean (`git status --short` empty).

Evidence grades used throughout: **[DV]** direct verification (I read the code at the cited line, or ran the command and report its real output) · **[CPI]** code-path inference · **[FIX]** fixture evidence only · **[UNV]** unverified.

---

## 0 · Headline

Nine of the twelve mechanisms the handback reports claim are, on inspection, **real, well-built, and honestly documented**. The phase-aware PACE targeting, the `INSUFFICIENT_EVIDENCE` fifth state, the compound-lever guard, the convergence guard, the zero-mutation checksum and the MASKING-1 fix all do what is claimed, and the stability-report tool is genuinely read-only and genuinely honest about what it cannot prove.

But four findings materially change the canary decision, and three of them are new:

| # | Finding | Severity |
|---|---|---|
| **F1** | The live PACE `PROGRESS` proposal rests decisively on **two quality sessions run inside a prescribed post-race recovery window** (2026-08-23, 2026-08-30 — days 7 and 14 after the AFC half). Remove them and the corroboration count drops 4 → 2, below the bar of 3, and the proposal ceases to exist. | **Blocking** |
| **F2** | The shadow log's `PROGRESS` PACE row is a proposal the engine itself **DEFERRED**. Its own ranking chose DURATION as this cycle's primary stressor. The log records no `deferred` flag, so it reads as an endorsement the engine did not give. | **Blocking** |
| **F3** | A **live Rule 9 cliff** at the evidence-lookback boundary: a one-unit change in `targetRepresentativeDays` (21 → 22) flips PACE from `INSUFFICIENT_EVIDENCE` to `PROGRESS`. The owner's account sits exactly at the first step that clears the bar. The "Rule 9" test that exists checks the wrong quantity. | **Blocking** |
| **F4** | The zero-run QA accounts' `HOLD · "block is not being absorbed"` is a genuine Rule 11 collapse (see §12), and `contradictionsIn` is structurally incapable of catching it. The same mechanism can reach the owner via a sync outage. | **Blocking** |

Plus: the shadow log contains **two calendar days**, not the 36 the git-tracked JSONL suggests — those 36 lines are local test-run artifacts, and I reproduced the mechanism that creates them (§11.2).

**Verdict: NO canary yet.** Detail and exact criteria in §16.

---

## 1 · PACE phase-aware targeting — **CONFIRMED, with one caveat**

### Is the target grouped by authored phase, not a blended AVG? — **YES [DV]**

`web-v2/lib/adaptation/load-adaptation-engine.ts:342-364`:

```sql
SELECT ph.label AS phase_label,
       ROUND(AVG(pw.pace_target_s_per_mi))::int AS avg_s, ...
  FROM plan_workouts pw
  LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
  LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
 WHERE pw.plan_id = $1 AND pw.date_iso >= $2
   AND pw.type IN ('threshold','tempo','cruise')
   AND pw.pace_target_s_per_mi IS NOT NULL
 GROUP BY ph.id, ph.label
 ORDER BY MIN(pw.date_iso)
```

The average is taken **within** each phase (`GROUP BY ph.id, ph.label`), never across phases. Grouping keys off `ph.id`, so two phases sharing a label stay separate. An unphased row falls into its own `NULL` bucket (`LEFT JOIN`), documented at `:339-340`. The type carries this structurally: `PacePhaseRead` (`adaptation-engine.ts:544-557`) and `PacePhaseOutcome` (`:567-574`), with `phaseBreakdown` on the proposal (`:372`).

Live confirmation, from the shadow audit run against the owner's real account:

```
QUALITY        7:15/mi · 6 row(s) · 2026-09-01 → 2026-10-13
RACE-SPECIFIC  7:04/mi · 4 row(s) · 2026-10-20 → 2026-11-13
TAPER          7:55/mi · 2 row(s) · 2026-11-17 → 2026-11-24
```

Three separate numbers, not the old blended 438.

### Does TAPER get "clamped to its own doctrinal ceiling"? — **Literally yes; the phrasing overclaims [DV]**

`phaseStep` (`adaptation-engine.ts:897-920`) computes each phase's ceiling from **that phase's own prescribed pace**:

```ts
const believedVdot = vdotFromTpace(prescribed);
const stepCeiling = believedVdot != null
  ? (() => {
      const faster = tPaceFromVdot(believedVdot + TRAINING_LEAD_REANCHOR_DELTA);
      return faster != null ? Math.max(PACE_PROGRESS_MIN_STEP_SEC_PER_MI, prescribed - faster) : gain;
    })()
  : gain;
const step = Math.min(gain, stepCeiling);
```

The ceiling is **one training-lead VDOT point** (`TRAINING_LEAD_REANCHOR_DELTA = 1.0`, `web-v2/lib/training/pace-anchor.ts:64`) priced at that phase's own pace. **There is no taper-specific doctrinal ceiling.** It is the same generic quantum, and because one VDOT point is worth more seconds at a slower pace, the effect is that **TAPER receives the LARGEST speed-up of any phase**.

Live, on the owner's account (production `adaptation_shadow_log` id 10, `engine_explanation`):

> Move 2 of 3 upcoming phases: **QUALITY 5 sec/mi quicker** (6 rows, 2026-09-01–2026-10-13); **TAPER 9 sec/mi quicker** (2 rows, 2026-11-17–2026-11-24).

`phases_moved = {QUALITY,TAPER}`. RACE-SPECIFIC does not move (its 7:04 is already 6 s/mi ahead of the 7:10 belief → `gain < 0` → `moved:false`).

Two problems with this, neither of which is a code defect but both of which matter for a canary:

- The engine's own comment at `adaptation-engine.ts:1044-1046` asserts *"A phase whose own prescription is already at or ahead of capacity (RACE-SPECIFIC, often; **TAPER, by design**) reports `moved: false`."* **On the real account TAPER moved.** Its 7:55 is 45 s/mi *behind* the belief, not ahead. The comment describes a case that did not occur, on the very account it was written against — a Rule 20 shape (prose asserting an invariant nothing gates).
- The TAPER rows are dated **2026-11-17 / 2026-11-24, 78 days out**. Moving them on today's evidence is close to meaningless: the plan will be re-derived dozens of times before then. A canary that writes them is spending mutation budget on rows that will be overwritten.

**Recommendation:** bound the mutation to the *nearest* phase (or to rows within N days), not to every future phase. That is a one-line scope on the canary, not an engine change.

---

## 2 · DURATION vs VOLUME evidence separation, and the decisive limiter today

**[DV] — full output from `npx vitest run lib/adaptation/_adaptation_engine.audit.test.ts` against `DATABASE_URL_RO`, owner account, anchored at 2026-08-31:**

| Lever | Decision | Decisive limiter |
|---|---|---|
| **PACE** | `PROGRESS` → **DEFERRED** | Nothing blocked it. It lost the one-stressor tie-break to DURATION. |
| **VOLUME** | `HOLD` | **Historical tolerance 33.4 mi/wk vs 45 mi/wk prescribed.** Reasons `CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION` + `LOAD_NOT_YET_ABSORBED`. |
| **DURATION** | `PROGRESS` (promoted) | Nothing. 15 → 16 mi long run, conf 0.56. |
| **DENSITY** | `REFUSED` | `NO_AUTHORED_PROGRESSION_BLOCK` — the plan has no progression block this week. |
| **SCHEDULE** | — | 0 sessions out of place. |

Verbatim VOLUME hold: *"Weekly volume holds at 45 mi. Your own recent training averages **33.4 mi a week**, which is below the week already prescribed."* **The 33.4-vs-45 claim is confirmed.**

### Is that reader Rule-8 filtered? — **YES [DV]**

`load-adaptation-engine.ts:440-442` calls `normalWeeklyMileage(userUuid, today, ADAPTATION_VOLUME_TOLERANCE_WINDOW_DAYS)` — the shared Rule 8 filter in `lib/training/normal-window.ts`. The refusal arm is carried through, not flattened (`:442-452`): a `NormalReading` refusal maps to `{ok:false, reason:'NOT_ENOUGH_REPRESENTATIVE_TRAINING'}`, never to `0`. The audit printed *"historical volume tolerance · 33.4 mi/wk over **62 representative days**"* — filtered, and the denominator says so.

The fork is stated explicitly and correctly at `load-adaptation-engine.ts:37-63`:

- **NOT filtered** — `recentWeeks` (tissue-load / absorbed-load question, Rule 8's corollary).
- **FILTERED** — `historicalTolerance` (habit/capability question).
- **EXTENDED, not filtered** — quality-session and long-run windows.

That third branch is where F1 lives (§5).

### Are the levers evidentially independent? — **Not entirely [DV]**

The header at `adaptation-engine.ts:79-81` says *"each detector receives ONLY its own slice of the input, and no detector can see another's evidence."* That is true of the **plumbing** (separate typed sub-objects). It is not true of the **evidence**: activity `2026-08-30` (13.49 mi) appears in *both* the PACE controlled-session list *and* the DURATION long-run list in the audit printout. One activity licenses two levers. Given the one-stressor rule only one fires per cycle, this is currently harmless — but the header reads stronger than the code guarantees.

---

## 3 · DENSITY reachability — **CONFIRMED EXACTLY [DV]**

Production, read-only:

```
 total_plan_workouts | with_progression
---------------------+------------------
                4639 |                6
```

Distribution — all three are *active* plans:

| user | plan | rows | with progression |
|---|---|---|---|
| bcefea06… | pln_2684dabde181e595 | 105 | 3 |
| 9298919a… | pln_bb0ee646c2ace790 | 91 | 2 |
| **0645f40c… (owner)** | **pln_9a57561debb776e5** | 103 | **1** |

The owner's single progression row:

```
 wko_c2f12cc10284a1a2 | 2026-10-29 | intervals | is_quality=t
```

**The claim is exact: 1 owner row, 6 app-wide out of 4,639.** And the one row is dated **2026-10-29**, about eight weeks out, so the weekly gate has nothing to read now and will have exactly one row to read, once, in late October. `densityGate = NO_AUTHORED_PROGRESSION_BLOCK` in every cycle logged.

The refusal is honest and correctly attributes cause (production `engine_refusals`): *"This is an authoring gap in the Plan Generator, not a runner-evidence gap, and no amount of training will close it."* Good Rule 11 discipline. But per Rule 21 the mechanism is **wired, tested and inert** — this codebase's signature failure. DENSITY is not a lever today; it is a refusal generator.

---

## 4 · Representative vs actual-load readers — **CONFIRMED, with a residual hole**

### Does the live path still read the unfiltered reader? — **YES [DV]**

`web-v2/lib/adaptation/load.ts:494-502`:

```ts
export async function readAdaptation(userUuid, todayArg) {
  const input = await quiet('adaptation input', () => loadAdaptationInput(userUuid, todayArg));
  if (!input) return null;
  return classifyAdaptation(input);          // ← the UNFILTERED input
}
```

Its own header (`:486-493`) states this is the live call consumed by `progression-pass.ts` via `adapt.ts:detectProgressionGate`, and that behaviour is preserved byte-for-byte. `load.ts:764-766` confirms neither split output is wired anywhere.

### MASKING-1 fix — **CONFIRMED [DV]**

`load.ts:616-624`:

```ts
function applyRepresentativeWindow<T>(readableRows, isExcluded, isNegative): T[] {
  const representative = readableRows.filter((r) => !isExcluded(r));
  if (representative.length > 0) return representative;
  return readableRows.filter(isNegative);            // total-washout fallback
}
```

Negative valence only: `isNegativeKeySessionSignal` = `MISSED || PARTIAL_FAILED` (`:610-612`); `isNegativeVerdictSignal` = `'slow'` (`:614`). It rescues evidence **against** progression only, never for it. The reasoning is written out at `:558-597` and is sound.

### Is there any remaining way filtering is MORE permissive? — **YES, and it is the fix's own argument left half-applied [DV]**

MASKING-1 fires **only on total washout** (`representative.length > 0` returns early, `load.ts:622`). But its own stated rationale is broader (`load.ts:576-580`):

> *"Rule 8 does NOT say a genuine failure on that same day is excused from counting against progression — a session that went badly is still evidence against progression, and the calendar it fell on does not launder that away."*

That argument does not depend on total washout. Consider a window holding **one good non-prescribed session and three failed prescribed sessions**. `representative.length === 1 > 0`, so the fallback never runs, and the three failures are dropped while the good session survives. The filtered read is strictly **more permissive** than the unfiltered one — the exact direction the fix exists to prevent, just below the threshold it checks.

Not currently live (neither split output is wired). **But it must be closed before `representative_execution` is ever promoted.** The fix is to make the negative-rescue unconditional rather than washout-gated.

Secondary note: on the washout path, `keySessionsPlanned` / `keySessionsCompleted` are re-derived from the **rescued** set (`load.ts:673-679`), so the narration counts describe only the negative rows. Conservative direction, but the numbers are not what a reader would expect.

---

## 5 · `extendLookback` — constants honest; **Rule 9 cliff is real and live**

### Are 120 and the half-life doctrine-cited or conventions? — **Honestly labelled CONVENTIONS [DV]**

Both are correct and, unusually, not overclaimed.

- `REPRESENTATIVE_LOOKBACK_MAX_DAYS = 120` (`normal-window.ts:643`). Gated by `CONVENTION.representative-lookback-outer-bound` (`lib/doctrine/registry.ts:1162-1215`), whose claim text says plainly: *"How far back it may reach is a CONVENTION, not a research finding — Research/ does not model an evidence lookback."* The gate reads the **floor** out of `Research/00b` at run time (marathon taper 3 wk + post-race recovery, parsed from the doc's own table cell) and fails if the bound falls below `worstBlockDays + 28`, and separately fails above 200. Rule 18-compliant: numbers read from source, not hardcoded on both sides.
- `REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS = 28` (`normal-window.ts:660`), mirroring `CAPACITY_CONFIDENCE_HALF_LIFE_DAYS = 28` (`capacity-resolver.ts:610`). Gated by `CONVENTION.capacity-confidence-bands` (`registry.ts:15748+`), which asserts the source still *states* its convention status (`registry.ts:15779-15781`).

### Correction to the reports' description

The reports characterise the widening as **"28 → 56 → 120"**. That is **not the mechanism [DV]**. `REPRESENTATIVE_LOOKBACK_STEP_DAYS = 7` (`normal-window.ts:646`), and `extendLookback` widens in **7-day steps** from the base to the 120-day cap (`normal-window.ts:711-715`). 56 is simply where the owner's account happened to land. Anyone reasoning about the boundary from "28 → 56" has the wrong model of the step size.

### Rule 9: is there a discontinuity when the window extends? — **YES. Verified empirically. [DV]**

I ran a continuity walk over the owner's **real** prescribed windows (loaded read-only via `loadPrescribedWindows`), holding everything else fixed:

```
target | windowDays | fromISO    | repDays | controlled sessions | verdict
    21 |         49 | 2026-07-13 |      21 |                   2 | INSUFFICIENT_EVIDENCE
    22 |         56 | 2026-07-06 |      28 |                   4 | PROGRESS
```

And with `targetRepresentativeDays` defaulting to `baseWindowDays`:

```
 base | windowDays | fromISO    | repDays | ctrl | verdict
   21 |         49 | 2026-07-13 |      21 |    2 | INSUFFICIENT_EVIDENCE
   22 |         50 | 2026-07-12 |      22 |    3 | PROGRESS
```

**A one-unit change in a parameter flips the decision categorically.** `windowDays` is a step function of the representative-day count (7-day granularity), so the evidence *set* jumps by up to a week at each step, and the controlled-session count crosses `PACE_PROGRESS_MIN_SESSIONS = 3` (`adaptation-engine.ts:728`) at the crossing. That is the Rule 9 shape exactly: *"a hair's difference in input must never produce a categorically different plan."*

The account currently sits **at the first step that clears its target** — base 28, target 28, window 56, repDays exactly 28. `repDayCount(2026-07-06..2026-08-31) = 28`; `repDayCount(2026-07-13..2026-08-31) = 21`. One fewer representative day anywhere in that span and the window would not have reached the two July sessions.

### The gate that should have caught this cannot

`web-v2/lib/training/_normal_window.test.ts:329-340`, titled *"RULE 9 · representative days move monotonically as the window walks back"*, asserts only that `representativeDayCount` is monotone as the window grows. That is **trivially true** — a day either is or is not prescribed, so widening can only add. It says nothing about the **output vector**, which is what Rule 9 requires (*"walk a synthetic runner across each boundary in small increments and assert the output vector moves continuously and monotonically"*). The source comment at `normal-window.ts:710-713` makes the stronger claim — *"what makes the result continuous in the runner's history rather than cliff-edged (Rule 9)"* — and nothing gates it. Rule 20: a header asserting an invariant nothing verifies.

**Required:** a continuity walk over the *decision*, not the day count — vary the base window / prescribed-window edges by ±1 day and assert `decision` and `proposed` move continuously. Falsify it against today's code first; per the numbers above, it will go red.

---

## 6 · `INSUFFICIENT_EVIDENCE` and refusal honesty — **CONFIRMED for the case it covers**

- Fifth state exists: `AdaptationDecision` (`adaptation-engine.ts:204-205`) and `NON_MOVING_DECISIONS` (`:209-210`).
- `contradictionsIn` (`:2045-2072`) enforces:
  - `INSUFFICIENT_EVIDENCE_CLAIMS_A_FINDING` — `:2056-2059`, against `FINDING_REASON_CODES` (`:2029-2036`: `EXECUTION_BEAT_TARGET_WITHOUT_CONTROL`, `LATE_SESSION_DETERIORATION`, `LOAD_NOT_YET_ABSORBED`, `LONG_RUN_SHOWED_LATE_COLLAPSE`, `ABSORPTION_MARGINAL`, `ABSORPTION_POOR`).
  - `HOLD_MOVED_THE_NUMBER` — `:2051-2054`, `JSON.stringify` compare of `previous`/`proposed`.
  - `PROPOSAL_WITHOUT_REASON`, `PROGRESS_WHILE_SAFETY_REDUCES`, `DEFERRED_IS_NOT_A_PROGRESSION`.
- Falsified in the existing suite: `_adaptation_engine.test.ts:1055` and `:1065` tamper and assert the code appears. Good.
- Compile-time seal: `_NoGoalInInput` (`:2081-2087`) makes a goal field a type error; `_CapacityIsImmutable` (`:2091-2093`).

**The gap** is that the check is one-directional. It catches "a refusal wearing a finding". It does **not** catch "a finding worn on a HOLD that had nothing to read" — which is F4, live in production on three accounts. See §12.

---

## 7 · Compound-lever prevention — **CONFIRMED [DV]**

- `MORE_THAN_ONE_PRIMARY_STRESSOR` — `adaptation-engine.ts:2047-2048`, `PROGRESS` count > 1.
- `MORE_THAN_ONE_STIMULUS_CHANGE` — `:2065`, via `changesStimulus` (`:1756-1759`): `PROGRESS` always counts; `RESTRUCTURE` counts only in the `FITNESS` domain, so a SCHEDULE reshuffle correctly does not. Reasoning at `:1740-1754`.
- Enforced at composition, not only detected: the ranking promotes one and **defers** the rest with `ANOTHER_LEVER_IS_PROGRESSING_THIS_CYCLE` (`:1864-1881`); a FITNESS restructure is **withdrawn** rather than outranked when a progression was promoted (`:1892-1904`).
- Falsified: `_adaptation_engine.test.ts:1290` (clean set → not present), `:1309` (tampered → present). Both directions. Rule 18 satisfied here.

Structurally the type union makes a compound proposal unexpressible (`:296-315`) — a genuine strength.

---

## 8 · Authoring/reanchor contamination guard — **CONFIRMED; it CHECKS, it does not ENSURE**

Four states, all real branches (`authoring-convergence.ts:73-77`, with the DB check constraint mirroring them):

| State | Meaning | Line |
|---|---|---|
| `AUTHORED_CANONICALLY` | composed through canonical resolvers. **Structurally unreachable today** — `generate.ts` still uses the legacy VDOT cascade | `:165-172` |
| `REANCHORED_CANONICALLY` | legacy authoring, but `reanchorActivePlan` has rewritten since | `:179-186` |
| `AUTHORED_TOO_RECENTLY` | authored after the last successful reanchor — a **timing** fact | `:227-235` |
| `REANCHOR_STATUS_UNKNOWN` | heartbeat unreadable/never completed, **or** the job succeeded globally but this plan carries no stamp | `:201-206`, `:208-218`, `:242-253` |

Detection reads a mark the mutation boundary already leaves (`authored_state.pace_blend.reanchored_at` etc.), not a stamp invented for the guard (`:53-65`). That is the right call.

### Rule 23 — what if `reanchorActivePlan` failed silently or never ran?

- **It is detected, distinguishably.** The guard consults the job's own heartbeat via `lastSuccessAt` (`lib/ops/cron-ledger.ts`), and splits "hasn't had a slot yet" from "can't rule out a broken scheduler". Case (b) at `:242-253` is the sharpest bit: a global cron success does **not** prove this plan converged, and the code refuses to read that ambiguity as fine.
- **But contamination does not block anything.** `deriveContradictions` (`shadow-compare.ts:290-297`) emits `PROGRESS_ON_UNCONVERGED_EVIDENCE` — and `finalDecision` is unchanged (only an HR refusal rewrites it, `:461-463`). **A consumer reading `final_decision` alone would act on contaminated evidence.** Any canary must gate on `contradictions = []` as well.
- **Production reality [DV]:** of the 7 accounts in the shadow log, **6 read `REANCHOR_STATUS_UNKNOWN`**. Only the owner reads `REANCHORED_CANONICALLY`. The guard is doing its job — but the fleet is overwhelmingly in the "we don't know" state.
- **On the positive side**, the *other* Rule 23 dependency was fixed properly: `run-adaptations/route.ts:107-111` calls `reanchorLthr(uid)` at the top of each user's pass — *ensuring* the precondition rather than assuming the earlier cron ran. That is exactly what Rule 23 asks for. Cron liveness confirmed in §13.

---

## 9 · Pace/HR compatibility — **FIVE verdicts, and it does NOT block in the engine**

### The verdicts — **five, not four [DV]**

`pace-hr-compatibility.ts:166-172`, mirrored by the DB check constraint on `adaptation_shadow_log.hr_compat_verdict`:

| Verdict | `paceProposalMayProceed` | Line |
|---|---|---|
| `COMPATIBLE` | true | `:353-354` |
| `COMPATIBLE_ENVIRONMENTAL_EXPLAINED` | true | `:319-320` |
| `COMPATIBLE_HR_CEILING_LIKELY_STALE` | true | `:335-336` |
| `INSUFFICIENT_HR_EVIDENCE` | **true** | `:242-243` |
| `INCOMPATIBLE_REFUSE` | **false** | `:302-303` |

Note `INSUFFICIENT_HR_EVIDENCE` **permits**. That is the right Rule 11 call (*"the proposal is not blocked on a check that cannot run"*, `:246-248`) — but it means the validator is fail-open, which a canary must account for.

### Does `REFUSED_HR_INCOMPATIBLE` block the proposal in `adaptation-engine.ts`? — **NO [DV]**

`adaptation-engine.ts` **never imports** `pace-hr-compatibility`. Grep across `web-v2/lib` and `web-v2/app` returns exactly one non-test caller: `shadow-compare.ts:96`.

The refusal exists only as a **reporting** relabel:

```ts
// shadow-compare.ts:460-464
const hrRefuses = hrCompatibility != null && !hrCompatibility.paceProposalMayProceed;
const finalDecision = hrRefuses ? 'REFUSED_HR_INCOMPATIBLE' : engineDecision;
```

**The engine's own `AdaptationProposalSet` still carries `decision: 'PROGRESS'`.** Anything consuming `resolveAdaptationProposals` directly — which is the natural way to write a canary — bypasses the HR validator entirely. It is a property of the log record, not of the proposal.

### Where does HR evidence come from? — **Real Evidence-Engine work segments [DV]**

`pace-hr-evidence.ts:59-72`: distance-weighted mean HR across segments classified `threshold_like` / `high_intensity` (`:43`), from `classifyRecentActivities` → `segmentActivity`. Not a pace-band proxy. Missing HR yields `null` and the session is excluded, never defaulted to in-band (`:55-58`, and `pace-hr-compatibility.ts:259-262`). This is correctly built and is a genuine improvement over the proxy the earlier report used.

### Could an informational reference HR (display-only Friel zone) feed this validator? — **It IS the validator's only band. [DV]**

`pace-hr-compatibility.ts:234-238`:

```ts
const zones = lthrBpm != null ? computeZones({ lthr: lthrBpm }) : null;
const z4 = zones?.zones.find((z) => z.idx === 4) ?? null;
const z4BandBpm = ...
```

`computeZones` is `web-v2/lib/training/zones.ts:336` — the **Friel LTHR% band**. And `docs/reports/hr-semantics-2026-09-01.md:25`, written the same day, classifies exactly that mechanism as:

> Mechanism 1 · Expected-response zone · Friel LTHR% bands (`computeZones`/`lthrZones`) · **"Informational only. Never a target, never enforced, zero downstream consumers."** · Consumers: **"None — display only"**

**That row is now false.** The display-only band is the enforcement threshold for `INCOMPATIBLE_REFUSE`. Live on the owner's account it resolved to `z4BandBpm {lower:160, upper:167}`, against which four sessions were graded. Whether that is the *right* band is a doctrine question I am not resolving here — but the two documents contradict each other, one of them is wrong, and Rule 16 says a quantity gets one name and one meaning.

### One further gap: the validator never reads the proposed pace [DV]

`PaceHrCompatibilityInput` declares `previousSecPerMi` and `proposedSecPerMi` (`:124-125`). **Neither is referenced anywhere in the function body** — grep returns only those two declaration lines. The check asks *"did the backing sessions run hot?"*, never *"is the proposed step compatible with that?"*. A 1 s/mi proposal and a 60 s/mi proposal receive an identical verdict. For a shadow log this is a naming problem; for a canary it means **the safety validator cannot scale with the size of the mutation.**

Also worth noting: `MATERIAL_INCOMPATIBILITY_MIN_SESSIONS = 3` (`:142`) — three unexplained-hot sessions are needed to refuse, the same count needed to progress. And the sessions the HR validator graded (2026-07-07, 07-12, 08-23, 08-30) are **not** the same set as `capacity_belief.evidenceIds` (`-280549580846348`, `-226755616416002`, `-87627419857791`) — only one id overlaps. The validator and the belief rest on different evidence.

---

## 10 · Zero-mutation in the shadow cron path — **CONFIRMED [DV]**

### Every write, traced

`app/api/cron/run-adaptations/route.ts:132` → `runAndPersistPaceShadowCompare(uid)` (`shadow-compare.ts:652-664`) → `runPaceShadowCompareCycle` + `persistShadowCompareRecord(record, { allowFileFallback: false })`.

Grep for `INSERT|UPDATE|DELETE` across the whole shadow path:

| File | Writes |
|---|---|
| `shadow-compare.ts` | **one** — `INSERT INTO adaptation_shadow_log` (`:538-580`) |
| `load.ts` | none |
| `load-adaptation-engine.ts` | none |
| `authoring-convergence.ts` | none |
| `pace-hr-evidence.ts` | none |
| `pace-hr-compatibility.ts` | none (pure) |
| `adaptation-engine.ts` | none (pure) |

`detectAdaptations` is called (`shadow-compare.ts:326`) but is a detector; `applyAdaptations` is not reached from this path. Placement before the live pass is deliberate and argued (`route.ts:125-130`) so both detections see the same pre-mutation state.

**Confirmed: the only write is `adaptation_shadow_log`.**

### The checksum mechanism

`checksumActivePlanWorkouts` (`shadow-compare.ts:245-258`):

```sql
SELECT md5(COALESCE(string_agg(
    pw.id || ':' || COALESCE(pw.pace_target_s_per_mi::text,'') || ':'
      || COALESCE(pw.distance_mi::text,'') || ':' || COALESCE(pw.type,''),
    ',' ORDER BY pw.id), '')) AS checksum, COUNT(*)::int AS n
  FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
 WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
```

Taken before (`:313`) and after (`:354`), compared (`:362`), persisted in-band per record. Production: all 4 owner rows carry `925312284e816aabe3b4d09c6226e286:103` before **and** after, `zero_mutation_verified = t`. Promoted out of the test file so the production record carries the same proof the test used — good discipline.

**Coverage gap worth naming:** the checksum covers `id`, `pace_target_s_per_mi`, `distance_mi`, `type`. It does **not** cover `workout_spec` (and therefore not `hr_cap_bpm`), `date_iso`, `dow`, `is_quality`, `is_long`, or `notes`. A mutation to any of those is invisible to it. Adequate for the current shadow path (which writes nothing) and adequate to witness a pace canary — but it must not be described as a general "the plan did not change" proof.

---

## 11 · Production shadow log

### 11.1 · The database — **4 rows, 2 calendar days [DV]**

All rows for `0645f40c-951d-4ccc-b86e-9979cd26c795`:

| id | today_iso | resolved_at (UTC) | decision | prev → prop | conf | convergence | HR | contradictions | checksum before = after | zero-mut |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-08-31 | 23:50:02 | PROGRESS | 435 → 430 | 0.70906 | REANCHORED_CANONICALLY | COMPATIBLE | `[]` | yes | t |
| 2 | 2026-08-31 | 23:55:39 | PROGRESS | 435 → 430 | 0.70906 | REANCHORED_CANONICALLY | COMPATIBLE | `[]` | yes | t |
| 3 | 2026-08-31 | 2026-09-01 03:02:35 | PROGRESS | 435 → 430 | 0.70906 | REANCHORED_CANONICALLY | COMPATIBLE | `[]` | yes | t |
| 10 | 2026-09-01 | 08:26:27 | PROGRESS | 435 → 430 | **0.68922** | REANCHORED_CANONICALLY | COMPATIBLE | `[]` | yes | t |

Constant across all four: `phases_moved = {QUALITY,TAPER}`; reason codes `REPEATED_CONTROLLED_QUALITY_EXECUTION, CAPACITY_LEADS_PRESCRIPTION_BY_A_USEFUL_STEP, PACE_STEP_CLAMPED_TO_DOCTRINE_QUANTUM, LOOKBACK_EXTENDED_PAST_A_PRESCRIBED_PERIOD, CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE`; `final_decision = PROGRESS`; `evidence_mode = direct`; `capacity_belief.vdot = 47.9`, `paceSecPerMi = 430`; DENSITY refusal `NO_PROGRESSION_TARGETS`; `live_training_lead_fired = f`, `live_recompute_paces_fired = f`, `agrees_with_live = f`.

**Assessment:**

- **Decision stability:** `PROGRESS` on both days. But this is **two days**, and three of the four rows are the *same* `today_iso` (the cron fired repeatedly during the build night). The elapsed-time evidence base is **one day-over-day transition**.
- **Magnitude stability:** identical, 435 → 430, both days. QUALITY 5 s/mi, TAPER 9 s/mi.
- **Reason stability:** identical five codes.
- **Do changes trace to new evidence or window boundaries?** The only change is `confidence` 0.70906 → 0.68922 (−2.8%), which traces to `capacity_belief.confidence` 0.72684 → 0.72420 combined with staleness — i.e. **evidence ageing by one day**, not new evidence. `evidenceIds` are unchanged across both days. That is the correct, explainable behaviour.
- **Skipped / contaminated cycles:** none for the owner. `contradictions = []` throughout.
- **HR incompatibilities:** none. `COMPATIBLE` every cycle, `paceProposalMayProceed: true`.
- **Silent failure:** none in these rows. But see 11.2 and §13.

**Two data-quality observations:**

1. `evidence_dates` reports `dateISO: null` for **2 of the 3** capacity evidence ids (`-280549580846348`, `-226755616416002`). `evidenceDatesFor` (`shadow-compare.ts:313-320`) maps ids against `PaceEvidence.sessions`, and ids not in that list resolve to `null`. So **the log cannot say how old two-thirds of the capacity evidence is** — while simultaneously recording `CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE`. The staleness discount is computed on dates the record cannot show. That is not a Rule 11 violation (null is honest), but it is a hole in the audit trail that a canary's promotion criteria would need to close.
2. `agrees_with_live = false` on every row, with `live_training_lead_fired = false` and `live_recompute_paces_fired = false`. **The disagreement is total and one-directional:** the new engine says PROGRESS every cycle; the shipped engine does nothing, ever. That is Rule 21 restated as a live measurement.

### 11.2 · The git-tracked JSONL — **36 lines, but ONE day, and they are test artifacts [DV]**

`/Volumes/WP/06 Claude Code/Runcino/docs/reports/adaptation-shadow-log/0645f40c-951d-4ccc-b86e-9979cd26c795.jsonl` holds 36 parseable rows. **All 36 carry `todayISO: "2026-08-31"`**, with `resolvedAt` spanning 2026-08-31T22:49:53Z → 2026-09-01T01:29:19Z — a **2 h 40 m window on one night**. Every row: `PROGRESS`, 435 → 430, `conf 0.7090633608297382`, identical reason codes.

Lines 1-15 lack `convergence`, `finalDecision` and `contradictions` entirely; lines 16-36 have them. **That is schema evolution during the build session, not stability over time.** Not one line carries `hrCompat`, `mutation`, or `phasesMoved` — those fields postdate the file.

**This file must not be read as 36 evaluation cycles.** It is one input state re-evaluated 36 times by a developer. Anyone citing "36 stable records" is citing determinism, not stability.

I confirmed the mechanism that produces it: running the `lib/adaptation` suite under the read-only role appends to this exact file. `persistShadowCompareRecord`'s `allowFileFallback` **defaults to `true`** (`shadow-compare.ts:601`); the RO role's `INSERT` fails with permission-denied; the code falls through to `persistToFile` (`:640`), which appends to `path.join(process.cwd(), '..', 'docs', 'reports', 'adaptation-shadow-log')` (`:529`). My own test run added 3 lines to my worktree's copy, which I reverted (`git checkout --`); the worktree is clean. **A read-only audit run silently writes a git-tracked file** — worth fixing (default the fallback to `false`, or write to a temp dir).

### 11.3 · Retention cron — exists, mounted, **never observed to complete [DV]**

- `web-v2/lib/adaptation/shadow-log-retention.ts` — 180-day age bound and 400-row-per-user cap, both `DELETE`-only and scoped to this table, idempotent.
- `web-v2/app/api/cron/prune-adaptation-shadow-log/route.ts` — auth via `CRON_SECRET`, calls `pruneAdaptationShadowLog()`, **and does call `recordCronSuccess`** (`:41`).
- `.github/workflows/prune-adaptation-shadow-log.yml:19` — `cron: '0 5 * * *'`, real schedule.
- **But `ops_alerts` holds zero rows for `cron/prune-adaptation-shadow-log`** — verified read-only against the full table. Today is 2026-09-01 22:00 UTC, so 05:00 has passed. Either the fix had not deployed by then (Rule 19) or the workflow did not fire.
- Separately, the stability tool's own runtime NOTE says *"reading `route.ts` shows it never calls `recordCronSuccess()` at all"* — **that prose is now stale**; the route does call it (`:41`, with a comment saying "before this fix"). A Rule 20 shape inside the very tool built to check these things.

---

## 12 · The zero-run `HOLD` — root cause traced [DV]

The coordinator's observation is correct and the defect is real. Here is the full trace.

### 12.1 · The production evidence

All seven rows from the 2026-09-01 cycle, joined to `users` and to canonical run counts:

| id | account | decision | prev | conf | convergence | contradictions | canonical runs | explanation |
|---|---|---|---|---|---|---|---|---|
| 10 | dnitch85@me.com | PROGRESS | 435 | 0.689 | REANCHORED | `[]` | 155 | (pace progression) |
| 11 | apple-review@faff.run | **HOLD** | 463 | 0.1 | UNKNOWN | `[]` | **0** | "Threshold pace holds while the block is not being absorbed." |
| 12 | qa-phone-onboard-… | INSUFFICIENT_EVIDENCE | 489 | 0.1 | UNKNOWN | `[]` | **0** | "No recent threshold work to price the target from…" |
| 13 | qa-beginner-… | **HOLD** | 642 | 0.1 | UNKNOWN | `[]` | **0** | "Threshold pace holds while the block is not being absorbed." |
| 14 | qa-goal-… | **HOLD** | 507 | 0.1 | UNKNOWN | `[]` | **0** | "Threshold pace holds while the block is not being absorbed." |
| 15 | qa-phone-verify-… | NO_PACE_PROPOSAL | — | — | UNKNOWN | `[]` | 0 | "No priced threshold/tempo/cruise row ahead…" |
| 16 | qa-race-… | NO_PACE_PROPOSAL | — | — | UNKNOWN | `[]` | 0 | "No priced threshold/tempo/cruise row ahead…" |

### 12.2 · Why the reader returns "not absorbed" instead of a refusal

The gate that produces the sentence is `detectPace` (`adaptation-engine.ts:982-993`), and it runs **before** the `sourceMode` check:

```ts
if (!absorptionPermitsPaceProgression(absorption)) {
  return { proposal: null,
    hold: holdWith([absorption.veto != null ? 'SAFETY_OVERRIDES_NORMAL_PROGRESSION' : 'ABSORPTION_POOR'],
      'Threshold pace holds while the block is not being absorbed.') };   // decision defaults to 'HOLD'
}
```

`absorptionPermitsPaceProgression` = `v.band !== 'poor' && v.veto == null` (`:843-845`). So the question reduces to: **why is a zero-run account's band `poor`?**

I ran `loadAdaptationInput` + `classifyAdaptation` read-only against the three accounts. Real output:

**`apple-review@faff.run` — band `poor`, via manufactured MISSED sessions:**
```
keySessionExecutions: [ {MISSED, 0, false} ×6 ]
keySessionsPlanned: 6  completed: 0
weeklyPlannedMi: [28,34,35,32,35,28]   weeklyActualMi: [0,0,0,0,0,0]
--> band: poor | decision: MODIFY | confidence: medium
    execution:    score=-2    "0 of 6 key sessions delivered the full stimulus · 6 not run"
    internal_cost: score=null
    recovery:      score=null
    consistency:  score=0     "weekly volume averaging 0% of plan"
    trend:        score=-0.3  "evidence consistent across recent weeks"
```

**`qa-beginner` — band `poor`, via the consistency floor:**
```
keySessionExecutions: null      weeklyPlannedMi: [3,2]   weeklyActualMi: [0,0]
--> band: poor | confidence: low
    consistency: score=-2  "weekly volume averaging 0% of plan"
    trend:       score=-0.3
```

**`qa-phone-onboard` — band `normal`, hence the honest INSUFFICIENT_EVIDENCE:**
```
weeklyPlannedMi: [5,15,12.5]   weeklyActualMi: [0,0,0]
--> band: normal | confidence: low
    consistency: score=0   trend: score=-0.3
```

**Two independent coercions, both Rule 11:**

**(a) `actual == null` → `MISSED · stimulusCompletion: 0`.** `web-v2/lib/execution/interpret.ts:213-220`:

```ts
if (actual == null || actual.workMinutes <= 0) {
  return { state: 'MISSED', stimulusCompletion: 0,
           evidence: { execution: 'none', adaptation: 'unknown', ... },
           why: 'This session did not happen.' };
}
```

`actual == null` means *"no run row matched this prescribed session"* — which covers **"the runner skipped it"**, **"the run has not synced yet"**, and **"this account has never run at all"**. Three facts, one output. The struct is *partly* honest (`evidence.adaptation: 'unknown'`), but `readExecution` (`adaptation-model.ts:422-425`) consumes only the **number**:

```ts
const training = reads.reduce((a, r) => a + clamp(r.stimulusCompletion, 0, 1), 0) / reads.length;
parts.push(shareToScore(training));
```

so the honesty is discarded one layer up. `training = 0` → `score = -2` → below `EXECUTION_GATE.capPoor = -1.5` (`adaptation-model.ts:320`) → `capTo('poor')` (`:735-737`). **Band `poor` manufactured entirely out of the absence of data.**

**(b) `actual/planned` where `actual = 0` is treated as a real ratio.** `readConsistency` (`adaptation-model.ts:570-580`):

```ts
const ratios = planned.map((p, i) => (p > 0 ? actual[i] / p : null)).filter(non-null);
...
parts.push(clamp(2 - Math.abs(mean - 1.0) * 8, -2, 2));
```

`0 / 3 = 0` is a number, not `null`, so it survives the filter. `mean = 0` → `clamp(2 − 8, −2, 2) = −2`, the floor.

**And the difference between the three accounts is an arithmetic artefact, not physiology:**

- The spread term only fires at `ratios.length >= 3` (`:585`). With all-zero ratios the spread is 0, so it contributes `+2`.
- `qa-beginner` has **2** weeks → no spread term → `parts = [−2]` → score **−2**.
- `qa-phone-onboard` has **3** weeks → `parts = [−2, +2]` → score **0** → band `normal` → honest refusal.

`known.length = 2` in the qa-beginner case, exactly meeting `MIN_DIMENSIONS_FOR_VERDICT = 2` (`:294`), so **the Rule 11 refusal at `:697-706` never fires** — it is one dimension away. Weighted mean = `(−2×0.2 + −0.3×0.15) / 0.35 = −1.27`, below `BAND_EDGES.marginal = −1.1` (`:290`) → `poor`.

**So whether a zero-run account is told "your block is not being absorbed" or the truthful "there is nothing to read" is decided by how many weeks its plan happens to span.** That is not a coaching judgement.

Bonus Rule 16/17 finding: `readTrend` returns `−0.30` with the narration **"evidence consistent across recent weeks"** on an account with zero evidence — and the *same string* accompanies `+1.5` on the owner. One sentence, two opposite numbers.

### 12.3 · Does `contradictionsIn` check this case? — **NO [DV]**

`contradictionsIn` has exactly one refusal-honesty clause (`adaptation-engine.ts:2056-2059`):

```ts
if (p.decision === 'INSUFFICIENT_EVIDENCE'
  && p.reasonCodes.some((c) => FINDING_REASON_CODES.has(c))) {
  out.push('INSUFFICIENT_EVIDENCE_CLAIMS_A_FINDING');
}
```

It is **conditioned on the decision already being `INSUFFICIENT_EVIDENCE`**. Here the decision is `HOLD`, so the clause is structurally inapplicable — and `ABSORPTION_POOR` **is** in `FINDING_REASON_CODES` (`:2033`). There is no converse rule ("a HOLD carrying a finding code must have had evidence to read"). Production confirms it: `contradictions = []` on all three rows.

This is a Rule 22 blind spot exactly as that rule predicts — the check was written by the same reasoning that wrote the engine, so it guards the direction the author was worried about and is blind to the mirror image.

### 12.4 · Can the same collapse reach the owner? — **YES, by the same mechanism [DV]**

The owner's real dimension reads today:

```
execution:     score=-0.230  "2 of 7 key sessions delivered the full stimulus · 3 partial · 1 replaced · 1 not run"
internal_cost: score= 0.333
recovery:      score= 0.500
consistency:   score=-0.380  "weekly volume averaging 83% of plan · one week at 7% of plan against a 83% average"
trend:         score= 1.500
--> band: normal | confidence: high
```

Weighted mean ≈ **+0.213**, against `BAND_EDGES.normal = −0.25`. He is protected **only by dilution** — three positive dimensions offsetting two negative ones. The exposure is concrete:

1. Every unrun prescribed key session in the window becomes `MISSED · 0` and drags `execution` toward the `capPoor = −1.5` cliff. He currently sits at −0.230; `capMarginal` is −0.5 (one or two more missed sessions), `capPoor` is −1.5.
2. `run-adaptations` fires at **03:00 UTC = 20:00 the previous day** in `America/Los_Angeles`, while `strava-sync` runs at **08:02 UTC**. Any run not yet ingested at evaluation time reads as `MISSED`, not as "not yet known". A multi-day sync outage — which this project has had — would manufacture a `poor` band and produce **"Threshold pace holds while the block is not being absorbed"** about a runner who trained normally.
3. `weeklyActualMi[1] = 4.16` against `planned 55.5` (ratio 0.075 — the "one week at 7% of plan") is his **AFC race week**. `readConsistency` is carried through **unfiltered** from the unfiltered input (`load.ts:524-534` forks only the execution dimension), so a prescribed taper week is being scored as 7% compliance. Consistency is a habit/execution question, not a tissue-load question; grouping it with `internal_cost`/`recovery`/`trend` on the unfiltered side is the weakest link in the Rule 8 fork and is currently costing the owner real score.

**Required fixes (all three, before any canary):**
- `interpret.ts:213` must distinguish *"no run row exists and none is expected yet"* from *"the session was prescribed, the day has passed, and the runner did not run"*. Return a third state, or carry `evidence.adaptation === 'unknown'` through into `readExecution` so unknown sessions are dropped from the mean rather than scored 0.
- `readConsistency` must not treat `actual = 0` on a week with no ingested runs as a compliance ratio; and it should sit on the **filtered** side of the Rule 8 fork.
- `contradictionsIn` needs the converse clause: a `HOLD` carrying `ABSORPTION_POOR` / `LOAD_NOT_YET_ABSORBED` must be accompanied by evidence that absorption was actually readable. Falsify it against these three production rows — it should go red today.

---

## 13 · Cron liveness (Rule 23) — **healthy on the day measured [DV]**

Schedules and last successful completions, from `.github/workflows/*.yml` and `ops_alerts` (read-only):

| Job | Schedule (UTC) | Last successes observed |
|---|---|---|
| `run-adaptations` (carries shadow-compare) | `0 3 * * *` | 2026-09-01 **03:02:42** (on time), 2026-09-01 08:26:33 |
| `plan-drift` | `0 9` and `0 4` | 2026-09-01 04:02:36, 09:02:36, 09:10:50, 13:52:02 |
| `prune-adaptation-shadow-log` | `0 5 * * *` | **NONE — no `ops_alerts` row has ever existed for this source** |
| shadow-compare | (inside `run-adaptations`) | same as above |

Ordering held on 2026-09-01: `run-adaptations 03:02` → `plan-drift 04:02`. And the Rule 23 dependency is now *ensured* rather than assumed — `run-adaptations/route.ts:107-111` calls `reanchorLthr(uid)` itself before detection.

This is a genuine improvement on the state Rule 23 was written about (5-12 h lateness every day). **But one clean day is one clean day.** The retention job remains unobserved.

---

## 14 · Stability-report tooling — **runs, is read-only, is honest [DV]**

I ran `npx tsx scripts/adaptation-stability-report.ts` with `DATABASE_URL` forced to the RO URL. Verbatim verdict:

```
STAGE 1 STABILITY REPORT · adaptation_shadow_log
user: 0645f40c-… rows read: 4
VERDICT: NOT_YET_ENOUGH_DATA
  - 2 of 5 target eligible cycles so far, 2 of 7 target consecutive days.
    No hard failures, no open review items.

1 · Consecutive days      target 7 · current streak 2 (2026-08-31 → 2026-09-01) · met: false
2 · Uncontaminated cycles target 5 · eligible: 2 · met: false
3 · Mutations/checksum violations (HARD FAIL if nonzero)      count: 0
4 · Unresolved contradictions                                  count: 0
5 · MATERIAL_INCOMPATIBILITY accepted as PROGRESS (HARD FAIL)  count: 0
6 · Unexplained PROGRESS/HOLD oscillation   pairs: 1 · flips: 0 · unexplained: 0
7 · Material proposal changes day-over-day  pairs: 1 · changes: 0 · unexplained: 0
8 · Phone/Watch consistency  live checksum 925312284e…:103 = most recent shadow checksumAfter
                             full historical reconstruction possible: false
9 · Retention health  total rows 16 · oldest 0.9 days · prune heartbeat found: FALSE
```

The tool is well built: it refuses without `DATABASE_URL_RO`, imports no adaptation/plan module, re-implements the checksum inline, fails **closed** on its text-match heuristic, skips non-calendar-adjacent day pairs rather than pretending they are consecutive, and states its own limits plainly (`#8`: `plan_workouts` is mutated in place with no history table, so no historical reconstruction is possible).

**One correction:** its `#9` NOTE claims the prune route *"never calls `recordCronSuccess()` at all"*. That is **stale prose** — the route calls it at `:41`. The empirical half of the note (zero rows) is still true and still the finding.

---

## 15 · The `pace-canary-infrastructure-20260901` branch

Reviewed in a separate isolated worktree, detached at `a0051439`, no DB access. One commit, 11 files, +2185/−7. Left clean.

### Confirmed good

- **OFF by default, four independent ways [DV].** All gates in `web-v2/lib/adaptation/pace-canary-config.ts`: `PACE_CANARY_KILL` (`:90`, always-wins short-circuit), `PACE_CANARY_ENABLED === '1'` (`:95`, false when unset), `PACE_CANARY_ALLOWLIST` (`:96`, empty set when unset), plus `PERSISTENCE_TABLE_MISSING` refused first (`pace-canary.ts:174-180`) since migration 161 is unapplied. `paceCanaryMayRunFor` requires `enabled && allowlisted` (`:113-116`). No `.env.local` in the tree. `PACE_CANARY_OWNER_UUID_REFERENCE` (`:60`) exists but **is never read by any logic** — only by tests.
- **Flag-off means zero DB activity [DV]** — the gate resolves synchronously and returns at `pace-canary.ts:431-433` before any `await`.
- **Does not touch `hr_cap_bpm` or `workout_spec` [DV].** Both `UPDATE`s write only `pace_target_s_per_mi`.
- **Does not write sealed rows [DV].** `NOT EXISTS (canonical run on that date)` at `pace-canary.ts:384-389`, Rule 14-compliant (`NOT (r.data ? 'mergedIntoId')`).
- **Atomic [DV].** The plan `UPDATE`s and the `coach_intents` `INSERT` go through one `mutatePlan` call (`:560-596`) inside a real `BEGIN`/`COMMIT`/`ROLLBACK`.
- **`tsc --noEmit` clean; runnable tests 56/56 green; merges into `origin/main` with zero conflicts [DV].**

### Blocking defects found

1. **The runtime gate is not falsifiable in CI [DV].** Deleting both runtime gate checks (`pace-canary.ts:431-433` and `:471`), in a form that compiles, leaves `tsc` clean, **442 tests green**, and `check-automatic-mutations.sh` passing. The only test covering it is `lib/adaptation-harness/pace-canary.harness.test.ts:88-138`, which `vitest.config.ts:37` **excludes from `npm test`** and which needs a scratch DB. Per Rule 18 the runtime gate is a hypothesis. (Flipping the *config* default to on **is** caught — 3 tests fail — so the config layer is properly ratcheted.)
2. **The audit snapshot is outside the transaction [DV].** `insertApplicationRecord` runs at `pace-canary.ts:628-633`, after `mutatePlan` returned at `:596`, and **swallows its own failure** (`:352-355`). Chain: plan commits → audit insert fails → no `rows_before` → **permanently un-rollbackable**; and no `status='applied'` row → `readLastAppliedAt` returns null → **the 7-day rate limit does not engage** → it applies again the next night, and the next. The caller sees `{status:'applied'}` and the cron logs only on `error`. Silent compounding mutation with no recovery.
3. **`rollbackPaceCanaryApplication` is ungated [DV].** `pace-canary.ts:658-757` is exported and calls no gate function — `PACE_CANARY_KILL=1` does not stop it. It takes a bare `applicationId: number` with no user-scope argument, trusting `appRow.user_uuid` from the row. Unreachable today, but it is a `plan_workouts` writer the kill switch does not cover.
4. **No `ops_alerts` anywhere [DV].** `grep raiseAlert|ops_alerts pace-canary.ts` → no matches. Post-write verification failure is a `console.error` only (`:619-626`). Rule 23 names `ops_alerts` as the surface. **With the flag on, the first signal that the canary moved the owner's paces is the owner noticing on his phone.**
5. **Rate limit is defeated by rollback [DV].** `readLastAppliedAt` filters `status='applied'` (`:307`); rollback sets `status='rolled_back'` (`:740`). Rolling back immediately reopens the 7-day window.
6. **No cap on rows touched [DV].** No `LIMIT` in `targetRowsForPhase`, no cap on `rowsBefore.length` (`:529`). One cycle can rewrite every priced threshold/tempo/cruise row to the end of the plan, across every moving phase — which, per §1, includes the TAPER phase 78 days out.
7. **Owner-scoping is a convention, not a property [DV].** The allowlist is a comma-separated env var. `_pace_canary.test.ts:68-74` proves two uuids can be allowlisted at once. A typo in that Railway variable enables the canary for an arbitrary account with no second check.
8. **Past-date safety is an undocumented cross-file coupling [DV].** `targetRowsForPhase` bounds on `phase.firstDateISO`/`lastDateISO`, which are safe only because `load-adaptation-engine.ts:363` carries `AND pw.date_iso >= $2` with `$2 = today`. Nothing asserts that coupling.
9. **"One-command rollback" overclaims [DV].** No route, no script, no CLI, no caller anywhere in the repo — grep finds it only in the excluded harness test. An operator cannot invoke it without writing code first.
10. **Rule 22 gap: no test asserts the canary can apply anything [DV].** No test anywhere asserts `status === 'applied'`. The rate-limit test asserts only `expect(result.refusalCode).not.toBe('RATE_LIMITED')` — a not-equals that passes if the cycle refused for any other reason. The suite is structurally incapable of failing on "this mechanism is inert" — the precise Rule 21 failure this codebase keeps repeating.
11. **User-visible divergence not named in the branch report [DV].** `app/api/v5/today/route.ts:820` reads `pace_target_s_per_mi` (the canary moves it) while `:821` reads `workout_spec.hr_cap_bpm` and `:837-838` read `workout_spec.pace_target_s_per_mi_lo/hi` (the canary does not). After an application the phone shows a quicker target while the band-adherence sentence grades against the unmoved band and the HR cap stays at the old anchor, until the next reanchor. Rule 16, on a screen the runner reads.

**Landing the branch is low-risk given the four closed gates. Enabling it is not.** The gap between "safe to merge" and "safe to switch on" is wide, and the branch's own suite cannot tell you which side you are on.

---

## 16 · Rule 21 — the upward path is still at zero [DV]

`coach_intents`, app-wide, read-only, today:

```
strength_skip              87      plan_adapt_downgrade        5
watch_completion           61      plan_adapt_long_floor       5
watch_heat_easing          51      plan_adapt_reschedule       3
strength_resume            41      plan_adapt_overridden       2
calibration_completed      31      plan_adapt_gap              1
plan_adapt_missed_noted    20      vdot_auto_recalc            1
coach_log_week_close       16      lthr_auto_calibrated        1
plan_adapt_drop_missed     12      coach_log_lthr_reanchor     1
```

**There is no `plan_adapt_upgrade`, `bump`, `accelerate` or `mark_upgrade` row. Anywhere. Ever.** Downward/absorbing: 48 rows. Upward: **0**. `vdot_auto_recalc` (1) remains the only pace-axis event in the app's history, and it is a recompute, not a push.

The shadow log now measures the same thing directly and continuously: `live_training_lead_fired = false`, `live_recompute_paces_fired = false`, `agrees_with_live = false` on **every** row, while the new engine proposes `PROGRESS` on every cycle. Rule 21's defect is not fixed; it is now instrumented.

---

## 17 · Verdict on the owner-only PACE canary

### **NO — not yet. Two of the four blockers are in the engine's evidence, not the canary's plumbing, and no amount of canary hardening addresses them.**

The infrastructure work is good and the reports are more honest than most. But the canary would apply **this specific proposal**, and this specific proposal does not survive scrutiny:

**Blocker A — the proposal rests on recovery-window evidence (§5, F1).** The four "controlled" sessions are 2026-07-07, 2026-07-12, 2026-08-23, 2026-08-30. Verified read-only: **08-23 and 08-30 both return `isPrescribedNonNormal = true`** — they fall inside the AFC half's prescribed window (2026-08-02 → 2026-08-30), at days 7 and 14 post-race. Drop them and the count is **2 < 3** and the proposal vanishes. The engine's own doctrine says *"PACE progresses from CAPACITY evidence"* — a capability question — and Rule 8 says a recovery window is never the runner's normal for a capability reader. `historicalTolerance` is filtered on exactly that reasoning; PACE is not. The loader argues the exemption at `load-adaptation-engine.ts:55-63` and the argument has merit, but it is **load-bearing on the single proposal about to be given mutation authority**, and it cuts the opposite way from the sibling reader. This needs an explicit human ruling, not an inherited default.

Compounding it: `evidenceStalenessFactor` uses the **median** age (`normal-window.ts:778-793`). The two recovery-window sessions (ages 8 and 1 days) pull the median to ~29, yielding a discount of **0.976 — effectively none** — even though half the evidence is 50+ days old. The contaminated sessions both supply the corroboration count *and* suppress the discount that would have flagged the staleness.

**Blocker B — the logged PROGRESS is a DEFERRED proposal (§2, F2).** `paceProposalOf` falls back to `deferred` (`shadow-compare.ts:232-236`). The engine's ranking chose **DURATION** (15 → 16 mi) as this cycle's primary stressor and deferred PACE with `ANOTHER_LEVER_IS_PROGRESSING_THIS_CYCLE`. The shadow-log schema has **no `deferred` column**, so the row reads as an unqualified endorsement. A canary reading this log would apply a lever the engine explicitly did not choose — and if DURATION is ever also live, that is a `MORE_THAN_ONE_STIMULUS_CHANGE` violation the contradiction checker would have caught inside the engine but cannot see across the log boundary.

**Blocker C — a live Rule 9 cliff at the boundary the proposal depends on (§5, F3).** One unit of `targetRepresentativeDays` (21 → 22) flips `INSUFFICIENT_EVIDENCE` → `PROGRESS`, empirically, on this account's real data. The account sits exactly at the first clearing step. The existing "Rule 9" test checks day-count monotonicity, which cannot fail.

**Blocker D — the refusal-honesty guard has a mirror-image blind spot, and it is firing in production (§12, F4).** Three zero-run accounts are being told their block "is not being absorbed", from a band manufactured out of missing data, with `contradictions = []`. The owner is protected only by dimensional dilution, and a sync outage — which the cron schedule makes likely, since `run-adaptations` runs 5 hours before `strava-sync` — reproduces it on his account.

**Also unresolved, and cheap to fix:** the HR validator enforces on a band `hr-semantics-2026-09-01.md` classifies as display-only with "zero downstream consumers" (§9), and it never reads the proposed pace, so it cannot scale with step size. `REFUSED_HR_INCOMPATIBLE` exists only in the log, not in the engine.

### What is genuinely NOT missing

Do not re-litigate these; they are done:

- Phase-aware targeting, per-phase steps and per-phase reporting (§1).
- Zero-mutation proof, in-band per record, using the same checksum the test uses (§10).
- The five-state machine and the `INSUFFICIENT_EVIDENCE`/`HOLD` split *in the direction it covers* (§6).
- Compound-lever prevention, falsified both ways (§7).
- The four-state convergence guard, correctly refusing to read a global cron success as per-plan convergence (§8).
- HR evidence sourced from real work-segment classification, not a pace proxy (§9).
- Retention policy written before the migration ran (§11.3).
- Honest `CONVENTION` labelling of 120 and the 28-day half-life, with doctrine-derived floors read at run time (§5).
- The stability tool: read-only by permission, fails closed, states its own limits (§14).

### If you want a canary, here is the shortest honest path

**Phase 0 — settle four questions (human decisions, not code):**
1. **Is a quality session run inside a prescribed post-race recovery window admissible as PACE capability evidence?** Yes or no, written down. If **no**, PACE currently has 2 corroborating sessions and there is no proposal to canary — the correct outcome is to wait for clean evidence. If **yes**, say so explicitly in `load-adaptation-engine.ts`'s Rule 8 fork comment, and reconcile it with `historicalTolerance` being filtered.
2. **Should a DEFERRED proposal ever be mutable?** My view: no. Add `engine_deferred boolean` to `adaptation_shadow_log` and make any canary refuse when it is true.
3. **Which HR band is the enforcement band?** Either the Friel Z4 band is enforceable (and `hr-semantics` row 1 is wrong), or it is display-only (and the validator needs a different anchor).
4. **Should the canary touch phases beyond the nearest one?** My view: no. Bound it to rows within ~28 days.

**Phase 1 — fix the four blockers.** B and C are small; A is a ruling plus possibly a filter; D is `interpret.ts:213`, `readConsistency`, and one new clause in `contradictionsIn`. Falsify every new gate against today's code first — all four should go red today.

**Phase 2 — earn the data.** The stability tool's own verdict is `NOT_YET_ENOUGH_DATA`: **2 of 7 consecutive days, 2 of 5 eligible cycles**. The 36-line JSONL is one day re-run 36 times and must not be counted. Run **14 consecutive clean days** — not 7. Seven was chosen before we knew the evidence set turns over at a 7-day step boundary; a window that can flip on a 7-day granularity needs at least two of them. Criteria to meet across those 14 days, all already computed by the existing tool:

- ≥ 12 eligible cycles with `convergence_state = REANCHORED_CANONICALLY` or `AUTHORED_CANONICALLY`;
- **zero** checksum violations, **zero** contradictions, **zero** `INCOMPATIBLE_REFUSE` accepted as progress;
- **zero** unexplained day-over-day flips or magnitude changes (criteria 6 and 7);
- and, added: **zero cycles in which the logged PACE proposal was `deferred`**, and **zero cycles whose corroboration count would fall below 3 if recovery-window sessions were excluded** — log both, they are the two things that would have stopped this canary.

**Phase 3 — harden the canary** (items 1-6 from §15, minimum: gate falsifiable in `npm test`; audit snapshot inside the transaction or its failure aborts; `ops_alerts` on apply and on `postWriteVerified === false`; rollback gated and given a real invocation path; hard cap on rows touched; rate limit not reset by rollback).

**Phase 4 — then, and only then:**

| Control | Value |
|---|---|
| Scope | one uuid, checked **in code** against a constant, not only via env allowlist |
| Kill switch | `PACE_CANARY_KILL=1`, covering rollback too; falsified in `npm test` |
| Mutation limit | **≤ 5 s/mi**, **nearest phase only**, **≤ 10 rows**, **one application per 14 days** (not 7 — match the evidence turnover), rollback does **not** reset the clock |
| Atomicity | plan `UPDATE` + `coach_intents` + **`rows_before` snapshot** in one transaction; snapshot failure aborts the whole thing |
| Audit | `pace_canary_applications` written inside that transaction; `adaptation_shadow_log` row for the same cycle cross-referenced |
| Rollback | a real route or script, exercised end-to-end against the scratch DB **and** dry-run against a copy of production before the first apply |
| Monitoring | `ops_alerts` on every apply, on `postWriteVerified === false`, and on any apply while `contradictions <> '[]'`; a daily check that `plan_workouts` matches the last recorded `rows_after` |
| Stop rule | **any** apply the owner disputes, **any** unexplained flip, or **any** `ops_alerts` row → `PACE_CANARY_KILL=1` and rollback, no discussion |

**One last thing, and it is the honest summary.** The engine's disposition has genuinely changed: it now proposes `PROGRESS` where the shipped engine has never once done so, and it says why, in a form a human can audit. That is real progress against Rule 21 and it should be said plainly. But Rule 21's second half — *"prove it fires, on real history"* — is not the same as *"the log says PROGRESS."* Right now the log says PROGRESS about a lever the engine deferred, on evidence half of which was gathered in a recovery block, one representative day from flipping to a refusal. **Fix those and the canary is close. Switch it on today and the first live upward adaptation in this app's history would be one the engine itself did not choose.**
