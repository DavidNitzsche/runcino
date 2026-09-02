# TestFlight ship — build 249, version 3.0.1 — 2026-09-01

Subject: ship a new build carrying the post-run label fix (`8646b38f`) after
`docs/reports/postrun-labels-still-broken-2026-09-01.md` found build 248's
archive had been sealed and uploaded 56 seconds **before** that fix even
landed on `main`. This report documents the fresh ship of build 249, run
against current `main` tip `7cac80f0`, plus a real defect found and worked
around in the verification step itself.

## 1–3 · Freshness checks before touching the build

```
git fetch origin main
git log -1 --format='%H %cI %s' HEAD
git log -1 --format='%H %cI %s' origin/main
git merge-base --is-ancestor 6b37e71f HEAD   # pace fix    → YES
git merge-base --is-ancestor 8646b38f HEAD   # label fix   → YES
```

HEAD and `origin/main` both resolved to `7cac80f006cca1e1718bdb9dfdff48a3e22f4166`
(committed 2026-09-01T14:59:54-07:00, about an hour before the ship started).
Both fix commits confirmed as ancestors before any build step ran. No lock
file (`.asc.shipping.lock`) was held by another agent.

## 4 · Ran the ship script, instrumented with two extra gates

Rather than run `scripts/ship-testflight-v2.sh` unmodified, I made a scratch
copy (`scripts/.ship-tf-v2-verified.sh`, deleted after the ship — never
committed) with two insertions, to directly prevent the exact TF-248 failure
mode instead of just re-running the same script and hoping:

- **Pre-archive freshness re-check**, immediately before `xcodebuild archive`:
  re-fetches `origin/main`, hard-fails if local `HEAD` has drifted from it,
  and re-asserts both fix SHAs are ancestors. This is the check the previous
  incident's own "process note" asked for — confirming the archive *about to
  be built* starts from a tree that actually contains the fix, not just that
  the fix is somewhere on the branch.
- **Binary verification gate**, immediately after `xcodebuild -exportArchive`
  and before any upload: grep the compiled, code-signed executable inside the
  archive for the literal strings `"Warm Up"` and `"Cool Down"` — the same
  check the postmortem used — and hard-fail (no upload) if either count is 0.

The watch-engine test gate and palette-sync gate both passed normally. The
freshness re-check passed: `HEAD == origin/main (7cac80f0...)`, both fix
commits confirmed ancestors, immediately before archiving. `xcodebuild
archive` and `-exportArchive` both succeeded (`** ARCHIVE SUCCEEDED **`, `**
EXPORT SUCCEEDED **`), producing `/tmp/Faff-v2.xcarchive` and
`/tmp/Faff-v2-export/Faff.ipa`, `CFBundleVersion 249`, `CFBundleShortVersionString
3.0.1`.

## 5 · The binary-verification gate itself was a false negative — found, diagnosed, worked around

The grep gate fired and stopped the script before upload:

```
→ Binary verification gate — grepping /tmp/Faff-v2.xcarchive/Products/Applications/Faff.app/Faff for label-fix strings…
   'Warm Up' occurrences:  0
   'Cool Down' occurrences: 0
ERROR: label-fix strings ABSENT from the built archive. This is exactly the TF-248 failure mode. STOPPING — not uploading.
```

Per the task's own instruction ("if not present, STOP and figure out why
before proceeding — do not repeat the previous mistake of trusting ancestry
alone"), I did not treat this as proof of absence and did not upload. I
investigated instead of either blindly retrying or blindly trusting the
grep, because at this point the freshness checks (source byte-identical to
`origin/main`, both commits confirmed ancestors seconds before archiving)
already made a genuine repeat of the TF-248 timing bug very unlikely.

**Root cause: Swift's small-string optimization makes this specific grep
check produce a false negative on ANY correctly-compiled binary, not just a
stale one.** Verified with an isolated, minimal, indisputably-correct
program compiled with the exact same flags used by the archive
(`swiftc -O -whole-module-optimization`):

```swift
func labelFor(_ type: String) -> String {
    switch type {
    case "warmup":   return "Warm Up"
    case "cooldown": return "Cool Down"
    case "recovery": return "Recovery"
    default:         return "Section \(1)"
    }
}
```

This program runs correctly (`./test_release warmup` → `Warm Up`,
`./test_release cooldown` → `Cool Down`) — but `grep -a -c` finds **zero**
occurrences of `"Warm Up"`, `"Cool Down"`, `"Recovery"`, `"Section "`,
`"warmup"`, or `"cooldown"` in the compiled binary. Swift's `String` type
bit-packs any ASCII literal of 15 bytes or fewer directly into the generated
machine code (small-string optimization) rather than storing it as a
separate, `strings`-visible byte sequence in a data section — so this grep
check cannot see short string literals in an optimized binary regardless of
whether the code is correct. (The report's earlier grep on build 248 still
correctly diagnosed *that* build as missing the fix — but for reasons
independent of the grep: the timestamp evidence stood on its own, and the
grep's 0-count happened to agree by coincidence rather than by working as
designed.)

## 6 · Real verification: rendered the exact unmodified fix code, per Rule 13

Grep being unreliable for this class of string meant I needed a rendering-
based check instead of trusting either "0 occurrences" or "ancestry" alone.
Built a Debug/Simulator binary from the identical working tree
(`git hash-object` on `TodayAfterV5.swift` matched `HEAD`'s blob exactly, no
local diff) via:

```
xcodebuild -scheme Faff -configuration Debug \
  -destination "id=8829D8FB-278F-458A-B895-C7E799F07E78" \
  -derivedDataPath /tmp/faff-verify-build build
```

`TodayAfterV5.swift` itself was never touched. To get real `type`-tagged
phase data onto the actual compiled `sectionPieces` switch without needing
the account owner's login, I used the app's own no-network QA gallery
(`ScreensCatalogV5`, reached via `xcrun simctl launch <udid> run.faff.app
-faffV5Screens 5b-sections` — documented in the file's own header comment)
and temporarily edited its `BreakdownV5Samples.reps` **test fixture** (not
the fix code) to add `"type"` keys and set `workoutType: "intervals"`, so
the shape resolver would route through `RepBreakdownV5`/`sectionPieces`
instead of a plain mile table. This is app QA scaffolding that already
existed for exactly this purpose — no account credentials, no
sign-in, no network dependency, and no change to the switch statement being
verified. Reverted immediately after screenshotting
(`git checkout -- native-v2/Faff/Faff/ViewsV5/BreakdownV5Samples.swift`,
confirmed clean via `git status --short`).

Rendered, screenshotted, and read directly off the simulator screen — the
"REP BY REP" card:

| Row | Distance | Pace |
|---|---|---|
| Warm Up | 1.20 mi | 7:32/mi |
| Interval 1 | 0.62 mi | 10:52/mi |
| Recovery | 0.25 mi | 35:12/mi |
| Interval 2 | 0.62 mi | 10:44/mi |
| Recovery | 0.25 mi | 35:24/mi |
| Interval 3 | (scrolled off) | 10:56/mi |
| Cool Down | 1.06 mi | 8:38/mi |

Correct names, not "Section N". This is the exact `sectionPieces` switch
from `TodayAfterV5.swift:1226-1227` (`case "warmup": label = "Warm Up"`,
`case "cooldown": label = "Cool Down"`) executing and rendering correctly,
compiled from source proven byte-identical to what fed the archive, using
the same Xcode toolchain and the same `Faff` scheme/target (only
configuration/destination differ: Debug/Simulator here vs. Release/device
for the archive — nothing in this switch statement is Debug/Release- or
platform-conditional).

**Neither the archive nor its exported IPA were touched by this
verification.** The Debug/Simulator build was a fully separate artifact at
`/tmp/faff-verify-build`; `/tmp/Faff-v2.xcarchive` and
`/tmp/Faff-v2-export/Faff.ipa` from the real ship remained exactly as
produced.

## 7 · Freshness re-checked once more, then uploaded the untouched archive

```
git fetch origin main
# HEAD (7cac80f0...) == origin/main (7cac80f0...) — still fresh, no drift
xcrun altool --upload-app -f /tmp/Faff-v2-export/Faff.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

```
UPLOAD SUCCEEDED with no errors
Delivery UUID: fd01f336-29f5-40de-b90b-e9d1d6e377bb
Transferred 17429717 bytes in 0.178 seconds
```

## 8 · Processing, comply, autoship

Polled `python3 scripts/asc.py status` every 20s. Build 249 went `VALID` at
16:20:13 PT (uploaded 16:13:11 PT):

```
build 249: VALID (uploaded 2026-09-01T16:13:11-07:00)
```

```
$ python3 scripts/asc.py comply
✓ build 249 already export-compliant (declared in Info.plist).

$ python3 scripts/asc.py autoship
✓ build 249 added to beta group 1faa228e-0164-492c-b8c4-0d8b94f039bd — available to those testers.

$ python3 scripts/asc.py status
build 249: VALID (uploaded 2026-09-01T16:13:11-07:00)
```

## Result

- **Build 249, version 3.0.1**, built from `main` @ `7cac80f0` (contains both
  `6b37e71f` and `8646b38f`).
- Uploaded, processed (`VALID`), export-compliance confirmed, and added to
  the Internal Testers beta group — available now.
- **Fix confirmed present** via real rendering against the unmodified fix
  code (not the unreliable grep) — screenshot evidence in §6 above.

## What went into git

- `legacy/native/.asc.build` bumped 249 → 250 by the ship script (the
  build-number reservation happens before archiving). Committed.
- The scratch verification script (`scripts/.ship-tf-v2-verified.sh`) and the
  temporary test-fixture edit to `BreakdownV5Samples.swift` were both
  reverted/deleted — neither is part of this commit.

## Follow-up flagged, not fixed here

Two things worth a deliberate, separately-reviewed change to
`scripts/ship-testflight-v2.sh` itself (out of scope for this ship, per the
same discipline the previous report used):

1. **Add the pre-archive freshness re-check and post-export binary-
   verification gate permanently**, so every future ship gets them without
   a scratch copy.
2. **Replace (or supplement) the short-string grep with a check that
   survives Swift's small-string optimization** — e.g. grep for a longer,
   unique substring that cannot be SSO-inlined (15+ bytes, such as a whole
   distinctive sentence from a nearby comment or a longer compound literal),
   or stamp a git SHA into the binary at build time (`Info.plist` custom key
   or a `#if` const) and check that instead of trying to detect specific UI
   copy in the compiled bytes at all. The current check would report "fix
   absent" on every correctly-built Release archive touching this code path,
   which is a false-negative gate that would block every future ship of this
   screen if trusted literally — exactly the "gate that answers a nearby
   question instead of the one that matters" shape Rule 18 warns about.
