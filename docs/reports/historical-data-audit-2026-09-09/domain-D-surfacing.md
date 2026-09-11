# Independent Review — Agent D Pass 2 (Runner-Facing Surfacing and Usability)

**Reviewer methodology:** Re-ran every DB claim I could reach against `DATABASE_URL_RO` (fresh queries, not copies of Agent D's SQL), re-pulled every cited source file via `git show 855924549:<path>` (never the working tree), traced the actual server→wire→client data flow for the domain's central claim rather than trusting header comments, and checked commit ancestry for every "unmerged branch" claim. I did **not** build or render the app in the simulator (time budget; flagged explicitly below as the one thing that would settle the central disagreement definitively — this is itself a Rule 13 gap in my own review, and I say so rather than papering over it).

---

## 1. My verdict, per material claim

| # | Claim | My verdict | Evidence |
|---|---|---|---|
| 1 | Today's run: 14 phases, id `-218380344929823`, 5.58mi/2947s/easy/`wko_d19936ca5659c63b`, 5 of 6 walk-backs cut short (0:30/0:43/0:24/0:38/0:08 vs. one 0:61 completed) | **CONFIRMED-BY-ME** | `[PROD-QUERY]` fresh `jsonb_array_elements` walk over `runs.data.phases` for id `-218380344929823`: 14 phases, exact durations 30/43/61(completed=true)/24/38/8 on the 6 recovery rows, all 6 strides `completed:true`. Also confirmed the two duplicate rows (`20109710013` strava_webhook, `-2351291349937081` apple_watch) are both marked `absorbed_into_canonical_at`, leaving `-218380344929823` the sole canonical row — checked **raw**, no absorption filter applied, per Rule 14 |
| 2 | `RunDetailV5.swift`: "A RECOVERY JOG IS NEVER GRADED" comment, line 877, unfixed on `main` | **CONFIRMED-BY-ME** | `[SOURCE]` `git show 855924549:native-v2/Faff/Faff/ViewsV5/RunDetailV5.swift` — comment verbatim at line 877; `verdictPhrase` delegates to the shared `phaseVerdictPhrase()` (`RepBreakdownV5.swift:202`), which does `guard type == "work" else { return nil }` (line 216) unless `paceShape == "ceiling"` |
| 3 | `target_duration_sec` null on every recovery phase row | **CONFIRMED-BY-ME** (Agent D marked this `NOT_RE_TESTED`) | `[PROD-QUERY]`: dumped all 6 recovery phases' raw JSON minus `hrSamples` — no `targetDurationSec` key present on any of them, only `targetPaceSPerMi`. `[SOURCE]` `verdict.ts:440`: `targetDurationSec: num(p.targetDurationSec)` reads that same absent raw key, so the server-side `GradedPhase.targetDurationSec` is also null for these rows |
| 4 | No symmetric field to `recovery_extensions` for under-recovery on `main`; exists unmerged on `feat/recovery-ended-early-record` (`e80524809`) | **CONFIRMED-BY-ME** | `[SOURCE]` `git grep -n "RecoveryEndedEarlyRecord" 855924549` → zero hits on `main`. `git merge-base --is-ancestor e80524809 855924549` → not an ancestor (unmerged, confirmed) |
| 5 | **THE CENTRAL CLAIM**: `TodayAfterV5.swift`'s `sectionPieces.isEmpty ? workoutPhasePieces : sectionPieces` routes today's run into the pace-less, false-"not completed" fallback lane **because `routePhases` is keyed by whole GPS miles and cannot represent sub-mile strides/walk-backs** | **COULD-NOT-REPRODUCE the stated mechanism** — see full writeup in §2 below. The literal line (`TodayAfterV5.swift:1578`) and header comments are quoted correctly, but the *mechanism* the report (and the handback, and WALKBACK-1's own code comment) attributes to that line is not what the server-side code at the pinned commit actually does | `[SOURCE]`, traced in full: `web-v2/app/api/v5/today/route.ts:1790` builds `routePhases` as `grade.phases.flatMap(...)`, one entry **per phase** (not per GPS mile), filtered only on `mi>0 && sec>0`. `[PROD-QUERY]`: all 14 of today's phases — including every sub-mile walk-back (0.03–0.06mi) and stride — have positive `actualDistanceMi`/`actualDurationSec`. The commit that made `routePhases` phase-keyed (`154edbf97`, "seven post-run defects on the owner's 2026-09-08 tempo") is **already an ancestor of the pinned commit**, landed before today's run |
| 6 | `postRun` narrative object served identically to Today and history via one `postRunWire()` | **CONFIRMED-BY-ME** (narrow claim only) | `[SOURCE]`: single call site `loadPostRunExperience` → `postRunWire(x)` in `today/route.ts`, matches Agent D's framing. I did not independently verify the `/api/runs/[id]` side calls the same function (not re-checked — **NOT_RE_TESTED** on my part for that half) |
| 7 | Six past races, all `actual_result IS NOT NULL`, provisional false/absent | **PARTIALLY CONTRADICTED-BY-ME** — see §2 | `[PROD-QUERY]`: **there are 6 races with results**, but the report enumerates only 5 (`americas-finest-city`, `sombrero-half`, `big-sur-marathon`, `la-marathon-2026`, `disney-half-2026`). It silently omits `rose-bowl-half-2026` (2026-01-18, finishS 5918 = 1:38:38), which is real, in `races`, `actual_result` populated, same user_uuid. The COUNT ("six") is right; the ENUMERATION is wrong, and nobody — Pass 1, Pass 2, or the handback — appears to have actually looked at all 6 rows |
| 8 | Proposal 13 was an **active decline** by David (traced to `dismissProposal()`'s single caller, the phone's "Keep Original" button), not an automatic lapse | **CONFIRMED-BY-ME** on provenance; **CONTRADICTED-BY-ME** on the pace-direction characterization | `[PROD-QUERY]` on `plan_workout_proposals` id 13: `status='dismissed'`, `source='cron_reanchor'`, resolved 5.76h (5h46m) after creation — matches. **But** the report's Part D prose says the bundle moved "threshold slower by 2s/mi, both interval anchors faster, **both easy ceilings slower**, **marathon pace faster**." The actual `action_payload.reprice.anchorMoves` I pulled shows: threshold 430→432 (slower, ✓), interval 401→400 and repetition 365→364 (faster, ✓), **easy_ceiling 502→492 and shakeout_ceiling 532→522 (FASTER, not slower — lower sec/mi is a faster pace)**, **marathon 472→475 (SLOWER, not faster)**. Two of the four remaining anchor-direction claims are reversed |
| 9 | Two distinct PROGRESS-shaped objects: `BRAIN_CONSTITUTION.md`/`ADAPTATION_PROGRESSION_DOCTRINE.md`'s state machine ("Not yet built") vs. `recommendation.ts`'s `STAY/PROGRESS/MODIFY/PROTECT` (built, orphaned) | **CONFIRMED-BY-ME**, both halves | `[SOURCE]`: `docs/ADAPTATION_PROGRESSION_DOCTRINE.md:5` — "Not yet built — depends on the Evidence Engine..." verbatim. `recommendation.ts:202` — the literal union type exists. I additionally checked orphan status myself (Agent D did not cite this check): only one importer of `recommendation.ts` exists app-wide (`web-v2/app/api/coach/read/route.ts`), and **zero** references to `/api/coach/read` exist anywhere in `native-v2` or `web-v2/components` — genuinely unconsumed by any client surface, confirming "orphaned" rather than merely "under-adopted" |
| 10 | `coach_intents`: 321 total rows, zero upward `plan_adapt_*` reasons, distribution matches Pass 1 exactly (5/5/3/3/2/1/1/1) | **CONFIRMED-BY-ME, exactly** | `[PROD-QUERY]`, fresh `GROUP BY reason`: total 321; `plan_adapt_downgrade` 5, `plan_adapt_long_floor` 5, `plan_adapt_reschedule` 3, `plan_adapt_missed_noted` 3, `plan_adapt_overridden` 2, `plan_adapt_drop_missed` 1, `plan_adapt_gap` 1, `vdot_auto_recalc` 1. Zero of the 22 distinct reasons is an upward pace/volume push. Matches the report digit-for-digit |
| 11 | WALKBACK-1 (`7b0163c85`) and WALKBACK-2 (`e80524809`) both unmerged as of pinned commit | **CONFIRMED-BY-ME** | `git merge-base --is-ancestor 7b0163c85 855924549` → false; same for `e80524809` → false |
| 12 | `fix/goal-projection-recovery-ended-early` (`b7eb82c2e`) threads `recoveryEndedEarly` into `goal-projection.ts` | **CONFIRMED-BY-ME** | `git log` on that branch shows `b7eb82c2e "fix(goal-projection): thread recoveryEndedEarly through the historical test-point judge"`; diff touches exactly `web-v2/lib/training/goal-projection.ts` (+20/-1) |
| 13 | `recordRepSkip()` no-ops for anything but a work phase (5 of 7 required walk-back states still unbuilt) | **CONFIRMED-BY-ME** | `[SOURCE]`: found the live function only by resolving `native-v2/Faff/FaffWatch Watch App` — a **symlink** to `legacy/native/Faff/FaffWatch Watch App` (not dead code, the actual live watch target). `recordRepSkip()` at line 2449: `guard state == .running, !planComplete, let p = currentPhase, p.type == .work else { return }` — hard-gated to work phases only, exactly as claimed. Worth noting for future audits: this file's physical location under `legacy/native/` reads as dead-code territory until you resolve the symlink — a trap the report didn't fall into but that's worth flagging explicitly for whoever audits Domain-C/watch next |
| 14 | Handback row 105 / §2b: missing-pace root cause "identified... not yet fixed" | **DOWNGRADED to UNKNOWN / likely stale**, not confirmable as stated | `[SOURCE]`+`[INFERENCE]`: the handback's own text (line 105) says this diagnosis came from "a design-review agent in the prior session, not yet re-verified against today's specific screenshot." My independent trace of the current server-side `routePhases` construction (claim 5 above) does not support the stated mechanism. This looks like a stale claim that propagated through three documents (a prior investigation → the handback → Agent D Pass 2) without anyone re-deriving it against the code that's actually on `main` today |
| 15 | Doctrine review scope: `BRAIN_CONSTITUTION.md` Adaptation Engine section + `ADAPTATION_PROGRESSION_DOCTRINE.md` read in full for this pass | **UNTESTABLE** — I cannot verify what Agent D read | — |
| 16-21 | Decision History screen real/40 rows, shoe mileage recompute consistency, Health/Readiness outage disclosure honesty, Block/Paces/Watch blocked, memory items #19/#20 (canonical-run dataloss, Pause/End dead-end) out of domain scope | **NOT_RE_TESTED by me** (time budget — spot-checked shoe id 7's DB mileage=23.09, matches; did not chase the 74.7mi live-recompute claim) | `[PROD-QUERY]` partial (shoes only) |

---

## 2. The two findings that materially change the report

### 2a. The central §3 finding does not survive independent source tracing

Agent D's Pass 2 report calls this "the most important reconciliation finding in this domain," elevates its priority above everything the handback and Pass 1 separately found, and states as settled fact that today's run "cannot be decomposed into whole-GPS-mile pieces for the sub-mile segments, so `sectionPieces`... comes up empty... and the `.isEmpty` check above silently routes the entire Today-tab breakdown into the pace-less, unlabeled-completion-flag-respecting fallback lane."

I traced the actual data path server-side, at the pinned commit, against today's actual run:

1. `web-v2/app/api/v5/today/route.ts:1790` builds the wire's `routePhases` array like this:
   ```ts
   routePhases: indoor
     ? []
     : grade.phases.flatMap((gp, gi) => {
         const mi = gp.actualDistanceMi ?? 0;
         const sec = gp.actualDurationSec ?? 0;
         return mi > 0 && sec > 0 ? [{ mi, sec: Math.round(sec), type: ..., ... }] : [];
       }),
   ```
   This is **one entry per phase** in `grade.phases` (the graded completion array, one row per raw stored phase — 14 for today's run), filtered only on positive distance/duration. It is not built from GPS mile-boundary splits at all.

2. `grade.phases` comes from `resolveWorkoutVerdict()` → `gradeStoredPhases()` → `runPhases()` (`run-shape.ts`), which maps every raw stored phase 1:1 into a `NormalizedPhase`, reading `actualDistanceMi`/`actualDurationSec` straight off the raw element via `pos()` (positive-number parse). Nothing here operates on GPS mile splits or requires a phase to span a whole mile.

3. `[PROD-QUERY]`, today's actual 14 phases, `actualDistanceMi`/`actualDurationSec`:
   ```
   idx  type      mi    sec
   0    work      5.01  2607
   1    work      0.05  20
   2    recovery  0.04  30
   3    work      0.05  22
   4    recovery  0.05  43
   5    work      0.05  21
   6    recovery  0.06  61
   7    work      0.05  20
   8    recovery  0.03  24
   9    work      0.05  22
   10   recovery  0.06  38
   11   work      0.05  21
   12   recovery  0.03  8
   13   overtime  0.01  10
   ```
   Every single one has `mi>0 && sec>0` — including the 0.03mi/8sec walk-back, the smallest phase in the run. So `routePhases` should carry **all 14 entries**, and the Swift side's `sectionPieces` (`let usable = model.routePhases.filter { $0.mi > 0 && $0.sec > 0 }; guard usable.count > 1 else { return [] }`) should have `usable.count == 14`, not 0. `breakdownPieces` (`sectionPieces.isEmpty ? workoutPhasePieces : sectionPieces`) should therefore select `sectionPieces`, **not** the treadmill fallback.

4. In `sectionPieces`, `verdictPhrase` is computed by `phaseVerdictPhrase()` — the exact same shared function `RunDetailV5` uses (its own header comment, "PARITY-1, 2026-09-04," says so explicitly: *"Two wire types, one function, so the same graded phase reads the same word on both screens by construction"*). For a `recovery`-type phase this returns `nil` — the same honest silence `RunDetailV5` shows, never `"not completed"`. The `"not completed"` string exists **only** inside `workoutPhasePieces` (the fallback lane), which by the above should not fire for this run.

5. The commit that made `routePhases` phase-keyed and pace-carrying — `154edbf97 fix(today-after): seven post-run defects on the owner's 2026-09-08 tempo` — **is already an ancestor of the pinned commit** (`git merge-base --is-ancestor 154edbf97 855924549` → true), and it landed the day before today's run.

**What this means:** either (a) the routing defect the handback and Agent D both treat as live and unfixed was actually resolved as an incidental side effect of unrelated PARITY-1/PHASE-GRAIN-1/COMPLETION-STATE-1 work between 2026-09-04 and 2026-09-08, and the diagnosis everyone is citing is stale; or (b) there is a different, real mechanism still producing the defect that neither I, nor the original "design-review agent," nor the handback, nor Agent D actually located in source. I lean toward (a), for three reasons: my trace is complete end-to-end against the exact pinned commit and exact run; the handback's own text explicitly flags this diagnosis as "identified by a design-review agent in the prior session, not yet re-verified against today's specific screenshot"; and WALKBACK-1's own new code comment repeats the identical "keyed by GPS mile" framing verbatim, suggesting it was copied forward from the same earlier diagnosis rather than independently re-derived against current `today/route.ts`.

I want to be precise about what I have **not** done: I have not rendered the actual Today screen against David's actual account (no simulator build in this pass — a real gap in my own review by this codebase's own Rule 13, which I'm naming rather than hiding). The physical-device evidence the handback cites (David's own words, matching this exact run) is real and I cannot dismiss it — the most likely reconciling account is that his installed TestFlight build lags `main` (the handback itself says TestFlight staleness was "UNKNOWN — not queried this pass," and a prior report cited "44 commits behind" as of 2026-09-08), so his phone may have been running the pre-`154edbf97` client and/or server behavior when he took that screenshot, even though current `main` source no longer has the mechanism as described. **This is exactly Rule 19 territory** ("green is not deployed") and nobody in this chain — including Agent D's Pass 2, whose whole methodology this pass was source-diffing — checked it.

**My recommendation, sharper than Agent D's Part E item 3:** before scoping any further engineering work on `sectionPieces`/`workoutPhasePieces`, actually render today's run on the current `main` (build + install + `-faffRunDetail`-style harness against user_uuid `<RUNNER_UUID_REDACTED>`'s real Today payload) and check whether the defect still reproduces. If it doesn't, the entire §3/Part D/Part E-item-3 apparatus in the Pass 2 report is describing an already-fixed bug and should be closed rather than escalated. If it does reproduce, the mechanism is not what any of the three documents (investigation → handback → Pass 2) currently say it is, and needs fresh source tracing starting from an actual failing render — not from repeating a comment.

### 2b. The races enumeration undercounts

`[PROD-QUERY]`, fresh, against `races.slug`/`races.meta`/`races.actual_result` (correcting Agent D's own query, which read `meta->>'slug'` — that key doesn't exist; `slug` is a top-level column, so their query may actually have silently returned blank slugs too, though their reported finish-second values are correct for the 5 races they did enumerate):

| slug | date | name | has result | finishS |
|---|---|---|---|---|
| rose-bowl-half-2026 | 2026-01-18 | Rose Bowl Half | **true** | **5918 (1:38:38)** |
| disney-half-2026 | 2026-02-01 | Disney Half Marathon | true | 5694 |
| la-marathon-2026 | 2026-03-08 | LA Marathon | true | 12700 |
| big-sur-marathon | 2026-04-26 | Big Sur Marathon | true | 13015 |
| sombrero-half | 2026-05-03 | Sombrero Half Marathon | true | 6057 |
| americas-finest-city | 2026-08-16 | Americas Finest City | true | 6113 |

Six rows with results, matching the report's claimed count of "six." But the report's own enumeration in Part C row 7 and Part B §9 lists only five converted times (1:41:53 / 1:40:57 / 3:36:55 / 3:31:40 / 1:34:54), omitting Rose Bowl Half entirely. This is a genuine miss, not a matter of interpretation — the sixth race is real production data for this account, and "confirmed six races" followed by a five-item list is an internal inconsistency the report doesn't notice about itself. It doesn't change the mechanism-level conclusion (all races with results are unprovisional except the one explicit `false`), but it means the claim "re-queried live this pass with fresh SQL, same conclusion" wasn't actually a complete re-derivation — it silently dropped a row and reported the drop as a clean confirmation.

---

## 3. Explicit disagreements (not papered over)

1. **Central §3 finding, severity/status.** Agent D calls the `sectionPieces`/`workoutPhasePieces` routing bug live, unfixed, and the highest-priority open item in the domain. I found the actual TypeScript construction of `routePhases` to be phase-keyed (not GPS-mile-keyed) and, applied to today's real 14-phase run, should not trigger the fallback lane at all — the fix commit that made it phase-keyed already landed on `main` before today's run and before the pinned commit. I could not reproduce the claimed mechanism from source. This is a genuine disagreement, not a nuance — it changes whether the report's top recommendation (Part E item 3, "needs a fix that goes deeper than WALKBACK-1's label suppression") is pointed at a live defect or a phantom one.

2. **Proposal 13's anchor-direction characterization.** Agent D's Part D prose states "both easy ceilings slower" and "marathon pace faster." The actual `action_payload` shows the opposite for both: easy/shakeout ceilings moved **faster** (502→492, 532→522 sec/mi) and marathon pace moved **slower** (472→475 sec/mi). This doesn't overturn the report's larger point (this was still a coordinated multi-anchor reprice that David declined), but the specific characterization of what he declined is backwards on two of four sub-claims, which matters for the follow-up product question the report itself poses ("was the bundled 5-anchor reprice too much to decide on at once?") — you can't reason about whether a bundle was hard to evaluate if you've mischaracterized what was in it.

3. **Races enumeration.** "Six races confirmed, re-queried live" paired with a five-item list that omits Rose Bowl Half (2026-01-18) is an internal inconsistency I can independently confirm and Agent D's own pass should have caught with its own stated methodology.

4. **Evidentiary weight of the handback's root-cause claim.** Agent D treats the handback's §2b diagnosis as confirmed-by-source-diff ("Confirmed by source, unchanged"). I read the same handback text more literally: it explicitly self-flags as *not re-verified against today's specific screenshot* and sourced to *"a design-review agent in the prior session."* Treating an admittedly-stale, unre-derived claim as freshly confirmed via a source diff that only checked "did any fix branch touch this" (rather than "is the claimed mechanism actually true of current `main`") is the exact failure mode CLAUDE.md's Rule 18/20 exist to catch, and I think Agent D fell into it here despite the report's own reconciliation framing being built around avoiding exactly that.

5. **No disagreement, but a gap I want to name plainly:** neither Agent D's Pass 1, Pass 2, the handback, nor this review actually rendered the Today screen against David's real 2026-09-09 run at the current pinned commit. That render is the one piece of evidence that would settle disagreement #1 outright, and its absence is the load-bearing weakness in every version of this finding so far, mine included.

---

## 4. Everything I independently confirmed cleanly (no notes needed)

- Today's run ground truth: id, distance, duration, workout type, plan_workout_id, 14-phase structure, exact walk-back durations, canonical-vs-absorbed row status (Part B §1 / Part C row 1)
- `RunDetailV5.swift`'s recovery-never-graded design, unchanged, comment verbatim at the cited line (Part C row 2)
- Absence of `target_duration_sec` on recovery rows, both raw and server-derived (Part C row 3 — I upgraded this from Agent D's own `NOT_RE_TESTED` to confirmed)
- Absence of `feat/recovery-ended-early-record`'s field on `main`, presence and unmerged status on its branch (Part C row 4)
- `coach_intents` count (321) and zero-upward distribution, exact match to Pass 1's shape (Part C row 21)
- WALKBACK-1/WALKBACK-2 unmerged status, `fix/goal-projection-recovery-ended-early`'s existence and scope (Part C rows 14, plus the follow-up branch)
- `recordRepSkip()`'s work-only gate, located via the `legacy/native` symlink (Part C row 15)
- The two distinct PROGRESS-vocabulary objects and the orphaned status of `recommendation.ts` (I went one step further than Agent D and confirmed zero client callers of `/api/coach/read` app-wide)

---

## 5. What I could not test (honestly flagged, not silently dropped)

Decision History screen's real-data/40-row claim, shoe-mileage live-recompute consistency beyond the raw DB value, Health/Readiness outage-disclosure render, Block/Paces/Watch screens (still no session-minting path available to a read-only reviewer), and the two out-of-domain memory items (canonical-run dataloss, Pause/End dead-end) — I did not re-test any of these, for the same reasons Agent D gave (no new render taken, some genuinely out of this domain's scope). I did not independently verify the `postRun`-object-shared-across-surfaces claim beyond finding its single call site in `today/route.ts`; I did not check the `/api/runs/[id]` side.