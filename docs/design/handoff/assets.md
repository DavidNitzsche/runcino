# Assets (item 7)

## Fonts — unchanged, already bundled

No font change from the design system. The three bundled families are correct:

| Family | Role | PostScript name (Theme.F) | Weights used |
|---|---|---|---|
| **Bebas Neue** | display, numbers, titles | `BebasNeue-Regular` | single weight |
| **Inter** | body, labels, badges | `Inter-Regular` (+ `.weight()`) | 400 / 500 / 600 / 700 |
| **Oswald** | sub-headers, buttons | `Oswald-Regular` (+ `.weight()`) | 600 |

`.ttf` files are already in the target with the `UIAppFonts` Info.plist entry.
**No new `.ttf` needed.** Inter & Oswald are variable — set weight via `.weight()`.

## Logo / wordmark

**"FAFF"** — text, not an image. Bebas Neue, *italic*, letter-spacing ~1.5,
filled with the `faffMark` linear gradient (`#F3AD38 → #E85D26 → #C73E0B`,
top-leading → bottom-trailing). Already in Theme as `Color.faffMark`. Render with
a masked gradient over `Text("FAFF").italic()`. Sizes: 22 (sticky bar), 30+ (marketing).

## App icon

Not redesigned in this pass — **flag: needs a dedicated icon deliverable.** Interim
direction: `faffMark` gradient ground + white "F" or the flag glyph. Provide a
1024×1024 master when ready; not blocking screen implementation.

## Icons — SF Symbols vs custom

Prefer **SF Symbols** wherever one matches (they're in the mockup as hand-drawn
SVGs but should map to SF Symbols in SwiftUI):

| Use | SF Symbol | Notes |
|---|---|---|
| Tab · Today | `house` / `house.fill` | active = fill |
| Tab · Plan | `calendar` | |
| Tab · Coach | `questionmark.circle` | matches the coach mark |
| Tab · Health | `waveform.path.ecg` | |
| Tab · Races | `flag` / `flag.checkered` | custom flag in mockup; SF `flag.checkered` is closest |
| Open Workout (play) | `play.fill` | |
| Skip | `forward.end` | |
| Substitute | `arrow.left.arrow.right` | |
| Start Run | `figure.run` or `play.fill` | |
| Calendar / date | `calendar` | |
| Share (Race detail) | `square.and.arrow.up` | |
| Back chevron | `chevron.left` | |
| Row disclosure | `chevron.right` | |
| Connect Apple Health | `heart` (`heart.fill`) | |
| Apple Watch (Profile) | `applewatch` | |
| Run log | `list.bullet.rectangle` | |
| Notifications | `bell` | |
| Units | `ruler` | |
| Open on web | `display` / `safari` | |
| Race-day brief locked | `lock` | |
| Why chip | `questionmark.circle` | |
| Logged check | `checkmark` | |
| Weather (workout) | `sun.max` | conditions card |
| Shoe (workout) | `shoe` (iOS 17+) | else custom |
| Fueling (race) | `drop` | gel/fuel |

**Custom (no clean SF Symbol):** the **Races flag** glyph used in the tab + chip
(a waving flag on a pole) — supply as SF Symbol `flag.checkered` OR a custom
SF-Symbol-style PDF if you want the exact waving shape. The **Strava "S" / Garmin
"G"** marks in Profile are brand letter-marks (Oswald), not icons — keep as text
or swap for official brand assets.

## Route maps

`docs/design/route-recap.png`, `docs/design/route-race.png` (700×280 @2x,
also `.svg` source). These are **stylized placeholders** for the mockup. In the
real app, render the route from the activity's GPS polyline:
- **Run recap** → `MapKit Map` + `MapPolyline` of the synced workout route, or a
  `MKMapSnapshotter` static image, styled with the orange route + white casing.
- **Race detail** → the race GPX polyline, same treatment.
The PNGs document the intended **style**: light street base, bold `race` orange
route, white casing, green start pin / orange finish pin, overlaid white label chips.

## Illustrations

None. The design is type- and data-driven; no spot illustrations. Empty states
are copy + a muted icon only.
