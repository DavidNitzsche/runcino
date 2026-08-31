# HR semantics on the workout card — 2026-09-01

Response to the task following `docs/reports/pace-hr-compatibility-2026-09-01.md`,
which found two real, uncoordinated HR mechanisms sharing one workout card and
a third, fabricated "164-172" figure that matched neither. This pass encodes
an explicit semantic model for every HR value the app computes, checks every
surface that shows or grades HR against it, and fixes the one place the audit
found a real number silently masquerading as the wrong kind of value.

Subject account for rendering verification: David's own build, iOS Simulator
(iPhone 17), via the sanctioned `-faffV5Gallery` / `-faffV5Screens` QA launch
arguments already wired into `FaffApp.swift` for exactly this purpose.

---

## Part 1 · The semantic model, encoded

Four structurally different HR quantities exist in the app today. Encoding
them explicitly, by name, is the actual deliverable — every fix below follows
from picking one name per quantity and making sure no surface lets one
masquerade as another (Rule 16).

| # | Name | Formula | Owner | What it means | Enforcement |
|---|---|---|---|---|---|
| 1 | **Expected-response zone** | Friel LTHR% bands (`computeZones`/`lthrZones`, `web-v2/lib/training/zones.ts`) | `hrTargets()` in `prescriptions.ts` | Informational only. "If you're at the right effort, HR usually sits here." Never a target, never enforced, zero downstream consumers. | None — display only |
| 2 | **Aerobic ceiling** | `aerobicCeilingBpm(lthr)` — top of Friel Z2 | easy/long/shakeout days only | A real "stay under this" constraint. Judged (`judgeEasyRunHr`), capped (`hrCapStat`, `askedHrIsHardCap`), and drawn as a shaded ceiling gauge with an amber alarm on breach. | `judgeEasyRunHr`, watch/phone ceiling gauge, `askedHrIsHardCap` |
| 3 | **Pass/bail contingency** | `thresholdPassHrBpm(lthr)` (97.5% LTHR) / `lthr + 5` | `spec-builder.ts`'s `contingencyRules` | An offered mid-run escape hatch for threshold/tempo/intervals work and a long run's finish segment. Never auto-enforced — the watch offers CONTINUE / TAKE THE BAIL. `pass` is a post-run confirmation criterion only, never shown as a mid-run choice. | `build-workout.ts` bail cue, `run-recap.ts` bail narrative |
| 4 | **Quality-phase expected reference** | `lthr_bpm` (threshold/intervals) / `hr_target_bpm` (tempo, 92% LTHR), ×1.05 for intervals | `build-workout.ts`'s `workHrTargetBpm` | What HR is expected to look like during a threshold/interval/tempo work phase, purely for the runner's own information. Pace is the instruction; this is context. | **Was** rendered as a hard ceiling (see Part 2) |

Mechanism 4 is the one the account owner's product direction is actually
about ("for threshold-type quality reps specifically... HR should be
SECONDARY expected-response... not a rigid co-equal target"). Mechanisms 1
and 4 are *conceptually* the same kind of thing (an informational HR
reference for quality work) but are computed by two independent formulas —
Friel's 95–100% LTHR band vs. a flat 100%/92%×1.05 point — that happen to
roughly agree at the account's own LTHR but are not derived from one shared
source. That divergence is flagged in "Not fixed" below; unifying them is a
bigger change than this pass's scope.

### The fix: `hrTargets()`'s string self-labels as informational

`web-v2/lib/training/prescriptions.ts` — every Friel zone-band string
`hrTargets()` produces (used by `spec-card.ts` and the legacy
`prescriptionFor()` path) now carries the app's own established "~" mark for
a modelled/informational number (per CLAUDE.md's design-brief section), e.g.
`~160–167 bpm (Z4 Threshold)` instead of the bare `160–167 bpm (Z4
Threshold)`. A doc comment on `hrTargets()` now states the model above
explicitly and cross-references the other two mechanisms by name, so the
next person touching this function does not have to re-derive which of the
three quantities they're looking at.

No test asserts this function's exact string output (`_spec_card.test.ts`
supplies its own hand-written `HR` fixture, so it's unaffected); confirmed by
grep before making the change.

---

## Part 2 · The real bug: mechanism 4 was rendered as mechanism 2

This is the live-surface defect that actually matches the task's description
("apply the same principle here to the rep/quality segment" as the warm-up
fix). Tracing every consumer of `workout_spec.lthr_bpm` /
`hr_target_bpm` (mechanism 4):

- **Watch face** (`FaffWatch Watch App/*.swift`): `hrTargetBpm` is decoded
  onto `WatchPhase` but **no watch face view ever reads it** — confirmed by
  grep across every `Faces*.swift` and `WorkoutEngine.swift`. Dead on the
  wrist.
- **Phone pre-run preview** (`TodayPreRunBodyV3.swift`): shown as plain
  static text, already informationally framed (`"~168 bpm · threshold"` for
  tempo, using the same `~` convention). No gauge, no alarm. Fine as-is.
- **Phone live-run screen** (`LiveRunOutdoorV5.swift`): **this is where it
  actually lived, and it was wrong.** `heartCeilingBpm(walk:plan:)` returned
  `walk?.phase.hrTargetBpm ?? plan?.workoutHrCeilingBpm` — collapsing
  mechanism 4 (quality-phase reference) and mechanism 2 (real aerobic
  ceiling) into one function with one name, feeding one `RangeScale(mode:
  .ceiling, ...)` gauge. That gauge shades the zone under the ceiling and
  turns its live marker amber — with VoiceOver announcing "above the
  ceiling" — the instant the reading exceeds it.

  Concretely: a threshold rep at LTHR 168 sets `hrTargetBpm = 168`. A runner
  running the rep hard and sitting at 174 bpm mid-rep (normal — Daniels'
  threshold reps run at or slightly above LTHR) saw the exact same amber
  alarm, the exact same shaded "stay under this" zone, and the exact same
  spoken "above the ceiling" VoiceOver line that an easy-day runner gets for
  genuinely blowing their aerobic cap. HR was fighting the pace instruction
  by design of the gauge, not by any stated product intent — this is the
  live-run-screen instance of the same contradiction the warm-up segment had
  (`spec-card.ts`'s WARMUP-CONTRADICTION-1: a flat pace target next to "build
  into the work").

### The fix

**`native-v2/Faff/Faff/DesignV5/ChartsV5.swift`** — `RangeScale.Mode` gains a
fourth case, `.reference`: same track, same live value marker, but it draws
no shaded zone and `outOfRange` always returns `false` for it, so the marker
never turns amber and VoiceOver never says "ceiling." Its spoken string says
outright: *"You are at 174. Informational only, not a target."* `.band` and
`.ceiling` are untouched — an easy/long day's real aerobic-cap gauge behaves
exactly as before.

**`native-v2/Faff/Faff/ViewsV5/LiveRunOutdoorV5.swift`** —
`heartCeilingBpm(walk:plan:)` is replaced with `heartReference(walk:plan:) ->
HeartReference?`, a two-case enum (`.ceiling(Int)` / `.expected(Int)`) that
names which of the two mechanisms applies instead of silently merging them.
`heartTile` now branches: a real ceiling (`plan.workoutHrCeilingBpm`, easy/
long/shakeout) still draws the shaded `.ceiling` gauge with its amber alarm,
unchanged; a quality phase's expected reference
(`walk.phase.hrTargetBpm`) draws the new `.reference` gauge instead, labeled
`"~168 expected"` rather than a bare ceiling number. The two are mutually
exclusive by construction on the server (`build-workout.ts` gates
`hrTargetBpm` to quality work phases and `hrCeilingBpm` to easy/long/
shakeout — confirmed by reading that gate), so this is a rename-and-branch,
not a new precedence rule.

**`native-v2/Faff/Faff/ViewsV5/GalleryV5.swift`** — added a static
`.reference` example to the "Charts" component showcase, alongside the
existing `.band` and `.ceiling` examples, so the new mode has a permanent,
data-free rendering target for future QA (this is also what made Rule 13
verification possible without live GPS/HR data — see Part 4).

---

## Part 3 · Every other surface checked

- **`spec-card.ts` / `expand-spec.ts`** — read, not modified. `cardFromSpec`'s
  per-rep `hr_target` field (mechanism 1) is already structurally secondary
  to `pace_target`: the phone's wire-flattening step in
  `lib/faff/v5-today.ts` (`stepSub()`) resolves a step's single displayed
  value as `pace_target ?? hr_target ?? effort_target` — for any quality rep
  with a resolved pace (effectively all of them), the HR band never reaches
  the per-rep row at all. That is already correct under "pace primary" and
  was not touched. `HR_TARGET_MIN_REP_SEC` (mechanism 1's sub-30-second
  exclusion, `Research/03` §13) is untouched and correct.
- **`v5-today.ts`'s `buildContingencyGroup`** — mechanism 3 (pass/bail).
  Already correct: `splitRuleRegisters()` in `build-workout.ts` explicitly
  excludes `kind === 'pass'` rules from ever reaching a rendered card
  ("`pass` rules get nothing: they are post-run confirmation criteria, not a
  decision offered to a runner mid-session"), so the phone's "If it goes
  wrong" section never shows a pass criterion under a header that implies
  something went wrong. Confirmed by reading the function; no change needed.
- **`app/api/v5/today/route.ts`'s `hrCapStat`** — mechanism 2. Already gated
  to `easy | long | shakeout` and suppressed on a long run's HM/M finish
  segment. Confirmed correct, not touched.
- **`app/api/v5/today/route.ts`'s `askedHrCap` / `askedHrIsHardCap`** —
  post-run "asked vs ran" row. `askedHrIsHardCap` is `true` only when
  `workout_spec.hr_cap_bpm` (mechanism 2) is present; the `hr_target_bpm` /
  `lthr_bpm` (mechanism 4) fallback values that fill `askedHrCap` for quality
  days never satisfy that gate, so the graded "under 145" row never renders
  for a threshold/interval/tempo day. Confirmed by reading the render
  condition in both `v5-today.ts` and `build-workout.ts`'s
  `composeCompletedRows`; consistent with mechanism 4 being informational,
  not graded.
- **`lib/coach/run-recap.ts`** — post-run narrative. `hrClause`/
  `scopedWorkHr` state HR as a descriptive fact ("· HR 165 across the 4
  reps"), never as a pass/fail grade against mechanism 4. The bail narrative
  ("You took the bail at mile X · smart, not a fail") reads mechanism 3's
  recorded outcome, already framed as a contingency taken, not a target
  missed. Confirmed consistent; not touched.
- **`SpokenCues.swift`** (watch voice) — reads whatever board text the
  server already composed (mechanism 3's `label` strings via
  `splitRuleRegisters`), which were already confirmed correctly framed
  ("Pass: avgHr ≤ 164...", "HR over 173 and climbing..."). No separate
  ceiling/target framing exists in the voice layer to fix.
- **`WorkoutGrade.swift`** (watch grading) — pace-based only; no HR grading
  logic exists there to be inconsistent. Confirmed by grep.
- **`TodayPreRunBodyV3.swift`** — pre-run static preview text, already using
  the `~` convention for tempo ("~168 bpm · threshold"); the `.intervals`
  case reads "168+ bpm · VO2max", which is mildly less clearly informational
  (a "+" suffix reads closer to a floor) but is plain text with no gauge, no
  alarm, and no grading behind it — low-risk, left as found. Flagged below.

---

## Part 4 · Verification (Rule 13)

**Rendered for real, on the sanctioned QA path — not an ad hoc pipeline.**
The prior report's rendering trap (`goal-card-audit-2026-09-01.md`) came from
bypassing Xcode's own launch flow with `simctl install` against a build whose
initialization path may not have matched a real launch. This pass avoided
that by using this session's `mcp__Claude_Code_iOS_Simulator__build` tool
(the server's own supported `xcodebuild`-via-scheme path, explicitly
preferred over an ad hoc pipeline) and the app's own built-in, source-level
QA entry points (`FaffApp.swift`'s `-faffV5Gallery` / `-faffV5Screens`
launch arguments) — no auth, no live data dependency, no ambiguity about
whether `.task` fired.

- `xcodebuild` via the scheme `Faff` (Debug, iPhone 17 simulator) —
  **BUILD SUCCEEDED**, 0 errors, 2 pre-existing warnings unrelated to this
  change (`TodayView.swift`'s `@Sendable` warning, an AppIntents metadata
  note).
- Installed and launched with `-faffV5Gallery`, navigated to the "Charts ·
  drawn from data, no assets" section, and **screenshotted the three
  RangeScale gauges side by side**: the pace `.band` gauge (unchanged), the
  real aerobic `.ceiling` gauge (unchanged — amber marker at value 174
  against a 110–180 scale with a shaded 100–168 ceiling zone, exactly as
  before), and the new `.reference` gauge directly below it — **same value,
  174, on a 100–190 scale, no shaded zone, an orange (not amber) marker, and
  the label reading "100 … ~168 expected"**. This is a direct, rendered
  side-by-side proof that the same underlying number no longer triggers the
  ceiling-breach alarm when it is the quality-phase reference rather than the
  real aerobic cap.
- `npx tsc --noEmit` — clean across `web-v2`.
- `npx vitest run lib/training/zones lib/training/_spec_card
  lib/training/prescriptions lib/watch lib/plan/spec-builder
  lib/training/goal-projection` — 177/177 passing, no regressions in any
  file this pass read from or touched.

**Not independently re-verified this pass:** the `LiveRunOutdoorV5` live-run
screen itself (as opposed to the Gallery's static component showcase) —
`ScreensCatalogV5`'s "Outdoor · mid-run" preview exercises the exact code
path (`outdoorMidRunPreview()` seeds a threshold phase with `hrTargetBpm:
168`, `workoutHrCeilingBpm: nil`), but navigating SwiftUI `List` rows via
synthetic touch gestures in the simulator proved unreliable in the time
available (taps intermittently registered as scrolls or hit neighboring
rows) and the screen's own "Close" control did not respond to tap
coordinates that should have hit it. The Gallery verification above
exercises the identical `RangeScale`/`Mode.reference` code — the same
component, the same enum branch, the same real build — so the fix itself is
confirmed rendered and correct; only the specific `LiveRunOutdoorV5` screen
composition (tile layout, "HEART RATE" label placement) is unconfirmed by
screenshot. Stated plainly per Rule 13 rather than claimed.

---

## Flagged, not fixed (out of scope for this pass)

- **Mechanisms 1 and 4 are two independent derivations of the same idea.**
  Mechanism 1 (Friel 95–100% LTHR band) and mechanism 4 (flat 100%/92%×1.05
  point) both answer "what should HR look like on this quality work," from
  two different formulas that happen to roughly agree at this account's LTHR
  but are not the same source. Unifying `build-workout.ts`'s
  `workHrTargetBpm` to read off `computeZones()`/`lthrZones()` instead of its
  own inline percentages would close this properly, but it touches
  `build-workout.ts`'s live wire shape for every watch/phone quality
  session and the recap grading path (`recap/route.ts`'s `hr_target_bpm`
  read) — a larger, riskier change than this pass's scope, and outside the
  explicit file list for this task.
- **`TodayPreRunBodyV3.swift`'s `.intervals` case** ("168+ bpm · VO2max")
  reads slightly more like a floor to clear than an informational reference,
  compared to its own `.tempo` case's `"~168 bpm · threshold"` two lines
  above it. Low-risk (plain text, no gauge, no grading), left as found;
  worth a follow-up pass to match the `~` convention exactly.
- **`LiveRunOutdoorV5` screen render** — see the verification note above;
  the fix itself is proven via the Gallery's identical component instance,
  but the specific live-run screen composition was not independently
  screenshotted this pass.

## Files changed

- `web-v2/lib/training/prescriptions.ts` — `hrTargets()` self-labels as
  informational (`~` mark) and documents the four-mechanism model.
- `native-v2/Faff/Faff/DesignV5/ChartsV5.swift` — new `RangeScale.Mode
  .reference` case.
- `native-v2/Faff/Faff/ViewsV5/LiveRunOutdoorV5.swift` —
  `heartCeilingBpm` → `heartReference`, branches real ceiling vs.
  quality-phase reference into two different gauges.
- `native-v2/Faff/Faff/ViewsV5/GalleryV5.swift` — added a `.reference`
  example to the Charts showcase (also the render-verification target).
- This report.

Also included in this commit, already present and directly on-topic
(`thresholdPassHrBpm` extraction — mechanism 3's Rule 16 dedup, flagged as
"not fixed" by the prior `pace-hr-compatibility-2026-09-01.md` report and
completed since): `web-v2/lib/training/zones.ts`,
`web-v2/lib/plan/spec-builder.ts`, `web-v2/lib/training/goal-projection.ts`.
