# Handoff: Train page tweaks (web · A · Dashboard)

## Scope
Small, surgical changes to the **Train** page. Most of the page is unchanged. **Only the A · Dashboard variant is shipping** (the B/C variants live in the same files; ignore them). All edits are in three files:

- `Train Options.html` — the header markup
- `train/train.js` — `focusWeek()` and `mProjection()`
- `train/train.css` — header status, ramp race bar, projection panel

The full edited files are in this bundle so you can diff against your copy. Below is the exact change list.

---

## 1 · Header de-cluttered (top-left was repeating itself)

**Why:** "BASE" appeared 3×, "Americas/AMERICAS" and "WK 5" 2× each; the top-left stacked four label lines before the title.

**`Train Options.html` — `.h-top`:** removed the `.kicker` block (`BASE PHASE · WEEK 5` + `Americas Finest City · Aug 15`) and the right-column `.sline` (`BASE · WEEKS 1–6`). Final markup:
```html
<div class="h-top">
  <div>
    <div class="eyebrow" id="eyebrow">AMERICAS FINEST CITY HALF · <b>SUB 1:30:00</b></div>
    <div class="ptitle" id="ptitle">BASE</div>
    <div class="focus"><span class="ftag">FOCUS</span><span class="ftx" id="focusTx">…</span></div>
  </div>
  <div class="status">
    <span class="wkpill" id="wkpill"><span class="dot"></span>WK 5 · 46 MI</span>
    <span class="cd" id="countdown"><b>56</b> days to Aug 15</span>
  </div>
</div>
```

**`train/train.js` — `focusWeek(i)`:** removed the `$('kicker2')` and `$('sline')` lines; changed two lines:
```js
$('eyebrow').innerHTML  = RACE.nm.toUpperCase() + ' · <b>' + RACE.goal.toUpperCase() + '</b>';
$('countdown').innerHTML = '<b>' + daysOut + '</b> days to ' + RACE.date;
```
(Net: each fact, phase / race / week / date, now appears once. Phase + week context still live in the ramp and phase cards below.)

---

## 2 · Ramp: removed the "NOW" label over the current week

**`train/train.css`:** deleted the `.ramp .bar.cur::after { content:'NOW'; … }` rule. The current week is already marked by the white ring + its mileage number.

---

## 3 · Ramp: race bar now a finish-line flag (was a transparent placeholder)

**`train/train.css` — `.ramp .bar.race`:** was `background:transparent` + dashed border + faint checker (read as "temp"). Now a solid black/white **checkered finish-line flag** with a gold inset:
```css
.ramp .bar.race{border:none !important;background-color:rgba(8,12,14,.6) !important;
  background-image:repeating-conic-gradient(rgba(255,255,255,.9) 0% 25%, rgba(10,14,16,.92) 0% 50%) !important;
  background-size:11px 11px !important;
  box-shadow:inset 0 0 0 1.5px rgba(243,173,56,.6);}
```

---

## 4 · Projection panel: "What closes it" integrated (was a boxed-in afterthought)

**`train/train.js` — `mProjection()`:** the gap-report content is folded into the panel (no inner bordered card). Each lever is a row: a trend-up glyph + the action + a quantified delta chip. New markup uses `.gap` / `.gap-lbl` / `.gap-list` / `.lever` (`.lv-ic` / `.lv-t` / `.lv-d`). A `lever(text, delta)` helper builds the rows.

**`train/train.css`:** added `.proj .gap`, `.gap-lbl`, `.gap-list`, `.lever`, `.lever .lv-ic`, `.lever .lv-t`, `.lever .lv-d`. (No top divider on `.gap`.)

Data: levers map to the gap-report "what closes it" hit list — `text` + a quantified `delta` (e.g. `15–30s / wk`, `0.5 VDOT / 4wk`).

---

## 5 · Projection bar: redesigned as a faster/slower axis (the old bar was unreadable)

**Why:** the old `.pjbar` was an unlabeled progress fill (no clear 0/100), and a redundant "Tracking 1:34:54 · 4:54 behind…" sentence repeated the numbers.

**`train/train.js` — `mProjection()`:** replaced `.pjbar` + `.pjrow` + the `.gap-line` sentence with a labeled axis (`.pjtrack`):
```html
<div class="pjtrack">
  <span class="pjzone slow"></span><span class="pjzone fast"></span>
  <span class="pjseg" style="left:22%;width:28%"></span>
  <span class="pjend left">SLOWER</span><span class="pjend right">FASTER</span>
  <span class="pjchip" style="left:36%">4:54 behind</span>
  <span class="pjtick goal" style="left:50%"></span>
  <span class="pjtick proj" style="left:22%"></span>
  <span class="pjlbl" style="left:50%">GOAL<b>1:30:00</b></span>
  <span class="pjlbl proj" style="left:22%">TODAY<b>1:34:54</b></span>
</div>
```
Model: **goal is the white center line**; left half = **slower** (amber zone, `SLOWER`), right half = **faster** (green zone, `FASTER`). The TODAY dot sits on the side that matches (here left = slower than goal). The amber segment spans goal→today; the `4:54 behind` chip sits on it.

Positions are **schematic** in the prototype (fixed `left%`). When you wire real data: place `goal` at 50%, place `proj` left of 50% when projected > goal (slower) or right when projected < goal (faster), scale the offset by the delta, set the segment between them, and set the chip text to the signed delta (`Δ behind` / `Δ ahead`).

**`train/train.css`:** removed the old `.pjbar` / `.pjbar i` / `.pjbar .goalmark` / `.pjrow` / `.pjrow b` / `.pjrow .behind` rules; added `.pjtrack`, `.pjzone.slow` (amber, left), `.pjzone.fast` (green, right), `.pjseg`, `.pjtick.goal` (white vertical line), `.pjtick.proj` (amber dot), `.pjchip`, `.pjend.left` (amber `SLOWER`), `.pjend.right` (green `FASTER`), `.pjlbl` / `.pjlbl.proj`.

---

## 6 · Projected finish time: solid white (was a gold gradient)

**`train/train.css` — `.proj .pjbig.amber`:** the gold→amber gradient text looked off vs the app. Now solid white:
```css
.proj .pjbig.amber{background:none;color:#F6F7F8;-webkit-text-fill-color:#F6F7F8;}
```
The "behind" meaning is carried by the bar position + the amber chip, not the number color. (The markup class is still `pjbig amber`; only the rule changed. You can also just drop the `amber` class.)

---

## Files in this bundle
- `Train Options.html`, `train/train.css`, `train/train.js` — the full edited page (open `Train Options.html`).
- Web source to update: the Train view + its styles. These edits are presentational + markup only; no data-contract changes (the projection bar's faster/slower placement should be driven by `projected_sec` vs `goal_sec`).
