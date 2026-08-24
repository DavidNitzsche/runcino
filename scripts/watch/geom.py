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
from PIL import Image

SCALE = 2                      # screenshot px per point
LEFT, TOP, W, H = 15, 18, 178, 212
RIGHT = LEFT + W               # 193
BOTTOM = TOP + H               # 230
CLOCK_STRIP = 44               # pt: top band the system clock owns

fails = 0
for p in sorted(sys.argv[1:]):
    name = os.path.basename(p)[:-4]
    im = Image.open(p).convert('L'); Wpx, Hpx = im.size; px = im.load()
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
    if r > RIGHT:  msgs.append(f"RIGHT OVERFLOW {r:.1f} > {RIGHT}")
    if l < LEFT - 2.5: msgs.append(f"LEFT OVERFLOW {l:.1f} < {LEFT}")
    if b > BOTTOM + 14: msgs.append(f"BOTTOM OVERFLOW {b:.1f} > {BOTTOM}")
    flag = "  ".join(msgs)
    if flag: fails += 1
    print(f"  {name:<12} x {l:6.1f}..{r:6.1f}   y {t:6.1f}..{b:6.1f}   {flag}")

print(f"\n{fails} board(s) out of bounds" if fails else "\nall boards inside Apple's content box")
sys.exit(1 if fails else 0)
