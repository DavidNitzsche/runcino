# faff.run Design System

**Status:** locked as of v4 TODAY mockup, 2026-05-24. **This supersedes the April 2026 hub-based system.**

**Canonical reference mockup:** [docs/coach/mockups/today-v4-2026-05-24.html](../coach/mockups/today-v4-2026-05-24.html) — the v4 TODAY page.

**Watch-face design source:** [docs/coach/mockups/watch-faces.html](../coach/mockups/watch-faces.html) — the design DNA scaled across surfaces.

**Legacy doc (prior direction, archived):** [DESIGN_SYSTEM_LEGACY_2026-04.md](./DESIGN_SYSTEM_LEGACY_2026-04.md)

If a decision isn't in this doc, check the v4 mockup first before inventing a new rule.

---

## 1 · Visual DNA

The design philosophy:

- **Pure black canvas.** Negative space is luxury. No layered chrome.
- **One thing dominates per module.** A number, a checkmark, a three-line stat block. Never competing surfaces.
- **Stats as typography, not tiles.** Numbers BIG, color-coded, no borders or boxes around them.
- **Three-color discipline + role-specific accents.** Green/white/blue are the workhorses. Amber/red/purple/orange each carry ONE specific meaning. Used sparingly.
- **No chrome — typography IS the structure.** Borders, cards, and dividers only when negative space can't do the job.

This DNA was distilled from the watch face inventory. It scales identically to phone (TODAY page), iOS native, and web.

---

## 2 · Color tokens

### 2.1 Surfaces

| Token       | Hex                          | Role                                          |
|-------------|------------------------------|-----------------------------------------------|
| `--bg`      | `#0a0c10`                    | Page canvas. Pure dark.                       |
| `--card`    | `#11141a`                    | Raised card / tile background.                |
| `--line`    | `rgba(255,255,255,0.08)`     | Borders, hairlines, chip outlines.            |
| `--line-2`  | `rgba(255,255,255,0.04)`     | Soft dividers between sections.               |

Tiles + cards step subtly above the page (`--card` is slightly lighter than `--bg`). Borders use `--line` for visible edges, `--line-2` for soft separations.

### 2.2 Type colors

| Token    | Hex / value                  | Role                          |
|----------|------------------------------|-------------------------------|
| `--ink`  | `#f6f7f8`                    | Primary type. Headlines, body. |
| `--mute` | `#8a90a0`                    | Secondary type. Labels, sub-text. |
| `--dim`  | `#4b505e`                    | Tertiary type. Inactive, meta. |

### 2.3 Semantic + role-specific colors

Each has ONE job. Never mix roles.

| Token       | Hex       | Role |
|-------------|-----------|------|
| `--green`   | `#3EBD41` | **Success / done / on-track / good.** Completed workouts, positive states, the active TODAY chip, week-strip "done" dots, "Solid" reply, coach voice eyebrow ping. |
| `--rest`    | `#008FEC` | **Primary blue / CTA.** "Lock in for tomorrow" button, primary actions, the "Add" button on profile gaps. |
| `--dist`    | `#27B4E0` | **Distance / easy work / forward look.** Distance numbers in run recap, UP NEXT card distance, easy workout indicators. |
| `--goal`    | `#F3AD38` | **Amber / soft warning / needs attention.** Sleep deficit, "warm" weather chip, "Tired" reply, recovery-amber. |
| `--over`    | `#FC4D64` | **Red / needs the runner's attention.** Profile gap cards ("COACH NEEDS"), "Wrecked" reply, urgent flags. |
| `--learn`   | `#B084FF` | **Purple / educational.** Fun-fact cards ("ⓘ HRV", etc). Light purple-tinted treatment. |
| `--race`    | `#FF8847` | **Orange / race signal.** Race horizon cards, race-specific chips, countdown numbers. |

**Hex values match exactly** what's used in [today-v4-2026-05-24.html](../coach/mockups/today-v4-2026-05-24.html). Renderer code should reference these by name, never inline new hex codes.

---

## 3 · Typography

Two fonts. Never mix outside these roles.

### 3.1 Stack

```css
--f-display: 'Bebas Neue', 'Inter', sans-serif;
--f-body:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```

Loaded via Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

### 3.2 Role map

| Role | Font | Treatment |
|------|------|-----------|
| Hero headline ("Solid long run this morning.") | display | 32-38px, weight 400, line-height 1.05 |
| Hero numbers (run recap stats: 11.1 / 8:50 / 1:38) | display | 54-56px, weight 400, tabular-nums, line-height 0.95 |
| Section labels ("LONG · 11.1 MI") | display | 22-24px, weight 400, uppercase |
| Big card numbers (sleep "6.8h", next-up "5.8 MI", race "84 DAYS") | display | 42-60px, weight 400 |
| Body paragraphs (coach voice prose) | body | 15.5-16px, weight 400, line-height 1.6, letter-spacing -0.01em |
| Strong / emphasized in coach voice | body | weight 600 (inline `<strong>`) |
| Card eyebrow labels ("COACH NEEDS", "SLEEP · LAST 7 NIGHTS") | body | 9-11px, weight 700, uppercase, letter-spacing 1.2-1.6px |
| Stat units ("miles", "avg pace", "moving") | body | 10px, weight 600, uppercase, letter-spacing 1.2px |
| Chips ("HR 140", "CAD 160") | body | 11px, weight 500-600 |
| Reply chips (SOLID/TIRED/WRECKED) | display | 18px, weight 400, uppercase, letter-spacing 1.2px |
| Date eyebrow ("SUN · MAY 24") | body | 11px, weight 600, uppercase, letter-spacing 1.2px |
| Brand wordmark ("faff") | display | 26px, weight 400, letter-spacing 1px (lowercase) |

### 3.3 Rules

- **Display font (Bebas Neue) is uppercase-feeling by design** — its letterforms read as all-caps even when typed lowercase. Use at headline + number sizes for editorial weight.
- **Body font (Inter) carries all reading text.** Coach voice prose, card descriptions, chip text. Variable weight: 400 normal, 600 strong, 700 labels.
- **Tabular numerals** on all numeric hero values (`font-variant-numeric: tabular-nums`) so digit widths align across stats.
- **Letter-spacing positive (1.2-1.8px) on small uppercase labels** for legibility at small sizes.
- **Letter-spacing negative (-0.01em) on body paragraphs** for tighter, more conversational reading.

---

## 4 · Layout

### 4.1 Containers

- Phone-frame width (mockups): 460px outer, ~432px inner screen
- iPhone aspect ratio: 460 / 940 in mockups
- Card padding: 14-18px interior
- Card radius: 14-18px
- Card gap: 10px (within cards lane)
- Module gap: 8-22px between major sections
- Page horizontal padding: 24px

### 4.2 The TODAY page structure (POST-RUN)

```
Status bar           18px top, 32px sides
App bar              brand + date left | readiness chip right
Week strip           thin glance row, 7 day cells
Run recap            eyebrow + label + 3-stat grid + sub-chips + link
Coach voice          eyebrow + headline + paragraphs + reply chips
Cards lane           vertical stack, 10px gap
Bottom nav           4 tabs, sticky
```

Other states reorder this spine (see [docs/coach/TODAY_SPEC.md](../coach/TODAY_SPEC.md) state matrix).

---

## 5 · Component patterns

### 5.1 Cards

Default: `background: var(--card)`, `border: 1px solid var(--line)`, `border-radius: 18px`, padding `16-18px`.

Variants:
- **Action card** (cadence experiment, sleep deficit): large, big numbers, CTA pill at bottom
- **Info card** (next workout, race horizon): medium, focused content
- **Educational card** (`fun_fact`): light, purple-tinted (`rgba(176,132,255,0.04)` bg, `rgba(176,132,255,0.18)` border)
- **Slim affordance row** (`profile_gap`): low padding, label + value left, +Add pill right

### 5.2 Big numbers in cards

Pattern: number BIG (Bebas, 42-60px) in the role-appropriate color, unit small (Inter, 11px, mute, uppercase). Examples:

- Cadence experiment: `160 → 168 SPM` (current grey + arrow + target blue)
- Sleep: `6.8h` (goal/amber) + sub-line `7-NIGHT AVG · last night 7.7h`
- Next workout: distance big on RIGHT, label + when small on LEFT
- Race horizon: race name + date small on LEFT, days countdown big on RIGHT

### 5.3 Bar charts (sleep card)

7 vertical bars, `--goal` color at 0.85 opacity, 4px gap, 56px height container. Hours value labels above bars in `--mute` 9px. DOW row below in `--dim` 9px uppercase.

### 5.4 Reply chips (post-run)

3 equal-width pills, transparent background, `--line` border. On hover, border + text colorize:
- `.solid` → `--green`
- `.tired` → `--goal`
- `.wrecked` → `--over`

Bebas, 18px, uppercase, letter-spacing 1.2px.

### 5.5 Readiness chip (top-right)

44px circular SVG ring. Track in `var(--line)` 3px stroke. Fill in `--green` (or state color) with `stroke-dasharray` proportional to value. Big number (18px Bebas, `--green`) centered.

### 5.6 Week strip

7-day grid, equal columns, 4px gap. Each day = 8px×2px padded cell, `rgba(255,255,255,0.025)` background. Day-letter (M T W T F S S) in `--mute` 9px, mileage in `--ink` Bebas 14px, completion dot 3px below. Today cell: `--green` tint background + `--green` border + `--green` text.

---

## 6 · What NOT to do

- **No competing visual elements per module.** One number dominates per card; supporting content scales smaller. Never two big numbers fighting for the eye.
- **No tiled stat grids on TODAY.** The 6-tile RUNNING FORM grid was killed in v4. Run stats are typography in a 3-column layout, not boxed tiles.
- **No standalone banner stack.** All status / mode / adaptation content flows through the coach voice + cards lane.
- **No big readiness ring as page primary.** Readiness is a 44px top-right chip; tap for /health deep-dive.
- **No emoji on reply chips or anywhere coach-adjacent.** Watch UI uses monoline simple graphics; the app inherits that discipline.
- **No alarm-red unless something is actually urgent.** Profile gaps use `--over` because runner action is needed; weather warm uses `--goal` (amber soft warning), not red. Save red for genuine alerts.
- **No em dashes in coach voice copy** (handled in voice doctrine, not the design system, but flagged here for renderers building copy).
- **No new tokens or fonts in renderer code.** If you need a color or type role that isn't here, add it to this doc first.

---

## 7 · Cross-platform parity

Same DNA across all surfaces:

- **Web (Next.js):** consumes tokens from CSS variables matching this doc.
- **iOS native:** mirror the tokens in SwiftUI as Color extensions + Font.custom calls. Same hex values, same Bebas/Inter stack.
- **Watch:** the most compressed form. One number dominates per face. Same palette tokens; tighter type sizing. The watch-faces gallery is the reference.

All three render the same `{ voice, topics[] }` payload from the API, just at different scales.

---

## 8 · Change log

- **2026-05-24** — v4 TODAY mockup locked as canonical. DESIGN_SYSTEM.md rewritten to reflect it. Prior April 2026 document (hub-based, Oswald/Jost) moved to [DESIGN_SYSTEM_LEGACY_2026-04.md](./DESIGN_SYSTEM_LEGACY_2026-04.md). Tokens + fonts here are exactly what the v4 mockup uses.
