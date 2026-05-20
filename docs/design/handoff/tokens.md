# Token sheet — delta vs `Theme.swift` (item 5)

Diffed against `native/Faff/Faff/Theme.swift` (current). Three buckets:
**✅ CONFIRMED** (reuse as-is) · **⚠️ CHANGE** (update the value in Theme) ·
**➕ NEW** (add to Theme).

---

## Color — ✅ mostly canonical, a few additions

`Faff.C` is correct. Reuse it. The mockup uses the same hexes:

| Token | Theme.swift | Mockup | Verdict |
|---|---|---|---|
| `bg` | `0xEEECEA` | `#EEECEA` | ✅ |
| `surface` | white | `#FFFFFF` | ✅ |
| `ink` | `0x0D0F12` | `#0D0F12` | ✅ |
| `recovery` (green) | `0x2CA82F` | `#2CA82F` | ✅ |
| `milestone` (amber) | `0xD4900A` | `#D4900A` | ✅ |
| `race` (orange) | `0xE85D26` | `#E85D26` | ✅ |
| `warn` (red) | `0xF43F5E` | `#F43F5E` | ✅ |
| `greenWash` | `.opacity(0.12)` | `rgba(...,.12)` | ✅ |
| `amberWash` | `.opacity(0.14)` | `rgba(...,.15)` | ✅ use Theme's .14 |
| `orangeWash` | `.opacity(0.12)` | `.12` | ✅ |
| text tiers | ink55 / ink35 / ink20 | .56 / .38 / .20 | ✅ keep Theme's .55/.35/.20 (rounding) |
| `divider` | ink08 | `.07` | ✅ keep .08 |
| `pillBg` | ink04 | `.038` | ✅ keep .04 |
| `faffMark` gradient | `F3AD38→E85D26→C73E0B` | same | ✅ |

**➕ NEW colors to add:**

| Add | Value | Used by |
|---|---|---|
| `amberInk` | `#B3450A` | **Text/icon on amber wash** (the "Watch Load" / "Hold easy" badge text, the readiness ring number, gap copy). `milestone` #D4900A fails contrast as text on `amberWash`; this darkened amber is the on-wash text color. |
| `dataBlue` | `#2563EB` (+ `.opacity(0.12)` wash) | **Data-viz only** — the "descent" grade pill + grade band on Race detail. Not chrome. Per design law red is errors only and orange is brand; blue is the neutral descent/elevation hue. Flagged as a *new semantic for elevation/grade*. |

> The route-map colors (`#dde4ec` base, `#c4cedb` streets, `#c4e3c5` park,
> `#aecbe8` water) are **baked into the route PNGs** (see `assets.md`), not UI
> tokens — don't add them to Theme.

---

## Type — ✅ fonts canonical; ➕ add the size ladder

Fonts unchanged: **Bebas Neue** (display/numbers), **Inter** (body), **Oswald**
(sub-headers/buttons), all bundled. `Faff.F` constructors are correct.

Theme.F has no fixed size ladder — here is the **phone size ladder** the mockup
uses (role → font / size pt / weight / tracking). Add as named styles or use inline.

| Role | Font | Size | Weight | Tracking | Example |
|---|---|---|---|---|---|
| Screen title (Bebas) | display | 40 | — | -0.5 | "Body State", "This Week" |
| Hero workout title | display | 54 | — | -0.5 | "EASY RUN" |
| Big number (countdown) | display | 54 | — | — | "89" days |
| Readiness ring number | display | 32 (sm 23) | — | — | "64" |
| Stat value | display | 27 | — | — | "5.5", "8:29" |
| Metric tile value | display | 26 | — | — | "68", "178" |
| Day-of-month (week strip) | display | 20 | — | — | "20" |
| Coach brief / body | Inter | 14 | 400 | — | greeting paragraph |
| Coach brief **bold** | Inter | 14 | 700 | — | inline emphasis |
| Card body / copy | Inter | 12.5–13 | 400/600 | — | readiness copy |
| Stat unit | Inter | 11 | 500 | — | "mi", "/mi", "bpm" |
| Stat / tile label | Inter | 9–10 | 600 | +0.09em upper | "DISTANCE", "HRV" |
| Eyebrow | Inter | 10 | 600 | +0.16–.18em upper | "TODAY · BASE" |
| Coach label / context | Inter | 10 | 700 | +0.14em upper | "COACH · WED MAY 20" |
| Sub-header / button (Oswald) | oswald | 13 | 600 | +0.14em upper | "OPEN WORKOUT", "STRUCTURE" |
| Tab bar label | Inter | 9.5 | 600 | — | "Today" |
| Badge | Inter | 9.5 | 700 | +0.06em upper | "ON PLAN", "WATCH LOAD" |

---

## Spacing — ⚠️ CHANGE several values in `Faff.S`

The "comfortable spacing" pass loosened these from the values currently in
`Theme.swift`. **Update `Faff.S`:**

| Token | Theme.swift (now) | **Change to** | Why |
|---|---|---|---|
| `rowGap` | `10` | **`14`** | gap between feed cards |
| `cardPadding` | `14` | **`16`** | card interior (heroes use 17; tiles 12) |
| `pageEdge` | `13` | **`20`** | feed horizontal padding |
| `blockGap` | `8` | `8` ✅ | label → value |
| `inlineGap` | `5` | **`7`** | between pills/segments |

**➕ NEW spacing constants:**

| Add | Value | Use |
|---|---|---|
| `tilePadding` | `12` | metric-tile interior (Health grid) |
| `tileGap` | `8` | gap between tiles in the 3-col grid |
| `scrollTop` | `12` | top inset of the scroll area under the sticky bar |
| `scrollBottom` | `22` | bottom inset before tab bar |

**Chrome heights (fixed):** status bar `54`, sticky top bar `≈44`
(padding 5/6 + 28 pt avatar), tab bar `84` (content 62 + 22 home-indicator
inset), sheet top inset (grab-handle reveal) `26`.

---

## Radii — ⚠️ CHANGE in `Faff.R`

| Token | Theme.swift (now) | **Change to** | Use |
|---|---|---|---|
| `card` | `15` | **`18`** | cards |
| `pill` | `8` | **`12`** | stat pills |
| `chip` | `6` | **`8`** | badges, slider track, date cells |

**➕ NEW radii:**

| Add | Value | Use |
|---|---|---|
| `tile` | `14` | metric tiles |
| `sheet` | `24` | slide-up sheets (top corners only) |
| `chipSm` | `9–11` | race chip, sticky-bar buttons, segmented control |

---

## Shadows — ➕ confirm / add

`faffCard()`'s shadow is close. The mockup card shadow:

```
card:  0 1px 2  rgba(0,0,0,0.04)  +  0 6px 20 rgba(0,0,0,0.05)
sm:    0 1px 2  rgba(0,0,0,0.05)                       // tiles, chips
sheet: 0 -10px 40 rgba(0,0,0,0.10)                     // upward, slide-up sheets
device: 0 4px 14 rgba(0,0,0,0.10) + 0 30px 60 rgba(0,0,0,0.18)  // gallery only, not in-app
```

Update `FaffCard` to `radius 2 y1 .04` + `radius 20 y4 .05` (currently `1.5/.06`
+ `8/.04`). Add a `.faffSheetShadow()` for the upward sheet shadow.

---

## Summary for the diff

- **Colors:** keep `Faff.C`. Add `amberInk #B3450A` (on-wash text) and `dataBlue #2563EB` (grade/elevation).
- **Type:** keep fonts; adopt the size ladder above.
- **Spacing:** bump `rowGap 10→14`, `cardPadding 14→16`, `pageEdge 13→20`, `inlineGap 5→7`; add tile/scroll constants.
- **Radii:** bump `card 15→18`, `pill 8→12`, `chip 6→8`; add `tile 14`, `sheet 24`.
- **Shadows:** soften card to `0 6px 20 .05`; add sheet shadow.
