# Apple Watch build kickoff · brief for the Xcode agent

> Decided 2026-05-19. **Watch app = structured-workout execution + race day, v1.**
> Companion app (the paired iPhone holds auth and pushes the plan). This is the
> brief a fresh watchOS/SwiftUI session works from.

## Goal

Build the Faff watch app: run today's structured workout on the wrist, and run a
race the same way. Dark execution surface, the locked v4 language.

## Read first, in order

1. `docs/native/XCODE_HANDOFF.md` — project state, Apple Dev setup, the device-pairing blocker.
2. `docs/native/01-watchos-scoping.md` — scope + the locked decisions (incl. the amendments).
3. **`docs/design/watch-app.html` — the VISUAL CANON.** Every screen and the full experience:
   home, pre-run, warmup, work interval (+ the pace color states), recovery, cooldown, summary,
   the always-on dimmed variant, the watch-face complication/glance, and the **race-day** section.
   Build the SwiftUI to match these faces.
4. `docs/design/watch-handoff.html` — the **build spec**: per-metric watchOS source + token, the
   workout + race **payload shapes**, the **haptics** table, the **state machine**, and build-status.
5. `designs/V4_DESIGN_LAW.md` + `web/app/components/v4/tokens.ts` — the design system. The watch uses
   the **dark variant** (see watch-app: black surface, same v4 semantic hues).

The HTML is reference, not importable code: read layout/hierarchy/source, then write SwiftUI.

## Design system (dark execution face)

- True-black surface; same v4 semantic colors as the app: green `#2CA82F` on-pace/recovery,
  amber `#D4900A` drift/in-progress, orange `#E85D26` brand/race, red `#F43F5E` over.
- **Bebas Neue** numbers/titles, Inter body, Oswald sub. Tabular figures.
- **One hero per face, centered, maximized.** The hero number is the biggest thing and is
  centered. **Auto-scale it** (SwiftUI `minimumScaleFactor` / `scaledToFit`) so 3- and 4-digit
  values both fill the width without clipping (`6:33` vs `10:42`). Do NOT use negative
  letter-spacing on the centered hero — it makes longer numbers lean.
- Three zones per metric face: orientation + elapsed up top, hero+target centered in the middle,
  HR + cadence (or race stats) and the progress bar anchored to the bottom.
- Units are the label (`bpm`, `spm`) — no word labels on the wrist. Eyebrows stay one line
  (`INT 3 / 6`, `REST 3 / 6`).
- Top-right shows **elapsed workout/race time**, not the wall clock.
- Haptics carry transitions. No coach prose on the wrist.

## Build fidelity — don't drift from the design

**The approved design is `docs/design/watch-app.html`. There is no Figma or other
source. That file is the canon.** If a build looks "too small" or off, it's drifting from
this file, not from something you can't see.

**A runnable harness already exists: `scripts/watch/` (see its README).** `npm install`, then
`node render-refs.mjs` writes the approved faces to `scripts/watch/refs/` (committed), and
`node compare.mjs refs/<face>.png build/<face>.png` diffs your simulator screenshot against the
reference and exits non-zero until it matches. **This is the acceptance gate — use it on every
face.** Definition of done: the compare passes AND you paste the ref + your build side by side
(with the %) in your report. "Looks close" is not done.

**The loop:**

1. Render each face from `watch-app.html` in a headless browser, scaled to the target watch
   screen, and save it as the reference set.
2. Screenshot your SwiftUI build of that face at the same size.
3. Overlay-diff the two. A face is **done only when the overlay matches** — layout, hero size,
   centering, spacing. Not "looks close."

The face aspect ratio in `watch-app.html` already matches ~45mm Apple Watch (≈198×242 pt), so
scaled renders are proportionally faithful. Build and diff against **45mm** as the reference;
the layout holds on the other sizes.

**The "too small" fix — size the hero to FILL, never a fixed point size:**

- The hero is a large base font + `.minimumScaleFactor(0.4)` + `.lineLimit(1)`, sized to fill
  the content width (screen minus ~16 pt side margins), centered. That's why `6:33` and `10:42`
  both look big and centered. **Do not hardcode a small font** — that's the bug.
- Zone proportions, top → bottom: orientation strip (eyebrow + elapsed) pinned top; the hero +
  target block centered in the middle; the stats row + progress bar anchored to the bottom.
- Starting element sizes at 45mm (then the overlay-diff is the real arbiter): hero fills ~85% of
  width via auto-scale; eyebrow / elapsed ~13 pt; target ref ~12 pt; stat value ~26 pt with ~11 pt
  unit; progress time ~18 pt. The hero is the biggest thing on the screen by a wide margin.

If anything looks small or empty, it's not matching `watch-app.html`. Re-diff.

## Reference implementation — copy this, don't reinterpret

The recurring bug is a small hero floating in empty space. The hero must **fill the width**.
Use this pattern verbatim (bundle Bebas Neue / Inter / Oswald in the target; these are not system
fonts):

```swift
// THE HERO. Large base font + minimumScaleFactor => it scales to FILL the width.
// 3- and 4-digit values (6:33, 0:55, 10:42) all end up large. Never hardcode a small size.
Text(value)                                  // "0:55"
    .font(.custom("BebasNeue-Regular", size: 130))   // big base; it will scale DOWN to fit
    .minimumScaleFactor(0.3)
    .lineLimit(1)
    .foregroundStyle(paceColor)              // .green / amber / red, or .white for time
    .frame(maxWidth: .infinity)              // own the full width
    .multilineTextAlignment(.center)

// THE METRIC FACE: three zones, hero centered and dominant.
VStack(spacing: 0) {
    // top: orientation + elapsed (pinned top)
    HStack {
        Text("WARMUP").font(.custom("Inter-Bold", size: 13)).tracking(1).foregroundStyle(.green)
        Spacer()
        Text(elapsed).font(.system(size: 13, weight: .bold)).foregroundStyle(.secondary)
    }
    SegmentStrip(phases)                     // the thin phase strip

    // middle: hero + target ref, centered, absorbs the slack
    VStack(spacing: 6) {
        Spacer(minLength: 0)
        hero                                 // the Text above — fills the width
        Text("\(target) · \(delta)")         // small reference line
            .font(.custom("Inter-Bold", size: 12)).tracking(0.5).foregroundStyle(.secondary)
        Spacer(minLength: 0)
    }

    // bottom: stats + progress, anchored to the bottom
    HStack(spacing: 12) {
        Stat(value: "159", unit: "bpm"); Divider().frame(height: 26); Stat(value: "179", unit: "spm")
    }
    HStack(spacing: 10) {                     // progress bar + time inline (no label row)
        ProgressView(value: fraction).tint(.orange)
        Text(timeLeft).font(.custom("BebasNeue-Regular", size: 18))
    }
}
.padding(.horizontal, 14)
.containerBackground(.black, for: .navigation)
```

Key points the build keeps missing: the hero is `.frame(maxWidth: .infinity)` with a **large base
font + minimumScaleFactor** (so it fills, not a fixed 40pt); the stat labels are the **units**
(`bpm`/`spm`), not words; the progress time sits **inline at the end of the bar**, not on its own
row. Diff against `watch-app.html` — if the hero isn't the biggest thing filling the width, it's wrong.

## Build order

**Phase 1 — the engine + workout faces (simulator-testable):**
1. State machine that walks a flat phases/intervals array (cursor, forward-only). Drives the faces.
2. Faces: home / pre-run → countdown → warmup → work interval → recovery → cooldown → summary,
   matching watch-app.html. Pace color logic: green within ±tolerance, amber 10–15s, red >15s.

**Phase 2 — live data + haptics (needs a physical Apple Watch):**
3. `HKWorkoutSession` + `HKLiveWorkoutBuilder` for live HR, pace (smoothed; `CMPedometer`
   fallback for the first ~30s before GPS lock), and **cadence**.
4. Transition + drift haptics (`WKInterfaceDevice.play`).
5. Completion: write `HKWorkout` with per-interval metadata → phone ingests → backend.

**Phase 3 — race day (same engine, fed the race):**
6. The race plan is a **flat list of `pace` + `fuel` segments** (see watch-handoff payload). Reuse
   the Phase-1 state machine: `pace` segments are course phases with their own target pace (even
   *effort*, so the target shifts by terrain); `fuel` segments fire a gel cue + haptic.
7. Race faces: pre-race (goal, strategy, gels), race view (current pace vs **current phase**
   target, projected finish + distance, next-gel on the bar), fuel cue, phase-transition card,
   finish. All in watch-app.html's race-day section.

## Constraints

- **Companion app.** Phone holds the auth token and pushes the workout AND the race plan over
  WatchConnectivity. The watch trusts the paired phone. No login on the watch.
- **Simulator covers Phase 1 + the UI/state machine.** Phases 2–3 sensor work needs a physical
  Apple Watch — and **device pairing is currently unresolved** (see XCODE_HANDOFF). That blocks
  live-data work, not the UI build.
- **Cadence is in v1** (it was previously deferred). **Race day is in v1.**
- **No coach prose on the watch.** Coaching lives on phone/web, before and after.
- Git: every commit immediately `git push origin main`. Never skip hooks.
- Before citing/calling an endpoint, grep `web/app/api` to confirm it exists.

## What exists already (backend)

- `GET /api/watch/today` (workout payload) and `/api/watch/workouts/complete` (writeback) exist.
- The race plan shape exists in the data model (`docs/example.runcino.json`: phases + a flat
  `intervals` array of pace/fuel segments + fueling). A `GET /api/watch/race` (or equivalent) that
  returns the flat segment list for the watch is the net-new backend piece for race day.

## First task

Build the **workout execution state machine + the work-interval face** against the
`/api/watch/today` payload, in the simulator, matching the work-interval face in watch-app.html
(centered auto-scaling hero, color-coded pace, HR + cadence, rep progress bar). Show me the
SwiftUI before wiring live HealthKit, then we iterate face by face.
