# Watch visual-acceptance loop

The watch build keeps shipping "close enough." This harness makes **exact match the
definition of done**: the build is diffed against the approved faces in
`docs/design/watch-app.html`, every face, every iteration, until it matches.

`docs/design/watch-app.html` is the **single source of truth**. No Figma, nowhere else.

## Setup (once)

```
cd scripts/watch
npm install            # installs playwright + chromium, pixelmatch, pngjs, sharp
```

## Generate the reference set (whenever watch-app.html changes)

```
node render-refs.mjs
```

Writes one PNG per face to `scripts/watch/refs/` (the screen content, no bezel), rendered from
the approved HTML with the real fonts. These are the ground truth.

## The loop — run this for every face, do not skip it

For each face (warmup, work interval, the three color states, recovery, cooldown, pre-run,
summary, race view, fuel cue, phase change, finish, glance, rest day…):

1. **Build** the face in SwiftUI.
2. **Screenshot the simulator:** `xcrun simctl io booted screenshot build/<face>.png`
   (boot a 45mm Apple Watch sim; capture the watch screen).
3. **Diff:** `node compare.mjs refs/<face>.png build/<face>.png`
   - It prints `PASS`/`FAIL` + a mismatch %, and writes `build/<face>.diff.png`.
   - **Open the overlay.** Large lit-up regions = real drift (hero wrong size, things shifted,
     bottom row cut off). That is the bug to fix.
4. If `FAIL`, **fix and go back to step 1.** A face is **not done** until it `PASS`es and the
   overlay shows no structural drift.

## Definition of done (hard rule)

A face is done only when, in your report, you paste **the reference and your build side by side**
plus the mismatch %. "Looks close" is not done. If you can't show the side-by-side at a passing
score, it isn't finished.

## Notes

- The printed % is a tripwire (CSS vs SwiftUI antialiasing means a true match is ~2–4%, not 0).
  The **overlay image** is the real judgment: structure, sizes, and positions must line up.
- Common failures the overlay catches immediately: hero not filling the width; stat units/labels
  too small; the progress time cut off at the edge; elements not centered.
- If a face legitimately can't hit the threshold, say why (and show the overlay) — don't silently
  lower the bar.
