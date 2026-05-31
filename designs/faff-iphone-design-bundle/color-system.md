# Faff color system · canonical (from the web build)

Authoritative. Match on iOS exactly. No translation, no eyeballing. (Em dashes banned · use periods, commas, or ·.)

## Core
| token | hex |
|---|---|
| `--bg` | `#0A0C10` |
| `--card` | `#11141A` |
| `--line` | `rgba(255,255,255,.08)` |
| `--txt` | `#F6F7F8` |
| `--mute` | `#8A90A0` |
| `--dim` | `#4B505E` |

## Semantic accents
| token | hex | use |
|---|---|---|
| `--green` | `#3EBD41` | success, on-plan, READY |
| `--goal` | `#F3AD38` | goal markers, TODAY badge |
| `--over` | `#FC4D64` | over budget, warning |
| `--dist` | `#27B4E0` | distance, info |
| `--rest` | `#008FEC` | rest day signal (legacy alias) |
| `--race` | `#FF8847` | race day, ember accent |

## Effort palette (drives the Today mesh, re-themes per day)
Each effort = a 6-color mesh `[c1,c2,c3,c4,c5,mbase]` + a dot color + a label.

| effort | dot | label | mesh |
|---|---|---|---|
| RECOVERY | `#27B4E0` | VERY EASY | `#7FE6D6 #3FB6B0 #27B4E0 #1F8F76 #11605E #06302E` |
| EASY | `#48B3B5` | EASY | `#7FE6D6 #3FB6B0 #27B4E0 #1F8F76 #11605E #06302E` |
| LONG | `#F3AD38` | MODERATE | `#FFE0A0 #F3AD38 #E89B3A #E07A2A #C47812 #3E2A0A` |
| TEMPO | `#FF8847` | HARD | `#FFC98A #FF8847 #F2673A #E85D26 #C23A1C #4A1208` |
| INTERVALS | `#FC4D64` | MAX | `#FFD27A #FF7A45 #FC4D64 #D6263C #9E1733 #3A0E12` |
| REST | `#8A90A0` | OFF | `#D6BE98 #B2916A #8A6A48 #5E4630 #45331F #1C140D` |

## View meshes (when no active workout dictates the theme)
- TRAIN `#FFE0A0 #F3AD38 #E89B3A #E07A2A #C47812 #3E2A0A` (amber / build)
- ACTIVITY `#D6BE98 #B2916A #8A6A48 #5E4630 #45331F #1C140D` (warm tan)
- HEALTH `#7FE6D6 #3FB6B0 #27B4E0 #1F8F76 #11605E #06302E` (teal, calm)
- TARGETS `#FFD27A #FF7A45 #FC4D64 #D6263C #9E1733 #3A0E12` (race red)
- PROFILE `#6B6358 #4E4840 #3A352E #2A2723 #1E1C19 #121110` (gray neutral)
- SPECTATOR = HEALTH (teal)
- RACE = TARGETS (race red)

## Training phase meshes (Train scrubber lerps cool → warm → hot)
- BASE = HEALTH (teal) · BUILD = TRAIN (amber)
- PEAK `#FFA566 #FF5A52 #EC2F54 #C01D48 #A8163F #4E0A22`
- TAPER `#8EF0B0 #34C194 #1F8A68 #128A64 #137259 #06382E`
- RACE = TARGETS (race red)

## HR zones (Z1–Z5) · two equivalent palettes
Stacked TIME IN ZONES bars / splits + pacing bars:
- Z1 `#54ddd0` / `#48B3B5`
- Z2 `#8ef0b0` / `#3EBD41`
- Z3 `#ffe0a0` / `#F3AD38`
- Z4 `#ff9560` / `#FF8847`
- Z5 `#ff5a52` / `#FC4D64`

## Shoe role colors
RACE `#FC4D64` · TEMPO `#FF8847` · LONG `#F3AD38` · EASY `#48B3B5` · RECOVERY `#27B4E0`

## Goal / amber + mint accents
- amber bright `#FFCE8A` (eyebrow, COACH tag, callouts)
- amber pale `#FFE7C2` (gradient highlight end)
- amber gold `#F5C518` (PR celebrations, gold pill, the wordmark dot)
- mint readiness `#86efa0` (good-state text) · mint glow `#7be8a0` (gap-chip glow, paths)

## Brandmark gradient (Faff·Run, Anton, skew -9°, animated sweep 6s)
`linear-gradient(95deg, #F43F5E 0%, #FF5722 17%, #F5C518 35%, #14C08C 55%, #4F8FF7 75%, #F43F5E 100%)`
`background-size:200% 100%`. Middle dot = solid `#F5C518` circle.

## Tweak accents (recolor `--goal` + `--race`)
- ember (default) goal `#F3AD38` race `#FF8847`
- gold goal `#F5C518` race `#F5A518`
- violet goal `#A78BFA` race `#B794F4`
- cool goal `#27B4E0` race `#3AA0E0`

## Status tints
- NAILED IT / SOLID · border `rgba(62,189,65,.4)` text `#86efa0`
- PR / LONGEST · border `rgba(245,197,24,.5)` text `#F5C518`

## Rules
- Today mesh is per-day, driven by the selected workout's effort key; cycling the week strip re-tints the whole backdrop with a 0.7s ease.
- Every page outside Today uses its view mesh; Train is the exception (scrubber lerps phase meshes).
- Text on warm meshes (TEMPO/INTERVALS/TARGETS) stays `--txt` `#F6F7F8`. Do not auto-invert.
- A Swift `Color+Faff.swift` scaffold is in `HANDOFF.md`.
