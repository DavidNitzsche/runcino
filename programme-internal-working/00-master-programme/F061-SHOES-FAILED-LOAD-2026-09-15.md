# F061 -- Shoes screen silently shows zero shoes on a failed fetch

## The fix pattern named in the register was correct, but incomplete on
## its own

The register cited the exact fix pattern: `ShoesHostV5.load()`'s
`shoes = (try? await API.fetchShoes())?.shoes ?? []` collapses any
failure -- network blip, timeout, decode error -- into "you own zero
shoes," with no error state and no retry, same shape `SettingsLoadFailure`
(`SETTINGSFAIL-1`, 2026-09-07) already fixed for Settings ~200 lines
away.

Reading `API.fetchShoes()` itself before touching the view layer surfaced
a deeper, real second bug: on a non-2xx HTTP status, `fetchShoes()`
`return nil` **without throwing** --

```swift
guard (200..<300).contains(http.statusCode) else { return nil }
```

-- unlike its sibling `createShoe` a few lines below, which correctly
`throw`s `APIError.badStatus(http.statusCode)` on the identical check.
This matters because `SettingsLoadFailure.categorize(_:)` (the reusable
categorizer the register pointed at) only has an `Error` to read -- a
silent `nil` return gives it nothing to categorize. Even a perfect
view-layer fix in `ShoesHostV5` would never have distinguished a real
`/api/shoe` 404 (the exact trigger both F134's harness issue and design
review's slow-test-server sighting hit) from a genuine zero-shoe account,
because the API layer itself discarded the status code before the view
ever saw it.

## The fix

**`API.swift`**: `fetchShoes()` now throws `APIError.badStatus(_:)` on a
bad status, matching `createShoe`'s own pattern. Confirmed safe for every
existing caller: `grep`'d all 4 call sites
(`TodayBeforeLiveV5.swift`, `HostsV5.swift`, `TodayView.swift` x2,
`ShoesView.swift`) -- all already use `try?`, and `try?` on a throwing
`T?`-returning function already collapses BOTH "threw" and "returned nil"
to the identical `nil` result (Swift auto-flattens the double optional),
so none of them can observe any behavior change.

**`HostsV5.swift`**:
- `SettingsLoadFailure` gains `genericMessage(subject:)`, additive next to
  the existing `message`/`shortCause` (both untouched, so `SettingsHostV5`
  is unaffected) -- the existing properties are Settings-worded ("...to
  see your settings"), and duplicating the whole enum for one more host
  would violate the same Rule 16 the fix is meant to uphold.
- `ShoesHostV5` gets the same 3-state shape `SettingsHostV5` already
  uses: `shoes: [Shoe]?` (nil = never successfully loaded),
  `loadFailure: SettingsLoadFailure?` (non-nil only when `shoes` is ALSO
  nil -- a failure after a good load leaves the old list on screen,
  same posture as Settings), and a coalesced `loadTask` so a Retry tap
  can't race a write's own reload.
- Failure state: `AppBar` + `ErrorNote(text: loadFailure.genericMessage(subject: "shoes"), onRetry:)`,
  same chrome `SettingsHostV5`'s own failure state uses.
- `patch`/`addPair` both call the new `requestLoad()` (cancel-then-relaunch)
  instead of a bare `await load()`, matching `SettingsHostV5`'s own
  `SETTINGSDEDUP-1` reasoning.

## Verification

- `xcodebuild test -scheme Faff -only-testing:FaffTests`, on a dedicated
  iOS simulator (confirmed no contention against the same simulator
  first): **552 tests executed, 0 failures, `TEST SUCCEEDED`.**
- Read all 4 other `fetchShoes()` call sites directly to confirm the
  throw-instead-of-nil change is behavior-preserving for each (see above).
- No new tests added for this pass -- `ShoesHostV5`/`ShoesV5` currently
  have no existing test coverage to extend, and adding real UI-state
  tests for a SwiftUI host (async `.task`, `@State` transitions) is a
  larger lift than this fix's scope; named here as a real gap rather than
  silently skipped.
