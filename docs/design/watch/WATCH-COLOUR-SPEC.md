# Watch · the colour list

Addendum to the watch brief, after the first face pass. The first pass used
Apple's Workout palette — six hues as identity. This is faff's palette instead,
and it is not a smaller one: there are twenty-odd values here and every one of
them means something.

The rule is not "use less colour". It is **colour carries meaning, and the
meaning is the same on the wrist as it is on the phone.**

---

## 1 · Session identity · the six day-state ramps

**This is where the colour comes from.** Every session has a type, every type
has a three-stop ramp, and that ramp is the session's identity across the whole
product.

| Session | Stop 1 | Stop 2 | Stop 3 |
|---|---|---|---|
| Easy | `#3EBD41` | `#1F8A52` | `#0F4A3A` |
| Long | `#27B4E0` | `#1A6A9E` | `#0C2A5E` |
| Quality / threshold | `#F3AD38` | `#E85D26` | `#7A2828` |
| Race | `#FF8847` | `#E85D26` | `#7A2828` |
| Rest | `#008FEC` | `#4A3A8E` | `#1C1A3A` |
| Block phase | `#B084FF` | `#6A4ACE` | `#2A1A5A` |

Three stops at 135°, interpolated in **oklab** — sRGB creases visibly at the
midpoint. Gradient panels carry the fractal-noise grain at 50% overlay; that is
what keeps white type legible without a scrim and it is not optional.

**Yes, green.** An easy day is green because easy is its identity, and that is
different from green meaning "well done" — which this product never says. The
distinction is worth holding onto: **the ramp says what the session IS. It never
says how you are doing.**

### So: the Start button takes the run type's colour
David's call and it is right. `#3EBD41` for easy, `#27B4E0` for long, `#F3AD38`
for a quality session, `#FF8847` on race day. The one big action on the pre-run
screen is also the one place that tells you, before you have read a word, what
kind of day this is.

The pre-run headline (`EASY`, `LONG`, `THRESHOLD`) takes the same stop.

---

## 2 · Live metrics · these do NOT get identity colours

This is the one thing the first pass has to change.

Pace yellow, heart red, distance blue, cadence cyan is Apple's convention and it
is a real one — but it collides with meanings this product has already taught on
the phone, and it wastes the only thing colour can do mid-run.

**`#FF4438` means "we could not read this value."** It never renders a real
number. A runner learns that on the phone and then sees their heart rate in red
on their wrist.

**`#F2B03C` means modelled, or outside the band** — and it carries the `~` mark.

So on a running face:

| Colour | Means | Example |
|---|---|---|
| `#FF5A1F` signal | **The thing the session is asking you to hold**, right now | Pace on an easy run · HR on a Z2 run |
| `#F2B03C` attention | That metric is **outside its target band** | Pace drifted under 8:15 |
| `#FF4438` fault | We **cannot read** it | HR with no strap paired |
| `#FFFFFF` | Everything else, at 1.0 / 0.72 / 0.48 | Distance, elapsed |

That is a face you can *glance* at: one number is orange because it is the job,
and if it turns amber you are off target. Six fixed hues cannot say that — with
everything coloured, nothing leads.

---

## 3 · Where the rest of the palette goes

The identity ramp does not have to stay on the pre-run screen.

**Page 2 · performance.** These metrics are not pass/fail — cadence, power,
stride, climb are just data. So give the page **the current session's own ramp**,
its three stops plus white. An easy run's second page reads in greens; a
threshold session reads in amber-to-rust. The page feels like the session, and no
number pretends to be a verdict. That uses more colour than the first pass, not
less, and every value of it is derived.

**Units and labels.** `/mi`, `bpm`, `spm` at white 0.48. Small, quiet, never
coloured — they are not data.

**Surfaces.** `#000000` ground on every running face. Tiles step up: `#0F1011`,
`#17191B`, `#212427`, `#2A2E32`. **No borders anywhere** — containment is a
fill-step change, never a hairline.

**Drawn things.** Progress rails, the distance strip, any plot: white `0.62` for
the ink, white `0.16` for the track it runs in. The filled portion of a progress
rail may take signal orange when it represents the session's own target.

**Gradient, full bleed.** Lobby and finish only. True black during the run — a
black pixel is an off pixel on OLED, and Always-On dims a gradient to grey mud
exactly when the wrist is down.

---

## 4 · Three things the first pass still needs

1. **An Always-On board for every running face.** `44:16` ticking to the second
   is a lie the moment the wrist drops; the display redraws far less often.
   Decide what stays true when the board is a minute stale.
2. **The clock.** `6:38` was drawn in orange in the system clock's own corner.
   The app cannot restyle the system clock, so that is either a duplicate or it
   will not render as drawn. Leave that corner alone.
3. **The `~` mark.** Nothing in the pass marks a modelled number. If a face ever
   shows a projection or an estimate, it takes the amber tilde — the same mark,
   the same meaning, on the wrist as on the phone.

And one engineering caveat for page 2: Apple documents the running-form metrics
(power, stride length, ground contact, vertical oscillation) as **outdoor** run
metrics, and we have not been able to confirm they are produced during an indoor
session. Page 2 currently leads with the two most likely to be missing on a
treadmill — the case David specifically asked for. Needs a device test on a belt
before the layout depends on them.
