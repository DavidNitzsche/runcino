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
