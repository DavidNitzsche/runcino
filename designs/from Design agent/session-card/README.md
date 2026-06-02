# Handoff: SESSION card (pre-run) — blueprint

## What this is
A redesign of the **pre-run SESSION card** on the web Today view. The old card was ~70%
empty space. This fills it with **the shape of the run**: a Z1–Z5 effort blueprint where
each segment is a block at its effort height, colored cool→hot by zone.

Open `Session Card.html` — three reference renders (Long Run, Track Intervals, Easy Aerobic)
on their run-type mesh. Self-contained, no deps (Inter + Oswald via Google Fonts).

## Anatomy
| Part | Notes |
|---|---|
| **Header** | Run name (left). Totals strip (right): `DISTANCE · EST TIME · EFFORT` — three labeled stats, one line. No "SESSION" eyebrow, no "CUE" word (both removed per review). |
| **Blueprint chart** | SVG. Faint Z1–Z5 lanes + a mile ruler along the bottom. Each segment is a rounded block spanning its distance, its height = its effort zone, filled in the segment colour with a soft top **sheen** (integrated, not a hard cap). Block label is left-anchored: NAME (caps) · big pace · "X mi · Zn". |
| **Reps** | A work set (e.g. `6 × 800 m`) renders as a comb of Z5 bars with the **float recoveries drawn as low teal (Z1) bars between them** — the rests are explicit. The set is labeled with a **bracket/span** over the rep group: "6 × 800 m @ 2:55 /800m". Sessions with reps get extra top headroom so the bracket never clips. |
| **Fuel** | Gel/fuel pins on the distance axis: a drop icon + "GEL" label at top, with a dashed line **starting below the label** (line never crosses the icon/text). |
| **Coach line** | One coaching sentence under a divider at the bottom (the old "CUE" pill is gone). |

## Data model (top of the script)
- `ZC` — Z1..Z5 colour ramp (`#48B3B5 → #3EBD41 → #F3AD38 → #FF8847 → #FC4D64`).
- `SESS[type]` — `{ name, dist, est, zone, cue, segs[], fuel[] }`.
- `segs[]` — each `{ from, to, zone(1–5), color, label, pace, zn }`. A rep set adds `reps:n` (+ optional `sub`); render it as the comb + bracket.
- `fuel[]` — mile positions for gel pins.

## Wiring to real data
1. Replace `SESS` with the planned-workout spec. `segs` map to the workout's structured segments; `zone` is the prescribed effort (drives block height + colour), `from/to` are distance bounds.
2. Rep detection: any segment with `reps` renders as the comb (work bars + float bars). Pull rep count, rep distance, float distance, and target pace from the spec.
3. `fuel[]` comes from the fueling plan (gel timing → mile position).
4. The coach line is the single most important cue for the session.
5. EST TIME / EFFORT zone are derived (sum of segment durations; dominant/range zone).

## Notes
- This is the **B** direction. An "A · effort profile" (smooth curve) was explored and dropped — it read like a recorded/post-run trace; the blueprint is the prescriptive pre-run view.
- The card background here is a run-type mesh for the demo; in production it inherits the Today page's phase/effort mesh — keep the glass-panel treatment.
- Chart is pure SVG strings; swap fonts/colours for your tokens. Sizes are in a 712×220 viewBox that scales to the card width.
