# FINAL CONSOLIDATED REPORT — faff.run Brain, Evidence, Learning & Adaptation Forensic Audit
## Gap-fill + targeted revalidation pass, 2026-09-10

---

## HEADER

**Method.** This is NOT a from-scratch four-track audit. A prior 8-session audit (2026-09-09) already produced a 428-line consolidated handback plus four domain reports (A-lineage, B-cohort, C-consumption, D-surfacing). That prior work was checkpointed verbatim into this branch (`audit/brain-forensic-2026-09-10`, commit `5b41b0d99`, base `80fca013f`) before any new work began, so it remains reviewable in its original form. This pass then ran three investigation tracks (revalidation of the highest-consequence prior claims; three missing exhibits; an actual device/execution render attempt) plus two independent falsifier passes on the most consequential new findings. No code was edited, no migration applied, no production data mutated, no merge to `main` performed.

**Evidence-status legend used throughout:**
- **[INHERITED-REVALIDATED]** — a prior claim, independently re-derived this pass and confirmed true on current `origin/main`/prod.
- **[INHERITED-SUPERSEDED]** — a prior claim that was true when made but is now stale (a commit landed, a mechanism changed).
- **[NEWLY-INVESTIGATED]** — not addressed by the prior audit at all; built this pass.
- **[INDEPENDENTLY-REVIEWED]** — a newly-investigated or newly-changed claim that a *second*, separate pass this session re-derived from scratch and confirmed or corrected.
- **[UNRESOLVED]** — genuinely open, by more than one independent look.
- **[BLOCKED: reason]** — attempted, could not be completed, reason stated.

Every factual tag below (`[SRC]`, `[PROD-RO]`, `[TEST]`, `[RENDER]`, `[INF]`) is reproduced from whichever pass originated it.

**Runner:** David Nitzsche, `users.id = 0645f40c-951d-4ccc-b86e-9979cd26c795`. **DB access:** `faff_readonly`, SELECT-only, re-confirmed zero write grants this pass. **Commit pinned for this pass's `[SRC]` citations:** `80fca013f94b99ee5af3f84e79590591d42141da` (current `origin/main` tip at pass start; 26 commits ahead of the original audit's `8559245...` pin — full list available on request, not reproduced here for space).

**A note on the working tree.** A separate, concurrent Claude session was found mid-pass to be independently working on an overlapping "v2" of the original handback directly in this shared checkout (uncommitted, on top of this same branch — see git reflog, no commit or branch-switch occurred, so nothing of this pass's checkpoint was altered in git history). That work was left untouched; nothing from it is incorporated below, and nothing of this report depended on it.

---

## 1. EXECUTIVE VERDICT

**Observe:** works. Ingestion, dedup, canonicalization, and phase-level classification are real, live, and — per Exhibit 1 below — mostly single-owned.

**Learn from it:** **YES, at the shadow/compute layer, for three of four levers.** PACE, VOLUME, and DURATION each have real, falsification-tested, evidence-grounded computation that runs live against David's actual training. DENSITY's computation (`progression-pass.ts`) exists but this pass found no evidence it currently executes on a schedule the way the other three do.

**Adapt from it (automatically): BLOCKED, for all four levers, under the current architecture — but the reason is more precise than "never happened."** `AUTOMATIC_ADAPTATION_AUTHORITY: false = false` (`adaptation-authority.ts:113`) is real, single-seamed, and has zero confirmed side doors as of this pass. But **the current seam has never actually been organically *tested* by an upward-shaped real-world trigger**, because the only two organic upward events this account has ever produced — VOLUME on 2026-06-02 and (newly found this pass) DURATION/long-run on 2026-08-25 — both predate the seam's existence (closed 2026-09-02) and were produced by a now-retired mechanism (`drift_cron_auto`). Both left zero trace in `coach_intents`. This is a materially different, more useful finding than "the engine only ever reduces": it says the engine's *current* upward path is genuinely untested by real life, not merely reluctant.

**Adapt from it (runner-approved): live for VOLUME (`mark_upgrade`) since 2026-09-05, has never fired for David. DENSITY (`reshape`) is explicitly, currently blocked pending a named product decision — not an oversight.**

**The two biggest open items from the prior audit are now closed:**
1. **The "14 PROGRESS" mystery is solved.** It is not a production fact. It is the pinned expected-output of a synthetic replay test (`scripts/adaptation-real-replay/real-replay.test.ts:763`, `{PROGRESS:14, HOLD:64, REGRESS:4, REFUSE:38}`) — a counterfactual walk of David's real history through the *current* engine, never persisted anywhere real. Two other docs already warned against citing it as a production number; this pass is the first to actually locate and confirm the mechanism.
2. **The §9 render dispute (does Today fall back to a pace-less "not completed" lane for a run with sub-mile phases) is settled: it does not.** `sectionPieces` fires. The original diagnosis was accurate for pre-`154edbf97` code and has been stale since 2026-09-08 — confirmed by [TEST]-executing the real, unmodified `resolveWorkoutVerdict()`/`routePhases` construction against this run's real data and getting a 14-entry, fully-populated section list, plus a stale-comment audit of the exact Swift file that still describes the old (wrong) mechanism.

**One new P0-grade defect was found and independently confirmed twice this pass**, not present in the prior audit's list: **the recovery-honesty duration check (`recoveriesHonestOf`) is a silent no-op on any workout using the `strides_recovery_s` spec field instead of `rep_rest_s`** — 119 workouts system-wide, 57 of them David's own. This does not currently produce a wrong-looking screen (a correctly-run stride day still shows `'executed'`), but it means a **genuinely cheated recovery on any of those 57 workouts would also silently show `'executed'`**, with zero detection. This is a live, present-tense integrity gap in the exact mechanism (WALKBACK-1/2) the prior audit's own top P0 was about — the fix landed for the wrong failure mode.

---

## 2. NUMERIC/MECHANISM OWNERSHIP LEDGER — [INHERITED-REVALIDATED], corrections noted

Full detail lives in the original handback's §1 and §8 (preserved verbatim at `docs/audit-2026-09-09-historical-data-forensic-audit.md`). Re-derived this pass; corrections below are the only deltas — everything else in those sections stands as originally written.

| Claim | Original finding | This pass | Status |
|---|---|---|---|
| `SHADOW_EVIDENCE_EPOCH` pin mismatch | `79bc095d2f7ceb3b` pinned vs. `18f75b129d5d3ae8` actual | **Fixed same-day** by commit `52c5e8dd0`. Re-derived the SHA-256 independently: matches `18f75b129d5d3ae8`. | **[INHERITED-SUPERSEDED]** |
| `plan_decision_ledger` (Migration 166) live call sites | "10 confirmed live non-test importers" | **Corrected to 8.** Three of the original 10 were false positives: `steps.ts`/`ledger-entry.ts` only *mention* `recordDecision` in comments; `plan/reschedule.ts` defines its own unrelated, locally-scoped `recordDecision()` writing to `plan_reschedules` (a naming collision, not a call); `lineage.ts`/`admin/decision-ledger` call only read functions. | **[INHERITED-SUPERSEDED]** (count) |
| HR flatline guard (`hrTraceIsCredible`) caller count | Disputed 8 vs. 6 within the original audit | **Settled at 6**, exact file list re-confirmed twice independently this pass (Track R and Exhibit 1's builder, same six files). | **[INHERITED-REVALIDATED]** |
| Five adaptation-decision vocabularies | `PROGRESS/HOLD/REDUCE/RESTRUCTURE`, `STAY/PROGRESS/MODIFY/PROTECT`, `PROGRESS/HOLD/REGRESS/REFUSE`, `PROGRESS/HOLD/REDUCE`, 8-value ledger enum | **Unchanged**, verbatim, at every source location. None of the 26 post-pin commits touch any of the four files. | **[INHERITED-REVALIDATED]** |
| `RUNNER_AUTHORITY_TIERS` duplication | `vdot-inputs.ts` + `durability-anchor.ts`, byte-identical | **Unchanged.** | **[INHERITED-REVALIDATED]** |
| `AUTOMATIC_ADAPTATION_AUTHORITY` seam | `false`, ~30 call sites | **Confirmed, plus a real historical side door found and already closed**: `reanchor-plan.ts` bypassed the seam and rewrote 76 workouts unattended on 2026-09-02, closed 2026-09-05 (`REANCHORPROPOSES-1`) — matches project memory. `_mutation_boundary.test.ts` is a real source-scan gate with a small, named, argued exemption list. | **[INHERITED-REVALIDATED]**, with a historical side-door instance newly documented |

---

## 3. STATE-PREDICATE OWNERSHIP LEDGER — [NEWLY-INVESTIGATED]

*(Not independently re-falsified this pass beyond the builder's own self-checks below — flagged honestly as the one major newly-built exhibit that did not receive a second falsifier pass. Treat "ROUTED" verdicts here as one-pass-confirmed, not two-pass.)*

| Predicate | Canonical owner | Competing implementations | Verdict | Evidence |
|---|---|---|---|---|
| **canonical** | `CANONICAL_ROW_SQL`/`runNotMergedSql()` — same predicate, two export names | None | **ROUTED** | `[SRC]` |
| **sealed** | `lib/plan/seal.ts`'s `isDaySealed()`, routed through `day-resolver.ts` | **Historically three** (`seal.ts`, `adapt.ts`'s own `filterUnsealedWorkouts`, a third copy) — **closed 2026-09-04** (`SEALING-IDENTITY-1`), confirmed still closed | **ROUTED** (real defect, already fixed) | `[SRC]` |
| **completed** | Four legitimately separate, single-owned concepts (raw status, raw phase boolean, `sessionLadder` verdict, `ExecutionRead.state`) per `interpret.ts`'s own header | None — each single-owned | **OPEN by design**, not a violation; worth a reader-facing glossary | `[SRC]` |
| **supplemental** | `day-resolver.ts`: `ExecutionMatch = 'exact'\|'legacy_type'\|'supplemental'` | None | **ROUTED** | `[SRC]`, traced end-to-end in §5 |
| **race-week** | **Three, not two, granularities** — day-level `raceWindowFor()` (`Research/00b`/`08`), week-level `POST_RACE_RECOVERY_WEEKS`/`TAPER_WEEKS_BY_DISTANCE`, and a newly-found third, `recovery-phase.ts`'s "quality-ready" day tables, which self-cites CLAUDE.md's own DOCTRINE-6 note and deliberately reads as the more permissive of the two others | The third voice is self-aware (comments name the divergence explicitly) but still a third place answering one question | **OPEN, and now three-way, not two-way as CLAUDE.md's own text currently states** | `[SRC]` |
| **execution identity** | `day-resolver.ts`'s `richer()`/`pickRichest()` (read-time, cross-run tie-break) | A related-but-distinct function, `identity.ts`'s `pickCanonical()`/`richness()` (ingest-time, cross-submission dedup) — different question, different stage, naming-collision risk flagged, not a true duplicate | **ROUTED**, with a naming-collision note | `[SRC]` |
| **evidence-credible** | Layered, single-owner-per-layer (`classify-evidence.ts` composes, does not re-derive) | None — this file has an explicit anti-side-door header | **ROUTED in structure**; the known gap (flatline guard not reaching LTHR/readiness/max-HR/HR-zone) is confirmed still open — an *omission*, not a competing implementation | `[SRC]` |
| **eligible-to-adapt** | `adaptation-authority.ts`'s single boolean, type-narrowed to the literal `false` | None — PACE/DENSITY route through the same file's `sealAutomaticActions()` rather than re-checking independently | **ROUTED** | `[SRC]` |

**Net:** `day-resolver.ts` is the confirmed single owner behind four of these eight predicates — the "one owning service" shape the doctrine prescribes, genuinely realized here. The one real historical side door (**sealed**) is closed. The most consequential open item is **race-week**, now shown to be three voices, not two.

---

## 4. FOUR-LEVER ADAPTATION MATRIX — [NEWLY-INVESTIGATED] + [INDEPENDENTLY-REVIEWED]

| | Computation | Live call path | Persistence | Behavior-changing | Authority | Organic proof | Runner-facing | Undo/review | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| **PACE** | Real (`shadow-compare.ts`, `recompute-paces.ts`) | Yes — `run-adaptations` cron, every cycle | `adaptation_shadow_log` (156 rows, 8 PROGRESS — unchanged since the original pin despite 132 new rows) | **Re-anchor only** (to measured evidence, e.g. the 2026-08-31 LTHR re-anchor off a real race) — never a push past evidence | Auto for re-anchor; shadow-only, **never applied**, for the PROGRESS proposals — explicitly withheld per `docs/PRODUCT_DECISIONS.md` 2026-09-01 | **Real**: 8 genuine PROGRESS rows with real magnitude text, 2026-08-31 to 09-03, never left shadow mode | None confirmed | None confirmed | Shadow-to-live wiring is an explicit, argued withholding, not a bug |
| **VOLUME** | Real, two generations (retired `drift-monitor.ts`; live `adaptive-ramp.ts`/`mark_upgrade`) | Yes, both generations reachable via cron (old one historically, before 2026-09-02) | `plan_mutations` (2 applied, real), `plan_proposals` (34 rows) | **Yes, twice, historically** — 2026-06-02 auto-rebuild, 20.1→35.7 mi/wk (77%) | Old generation: fully automatic, pre-dates the current seam. New (`mark_upgrade`): runner-approved only, by explicit design | **Real** (06-02 event), **[INDEPENDENTLY-REVIEWED]**, CONFIRMED exact | None confirmed for the historical event; `mark_upgrade` has never fired | Zero `coach_intents` trace for the 06-02 event |
| **DURATION** | **Real, and materially more built than the prior doctrine doc implies** — `composeAdaptation`'s `target:'DURATION'` arm is genuine, falsification-tested, non-decorative | **Reached daily in production**, but only via the PACE-only shadow-compare's read-for-context path — **[INDEPENDENTLY-REVIEWED] correction**: DURATION and VOLUME/DENSITY are "read for context but never persisted... out of tonight's authorization" per `shadow-compare.ts`'s own header. It executes; it does not act. | Shadow half in `canonical_adaptation_shadow_log` (lever `LONG_RUN`: 11 HOLD, 1 REFUSE, 0 PROGRESS) | **Yes, once, historically, newly found this pass** — 2026-08-25, `plan_proposals id=54`, `long_drift`, auto-applied, 64.3% jump (7→11.5 mi median), `target_weekly_mi` 17→41 | Old generation: fully automatic, pre-dates the seam (same posture as VOLUME's 06-02 event, 8 weeks later) | **Real**, **[INDEPENDENTLY-REVIEWED], CONFIRMED exact** including the retirement route's own comment naming this exact incident as part of why the mechanism was retired | None confirmed | Zero `coach_intents` trace, same gap as VOLUME |
| **DENSITY** | Real (`progression-pass.ts`'s TAKE/ACCELERATE/HOLD/BACK_OFF) | Reachable via the runner-accept path (`brain/proposal/accept.ts`) | `plan_workouts.workout_spec`, on accept | None confirmed, ever | Runner-approved only — **explicitly excluded from the automatic seam by name**, citing the owner's 2026-09-02 ruling verbatim in code | **None found**, in either shadow logs or 34 live proposals | None confirmed | None confirmed | **Explicitly blocked pending a named product decision — current, not stale** |

**Net correction to the doctrine document.** `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`'s literal text (independently re-quoted this pass) is a **whole-engine** claim — *"Not yet built — depends on the Evidence Engine... Build this next, once that lands"* — not a DURATION-specific one as CLAUDE.md's summary paraphrases it. Its stated blocker (`classifyRecentActivities`, the per-activity Evidence Engine classification) **has since landed** (`load-activity-evidence.ts:406`, imported by the adaptation engine). So the doctrine's gating premise is satisfied, but the engine it gates remains shadow-only for DURATION/VOLUME/DENSITY. **This is the single most important correction this pass makes to standing project doctrine**: CLAUDE.md should be updated to say "DURATION's compute layer is built and its stated blocker has landed; what remains withheld is the live-application step, same as the other two non-PACE levers" — not "not yet built."

**Net picture, all four levers:** every lever has real, falsification-tested compute. Every organic upward event found (VOLUME 06-02, DURATION 08-25) predates the current authority seam and belongs to a now-retired mechanism. **No lever has ever been organically tested under the architecture that is actually live today.**

---

## 5. REAL-RUN LINEAGE TRACES

Four cases carried forward unchanged from the original audit (treadmill/HR-flatline, race/AFC chip-vs-watch, recovery-strides/today's run, dedup/absorbed) — see handback §2, §4, §9. One new case:

### Supplemental run — 2026-08-01 — [NEWLY-INVESTIGATED], [INDEPENDENTLY-REVIEWED: CONFIRMED WITH CORRECTION]

Three unscheduled `apple_watch` runs (0.84/1.34/1.98 mi) against a day the **actually-active** plan (`pln_ca91f252bba50c74`, live 06-03 through 08-17) prescribed `rest`. `[PROD-RO]`, confirmed twice.

**Answer to the product question:** a supplemental run is **not** excluded or down-weighted. `volume-evidence/classify.ts` credits it as `SUPPLEMENTAL_RUN`, `countsAsVolumeEvidence:true`, full mileage — *"Every mile is new"* per the file's own comment. It feeds the identical VOLUME evidence pipeline that produced the 2026-06-02 auto-rebuild. It does **not** retroactively seal the day's own `rest` prescription.

**Correction from the falsifier pass:** the original claim that `adaptive-ramp.ts` *consumes* this pipeline is backwards. `adaptive-ramp.ts` is upstream — `volume-evidence-proposal.ts` and `volume-evidence-loader.ts` both *import from* `adaptive-ramp.ts` (`distributeWeeklyBump`, `readLoadContractStamp`), not the reverse. `adaptive-ramp.ts`'s own ramp-signal detectors sum prescribed plan volume, not runner-actual mileage. The `run-adaptations` cron's own direct import of `volume-evidence-proposal.ts` is confirmed correct.

---

## 6. THE "14 PROGRESS" RECONCILIATION — SOLVED THIS PASS

| Source | Rows | PROGRESS | Nature |
|---|---|---|---|
| `adaptation_shadow_log` | 156 (grew from 24; PROGRESS count unchanged) | **8** | Real, `[PROD-RO]` |
| `canonical_adaptation_shadow_log` | 117 (grew from 36) | **0** | Real, `[PROD-RO]` |
| `coach_intents` | 321 | **0** upward-shaped | Real, `[PROD-RO]` |
| `real-replay.test.ts:763` | N/A — a test's pinned expected-output object | **14** | **This is the source of the "14" figure.** A synthetic counterfactual replay of David's real history through the *current, non-persisted* engine across 13 decision boundaries. `docs/reports/core-closure-2026-09-04/ADAPTATION-VERDICT.md` and a separate 2026-09-08 status doc both already flag this exact confusion risk in writing (*"IS NOT WHAT IT SOUNDS LIKE"*). Not a production log, not a shadow log, not `coach_intents`. |

**Verdict:** the "14" is real, locatable, and explained — it was never a fourth production count and should never again be cited alongside the shadow-log numbers as if it were.

---

## 7. CURRENT-VS-RETIRED MECHANISM MAP

| Mechanism | Status | Evidence |
|---|---|---|
| `drift_cron_auto` (`volume_drift`) | **RETIRED**, detect-only since 2026-09-02 | `[SRC, re-confirmed]` |
| `drift_cron_auto` (`long_drift`) | **RETIRED**, detect-only since 2026-09-02 — **and the retirement's own code comment names the 08-25 `long_drift` event itself as a direct cause** ("long_drift on the 25th bumped his easy-day target 4→7 as a side effect... easy_drift reacted to THAT number the next night") | `[SRC]`, newly surfaced this pass |
| `reanchor-plan.ts` authority side door | **CLOSED 2026-09-05** (`REANCHORPROPOSES-1`) | `[SRC, re-confirmed]` |
| Triple `sealed` ownership | **CLOSED 2026-09-04** (`SEALING-IDENTITY-1`) | `[SRC, re-confirmed]` |
| `SHADOW_EVIDENCE_EPOCH` mismatch | **CLOSED same-day** (`52c5e8dd0`) | `[SRC, re-confirmed]` |
| WALKBACK-1/2 (`recoveryEndedEarly`) | **LIVE**, merged, correctly implemented for the case it targets — but does not retroactively rescue historical rows missing the field, and is **not the reason** today's run shows `'executed'` (see §8/§9) | `[SRC]`+`[TEST]` |
| `mark_upgrade` (VOLUME, runner-approved) | **LIVE** since 2026-09-05, never fired | `[PROD-RO]` |
| `composeAdaptation` DURATION arm | **LIVE, executes daily, shadow-only** — no persisted proposal, no card | `[SRC]`+`[INDEPENDENTLY-REVIEWED]` |
| `reshape` (DENSITY) | **Explicitly, currently BLOCKED** pending a named product decision | `[SRC]` |

---

## 8. THE NEW P0 — recovery-honesty check silently defeated on stride-day workouts

**[NEWLY-INVESTIGATED], [INDEPENDENTLY-REVIEWED: CONFIRMED, twice, including by directly executing the real production function]**

`recoveriesHonestOf()` (`execution-semantics.ts:719-736`) only evaluates a recovery's duration tolerance for recoveries where `prescribedSec != null`. `resolveWorkoutVerdict()` (`verdict.ts:557-570`) resolves `prescribedSec` by reading `spec.rep_rest_s` only. Stride-bolt-on workouts (easy/long days with strides attached) use a *different* spec field, `strides_recovery_s`, which is never read here — confirmed as a genuine, clean field-name split: **zero** `plan_workouts` rows carry both fields; **119** system-wide carry `strides_recovery_s` with no `rep_rest_s` (**57 of them David's own**). For all such workouts, `prescribedSec` resolves to `null` for every recovery, `known.length === 0`, and the function returns `null` ("no signal") rather than evaluating tolerance at all. `sessionLadder`'s gate (`recoveriesHonest !== false`) treats `null` as passing.

**Effect on today's run specifically:** verdict is `'executed'` — correctly, since this was an honestly-run session — but for the wrong reason. The check never ran. **A genuinely cheated recovery on any of the 57 affected workouts would produce the identical `'executed'` output, with zero detection.** WALKBACK-1/2 (which the prior audit's own top finding was about) is unrelated to this outcome — it isn't even wired into the Today route's call to `resolveWorkoutVerdict()`.

**Confirmed by two independent means:** (1) source trace across `execution-semantics.ts` + `verdict.ts` + the real `workout_spec` JSON; (2) [TEST] execution of the verbatim, unmodified `resolveWorkoutVerdict()` against this run's real data by two separate sessions, both producing `recoveriesHonest: null, verdict: "executed"`.

**Minimal fix, identified by the falsifier:** `verdict.ts:560-561` should read `spec.strides_recovery_s` as a fallback alongside `spec.rep_rest_s`, and `WorkoutSpecEasy` (currently untyped for this field despite the builder writing it) should declare it. Single function, single type addition.

---

## 9. CONTRADICTIONS SURFACED AND RESOLVED THIS PASS

1. **Track R (source-only) vs. Track V (executed the real code) on today's run's verdict** — resolved in favor of Track V, independently confirmed by a third pass. Track R's error: it assumed `prescribedSec` resolves to 60s for all six recoveries and reasoned about tolerance bands the code never actually reaches.
2. **Original handback §9's Domain-D-vs-its-own-reviewer dispute** — resolved: `sectionPieces` fires, the fallback-lane diagnosis was stale (pre-`154edbf97`), confirmed by [TEST] execution plus a stale-comment audit of the exact Swift file.
3. **CLAUDE.md's paraphrase of `ADAPTATION_PROGRESSION_DOCTRINE.md`** ("DURATION not yet built") vs. the doctrine's actual text (a whole-engine claim whose cited blocker has since landed) — clarified, not a contradiction between sources so much as an imprecise summary that should be corrected going forward.
4. **`adaptive-ramp.ts` import direction** — the newly-built exhibit had it backwards; corrected to: volume-evidence modules import *from* `adaptive-ramp.ts`, not the reverse.

No contradictions were found on any raw production-data fact (counts, IDs, timestamps) — every quantitative claim independently re-queried this pass matched byte-for-byte with its originating track.

---

## 10. SEVERITY-RANKED DEFECTS (P0–P4), UPDATED

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | **Recovery-honesty check silently no-ops on 57 of David's stride-day workouts** (§8) | **P0 — new this pass** | OPEN. Fix is small and identified. |
| 2 | `coach_intents` (Rule 21's evidence base) does not record either known automatic upward rebuild — now confirmed as **two** instances (06-02 volume, 08-25 duration), not one | **P0** | OPEN, pattern confirmed, not a one-off |
| 3 | HR flatline guard confirmed still not reaching LTHR/max-HR/HR-zone/readiness | **P0** | OPEN, unchanged |
| 4 | Today's run §9 fallback-lane dispute | ~~P0~~ | **CLOSED** — resolved, non-issue, stale diagnosis |
| 5 | `SHADOW_EVIDENCE_EPOCH` mismatch | ~~P1~~ | **CLOSED**, same-day fix |
| 6 | Five non-matching adaptation vocabularies | **P1** | OPEN, unchanged |
| 7 | `pausedSec`/`droppedGapSec` false-invariant comments (inherited, not re-verified this pass — carry forward as-is) | **P1** | Carried forward unchanged |
| 8 | `ADAPTATION_PROGRESSION_DOCTRINE.md`/CLAUDE.md's stale "DURATION not yet built" framing | **P1 — new this pass** | OPEN — a documentation correction, but risks misdirected future engineering effort |
| 9 | `plan_decision_ledger` (Migration 166) built, unused, table absent | **P2** | OPEN, call-site count corrected 10→8 |
| 10 | `recommendation.ts` orphaned state machine | **P2** | OPEN, unchanged |
| 11 | `RUNNER_AUTHORITY_TIERS` duplication | **P4** | OPEN, unchanged |
| 12 | Race-week granularity divergence | **P4→ re-scoped** | Now confirmed **three-way**, not two-way |
| 13 | Races enumeration / PR-screen completeness (Rose Bowl Half) | **P1 if UI omits it** | Still `[BLOCKED: not rendered]` — this pass did not attempt it |
| 14 | Proposal-13 bundled reprice card correctness | **P1 candidate** | Still `[BLOCKED: not rendered]` |

---

## 11. TESTFLIGHT BLOCKERS — consolidated

- **None of this pass's findings block internal TestFlight on a "runner sees wrong information" basis.** The new P0 (§8) is a silent *false-negative* on cheating detection — it does not cause any incorrect-looking screen for honest training, which is the overwhelming majority case.
- Two items from the prior audit remain genuinely `[BLOCKED: no render]` and should gate before further engineering scope, not before shipping: the Rose Bowl Half PR-screen check, and the proposal-13 reprice-card wording check.
- The §9 dispute, previously the prior audit's top TestFlight-blocking item, is **no longer a blocker** — resolved clean.

---

## 12. RECOMMENDED IMPLEMENTATION ORDER

1. **Fix the recovery-honesty field-name gap** (§8) — smallest, most consequential, single function + one type addition.
2. Decide and execute on `coach_intents`'s two known missing historical records (repair vs. accept-and-move-on) — **needs David's decision, §13.1**.
3. Correct `ADAPTATION_PROGRESSION_DOCTRINE.md`/CLAUDE.md's DURATION framing.
4. Consolidate the five adaptation-decision vocabularies onto one canonical enum.
5. Decide Migration 166's fate (apply vs. abandon) — **needs David's decision, §13.2**.
6. Wire the HR flatline guard into LTHR/max-HR/HR-zone/readiness, or argue an explicit, doctrine-cited exemption.
7. Consolidate `RUNNER_AUTHORITY_TIERS` into one export.
8. Render-check the Rose Bowl Half PR screen and the proposal-13 card wording (both need a device/execution render, not source review).
9. Resolve the three-way race-week granularity divergence — **needs David's decision on which definition governs, §13.3**.

---

## 13. EXPLICIT QUESTIONS REQUIRING DAVID'S PRODUCT DECISION

1. **Should `coach_intents` be retroactively repaired** to record the 2026-06-02 volume and 2026-08-25 duration auto-apply events? Or leave the historical gap as-is and only require a decision-ledger write for any *future* auto-apply? (This would be a historical-data write — needs explicit per-statement approval regardless of which way it's decided.)
2. **Apply Migration 166** (`plan_decision_ledger`) in production? The write path is built and ready at 8 confirmed live call sites — this is a DDL action per CLAUDE.md's standing rule, requiring explicit per-statement go.
3. **`mark_upgrade`'s trigger has never fired for David** — is the bar too high, or has his training genuinely never earned it? Worth a targeted look at what the trigger actually requires versus his real history.
4. **DENSITY's `reshape` runner-accept path is explicitly held** pending your decision, per the code's own comment citing your 2026-09-02 ruling — ready to unblock whenever you want it revisited.
5. **Which of the five adaptation-decision vocabularies should become canonical?** This report recommends the doctrine's own `PROGRESS/HOLD/REDUCE/RESTRUCTURE` as the target, migrating the other four — but that's a recommendation, not a decision made on your behalf.
6. **Race-week is now confirmed three-way** (day-granular research citations, week-granular plan-engine tables, and `recovery-phase.ts`'s own third voice). Which should govern, and should the other two be collapsed into it?

---

## 14. TRANSFER SECTION

**For whoever picks this up next:** this branch (`audit/brain-forensic-2026-09-10`) holds, in order: the original 8-session handback + 4 domain reports exactly as found (commit `5b41b0d99`), and this final consolidation on top. Nothing here has been merged to `main` and nothing should be, without your review. The single highest-value next action is the §8 fix (small, isolated, closes a real detection gap). The single highest-value next *decision* is §13.1 (the `coach_intents` historical-gap question), because it's the one place a real, twice-confirmed pattern (not a one-off) is sitting unresolved in the app's own primary audit trail.

**A caveat on this report's own coverage:** the state-predicate ledger (§3) is the one newly-built exhibit that did not receive an independent second-pass falsification this session, unlike the four-lever matrix and the supplemental-run trace, both of which did. Treat its "ROUTED" verdicts as one-pass-confirmed. Everything tagged `[INDEPENDENTLY-REVIEWED]` above received a genuine second, separate derivation.

*End of report. No writes of any kind were performed by this pass beyond this document and the earlier checkpoint commit of pre-existing, unmodified prior work.*
