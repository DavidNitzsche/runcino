# faff.run · color palette

Reference image: [colors.jpg](./colors.jpg).

This is the canonical palette. Every UI surface (web, iOS, watch face, exports)
draws from these tokens. CSS variables in `web/app/globals.css` are kept in
sync with this spec.

---

## System (semantic)

Each system color carries meaning, not decoration. Use them for state +
intent, not for looks.

| Name       | HEX       | RGB           | Use                                   |
| ---------- | --------- | ------------- | ------------------------------------- |
| Corporate  | `#008FEC` | `0 143 236`   | Primary brand, links, info, training  |
| XP         | `#9013FE` | `144 19 254`  | Strength · Amp, premium, achievement  |
| Warning    | `#FC4D54` | `252 77 100`  | Errors, hard-stop alerts, danger      |
| Success    | `#3EBD41` | `62 189 65`   | Easy runs, base, positive deltas      |
| Attention  | `#F3AD3B` | `243 173 56`  | Race · A-target, today, peak callout  |

Each has alpha steps available: **100 / 80 / 64 / 40 / 24**.

---

## Layers (background depths)

Dark canvas as default. The `l*` scale goes from deepest (basement) to
nearest the user (third).

| Token              | HEX       | Role                                    |
| ------------------ | --------- | --------------------------------------- |
| `--color-l0`       | `#10131A` | Dark basement — page bg                 |
| `--color-l1`       | `#141820` | Dark background — section bg            |
| `--color-l2`       | `#1A212D` | Dark first — tile bg                    |
| `--color-l3`       | `#1D2736` | Dark second — tile interior             |
| `--color-l4`       | `#212D3F` | Dark third — borders, strong dividers   |

For light surfaces (race-plan exports, magazine retrospectives):

| Token                | HEX       | Role                                  |
| -------------------- | --------- | ------------------------------------- |
| `--color-light-base` | `#B6BBCC` | Light basement — muted neutral        |
| `--color-light-bg`   | `#E6E8EF` | Light background — page bg            |
| `--color-light-1`    | `#F6F7F8` | Light first — section bg              |
| `--color-light-2`    | `#FBFBFB` | Light second — tile bg                |
| `--color-light-3`    | `#FFFFFF` | Light third — tile interior           |

---

## Typography

| Token              | HEX       | Role                                |
| ------------------ | --------- | ----------------------------------- |
| `--color-t0`       | `#F6F7F8` | Text light · primary on dark        |
| `--color-text-dark`| `#080808` | Text dark · primary on light        |

`--color-t1 / t2 / t3` are alpha steps of `--color-t0` (`0.72 / 0.48 / 0.32`)
for hierarchy on dark surfaces.

---

## Additional (data + accents)

Use sparingly. These are accent colors for charts, instruments, phase
coloring, and editorial pull-outs.

| Name        | HEX       |
| ----------- | --------- |
| Light Yellow| `#F0DF47` |
| Dark Orange | `#E88021` |
| Redish      | `#D03F3F` |
| Pink        | `#CD317C` |
| Violet      | `#6227E0` |
| Dark Blue   | `#2264E3` |
| Light Blue  | `#27B4E0` |
| Aquamarine  | `#27E087` |
| Dark Green  | `#139520` |
| Gray        | `#646464` |

---

## Hero gradient

The signature brand gradient — used on the dashboard hero, race-plan
posters, and the iOS launch icon.

```
linear-gradient(135deg, #9013FE 0%, #008FEC 100%)
```

CSS variable: `--gradient-hero`.

---

## Phase rainbow (race-detail page)

5-color sequence for the elevation profile + phase legend. Maps to the
race-detail PosterCard, the elevation curve, and the phase strip on the
upcoming-race hero.

| Phase | HEX       | Default label  |
| ----- | --------- | -------------- |
| 0     | `#3EBD41` | Opening        |
| 1     | `#F3AD3B` | Build          |
| 2     | `#FC4D54` | Climb          |
| 3     | `#008FEC` | Cruise         |
| 4     | `#9013FE` | Final          |

Extends with Pink / Aquamarine / Orange when a course has 6-8 phases.
