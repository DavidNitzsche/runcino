#!/usr/bin/env python3
"""Contact sheet of watch boards, labelled, so a whole set is reviewed at once.

Reviewing boards one at a time is how inconsistency survives: each looks fine
on its own and the column that is 4pt off only shows up beside its neighbours.
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

names = sys.argv[2:]
out = sys.argv[1]
cols = int(os.environ.get("COLS", 5))
scale = float(os.environ.get("SCALE", 0.62))
label_h = 26

imgs = []
for n in names:
    p = f"/tmp/faces/{n}.png"
    if not os.path.exists(p):
        print(f"missing {p}"); continue
    im = Image.open(p).convert("RGB")
    im = im.resize((int(im.width*scale), int(im.height*scale)), Image.LANCZOS)
    imgs.append((n, im))

if not imgs: sys.exit("nothing to sheet")
w, h = imgs[0][1].size
rows = (len(imgs) + cols - 1)//cols
pad = 10
sheet = Image.new("RGB", (cols*(w+pad)+pad, rows*(h+label_h+pad)+pad), (26,26,28))
d = ImageDraw.Draw(sheet)
try:
    f = ImageFont.truetype("/System/Library/Fonts/SFNSMono.ttf", 15)
except Exception:
    f = ImageFont.load_default()

for i,(n,im) in enumerate(imgs):
    c, r = i % cols, i // cols
    x = pad + c*(w+pad); y = pad + r*(h+label_h+pad)
    sheet.paste(im, (x, y))
    d.text((x+2, y+h+5), n, fill=(190,190,196), font=f)

sheet.save(out)
print(out, sheet.size)
