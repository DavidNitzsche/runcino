# F078 — Week-off date range off by one day on screen

**Implementer report for a small, precisely-diagnosed, mechanical fix.**

- Branch: `fix/f078-weekoff-timezone-2026-09-14`, created off `origin/main`
  at `df12260e3`.
- Source: register entry `for design review/findings/2026-09-14-015` — the
  finding was already root-caused before this session; no re-derivation was
  needed.

## What was wrong

`WeekOffV5.formatRange()` in
`native-v2/Faff/Faff/ViewsV5/StateScreensV5.swift` parses the wire
`fromISO`/`toISO` strings with a UTC-anchored `DateFormatter` (correct), then
builds the on-screen string with a fresh `Calendar` and two `DateFormatter`s
that never had `timeZone` set — they silently defaulted to the device's
local zone. For anyone west of UTC (all of the continental US), a UTC
midnight date renders as the previous evening's local date, so a wire range
of `"2026-09-14"`/`"2026-09-14"` displayed as "September 13 – 13."

Because a real multi-day block shifts both ends by the same one day, the
rendered range still looks internally coherent at a glance — confirmed
against a `"2026-09-30"`–`"2026-10-06"` wire range, which pre-fix rendered as
"September 29 – October 5."

## The fix

Three missing `timeZone` assignments, matching the pattern
`RunLogV5.swift`'s own formatters already use correctly (`f.timeZone =
TimeZone(identifier: "UTC")`):

```diff
-        let cal = Calendar(identifier: .gregorian)
+        var cal = Calendar(identifier: .gregorian)
+        cal.timeZone = TimeZone(identifier: "UTC")!
         // ── US ORDER, WHICH MOVES THE ABBREVIATION TO THE OTHER END ───────
         ...
         let day = DateFormatter(); day.dateFormat = "d"
         day.locale = Locale(identifier: "en_US_POSIX")
+        day.timeZone = TimeZone(identifier: "UTC")
         let monthDay = DateFormatter(); monthDay.dateFormat = "MMMM d"
         monthDay.locale = Locale(identifier: "en_US_POSIX")
+        monthDay.timeZone = TimeZone(identifier: "UTC")
```

The parsing stage of `formatRange()` was untouched — it was already correct.

## Verification

`formatRange()` is a pure static function, so it got a focused unit test
suite: `native-v2/Faff/FaffTests/WeekOffV5FormatRangeTests.swift` (3 tests,
also registered in `project.pbxproj`'s `FaffTests` target).

- **Baseline** (`origin/main`, pre-fix, `xcodebuild test -only-testing:FaffTests`
  on simulator `Faff-Review-1`, iPhone 17 Pro): 544 tests, 0 failures.
- **New tests against the fix**: 3/3 pass —
  `testSingleDayRangeDoesNotShiftBackADay` ("2026-09-14"/"2026-09-14" →
  "September 14 – 14"), `testMultiDayRangeAnchorsToWireDatesNotLocalShiftedOnes`
  ("2026-09-30"/"2026-10-06" → "September 30 – October 6"),
  `testSameMonthRangeUsesShortForm` ("2026-08-18"/"2026-08-24" →
  "August 18 – 24").
- **Full suite with the fix**: 547 tests (544 baseline + 3 new), 0 failures.
- **Rule 18 falsification**: reverted `StateScreensV5.swift` to the
  pre-fix `origin/main` version (test file left in place) and reran the new
  suite — all 3 failed, reproducing the finding exactly:
  `XCTAssertEqual failed: ("September 13 – 13") is not equal to
  ("September 14 – 14")`, and the multi-day case likewise came back
  `"September 29 – October 5"` instead of `"September 30 – October 6"`.
  Restored the fix and reran — 3/3 pass again, full suite still 547/0.

## Scope notes

- Only `WeekOffV5.formatRange()`'s display-building stage was touched, per
  the finding's scope boundary. `RunLogV5.swift` was read only as the
  reference pattern, not modified.
- No other missing-timezone instance was spotted while reading the
  surrounding code in this pass; none is flagged here since none was found.
- Not merged/pushed to `main` — work stays on the `fix/f078-weekoff-timezone-2026-09-14`
  branch per instruction.
