# F132 -- the banned tilde mark, live on David's real Today screen (and elsewhere)

## The relayed diagnosis didn't match the source -- checked directly first

The dispatch described `scripts/check-modelled-mark.sh` as actively
*enforcing* the tilde's presence, such that patching a screen's string
without touching the script would just have the CI gate reintroduce it.
Read the script in full before touching anything: it does not enforce
presence anywhere. Its guards enforce *disclosure* -- no hand-drawn tilde,
no stripping a mark a composer already set, no raw modelled field, no
`modelled: false` on a source that's a model by construction. Nothing in
it requires a visible glyph to exist. That framing was wrong; the real
root cause was different and, in one place, considerably more serious.

## The real root cause, found by reading source directly

`native-v2/Faff/Faff/DesignV5/ValuesV5.swift` -- the ONE file the whole
app is supposed to route every modelled number through -- was still
drawing the tilde live on `origin/main`. Traced via `git log`/`git blame`:
commit `adcea6f15b`, dated 2026-09-09, titled "MARKER-RESTORE-1," reverted
the correct 2026-08-21 removal and restored the visible glyph, citing a
three-sentence quote attributed to "David's explicit instruction this
round." CLAUDE.md's own Rule 24 section already documents this exact
commit as a **fabricated attribution** -- David disputed the quote,
independently, before anyone investigated, and the quote appears nowhere
except that commit and a same-session decision-log entry restating it. A
separate, genuinely real, dated David quote exists in the same file's
history ("we dont need the tilde. its obvious and implied the number is
calculated") -- informal, lowercase, and the one CLAUDE.md's 2026-09-14
standing override actually rests on.

Despite the standing override explicitly saying "do not restore it a
third time," the fabricated commit's content was still live on
`origin/main` at the start of this fix. This is the actual mechanism
behind "three instances, one screen" -- `FaffValueText` is the single
render path nearly every modelled value in the app goes through, so its
restored glyph reaches every screen that uses it, Today included.

**A genuine, independently-verified fix for this exact file was already
sitting uncommitted in the shared main checkout** (not on any branch,
working-tree only), citing the same real quote CLAUDE.md's override rests
on. Read it fully before trusting it, confirmed it correctly reverts only
the MARKER-RESTORE-1 content and nothing else, and used it rather than
re-deriving the same fix blind. The other ~35 files and ~2800 lines of
unrelated uncommitted changes sitting in that same checkout were left
completely untouched -- not part of this fix, not mine to commit or
discard.

## Six more real, live sites found by directly reading source, not by
## trusting the dispatch's characterization

The v5-scoped guard (`ViewsV5`/`DesignV5` only) structurally cannot see
pre-v5 `Views/`/`Components/` files still wired into the live app. Checked
each file's actual call sites before fixing anything, since an earlier
pass of my own wrongly assumed two of these were dead code -- corrected
before finishing, not left as a guess:

1. `Components/TodayPreRunBodyV3.swift` -- 3 hand-drawn tildes (est. time,
   two HR-target strings), live in Today's pre-run sheet
   (`TodayView.preRunSheetContent`). Very likely the actual "three
   instances, one screen."
2. `Views/RaceDayView.swift` -- fueling-cadence copy, live and reachable
   directly from Today (`TodayView.swift:214`) and from the race-day tab
   route.
3. `Views/WatchMirrorView.swift` -- "MIN EST" stat, live (routed from
   `RootTabView`).
4. `Views/TreadmillView.swift` -- `topStat`'s `modelled` branch drew the
   glyph conditionally on `distanceIsModelled`; the screen's own
   `provenanceNote` already states the estimate in words whenever that
   flag is true, so the glyph was pure redundancy.
5. `ViewsV5/PacesMovedV5.swift` -- `modelledCaption` drew the glyph ahead
   of a sentence that already says "Modelled from training" in words; this
   file's own prior comment already called the glyph "punctuation, not a
   mark" and hid it from VoiceOver for that reason, just never removed it
   from sighted view.
6. `Components/Toolkit/K_TargetsProjection.swift` /
   `K_TargetsProjectionDepth.swift` -- both live, wired into `TargetsView`
   (confirmed via the real struct names, `TargetsProjectionPanel` /
   `TargetsProjectionDepth`, not the file names -- my first pass grepped
   the wrong identifiers and wrongly called these dead).

`ThemeV5.swift`'s `modelledMark` token itself is removed, not just its
call sites -- per the standing override's own language ("if a future need
... arises, it needs a fresh design decision from David, not a revival of
this specific mark"), so there is nothing structurally left to reach for.

## What was deliberately left alone

`Models/ToolkitPayloads.swift`'s `RaceProjectionEntry.timeDisplay` still
strips a legacy server-drawn `~` prefix defensively (`hasPrefix`/
`dropFirst`) -- this is cleanup of an old server shape, not drawing
anything, so it's correct to keep and was annotated `// ok:` for the
now-broadened guard rather than removed. `PanelInk.mark`/`FaffValueText`'s
`mark`/`fault` color parameters are still threaded through every call
site (`BlockV5`, `RacesV5`, `StateScreensV5`, `TodayAfterV5`, `PanelV5`)
even though `FaffValueText`'s `.modelled` case no longer reads `mark` --
left as dead-but-harmless plumbing rather than a wider refactor touching
5 more files during an urgent fix; noted here as a real, low-priority
follow-up cleanup.

`legacy/native/Faff/Faff/TodayView.swift`'s own tilde-drawing helper
exists but is confirmed NOT part of the shipping build -- zero references
in `native-v2/Faff.xcodeproj/project.pbxproj` -- so it was not touched.

## Widened the build gate so this can't quietly recur

`scripts/check-modelled-mark.sh`'s guard 2 (no hand-drawn tilde) was
scoped to `ViewsV5`/`DesignV5` only. Widened it to scan the entire
`native-v2/Faff/Faff` tree, since the standing override is unconditional
and app-wide, not a v5-surface-only rule the way guards 1 and 3
legitimately are. `ValuesV5.swift`/`ThemeV5.swift` stay exempt (they
document the retirement, they no longer draw anything).

## Verification

- `bash scripts/check-modelled-mark.sh`: clean, zero violations, 54 v5 +
  44 composer + 115 web files scanned.
- Full app-wide `grep -rn '"[^"]*~[^"]*"' native-v2/Faff/Faff --include='*.swift'`
  outside comments and `// ok:` lines: zero remaining matches.
- `xcodebuild test -scheme Faff -only-testing:FaffTests`: **552 tests
  executed, 0 failures, TEST SUCCEEDED**, on a clean `origin/main`-based
  worktree (isolated from the shared checkout's large unrelated
  uncommitted pile).
