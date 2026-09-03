# Handback — Today/week-strip navigation, round 3

Continuation of round 2 (`handback-today-week-strip-round2-2026-09-03.md`,
same branch, same worktree). Round 2 landed the core state-integrity fix
(STATEGATE-1) and the bounded fetch coordinator, but left `planVersion`,
the two-device top-bar pass, and the accessibility pass explicitly open.
This round closes all three, plus two real defects found only because this
round required actually opening the app rather than reading code.

**Terminology, used precisely throughout this document:**

- **Locally verified** — built, tests pass, and/or rendered live on a
  simulator against real (non-fixture) data on this machine.
- **Pushed** — the commit exists on `origin/claude/today-navigation-p0`.
  Confirmed for every commit below by the push command's own output.
- **Merged** — landed on `origin/main`. **Nothing in this round is merged.**
  `main`-integration is explicitly reserved to the programme-lead session
  per `docs/MASTER_CORE_PRODUCT_PROGRAM.md`'s session-ownership section
  (added the same day this workstream started) — this session's job is the
  week-strip/phone-navigation workstream, not `main` integration or
  TestFlight distribution.
- **Deployed** — reached Railway via a `main` push. Not applicable; this
  branch is not `main`.
- **Distributed** — reached TestFlight. Not applicable, and out of scope
  for this session by the same session-ownership boundary above.

Round 1's "shipped" language conflated locally-verified work with
distributed work — this document does not repeat that error. Everything
below is **locally verified and pushed to the feature branch**, nothing
more, nothing less, unless a line says otherwise.

---

## Commits this round

All on `claude/today-navigation-p0`, all pushed and confirmed present on
`origin` (`git log --oneline origin/claude/today-navigation-p0`):

```
961ac8b6  fix(a11y): the loading skeleton is one VoiceOver element, not a
          silent gap plus a duplicate
259968bd  fix(phone): QA-token debug override actually wired, and tighten
          the header/strip cluster
8aa21221  chore(project): stage the xcodegen-regenerated pbxproj the watch
          gate just built
71b969e9  fix(phone): PLANVERSION-1 end to end, closes the in-place
          re-anchor gap — round 2, item 2+3+6+9
```

Every push in this round went through the repo's real pre-push hook
(`.githooks/pre-push`) unmodified — no `--no-verify`, no skipped guards.
That hook runs `check-doctrine.sh`, `check-normal-window.sh`,
`check-client-graph.sh`, and `check-watch.sh` (which itself regenerates
`native-v2/Faff.xcodeproj/project.pbxproj` from `project.yml`, runs the
full watch-engine test suite, and renders 22 watch boards on a booted
simulator). All four pushes ended `WATCH-GATE: OK`.

---

## 1 · PLANVERSION-1, closed end to end (review items 2, 3, 6, 9)

Round 2 left this as a client-side `plan_workout_id` diff only, with the
gap named explicitly: an in-place pace re-anchor rewrites `plan_workouts`
under the **same** id, so that diff alone cannot catch it.

**Server** (`web-v2`):

- `app/api/v5/today/route.ts` — `planVersion =
  \`${activePlan.id}:${activePlan.last_adapted_at ?? 'none'}\`` computed
  once per request, threaded into `EMPTY_TODAY` at all 8 call sites.
- `lib/faff/v5-today.ts` — `V5Today.planVersion: string | null` (required,
  `EMPTY_TODAY` always populates it); `V5TodayContext.planVersion` is
  optional, to avoid breaking 6 pre-existing test/lib call sites that don't
  set it.
- `lib/plan/week-loader.ts` — `loadPlanWeek`'s query now selects
  `last_adapted_at` alongside `id`; `PlanWeekResult.plan_version` is the
  same `id:last_adapted_at` string, so the week endpoint carries the same
  identity as the day endpoint.

**Client** (`native-v2`):

- `APIV5.swift` — `V5Today.planVersion: String?` added to the hand-written
  `Decodable` init.
- `HostsV5.swift` — `reconcileDayCache`'s decision is now factored into a
  pure static function, `TodayHostV5.reconciledDayCache(_:lastKnownPlanVersion:against:)`,
  for the same reason `readiness(model:wanted:pendingDate:)` above it is
  pure rather than a `@State` read (see the test-methodology note below).
  Primary signal: a changed `planVersion` wipes the whole `dayCache`.
  Fallback, unchanged: a per-day `plan_workout_id` diff, for a server old
  enough to send no `planVersion` at all.

**Proven server-side**, against a real local plan copy — not a fixture —
in an isolated database (`faff_visual_walk_weekstrip`, confirmed zero
production writes via the write-barrier fence log:
`[write-barrier] ARMED · ... writes permitted (loopback)`):

```
UPDATE plan_workouts SET distance_mi = 7 WHERE id = 'wko_13338389f511a813';
UPDATE training_plans SET last_adapted_at = now() WHERE id = 'pln_9a57561debb776e5';
```

Same `plan_id`, same `plan_workout_id` — exactly the case a
`plan_workout_id`-only diff cannot see. Before: `distance_mi: 5`,
`planVersion: pln_...:2026-09-03 00:53:41.641024-07`. After:
`distance_mi: 7`, `planVersion: pln_...:2026-09-03 11:32:17.996653-07`.
`curl`-confirmed both ways.

**Proven client-side** by `PlanVersionInvalidationTests.swift` (5 tests),
which call the pure `reconciledDayCache` function directly:

- a `planVersion` change wipes the cache even when every cached row's own
  id is unchanged (the exact re-anchor gap)
- an unchanged `planVersion` evicts nothing (so the test above isn't
  trivially satisfied by a function that always wipes)
- the `plan_workout_id` fallback still works when `planVersion` is absent
  (an older server)
- the first payload of a session never wipes (baseline establishment, not
  a "version changed" event)
- a later payload with no `planVersion` never clears a version already
  known

**A real test-methodology finding, worth keeping**: the first draft of
these tests constructed a bare `TodayHostV5` and mutated its `@State`
`dayCache`/`lastKnownPlanVersion` directly, the same way an early attempt
at testing `reconcileDayCache` might reasonably try. Two of the five tests
failed — not because the logic was wrong, but because `@State` mutated
through a bare, unrendered `TodayHostV5` does not reliably persist across
statements outside a live SwiftUI view hierarchy (confirmed by adding a
debug print immediately after a `@State` write and reading back `nil`).
This is the exact reason `readiness(model:wanted:pendingDate:)` was
already written as a pure function rather than a `@State` read — the fix
was to give `reconcileDayCache` the same shape (`reconciledDayCache`,
static, pure) and test that directly. Documented in the test file's own
header so the next person doesn't rediscover this the hard way.

**Proven live, end to end**, on a real simulator pointed at the isolated
database via `-faffHost`/`-faffToken` (see §3 for the device/method):
navigated to Sept 10 fresh after the mutation above — the panel showed
`EASY · 7 mi`, `Pace band 8:22-9:02/mi`, `HR ceiling 151 bpm`, and the
coach note `"Easy. Inside the mini-taper for Santa Monica 10k, no quality
this close."` — the mutated content, not the stale 5 mi, with no mismatch
banner and no stale content under the new date's label.

161/161 tests pass. `tsc --noEmit` clean on `web-v2`.

---

## 2 · A live operational finding: a different concurrent session had taken the port

While attempting the live-render proof above, curl calls that had
succeeded earlier in this session's own work stopped reflecting anything
new, and the app's navigation to Sept 10 kept 401ing with no request
reaching this session's own dev-server log. Traced with `lsof -nP -i
:3111`: this session's own `nohup`'d `next dev -p 3111` had died at some
point, and **a different worktree's concurrent Claude Code session**
(`.claude/worktrees/racepace-2026-09-01`) had bound its own `next dev -p
3111` to the now-free port — a live instance of the exact multi-session
collision class documented at length in the round-2 handback's §6, this
time at the OS-port level rather than the git level. Fixed by restarting
this session's server on a dedicated port (3119) rather than fighting for
3111 again.

---

## 3 · Top-bar verification on two device sizes (review item 4)

Rendered live against the isolated database (`-faffHost
http://127.0.0.1:3119 -faffToken <walk-substrate token>`), zero production
requests, on:

- **iPhone 17 Pro Max** — Dynamic Island, the large end of the current
  lineup.
- **iPhone SE (3rd generation)** — the classic status bar (no notch, no
  Dynamic Island), the smallest screen Apple currently ships and the
  smallest simulator device type available in this Xcode/runtime
  (`iOS 26.5`; no iPhone mini or original SE simulator exists for this
  runtime, so SE 3rd-gen is the correct "smaller phone" stand-in).

Both devices, both dates (2026-09-03 "Intervals · 6.5 mi" and the mutated
2026-09-10 "Easy · 7 mi"): the header renders correctly under both status
bar styles, no clipping, no overlap with the Dynamic Island pill, correct
day-state gradient per day, and the STATEGATE-1 loading card was directly
observed live on the SE device navigating to Sept 10 — header already read
"Thursday, September 10" while the body honestly showed a loading
skeleton, never Today's stale content under the new date's label. This is
the STATEGATE-1 invariant, caught live, not just in a unit test.

---

## 4 · A spacing defect, found and fixed live (not on the original checklist)

While doing the device-parity pass above, David watched the render and
flagged it directly: *"the spacing under TODAY and above the week strip
seems very large and too much."*

Root cause: `PlaceHeaderV5`, the week-line row, and `WeekStripV5` were
three siblings under `DayPanel`'s uniform `s20` (20pt) spacing rule. The
week-line row is reserved-but-invisible whenever `panel.weekLine` is nil
— confirmed nil on this real account's actual live payload right now
(`curl`-checked), not only the taper/past-block-end edge case the
reserved-height behavior was built for. Two 20pt gaps around an
invisible label read as roughly 58pt of near-dead space.

Fixed in `TodayBeforeV5.swift` and `TodayAfterV5.swift`: header + week
line + strip are now grouped into their own inner `VStack` at `s8` (8pt),
leaving `DayPanel`'s `s20` as the gap between that cluster and the display
register below — the gap that carries real meaning ("which day" vs. "what
it asks for"). The week-line row's own reserved-height behavior (David,
2026-08-25: hold the space so crossing a block boundary doesn't jump the
layout) is untouched; this only tightens the spacing *around* it.

Verified live on both devices post-fix — the header cluster now reads
visibly tighter and cohesive, with no regression to the no-jump behavior.

---

## 5 · Accessibility pass (review item 8) — one real fix, one confirmed-safe non-fix

Used the project's own instrumentation rather than a source read alone:
`A11yDump.swift`, a debug-only tool (`-faffA11yDump`) that walks the real
UIKit accessibility tree — what VoiceOver actually announces — and prints
it, with VoiceOver genuinely enabled on the simulator
(`ApplicationAccessibilityEnabled`/`VoiceOverTouchEnabled` via
`simctl spawn ... defaults write`).

**Found, and fixed**: the 380pt loading placeholder in both `coldStart`
and `navigatingCard`'s `.loading` case is a bare `RoundedRectangle` — a
`Shape` publishes nothing to the accessibility tree at all, the same
failure mode `Skeleton`'s own header comment already documents for
itself — so a VoiceOver runner got total silence where the big
placeholder sits, immediately followed by **two separate** "Loading"
announcements from the two adjacent `Skeleton(lines:)` calls. Confirmed
live, before the fix:

```
• "Loading" [-] 408x105
• "Loading" [-] 408x78
```

Fixed by grouping the placeholder and both skeletons into one element
(`.accessibilityElement(children: .ignore)`) with a single descriptive
label — `"Loading your plan"` for `coldStart` (no date exists yet),
`"Loading ⟨day name⟩'s workout"` for `navigatingCard` (which always knows
which date it's honestly reporting on, since that's the whole point of
STATEGATE-1). Re-dumped against the rebuilt binary and confirmed:

```
• "Loading your plan" [-] 408x603
```

One element, one clear statement, no silent gap. The `navigatingCard`
half of this fix uses the identical code pattern proven live on
`coldStart` above; a second live dump specifically timed to catch a
mid-session navigation's loading window did not land inside the
tool's fixed 3s/8s/14s capture windows (network round-trips to the local
dev server vary too much to guarantee this reliably), so that half is
verified by pattern-identity with the proven case rather than by an
independent live dump — stated plainly rather than implied.

**Found, and deliberately NOT changed**: the live tree also flagged
`PlaceHeaderV5`'s calendar and account discs at 36×44 —
`v5HeaderTarget`'s own 44pt tap-target floor. This is not a bug this
workstream introduced or should silently fix: `HeaderDiscV5.targetWidth`'s
own doc comment already reasons through it — two discs sitting 6pt apart
cannot both take 44pt without one stealing the other's taps, and 36pt was
a considered prior tradeoff, not an oversight. Left alone; named here as a
known, pre-existing, low-priority item for whoever owns that tradeoff to
revisit deliberately, rather than re-litigated as a side effect of this
pass.

**Not done**: Dynamic Type and Reduce Motion were not separately audited
this round. Given the time already spent, this is named as a real,
remaining gap rather than silently dropped.

---

## 6 · A bonus fix, found only because the app had to actually open: VW-3's real gap

Round 2's VW-3 fix header comment claimed `readToken()`, `readTokenStatus()`
and `authorize(_:)` all "checked `debugOverrideToken` first, ahead of
whatever Keychain does or does not hold." Reproduction this round showed
otherwise: none of the three actually did — only `seedDebugToken` wrote
the override. A Rule 20 violation in the strictest sense (a header comment
asserted an invariant the code did not enforce).

Traced end to end via `xcrun simctl spawn ... log stream` against a real
`-faffToken` launch:

1. `seedQATokenIfAsked` correctly set the in-memory token — `isSignedIn`
   true, `decideInitialStep` correctly entered `.main`.
2. `API.prefetchAllOnLaunch()` fired immediately, and every request went
   through `authorize(_:)`, which still read Keychain directly — empty,
   because the entitlement-mismatch write the original VW-3 comment
   already described never actually landed.
3. Every request 401'd with no `Authorization` header attached.
4. `.faffSessionExpired` fired **twenty-odd times in under half a
   second** (log-timestamped), each one calling `TokenStore.shared.clear()`
   and clearing `faff.onboarded`.
5. The app bounced back to the sign-in screen.

This is the exact "stuck on sign-in despite holding a confirmed-valid
token" symptom that has recurred across several rounds of this
workstream, including in this round's own earlier attempts — finally
caught because getting the top-bar and PLANVERSION-1 live-render proofs
required the app to actually stay open on real data, not just answer a
`curl` call. Fixed: the three functions now genuinely check the override
first, matching what the comment always claimed.

---

## 7 · Scorecard, this round's items only

(Round 2's full scorecard stands for everything not listed here; see that
document's §8.)

| Review item | Status |
|---|---|
| Canonical `planVersion` on the wire, both rebuild and re-anchor | **LANDED** (§1) |
| Prove invalidation with two real local plan versions | **LANDED**, server-side (`curl`) and client-side (5 unit tests) and live-rendered end to end (§1, §3) |
| Bounded coordinator kept, week-endpoint follow-up recorded | **LANDED round 2**, regression tests (`DayFetchCoordinatorTests.swift`, 7 tests) confirmed pushed this round |
| Top-bar correctness on 2 device sizes | **LANDED** (§3) — Dynamic Island (17 Pro Max) + classic status bar (SE 3rd gen, smallest currently-simulatable device) |
| Accessibility pass on the new loading/failed UI | **PARTIAL** — the loading-skeleton silence/duplicate bug found and fixed with live before/after VoiceOver-tree proof (§5); Dynamic Type and Reduce Motion not audited; one pre-existing tap-target item found and knowingly left as a documented tradeoff |
| Full navigation boundary test matrix (month/year, plan start/end, rest/completed/future/race/missing-workout days) | **NOT DONE** this round either — still open |
| Interaction quality / performance on physical or release-equivalent hardware | **NOT ATTEMPTED** this round — `xctrace` hung in round 2 and was not retried; no fallback method (signposts, XCTest performance metrics) attempted |
| Commit, push, CI/watch-gate confirmation | **DONE** — 4 commits, all pushed, all passed the real (unmodified) pre-push hook including the watch-engine gate |
| Merge to `main`, deploy, TestFlight | **OUT OF SCOPE for this session** — reserved to the programme-lead session per the session-ownership doctrine; not attempted, not implied |

---

## 8 · What a reviewer should actually check

- `git log --oneline origin/claude/today-navigation-p0` — the 4 commits
  above, on top of round 2's `7620ca11`.
- `native-v2/Faff/FaffTests/PlanVersionInvalidationTests.swift` and
  `DayFetchCoordinatorTests.swift` — run directly, or trust the
  161/161-green full-suite runs logged in each commit message.
- The screenshots this round were taken live and shown in-session are not
  attached to this document (this repo's convention keeps handback docs
  text-only) — reproduce with `-faffHost http://127.0.0.1:<port>
  -faffToken <walk-substrate token>` against a fresh
  `scripts/walk-substrate.sh` database, per the round-2 handback's §7
  method.

---

## 9 · Next step

In priority order, if this workstream continues: the full navigation
boundary matrix (§7), Dynamic Type / Reduce Motion audit (§5), and a
working performance-verification method (`xctrace` is not it in this
environment — signposts or XCTest performance metrics are the next things
to try). Handing off to the programme-lead session for `main` integration,
deployment confirmation, and any TestFlight action — not this session's
call to make.
