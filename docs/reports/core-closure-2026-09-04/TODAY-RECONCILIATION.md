# Today / week-strip · reconciliation into the core programme

The Today lane's handback is
`docs/handback-2026-09-04-overrun-match-and-today-followups.md`. It was treated
as **evidence, not proof**: every claim below was re-checked against
`origin/main`, the Railway deployment API, TestFlight ancestry
(`git merge-base --is-ancestor`), production data over the read-only role, and
the tests themselves.

**Result: every substantive claim verified. One claim in its own §5 was
INVERTED by the data, and one of my own corrections to it was wrong too —
both recorded below.**

## The table

| Handback claim | Commit | Merged? | Deployed? | Shipped? | Physically verified? | Remaining action |
|---|---|---|---|---|---|---|
| REDUNDANT-PACE-1 · work pace no longer repeats the header's number | `39d69b71` | ✅ on `origin/main` | n/a (native) | ❌ **not in build 275** | ❌ | ship in the next build |
| ACTIVITY-PLACEMENT-1 · the day's activity renders under the hero | `39d69b71` | ✅ | n/a (native) | ❌ **not in build 275** | ❌ | ship in the next build |
| OVERRUN-MATCH-1 · ingest band widened to −30% / +100% | `39d69b71` | ✅ | ✅ Railway `13033f42` | server — no build needed | ✅ **verified live by me** | none |
| PASSIVE-SYNC-TYPE-CONFIRM-1 · `ownTypeConfirms`, scoped to `apple_watch` | `39d69b71` | ✅ | ✅ | server | ✅ **verified live by me** | none |
| Backfill of one row (`-41598809443969`) | production write | n/a | n/a | n/a | ✅ **row confirmed by me** | none |
| §5 · "Hill 1's HR flat-lined — likely a watch artefact, never checked against the other 9" | — | — | — | — | — | **CLOSED — see below** |

### What I verified, and how

- **Ancestry, not prose.** Build 275's ship commit is `89f602df`;
  `git merge-base --is-ancestor 39d69b71 89f602df` is FALSE. The two native
  fixes are merged and deployed but **in no TestFlight build**.
- **Deployment status, not the push.** `39d69b71` → Railway `13033f42` (since
  superseded); the current tip `308ead33` → `93021f5d` **SUCCESS**.
- **The band.** `plan-type-stamp.ts` carries `PLANNED_DISTANCE_FLOOR_MULT = 0.7`
  and `PLANNED_DISTANCE_CEILING_MULT = 2.0` as named constants (the handback
  quoted inline literals; the values are right).
- **The source gate.** `day-resolver.ts:293` reads
  `source === 'apple_watch' && ownTypeConfirms(...)` — scoped as claimed, so
  Strava and manual entry still never qualify.
- **Tests.** 34 across the two files (22 pre-existing + 12 new), all passing.
- **The live behaviour**, called directly against production:

  ```
  resolveDayExecutions(2026-08-31)
    prescription easy 4.5mi · matchedRun=-41598809443969 match=legacy_type 6.18mi
    supplemental: []
  ```

  The 6.18 mi over-run resolves as the 4.5 mi prescription's execution, and
  nothing is left filed as supplemental.
- **The backfilled row** carries `workoutType: easy`, `workoutTypeSource: plan`,
  `source: apple_watch`, own `type: easy`, 6.18 mi — exactly as described.

## §5 · the open item, closed — and a correction to myself

The handback recorded, unresolved: *"Hill 1's raw `hrSamples` showed all 18
samples reading exactly 134 bpm … flagged as a likely watch artefact, but never
checked against the other 9 hills."*

**My first pass at this reported the opposite and was wrong.** I counted
distinct sample OBJECTS (`{bpm, tSec}`, each unique) instead of distinct bpm
VALUES, and briefly concluded the trace varied. It does not. Recounted on bpm:

```
phase                  n   distinct bpm   values
Warm-up               75        2         [139, 134]
Hill 1 of 10          18        1         [134]
Jog 2 min             30        1         [134]
Hill 2 of 10          18        1         [134]
Hill 3 of 10          17        1         [134]
Hill 4 of 10          15        1         [125]
Hill 5 of 10          18        1         [103]
Hill 6 of 10          19        1         [109]
Hill 7 of 10          15        1         [109]
Hill 8 of 10          17        1         [149]
Hill 9 of 10          15        1         [121]
Hill 10 of 10         11        1         [111]
```

**Eight distinct values across 21 phases and ~460 samples.** The flat line is
universal, not isolated. HR holds one value through Hills 1–3 *and* the jogs
between them, then steps. Hill 5 sits at **103 bpm for a full 60-second hill
rep**, and HR does not fall going into a rep. This is a sample-and-hold /
interpolation artefact — device behaviour, not physiology, and not a grading
bug.

**And the direct answer to the question asked** — *"is that the only thing the
coach cares about is HR? not incline or speed or anything?"* For that session,
**yes.** Its `workout_spec.rules` are HR-only:

```json
[{"kind":"pass","metric":"hr","op":"<=","value":164,"scope":"work",
  "label":"Pass: avgHr ≤ 164 on the work"},
 {"kind":"bail","metric":"hr","op":">","value":173,"scope":"work",
  "label":"HR over 173 and climbing · finish easy, the stimulus is banked"}]
```

No incline rule, no speed rule, no grade rule. The spec carries
`rep_pace_s_per_mi` and `by_effort: true`, so pace exists as a target — but the
only things that PASS or BAIL the session are heart rate.

### HRFLATLINE-1 · the fix that came out of it

The finding is not cosmetic, because HRPHASE-1 (landed the same day, correctly)
stopped discarding those readings — `phaseAvgHr` now derives a phase mean from
`hrSamples` when no top-level `avgHr` exists. So the held 134 / 103 / 109 values
**become the numbers the grader reads**, and `isHrReliable` only asked whether
the run-level average sat between 60 and 220. A trace like this averages ~125
and sails through. The failure runs both ways: 103 bpm reads as a comfortably
under-ceiling session that was never measured, and a held-high value reads as an
over-cooked one.

Rule 11's other half: **present is not readable.** New
`lib/adaptation/canonical/hr-trace-credibility.ts` refuses a work phase whose
samples are ALL IDENTICAL — a data-integrity statement, not a physiological one,
so it carries no `Research/` citation and asserts no variance threshold. Scoped
to the ADAPTATION evidence path, where a wrong HR moves a capacity belief. What
the runner SEES is `runPhases`' question and is deliberately unchanged; that is
a named follow-up, not a silent omission.

## The twelve requirements

| # | Requirement | Verified |
|---|---|---|
| 1 | preserve verified fixes, no re-architecture | ✅ nothing rebuilt; `39d69b71` untouched |
| 2 | remaining items into master TASKS with one owner | ✅ see `TASKS.md` |
| 3 | one canonical selected-day state, one authoritative snapshot | ✅ `PlanSnapshotStore` — "One file on disk, not a per-date/per-week key sprawl" |
| 4 | selection/swipe renders from local snapshot, no per-day request | ✅ `loadFromDiskSynchronously()` is the cold-launch path, "before the first `await`", so the first frame paints from local storage |
| 5 | background refresh never replaces valid content with a shell/blank/stale/false error | ✅ store contract: "A failed decode, a failed validation, a cancelled request, or a partial download never reaches `commit(rawData:)` far enough to touch either `current` or the file" |
| 6 | cancellation never reported as "Can't reach faff" | ✅ `API.isCancellation` checks BOTH `CancellationError` and `URLError(.cancelled)` — "which one URLSession throws is not guaranteed across OS/SDK versions" — used at both error sites |
| 7 | top bar / strip / hero / detail structurally stable across dates | ✅ TODAYSHELL-1 + HEROPANEL-1 on main; 346 native tests green |
| 8 | Run tab still executes today's canonical workout | ⚠️ code-level only — **physical test A/B** |
| 9 | multiple activities display separately; supplemental never seals | ✅ `_sealing_identity.test.ts` + EXECID-SCAN-1; live: supplemental empty once matched |
| 10 | overrun matching by canonical identity, not date/distance/name | ✅ **verified live** — `match=legacy_type`, via `ownTypeConfirms`, not date coincidence |
| 11 | mutations invalidate and replace the snapshot atomically | ✅ store contract: `current` swapped "in the SAME step as the disk write — never before, never separately" |
| 12 | no regression of the visual interaction work | ✅ native suite 346/0; nothing in this session touched those files |

Only **#8** is not settled by code, and it is on the device script.
