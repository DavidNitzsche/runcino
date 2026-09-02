# Stage 2b handback · plan generation · brief phases 1, 2, 5, 6, §7, §8

**Branch** `stage2b/plan-generation` · **HEAD** `f1512018` · pushed to origin
**Base** `origin/main` at `b0a2a79f`, merged forward twice (`efde6880` → `b8b91615`, `f1512018` → `88d46938`)
**Mode** engine changes + gates. No production write. No live-plan mutation. No goal change. No adaptation mutation. Not merged to `main`.

Every number below is an output I captured. Where I could not verify something, it says so.

---

## 0. Executive scorecard

| Domain | Verdict | Direct evidence | Remaining contradiction |
|---|---|---|---|
| Block strategy | **PASS** | `BlockStrategy`/`PhaseStrategy`/`WeekIntent` stamped on every block; owner's printed in §5 | Descriptive: it reads the block rather than being consulted while composing it |
| Phase purpose | **PASS** | every phase carries `primaryDevelopment`, `entryBasis`, `exitCriteria`, `restructureTriggers`, gated | Carried from Stage 1's `phase-answers`; not re-derived |
| Volume progression | UNCHANGED | owner's 15 week totals moved on 2 weeks only, both from D1 (§5) | The goal→tier volume finding in §15 is open |
| Long-run progression | **CORRECTED** | a graded race now consumes the following long-run slot, continuously (§3) | Only for A/B efforts, by decision D2 |
| One-primary-stressor rule | **MEASURED, ADVISORY** | owner's compound weeks named with numbers (§7) | Reports; does not bind. Argued in `combined-stress.ts` |
| Cutbacks | UNCHANGED | `_sweep_allusers`, `_maint_invariants` green | — |
| Taper | UNCHANGED | frozen periodization structure snapshot byte-identical | — |
| Race placement | **PASS** | §11 refuses a collision every other check passes; owner's C weekend recorded and cited (§3) | The engine cannot MOVE a long run, only shorten it — argued in §3 |
| Availability/travel | UNCHANGED | corpus asserts availability compliance (§6) | Typed compromise codes exist; only two of six are reachable |
| Injury/illness/return | PARTIAL | injury-return and returning-runner archetypes in the corpus | Illness/missed-training are adaptation's, named in §6 |
| Workout selection | UNCHANGED | — | Stage 2's thesis work stands |
| Workout dose | PARTIAL | §12.5 still 4 mi against a 5-7 mi band | Open, §15 |
| Warm-up/cool-down | **IMPROVED** | ratchets fell 19,430→18,393 and 20,304→19,248 (§9) | Still a ratchet, not a zero |
| Progression ladders | **PASS** | 2,581 → 497 flat-target sessions (§4) | 473 §12.5 + 24 collapsed §13.1, both named |
| Coaching Thesis consumption | **PASS** | now RENDERED on Block, verified against production (§8) | — |
| Authoring/recompute parity | **PASS (unchanged)** | `_recompute_paces`, `_authoring_replay_fixtures`, `_authoring_shadow_compare` green | — |
| Goal isolation | **PASS, with a measured caveat** | within a tier the block is byte-identical (§6) | Across tiers the goal moves peak volume 65→70 mi/wk. Open, §15 |
| Phone/Watch contract | **PASS** | no new spec key, no new wire key; `check-wire-keys` green (§10) | — |

**Honest summary.** All four assigned phases landed, plus §7 and §8, plus the three decisions. Two of the four are complete (5 and 6); Phase 1 is complete as a contract but descriptive rather than controlling; Phase 2 is a **first cut** — one of the brief's eight functions is extracted and `generate.ts` is still a monolith (15,310 lines, up 352 from the 14,958 I started at, because the new module and the extracted function carry their arguments). The work found four real defects that no existing gate could see, and two open coaching questions that belong to the owner rather than to me.

---

## 1. Provenance

```
starting SHA   b0a2a79f   (Stage 2 lock; quality-day.ts present, verified)
merged forward efde6880   (origin/main b8b91615)
merged forward f1512018   (origin/main 88d46938)
ending SHA     f1512018
branch         stage2b/plan-generation  (pushed; NOT merged to main)
worktree       .claude/worktrees/agent-a35d8fcf66f0227cc
```

| SHA | Title |
|---|---|
| `035bc0ff` | feat(plan): a race and the long run after it are one transaction |
| `5e438bac` | feat(plan): a cutdown ships its rungs, not one number — 2,581 → 497 |
| `43229505` | feat(plan): the block states its own strategy |
| `824b47b6` | fix(block): the coaching thesis reaches the screen it was written for |
| `25435138` | test(plan): the golden-runner corpus, and the defect it found on its first run |
| `04fbbc68` | chore(plan): remove a temporary diagnostic that rode in on the previous commit |
| `c5374114` | refactor(plan): name layoutWeek's contract, and lift the race week out of it |

**Correction on the record.** `25435138` shipped a throwaway diagnostic (`_tmp_goal.test.ts`) that had been deleted in a shell chain that aborted on the worktree-isolation check, then re-staged by the `git add -A` that followed. Corrected forward in `04fbbc68` rather than by rewriting history.

**Disclosure — `--no-verify`.** Every push used it. The pre-push watch gate cannot run in this worktree: `xcodebuild` fails at `Invalid config file "Secrets.xcconfig"` (environment; no commit touches `native-v2`). As policy requires, `bash scripts/verify-commit.sh` was run and reported **CLEAN** for `035bc0ff`, `5e438bac`, `824b47b6`, `04fbbc68` and `c5374114`, covering `tsc --noEmit` + `next build` in an isolated worktree and reporting `check-watch.sh` as N/A because no commit touches watch paths.

**Production access.** Read-only throughout (`DATABASE_URL=$DATABASE_URL_RO`). `composeForUser` and `loadV5Block` do not persist; `generatePlan`/`persistComposedPlan` were never called; no rebuild triggered. Plan `pln_9a57561debb776e5` was read, never written.

**Limitations.** No iOS build and no simulator render — no engine change reaches a Swift file. The Block coach line was verified as the **payload** `/api/v5/block` returns for the owner's real account, not as a device screenshot; §8 says so rather than claiming otherwise. No Railway deploy; the branch is not merged.

---

## 2. Ownership map

### Contracts extracted, and their owners

| Question | Owner before | Owner now |
|---|---|---|
| How long after a race before the next long run | **nobody** | `combined-stress.ts#returnToLongDays` + `longRunFactorAfterRace` |
| Is a race graded as a race or as a hard workout | **nobody** | `combined-stress.ts#raceConsumesLongRunSlot` |
| Days of no quality after a tune-up | `generate.ts` inline (B) + an uncited fallback + nothing at all (C) | `combined-stress.ts#noQualityDaysAfterRace`, called by the composer AND the validator |
| The typed contradictions a finished block is checked against | none | `combined-stress.ts#combinedStressFindings`, raised in `validateComposedPlan` §11 |
| What each phase develops / each week is for | inferable over 3,000 lines | `strategy-contracts.ts#deriveBlockStrategy` → `authoredState.block_strategy` |
| What a proposed progression step requires | none | `WeekIntent.proposedChange` (lever, from/to, prerequisites, hold alternative, status) |
| The rungs of a cutdown | `buildWorkoutSpec`'s single slot anchor | `catalogue-rx.ts#descentRungs` + the segment grammar's `@ ZONE+N` |
| `layoutWeek`'s inputs | an anonymous 139-member type literal | `export interface LayoutWeekInput` |
| The race week | 162 lines inside `layoutWeek` | `layoutRaceWeek(Pick<LayoutWeekInput, …>)` |

### Duplicate owners DELETED

- **The uncited post-race window.** `race.distanceMi >= 12 ? 4 : >= 5 ? 2 : 1` for an unanswered B race — three numbers with no citation, sitting beside a doctrine-bound table and BELOW it in every row (half 4 vs 7, 10K 2 vs 4, 5K 1 vs 3). Deleted (D1).
- **The half-plus long-run stand-down.** `d.isLong && race.distanceMi >= 12` inside the no-quality loop converted any long in that window to a ≤6 mi easy day. Two defects: it was a cliff, and its trigger was the wrong COLUMN of the doctrine table. Deleted; `longRunFactorAfterRace` owns the question (D2).
- **The C race's one-day window.** A bare `+1`, cited to nothing, giving a C-effort tune-up no recovery at all. Deleted; found by the golden corpus (§6).
- **`POST_RACE_PRIORITY_SCALE`, `postRaceNoQualityDays`, `effectiveRecoveryPriority`** moved out of `generate.ts` into the leaf module and re-exported, because `validateComposedPlan` cannot import `generate.ts` (the dependency runs the other way) and a copy would have been a second answer.

### Retained, with reasons

- **`POST_RACE_RECOVERY_WEEKS` keeps its own consumers.** It is week-granular and reads the UPPER edge of `Research/00b`'s band; `ROLE_POST_QUALITY_FREE_DAYS` is day-granular and reads the LOWER edge. Both are inside the published band. The tune-up question takes the day-granular table (the finer instrument, and the one the composer already authored under); whole-block recovery sizing and the two long-run-race-pace-finish guards in `generate.ts` keep the week-granular one, because they ask a different question and answer it more conservatively on purpose. Written up in `combined-stress.ts#noQualityDaysAfterRace` — this is the third instance of the granularity divergence CLAUDE.md already records for `raceWindowFor`.
- **`buildCoachLine`.** Block's phase line is still the answer in TAPER, race week, RECOVERY, MAINTENANCE and a finished block. The thesis is preferred only in a building phase.
- **The compound-progression finding is ADVISORY.** Binding it today refuses the owner's block for a cutback rebound doctrine licenses. Argued in `compoundProgressionFindings`.

### Not deleted, and why not

`generate.ts` is still a monolith. One of the brief's eight `layoutWeek` splits is done. §11 says what remains.

---

## 3. Phase 5 · combined-stress and placement validation, and D1/D2

**The defect, reproduced against production at `origin/main` before any change:**

```
2026-09-26 Sat  race 6.21 mi
2026-09-27 Sun  long 15.5 mi          21.71 mi in 24 hours
```

`validateComposedPlan` §1 asked whether the long run was legal, §5 whether the week carried quality, §9 whether hard days were spaced. All three answered yes. Nothing computed the pair.

**D2's arbitration.** Two citations both apply. `Research/00b` §"Recovery by Distance" gives every raced distance a "Return to long runs" day — a column nothing in this engine had ever read. `Research/22` §"Multi-Race Year Planning", with the Pfitzinger Saturday-tune-up → Sunday-long pattern the embedder's own comments already cite, deliberately puts a race in front of a long. §"Recovery by Effort" settles which is speaking: a C race is a "hard workout substitute … treat like a hard workout".

So an **A or B EFFORT** consumes the following long-run slot; a **C effort** does not. The grade is the EFFECTIVE one, so an answered "race it honestly" is an A and an answered MP-workout conversion is a C.

**Continuous, not a cliff (Rule 9).** The allowed long is `daysAfter / returnDays` of what the week planned, reaching the full long exactly on the doctrine day. Walked at quarter-day steps in the gate and at tenth-day steps in the registry claim. The branch this replaced stood a long down entirely on day 4 of the *wrong window* and left it untouched on day 5.

**Why it shortens rather than moves.** Brief §5.4 offers "long run moves" first and this engine cannot take it: the composed week is anchored on `longRunDow` and the long is its last day by construction, so there is no later seat. Moving it earlier trades one adjacency for another. The compromise is `REDUCE_DOSE`, recorded by name.

**Every decision is recorded**, acceptances included, on `authoredState.placement_compromises`, and `refreshPlacementCompromises` restates each record against the block that ships — caught immediately: the first cut recorded 18 mi over a day the plan shipped at 15.5 (Rule 16).

**D1.** The uncited window is gone. An unanswered B race takes `ROLE_POST_QUALITY_FREE_DAYS.b_effort`: half 7, 10K 4, 5K 3. Where the doctrine window swallows a whole quality-phase week, `validateComposedPlan` §5 accepts it through `POSTRACE-WEEK-1` — an argued exemption keyed on "no day of this week is outside a post-race recovery window". The recovery table is injury-motivated and cited to a table; "every quality week carries quality" is a shape preference with no research passage behind it, and §"The Reverse Taper Principle" says the opposite. The cited rule wins. The general requirement is untouched: a week with even ONE eligible day still has to carry its session.

**A Rule 16 conflict surfaced by wiring §11.** The first cut raised three violations on the owner's block purely because two doctrine-bound tables read opposite edges of the same band. `noQualityDaysAfterRace` is now the single resolver the composer and the validator both call.

---

## 4. D3 · a cutdown ships its rungs

**Before**, on the owner's live block: `5×1 km @ I · 1 min jog` at ONE pace, over doctrine that reads "Start at MP, finish at 5K" and "Each rep 5 s/mi faster". The catalogue was never the problem — `zoneClause` already rendered `5×1km · MP → 5K` — but `buildWorkoutSpec` priced the set at the slot's single anchor and `subLabelFromSpec` re-derived the label from that spec.

**The missing vocabulary.** `SpecStep` already carried a zone and a pace per step; the grammar could only name a ZONE, and §12.3 declares two zones for a five-rep set.

- The grammar gains **one token**: `@ ZONE+N`, seconds per mile slower than the zone. It is `Research/04` §12.2's own Pace example — *"6 reps: MP+10, MP, MP-10, HM, T, 10K"* — and its Structure row asks for it in words. Only the PLUS side is read: a minus is already the band separator (`T-10K`).
- `descentRungs` walks `DESCENT_LADDER` from the entry's first declared zone to its last. Equal rep count takes the walk; fewer takes an evenly spaced subset keeping BOTH endpoints; more opens slower than the first zone by the entry's OWN cited per-rep step, read out of the cite at run time.

| entry | doc says | engine's step | 6-rep answer |
|---|---|---|---|
| §12.2 mile cutdowns | "5–15 s/mi" | 10 | `MP+10, MP, HM, T, 10K, 5K` |
| §12.3 1K cutdowns | "5 s/mi" | 5 | `MP+5, MP, HM, T, 10K, 5K` |
| §11.2 Canova 2K | "2.5–5 s/km" | 6 | `MP+18, MP+12, MP+6, MP, HM, T` |

§12.2's own example is `MP+10, MP, MP-10, HM, T, 10K`. The engine's six-rep answer is that shape with the descent carried to the entry's stated end.

**It DECLINES rather than guesses:** an entry whose cited rows state no descent (caught by `_catalogue_wiring` on the first run — §5.4's long tempo declares HM and T as a BAND and was rendered as a two-rung ladder), an ascent, a one-rep set, or a per-rep step nothing states.

**Additive, precisely.** No new spec key and no new wire key: the offset resolves to a number inside `SpecStep.pace_s_per_mi`, an existing field, and the watch receives the flat phase list `expandSpecToPhases` has always given it. `check-wire-keys.sh` green (110 phone keys, 96 watch decoders, 50 watch emitters).

**Census, over the 8,781-plan archetype matrix:**

```
ladder sessions placed          2,898
shipped as ONE flat scalar      2,581  →  497
  remaining, by section         §12.5  473   the tempo slot's "<N>mi <phrase>"
                                             shape cannot hold a per-mile ladder
                                §13.1   24   the affordability cut collapsed a
                                             sequence to one rung
now stepped                     §12.3 1129 · §12.2 687 · §11.2 268 · §13.3 242 · §13.1 75
```

---

## 5. Owner CIM block · before / after

Read-only reproduction of plan `pln_9a57561debb776e5`, user `0645f40c-951d-4ccc-b86e-9979cd26c795`, composed at `origin/main` `b0a2a79f` and at `f1512018`.

> **THIS IS GENERATOR OUTPUT, NOT HIS LIVE ROWS.** Pace recompute reprices an authored plan but never restructures one, and the only paths that re-lay-out a block are plan-drift's automatic rebuilds and the `workflow_dispatch`-only silent rebuild. His plan was authored 2026-08-31 and still carries the "before" column. Nothing in this branch reaches him without a rebuild, which is a live data write and needs an explicit go.

### Changed rows

| Date | Before | After | Why |
|---|---|---|---|
| 2026-09-17 Thu | `intervals 6.5mi · 6×3 min hills` | `easy 5mi` | D1 · day 4 of the 10K's 4-day window |
| 2026-09-18 Fri | `easy 5mi` | `threshold 6mi · 2×1.5 mi @ T · 3 min jog` | the light re-entry, day 5 |
| 2026-10-06 Tue | `tempo 9.5mi · 5.5mi continuous tempo` | `tempo 8.5mi · 4.5mi` | D3 · the ladder beside it now spends the T budget it actually uses |
| 2026-10-08 Thu | `intervals 6.5mi · 5×1km · MP → 5K` | `1km @ MP · … + 1km @ HM · … + 1km @ T · … + 1km @ 10K · … + 1km @ 5K` | D3 |
| 2026-10-11 Sun | `LONG 18.5mi · 4mi @ M + 1mi @ E + 2mi @ M` | `… + 3mi @ M` | the week's re-balance |
| 2026-11-03 Tue | `threshold 8mi · 4×1km · MP → 5K` | six rungs from `MP+5` | D3 |
| 2026-11-13 Fri | `threshold 8.5mi · 2×1.5 mi @ T` | `easy 6.5mi` | D1 · day 5 of the half's 7-day window |

Easy days absorbing the D3 re-balance: 2026-10-05 Mon 6.0 → 6.5, 2026-10-07 Wed 12.0 → 12.5.

### Week totals

Fourteen of fifteen unchanged. Two moved, both from D1:

```
W4  2026-09-14  34.0 → 33.5     the cleared intervals day
W12 2026-11-09  42.0 → 40.0     the cleared threshold day
```

Phase boundaries, cutbacks, taper shape, long runs, race placement, race pace and the stated 3:00:00 goal are byte-identical.

### The Dodgers weekend — the brief's §3.2.C case

**Unchanged, and now guarded rather than unguarded.** The race is priority C, unanswered, so `effectiveRecoveryPriority` grades it C and D2 says a hard workout does not consume the following long-run slot. What changed is that the engine now looks, decides, and records:

```
ACCEPT_AS_HARD_WORKOUT 2026-09-27 · 15.5mi long run stands 1 day(s) after
  Dodgers (6.21mi, C effort) · 21.71mi across the pair
  cite: Research/00b §"Recovery by Effort" (C race · treat like a hard workout)
      · Research/22 §"Multi-Race Year Planning"
```

Re-grade the same days to a B effort and `validateComposedPlan` refuses the plan with `RACE_LONG_24H`. That is asserted in `_combined_stress.test.ts` and is the falsification of the whole mechanism.

---

## 6. Golden-runner results · brief §7

Eighteen of the brief's twenty-five archetypes, in `lib/training/_brain_acceptance.test.ts` (extended, not a parallel corpus), each with the coaching outcome written as prose before any assertion. All green.

```
 1 owner marathon mid-block      no BASE phase, peak above the open, real taper
 2 zero-run cold start           opens at the composer's floor, not at zero
 3 typed-PR cold start           a PR gives a pace anchor, not volume
 4 sparse history                small legal block, no refusal, no fabrication
 5 returning after 3 weeks off   opens below the pre-layoff level, climbs back
 6 injury return, 4 days         every run lands on an available day
 8 durability-limited marathoner legal block shape, unchanged by the limiter
 9 speed-limited marathoner      strategy names the limiter it was handed
11 low volume                    day sums agree with the week, and it validates
12 four days, one quality slot   never two structured sessions
13 six days, two quality slots   never three
16 multiple mid-block races      both embed; three race days; validates
17 six-week runway               ≤2 weeks of BASE, still tapers
18 no goal                       authored, nothing priced off an absent goal
19 aggressive goal               legal block, no pace moved
20 no HR data                    same shape, ceiling absent rather than invented
25a 5K · 25b ultra               both taper and carry quality
```

Every fixture asserts phase purpose, weekly role, one named primary stressor, safe volume and long-run shape (by asking `validateComposedPlan` rather than re-deriving it), quality spacing, progression identity with prerequisites and a hold alternative, availability compliance, and rationale presence.

**Coverage as PATHS REACHED, not cases run (Rule 15).** Seven of the brief's twenty-five are not expressible as a `ComposePlanInput` and are named in the file header with the suite that owns them: illness and the three missed-training cases (`lib/plan/adapt.ts`, `_adapt_invariants`), heat (`lib/weather/heat-adjustment.ts`, the `HEAT.*` claims), authoring/recompute parity and sealed-history immutability (both need the database — `_recompute_paces`, `_authoring_shadow_compare`, `_mutation_boundary`, `_backdate_guard`).

### The defect the corpus found on its first run

Archetype 16 refused to validate:

```
Week 2026-09-14 (QUALITY_INSIDE_RECOVERY_WINDOW): intervals on day 2 after
Tune-up 10K · Research/00b "Total recovery days (no quality)" owes 2.5 day(s)
```

A C-effort tune-up had **no post-race no-quality window at all** — one day either side, cited to nothing. Same shape as D1's uncited B window one branch over, and the composer's answer was again the uncited one. `Research/00b` §"Recovery by Effort" gives the C row 25–50% of the A-race window, so a C 10K owes 2.5 days. Fixed: the composer asks the same `noQualityDaysAfterRace` the validator asks. The long run is deliberately untouched by it (D2). The owner's block is byte-identical — his Dodgers 10K is a Saturday race and the days after were already easy.

### Goal isolation

Compose the same runner against a 15% faster and a 15% slower goal with `tPaceSec` held fixed, and ask whether the training moves.

**It does, through exactly one mechanism.** `classifyGoalTier` reads the goal PACE into a `GoalTier`, and the tier's `peakWeeklyMileageBand` is what `volumeCurve` aims at:

```
1 · owner-shaped archetype:  advanced peak 65 mi/wk  →  elite peak 70 mi/wk
```

on identical evidence, an identical threshold and an identical phase structure. See §15 — this is one of the two open questions.

The test asserts what holds without argument and prints the rest: **within a tier the block is byte-identical; across tiers the periodization is identical and only volume moves.** Both liveness halves are checked, because a run where every pair crossed a tier would report green having asserted only the weak half.

### Three fixture artefacts, corrected rather than papered over

The corpus red-flagged three more things that turned out to be mine, and each correction is written into the fixture:

- the returning-runner fixture carried `heldMi: 40` beside `interruptionWeeks: 3` — a runner currently holding pre-layoff volume who was also not running. `POSTRACE-RESTORE-1` reads `heldMi` to decide whether the re-entry week has been spent, so the contradiction opened the block at full volume and looked like an engine defect;
- a race week's `weeklyMi` EXCLUDES the race itself, by design (TAPER-1), so a day-sum equality there measures the exclusion;
- the first goal-isolation cut varied `tPaceSec` with the goal, which is a fixture shortcut — a pure caller has no `PrescribedPaceAnchors`, and an easy day is sized in MINUTES at the runner's own pace.

---

## 7. Progression proof · Phase 1 and Phase 6

`authoredState.block_strategy` on the owner's block:

```
block-strategy/1 · thesis DURABILITY (resolved, confidence 0.51) · start 42 peak 59

DEVELOPMENT    QUALITY@2026-08-24        lever=weekly_volume  held=[]
               families=[intervals,tempo,threshold]  long 12–18.5  racePaceLongs=1
RACE_SPECIFIC  RACE-SPECIFIC@2026-10-19  lever=weekly_volume
               held=[quality_duration,work_density]  long 17–21  racePaceLongs=1
TAPER          TAPER@2026-11-16          lever=—
               held=[weekly_volume,long_run_duration,quality_duration,work_density]

2026-08-24 HOLD     —                    opening week, the block's starting load
2026-08-31 BUILD    weekly_volume        42 → 45      · also long_run +3.4%
2026-09-07 CUTBACK  —
2026-09-14 CUTBACK  —
2026-09-21 BUILD    weekly_volume        33.5 → 49.7  · also quality_duration +41.7%
                                                        long_run +29.2%
2026-09-28 BUILD    quality_duration     8.5 → 18.5   · also work_density +100%
                                                        long_run +9.7% volume +8.7%
2026-10-05 BUILD    long_run_duration    17 → 18.5    · also weekly_volume +8.3%
2026-10-12 CUTBACK  —
2026-10-19 BUILD    weekly_volume        44 → 58.5    · also long_run +30.0%
2026-10-26 HOLD     —
2026-11-02 CUTBACK  —
2026-11-09 CUTBACK  —
2026-11-16 TAPER    —      2026-11-23 TAPER  —      2026-11-30 RACE  —
```

That is brief §3.2.B's compound-progression finding as numbers instead of prose. The two weeks that are NOT cutback rebounds are reported by the new stress ledger:

```
note COMPOUND_PRIMARY_STRESSORS 2026-09-28 · volume +8.7% (49.7→54) and long +9.7% (15.5→17)
note COMPOUND_PRIMARY_STRESSORS 2026-10-05 · volume +8.3% (54→58.5) and long +8.8% (17→18.5)
```

**Every proposed step is PROPOSED, and only PROPOSED.** Nothing can be EARNED at authoring, and the other four statuses (`HELD`, `REDUCED`, `RESTRUCTURED`, `EARNED`) exist so an adaptation pass has a contract to write into. Adaptation stays shadow-only: nothing in this branch grants mutation authority and nothing reads these back.

**Prerequisites NAME an owner and carry no numbers** — `adaptive-ramp.ts#tryAdaptiveBump`, `readiness.ts#scoreReadiness`, `progression-gate.ts`, `capacity-resolver.ts`. A threshold copied into the strategy would be a second answer to a question another service owns, and the gate refuses any prerequisite statement containing a bare percentage, mileage or bpm.

**Hold alternatives are concrete**, derived from the week before rather than described in the abstract: *"Repeat the week of 2026-09-21: 49.7 mi, long 15.5 mi, 2 quality session(s)."*

---

## 8. Race, availability and recovery proof · and the Block thesis line

### The C-effort acceptance and the B-effort refusal

Both asserted in `_combined_stress.test.ts` on a real composed block: the C-effort block ships clean and records `ACCEPT_AS_HARD_WORKOUT`; re-grading the SAME days to a B effort on `authoredState` alone — so only the grade moves — is refused with `RACE_LONG_24H`. A Friday tune-up leaves more of the long standing than a Saturday one, which is the continuity claim.

### The Coaching Thesis, rendered

Handed to me by the brain agent, verified by looking at the deployed Block screen: the thesis was composed correctly, shipped correctly on `thesis`, and rendered nowhere — `Thesis`, `reviewTrigger` and `limiter` appear zero times in `native-v2`.

Reproduced against production, read-only, on the owner's account:

```
before  "This is where the fitness gets built. Hit the quality sessions,
         let the easy days stay easy."
after   "Your races fade with distance faster than your speed predicts, so
         durability is where the work goes. Your threshold holds."
```

`coachLine` is a string in a field the app already renders, so this needs no app release. The four cares:

- **State.** `resolveCoachingThesis` does not refuse by phase, so the gate is in `blockCoachLine` rather than assumed there. The thesis wins in BASE, QUALITY and RACE-SPECIFIC only; a taper, a race week, a recovery block and a finished block keep their own lines, because "durability is where the work goes" during a taper is actively wrong.
- **Rule 11.** Three branches, not a fallthrough. No thesis → phase line. A thesis whose limiter is `UNKNOWN` is the resolver's OWN refusal and also takes the phase line, because "not enough evidence yet" is a claim about the model rather than an answer to "where this goes".
- **Rule 17.** `thesis.coachLine` ends *"and this week's long run is the session that builds it"*, and Today already says that through `thesisLeadClause`. Block asks the SAME composer for the block-level register (`addressedThisWeek: false`) rather than writing a second sentence.
- **Rule 13, honestly.** Verified as the payload, not as a device render. No iOS build was made and no Swift file changed. Reported as a payload verification.

---

## 9. Arithmetic proof

- **Weekly budget** — 13 of 15 owner weeks byte-identical; two moved, both because a quality day the doctrine window cleared was not replaced in the same week (§5).
- **Boundary running** — both `_boundary_run` ratchets fell without being aimed at: 19,430 → **18,393** over-owner and 20,304 → **19,248** legs-outweigh-work. A cutdown rendered as a per-rung sequence is sized by `segmentSpec` from the SESSION's own work rather than by the uniform rep path from the day budget.
- **Ladder census** — 2,581 → **497**, with the remaining 497 split by section and each shape named.
- **Layout refactor** — 8,781 plans, 699,860 days, 3,969 race weeks, digest `15513558…` identical before and after (§11).
- **Bounded underfill** — not attempted; the previous agent measured that this engine does not express it and inventing a tolerance would be a second volume truth.

---

## 10. Cross-surface contract

**No new spec key, no new wire key, no version bump.** The `@ ZONE+N` token resolves to a number inside `SpecStep.pace_s_per_mi` before the spec exists; `steps[]` and `expandSpecToPhases` are pre-existing and unchanged, so the watch receives the flat phase list it has always received. `authoredState` gains `placement_compromises` and `block_strategy`, which are server-side audit fields no client decodes.

```
check-wire-keys OK · phone 110 keys · watch decoders 96 · watch emitters 50
check-client-graph OK
```

**Not verified:** no iOS simulator render. No change reaches a Swift file; the affected values were verified as composed output and as the Block payload instead.

---

## 11. Refactor map · Phase 2

| | before | after |
|---|---|---|
| `layoutWeek` signature | 40 inline-destructured params under an anonymous 139-member type literal | `layoutWeek(input: LayoutWeekInput)`, destructured on line one |
| race week | 162 lines inside `layoutWeek` | `layoutRaceWeek(Pick<LayoutWeekInput, 6 fields>)` |
| `generate.ts` | 14,958 lines | 15,310 lines |

`generate.ts` grew, and that is honest rather than a failure: the extracted function carries its own header and argument list, and the new modules live beside it. What changed is that a responsibility can now be lifted out by taking a `Pick<LayoutWeekInput, …>` instead of re-declaring its own slice of forty parameters.

**Seven of the brief's eight splits are NOT done:** `resolveWeekRole`, `resolveWeekLoadBudget`, `resolveKeySessionSlots`, `resolveLongRunIntent`, `resolveEasyAndMediumLongDays`, `allocateWeeklyMileage`, `validateFinalWeekStress`. The race week came out because it reads six of the forty inputs and returns before any of the standard week's sizing; the others share the week's mutable day array and its budget arithmetic, and cutting them is a different-sized job with a different risk profile.

**Behaviour preserved, proven rather than asserted.** `_layout_contract.test.ts` digests every composed day across the archetype matrix. The snapshot was written by running it against the PRE-REFACTOR `generate.ts` restored from `HEAD`, and the refactored engine reproduces it exactly:

```
8,781 plans · 699,860 days · 3,969 race weeks
sha256 15513558d16ac90b2d8d10ac27609639089766220b433eca2a33df4575767c36
```

A hand-written expectation would have been my own reading of what the code did, which is the thing under test.

---

## 12. Falsification ledger

Every gate was broken on purpose and the failing output captured.

| Gate | Broken how | Failing output | Restored |
|---|---|---|---|
| `validateComposedPlan` §5 `POSTRACE-WEEK-1` | exemption removed | `Week 2026-11-09 (RACE-SPECIFIC): no quality sessions prescribed · every quality-phase week requires at least one` | PASS |
| `_combined_stress` · displacement | `raceConsumesLongRunSlot` short-circuited | `B long 18 must be shorter than C long 18: expected 18 to be less than 18` | PASS |
| `_combined_stress` · §11 enforcement | the violation loop emptied | `the collision must be refused once the effort is graded as a race: expected null to be truthy` | PASS |
| `_combined_stress` · doctrine table | `RETURN_TO_LONG_DAYS.hm` → `[7,12]` | `expected [ 7, 12 ] to deeply equal [ 7, 10 ]` **and** `RULE 9 … expected 8.4 to be close to 7` | PASS |
| `RECOVERY.return-to-long-runs` (registry) | `longRunFactorAfterRace` made a step function | `broke: longRunFactorAfterRace steps 1.0000 over 0.1 day at 3.5 · that is a cliff` | PASS |
| `_ladder_targets` · the offset token | `splitZoneOffset`'s match nulled | `expected [ [ 'MP', +0 ], … ] to deeply equal [ [ 'MP', 10 ], … ]` and `expected 'MP' to be 'MP+10'` | PASS |
| `_ladder_targets` · the rungs | `DESCENT_LADDER` reordered (T before HM) | `expected [ 'MP+10', 'MP', 'T', 'HM', …] to deeply equal [ 'MP+10', 'MP', 'HM', 'T', …]` | PASS |
| `_variety_invariants` · I+R lift | two-day fixture given three quality days | `5k: three quality days give an I+R share of 5.39% against 5.39% for two — the R day is not lifting it` | PASS |
| `_strategy_contracts` | thesis emptied, hold alternative emptied, primary-lever sort inverted | `expected 'undefined' to be 'string'` · `weekly_volume step has no hold alternative` · `2026-08-31: long_run_duration moved more than the declared primary weekly_volume` | PASS |
| `_block_thesis_line` | preference short-circuited | four tests, incl. the Rule 17 and Rule 11 branches | PASS |
| `_layout_contract` | race-week shakeout moved one day | digest `15513558…` → `de55ca3f…` | PASS |
| `_brain_acceptance` #16 | C-race window pinned back to 1 | `Week 2026-09-14 (QUALITY_INSIDE_RECOVERY_WINDOW): intervals on day 2 after Tune-up 10K` | PASS |
| Ratchets (ladder, boundary-run) | left stale | `the ratchet is stale by 2,084 sessions — lower it`; `stale by 1,037` | lowered once, with the new measurement |

**Rule 22 · what each gate cannot fail on** is written into every new file header. The four that matter most:

- `_combined_stress` cannot see the block's own target race, cannot see a collision between two non-race sessions (§9 owns that), and cannot judge whether the C-effort acceptance is the right coaching answer — it asserts the engine applies the doctrine reading and records it.
- `_ladder_targets` cannot see two adjacent rungs resolving to the SAME number, because `resolveZoneAnchors` prices HM at the threshold anchor (`Research/01`: T is "≈HM pace for sub-elite"), so a `MP → HM → T` ladder ships its HM and T rungs at one pace. The explicit rung assertion is what catches a reordering; the first-to-last assertion is what stops a ladder resolving entirely flat.
- `_strategy_contracts` cannot see the INTENSITY axis. `ComposedWeek` carries no scalar for "how hard".
- `_layout_contract` cannot see a change reaching only paths the corpus cannot express — `sim-matrix` archetypes carry no history, no travel windows, no mid-block races and no thesis.

---

## 13. Complete verification

```
npx tsc --noEmit                                            clean
vitest lib/plan lib/training lib/prescription lib/doctrine
       lib/audit lib/coach lib/workout-catalogue
       lib/adaptation lib/race lib/fitness                  336 files · 5,595 passed
                                                            · 0 failed · 14 skipped
npm run prebuild (18 gates)                                 exit 0
bash scripts/verify-commit.sh <each pushed head>            CLEAN (tsc + next build)
```

Held green: `_sweep_allusers`, `_maint_invariants`, `_dosing_sweep_gate` (0 enforced breaches), `_coach_sensible`, `_restore_continuity`, `_audit_persist_realization`, `_quality_day`, `_recompute_paces`, `_authoring_replay_fixtures`, `_authoring_shadow_compare`, `_goal_immutability`, `_mutation_boundary`, `_backdate_guard`.

**Snapshots that moved, and only these two:**

- `_audit_periodization` · `david-marathon-quality-vocab`, three lines, all the same session written honestly. `david-marathon-structure` is **byte-identical** — same weeks, phases, mileage, long runs and quality types. The argument is written into the test beside the previous one.
- `_layout_contract` · created in this branch, written from the pre-refactor engine (§11).

**Not run:** iOS build, watch build, Railway deploy.

---

## 14. Proposed production migration

**None proposed.** No rows would be written by this branch. If it merges and a rebuild runs, the owner's future unsealed rows change as in §5 — two week totals down by 0.5 and 2.0 mi, two quality days moved to the doctrine-correct day, three cutdowns rendered as their rungs, and the Block screen's coach line replaced by his thesis. Sealed history untouched. That is a rebuild and it needs an explicit go; the brain agent has already surfaced the command to David and recommends one rebuild after the whole programme finishes.

**One thing DOES reach him without a rebuild:** the Block `coachLine` (§8), because it is composed per request rather than persisted. It needs a deploy, not a rebuild, and no app release.

---

## 15. Remaining decisions and open work

### BLOCKING — needs a decision

**D4 · Should a stated goal move training VOLUME?** Measured, §6: the same runner with a 15% faster goal gets a peak of 70 mi/wk instead of 65, on identical evidence, an identical threshold and an identical phase structure. The mechanism is `classifyGoalTier` → `TIER_TARGETS[cat][tier].peakWeeklyMileageBand` → `volumeCurve`, and it is documented and doctrine-cited (`Research/22` keys its templates on goal tier; `generate.ts` records that a tier-blind generator "was producing goal-blind plans"; COLD-1 already caps an UNSTATED experience level so a typed goal cannot buy elite volume alone). It is also, read the other way, the goal renegotiating training. Both readings are defensible, which is why it is a decision and not a fix. **Default if unanswered: leave it.** The measurement is now on the record and gated.

**D5 · Bind or keep advisory the one-primary-stressor rule.** `COMPOUND_PRIMARY_STRESSORS` fires twice on the owner's block (§7). Binding it today refuses his block for weeks that raise volume and the long together by ~9% each. Doctrine says progress one stressor at a time; the engine's volume curve and long-run ladder are separately doctrine-bound and neither knows about the other. Making it fatal means one of them yields, which is a volume-curve change. **Default if unanswered: stays advisory**, reported through `onStress`.

### NON-BLOCKING — measured, ready to pick up

- **`normalWeeklyMileage` returns 34.0 for the owner where CLAUDE.md records 43.5.** Handed to me by the brain agent; I did **not** change it and nothing in this branch reads it — the composer's ramp base comes from `resolveRampBase` / `rampBaseMi`, not from that reader. Its own diagnosis stands: the filter is right and the STATISTIC is wrong, because a MEAN over representative days answers "what did he average" where the generator asks "what can he sustain", and one zero week moves an eight-week mean by about six miles. It belongs with whoever owns the habit readers, as its own commit with its own before/after, so a volume shift is attributable separately from this structural work.
- **§12.5 continuous mile cutdowns · 473 flat sessions.** The tempo slot's shape is `"<N>mi <phrase>"` and `parseTempoLeadMi` reads that leading number back out, so a per-mile ladder cannot be written in it. Closing it is a `layoutWeek` change. Same session is also the open dose/zone finding: it ships 4 mi at T against a documented 5-7 mi at MP+15 → HM.
- **§13.1 descending ladder collapsed to one rung · 24 sessions.** `sizeFromPrescription` can cut a sequence to a single step; `renderPrescription` refuses to AUTHOR a one-rep set and the affordability cut has no such rule.
- **`MOVE_WITHIN_WEEK` is declared and unreachable.** The composed week is anchored on `longRunDow`, so a long run has no later seat to move to. Closing it means letting the placement pass re-seat the long, which is a `layoutWeek` change.
- **HM and T resolve to the same pace**, so a cutdown's HM and T rungs ship one number. `Research/01` licenses it for sub-elite; whether HM should have its own anchor is the pace resolver's question.
- **19,248 corpus sessions still carry more boundary running than their work.** Ratcheted, not zero.
- **Rule 15's corpus gap is unchanged** — `sim-matrix` archetypes carry no history, so the four doctrine mechanisms the previous agent named remain dark across the sweep, and the new golden corpus reaches them only where a fixture states the field outright.

### NOT ATTEMPTED

Seven of the brief's eight `layoutWeek` splits (§11), brief Phase 3 (explicit catalogue progression families with ordered steps and hold/regress branches — the ladder work is the target array, not the step ladder), Phase 4's canonical boundary-run policy beyond what Stage 2 landed, Phase 8 (migrate and delete), and the availability compromise codes beyond the two the placement pass records.
