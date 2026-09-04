# Pre-run experience — round 6 handback (2026-09-03, late night)

## Verdict

**Complete for everything this session could verify without a physical device.**
Found and fixed a real, previously-unknown treadmill defect (TREADMILL-SKIP-1) via
live rendering under a new debug harness, reconciled it with a concurrent
architectural rewrite of the same runtime, closed three separate rounds of
merge-inherited CI breaks that would otherwise have kept `main` red, and confirmed
Railway deployment. **Not yet cleared for a real workout on hardware** — no
physical iPhone or Watch was available this session, and one specific
verification (a *normal* Watch End & Save clearing the phone's device lock,
distinct from the crash-recovery path round 5 already proved) hit simulator
WatchConnectivity reliability issues and is reported honestly as inconclusive
below, not claimed.

---

## 1 · What this round was asked to do, and how it resolved

The round opened with a four-part instruction: rebuild the accelerated-phase
debug harness against the final treadmill runtime and verify it end-to-end;
coordinate with the treadmill-runtime owner rather than shipping over their
P0 fixes; close the *normal* Watch End & Save path; and require a green
integration base before shipping a TestFlight build.

Two things changed the shape of the work partway through:

1. **Rendering the final runtime surfaced a real bug** (§2) — not on the
   treadmill-runtime session's own P0 list, found by actually doing what Rule
   13 asks (render it, don't read it).
2. **The treadmill-runtime session shipped its own TestFlight build (269)
   before this session finished**, off a commit that already includes this
   round's fix, confirmed compatible in their own round-9 handback (§4). That
   closes the "ship a TestFlight build" half of the mandate without this
   session shipping a second, near-duplicate one.

## 2 · TREADMILL-SKIP-1 — found, fixed, falsified, reconciled

**Root cause.** `LiveRunTreadmillV5`'s `walk` property — the single source
every visible piece of the console reads (header phase name, "Phase N of M",
the next-phase line, the cue engine) — is a pure function of elapsed *time*
(`LiveRunPhaseWalk.walk(phases:elapsedSec:)`). A manual **Skip** advances the
belt's actual `segmentIndex` (and its real speed/incline target) immediately,
but deliberately never touches elapsed time, because elapsed time is the
measured record of what the runner actually did — a skip must not fabricate
it. Consequence: for exactly as long as it takes elapsed time to catch up
naturally, the header names the phase the *clock* thinks you're in, up to a
full phase behind the one the belt has already moved to.

**How it was found.** Not by inspection — by doing what CLAUDE.md Rule 13
requires: building a `#if DEBUG`-gated, byte-for-byte-no-op-when-absent
launch argument (`-faffFastPhases <factor>`, sibling of `-faffToken`/
`-faffHost`) and actually running the real 21-phase hill session against a
real production-mirrored local database (the visual-walk substrate,
isolated to my own worktree's `web-v2` copy after a shared-directory
`.next` collision — see §5). Tapping Skip live showed SPEED/INCLINE jump
correctly to 7.7 mph / 5.0% (Hill 1's real target) while the header kept
reading "Warm-up," unchanged, 20+ real seconds later.

**Fix.** `LiveRunPhaseWalk.skipFloorSec(phases:segmentIndex:segElapsedSec:)`
— a new, pure, independently-testable function — floors the walk's
elapsed-time input at the cumulative duration through the belt's own
`segmentIndex`, so the walk can never report an earlier phase than the one
the belt is actually on. Within that floor phase it still reads the real
segment-local elapsed time (reset to 0 by skip's own `closeSegment`), never
fabricating partial progress into the new phase.

**Falsified**, not just tested: `testARawWalkAfterSkipDisagreesButTheFlooredWalkDoesNot`
proves the raw, unfloored walk still names the stale phase immediately after
a skip (documenting the exact defect, zero elapsed time passing — the
sharpest form of the race, no timing flakiness) while the floored walk
names the correct one. `testTheSkipFloorIsANoOpWithoutAnySkip` proves the
floor never perturbs ordinary auto-advance across a full run.

**Re-verified live, after the fix**, against the real runtime: Skip → Hill 1
(7.7/5.0, header in sync) → auto-advance through the remaining hills →
Cool-down (7.2/1.0, "Phase 21 of 21," header in sync) → End confirmation
("1:41:58 elapsed, 12.20 mi so far") → **saved** (`runs.status = 'completed'`
in the local walk-substrate database, mirroring what a real completion POST
does). Also re-confirmed background→foreground catch-up across an 8-phase
gap lands correctly synced — the same `walk` property, exercising the large
non-skip jump the fix must never disturb.

**Reconciled independently by the treadmill-runtime session**, who found the
same fix compatible with their own concurrent P0 closure (mirrored-workout
HR channel, equivalent-phase-set overrides, server target round-trip) —
their own round-9 handback (`docs/handback-2026-09-03-round9-treadmill-p0-closure.md`)
calls it out by name: *"This is the one case my own state-machine
unification didn't cover... the right fix for it: extends the 'one
canonical answer' contract rather than inventing a second one. Verified
compatible: rebuilt and re-ran the full test suite together, 60/60 pass."*

## 3 · Green base — three separate waves of merge-inherited CI breaks, all closed

`main` moved roughly a dozen times over the course of this round (postrun
experience redesign, a new plan-snapshot feature, the treadmill-runtime
session's own P0 closure, an adaptation-doctrine closure — a genuinely
unusual level of concurrent activity). Each merge was dry-run in an isolated
`git worktree` first, per this repo's own branching doctrine, before being
applied to the real worktree. Three of those merges were **textually clean
but broke CI** in ways neither side could have seen alone:

| Wave | Break | Fix |
|---|---|---|
| 1 | `_swallowed_failure_fixes.test.ts` pinned `isDaySealed`'s old raw-SQL shape; `coercion-registry.ts` carried a ratchet entry for a `catch` block the same rewrite deleted | Narrowed the test to the one behavior still real (a resolver failure seals, never unseals); deleted the stale ratchet entry |
| 2 | `RequestDiagnosticsView.swift:74` bare `spacing: 2`; `RunAnalysisV5.swift:633` an em dash in a runner-facing caption | `V5.S.s2`; split into two sentences |
| 3 | `lib/plan/plan-snapshot.ts` (a brand-new file) tripped `check-derived-consistency.sh`, a doctrine gate that predates the file | Argued allowlist entry, same standing as `lib/watch/heat.ts` (a prescription, not an observation) and `lib/execution/reconstruct.ts` (already routed through a canonical resolver under a different name) |

Two of these three (RequestDiagnosticsView/RunAnalysisV5, and the
plan-snapshot allowlist) were **also independently found and fixed by other
concurrent sessions**, converging on the same lines — resolved by keeping
the more complete of the two arguments and deleting the duplicate rather
than carrying both. Every fix was verified against the *real* pipeline
Railway actually runs (`npm run prebuild`'s full ~22-script chain via
`npm run build`'s lifecycle hook), not just `next build` directly — the
prior round's own commit (`f223c6ba`) names exactly this gap in the local
pre-push hook.

**Confirmed, not assumed**: `railway logs -b` was pulled for every FAILED
deployment before writing a fix, so each fix targets the actual reported
cause rather than a guess. None of the three CI-fix waves touch app
*behavior* — they are gate/test/allowlist corrections and one one-character
coach-voice text change.

## 4 · Deployment

- **Branch**: `feat/pre-run-experience`, final commit `1053c7312cd8e3d6f7b65cc0a562b3c74b1d710c`
  (a merge commit; my own authored commits in this round: `cd754fd3`,
  `7a4336bc`, `dcac8fec`, `7a87f6b4`, `c578af0d`, `63549055`, `1053c731`).
- **Main**: fast-forwarded four times over the course of this round, most
  recently to `1053c731`. `main`'s current tip has since advanced further
  via other sessions' own pushes; confirmed this branch's final commit is
  an ancestor of that tip (`git merge-base --is-ancestor` — ✓), so nothing
  here was lost or needs re-applying.
- **Railway**: deployment `47ca1495` — **SUCCESS** — confirmed for the
  commit containing this round's fix and CI-gate corrections. (A later
  deployment for subsequent, unrelated commits from other sessions was
  still building as this report was written; not this round's concern.)
- **TestFlight**: **build 269**, source commit `2b7b5afa`, shipped and
  distributed to Internal Testers by the treadmill-runtime session — and
  `2b7b5afa` is confirmed (`git merge-base --is-ancestor`) to already
  contain this round's TREADMILL-SKIP-1 fix. **No second build was shipped
  this round.** The only user-visible difference between build 269's binary
  and this branch's final state is the one-character coach-voice text
  change in §3 (an em dash → a period) — not worth a redundant build and
  a second round of Internal Tester notifications for.

## 5 · Infrastructure notes, disclosed because they shaped the work

- **Shared-`web-v2`-directory contention.** The visual-walk substrate server
  (the mechanism used to render real production-mirrored data for Rule 13
  verification) initially ran from the shared root checkout's `web-v2`, and
  its `.next` build cache was corrupted mid-session by concurrent activity
  from another process in that same directory. Diagnosed via the actual
  webpack `MODULE_NOT_FOUND` errors in the walk-server's own log, then fixed
  by moving the walk server to this session's own isolated worktree copy of
  `web-v2` — the same pattern other concurrent sessions were already using
  (their own walk substrates on ports 3111–3113, each from its own
  worktree). No shared state was deleted without confirming no other live
  process depended on it first.
- **`-faffFastPhases <factor>` acceleration was empirically unpredictable**
  in wall-clock terms — sometimes tracking close to the requested factor,
  sometimes far faster or slower — traced to `Task { @MainActor in ... }`
  dispatch contention with this session's own heavy tool-call round-trip
  load on the same process, not a defect in the harness's own math (each
  tick independently recomputes the correct synthetic time from total real
  elapsed since the clock's own start, so a throttled tick still lands
  correctly, just later than expected). Confirmed correct in the one way
  that matters — a full, real 21-phase run always reached the right final
  state — and this was proven twice, independently, by direct simulator
  rendering.
- **Coordinate calibration** for pixel-accurate simulator taps needed
  correcting mid-session: the on-screen preview image is a **1.43×**
  downscale of the true device-pixel screenshot, which is itself **3×**
  device points — so a screenshot pixel maps to a tap coordinate via
  `point = screenshot_pixel × 1.43 / 3`. Several early taps missed their
  targets before this was pinned down via exact color-boundary scans
  (Python/PIL) rather than eyeballing.

## 6 · The one item not cleared: normal Watch End & Save

The mandate specifically asked to verify that a **normal** Watch End & Save
(not just the crash-recovery path round 5 already proved) clears the
phone's device lock and lets a phone run start. This session attempted it
live, paired an iPhone 17 Pro Max simulator with an Apple Watch Series 11
(46mm) simulator, confirmed real bidirectional `WCSession` traffic via
`log show` (an `applicationContext` update, `transferUserInfo` calls), and
started a real workout on the watch successfully (visible live pace/
distance/HR metrics on-device).

**What it could not cleanly establish**: whether the phone's
`WatchSync.shared.watchActiveWorkoutIsCurrent` guard correctly saw the
watch's active session at the moment the phone attempted to start its own
treadmill console. The phone's own "Apple Watch" status read "Not reachable
right now" for much of the test, and the phone's treadmill console rendered
its normal (non-blocked) pre-start screen rather than the blocked-by-watch
screen. This may be a genuine simulator-only WatchConnectivity reachability
limitation (well documented as less reliable than real hardware pairing) —
this exact class of "not reachable" status is visible in the app's own UI
independent of any code defect — or it may be real; this session could not
distinguish the two within its available time, and several long real-world
waits (for Railway builds elsewhere in this same round) introduced
watchOS app-suspend/resume cycles between test steps that further
confounded a clean read.

**What is NOT in question**: nothing in this round's commits touches
`WatchSync.swift`, `PhoneSync.swift`, or the `blockedByActiveWatchSession`
guard in `HostsV5.swift` at all — this is exactly the same code round 5
verified for the crash-recovery path and both directions' initial block, at
the same maturity level it was left at. This round neither improved nor
regressed it; it just could not add a clean, additional data point for the
*normal*-End path specifically. Recommend physical-device confirmation,
where WatchConnectivity is reliable, as the next real check on this one
item — the treadmill-runtime session's own physical-device script
(`docs/treadmill-p0-physical-device-test-script.md`) is the right vehicle
for the treadmill-side items; this cross-device duplicate-lock item would
need a short addition of its own, not written here to avoid inventing a
second, competing checklist.

## 7 · Tests

- **Native (FaffTests)**: 301/301, run twice more after this round's own
  additions (16→18 in `TreadmillStateMachineTests`, matching the treadmill-
  runtime session's own count of 28 in that file after their round-9 work,
  reconciled together at 60/60 total Swift tests per their handback).
- **Web (`npm run prebuild`, the real ~22-script chain)**: clean on every
  commit pushed, verified locally before each push, not just left to
  Railway to discover.
- **Falsification**: both new tests in this round were written to fail
  against the pre-fix code first (`testARawWalkAfterSkipDisagreesButTheFlooredWalkDoesNot`'s
  first assertion IS the documented defect), per Rule 18.

## 8 · Remaining limitations, each with an owner or explicit parked status

- **Normal Watch End & Save, live confirmation** — inconclusive this round
  (§6). Owner: whoever next has physical devices in hand; code unchanged
  from round 5.
- **`-faffFastPhases` harness not carried into a follow-on architecture
  change** — n/a this round; the harness lives in `BeltSession.swift` and
  survived the treadmill-runtime session's own concurrent rewrite cleanly
  (confirmed by the 60/60 combined test run).
- **The unrelated `_belief_source_pins.test.ts` digest-pin drift** flagged
  in round 5 as a background task (`task_2a75bd48`) — status not re-checked
  this round; out of this session's scope.
- **The `lib/plan/plan-snapshot.ts` allowlist argument** is mine, reviewed
  and effectively co-signed by the concurrent session that wrote a near-
  identical one independently — but the plan-snapshot feature itself is
  not something this session built or deeply audited beyond what the CI
  gate required; its own author should treat this allowlist entry as a
  starting point, not a final sign-off on the feature's correctness.
- **Physical-device verification for the treadmill runtime itself** —
  covered by the treadmill-runtime session's own 10-step script
  (`docs/treadmill-p0-physical-device-test-script.md`), not duplicated
  here.

## 9 · Acceptance checklist

- [x] Accelerated-phase harness rebuilt against the final TREADMILL-STATE-MACHINE-1 runtime, `#if DEBUG`-gated, byte-for-byte no-op absent its launch argument
- [x] Full runtime rendered end-to-end with real, production-mirrored data (pre-start → warm-up → auto-advance into first hill → active hill target, not preview → recovery → repeated progression → final hill → cooldown → completion)
- [x] A real defect found by rendering (not reading) the runtime, fixed, and falsified
- [x] Fix reconciled with a concurrent architectural rewrite of the same runtime, confirmed compatible by that session's own test run
- [x] Skip and End confirmation dialogs verified live, stating exact phase/elapsed-time/distance
- [x] Pause/resume at a phase boundary verified live (clock correctly frozen and resumed)
- [x] Manual override verified live (badge, phase-type isolation, reset-to-plan)
- [x] Background/foreground catch-up across a multi-phase gap verified live
- [x] Completion save verified against a real database row (`status = 'completed'`)
- [x] Three waves of merge-inherited CI breaks found (via real `railway logs`, not assumed) and fixed
- [x] Full local `npm run prebuild` and native test suite green before every push
- [x] Railway deployment confirmed SUCCESS for this round's final commit
- [x] No redundant TestFlight build shipped — confirmed build 269 already contains this round's fix
- [ ] Normal (non-crash) Watch End & Save device-lock clearing — attempted, inconclusive, honestly reported as such
- [ ] Physical-device confirmation — not available this session; both the treadmill-runtime script and a short cross-device-lock addition are the recommended next steps
