# F147 — "isn't available offline" while fully connected: root cause and fix

## The report

David, direct, live-testing, relayed via David's Desk: opening a completed
run from a prior day (Monday, September 14) showed "Loading Monday,
September 14's workout..." then failed with "Monday, September 14's
workout isn't available offline" plus a Retry button — while his phone
showed full wifi and cellular signal. Confirmed genuinely real and not a
stale-build artifact: it persisted identically on TestFlight build 295,
which carries every other fix from tonight.

## Root cause

`HostsV5.swift`'s `isOffline` flag (`@State private var isOffline = false`)
is a best-effort local signal: set `true` whenever a request posts
`.faffReachabilityLost` (a real transport failure on a request that
`announcesReachability`), and meant to be cleared the instant any payload
proves the network is actually reachable again. That clearing lived here:

```swift
.onChange(of: surface.model?.dateISO, initial: true) { _, _ in
    if let m = surface.model {
        dayCache[m.dateISO] = m
        reconcileDayCache(against: m)
        isOffline = false
    }
}
```

The bug: SwiftUI's `onChange(of:)` fires only on a genuine **value
transition** — old value != new value. `surface.model?.dateISO` is a
`String?` that, for the overwhelmingly common case, does **not** change
between one successful load and the next: today reloading as today (a
foreground refresh, `.refreshable`, a background HealthKit-triggered
resync) always reports the same `dateISO` it already had, and a *retry*
that lands the exact day it had previously failed for reports the same
`dateISO` too, once it succeeds a second time and the first attempt never
touched `model` at all.

So `isOffline` could go `true` from one real, transient failure, and then
never go `false` again for the rest of that day — not because the network
stayed down, but because every subsequent successful load kept reporting
the same `dateISO` value the `onChange` had already seen, and SwiftUI
correctly does not re-fire a "changed" callback for a value that didn't
change. The clearing mechanism's own comment ("Any payload landing is
proof the network is reachable right now") was correct in intent and
silently defeated in practice by the trigger it was attached to.

This also meant `dayCache[m.dateISO] = m` — the "every day that lands is
kept ... including a refresh of a day already in the cache" line — had the
identical blind spot: a same-day refresh landing fresher data for a day
already in `dayCache` silently failed to overwrite it, for the same reason.

Confirmed via `git grep` across all of origin/main's native Swift files
that no `.faffReachabilityLost` counterpart ("restored"/"cleared")
notification exists anywhere — this `onChange`-on-`dateISO` was the ONLY
mechanism meant to close the loop, and it had this gap.

## The fix

`native-v2/Faff/Faff/ViewsV5/HostsV5.swift`: re-keyed the same `onChange`
block from `surface.model?.dateISO` to `surface.cachedAt`. `cachedAt` is a
`Date?` that `SurfaceStoreV5.load()` sets to a fresh `Date()` on **every**
successful load (`.ok` case), unconditionally — regardless of whether the
loaded day's `dateISO` matches what was already cached. This closes the
exact gap: every real success now fires the closure, so `isOffline` is
reliably cleared and `dayCache` is reliably refreshed on every landing
payload, not only on a day-to-day transition.

One file changed, single mechanism, no new state, reuses a field
(`cachedAt`) already `@Published` and already read elsewhere in this same
file (`.v5StaleBanner(stale:cachedAt:...)`).

## Verification

- `xcodebuild build` (Faff scheme, iOS Simulator destination): BUILD
  SUCCEEDED.
- `xcodebuild test -only-testing:FaffTests`: see evidence file for exact
  count — no regression.
- Direct code review of both remaining call sites that read `isOffline`
  (the `.failed`/`.offlineNoCache` gates at `HostsV5.swift`'s two
  `pendingCard` sites) — unchanged; only the clearing trigger moved.
- Not verified: live render on a real device forcing an actual
  online→offline→online transition (no live-device or booted-simulator
  access available for this pass — F116 congestion). This is a
  same-mechanism, single-line-trigger fix reusing an existing, already
  `@Published`, already-updated-on-every-success field, so the risk this
  leaves unverified is narrow, but it is real and disclosed, not hidden.

## Known limitations

- The other `isOffline`-setting side (`.faffReachabilityLost`, still a
  "best-effort" transport-level heuristic, not a real `NWPathMonitor`
  reachability check) is untouched by this fix and remains capable of
  firing incorrectly for reasons unrelated to this bug (e.g. a single slow
  request). This fix only guarantees the flag gets cleared reliably once
  ANY subsequent request to this surface succeeds — it does not make the
  initial signal itself more accurate.
- No dedicated new automated test added — `HostsV5.swift`'s SwiftUI
  `.onChange` wiring is not unit-testable in isolation without a live
  `View` host; the closest existing coverage
  (`TodayNavigationTests.testReadinessNeverMatchesADifferentDate`) tests
  `readiness()` directly and is unaffected by this change. Disclosed as a
  real, pre-existing test-coverage shape gap, not hidden.
