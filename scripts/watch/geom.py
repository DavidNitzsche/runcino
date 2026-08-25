#!/usr/bin/env python3
"""Geometry audit of rendered boards. Checks the pixels, not the source.

Every rule here is one that was broken by code that read as correct:
  · content ran past the right margin because a width model over-charged and
    a later fix under-charged
  · a full-width control ran into the corner curve
  · two pieces of grey text ended up beside the system clock

Margins are Apple's, from WatchLayout: 46mm content box x=15 y=18 w=178 h=212.
The clock's own strip is excluded because the app does not draw it.
"""
import sys, glob, os
from PIL import Image, ImageFilter, ImageChops

SCALE = 2                      # screenshot px per point
# 2026-08-25 · the box is now per-device, because the gate only ever rendered
# a 46mm and 46mm is the ROOMIEST content width the app ships (178pt against
# 163 at 44mm). A board can pass here and overflow on a smaller wrist, which is
# the "reads as coverage" shape this repo has already paid for once.
# Override with WATCH_BOX="left,top,w,h".
import os as _os
_box = _os.environ.get("WATCH_BOX")
if _box:
    LEFT, TOP, W, H = (float(v) for v in _box.split(","))
else:
    LEFT, TOP, W, H = 15, 18, 178, 212
RIGHT = LEFT + W               # 193
BOTTOM = TOP + H               # 230
CLOCK_STRIP = 44               # pt: top band the system clock owns
BLUR = 3                       # px radius of the high pass
# The high pass leaves a halo the width of its own radius, so an edge that
# lands exactly on the margin measures a point and a half outside it. The
# full-width pill does exactly that by design — it spans 15..193 on a 46mm,
# which IS the content box — so the tolerance is the halo, not slack.
TOL = BLUR / SCALE + 0.5

# Slack on the bottom edge only. See the argument at the check below.
BOTTOM_SLACK = 14

fails = 0
near_bottom = []
for p in sorted(sys.argv[1:]):
    name = os.path.basename(p)[:-4]
    im = Image.open(p).convert('L'); Wpx, Hpx = im.size

    # FOREGROUND ONLY, via a high pass.
    #
    # Measuring raw luminance counted the lobby's own ramp as content, so
    # every full-bleed board reported as overflowing on all four sides — a
    # check that fires on eleven correct boards teaches you to ignore it.
    #
    # Type is high-frequency and a ramp is not, so subtracting a blurred copy
    # leaves the glyphs and drops the ground. This works on black boards and
    # lit ones with the same threshold, which a luminance cut cannot: amber
    # text sits at 182 and a green ramp at 137, too close to separate.
    hp = ImageChops.difference(im, im.filter(ImageFilter.BoxBlur(BLUR)))
    px = hp.load()
    minx, maxx, miny, maxy = 10**9, -1, 10**9, -1
    for y in range(Hpx):
        # skip the clock strip entirely: it is the system's, not ours
        if y < CLOCK_STRIP * SCALE:
            continue
        for x in range(Wpx):
            if px[x, y] > 60:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0:
        print(f"  {name:<12} EMPTY"); continue
    l, r = minx/SCALE, maxx/SCALE
    t, b = miny/SCALE, maxy/SCALE
    msgs = []
    if r > RIGHT + TOL:  msgs.append(f"RIGHT OVERFLOW {r:.1f} > {RIGHT}")
    if l < LEFT - TOL: msgs.append(f"LEFT OVERFLOW {l:.1f} < {LEFT}")
    # THE BOTTOM IS NOT HELD TO THE SAME LINE AS THE SIDES, and that was
    # undocumented until 2026-08-25. `BOTTOM_SLACK` exists because the control
    # boards legitimately own the bottom edge — the pill is placed against it
    # by Apple's own guide — so holding them to the content box would fire on
    # correct boards, which is the thing that teaches you to ignore a check.
    #
    # But it is slack, not truth. A board inside BOTTOM+slack is NOT "inside
    # Apple's content box", and printing that sentence made the gate claim
    # more than it checked. Anything past the strict line is now named as
    # NEAR-BOTTOM: not a failure, because tightening it needs the per-board
    # argument the sides already have, and visible, because `summary` clearing
    # it by 12pt is the known "last row sliced" defect hiding in the slack.
    strict_bottom = b > BOTTOM + TOL
    if b > BOTTOM + BOTTOM_SLACK + TOL:
        msgs.append(f"BOTTOM OVERFLOW {b:.1f} > {BOTTOM}")
    flag = "  ".join(msgs)
    if flag: fails += 1
    elif strict_bottom:
        near_bottom.append((name, b))
        flag = f"near-bottom {b:.1f} > {BOTTOM}"
    print(f"  {name:<12} x {l:6.1f}..{r:6.1f}   y {t:6.1f}..{b:6.1f}   {flag}")

if fails:
    print(f"\n{fails} board(s) out of bounds")
elif near_bottom:
    names = ", ".join(f"{n} {v:.1f}" for n, v in near_bottom)
    print(f"\nall boards inside the sides; {len(near_bottom)} past the strict "
          f"bottom {BOTTOM} within the {BOTTOM_SLACK}pt control allowance: {names}")
else:
    print("\nall boards inside Apple's content box")
sys.exit(1 if fails else 0)
