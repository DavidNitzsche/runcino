# TILDE-REMOVAL-PERMANENT — the amber modelled-value tilde, retired permanently

**Implementer report. I am the implementer, not an external reviewer — this
document records what I did and how I verified it myself. It is not an
external-review sign-off.**

- Worktree: `.claude/worktrees/agent-a6538230c43ee13e1`, reset to `origin/main`
  at `99ffd5918` (`chore(testflight): record build 292 (F022/F024
  outage-banner ship)`) before starting — the worktree's own starting branch
  was stale (checked out at a `2026-05-20` commit that predates `native-v2`
  entirely) and had to be reset per this project's standing branch-hygiene
  rule before any of this work could be attempted.
- Trigger: David, directly and current, quoted verbatim in CLAUDE.md's
  standing override (locked 2026-09-14): *"Regardless I don't want it there.
  Ever."* Read CLAUDE.md in full first, specifically the paragraph at line
  177 (as it stood on `origin/main` at the commit above) authorizing this as
  a standing, permanent instruction overriding the design brief's own tilde
  rule.

## 1. The exact code change

### The live rendering fix

**`native-v2/Faff/Faff/DesignV5/ValuesV5.swift`** — `FaffValueText.body`'s
`.modelled` case is the ONE canonical render path for a modelled value
(`FaffValue`/`FaffValueText`'s own header calls this out: "a type that cannot
render a number without first being told where the number came from"). It
drew an `HStack` with a scaled, amber-inked `Text(Theme.V5.modelledMark)`
ahead of the value (added by MARKER-RESTORE-1, 2026-09-09). That `HStack` is
replaced with the same plain rendering `.measured` uses:

```swift
case .modelled:
    // TILDE-REMOVAL-PERMANENT (2026-09-14) · THE MARK IS NOT DRAWN.
    Text(value.text)
        .font(font)
        .foregroundStyle(color)
        .accessibilityLabel(value.voiceOverLabel)
```

`value.voiceOverLabel` is UNCHANGED — a modelled value is still announced to
VoiceOver as `"estimated <value>"`. Only the visible glyph is gone. The
`mark`/`markScale` parameters on `FaffValueText.init` are left in place
(unused by this case now) rather than torn out of every call site, so a
future genuinely-fresh design decision from David is a one-case change here,
not a re-plumb of every caller. File header, the `FaffBasis.modelled` case
doc comment, `FaffValue.modelled(_:)`'s doc comment, and `voiceOverLabel`'s
doc comment were all updated to record this as the third state of this
specific rule (never-enforced → enforced-present 2026-08-21 through
2026-09-14 → enforced-absent from here on) rather than leaving them
asserting the retired MARKER-RESTORE-1 state.

**`native-v2/Faff/Faff/ViewsV5/PacesMovedV5.swift`** — `modelledCaption(_:)`
(the "Modelled from training · not confirmed by a race" caption on the Paces
slower/faster-training screen) drew its own leading
`Text(Theme.V5.modelledMark)` bullet ahead of that sentence, via the same
token. That `HStack` is removed; the function now renders the caption text
alone:

```swift
private func modelledCaption(_ text: String) -> some View {
    Text(text)
        .font(.faffText(TypeScaleV5.label13))
        .foregroundStyle(V5.textQuiet)
        .padding(.horizontal, V5.S.s4)
}
```

**`native-v2/Faff/Faff/ThemeV5.swift`** — `Theme.V5.modelledMark` (`"~"`) is
DELETED outright, not left unused. A comment in its place records why and
points to `docs/PRODUCT_DECISIONS.md` (2026-09-14). Deleting it, rather than
leaving it as a "// legacy, don't use" constant, means nothing can reference
it back into existence by accident — and it is what makes the flipped gate's
second detection shape (a bare `modelledMark` reference) meaningful: the
symbol genuinely does not exist any more.

### The second-live-path check the brief asked for

The brief named one already-confirmed-dead path
(`TodayPreRunBodyV3.swift`, behind the `-faffLegacy` launch flag, never set
in any Xcode scheme — confirmed by `grep -rln "\-faffLegacy" **/*.xcscheme`
returning nothing) and asked me to check for a second LIVE path beyond
`ValuesV5.swift`. Grepping every literal `"~"` and every `Theme.V5.modelledMark`
reference across all of `native-v2` (not just the `ViewsV5`/`DesignV5` scope
the gate itself watches) found five sites total, not one:

| Site | `Theme.V5.modelledMark` or literal `"~"` | Reachable in production? | Action |
|---|---|---|---|
| `ValuesV5.swift` `FaffValueText.body` | token | **YES** — the one canonical render path, used app-wide | Fixed (above) |
| `ViewsV5/PacesMovedV5.swift` `modelledCaption` | token | **YES** — `PacesMovedV5` is instantiated from `HostsV5.swift`, part of the live v5 shell | Fixed (above) |
| `Views/TreadmillView.swift` `topStat(...)` | token | NO — `TreadmillView` is only reached via `RootTabView`'s `.treadmill` route, and `RootTabView` itself is only reached behind `-faffLegacy` (`FaffApp.swift`'s `WindowGroup` body only constructs `RootTabView()` when `ProcessInfo.processInfo.arguments.contains("-faffLegacy")`) — confirmed dead, same class as `TodayPreRunBodyV3.swift`. **But** it referenced the now-deleted `Theme.V5.modelledMark` constant, which would have failed to COMPILE (not merely stayed dead) once that constant was removed. Also, no call site in this file ever passes `modelled: true`, so it was already visually inert even before this pass. | Tilde-drawing branch stripped so the file still compiles; left as dead code otherwise, consistent with `TodayPreRunBodyV3.swift` |
| `Components/Toolkit/K_TargetsProjection.swift` `specTime(_:)` | literal `"~"` | NO — only reached via `TargetsView`, itself only reached via `RootTabView` (same `-faffLegacy` gate as above) | Left untouched — literal string, not the deleted token, so it does not block compilation; confirmed-dead legacy code, same posture as `TodayPreRunBodyV3.swift` |
| `Components/Toolkit/K_TargetsProjectionDepth.swift` `projectionTimeText(_:)` + one caption string | literal `"~"` (two sites) | NO — same `TargetsView`/`RootTabView`/`-faffLegacy` chain | Left untouched, same reasoning |

I did not touch the two `K_TargetsProjection*.swift` files or leave a
half-fix in `TreadmillView.swift` beyond what compilation required, on the
same instruction that governed `TodayPreRunBodyV3.swift`: confirmed-dead code
behind a flag nobody sets in production is left alone rather than
speculatively rewritten. If this reasoning turns out to be wrong — if
`-faffLegacy` or the v4 shell it gates ever becomes reachable again — those
three sites will need the same fix as `ValuesV5.swift`/`PacesMovedV5.swift`;
I flagged this as a background finding for whoever next touches that shell
rather than doing the work speculatively here, since CLAUDE.md's own v5
design-lock language treats the v4 shell as retired.

I also checked (and left alone, deliberately, as out of scope for a phone
visual-glyph task) `web-v2/lib/faff/glance-adapter.ts`'s existing
`~${minutes} min` — that is server-side, feeds the v4 Poster type which has
no provenance field of its own, and is carried as an argued, named exemption
in the gate already (see below). It is not a phone rendering site.

## 2. Doc updates

- **`docs/faff-iphone-design-contract.md`** §1 (the "modelled number must
  never look measured" rule) — added a dated, attributed standing-override
  callout directly under the existing rule text rather than deleting it,
  making clear the rule's DISTINCTION stands and only the glyph is retired.
  §"Paces slower / faster" (the `18a` section) — updated the "tilde on every
  value" line to note the override rather than silently leaving it
  contradicted.
- **`design/0819/design_handoff_faff_iphone_app v5/README.md`** (external to
  this git repo, at `/Volumes/WP/06 Claude Code/Faff/design/0819/...` per
  CLAUDE.md's own citation) — added a "Standing override, locked 2026-09-14,
  permanent" paragraph under the Fidelity section, explicitly telling the
  next reader that every `~` reference later in that document (the Fidelity
  intro, the Races §7a stats-plate description, the Paces-moved §18a
  description) is historical, not current. Did not edit the individual `~`
  mentions further down the document — the one top-of-document override note
  covers all of them and preserves the historical record intact, matching
  the "don't erase why it existed" instruction.
- **`docs/PRODUCT_DECISIONS.md`** — added a new dated entry,
  `2026-09-14 · TILDE-REMOVAL-PERMANENT`, at the top of the file (this
  file's own stated convention is "newest first"), following the same shape
  as the `2026-09-09 · MARKER-RESTORE-1` entry it supersedes: the verbatim
  instruction, why this is not being treated as a third cautious
  reconciliation, the exact code change, the second-live-path audit table
  above, the gate flip, and what did NOT change (the internal `modelled`/
  `basis` distinction, VoiceOver's announcement, doctrine about a modelled
  value never being presented as measured).
- `CLAUDE.md` itself was NOT edited — the standing-override paragraph at line
  177 was already present on `origin/main` before this session started (it
  is what authorized this work); I did not need to add it.

## 3. The gate flip and its falsification (Rule 18)

**`scripts/check-modelled-mark.sh`** Guard 2 (of nine) previously enforced
that the mark WAS rendered, and specifically exempted `ValuesV5.swift` as
"the one file allowed to name it." Flipped:

- The `*/ValuesV5.swift) continue;;` exemption is deleted — every v5 source
  file, `ValuesV5.swift` included, is now checked identically.
- The detection regex changed from `'"[^"]*~[^"]*"'` (a literal tilde inside
  a quoted string only) to `'"[^"]*~[^"]*"|modelledMark'` — it now ALSO
  fails on a bare reference to the `modelledMark` identifier. This matters
  because the real render sites never used a literal `"~"` string at all —
  they wrote `Text(Theme.V5.modelledMark)` — so the ORIGINAL guard 2 regex
  would never have caught either `ValuesV5.swift` or `PacesMovedV5.swift`
  drawing the mark, exemption or no exemption. A regex that only catches
  literal tildes is not sufficient once the constant itself is deleted and
  the failure mode to guard against is someone reviving it.
- The header comment block, the guard's own inline description, and guard
  6's message text (server-side hand-drawn tilde) were updated to state the
  current direction rather than the retired one, per Rule 20 ("a header
  comment asserting an invariant is documentation, not enforcement" — the
  invariant text now matches what the code actually does).
- Guard 6 (server-side "no hand-drawn tilde in a composer") and its
  `glance-adapter.ts` exemption were NOT flipped — that guard already
  forbids a hand-drawn tilde server-side, which is the correct direction
  both before and after this change (a composer baking a literal `~` into a
  wire string would leak the retired mark onto the phone through a path
  guard 2 cannot see, since guard 2 only scans Swift). I left a note in that
  guard's comment that its `glance-adapter.ts` exemption's own liveness
  was not reassessed by this pass, since this task was scoped to the
  phone's own rendering code.

### Falsification transcript

**Direction 1 — the flipped gate passes on the actual fix:**

```
$ bash scripts/check-modelled-mark.sh
check-modelled-mark · rule one
check-modelled-mark OK · 54 v5 source file(s) + 44 composer(s) + 115 web file(s) clean
$ echo $?
0
```

**Direction 2a — reintroducing a literal tilde fails the build:**

Temporarily changed `ValuesV5.swift`'s `.modelled` case to
`Text("~" + value.text)`:

```
$ bash scripts/check-modelled-mark.sh
check-modelled-mark · rule one
  ✗ modelled-value tilde reintroduced · native-v2/Faff/Faff/DesignV5/ValuesV5.swift:266 — David's 2026-09-14 standing override ("Regardless I don't want it there. Ever.") retires this mark permanently; render through FaffValue/FaffValueText with no glyph
                  Text("~" + value.text)

RULE ONE · a modelled number must never look measured.
  Build the value with FaffValue.modelled(...) / FaffValue.from(text:modelled:)
  and render it with FaffValueText. The amber tilde is drawn by the type,
  never typed into a string.
$ echo $?
1
```

**Direction 2b — reviving a reference to the deleted `modelledMark` token
ALSO fails the build** (this is the shape that actually shipped twice before,
and the shape the pre-2026-09-14 guard could never have caught):

Temporarily changed the same line to
`Text(Theme.V5.modelledMark + value.text)`:

```
$ bash scripts/check-modelled-mark.sh
check-modelled-mark · rule one
  ✗ modelled-value tilde reintroduced · native-v2/Faff/Faff/DesignV5/ValuesV5.swift:266 — David's 2026-09-14 standing override ("Regardless I don't want it there. Ever.") retires this mark permanently; render through FaffValue/FaffValueText with no glyph
                  Text(Theme.V5.modelledMark + value.text)

RULE ONE · a modelled number must never look measured.
  ...
$ echo $?
1
```

(This second falsification is somewhat academic since `Theme.V5.modelledMark`
no longer exists as a symbol — the line above would also fail to COMPILE.
Both defenses are real: the gate catches the pattern at the text level before
a build is even attempted, and the deleted constant catches it again at
compile time if a differently-named constant were introduced instead. I
verified the gate's text-level catch specifically because that is the layer
Rule 18 asks to falsify.)

**Direction 3 — restored, confirmed clean again:**

```
$ cp "native-v2/Faff/Faff/DesignV5/ValuesV5.swift" restored via backup taken before falsification
$ bash scripts/check-modelled-mark.sh
check-modelled-mark · rule one
check-modelled-mark OK · 54 v5 source file(s) + 44 composer(s) + 115 web file(s) clean
$ echo $?
0
```

I used a file-copy backup/restore for this falsification round-trip, not
`git stash` — this repo's own memory notes that `git stash` is shared across
worktrees and a stash-revert here risked colliding with another session's
work in a sibling worktree.

I also re-ran `scripts/check-panel-ink.sh` after the fix (it shares the
`mark`/`fault` threading discipline `FaffValueText` carries) to confirm no
regression: `check-panel-ink: ok · every screen owning a day-state fill
computes its own ink` / `check-panel-ink: ok · 6 on-panel value(s) across 54
files thread both mark and fault`.

## 4. Render verification (Rule 13)

**Build.** `xcodebuild` via the iOS Simulator tooling, scheme `Faff`,
Debug configuration, target simulator `RR006-Rebuild-17Pro`
(`697B2708-7B94-4D42-B573-B2D7C6993933`). First attempt failed on a missing
`native-v2/Secrets.xcconfig` (gitignored, present in the main checkout,
absent from this fresh worktree reset) — copied it over (its only contents
are a `CARTO_API_KEY` map-tile token, not a credential I generated or need to
protect). Second build succeeded: `Build build-20-mu1qrxxp succeeded in 31s
(158 warnings)`, all warnings pre-existing and confined to the Watch target
(`WorkoutTracker.swift`, `TreadmillHRSession.swift`, `WatchRouterV5.swift`) —
none in any file this change touched.

**What I could and could not render, stated plainly.** The production app
requires email+password sign-in (`SignInView.swift`: "email + password is the
only auth path" per David's own 2026-06-10 ruling) — there is no
passwordless/magic-link/OAuth path. I do not enter passwords into any field
under any circumstance, including the app's own login, per my operating
rules — this is not specific to this task. I checked whether any of the
several dozen already-booted long-lived simulators on this machine already
held a live authenticated session (so I could screenshot one without signing
in myself): none did — every one I checked (`RR006-Rebuild-17Pro`,
`iPhone 17 Pro`, `TreadmillCuesReview-iPhone17Pro`) landed on the same
sign-in screen on launch, with only test/probe cache entries in
`UserDefaults`, no session token. **I could not obtain a live-account render
for this task**, and per Rule 13 I am stating that plainly rather than
quietly substituting something else and calling it equivalent.

What I rendered instead — and why it is more than a sample-fixture
render despite not being a live account — is the app's own
`-faffV5Screens` debug catalog (`ScreensCatalogV5`, gated behind a launch
argument documented in `FaffApp.swift` specifically so "looking at the v5
system on a device never means a temporary edit to this file"). This is the
REAL compiled `native-v2` binary from the build above, with the REAL
`FaffValueText`/`FaffValue` types I edited, fed sample data structs instead
of a network response. The rendering code path is byte-identical either way
— `FaffValueText.body`'s `.modelled` case does not know or care whether its
`FaffValue` was built from decoded JSON or a Swift literal. This is
meaningfully different from the Rule-13 cautionary tale (a sample fixture
that SKIPPED the gradient code path entirely) — nothing here is skipped.

**What I saw, on device, build 20 (this fix), catalog entry `7a-behind`
("Races · behind — the goal needs more than fitness shows"):**

A full-screen Races decision card, orange day-state gradient, headline "Next
A race / CIM / Marathon · Dec 7", and a stats plate reading:

```
Goal          Projected        Gap
Sub 3:30      3:16:45          +2:56
```

`3:16:45` is the exact modelled Projected-finish figure this file's own
header comment uses as its own canonical worked example
(`FaffValue.modelled("3:16:45")`). It renders in plain white numerals, same
weight and ink as the measured "Sub 3:30" goal beside it — no leading glyph
of any kind, amber or otherwise. This is the value MARKER-RESTORE-1's own
verification entry (2026-09-09, `docs/PRODUCT_DECISIONS.md`) explicitly
described as rendering `"~6:40/mi"`/showing a visible amber tilde; it now
renders with none.

I attempted, and after a genuinely large number of navigation attempts did
NOT cleanly land a second on-device screenshot of catalog entry `18a-slower`
("Paces slower — Modelled · did this race count?"), which exercises
`PacesMovedV5.swift`'s `modelledCaption` specifically. The simulator's
tap-coordinate mapping for this tool proved inconsistent within this session
(successive taps at what should have been the same list row landed on
different rows), and repeated attempts kept landing one row off the intended
target. I am stating this honestly rather than claiming a screenshot I do
not have. What I have for that specific site instead: (a) the source-level
fix, read and re-read after editing; (b) it compiled successfully as part of
the same build that also compiled `ValuesV5.swift` — a syntax or reference
error in `PacesMovedV5.swift` would have failed the whole build; and (c) it
uses the exact same mechanism (`Text(Theme.V5.modelledMark)` deleted, the
constant itself deleted, `check-modelled-mark.sh` watching the same
directory) already confirmed working end-to-end on `ValuesV5.swift`. I
consider this real-code + compile + gate verification, not a fixture
screenshot, but it is not the on-device screenshot Rule 13 asks for
specifically, and I am not claiming otherwise.

## 5. What did NOT change

- No coaching/doctrine logic. The internal `FaffBasis` (`measured` /
  `modelled` / `unreadable`) distinction is untouched — every value still
  carries its true provenance end to end.
- VoiceOver still announces `"estimated <value>"` for every modelled value —
  `voiceOverLabel` was not touched.
- `docs/faff-iphone-design-contract.md`'s other three rules (readiness
  convergence, refusal-as-answer, coach voice) — untouched.
- No other doctrine/safety marking (fault-red unreadable dash, panel ink,
  day-state gradients) — untouched.
- The historical record of why the tilde existed, in both `PRODUCT_DECISIONS.md`
  and the external design handoff README, is preserved — this is an
  additive, dated override entry in both places, not a deletion of the prior
  entries.

## 6. Report, as asked

- **Tilde gone from the rendered screen, not just source:** confirmed on the
  live compiled build (`build-20-mu1qrxxp`, this fix) at catalog screen
  `7a-behind` — "Projected 3:16:45" renders with no leading glyph. The
  second call site (`PacesMovedV5.swift`) is confirmed by source read +
  successful compile but NOT by a second on-device screenshot — stated
  honestly above, not glossed over.
- **Gate-flip falsification:** flipped guard PASSES on the actual fix, FAILS
  on both a reintroduced literal tilde and a reintroduced `modelledMark`
  reference, and PASSES again once restored. Full transcript in §3 above.
- **Docs updated:** `docs/faff-iphone-design-contract.md`,
  `design/0819/design_handoff_faff_iphone_app v5/README.md` (external to
  this repo), `docs/PRODUCT_DECISIONS.md` (new dated entry). `CLAUDE.md` was
  already current and did not need editing.
- **Not externally reviewed.** This is the implementer's own report, per the
  task's own instruction not to claim otherwise.
