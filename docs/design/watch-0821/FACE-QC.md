# Watch face build standard

Every board is built and checked against this. It is not style guidance — each
line is a defect that actually shipped on 2026-08-23 and was caught by David
looking at a screenshot.

## Sizing

1. **Everything in a per-point calculation scales.** A literal `4` inside a
   "width per point of type size" cost swamped the fractions at size 1 and made
   every board render at a third of its size. A constant inside a ratio is a
   bug with a plausible face.
2. **One size per column. No `minimumScaleFactor` on a metric value.** It let
   whichever row overflowed quietly opt out, so the row carrying a unit rendered
   visibly smaller than its neighbours. If the width estimate is wrong the fix
   is the estimate, not a per-row escape hatch.
3. **Units are short.** `avg`, not `/mi avg`. No `on goal`. The longest string
   in the column sets the size for every row in it, so a nine-character unit
   costs ~4pt of type on all four.
4. **Size comes from available height ÷ metric count, capped by width.** Never
   a fixed ladder.

## Labels

5. **No labels. Anywhere.** Not on metrics, not phase names. A runner who
   configured a threshold session does not need the word THRESHOLD; that screen
   is designed for somebody meeting it for the first time mid-marathon, which is
   nobody. Removing the phase label handed the numbers ~20pt.
6. **The accessibility layer stays explicit.** `accessibilityLabel` carries the
   word the screen does not draw.

## Answerability

7. **A graded metric needs its band.** Colour says whether the runner is holding
   the ask; it never says what the ask IS, which is the only thing that lets
   them correct. The lit segment is the target, the dot is the runner.
8. **The band reserves its own height.** It is drawn inside the graded row's
   slot; without a reserve it lands on top of the row below. Tightening the
   line spacing is what exposed this.
9. **The lit segment goes white the moment the mark leaves it.** The strip can
   never show two greens, so it agrees with the number above it by construction.

## Placement

10. **Nothing in the top strip.** The system clock owns it and the app cannot
    restyle or move it. Two pieces of small grey text sharing that line read as
    clutter.
11. **Reference info is centred at the foot**, and may sit 12pt into the bottom
    inset — safe there because the corner curve bites at the CORNERS and the
    middle of the bottom edge is the flattest point on the display. The same
    offset on the left edge would not be safe.
12. **Optical alignment for non-numeric text.** Every row's frame starts at the
    same margin; the glyph does not. An uppercase T has almost no left side
    bearing where digits do — measured 13.0 vs 15.0pt. Nudge the text, not the
    frame.
13. **Colour is coaching state, never metric identity.** Neutral by default;
    green on target; amber drifting; red names a sensor in words and never a
    figure.

## The shell

14. Usable content is **196pt on a 46mm** (30/22 insets, full-bleed) — not the
    150 a titled screen gets, and not the 143 of a plain scene. Vertical paging
    with chrome hidden costs nothing.
15. Telemetry is **SF Compact Rounded, `.monospacedDigit()`**. Archivo is for
    branded display moments and never on a number that changes every second.

## Verification — this is where the failures actually came from

16. **Build to the path you install from.** `-target` without `-derivedDataPath`
    writes somewhere else, and installing the stale binary made a working
    migration look broken.
17. **Check the binary's mtime before trusting a screenshot.**
18. **Screenshots lie about corners.** The corner mask is not in the framebuffer,
    so edge fit cannot be judged from one. Simulator window > screenshot; real
    device > both.
19. **Ugly fixtures, always**: `12:34`, `1:11:48`, `10:59`, `100.0`, `1,002`,
    `--:--`, `89`, `204`. Round numbers hide width bugs — the size bug survived
    a 12-cell matrix because the matrix used short values.
20. **After touching a shared component, re-check EVERY board**, not the ones
    you changed. That is exactly how the width bug reached David.

## Rulings that override the 0821 handoff (locked 2026-08-24)

The handoff is the design bible and these four lines of it are superseded.
They are recorded here because each one is a place where reading the handoff
alone would lead you to "fix" the build back into a defect. If you are about
to change one of these, you are reverting a decision, not correcting a bug.

21. **Metrics on a running face are all the same size.** The handoff's rule 4
    says "the metric that matters is first and ~20% larger than the next, so
    the hierarchy survives a runner who cannot distinguish the two hues."
    Overridden: the column is one size. Hierarchy comes from order and from
    the band, which is a stronger cue than 20% of point size and does not cost
    the other three rows any height.

22. **The delta against goal carries no unit.** `−0:22` with `sub 3:30` at the
    foot, signed always. Not "on goal", which is seven characters of label
    wearing a unit's clothes and would set the type size for all four rows.

23. **Green marks today on the week strip.** This is a second meaning for the
    colour that rule 1 reserves for "inside the band". Accepted: the strip is a
    position marker and not a figure, so it does not read as a graded number.
    Do not extend the exception to anything that is a number.

24. **No phase name on a steady-state board.** The handoff's §3 says each phase
    board "names the phase, the count, and the target band". The count and band
    stay; the name goes. It is not lost — the phase-change moment announces it
    in the display register at the transition, and the board underneath then
    never repeats it. Removing it handed the numbers about 20pt.

## Controls (locked 2026-08-24)

25. **Colour carries the hierarchy on the controls board, and only there.**
    White leads, amber pauses, red ends. Everywhere else colour is reserved for
    the graded metric, because a coloured number reads as a graded number —
    this board has no numbers on it, so nothing is present that a hue could be
    mistaken for a judgement about. Apple's own Workout controls are a red End
    and an amber Pause.
    **Amber, never signal orange.** `#FF5A1F` is about ten degrees from fault
    red `#FF4438`; stacked adjacently the two bands read as one colour at arm's
    length. Rendered and confirmed, not argued.
    Red as a filled target does not break rule 7: End run is not the
    destructive step, it opens End confirm, where the discard is still text.

26. **No Lap verb on a steady run.** It was the only verb in this app whose
    effect the runner could not see — it closed the current segment, and no
    board draws a lap figure. `lapCount` and `lastLapElapsedSec` exist in the
    engine and are never rendered, so the controls dismissed and every number
    on screen was identical. Renaming it "Split" was rejected: a better-named
    invisible action is still invisible. Nothing is lost — the run auto-splits
    every mile, the summary lists them, and the Split moment announces each one.
    Inside a rep the slot returns as Skip rep, which has a visible consequence.

27. **A gap under the clock is measured from the clock, not from the top.**
    The system clock's ink ends at 27.5 on a 42mm, 31 on a 46mm and 33.5 on an
    Ultra — no fixed offset and no clean fraction. `Guides.clockInkBottom`
    carries the measured value and `clockClearance` derives from it. A fixed
    36pt clearance gave gaps of 16.5 / 13 / 10.5 across the three watches.

28. **A line pinned to the foot is measured from the bezel, not the content
    box.** Apple's bottom inset is 12.5 on a 42mm and 19 on an Ultra, so a
    fixed offset put the same line under the corner curve on one watch and
    floating on another. Use `Guides.bottomInset`.

29. **Both ends of a full-height stack are pinned; the item height is what
    falls out.** In normal flow the foot line's position is whatever is left
    over, which gave the controls board 4pt above its first button and 20pt
    below its last. Pin top and bottom, derive the rest.

30. **The colour thread stops at the confirmations.** Controls are coloured;
    End confirm and Skip confirm are not. Tapping a red *End run* lands on a
    white *End and save*, and that is deliberate — §5 and rule 7 both ask for a
    calm confirmation: filled white affirmative, grey escape, discard as text
    with no pill. Colour on the controls board is there to separate three verbs
    at a glance. A confirmation has already narrowed the choice, so the job
    changes from separating to slowing down.

## The gate (locked 2026-08-24)

Everything above was, until now, a standard a person had to remember to apply.
The 33 engine tests spent months in a target no buildable project contained —
they had never once run, and the first execution found a real defect. Rules 16
to 20 are the same shape: each is a thing you have to remember to do, and the
whole reason they are written down is that somebody did not.

`scripts/check-watch.sh` runs them.

```
bash scripts/check-watch.sh          # tests + board geometry   (~85 s)
bash scripts/check-watch.sh --fast   # tests only, no simulator (~25 s)
```

Quiet on success — one line:

```
watch OK · 177 test cases (177 @Test declarations); 20 boards inside Apple's content box
```

### What it checks

1. **The project is fresh.** `xcodegen generate` runs first. `native-v2/project.yml`
   is the only file that knows which sources belong to the watch targets, and a
   stale checked-in `pbxproj` is exactly how 33 tests ran where 177 exist. If the
   regenerated project differs from the one in git the gate says so and tells you
   to stage it.
2. **Every test actually ran.** The suite runs, and then the executed case count
   is compared against the number of `@Test` declarations in
   `FaffWatch Watch AppTests/`. The floor is derived from the source, not
   hardcoded, so adding a test file raises it automatically and dropping one out
   of the target fails the gate. This is the guard that matters most: xcodebuild
   prints `** TEST SUCCEEDED **` over `Executed 0 tests` without blinking, and it
   prints a green summary line for a run that restarted after a crash — counting
   only the launches after it.
3. **The boards fit.** Twenty boards — one from each of the eight `_FacePreview`
   categories, biased toward the ugliest fixture in each — are rendered on the
   46mm and audited by `scripts/watch/geom.py` against Apple's content box. A
   board that renders blank fails too; geom.py alone prints `EMPTY` and moves on.
   This is a floor, not a substitute for rule 20: after touching a shared
   component, still re-check every board.

### Two things it does that look like paranoia and are not

- **The tests run serially** (`-parallel-testing-enabled NO`). Under xcodebuild's
  default parallel testing the suite is split across cloned simulators and
  `HostileInputTests` — which drives the engine through a hand-rolled clock on
  the main actor — reported 11 expectation failures that do not exist. Same tree,
  same commit, green when serialised.
- **The tests and the render use different simulators.** `shoot.sh` installs a
  plain app build under `run.faff.app.watchkitapp`, the same bundle id the test
  host runs as, and that build has no `PlugIns/…AppTests.xctest` inside it.
  Render then test on one watch and the run dies with *"Failed to load test
  bundle"* while the summary names whichever test was in flight — a healthy test
  reported as a product failure. The render half keeps the 46mm (geom.py's
  margins are that device's); the tests take any other watch.

### Where it is wired, and why not where the other gates are

`check-palette-sync.sh` and `check-doctrine.sh` hang off `web-v2`'s `prebuild`,
so they run on every Railway build. **This one cannot.** Railway's container has
no Xcode, no simulators and no watchOS SDK, so wiring it there gives you a choice
between breaking every deploy and teaching the script to skip itself when Xcode
is absent — which is every Railway build. A gate that always skips is the exact
failure this file exists to fix, wearing a CI badge.

So it is wired to the only automated thing in this repo that is guaranteed to be
on a Mac: the **pre-push hook**. `.git/hooks/pre-push` used to be a bare symlink
to `scripts/check-web-build.sh`; that is now a versioned dispatcher at
`.githooks/pre-push` which runs the web typecheck exactly as before and then runs
this gate — but only when the push actually carries watch changes
(`legacy/native/Faff/FaffWatch*`, `native-v2/project.yml`,
`native-v2/Faff.xcodeproj/`, `scripts/watch/`, `scripts/check-watch.sh`). When
the pushed range cannot be resolved it runs everything rather than guessing.

Activate it once per clone:

```
git config core.hooksPath .githooks
```

`FAFF_WATCH_FAST=1 git push` skips the render half. `git push --no-verify` skips
the lot — say so in the push message if you use it.

If no watch simulator is booted the render half is **skipped, not failed**, and
the run says which boards were not looked at. Booting a watch takes a minute and
a push is not the moment to do it silently.

### Before a TestFlight build

The hook is a floor, not the ceiling. `scripts/ship-testflight-v2.sh` does not
call this gate; run the full thing by hand before shipping a build, together
with the full board sweep that rule 20 asks for.
