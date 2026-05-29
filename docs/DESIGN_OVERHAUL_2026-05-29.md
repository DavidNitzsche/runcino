# Faff · Design Overhaul · 2026-05-29

Single source of truth for the full visual overhaul (web + iOS). Authored under
full-auto mandate: "design me a fucking app and then push it live… Don't stop
until there is a full app on the web and the iphone." Decisions locked via 5
rounds of design dialogue + 5 reference images. Where a choice was left to me,
I made the call and logged it in §10.

---

## 1 · The soul

> "You signed up for a race. Here's what stands between you and the finish line."

The **race is the spine**. Every primary surface is framed by where the runner
is relative to the start line. But when the runner opens the app they want to
know **TODAY first** — race is the *frame* around today, not a replacement for it.

The app should make the runner say: *"hell yeah, here's my dashboard. my hub.
here's what I trust with my training."* Not sloppy. Not cheap. Soul + purpose.

---

## 2 · Aesthetic — FAFF technical spec-sheet

Swiss editorial / boarding-pass / instrument-readout. The reference deck:
warm paper background, bold condensed display type, **color as registration
marks, not fills**, full industrial graphic language.

- **Warm paper** canvas (`#F2EFE9`), near-black warm ink (`#14110D`).
- **Oswald 700** condensed display (Headliner energy); **Inter** body;
  letter-spaced uppercase tabular labels (instrument-readout feel).
- Graphic language: **barcodes, crop/crosshair registration marks, brackets
  `[ EASY ]`, color blocks, layered die-cut ticket panels, EKG activity traces,
  boarding-pass module** for race detail, version/page stamps.
- Color is **punctuation** — a registration dot, a bracket, a single block —
  never a full gradient wash (except the race-week takeover).

---

## 3 · Structure — 3 tabs

Collapse 7 tabs → **TODAY / PLAN / ME**.

| Tab   | Was                          | Now                                                            |
|-------|------------------------------|----------------------------------------------------------------|
| TODAY | /today                       | The daily home. Race-bib header + verb hero + body chips + below-fold breakdown + this-week glance |
| PLAN  | /training, /races            | Race-as-destination vertical path. Races → sheet. Physiology (VDOT/LTHR) lives here |
| ME    | /profile, /health, /log      | Settings-only (Account, Strava, Notifications, Units, About). Health → inline chips on TODAY. Log → sub-page |

Deferred (backends stay, UI later): skip-flow polish, niggle/sick logging UI,
spectator/companion mode, treadmill mode, /log filtering, standalone /health.

---

## 4 · The persistent race-bib header

Stacked, on every primary surface:

```
FAFF                                              ← wordmark, top-left
BERLIN MARATHON                                   ← race name (Oswald)
T-87 · GOAL 1:45 · PROJ 1:44:50 · ON TRACK ●      ← instrument row
```

Three race-anchor modes:
1. **Real race** — `T-N` + goal time.
2. **Time goal** — e.g. "SUB-25 5K", target date (no formal race).
3. **Base mode** — no time, **phase only** (BASE / BUILD / PEAK).

Data honesty (Cardinal Rule #1 · facts only):
- `T-N` — real, from `daysToARace`.
- `GOAL` — real, from `race.goal` display string. Omit if none.
- `PROJ` — VDOT projection. **Rendered ONLY when computable from real fitness
  data.** Never fabricated. Omit when no current VDOT.
- status `●` — `ON TRACK` (green) / `WATCH THIS` (amber) / `OFF TRACK` (red),
  driven by the readiness + ACWR composite that already exists (no LLM).

---

## 5 · TODAY surface

- **Verb-as-mood-ring hero**, plain-English, data-driven (no time-of-day clock):
  - pre: `RUN EASY` / `GO LONG` / `PUSH` / `REST` / `RACE`
  - mid: `RUNNING`
  - post: `NAILED IT` / `DONE` / `OVER` / `CUT SHORT`
  - The **verb carries ALL personality**; numbers below carry none (no prose
    sentences under the hero).
- **5 body chips:** BODY / SLEEP / RHR / HRV / LOAD.
- **Below-fold:** workout breakdown (the rows from `workout_breakdown`) +
  THIS WEEK glance tile (from WeekStrip data).
- **Race-week takeover (T-7→T-0):** full race-orange wash background,
  `RACE WEEK` + workout hero, race-day timeline reachable.
- **Post-run:** tap the `NAILED IT` hero → sheet with splits / zones / map /
  cadence (data already in `TodayRecentRun`).

---

## 6 · PLAN surface

Race-as-destination **vertical path**: `TODAY → THIS WEEK → PEAK → TAPER →
RACE DAY`. Races accessible as a sheet. Physiology (VDOT / LTHR / zones) moves
here from profile.

---

## 7 · ME surface

Settings only: Account, Strava connection, Notifications, Units, About. Nothing
else. Physiology moved to PLAN; health moved to TODAY chips; log is a sub-page.

---

## 8 · Tokens (the keystone)

Mechanism: a **`[data-skin="paper"]`** attribute on `<html>`, set permanently in
`layout.tsx`. Overrides the **neutral** tokens (bg / card / ink / line / mute /
dim) to the warm-paper palette while **preserving** the semantic palette
(green / goal / over / dist / rest / learn / race) and all state gradients.
**Revert = remove one attribute** → app returns to the locked dark theme.

Paper neutrals:
```
--bg:      #ECE7DD   (paper, one step down from card)
--bg-page: #F2EFE9   (warm paper — the canvas)
--card:    #F7F4EE   (raised paper card)
--ink:     #14110D   (near-black warm)
--mute:    #6B6358   (warm grey label)
--dim:     #A9A093   (faint warm grey)
--line:    rgba(20,17,13,0.12)
```
Because every token-driven legacy component references these names, the whole
app inverts to dark-ink-on-paper automatically; skin-unsafe globals
(`.coach-note` hardcoded near-white) get patched to use `--ink`.

Cardinal rules preserved verbatim:
1. Zero LLM anywhere ever (facts only).
2. Apple Watch untouched (stays dark — phone↔watch comms only).
3. Review hubs stay local (Faff/docs/, never faff.run/decks/).
4. iPhone fully native (no WKWebView).
5. Always push to main (Railway auto-deploys web from Runcino/web-v2).
6. Don't stop unless mission-critical.
7. **No doctrine cites in the UI** (no "Cite · Daniels §VDOT") — doctrine lives
   invisibly in the engine.
8. Dark theme stays revertable via the `data-skin` swap.

---

## 9 · Graphic primitives (build as components)

`components/faff/graphic/`:
- **Barcode** — mileage / progress bar rendered as variable-width bars.
- **CropFrame** — corner crop/crosshair registration marks around a region.
- **RegistrationDot** — the status `●` (green/amber/red/none).
- **Bracket** — `[ EASY ]` motif wrapping a label.
- **LayeredPanel** — die-cut ticket stack (upcoming / stats), offset layers.
- **ActivityTrace** — EKG-style HR/pace/elevation polyline.
- **VerticalStripNumber** — big week/phase number, ticket-stub orientation.
- **Stamp** — version / page / `T-N` micro-stamp, mono caps.

---

## 10 · Designer decision log (calls I made)

- **Global paper skin, not scoped.** One `data-skin="paper"` flips the whole
  app; safer than maintaining a parallel token set. Legacy pages inherit
  paper neutrals and stay readable; a lightening-pass agent polishes them.
- **PROJ omitted when not computable.** Honesty over completeness — never show
  a fake projection. Header still delivers the soul via T-N + GOAL + status.
- **Status pill from existing readiness/ACWR composite.** No new model; reuse
  the deterministic readiness engine already in `glance-state.ts`.
- **No prose under the hero.** The verb is the only voice; numbers stay mute.
- **Keep all 13 state gradients** for the verb hero's color accent + race-week
  wash; they read fine on paper because they're saturated.

---

## 11 · Ship checklist

- [ ] Paper token layer + layout attribute + skin-safe globals
- [ ] Graphic primitives
- [ ] Race-bib header + race-status engine + vdot.predictRaceTime
- [ ] TODAY rebuilt on new language
- [ ] PLAN as race-destination path
- [ ] ME as settings-only
- [ ] TopNav → TODAY / PLAN / ME
- [ ] iOS parity (Theme.swift paper + surfaces) — native, no web-view
- [ ] `next build` clean → push main (Railway deploy)
- [ ] TestFlight Build 99
