# Today-navigation P0 — consolidated handback: diagnosis, Stage 1, Stage 2

4 September 2026 (session spanning late 9/3 into 9/4). Covers the full arc:
diagnosis of the reported physical-device failures, Stage 1 (ship the
confirmed client fixes), and Stage 2 (the PlanSnapshot architecture).

## Verdict

**Complete**, with named remaining limitations (§9). Both stages shipped to
TestFlight and to production. Physical-device confirmation on David's own
phone in Airplane Mode — the brief's own closing bar — is still required
and is explicitly not claimed here (Rule 13: this was verified by rendering
against real production-shaped data on simulator, not on the physical
device the acceptance test names).

## 1 · Diagnosis (recap)

Full diagnostic handback: `docs/handback-2026-09-03-today-navigation-diagnosis-for-review.md`.

Root cause of "can't reach faff" / stale-data reports on build 267: two
already-fixed-but-unshipped bugs in the shared client (`API.authedSend`) —
a cancelled navigation request was posting the same global connectivity
banner as a genuine outage (`CANCELBANNER-1`), and there was no per-request
timeout ceiling so a hung request read as an indefinite loader. Confirmed
by endpoint-health probes (production healthy, fast, correctly auth-gated)
and a schema diff (additive-only since build 267) that ruled out a backend
or decoding cause.

## 2 · Stage 1 — ship the confirmed client fixes

**Exact commits, in order:**
- `cbaf3cb7` → cherry-picked as `f7c438b3 fix(api): a cancelled navigation
  request no longer raises the connectivity banner — CANCELBANNER-1`
- `b45d80eb feat(diag): STAGE1-DIAG-1 — internal request-lifecycle log for
  the validation build`
- `75e5a43e chore(ship): TestFlight build 268 — CANCELBANNER-1 + STAGE1-DIAG-1`

**TestFlight build 268** — distributed to Internal Testers, confirmed VALID
by App Store Connect.

**Cancellation and timeout proof:**
- `CancellationBannerTests.swift`, 9 tests. Falsified per this project's
  Rule 18 in the original commit (both cancellation-recognition cases
  reverted to `false`, confirmed to fail, reverted back) before being
  trusted — see that commit's own message for the transcript.
- `API.authedSend`'s `TIMEOUT-1` cuts the default 60s `URLSession` timeout
  to 12s for every authenticated request.
- `RequestDiagnosticsLog` (new, `RequestDiagnostics.swift`) records every
  authenticated request's endpoint, `date` query param, a monotonic
  generation number, start/finish time, and exactly one outcome (success,
  cancellation, timeout, transport error, HTTP error, or — from the decode
  site — a decoding failure). 7 tests, one falsified on purpose (the
  ring-buffer eviction line was disabled, the cap test confirmed to fail,
  reverted, confirmed green).
- Reachable via seven taps on the version footer in Settings — deliberately
  not a labeled row, so it never reads as a runner-facing feature.

**Physical-device diagnostic checklist** (for David, once build 268 is
running on his phone):

1. Open Settings → tap the version/build line at the bottom seven times.
   The request-log sheet should open.
2. Browse a few dates quickly (the exact "repeatedly can't reach faff"
   scenario from the original report). The connectivity banner should NOT
   appear for ordinary fast navigation.
3. If it ever does appear, open the diagnostics sheet immediately after —
   the most recent entries should show `cancelled` outcomes for the
   superseded requests, NOT `transportError`/`timeout`. A `transportError`
   or `timeout` entry at that moment would mean a real network problem,
   not a false positive — report it with the sheet's `endpoint`/`date`/
   `outcome`/`ms` fields, which is exactly what this sheet exists to
   surface.
4. Turn on Airplane Mode and navigate; the banner should read "Can't reach
   faff. This is your last saved copy." (a real, honest outage state) —
   distinguishable from the false positive by actually meaning it.

## 3 · Stage 2 — the PlanSnapshot architecture

### Endpoint and snapshot schema

`GET /api/v5/plan-snapshot` (`web-v2/app/api/v5/plan-snapshot/route.ts` →
`web-v2/lib/plan/plan-snapshot.ts`). Returns the runner's entire active
authored block — plan start through plan end (race day, or the block's
final day) — in one response:

```
PlanSnapshotResult {
  plan_id, plan_version, plan_start_iso, plan_end_iso,
  today_iso, synced_at, message?,
  days: PlanSnapshotDay[]
}

PlanSnapshotDay {
  plan_workout_id, date_iso, dow, type,
  is_rest, is_race, is_quality, is_long, distance_mi,
  sub_label, notes,                 // CITESCRUB-1 scrubbed
  card: PlanSnapshotCard | null,    // null only for a rest day
  treadmill: { speedMph, inclinePct } | null,
  matched_run: { runId, distanceMi, durationSec, paceSPerMi, match, indoor } | null,
  supplemental_runs: [...]
}

PlanSnapshotCard {                  // SpecCard minus citation/selectionRationale
  type, headline, why, steps, total_mi,
  workPaceSPerMi, workToleranceSPerMi, hasRacePaceFinish, totalDurationSec, basis
}
```

Built from the SAME canonical resolvers `/api/v5/today` uses — `ownedDaysSql`,
`cardFromSpec`/`cardWithoutSpec`/`cardForUnprescribableType`,
`resolveDateRangeExecutions` (batched), `loadGlanceState`/`hrTargets`/the
easy-band query, read once for the whole block rather than once per day.
Deliberately NOT a loop over `composeToday` — see `plan-snapshot.ts`'s own
header for why that would be both wasteful (105+ DB-heavy calls) and wrong
(most of what `composeToday` builds is live, today-only narrative that
doesn't apply to a day 40 days out).

### Old vs. new state/data-flow

**Old:** every date navigation (`goTo`) either hit `dayCache` (populated
only by prior network fetches this session, or TODAYPERSIST-1's sliding
disk-cache window — visible week ± 7 days, ± 2 weeks of summaries, capped
at 60 day-entries / 20 week-entries) or fell through to a live
`GET /api/v5/today?date=` fetch, per date, every time the cache missed.

**New:** one `GET /api/v5/plan-snapshot` call, triggered by launch,
foreground, explicit Retry, or a plan mutation (reschedule apply/undo —
`.faffPlanMutated`) — never by navigation. The response is validated
(decode + structural checks) and, only if valid, atomically replaces both
the in-memory `PlanSnapshotStore.current` and a single on-disk file
(`plan_snapshot.v1.json`, Application Support directory) in one step.
`goTo` checks `PlanSnapshotStore.shared.current?.day(on: iso)` FIRST for
any non-today date; if present, it renders synchronously — no fetch, no
`dayCache` lookup, no `navigationTask`, no `pendingDate`. Today itself is
unaffected: it keeps the existing live-narrative fetch, on the existing
triggers, never on every navigation tap.

### Removed / bypassed production navigation-fetch paths

- `goTo`'s per-date `fetchV5Today(date:)` call and the `dayCache`/
  `pendingDate`/`navigationTask`/`STATEGATE-1` machinery are now
  BYPASSED (not deleted — kept as the fallback for a date the snapshot
  genuinely doesn't cover: never synced yet, or outside the authored
  block) for every date the snapshot covers.
- `stripDays(for:)` (the week-strip header source) now rebuilds from the
  local snapshot — not a network week-fetch — whenever the viewed date
  falls outside the currently-loaded `V5Today` model's own week.

Per the brief's own allowance: "Existing per-day endpoints may remain for
compatibility" — `/api/v5/today?date=` and `/api/plan/week` still exist
and are still used for Today's own live path and the snapshot-miss
fallback; production Today *navigation* does not call them once a
snapshot exists.

### Atomic persistence proof

`PlanSnapshotStore.commit(rawData:)` — decode, then structural validation
(`validationFailureReason`), then an atomic file write
(`FileManager.replaceItemAt`), and only then is `current` reassigned. Any
failure at any step leaves both `current` and the on-disk file completely
untouched.

Falsified twice, per Rule 18 (both in `PlanSnapshotStoreTests.swift`):
1. The validation gate was temporarily disabled (`if false, let invalid = …`).
   `testStructurallyInvalidShapeIsRejectedEvenThoughItDecodes` and
   `testPlanStartAfterPlanEndIsRejected` both correctly failed — a
   real-plan-with-zero-days and backwards `plan_start_iso`/`plan_end_iso`
   were both silently accepted and clobbered a known-good snapshot.
   Reverted, confirmed green again.
2. The ring-buffer eviction in `RequestDiagnosticsLog` (Stage 1) was
   disabled; the cap test failed as expected; reverted.

11 `PlanSnapshotStoreTests` + 10 `PlanSnapshotNavigationTests` = 21 new
native tests, plus 10 new server tests (`_plan_snapshot.test.ts`) for the
two pure wire-projection functions (`wireSafeCard`, `treadmillGuidanceFor`).

### Full offline recording

Simulator, `scripts/walk-substrate.sh` (an isolated local copy of David's
real production data, read-only sourced), server process **genuinely
killed** (`pkill`, not a network-condition simulation) partway through the
session:

| Date | Rendered content | Notes |
|---|---|---|
| 2026-09-03 (today) | `INTERVALS`, 4.71 mi / 42:43 / 9:04/mi, "Treadmill · indoor, no GPS" | Live Today path (unaffected by this change) |
| 2026-09-04 | `LONG`, 15.0 mi, "no faster than 8:22/mi · ~152-159 bpm (Z3 Tempo)", **treadmill 6.9 mph · 1% incline** | Snapshot path, server dead |
| 2026-09-05 | `REST` — "No running. Sleep, mobility, fuel." | Snapshot path, server dead |
| 2026-09-06 | `EASY`, 7.5 mi, "7.5 mi easy · no faster than 8:22/mi · ~143-151 bpm (Z2 Aerobic)" | Snapshot path, server dead |
| 2026-08-31 (past) | `EASY · 6×20s strides`, 4.5 mi, full rep + recovery breakdown | Snapshot path, server dead, header correctly reads "EARLIER" |

Every one of these rendered instantly (no spinner in any screenshot), with
the shared shell (header, week strip, tab bar) intact, and with **no**
"Can't reach faff" banner on any of the four server-dead dates. The
week-strip pill correctly followed the selected date in every case.

The 09-03 case is the exact incident `EXECUTION-IDENTITY-1`'s own handback
names: the treadmill session resolved `matched: exact`, and the friend's
earlier run appeared as 1 supplemental entry — never conflated.

**Not exercised reliably this session:** the week-strip's own SWIPE-to-page
gesture (as opposed to a day tap) — a documented, pre-existing
simulator-automation limitation (this project's own prior handbacks name
the identical symptom for the Retry pill). The underlying code path is
identical (`onPageWeek` → `stepWeekAndWait` → `step` → the same `goTo`
already verified for five separate dates), so this is a gesture-simulation
gap, not a demonstrated code gap — but it was not itself exercised, and is
named rather than assumed clean.

### Exact commits / build

- `3b4e4fa2 feat(plan): PLANSNAPSHOT-1 — one local, versioned block
  snapshot replaces per-date navigation fetch`
- `f223c6ba fix(gates): close the two real prebuild-gate failures Railway's
  build found` (see §5)
- Merge commits reconciling three rounds of concurrent work from other
  active sessions on this repo (treadmill runtime, postrun experience) —
  `a666392d`, `0c081eb3`, `d7315513`.
- **TestFlight build 269** — distributed to Internal Testers, confirmed
  VALID.
- **Production**: pushed to `main` at `d7315513`; Railway deploy — see §4.

### Complete test results

- Native: 346/346 `FaffTests` green on the final merged state (309 after
  Stage 2's own additions + 37 from concurrently-merged work).
- Server: 702 doctrine tests + the full `npm run build` prebuild chain
  (~20 gate scripts) + the Next.js production build all green — verified
  by running the ACTUAL `npm run build` command Railway's Nixpacks build
  invokes, not `next build` directly (see §5 for why that distinction
  turned out to matter).

## 4 · Production deployment status

Pushed to `main` (`d7315513`). Railway build confirmed via `railway
status --json` to be building this EXACT commit hash
(`d731551372cf512afd6be682f57239936a46fc52`) — not inferred from the push
succeeding. Polled to a terminal state (not assumed from elapsed time):

**`railway status --json` → `SUCCESS`.**

Confirmed live by direct probe, not by trusting the status field alone:
`GET https://www.faff.run/api/v5/plan-snapshot` → `HTTP 401` (the correct
unauthenticated response — the route exists and is being served).

This deploy is the one that follows §5's fix — the FIRST push of this
stage (`a666392d`) genuinely FAILED Railway's build, was diagnosed from
real build logs (not assumed from a 404), fixed, and re-verified end to
end locally before this second, successful push.

## 5 · A real deploy failure, found and fixed mid-flight

The first push of Stage 2's merged state (`a666392d`) **failed Railway's
build** — confirmed via `railway status --json` returning `FAILED`, not
inferred from a 404. `railway logs --build <deployment-id>` showed the
actual cause: two real, pre-existing violations in the concurrently-merged
treadmill/postrun work, invisible to this session's own pre-push hook
because that hook runs `next build` directly rather than `npm run build` —
so it never exercised the ~20-script `prebuild` chain `npm run build`'s
npm lifecycle hook runs, which is what Railway's Nixpacks build actually
invokes.

- `RepBreakdownV5.swift:506` — a bare `spacing: 1.5` where
  `check-spacing-tokens.sh` wants a `V5.S.*` token or an argued
  `v5-spacing-exempt` comment.
- `RunAnalysisV5.swift:633` — an em dash in runner-facing copy
  (`check-coach-voice.sh`, Rule Four).

Both fixed and verified via the actual full `npm run build` (`REAL_EXIT=0`,
captured explicitly rather than trusted from a background-task summary,
which in this session's own experience did not reliably reflect a
mid-chain failure). A third finding, in this session's OWN new file
(`lib/plan/plan-snapshot.ts`, flagged by `check-derived-consistency.sh` —
a gate this session's local checks had also never exercised for the same
reason) was resolved with an argued allowlist entry rather than a
structural change, because the flagged code was already safe (routes
through `runFacts()`, which itself delegates to the project's own
`reconcileRun`) or not the kind of value the gate protects (a prescribed
pace, not a measured one) — see the allowlist entry itself
(`scripts/check-derived-consistency.sh`) for the full argument.

**Named for the next session:** this repo's pre-push hook has the same gap
Rule 19 already documents for a different check — it verifies `next
build`, not the actual `npm run build` prebuild chain Railway runs. This
cost real time twice in one evening across two different agents' pushes
(this session's own Stage-1 push hit a similar surprise). Closing it
belongs to whoever owns `.githooks/pre-push` / `check-web-build.sh`, not
this workstream, but it is worth flagging loudly rather than letting a
third session rediscover it.

## 6 · Diagnostics

`RequestDiagnosticsView.swift` (Settings, 7-tap) now also shows: local
snapshot plan id/version, block bounds, cached day count, sync state
(`idle`/`syncing`/`failed: <reason>`), sync generation, last successful
sync time, last error — the fields the original brief named, alongside
Stage 1's request log. Not shown to the runner in normal use.

## 7 · Matched vs. supplemental — preserved

Confirmed unchanged and correctly overlaid, live, on real data (§3's
09-03 row): the resolver stays `web-v2/lib/execution/day-resolver.ts`'s
`resolveDateRangeExecutions` — the exact function `EXECUTION-IDENTITY-1`
made canonical — batched across the whole block rather than re-derived.
No second resolver was created.

## 8 · Content above bottom navigation

`PlanSnapshotDayView` reserves `V5.Shell.tabBarHeight + V5.S.s24` as its
own bottom scroll padding, independent of safe-area inset alone. Verified
visually on the rendered screenshots in §3 — no overlap between the last
content row and the tab bar on any of the five dates checked, including
the longest one (the strides day with a full rep/recovery breakdown).

## 9 · Remaining limitations, named with owner/status

| Limitation | Status |
|---|---|
| Physical-device confirmation (Airplane Mode, David's own phone) | **Required, not done.** This is the brief's own closing bar. Everything above is simulator + real data; the acceptance test names a physical device explicitly. |
| Week-strip SWIPE gesture, as opposed to day-tap | Not reliably exercised this session (simulator gesture-injection limitation, documented precedent in this project). Code path is shared with the verified day-tap navigation. |
| Run-completion as a `.faffPlanMutated` trigger | Not wired — only reschedule apply/undo currently trigger a resync on mutation. Flagged as a follow-up task (`task_ba6eab69`). |
| Per-phase (vs. day-level) treadmill precision | Deliberately deferred — `lib/watch/build-workout.ts` is under active concurrent development (`TREADMILL-STATE-MACHINE-1`); day-level guidance is a documented simplification in `plan-snapshot.ts`'s own header. |
| `selectionRationale` (catalogue's per-week "why this session") | Dropped from the snapshot wire entirely (unlike Today, which carries it as a documented "handle with care" secondary field) — no per-day UI built yet to treat it with the same care. |
| Rapid-tap / swipe-reversal automated coverage | Covered at the unit level (`shouldRenderFromSnapshot`, `PlanSnapshot.day(on:)` exact lookups, month/year boundary tests) — not an end-to-end gesture-sequence test, matching this codebase's own existing convention for this class of invariant (per `TodayReliabilityTests.swift`'s prior precedent). |

## 10 · Acceptance checklist (for David, physical device, Airplane Mode)

1. Update to the build containing `3b4e4fa2`/build 269 (or later).
2. Open the app once online — let a sync complete (check Settings → 7-tap
   → "sync state: idle", "last successful sync" populated).
3. Enable Airplane Mode.
4. Browse every day from plan start (2026-08-24) through race day
   (2026-12-06) — day taps AND week-strip swipes.
5. Confirm for each: shell (header, week strip, tabs) never disappears;
   content renders with no visible loading state; no "Can't reach faff"
   banner (that banner should only appear if you had NOT synced first);
   content scrolls fully above the tab bar.
6. Confirm today's own screen (matched treadmill session, supplemental
   friend run) still renders its full live detail.
7. Turn Airplane Mode off, background and foreground the app, confirm a
   fresh sync lands quietly (no visible content disruption).
