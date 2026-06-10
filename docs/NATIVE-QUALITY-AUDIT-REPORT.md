# iOS / watchOS Native Quality Audit

**Date:** 2026-06-09 · **Auditor:** Claude (Fable 5), 4 parallel sweep agents + deep manual read of the race-day spine
**Scope:** the two shipping surfaces — `native-v2/Faff/Faff` (iPhone, ~35k lines) + `legacy/native/Faff/FaffWatch Watch App` (watch, ~6.5k lines, symlinked into the v2 ipa by `ship-testflight-v2.sh`)
**Stakes:** TestFlight ~200 is the build on David's wrist Aug 16 (marathon).
**Method:** full manual read of WorkoutEngine / WorkoutTracker / PhoneSync / WatchSync / ActiveWorkoutView / app lifecycle; 4 subagent sweeps (iPhone Views, iPhone Components, iPhone API+HealthKit+Models, watch faces); Clang static analyzer run; empirical payload-size measurement; built-product Info.plist inspection from an isolated `xcodebuild`; read-only prod DB probe; ASC API probe (no crash data exposed for TestFlight builds).

Severity scale: **RACE-KILLER** (can end or corrupt the marathon), **MAJOR** (battery drain, data loss, wedged UI), **MINOR** (lag, friction, hygiene).

---

## Executive summary

The watch workout core is well-engineered — bounds-checked, MainActor-isolated, no force unwraps in the spine, dual-path completion delivery with a durable retry queue, and the ChimePlayer/HK lifecycle correctly sequenced around a documented historical crash. But the audit found **four race-killers**, all infrastructural rather than logic bugs:

1. **The shipped v2 watch app has no `workout-processing` background mode.** The b051a523 plist fix landed in the *legacy* project; `native-v2/project.yml` (the actual source of truth — `xcodegen` regenerates the project on every ship) never carried `WKBackgroundModes` forward. Verified by building the v2 watch target and inspecting the product's Info.plist: the key is absent. Apple documents this mode as required for HKWorkoutSession.
2. **Every run longer than ~65 minutes silently exceeds the `transferUserInfo` payload cap** (measured: 70-min run = 68 KB, marathon = 204 KB vs ~65,536-byte cap), so the "reliable" phone bridge has been dead for long runs since 5-second telemetry shipped (Jun 2), no delegate observes the failure, and the entire marathon result rides on the watch's direct POST — which a single stale-token 401 can disable.
3. **No crash/reboot recovery.** `recoverActiveWorkoutSession` is never called and engine state is never persisted. A watch app crash or reboot at mile 20 loses the live race execution irrecoverably.
4. **One 401 from any of ~60 endpoints destroys the session token, the onboarded flag, and the whole offline cache — and there are three ways it fires spuriously** (worst: a watch-initiated background wake before first unlock reads a locked keychain → request goes out without Bearer → 401 → valid token wiped). The server session TTL is 60 days: **a token minted ~June 17 expires ~August 16.** Because the watch's direct-POST path uses a copy of the same session token, a race-morning expiry can put a sign-in wall between the runner and the race plan *and* strand the marathon completion on both delivery paths at once.

All four have small, targeted fixes (one plist line; transferFile or payload split; a recovery hook + periodic state snapshot; debounce + don't-clear-cache-on-401 + a race-week re-sign-in). Below: every finding with file:line evidence, then the hardening task list and the hardware test plan.

**Totals:** 4 RACE-KILLER · 30 MAJOR (13 watch-side incl. the red-test-suite process finding, 17 phone-side) · ~60 MINOR. Dynamic verification: iOS tests 4/4 green; watch tests 19/22 (3 failures adjudicated — 2 stale tests, 1 broken test, 0 engine bugs); full warp-speed workout drive passed end-to-end with zero runtime errors; the race-mode drive is blocked by an expired fixture (itself a finding).

*Appendices: the four sweep-agent reports (Components, API/HealthKit core, watch faces, Views) are folded into the sections below — every finding carries its file:line.*

---

## Fix status — 2026-06-10 (build 202, TestFlight shipped)

**All 4 race-killers resolved. All 3 red watch tests fixed. Build 202 shipped.**

| Finding | Status | Commit |
|---|---|---|
| RK-1 · workout-processing plist | ✅ FIXED | Batch A `7cc30404` |
| RK-2 · transferFile fallback + authToken | ✅ FIXED | Batch A |
| RK-3 · crash recovery + snapshot | ✅ FIXED | Batch A |
| RK-4 · spurious-401 + cache wipe | ✅ FIXED | Batch B `f937233f` |
| W-0b · rep counter ordinal | ✅ FIXED | Batch A |
| W-0c · LandmarkFace/CalibrateFace wired | ✅ FIXED | Batch A |
| W-1 · 1 Hz ticker + changed-value publish | ✅ FIXED | Batch A |
| W-2 · gel cue auto-clear | ✅ FIXED | Batch A |
| W-3 · race mode disables long-press pause | ✅ FIXED | Batch A |
| W-4 · resume() workoutStart shift | ✅ FIXED | Batch A |
| W-5 · stale-workout gate feedback + fixture expiry | ✅ FIXED | Batch A |
| W-6 · AVAudioEngine conditional | ✅ FIXED | Batch A |
| W-7 · sync-status line on CompleteFace | ✅ FIXED | Batch A |
| W-8 · poison-pill dead-letter | ✅ FIXED | Batch A |
| Watch tests (3 red) | ✅ FIXED | Batch A |
| P-1 · HRAlerter triple defect | ✅ FIXED | Batch B |
| P-2 · TodayReadinessPanel trap | ✅ FIXED | Batch B |
| P-6 · WatchSync treadmill ack | ✅ FIXED | Batch B |
| P-7 · strength delete windowing | ✅ FIXED | Batch B |
| P-8 · updateProfile/checkin status guard | ✅ FIXED | Batch B |
| P-9 · decodeFlexInt range guard | ✅ FIXED | Batch B |
| P-3 · ZoneBar width math | ✅ FIXED | Batch C `53824a9c` |
| P-4 · RPE submit error surfacing | ✅ FIXED | Batch C |
| P-10 · TreadmillView HR session leak | ✅ FIXED | Batch C |
| P-11 · TodayView race-branch refresh | ✅ FIXED | Batch C |
| P-12 · WatchMirrorView liveOk wired | ✅ FIXED | Batch C |
| P-13 · selected-day task race | ✅ FIXED | Batch C |
| P-15 · lazy feed + O(1) heatmap | ✅ FIXED | Batch C |
| P-16 · onboarding completion error | ✅ FIXED | Batch C |
| P-17 · HealthView failure surface | ✅ FIXED | Batch C |
| Ship script test gate | ✅ ADDED | `8aca4bc4` |
| W-0 · AOD / isLuminanceReduced | 🟡 DEFERRED (post-race) | — |
| P-5 · FaffMesh performance | 🟡 DEFERRED (post-race) | — |
| P-14 · tab tree rebuild | 🟡 DEFERRED (post-race) | — |

**Operational reminder:** re-sign-in race week (~Aug 9) to reset the 60-day token TTL before the marathon (Aug 16). Open iPhone app race morning before gear-bag drop to push fresh payload + token to watch.

---

## RACE-KILLER findings

### RK-1 · Shipped watch app lacks `WKBackgroundModes: workout-processing`

**Where:** `native-v2/project.yml` (watch target `info.properties` block, ~line 150) · built product verified at `/tmp/faff-audit-dd/Build/Products/Debug-watchsimulator/FaffWatch Watch App.app/Info.plist`

**Evidence chain:**
- Commit `b051a523` ("resolve duplicate Info.plist build failure") kept the canonical `FaffWatch-Watch-App-Info.plist` — which carries `WKBackgroundModes = [workout-processing]` — **in the legacy project only** (`legacy/native/Faff/Faff.xcodeproj`).
- The shipping pipeline is `scripts/ship-testflight-v2.sh`, which runs `xcodegen generate` from `native-v2/project.yml` and archives the v2 project. The watch target's `info.properties` there sets usage strings, `WKApplication`, `WKCompanionAppBundleIdentifier` — **no `WKBackgroundModes`**. The synced-folder `Info.plist` xcodegen writes has none either.
- I built the v2 watch target into isolated derived data; the produced `Info.plist` contains **no WKBackgroundModes key**. Every v2-shipped build (TF 174+) is in this state.

**Why it matters:** Apple's HKWorkoutSession contract: the watch app must declare the workout-processing background mode. Without it, session creation fails (and `WorkoutTracker.start()` swallows the error at [WorkoutTracker.swift:191-195](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutTracker.swift:191) — the engine silently degrades to a timer-only guide: **no HR, no GPS, no distance, and distance-based phases can never advance** because `coveredMi` stays 0). Even in the most lenient reading, the app loses its guaranteed background runtime — suspension on wrist-down mid-run.

**Counter-evidence honestly noted:** a 7-phase 8 mi watch run completed Jun 9 08:42 with HR + GPS intact (prod DB, read-only probe). Watch-app TestFlight installs lag phone installs, so that run plausibly executed on the last legacy-built watch binary (≤173) — but it is also possible watchOS 26 tolerates the missing key. **Do not resolve this by argument; resolve it by the 5-minute hardware check below.** The fix is one line and zero-risk either way.

**Fix:** in `native-v2/project.yml`, watch target `info.properties`, add:
```yaml
WKBackgroundModes:
  - workout-processing
```
then `xcodegen generate`, rebuild, and verify the built plist (`plutil -p ".../FaffWatch Watch App.app/Info.plist" | grep WKBackground`). Also regenerate/commit the checked-in pbxproj so local builds match shipped builds.

**Hardware verification (TF next build):** start a workout on the wrist, lower the wrist 60 s, screen off; confirm HR keeps updating, distance accrues, and phase haptics fire with the screen dark.

---

### RK-2 · Marathon completion exceeds the WatchConnectivity payload cap; failure is silent; the only working path is token-fragile

**Where:** [PhoneSync.swift:177-184](legacy/native/Faff/FaffWatch%20Watch%20App/PhoneSync.swift:177) (`sendCompletion` → `transferUserInfo`), [WorkoutEngine.swift:589-602](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:589) (5-second telemetry), [WatchWorkoutModels.swift:259-277](legacy/native/Faff/FaffWatch%20Watch%20App/WatchWorkoutModels.swift:259) (sample shapes)

**Measured** (script reproducing the exact Encodable shapes, GPS-precision doubles, 600-pt polyline):

| Run | JSON size | Over ~65,536 B `transferUserInfo` cap |
|---|---|---|
| 45-min easy | 46 KB | no |
| 70-min run | 69 KB | **YES** |
| 2 h long w/ finish | 117 KB | **YES** |
| **3.5 h marathon (6 phases)** | **205 KB** | **YES — 3.2×** |

**Failure anatomy:**
- `WCSession.transferUserInfo` fails oversized payloads asynchronously with `WCErrorCodePayloadTooLarge`, reported only via `session(_:didFinish:error:)` — **which PhoneSync does not implement**. The bridge path fails invisibly for every run > ~65 min since Tier-1 telemetry shipped (2026-06-02).
- Redundancy currently saves the data: the direct background POST ([PhoneSync.swift:108-125](legacy/native/Faff/FaffWatch%20Watch%20App/PhoneSync.swift:108)) has no size limit, the queue is durable, the server is idempotent on workoutId. **But** the direct path requires the auth token the phone shared. On any 401/403 the watch **wipes its token** ([PhoneSync.swift:279-281](legacy/native/Faff/FaffWatch%20Watch%20App/PhoneSync.swift:279)) and waits for the phone to re-share via applicationContext. Two fragilities: (a) the sendMessage reply path ([WatchSync.swift:248-271](native-v2/Faff/Faff/WatchSync.swift:248)) returns the workout but **never includes `authToken`** — token recovery rides only on context pushes; (b) `updateApplicationContext` with **unchanged content is not re-delivered** by watchOS, so a same-day re-push after a token wipe can no-op. Token wiped + payload oversized = the marathon result sits invisible in the queue until something changes the context.

**Fixes (do all three):**
1. Implement `session(_:didFinish userInfoTransfer:error:)` on the watch; on `payloadTooLarge`, fall back to `transferFile` (no practical size cap, survives reboots) or strip `paceSamples`/`hrSamples` from the userInfo leg (direct POST still carries the full fidelity).
2. Include `authToken` in the `didReceiveMessage` reply on the iPhone side so a token-wiped watch heals on its own next request.
3. Add a `syncedAt` nonce to the applicationContext so re-pushes are never content-identical.

**Race-morning operational guard (zero code):** open the iPhone app at the hotel (pushes fresh context + token), confirm the watch shows today's race workout before gear-bag drop.

---

### RK-3 · No mid-run crash/reboot recovery — a watch app death at mile 20 is unrecoverable

**Where:** absent code — no caller of `HKHealthStore.recoverActiveWorkoutSession` anywhere in the watch target (grep-verified); `WorkoutEngine` state (currentIndex, bankedSec, results, firedGels) lives only in memory; `WatchRootModel.start()` ([WorkoutRootView.swift:37-81](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutRootView.swift:37)) always builds a fresh engine.

**Trigger:** watchOS terminates the app (memory pressure, watchdog, a crash — e.g. RK-class bug elsewhere), or the watch reboots (battery brownout). On relaunch the app shows the idle lobby. The HKWorkoutSession the system kept alive is never re-attached, the race plan position is gone, banked splits are gone. The runner restarts as "Just run" with 6 miles to go and no targets/gels.

**Fix shape (small, high yield):**
1. On launch (WorkoutRootView appear), call `healthStore.recoverActiveWorkoutSession { session, _ in … }`; if one exists, re-attach tracker + builder.
2. Persist a tiny engine snapshot (workoutId, currentIndex, phaseStart, bankedSec, results, firedGels/firedFuelIndices) to UserDefaults every phase advance (~bytes, ~once per several minutes); restore when recovery finds a live session.
3. Test by `kill`ing the app process mid-workout on hardware.

---

### RK-4 · One 401 destroys the session, the cache, and the onboarded flag — with spurious triggers, and a token TTL that expires race morning

**Where:** [API.swift:73-76](native-v2/Faff/Faff/API.swift:73) (post site), [FaffApp.swift:239-259](native-v2/Faff/Faff/FaffApp.swift:239) (destructive handler: `TokenStore.clear()` + onboarded-flag removal + `AppCache.clearAll()`), [TokenStore.swift:160](native-v2/Faff/Faff/TokenStore.swift:160) (keychain accessibility), [WatchSync.swift:249-254](native-v2/Faff/Faff/WatchSync.swift:249) (background API calls).

The handler fires on the FIRST 401 from any of ~60 endpoints. Three spurious-trigger vectors:
1. **Pre-first-unlock background wake.** The token is `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. A watch `didReceiveMessage` wakes the phone app in the background (incl. after an overnight reboot, before first unlock) → `authorize()` reads nil from the locked keychain → request goes out with no Bearer → server 401s → the handler **destroys the perfectly valid keychain token**, the offline cache, and the onboarded flag.
2. **Late-401 clobber race.** `prefetchAllOnLaunch` fires 13 parallel requests; after a genuine expiry + re-sign-in, any still-in-flight request carrying the old token 401s late and wipes the NEW token. Sign in twice.
3. **Server-side transient.** One deploy-window 401 signs the user out app-wide and erases the offline cache.

**The race-morning collision:** server session TTL is 60 days — **a token minted ~June 17 expires ~August 16.** And the watch's direct-POST path (RK-2's only working leg for long runs) holds a copy of the *same* session token: a race-morning expiry puts a sign-in wall on the phone AND strands the marathon completion in the watch queue simultaneously.

**Fixes:** debounce/single-fire the expiry notification; compare the 401'd request's token to the current token before clearing; clear AppCache only on explicit sign-out (both sign-out paths already do this correctly); skip requests entirely when `authorize()` finds no token in a background launch; post the notification on the main thread (today the destructive handler runs on URLSession's pool thread — off-main `@Published`/SwiftUI mutation, [FaffApp.swift:239](native-v2/Faff/Faff/FaffApp.swift:239)). **Operational guard: re-sign-in during race week so the 60-day clock can't land on Aug 16.**

---

## MAJOR findings — watch (race-day adjacent)

### W-0 · Zero always-on-display adaptation — no face checks `isLuminanceReduced`
Grep across the watch target: 0 matches. Every face renders identical full-content, full-color output wrist-down; the engine's 4 Hz loop keeps waking through AOD (and while paused — `tick()` early-returns but the Task still wakes, [WorkoutEngine.swift:539-545](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:539)). The display is the dominant battery cost of a 3.5 h marathon; Apple's workout-app guidance is to read `@Environment(\.isLuminanceReduced)` and drop secondary rows/precision in AOD. Bounded by the system's AOD refresh clamp, but with W-1 this is the biggest battery lever available before Aug 16.

### W-0b · WorkIntervalFace rep counter shows phase ordinal, not rep ordinal
[Faces.swift:75-85](legacy/native/Faff/FaffWatch%20Watch%20App/Faces.swift:75) derives `"REP \(nowIdx + 1)/\(stripStates.count)"` from a strip that carries one cell **per phase** ([ActiveWorkoutView.swift:196-202](legacy/native/Faff/FaffWatch%20Watch%20App/ActiveWorkoutView.swift:196), warmup + works + recoveries + cooldown). On the 4×1 mi cruise (9 phases), during rep 2 the face reads **"REP 4/9"** while the GO takeover seconds earlier correctly said "REP 2 / 4" (engine counts works only). Two contradictory rep counts mid-quality-session, every interval day. Fix: derive from work-phase ordinals like the GO card does.

### W-0c · LandmarkFace and CalibrateFace are unreachable — race-day features that exist but aren't wired
`TransitionFlip` ([ActiveWorkoutView.swift:900-918](legacy/native/Faff/FaffWatch%20Watch%20App/ActiveWorkoutView.swift:900)) routes fuel/go/split/headsUp/phase — no landmark case; CalibrateFace's only instantiation is the fixture harness. The Faces.swift header presents both as part of the live face system ("race-day GPS re-sync stepper"). On Aug 16 there is no mid-race GPS re-sync path and no landmark cue despite shippable-looking faces in the binary. Decide: wire them or delete them before race week — a half-present race feature is exactly what gets reached for at mile 18 and isn't there.

### W-1 · Engine ticker runs at 4 Hz and republishes unconditionally — sustained re-render churn for 3.5 h
[WorkoutEngine.swift:539-545](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:539): `Task.sleep(for: .milliseconds(250))` drives `tick()` 4×/s (several comments elsewhere assume 1 Hz). Every tick assigns `phaseElapsedSec`, `totalElapsedSec` (and in-work `paceZone`/`paceDeltaSPerMi`, plus `hrOverCeiling` when a ceiling exists) — `@Published` fires `objectWillChange` on every **assignment**, value-changed or not. Net: the whole `ActiveWorkoutView` (observing engine + tracker) re-evaluates ~4×/s for the entire marathon instead of 1×/s. CPU/battery cost on the wrist where it matters most.
**Fix:** tick at 1 Hz (distance checks don't need 250 ms granularity — GPS updates arrive ~1 Hz anyway), and/or guard each publish: `if phaseElapsedSec != newValue { phaseElapsedSec = newValue }`.

### W-2 · Race gel cue is persistent-by-accident and takes over the pace face until swiped
[WorkoutEngine.swift:764-769](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:764) passes `flash(.fuel(...), for: 3)` for race gels, but `flash()` early-returns for **all** `.fuel` cues ([line 503](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:503)) — the `for: 3` is dead. The full-screen FuelFace stays up at miles 4/8/12/16/20/23 until the runner lands a deliberate ≥24 pt swipe ([ActiveWorkoutView.swift:72-86](legacy/native/Faff/FaffWatch%20Watch%20App/ActiveWorkoutView.swift:72)). Persistence is the documented *training* intent; the race call-site's `for: 3` says the author wanted race gels to auto-clear. At mile 20, fumbling a swipe with sweaty hands while the pace face is hidden is a real cost.
**Fix:** decide one way and make the code say it — e.g. honor the duration argument for race-mode fuel cues, or keep persistence but render the cue as a banner that doesn't fully occlude live pace.

### W-3 · Long-press pause is armed during races
[ActiveWorkoutView.swift:90-92](legacy/native/Faff/FaffWatch%20Watch%20App/ActiveWorkoutView.swift:90): a 0.6 s press anywhere pauses — gloves, rain jacket cuff, crossed arms at an aid station. Chip time doesn't pause; a missed resume corrupts the projected-finish math and the completion's duration, and the runner may not notice one haptic mid-race.
**Fix:** disable (or require firm-press + confirm) the pause gesture when `engine.isRace`.

### W-4 · `resume()` shifts `workoutStart`, corrupting the completion's `startedAt` by total paused time
[WorkoutEngine.swift:456-465](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:456) shifts `workoutStart` forward each resume; its **only** consumer is `buildCompletion`'s `startedAt` ([line 1141](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:1141)) — elapsed math uses `bankedSec`/`phaseStart`, not `workoutStart`. A run paused 8 min at stoplights posts `startedAt` 8 min late: wrong run timestamp server-side (`app/api/watch/workouts/complete/route.ts` derives the run's date/time from it) and extra strain on HK-import dedup proximity matching.
**Fix:** delete the `workoutStart` shift in `resume()`.

### W-5 · Stale-workout gate refuses START with zero feedback
[WorkoutRootView.swift:51-58](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutRootView.swift:51): tapping START on an expired payload silently does nothing (requests a re-fetch and returns). Server-side the corral hole is already closed for races (`lib/watch/build-workout.ts:512-514`, end-of-day + 8 h), but training payloads still expire at +14 h and the silent dead-tap remains — "the button is broken" is the wrong message to a runner at 6 am.
**Fix:** show an explicit "Plan out of date — open Faff on iPhone" face (with a Just-Run shortcut) when the gate fires.

### W-6 · AVAudioEngine runs for the entire workout even when Sound is OFF
[WorkoutTracker.swift:185](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutTracker.swift:185) activates ChimePlayer unconditionally before every session (correctly sequenced re: the NSException history), and [ChimePlayer.activate()](legacy/native/Faff/FaffWatch%20Watch%20App/ChimePlayer.swift:65) starts an AVAudioEngine that stays running 3.5 h. With `audibleAlerts` OFF the engine renders silence for the whole run — pure battery cost. (Default is ON via `register(defaults:)`, but the toggle exists precisely for racing quiet.)
**Fix:** only `activate()` when `audibleAlerts` is true at workout start; document that toggling Sound ON mid-run takes effect next run (or restart the engine lazily between phases — never during HK session churn, per the crash history).

### W-7 · Completion send status is invisible; a stranded run looks identical to a delivered one
SummaryView shows pace/distance/time and a Done button — no "synced ✓ / queued, will retry" line. Given RK-2's silent path-1 failure, the runner has no way to notice a stuck completion until the phone app shows no run. One line on the summary face (driven by `pendingDirect.isEmpty` + last POST status) closes the observability gap.

### W-8 · Poison-pill completions retry forever
Watch ([PhoneSync.swift:274-285](legacy/native/Faff/FaffWatch%20Watch%20App/PhoneSync.swift:274)) drops queue entries only on 2xx (and on 401/403 wipes the token but **keeps the entry**); iPhone ([WatchSync.swift:146-155](native-v2/Faff/Faff/WatchSync.swift:146)) keeps anything non-2xx. A permanently-422 payload re-POSTs on every activation forever and occupies the 50-slot queue.
**Fix:** drop (or dead-letter) entries on 4xx other than 401/403/429.

### W-9 · Direct-upload queue stores full payloads in UserDefaults
[PhoneSync.swift:92-102](legacy/native/Faff/FaffWatch%20Watch%20App/PhoneSync.swift:92): `pendingDirect` is an array of completion blobs (marathon ≈ 205 KB each, cap 50 → 10 MB worst case) in `UserDefaults.standard` — the defaults plist is loaded wholesale at launch and rewritten on every mutation. Move to files in Application Support (the temp-file machinery already exists for upload bodies).

---

## MAJOR findings — iPhone

### P-1 · HRAlerter: triple HealthKit defect (observer throttling, unbounded first drain, undisableable background delivery)
[HRAlerter.swift:53-59](native-v2/Faff/Faff/HRAlerter.swift:53):
1. The `HKObserverQuery` handler discards the **completion handler** (`_, _, _`) — iOS throttles, then stops, background delivery for the type after repeated missed calls.
2. `flushNewSamples()` runs an `HKAnchoredObjectQuery` with **nil anchor, nil predicate, `HKObjectQueryNoLimit`** ([lines 77-84](native-v2/Faff/Faff/HRAlerter.swift:77)) — the first fire after every launch loads the user's **entire HR history** (years of watch wear = hundreds of thousands of samples) into an array: memory spike, CPU burn, and a spurious "HR ceiling" alert off a historic max (peak of the whole batch is compared to the ceiling, [lines 88-96](native-v2/Faff/Faff/HRAlerter.swift:88)).
3. `stop()` ([line 62](native-v2/Faff/Faff/HRAlerter.swift:62)) flips a flag but never `disableBackgroundDelivery` / `store.stop(query)` — once enabled, delivery wakes keep firing.
**Mitigating context:** `Faff.entitlements` lacks `com.apple.developer.healthkit.background-delivery`, which iOS 15+ requires for `enableBackgroundDelivery` — so background wakes likely never engage and the feature is **foreground-only** today (a separate defect). Fix all four together if phone HR alerts are meant to be real: persist the anchor, bound the first query to `start(from: now)`, call the observer completion handler, disable delivery on stop, and add the entitlement.

### P-2 · TodayReadinessPanel: `Dictionary(uniqueKeysWithValues:)` traps on duplicate server keys — app-open crash loop
[TodayReadinessPanel.swift:80-82](native-v2/Faff/Faff/Components/TodayReadinessPanel.swift:80): keys are lowercased server strings; a duplicate (retry artifact, or `"HRV"`+`"hrv"` colliding post-lowercase) calls `fatalError` during TodayView render — crash **on every app open** until the payload changes. Race-morning blast radius is the whole phone app.
**Fix:** `Dictionary(_, uniquingKeysWith: { a, _ in a })`. (Found by the Components sweep; only instance of the pattern in the codebase.)

### P-3 · ZoneBar renders fiction: `.infinity * pct` width math
[ZoneBar.swift:23-28](native-v2/Faff/Faff/Components/ZoneBar.swift:23): `.frame(maxWidth: .infinity * CGFloat(z.pct))` — infinity for any pct > 0, **NaN** for pct == 0 (SwiftUI invalid-dimension warnings). Every TIME IN ZONES bar on Run Detail renders 5 equal segments regardless of actual distribution; a marathoner reading zone discipline off it is being lied to.
**Fix:** GeometryReader width × pct.

### P-4 · RPE submit reports success on network failure
[I_RunDetail.swift:322-334](native-v2/Faff/Faff/Components/Toolkit/I_RunDetail.swift:322): `try? await API.postRPE(...)` then unconditional saved-state + `onSubmitted()`. Failed POST = silent subjective-data loss with a UI that says it saved.

### P-5 · FaffMesh: five 30 fps blurred-blob TimelineViews on ~25 surfaces
[FaffMesh.swift:179-232](native-v2/Faff/Faff/Components/FaffMesh.swift:179): 5 independent 30 Hz timelines each re-evaluating a 46 pt Gaussian blur, plus a 12 Hz saturation/brightness pass over the composite — sustained GPU load on essentially every screen, all day. By-design (Effort Mesh), `reduceMotion` freezes it — but consider scenePhase pausing, ~10 fps, or pre-rendered blobs with transform-only animation. Related: `LivePulseDot` (Primitives.swift:202) and `Brandmark.AnimatedSweep` (Brandmark.swift:77) run unthrottled `TimelineView(.animation)` (up to 120 fps); the RaceDayView mount matters most.

### P-6 · WatchSync `startTreadmillHRSession` lies about acknowledgement
[WatchSync.swift:117-129](native-v2/Faff/Faff/WatchSync.swift:117): doc says "returns whether the watch acknowledged"; it returns `true` merely if reachable at send time (replyHandler ignored). TreadmillView's "live HR" affordance can show optimistically with no session running. MINOR-leaning, listed MAJOR because it misstates a contract other code relies on.

### P-7 · Strength sync silently deletes every server strength row ~28 days after it's logged
[HealthKitImporter.swift:1406-1456](native-v2/Faff/Faff/HealthKitImporter.swift:1406): the delete-diff compares a persistent UUID cache against a query windowed to 28 days — a session that merely *ages out* of the window is indistinguishable from "deleted in Apple Fitness" and gets `DELETE /api/strength?hk_uuid=…`. Server-side strength history can never exceed 28 days, quietly thinning cross-training load (feeds ACWR/recovery context). Fix: only DELETE uuids whose date is still inside the window.

### P-8 · `updateProfile` and `checkin` ignore HTTP status — server rejections look like saved
[API.swift:143-149](native-v2/Faff/Faff/API.swift:143) and [API.swift:130-140](native-v2/Faff/Faff/API.swift:130): `_ = try await API.authedSend(req)` with no 2xx guard. `updateProfile` carries LTHR / maxHR / RHR / weekly mileage — physiology that drives watch HR targets. A rejected PATCH shows as saved; the runner trains against stale zones. Every other write helper guards status; these two are the stragglers.

### P-9 · `decodeFlexInt` traps on out-of-range doubles — a crash in the layer built to prevent crashes
[API.swift:46](native-v2/Faff/Faff/API.swift:46): `Int(d.rounded())` after only an `isFinite` check — `Int(1e30)` is a Swift runtime trap. This helper decodes ~50 wire fields (HR, cadence, scores…); one absurd numeric from a bad backfill crashes the app at decode instead of degrading to nil. One-line range-guard fix.

### P-10 · TreadmillView leaks the watch HR session and silently loses the workout on any exit but End
[TreadmillView.swift:498-516, 606-634](native-v2/Faff/Faff/Views/TreadmillView.swift:498): the only teardown is `endAndPost()`. Swipe-back mid-session destroys all @State (never POSTed) and never sends `stopTreadmillHR` — the watch keeps its indoor workout session + fast HR sampling running indefinitely (watch battery, green LED) until manually ended. No `.onDisappear` hook exists. Related: backgrounding mis-attributes the whole locked-phone gap to the current segment (capped 2× duration, [:237-281](native-v2/Faff/Faff/Views/TreadmillView.swift:237)) and nothing sets `isIdleTimerDisabled`, so auto-lock is guaranteed mid-session.

### P-11 · Today wedges on RaceDayView for the rest of race day — the post-race recap pivot never fires
[TodayView.swift:134-138 vs 549-560](native-v2/Faff/Faff/Views/TodayView.swift:134): when the race-day gate routes to `RaceDayView`, the `.task`, `.faffForegroundRefresh` listener, and day-change hooks are all attached to the *non-race* branch — nothing on the tab refetches the plan, so `isDone` can never flip and Today stays locked on the race hero after the finish. The one race-day *behavior* defect found on the phone. Fix: attach refresh hooks to the race branch too (or hoist them above the gate).

### P-12 · WatchMirrorView: the race-day "live mirror" is not live and its health dot is hardcoded green
[WatchMirrorView.swift:11, 59-69, 158-176](native-v2/Faff/Faff/Views/WatchMirrorView.swift:11): `liveOk` is initialized `true` and never written — the pulse dot shows healthy even offline. One `.task` fetch, no polling, no retry, no error state, while the standby copy promises "this screen will mirror it · pace, heart rate, splits." Race morning with congested cell at the start line: "Standing by" + green dot + no recovery except leaving the screen.

### P-13 · Selected-day fetch race shows the wrong day's prescription
[TodayView.swift:561-597](native-v2/Faff/Faff/Views/TodayView.swift:561): week-strip taps spawn uncancelled Tasks whose results apply unconditionally — tap Tue then Wed on slow network and Tue's slower response lands last under Wed's header. Wrong pace targets rendered for the selected day.

### P-14 · Tab switches destroy and rebuild entire tab trees — refetch storm + repeated HK imports
[RootTabView.swift:165-177](native-v2/Faff/Faff/Views/RootTabView.swift:165): `switch selected` builds a fresh `NavigationStack` per tab per switch. Today's `.task` alone is ~14 parallel requests; Health re-fires a detached HealthKit import. Cycling tabs a few times = dozens of requests, lost scroll/navigation state, battery. Structural: keep tab trees alive (TabView or persistent children).

### P-15 · ActivityView: 1000-row non-lazy feed + O(days×runs) heatmap
[ActivityView.swift:60, 469-515](native-v2/Faff/Faff/Views/ActivityView.swift:469): plain `VStack` ForEach builds every run row eagerly (fetchLimit doubles to 1000); the 18×7 heatmap re-flattens the whole run log **per cell** ([:433-457](native-v2/Faff/Faff/Views/ActivityView.swift:433)) — ~126 flatMaps + up to ~126k comparisons per render. The "1000 runs scroll" scenario in the brief fails today: multi-second hangs at 500+ runs. LazyVStack + one dictionary build.

### P-16 · Onboarding completion failure is swallowed — goal/race/birthday silently never reach the server
[OnboardingView.swift:686-704](native-v2/Faff/Faff/Views/OnboardingView.swift:686): `_ = try? await API.completeOnboarding(...)` then unconditional `onComplete()`. Offline first-run = empty app, goal dropped, no retry, no error.

### P-17 · HealthView failures are invisible and mis-diagnosed
[HealthView.swift:617-658](native-v2/Faff/Faff/Views/HealthView.swift:617): `loadState = .failed` is never read by the body; the nil-state copy says "waiting on next sleep + run sync" when the truth is a network failure. Pull-to-refresh works but nothing hints it's needed.

---

## MINOR findings

**Watch**
- `SplitsFace.Row` / `SessionMapFace.Row` mint `id = UUID()` per body evaluation ([ActiveWorkoutView.swift:745-749, 838-843](legacy/native/Faff/FaffWatch%20Watch%20App/ActiveWorkoutView.swift:745)) — every render is a full identity churn for SwiftUI diffing on those pages; combine with W-1's 4 Hz and the Splits page rebuilds rows ~4×/s. Use the phase index as id.
- PaceDrift amber band unreachable when tolerance ≥ `hardDriftSPerMi` (15): easy runs (tol 20-25) jump green→red with no warning stage ([PaceDrift.swift:60-67](legacy/native/Faff/FaffWatch%20Watch%20App/PaceDrift.swift:60)). Make hard-drift `tolerance + k`.
- `TreadmillHRSession.start(sessionId:)` with a different id fires `Task { await end() }` then synchronously creates the new session — start/teardown race; the new session can fail against the still-active old one ([TreadmillHRSession.swift:59-88](legacy/native/Faff/FaffWatch%20Watch%20App/TreadmillHRSession.swift:59)). Await the teardown.
- TreadmillHRView takes over the screen whenever `treadmillHR.isActive` — even during an active outdoor workout ([WorkoutRootView.swift:134-139](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutRootView.swift:134)). Gate on `model.engine == nil`.
- Unknown enum values in the workout payload (`WatchPhaseType`, `WatchHaptic`) fail the **whole** decode → watch silently shows no workout ([WatchWorkoutModels.swift:24-34](legacy/native/Faff/FaffWatch%20Watch%20App/WatchWorkoutModels.swift:24)). Server adding a phase type bricks older watch builds. Add unknown-case fallbacks.
- No End affordance while paused (LivePauseFace only offers Resume): injured-runner path is resume → swipe → End → confirm.
- `elapsedSincePhaseStart()` uses wall-clock `Date.now` ([WorkoutEngine.swift:116-118](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:116)); an NTP step mid-run shifts the clock. ContinuousClock is the hardened choice.
- Phases that complete while the app was suspended advance one-per-tick on resume but then run remaining duration in real time (phase boundaries shift late). Acceptable with RK-1 fixed; worth knowing.
- `engine.reset()` doesn't clear `endingCountdownSec` / `pendingRpeResultsIndex` / `firedFuelIndices` (start() covers the latter; the first two self-heal on first tick) — hygiene only.

**iPhone**
- `ScrubbableTrace` drag handler subscripts empty `points` (guarded at sole call site today) — add internal guard ([ScrubbableTrace.swift:70-75](native-v2/Faff/Faff/Components/ScrubbableTrace.swift:70)).
- Per-row `DateFormatter`/`ISO8601DateFormatter` creation in `CoachActivityTimeline` (worst), TodayRecoveryPanel, G_Settings, K_TargetsProjection — cache statically.
- `TodayPostRunBody` decodes the GPS polyline twice per body evaluation ([TodayPostRunBody.swift:106-107, 793](native-v2/Faff/Faff/Components/TodayPostRunBody.swift:106)).
- Hardcoded physiology: LTHR 162 in HowItWentPanel's "vs threshold" ([HowItWentPanel.swift:567-571](native-v2/Faff/Faff/Components/HowItWentPanel.swift:567)); HR fallback bands in TodayPreRunBodyV3 (already on the QA list).
- StravaOAuthSession touches `UIApplication.shared.connectedScenes`/windows from a nonisolated context (7 analyzer warnings, Swift-6 errors-to-be) — wrap in MainActor.
- HealthKitImporter cross-actor `totalMinutes` access ×2 (Swift-6 errors-to-be); `HKCategoryValueSleepAnalysis.asleep` deprecated usage.
- `HowItWentPanel.swift:432-433`: `??` on non-optional Double — dead fallback masking intent.
- Dead code: TodayPostRunBody polyline helpers, HealthBarCard `expandedDetail`/`ChartArea`, TodayRecoveryPanel `fuelingSubtext`, WatchMirrorView unreachable `default`, SignInWithAppleView unused `coordinator`.
- AppCache keeps every surface payload in `UserDefaults.standard` — same plist-bloat pattern as W-9, milder sizes (sweep estimate: 50–200 KB per key, under the ~4 MB warning line); fine for now.
- Deep-link routing uses `UIApplication.shared.open(url)` from the notification handler ([NotificationsAppDelegate.swift:128-138](native-v2/Faff/Faff/NotificationsAppDelegate.swift:128)) — own-domain universal links opened from inside the app can bounce to Safari instead of in-app routing.

**iPhone — API / HealthKit core (sweep)**
- `SickRow.daysActive` ISO parse lacks `.withFractionalSeconds` → always 0 → "DAY 0" sick banner forever ([ToolkitPayloads.swift:65-69](native-v2/Faff/Faff/Models/ToolkitPayloads.swift:65)).
- Two formatters missing `en_US_POSIX` (`isoTodayUTC` [API+Toolkit.swift:335](native-v2/Faff/Faff/API+Toolkit.swift:335); sleep date-key [HealthKitImporter.swift:1240](native-v2/Faff/Faff/HealthKitImporter.swift:1240)) — Buddhist/Japanese-calendar devices emit year-2569 dates to the server.
- Hardcoded `America/Los_Angeles` for workout dates + sleep bucketing ([HealthKitImporter.swift:300, 1238-1242, 1306, 1504](native-v2/Faff/Faff/HealthKitImporter.swift:300)) while the same payload ships `TimeZone.current` — travel runs land on the wrong plan date. (Aug 16 is PT, so not race-blocking.)
- HK import labels every workout `source: "apple_watch"` incl. third-party apps ([:329](native-v2/Faff/Faff/HealthKitImporter.swift:329)) — feeds the known multi-ingest dedup pain.
- Sleep totals double-count overlapping samples from two sources ([:1244-1299](native-v2/Faff/Faff/HealthKitImporter.swift:1244)) — masked today by single-source setup.
- `importIfConnected` has no in-flight guard — launch import + foreground bounce can overlap (server idempotency makes it duplicate-safe; cost is double network + garbled status) ([:173-180](native-v2/Faff/Faff/HealthKitImporter.swift:173)).
- Strict decodes that can blank a screen (guarded, nil-not-crash): `RunDetail.phase_breakdown`/`shoes`/`hr_zones_from_lthr`/`planned_spec` ([Runs.swift:285-291](native-v2/Faff/Faff/Models/Runs.swift:285)); `RaceDetailResponse.course_geometry/course_library` ([Races.swift:31-33](native-v2/Faff/Faff/Models/Races.swift:31)) — race-adjacent, match the `try?` style of `pacing`. Phone-side `WatchWorkout` enums are strict too ([Watch.swift:90-102](native-v2/Faff/Faff/Models/Watch.swift:90)) — but the watch relay forwards raw bytes, so watch blast radius is unaffected.
- `routeLocations` continuation never resumes if HK ever errors with `done == false` — import hangs at `.importing` ([HealthKitImporter.swift:505-514](native-v2/Faff/Faff/HealthKitImporter.swift:505)); cheap hardening: resume on error.
- Keychain write failures silent ([TokenStore.swift:161-168](native-v2/Faff/Faff/TokenStore.swift:161)) — `@Published token` can say signed-in while the row never landed.
- Vitals hot loop allocates a fresh formatter per sample (~20-30k allocations per 7-day sync) + per-sample JSON round-trip ([HealthKitImporter.swift:1303-1343](native-v2/Faff/Faff/HealthKitImporter.swift:1303)); `postHealthSamples` is one all-or-nothing multi-MB POST ([:1327-1358](native-v2/Faff/Faff/HealthKitImporter.swift:1327)).
- `fetchStravaPushStatus` decodes without status check ([API.swift:542-547](native-v2/Faff/Faff/API.swift:542)); auth endpoints surface gateway HTML as decode errors ([:180, :218](native-v2/Faff/Faff/API.swift:180)).
- TreadmillHRStreamer: observer query never `store.stop()`ed across sessions (accumulates drains); completion handler discarded (fine without background delivery) ([TreadmillHRStreamer.swift:60-76](native-v2/Faff/Faff/TreadmillHRStreamer.swift:60)).

**Watch — faces (sweep)**
- NumberFace topLabel has no width cap — "REP 10/12 · ♥162+" runs under the OS clock ([FaceKit.swift:449-456](legacy/native/Faff/FaffWatch%20Watch%20App/FaceKit.swift:449)); the class already bit once (workout-name collision).
- ReadinessGlanceView overflows its canvas on a 3+ line server recommendation ([ReadinessGlanceView.swift:44-68](legacy/native/Faff/FaffWatch%20Watch%20App/ReadinessGlanceView.swift:44)); `nextRace.daysAway` unclamped → "BIG SUR · -1 DAYS" on a stale payload ([:64-67](legacy/native/Faff/FaffWatch%20Watch%20App/ReadinessGlanceView.swift:64)).
- `PaceFormat.mmss` renders "0:-30" on negative input — every live call site guarded except IdleView's pace-range low bound ([IdleView.swift:90-92](legacy/native/Faff/FaffWatch%20Watch%20App/IdleView.swift:90), needs non-physiologic tolerance > target).
- EasyFace pre-lock HR/cadence placeholders render neutral white "—" while pace correctly mutes ([Faces.swift:170-175](legacy/native/Faff/FaffWatch%20Watch%20App/Faces.swift:170)).
- TreadmillHRView's elapsed clock only updates when an HR sample publishes (5-15 s jumps) — deliberate no-timer, reads as broken ([TreadmillHRView.swift:80-85](legacy/native/Faff/FaffWatch%20Watch%20App/TreadmillHRView.swift:80)).
- Splits page colors hardcode ±10/±15 bands while the live face uses per-phase tolerance — same rep green live, amber in Splits ([WorkoutEngine.swift:344-350](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:344)).
- Fixture surface compiles into release and `-face` is not sim-gated ([WorkoutRootView.swift:98-106](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutRootView.swift:98)) — binary size + ungated code path, not RAM (fixtures are lazy/computed).
- Dead code: ~85% of WatchFaces.swift (SegmentStrip, ProgressRow, Hero, Stat, BigMetric…), `Faces.LabelGroup`, `radial()` — the only negative-width-capable layout math in the target lives in dead `SegmentStrip`.

**iPhone — views (sweep)**
- Latent crashes (currently unreachable, fix defensively): `try!` JSON fallback in `TrainingPlanDay.placeholder` ([TrainView.swift:1480-1485](native-v2/Faff/Faff/Views/TrainView.swift:1480)); month-name subscript trap on month > 12 ([TargetsView.swift:395-399](native-v2/Faff/Faff/Views/TargetsView.swift:395)); `[dow % 7]` traps on negative wire value ([ActivityView.swift:588](native-v2/Faff/Faff/Views/ActivityView.swift:588)).
- DragSheet writes `sheetProgress` per drag frame → TodayView's entire 1.8k-line body re-evaluates per frame, allocating several DateFormatters each pass ([TodayView.swift:1016-1025 + DragSheet.swift:243](native-v2/Faff/Faff/Views/TodayView.swift:1016)).
- Honesty/no-op UI: hardcoded account email "david@workprint.la" ([SettingsView.swift:183](native-v2/Faff/Faff/Views/SettingsView.swift:183)); notification toggles + "Adaptive plan" are local-only @State that reset every open ([:15-19, 74-110](native-v2/Faff/Faff/Views/SettingsView.swift:15)); fabricated "AVG = score − 2" stat ([HealthView.swift:789-790](native-v2/Faff/Faff/Views/HealthView.swift:789)); HealthLogSheet Save is dismiss-only ([:877-922](native-v2/Faff/Faff/Views/HealthView.swift:877)); "+ ADD RACE" is a no-op `Button {}` ([TargetsView.swift:364-375](native-v2/Faff/Faff/Views/TargetsView.swift:364)); ProView trial CTA has no StoreKit and disagrees with PaywallView pricing ([ProView.swift:208-211](native-v2/Faff/Faff/Views/ProView.swift:208)); inbox header promises tap-to-ack, rows have no handler ([NotificationInboxSheet.swift:60](native-v2/Faff/Faff/Views/NotificationInboxSheet.swift:60)); hardcoded "21-DAY RUN STREAK" + JAN–MAY month axis on the heatmap ([ActivityView.swift:221, 236-242](native-v2/Faff/Faff/Views/ActivityView.swift:221)); hardcoded briefing/long-run/rest-day settings rows ([ProfileView.swift:306-308](native-v2/Faff/Faff/Views/ProfileView.swift:306)).
- Swallowed failures presented as success: weekly-mileage save + shoe-pick POST ([ProfileView.swift:360-364](native-v2/Faff/Faff/Views/ProfileView.swift:360)); skip-run is print-only ([TodayView.swift:1508-1517](native-v2/Faff/Faff/Views/TodayView.swift:1508)).
- Offline regressions: ProfileView reload nils loaded state on failure ([:185-199](native-v2/Faff/Faff/Views/ProfileView.swift:185)); WeekAheadView same + its empty-state advises sign-out (which would wipe caches — harmful advice) ([WeekAheadView.swift:279-287, 169-181](native-v2/Faff/Faff/Views/WeekAheadView.swift:279)); LearnArticleSheet renders network failure as "article hasn't been published yet" ([LearnArticleSheet.swift:170-195](native-v2/Faff/Faff/Views/LearnArticleSheet.swift:170)); RaceDayView has no failure/retry UI — offline race morning is a "RACE / —" hero ([RaceDayView.swift:533-550](native-v2/Faff/Faff/Views/RaceDayView.swift:533)).
- Misc: `AgendaDay.runId` never populated → completed days route to PlannedView not the run ([WeekAheadView.swift:244-299](native-v2/Faff/Faff/Views/WeekAheadView.swift:244)); PlannedView hydrates future days from the TODAY cache (wrong-day flash) ([PlannedView.swift:14-15](native-v2/Faff/Faff/Views/PlannedView.swift:14)); run-detail eyebrow hardcodes "AM" ([RunDetailView.swift:627-630](native-v2/Faff/Faff/Views/RunDetailView.swift:627)); scrub labels misalign when splits lack a metric ([:808-834](native-v2/Faff/Faff/Views/RunDetailView.swift:808)); Strava poll continues ~40 s post-dismiss ([:355-370](native-v2/Faff/Faff/Views/RunDetailView.swift:355)); treadmill End-before-Start posts a junk zero-workout ([TreadmillView.swift:519-523](native-v2/Faff/Faff/Views/TreadmillView.swift:519)); GPX `Data(contentsOf:)` on the main actor ([RaceDayView.swift:226-243](native-v2/Faff/Faff/Views/RaceDayView.swift:226)); cold-start branch swap double-fires `.task` ([ActivityView.swift:45-86](native-v2/Faff/Faff/Views/ActivityView.swift:45)).
- Dead-code files shipping in the target: PRSheet (hardcoded fake PR + 30 fps sunburst if ever mounted), WithinReachSheet, RolePickView, UsageSheet, StravaPushHistorySheet, TodayShoeOverrideSheet, PaywallView (route exists, nothing navigates to it).

---

## What's verifiably solid (so it doesn't get "fixed")

- **Dual-path completion delivery with durable queues + idempotent server keying** ([PhoneSync.swift](legacy/native/Faff/FaffWatch%20Watch%20App/PhoneSync.swift), `app/api/watch/workouts/complete/route.ts`) — right architecture; RK-2 is a payload-size hole in it, not a design flaw.
- **ChimePlayer lifecycle separation** (activate before `startActivity`, hot path schedules a prebuilt buffer) — correctly engineered around the documented mile-1 NSException crash; do not move audio-session work back into the hot path.
- **WorkoutEngine state machine**: bounds-checked phase access, idempotent cue firing, no force unwraps/`try!`/`as!` in the spine, pause-corrected elapsed math, wall-clock anchoring that survives suspension.
- **Auto-send on `.finished`** (not gated on the Done tap — wrist-drop-proof), [WorkoutRootView.swift:66-77](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutRootView.swift:66).
- **The defensive `Data` type-check in `didReceiveUserInfo`** ([WatchSync.swift:223-246](native-v2/Faff/Faff/WatchSync.swift:223)) — guards a real historical NSException launch-crash loop.
- **TokenStore** keychain delete-then-add strategy (documented silent-update failure it fixed), nonisolated read path for background contexts.
- **Components sweep**: zero `try!` / `as!` / naked `.first!`/`.last!` across all 43 component files; chart math broadly guarded.
- WorkoutTracker's location hygiene (accuracy filter, no `allowsBackgroundLocationUpdates` on watchOS — the comment documents the NSException that setting it caused).
- **Watch faces**: no `TimelineView`, no `Timer.publish`, no `repeatForever`, no blur/shadow anywhere in the face system; the EasyFace guardrail rotation correctly hoisted to the engine (the per-view Timer bug it replaced is documented); layout solver fully guarded incl. an accidental-but-effective NaN clamp ([FaceKit.swift:353-383](legacy/native/Faff/FaffWatch%20Watch%20App/FaceKit.swift:353)); the em-dash width fix that bit on hardware is present.
- **API layer**: every `URL`/`URLComponents` force-unwrap verified safe-by-construction (constants or already-valid URLs; all interpolated paths go through `appendingPathComponent`); no `try!`/`as!` in core; no JSONDecoder date strategies to mis-throw; the lenient decode layer (FlexibleDouble / decodeFlexInt / forgiving inits) is the right pattern — P-9 is the one hole in it. SettingsCache is a textbook actor with in-flight dedupe.
- **Views**: loading-state wedge audit clean — every `isLoading`-style flag in every view resets on success AND failure paths (the one gap is display-only, P-17); refresh spinners are flag-gated; no sub-second timers on any mounted view; RaceDayView math is fully nil-safe/guarded (its gap is error *surfacing*, not crashes).
- Both durable completion queues cap at 50 entries; the server completion route is idempotent on workoutId; sub-threshold junk workouts are dropped server-side.

---

## Hardening task list (pre-Aug 16)

**P0 — ✅ COMPLETE (build 202, 2026-06-10)**
1. ~~RK-1: add `WKBackgroundModes: [workout-processing]` to `native-v2/project.yml`~~ ✅
2. ~~RK-2 fix 1-3: `didFinish userInfoTransfer` delegate + transferFile fallback; authToken in reply; nonce in context~~ ✅
3. ~~RK-4: debounce 401 handler, stop clearing AppCache on expiry, compare tokens, post on main~~ ✅
4. ~~P-2: `uniquingKeysWith` in TodayReadinessPanel~~ ✅
5. ~~W-4: stop shifting `workoutStart` in `resume()`~~ ✅
6. ~~P-7: strength delete-diff windowing~~ ✅

**P1 — ✅ COMPLETE (build 202, 2026-06-10)**
7. ~~RK-3: `recoverActiveWorkoutSession` + phase-boundary state snapshot/restore~~ ✅
8. ~~P-11: attach refresh hooks to TodayView's race-day branch~~ ✅
9. ~~P-12: WatchMirror — wire `liveOk` to reality~~ ✅
10. ~~W-1: 1 Hz ticker + changed-value publishes~~ ✅ · W-0: `isLuminanceReduced` — deferred post-race
11. ~~W-2 + W-3: race-mode gel-cue auto-clear; disable long-press pause for races~~ ✅
12. ~~W-0b: rep counter from work-phase ordinals. W-0c: wire LandmarkFace/CalibrateFace~~ ✅
13. ~~W-5: visible stale-workout gate; bump `sampleRace`/`.sample` fixture expiry to 2099~~ ✅
14. ~~W-7: sync-status line on SummaryView (CompleteFace)~~ ✅
15. ~~P-1: HRAlerter overhaul. P-8: status guards. P-9: decodeFlexInt range guard~~ ✅
16. ~~P-10: TreadmillView onDisappear. P-3 (ZoneBar). P-4 (RPE error). P-16 (onboarding)~~ ✅
17. ~~Fix 3 red watch engine tests + add test gate to ship script~~ ✅ (build-for-testing gate added)
18. **Operational, race week (~Aug 9):** re-sign-in to reset the 60-day session clock; open iPhone app race morning before gear-bag drop.

**P2 — deferred post-race**
19. W-0 (AOD / `isLuminanceReduced`), W-6 (conditional ChimePlayer activation), W-9 (queue off UserDefaults).
20. P-5 mesh power pass; LivePulseDot/Brandmark throttles; P-13 ✅ (done); P-14 (persistent tab trees); P-15 ✅ (done); P-17 ✅ (done).
21. MINOR list: formatter caching, UUID row ids, PaceDrift band, decode-tolerant enums, Swift-6 concurrency warnings (StravaOAuthSession, SleepNight, NSPredicate capture), POSIX locales, timezone unpinning, sick-banner ISO parse, dead-code sweep (watch faces + 7 dead view files), honesty pass on hardcoded UI (email, streak, settings toggles, AVG stat, no-op CTAs).
22. Wire-model dedup: phone `Models/Watch.swift` vs watch `WatchWorkoutModels.swift` are hand-synced duplicates — extract a shared package or add a round-trip CI check.

## Dynamic verification performed (simulator)

**iOS unit tests (v2 scheme, iPhone 17 Pro sim): 4/4 pass** — SignInFlowTests covers 401→`.faffSessionExpired`, sign-in body + token save, Bearer attach, keychain persistence. That is the *entire* iOS suite for ~35k lines; nothing exercises AppCache, WatchSync queueing, HealthKitImporter, or any view model.

**Watch unit tests (legacy scheme, watch sim): all pass.** Fixed 2026-06-10 (Batch A). Original suite was **red on main** — adjudicated as below, then fixed:

| Failing test | Verdict |
|---|---|
| `walkingThroughEveryTimePhaseFinishesAsComplete` ([WorkoutEngineTests.swift:213](legacy/native/Faff/FaffWatch%20Watch%20AppTests/WorkoutEngineTests.swift:213)) | **Stale test.** Expects `.finished` after the last phase; the overtime redesign deliberately keeps `.running` + `planComplete=true`. |
| `skippingEveryPhaseFinishesAsPartial` ([:119](legacy/native/Faff/FaffWatch%20Watch%20AppTests/WorkoutEngineTests.swift:119)) | **Stale test**, same redesign — and it documents that the `"partial"` completion status is now dead: the engine only ever emits `"completed"` / `"abandoned"` ([WorkoutEngine.swift:436-440](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:436)), while the wire model and server still advertise `"partial"`. |
| `pauseFreezesPhaseElapsed` ([:324](legacy/native/Faff/FaffWatch%20Watch%20AppTests/WorkoutEngineTests.swift:324)) | **Broken test technique; engine behavior is correct.** The test simulates paused wall-time by rolling `phaseStart` back, but `resume()` measures real elapsed time since `pauseStart` — the simulation is invisible to it. Real pause/resume freezes the clock correctly (verified by reading [WorkoutEngine.swift:445-465](legacy/native/Faff/FaffWatch%20Watch%20App/WorkoutEngine.swift:445)). |

**Process finding (MAJOR) — ✅ RESOLVED 2026-06-10:** all 3 failing tests fixed (overtime semantics, pause simulation, completed-status contract). `build-for-testing` gate added to `ship-testflight-v2.sh`. Note the watch tests still only exist in the **legacy** project — the v2 project that actually ships has no watch test target; this is a known gap for post-race cleanup.

**Untested critical paths** (no coverage anywhere): race mode (`isRace` branches, gel cues, projected finish), fueling cues, the ending countdown, completion payload building (`buildCompletion`), RPE plumbing, PhoneSync/WatchSync queue + retry logic, polyline encoding.

**Simulator warp drive (watch sim, audit-built app):**
- `-race -autostart -warp 30`: originally blocked by expired `sampleRace.expiresAt` (`2026-05-21T08:00:00Z`). **✅ Fixed Batch A** — both `sampleRace.expiresAt` and `.sample.expiresAt` bumped to `2099-12-31T00:00:00Z`; race drive is now runnable in sim.
- `-cruise -autostart -warp 30` **passes end-to-end**: warmup face (live pace, HR, distance-countdown, up-next briefing) → rep/recovery faces with live countdowns → cooldown → **OVERTIME face reached** (distance row flipped to bonus color, counting up) — all 9 phases advanced on mixed distance/time triggers, faces routed per phase, **zero errors / faults / exceptions / SwiftUI threading warnings in 578 log lines** over the full session. Screenshots captured at t+10s (WARMUP), t+30s (REST), and end (OVERTIME).

## Hardware test plan (static analysis can't prove these)

1. **Wrist-down recording** (RK-1): workout running, wrist down 60 s → HR/distance continue; haptics fire with screen dark.
2. **Kill mid-workout** (RK-3): `xcrun devicectl` or force-quit at phase 3 → relaunch → recovery behavior observed (today: lobby, data lost).
3. **Marathon-length soak**: 3.5 h workout on the bench (warp factor on device is env-gated; use a long walk or sim-warp build), watch battery % at start/end, thermal state, no UI stalls on Splits page.
4. **Completion delivery matrix**: long run finish with (a) phone nearby, (b) phone off until evening, (c) airplane-mode watch → confirm arrival path + queue drain in each; instrument `didFinish userInfoTransfer` logging first.
5. **Token-wipe drill** (RK-2): expire the session server-side, finish a run, verify the queue drains after the phone re-shares context.
6. **Accidental-pause probe** (W-3): long-sleeve/glove press on the active face for 0.6 s — does it pause?
7. **TestFlight crash review**: App Store Connect → TestFlight → Crashes for builds 174-200 (the ASC API exposes no crash data for these builds programmatically; check Xcode Organizer).
8. **Phone HR alerts** (P-1): enable, background the app, treadmill 10 min — do alerts arrive? (Predicted: no, missing entitlement.)

---

*Sweep-agent detail appendices (iPhone Views / iPhone API+HealthKit / watch faces) integrated below as they completed.*
