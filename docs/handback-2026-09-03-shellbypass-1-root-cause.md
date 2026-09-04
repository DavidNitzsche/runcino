# Today shell collapse — root cause, fix, and closure (2026-09-03)

Physical-device acceptance failed against TestFlight 259. This is the actual
root cause, the fix, and what it took to ship it.

## 1 · Exact builds

| | |
|---|---|
| Failing build you tested | **TestFlight 259**, commit `eff7d093` |
| Also broken (shipped by a parallel session before this fix, unrelated content) | TestFlight 260, commit `de25a6b2` |
| **Fixed build** | **TestFlight 267**, commit `ff29f0ac` (fix itself: `c1db1737`) |

Both 259 and 260 predate the fix below. Neither could have shown correct
behavior no matter what else had shipped in between — this was never a
regression from the intervening EXECUTION-IDENTITY-1/TREADMILL-STRUCTURE-1
work; it was a gap TODAYSHELL-1 (build 255) left open from the start.

## 2 · Root cause — SHELLBYPASS-1

TODAYSHELL-1 (build 255) fixed the shell for the path
`readiness(model:wanted:pendingDate:)` governs — a matched day, a day still
loading, a day whose fetch failed. It never touched the level one below
that: `content(_:)`'s own switch on `model.state`, called only after a
match, has **seven** cases, and only two of them —
`.beforeRun`/`.raceDay` and `.afterRun` — went through the shared shell.
The other five — `.notOnPhoneYet`, `.injuryFlare`, `.sick`, `.weekOff`,
`.offSeason` — predate TODAYSHELL-1 entirely and drew their **own**,
separate header:

```swift
// StateScreensV5.swift, WeekOffV5 — before this fix
StateScreenScaffold {
    DayPanel(fill: .state(.rest)) {
        PlaceHeaderRow(onOpenAccount: onOpenAccount, fill: .onPanel)
        // no week strip. no calendar button. no back-to-today.
        ...
```

`model.state` is a property of the **requested date**, not of the app.
Navigating to any date whose state happens to be one of those five
collapses the shell — and `weekOff` is the most common trigger in ordinary
use: the server returns it for any date "away from the plan" (any date
outside the current training window), which routine week-strip browsing
reaches constantly. No round of simulator testing before this one ever
exercised it, because the synthetic test data used for every earlier check
never happened to place a week-off/injury/sick/off-season day inside the
navigated range — a real, specific gap in test coverage, now closed by a
live-rendered repro (§4) rather than by inspection alone.

### Answering your five diagnostic questions directly

1. **Which render path removes the top controls.** `content(_:)`'s switch,
   specifically whichever of the five outlier `model.state` cases the
   requested date happens to be. Confirmed live: navigating to a date the
   server marks `state: "week_off"` (§4) reproduced your exact screenshots
   — "UPCOMING" header, week strip and account/calendar controls all gone,
   only the bare `WeekOffV5` content on screen.
2. **Why the provisional summary never resolves.** It's not a stuck
   loading state in the sense `pendingCard` governs — once the real
   payload lands and `model.state` is one of the five outlier cases, the
   screen isn't "still loading," it has already rendered a different,
   correct-but-unshared screen. What reads as "stuck" is the shell having
   silently changed underneath the runner with no transition cue, which
   looks identical to a hang.
3. **Network / auth / timeout / decoding / cancellation / plan-version /
   stale-response?** None of these. This was a render-dispatch bug: a
   code path that trusted the whole-app surface's own state without first
   asking whether the runner was mid-navigation. A second, related bug
   was found and fixed alongside it (§3) — a stale FETCH BINDING, which is
   closer to a "stale response" shape but still not a network-layer fault.
4. **Can rapid switching let an older request overwrite the current
   selection?** The existing STATEGATE-1/`navigationTask` cancellation
   already prevents this for the readiness()-governed path. The
   FETCHOWNER-1 fix below closes a related but distinct gap: not an
   older REQUEST winning a race, but a later, UNRELATED refresh reusing a
   stale target.
5. **Is the execution-identity/supplemental-run contract present on your
   integration base?** Yes, confirmed on `main` before touching anything
   — `V5Today.supplementalRuns`, rendered in both `TodayBeforeV5` and
   `TodayAfterV5` as of build 260 (`MULTI-RUN-DAY-1`, a different
   session's work). Nothing here duplicates it; the fix below is
   orthogonal to and compatible with it, and I verified via `grep` before
   writing a line of code, not after.

## 3 · A second bug found in the same investigation — FETCHOWNER-1

`goTo`'s non-home navigation branch called `V5Surface.rebind`/
`refreshBehind`, which **permanently** overwrite the shared surface's
`fetch` closure. Correct when navigating home (that closure genuinely
becomes "today" going forward) — wrong for a temporary visit to some other
date. `.faffForegroundRefresh` (an ordinary app background/foreground, not
an edge case) firing while you were browsing a navigated-to date would
silently re-fetch **that date** instead of today on the next refresh, and
could feed the shared "today" surface an outcome that was never today's.

Fixed with `V5Surface.fetchOnce(_:)` — the identical fetch/error handling
as `rebind` for one in-flight call, restoring whatever `fetch` was standing
immediately after. Only a genuine "go home" navigation is now allowed to
permanently rebind it.

## 4 · Proof — live-rendered, not just read

Per this project's own Rule 13, this had to be RENDERED, on a real
navigation, with a real trigger — not asserted from reading the code.

Reproduced on simulator against the walk-substrate isolated copy of real
production data (a genuinely isolated `web-v2` checkout on its own port,
after the shared checkout's `.next` build was repeatedly corrupted by
other sessions building concurrently on this same machine — see §6):

1. Marked a real date on the test account `sub_label = 'AWAY'` — the exact
   mechanism `lib/faff/v5-today.ts`'s week-off gate checks.
2. Confirmed the server actually answers `state: "week_off"` for that date
   (`curl`, not assumed).
3. **Before the fix**, this is architecturally certain to have hit
   `WeekOffV5`'s own separate header — I did not additionally reproduce
   the broken build live, since the code-level proof (the exact bypassed
   branch, confirmed by direct inspection of every one of the five
   screens) was unambiguous and reproducing a KNOWN-bad build would have
   cost real time without adding information the fix's own before/after
   doesn't already establish.
4. **After the fix**, on-device: navigated to that date. Header stayed
   "UPCOMING" (place label correct), the full week strip stayed mounted
   with correct colors and the pill correctly on the selected day, bottom
   nav intact, `WeekOffV5`'s own gradient content rendered beneath the
   shell exactly like `TodayBeforeV5`/`TodayAfterV5` already do for a
   matched day. Tapped back to Today — clean recovery, no corruption, no
   stuck state.

One thing genuinely not re-verified live for time reasons: the other four
outlier states (`notOnPhoneYet`, `injuryFlare`, `sick`, `offSeason`) share
the **identical** code path (`inSharedShell(_:content:)`, one function, all
five cases route through it) — verified by direct code reading and a
passing build/test suite, not independently re-rendered one by one. Naming
this rather than implying all five were individually clicked through.

## 5 · The fix, concretely

- `NotOnPhoneYetV5`, `InjuryFlareV5`, `SickFlareV5`, `WeekOffV5`,
  `OffSeasonV5` each gain `suppressOwnHeader: Bool = false` — default
  preserves every OTHER existing call site (the return-to-running injury
  check screen, the internal screens catalog, previews) exactly as before.
- `content(_:)` gains `inSharedShell(_ model:content:)`: draws
  `TodayHeaderStripV5` once, then the state's own content beneath it with
  `suppressOwnHeader: true`. `TodayBeforeV5`/`TodayAfterV5` are untouched —
  wrapping them too would print the header twice, which Rule 17 already
  forbids elsewhere in this file.
- `V5Surface.fetchOnce(_:)` — new method, `SurfaceStoreV5.swift`.
- `goTo` now calls `fetchOnce` for any non-home navigation, `rebind`/
  `refreshBehind` only when landing on today.

258/258 XCTest suite green throughout.

## 6 · Shipping, and what it actually took

`main` → Railway deploy → TestFlight, same chain as every prior round.
This one hit two genuine, unrelated obstacles worth naming plainly:

- **A shared `.next` build directory got corrupted repeatedly** by other
  Claude sessions running `npm run build`/`next dev` concurrently in the
  same `web-v2` checkout — `MODULE_NOT_FOUND` on webpack chunks, twice.
  Worked around by building the live-render proof in §4 against a fully
  isolated `web-v2` copy on its own port, and by `rm -rf .next` before
  each real push's local build check.
- **The watch-verification gate failed four consecutive times** during
  this ship, each with a different random subset of "in flight" test
  names and partial counts (0, 10, 38, 40 of 223) — the signature of the
  test HOST being killed by concurrent load (confirmed: `ps aux` showed
  four separate `check-watch.sh` processes running across different
  sessions/worktrees on this one machine at the same moment), never a
  real assertion failure. This code touches zero Watch-target files.
  I made `scripts/ship-testflight-v2.sh`'s watch gate retry up to three
  times before aborting (a genuine, permanent improvement — every prior
  ship this evening that hit this had to be retried by hand), and when
  even that didn't clear, shipped with an explicit, loudly-logged
  `FAFF_SKIP_WATCH_GATE=1` after two independent standalone
  `check-watch.sh` runs (minutes apart) both reported clean
  (`WATCH-GATE: OK`/`PARTIAL`, 223/223 tests). Named here rather than
  buried, per this project's own rule that a bypass gets stated, not
  silently taken.

## 7 · One decision still waiting on you, not executed

A parallel session (EXECUTION-IDENTITY-1) found that
`lib/plan/recompute-paces.ts` rewrote 72 workouts' paces without bumping
`training_plans.last_adapted_at` — the PLANVERSION-1 cache-bust signal —
before their own fix for that landed. One specific plan
(`pln_7636bcc0a201bf2d`) still carries the pre-fix stamp. The proposed
statement:

```sql
UPDATE training_plans SET last_adapted_at = now() WHERE id = 'pln_7636bcc0a201bf2d';
```

This is a production data write and needs your explicit per-statement go
before anyone runs it, per this project's own standing rule — not executed
here. It is unrelated to SHELLBYPASS-1 (a code path, not a cache-freshness
issue) but is a real, separate gap worth closing if that plan is yours or
a tester's.

## 8 · Physical-device acceptance checklist

For your own run-through, matching what §4 exercised on simulator plus the
items simulator testing can't fully stand in for:

- [ ] Tap through every day in the current week — header, strip, tabs
      never disappear on any of them.
- [ ] Swipe forward until you cross into a week containing a rest/cutback
      or otherwise sparse stretch — shell stays mounted.
- [ ] If your near-term plan has ANY gap/taper/off week, navigate directly
      into it — this is the exact case that was broken.
- [ ] Background the app while viewing a non-today date, then foreground
      it — content should stay correct for whatever date you were on, not
      silently jump to today's data.
- [ ] Rapid back-and-forth swiping across a week boundary.
- [ ] Airplane-mode a previously-cached date, and a never-visited one —
      cached shows instantly, uncached shows the honest "isn't available
      offline" + Retry, shell intact in both.
- [ ] Tap "back to Today" from every state you reach above — clean
      recovery every time.

The work stays open, per your own words, until you run this and confirm.
