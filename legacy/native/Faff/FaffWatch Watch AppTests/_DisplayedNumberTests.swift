//
//  _DisplayedNumberTests.swift
//  FaffWatch Watch AppTests
//
//  CORRECTNESS TESTS FOR THE NUMBERS THE WATCH DRAWS.
//
//  Not state-machine tests — WorkoutEngineTests already owns those. These
//  ask a narrower question: when the watch puts a figure on the glass, is
//  that figure right, and does the unit next to it describe the same thing
//  the figure was measured in?
//
//  The house bug shape, twice caught and fixed already:
//
//      "a number that is converted at the display edge everywhere EXCEPT
//       the one place that computes it itself"
//
//    · phase boards drew a per-kilometre figure under a hardcoded "/mi"
//    · the remaining-distance cue computed miles whatever the preference
//      said, so a km runner was told "0.25 left" a quarter MILE out
//
//  Everything below is either a guard against that shape returning, or a
//  `withKnownIssue` documenting a live instance of it that has NOT been
//  fixed. Product code is not touched by this file. Every `// BUG:` marks
//  a real defect with a stated real-world consequence.
//
//  Hand-computed values are stated in comments next to the expectation, in
//  the runner's own terms, so a reader can check the arithmetic without
//  re-deriving the conversion factor.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

// MARK: - Formatting helpers (WFmt · PaceFormat)

/// Pure functions, no actor, no engine. Every entry point in both
/// formatters, in BOTH units, with the ugly inputs the sensors actually
/// produce: nothing, zero, negative, one second, and race-scale.
struct DisplayedNumberFormatterTests {

    // ── WFmt.pace ────────────────────────────────────────────────────

    @Test func pace_absentIsAbsentNotZero() {
        // A zero pace is not a slow pace, it is an absent one. The board
        // drops the slot rather than drawing "0:00".
        #expect(WFmt.pace(nil) == nil)
        #expect(WFmt.pace(0) == nil)
        #expect(WFmt.pace(-1) == nil)
        #expect(WFmt.pace(-600) == nil)
    }

    @Test func pace_ordinaryAndEdgeValues() {
        #expect(WFmt.pace(391) == "6:31")     // 391 s = 6 min 31 s
        #expect(WFmt.pace(1) == "0:01")
        #expect(WFmt.pace(60) == "1:00")
        #expect(WFmt.pace(599) == "9:59")
        #expect(WFmt.pace(3599) == "59:59")   // last value inside the guard
        #expect(WFmt.pace(3600) == nil)       // an hour per mile is not a pace
        #expect(WFmt.pace(100_000) == nil)
    }

    // ── WFmt.clock ───────────────────────────────────────────────────

    @Test func clock_clampsAtZeroAndCarriesHours() {
        #expect(WFmt.clock(0) == "0:00")
        #expect(WFmt.clock(-1) == "0:00")
        #expect(WFmt.clock(-9999) == "0:00")
        #expect(WFmt.clock(1) == "0:01")
        #expect(WFmt.clock(59) == "0:59")
        #expect(WFmt.clock(60) == "1:00")
        #expect(WFmt.clock(3599) == "59:59")
        #expect(WFmt.clock(3600) == "1:00:00")
        #expect(WFmt.clock(3661) == "1:01:01")
        // 5:59:59 — the ugly one the brief asked for. 5*3600 + 59*60 + 59.
        #expect(WFmt.clock(21_599) == "5:59:59")
        // A marathon goal, 3:50:00.
        #expect(WFmt.clock(13_800) == "3:50:00")
    }

    // ── WFmt.short ───────────────────────────────────────────────────

    @Test func short_isMinutesAndSecondsOnly() {
        #expect(WFmt.short(0) == "0:00")
        #expect(WFmt.short(-1) == "0:00")
        #expect(WFmt.short(1) == "0:01")
        #expect(WFmt.short(480) == "8:00")
        #expect(WFmt.short(3599) == "59:59")
        // Documented as "always under an hour". Past it, minutes keep
        // counting rather than rolling into an hour field — which is the
        // right call for a split ("60:12" reads as an hour of walking) and
        // is what every caller of `short` is: a lap or a countdown.
        #expect(WFmt.short(3600) == "60:00")
    }

    // ── WFmt.miles (raw, no unit attached) ───────────────────────────

    @Test func miles_twoDecimalsUnderAHundred() {
        #expect(WFmt.miles(0) == "0.00")
        #expect(WFmt.miles(-3.5) == "0.00")     // clamped, never "-3.50"
        #expect(WFmt.miles(5.723) == "5.72")
        #expect(WFmt.miles(99.99) == "99.99")
        #expect(WFmt.miles(100) == "100.0")     // one decimal at ultra scale
        #expect(WFmt.miles(135.46) == "135.5")
    }

    // ── WFmt.isKm — the unit switch itself ───────────────────────────

    @Test func isKm_onlyExactlyKm() {
        // Anything a newer server invents renders as miles, which is the
        // same default every payload had before the field existed.
        #expect(WFmt.isKm("km") == true)
        #expect(WFmt.isKm("mi") == false)
        #expect(WFmt.isKm(nil) == false)
        #expect(WFmt.isKm("") == false)
        #expect(WFmt.isKm("KM") == false)
        #expect(WFmt.isKm("Km") == false)
        #expect(WFmt.isKm("kilometres") == false)
    }

    // ── WFmt.distance — value AND unit travel as a pair ──────────────

    @Test func distance_milesLand() {
        let d = WFmt.distance(5.723, units: "mi")
        #expect(d.value == "5.72")
        #expect(d.unit == "mi")
        #expect(WFmt.distance(5.723, units: nil).unit == "mi")
        #expect(WFmt.distance(5.723, units: "MI").unit == "mi")
    }

    @Test func distance_kmLand() {
        // 1 mi = 1.609344 km. The pair must never disagree with itself.
        let one = WFmt.distance(1.0, units: "km")
        #expect(one.value == "1.61")
        #expect(one.unit == "km")

        // 5.00 mi = 8.0467 km
        #expect(WFmt.distance(5.0, units: "km").value == "8.05")
        // 0.50 mi = 0.8047 km
        #expect(WFmt.distance(0.5, units: "km").value == "0.80")
        // 26.2 mi = 42.16 km
        #expect(WFmt.distance(26.2, units: "km").value == "42.16")
        // Zero and negative clamp the same way in both units.
        #expect(WFmt.distance(0, units: "km").value == "0.00")
        #expect(WFmt.distance(-4, units: "km").value == "0.00")
        // 62.14 mi = 100.0 km — the one-decimal switch is applied to the
        // number actually drawn, not to the mile value behind it.
        #expect(WFmt.distance(62.14, units: "km").value == "100.0")
    }

    // ── WFmt.paceWithUnit — the pair that fixed the "/mi" bug ────────

    @Test func paceWithUnit_absentStaysAbsentInBothUnits() {
        #expect(WFmt.paceWithUnit(nil, units: "mi") == nil)
        #expect(WFmt.paceWithUnit(nil, units: "km") == nil)
        #expect(WFmt.paceWithUnit(0, units: "mi") == nil)
        #expect(WFmt.paceWithUnit(0, units: "km") == nil)
        #expect(WFmt.paceWithUnit(-1, units: "km") == nil)
    }

    @Test func paceWithUnit_milesLand() {
        let p = WFmt.paceWithUnit(391, units: "mi")
        #expect(p?.value == "6:31")
        #expect(p?.unit == "/mi")
        #expect(WFmt.paceWithUnit(391, units: nil)?.unit == "/mi")
        #expect(WFmt.paceWithUnit(1, units: "mi")?.value == "0:01")
        #expect(WFmt.paceWithUnit(3599, units: "mi")?.value == "59:59")
    }

    @Test func paceWithUnit_kmLand() {
        // 6:31/mi × 0.621371 = 242.96 s → 4:03/km. Hand-check: a 6:31 mile
        // is 4:03 per kilometre.
        let p = WFmt.paceWithUnit(391, units: "km")
        #expect(p?.value == "4:03")
        #expect(p?.unit == "/km")

        // 8:00/mi (480 s) → 298.26 s → 4:58/km
        #expect(WFmt.paceWithUnit(480, units: "km")?.value == "4:58")
        // 10:00/mi (600 s) → 372.82 s → 6:13/km
        #expect(WFmt.paceWithUnit(600, units: "km")?.value == "6:13")
        // 5:00/mi (300 s) → 186.41 s → 3:06/km
        #expect(WFmt.paceWithUnit(300, units: "km")?.value == "3:06")
    }

    @Test func paceWithUnit_theGuardIsExpressedInMilesOnly() {
        // The <3600 guard is a miles-per-hour sanity check applied BEFORE
        // conversion. In km-land a 3600 s/mi shuffle is 37:16/km — a
        // perfectly drawable figure — and it is still rejected.
        //
        // Not marked as a bug: 60 min/mi is a walk with a pram, every
        // caller treats a missing pace as "drop the slot", and dropping
        // the slot there is the honest read. Recorded so the asymmetry is
        // a decision on the record rather than a surprise.
        #expect(WFmt.paceWithUnit(3600, units: "km") == nil)
        #expect(WFmt.paceWithUnit(3599, units: "km")?.value == "37:16")
    }

    // ── WFmt.elevation ───────────────────────────────────────────────

    @Test func elevation_metresInKmLandFeetInMilesLand() {
        // A runner who thinks in kilometres does not think in feet.
        #expect(WFmt.elevation(nil, units: "mi") == nil)
        #expect(WFmt.elevation(nil, units: "km") == nil)

        let km = WFmt.elevation(147.0, units: "km")
        #expect(km?.value == "+147")
        #expect(km?.unit == "m")

        // 147 m × 3.28084 = 482.28 ft
        let mi = WFmt.elevation(147.0, units: "mi")
        #expect(mi?.value == "+482")
        #expect(mi?.unit == "ft")

        #expect(WFmt.elevation(0, units: "mi")?.value == "+0")
        #expect(WFmt.elevation(0, units: "km")?.value == "+0")
    }

    @Test func elevation_descentKeepsItsMinus() {
        // -30 m × 3.28084 = -98.4 ft
        #expect(WFmt.elevation(-30.0, units: "mi")?.value == "-98")
        #expect(WFmt.elevation(-30.0, units: "km")?.value == "-30")
    }

    @Test func elevation_theTwoOverloadsMeanDifferentThings() {
        // `elevation(_:units:)` takes METRES. `elevation(_:)` takes FEET.
        // Same name, same argument type, opposite interpretation — the
        // only thing separating them is whether the caller remembered to
        // pass `units:`. Forgetting it silently draws a metre count as
        // feet, understating a climb by 3.28×.
        //
        // Currently harmless: the single-argument (feet) overload has no
        // caller anywhere in the target. Not a shipped bug, so no
        // withKnownIssue — but pinned here so it stays visible, because
        // this is the exact grammar the two fixed unit bugs had.
        #expect(WFmt.elevation(147.0) == "+147")                    // 147 FEET
        #expect(WFmt.elevation(147.0, units: "mi")?.value == "+482") // 147 METRES
    }

    // ── WFmt.whole ───────────────────────────────────────────────────

    @Test func whole_dropsNonReadings() {
        #expect(WFmt.whole(nil) == nil)
        #expect(WFmt.whole(0) == nil)     // a zero heart rate is a dead strap
        #expect(WFmt.whole(-4) == nil)
        #expect(WFmt.whole(178) == "178")
        #expect(WFmt.whole(1) == "1")
    }

    // ── PaceFormat ───────────────────────────────────────────────────

    @Test func paceFormat_mmssFloorsAtZero() {
        #expect(PaceFormat.mmss(391) == "6:31")
        #expect(PaceFormat.mmss(0) == "0:00")
        #expect(PaceFormat.mmss(-1) == "0:00")     // never "-1:-1"
        #expect(PaceFormat.mmss(-600) == "0:00")
        #expect(PaceFormat.mmss(3600) == "60:00")
    }

    @Test func paceFormat_mmssWithUnitConvertsAndLabels() {
        #expect(PaceFormat.mmssWithUnit(391, unitsPref: "mi") == "6:31/mi")
        #expect(PaceFormat.mmssWithUnit(391, unitsPref: nil) == "6:31/mi")
        #expect(PaceFormat.mmssWithUnit(391, unitsPref: "KM") == "6:31/mi")
        // 6:31/mi = 4:03/km
        #expect(PaceFormat.mmssWithUnit(391, unitsPref: "km") == "4:03/km")
        // 6:47/mi (407 s) × 0.621371 = 252.9 s → 4:13/km
        #expect(PaceFormat.mmssWithUnit(407, unitsPref: "km") == "4:13/km")
        // Negatives floor in both units rather than escaping as "-1:-1/km".
        #expect(PaceFormat.mmssWithUnit(-60, unitsPref: "km") == "0:00/km")
        #expect(PaceFormat.mmssWithUnit(-60, unitsPref: "mi") == "0:00/mi")
    }

    @Test func paceFormat_clockHmsHm() {
        #expect(PaceFormat.clock(135) == "2:15")
        #expect(PaceFormat.clock(0) == "0:00")
        #expect(PaceFormat.clock(3600) == "60:00")

        #expect(PaceFormat.hms(59) == "0:59")
        #expect(PaceFormat.hms(3599) == "59:59")
        #expect(PaceFormat.hms(3600) == "1:00")     // seconds drop past an hour
        #expect(PaceFormat.hms(13_800) == "3:50")

        #expect(PaceFormat.hm(13_800) == "3:50")
        #expect(PaceFormat.hm(0) == "0:00")
        #expect(PaceFormat.hm(59) == "0:00")        // under a minute reads 0:00
    }

    @Test func paceFormat_clockHasNoNegativeGuardUnlikeMmss() {
        // `mmss` floors at zero and says so in its own doc comment; `clock`,
        // `hms` and `hm` do not, and a negative escapes as a malformed
        // string rather than a clamped one.
        //
        // NOT marked as a bug: all three are currently unreachable — the
        // only PaceFormat entry point with a live caller is `mmss` (three
        // sites in WorkoutEngine). Pinned so that wiring one of them to a
        // delta, a countdown, or a "time to goal" is a decision made with
        // this in view.
        #expect(PaceFormat.clock(-5) == "0:-5")
        #expect(PaceFormat.hms(-5) == "0:-5")
    }
}

// MARK: - Derived numbers off a live engine

@MainActor
struct DisplayedNumberEngineTests {

    // ── Fixtures ─────────────────────────────────────────────────────

    /// Warmup → work → cooldown, all time-based. Mirrors
    /// WorkoutEngineTests.makeWorkout so the two files agree on shape.
    private func makeThreePhase(units: String? = nil) -> WatchWorkout {
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup",
                       durationSec: 600, targetPaceSPerMi: nil,
                       tolerancePaceSPerMi: nil, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "Interval 1/1",
                       durationSec: 420, targetPaceSPerMi: 391,
                       tolerancePaceSPerMi: 10, haptic: .transitionWork),
            WatchPhase(index: 2, type: .cooldown, label: "Cooldown",
                       durationSec: 600, targetPaceSPerMi: nil,
                       tolerancePaceSPerMi: nil, haptic: .transitionCooldown),
        ]
        return WatchWorkout(workoutId: "num-3phase", name: "Test", summary: "t",
                            totalEstimatedMinutes: 27, phases: phases,
                            completionEndpoint: "/api/watch/workouts/complete",
                            expiresAt: "2099-12-31T00:00:00Z",
                            unitsDistance: units)
    }

    /// A single wide-band work phase — the shape the backend emits for
    /// EVERY easy / long / recovery / just-run session (expand-spec.ts).
    /// `durationSec` is deliberately huge so nothing auto-advances while a
    /// test drives distance past mile boundaries.
    private func makeEasyRun(units: String?) -> WatchWorkout {
        let phase = WatchPhase(index: 0, type: .work, label: "Easy",
                               durationSec: 100_000, targetPaceSPerMi: 480,
                               tolerancePaceSPerMi: 20, haptic: .start)
        return WatchWorkout(workoutId: "num-easy", name: "Easy", summary: "easy",
                            totalEstimatedMinutes: 60, phases: [phase],
                            completionEndpoint: "/api/watch/workouts/complete",
                            expiresAt: "2099-12-31T00:00:00Z",
                            unitsDistance: units)
    }

    /// A 10-mile race with an 80-minute goal — 8:00/mi flat. Every number
    /// in the goal maths is exact in binary, so the hand-computed deltas
    /// below are exact too rather than "within a second".
    private func makeRace(units: String? = nil, gels: [Double]? = nil) -> WatchWorkout {
        let phase = WatchPhase(index: 0, type: .work, label: "Race",
                               durationSec: 14_400, targetPaceSPerMi: 480,
                               tolerancePaceSPerMi: 15, haptic: .start)
        return WatchWorkout(workoutId: "num-race", name: "Ten Miler", summary: "race",
                            totalEstimatedMinutes: 80, phases: [phase],
                            completionEndpoint: "/api/watch/workouts/complete",
                            expiresAt: "2099-12-31T00:00:00Z",
                            distanceMi: 10.0, isRace: true, goalSec: 4800,
                            gelsMi: gels, unitsDistance: units)
    }

    /// Warmup → work → recovery → work → cooldown. The shape that can take
    /// a "+30 sec" recovery extension.
    private func makeIntervalWithRecovery() -> WatchWorkout {
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup", durationSec: 60,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "Rep 1", durationSec: 60,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 8, haptic: .transitionWork),
            WatchPhase(index: 2, type: .recovery, label: "Recovery", durationSec: 120,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .transitionRecovery),
            WatchPhase(index: 3, type: .work, label: "Rep 2", durationSec: 60,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 8, haptic: .transitionWork),
            WatchPhase(index: 4, type: .cooldown, label: "Cooldown", durationSec: 60,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .transitionCooldown),
        ]
        return WatchWorkout(workoutId: "num-intervals", name: "Intervals", summary: "i",
                            totalEstimatedMinutes: 6, phases: phases,
                            completionEndpoint: "/api/watch/workouts/complete",
                            expiresAt: "2099-12-31T00:00:00Z")
    }

    // ── Simulated clock ──────────────────────────────────────────────

    /// One tick, `seconds` of simulated wall-clock behind it. Same helper
    /// WorkoutEngineTests uses; cumulative across calls.
    private func simulate(_ engine: WorkoutEngine, seconds: Int) {
        engine.phaseStart = engine.phaseStart.addingTimeInterval(-Double(seconds))
        engine.tick()
    }

    /// `count` ticks, each carrying `secondsEach` of wall clock. The engine
    /// samples HR and cadence once per TICK, so the two arguments are not
    /// interchangeable — see `avgHrIsTickWeightedNotTimeWeighted`.
    private func ticks(_ engine: WorkoutEngine, count: Int, secondsEach: Int = 1) {
        for _ in 0..<count { simulate(engine, seconds: secondsEach) }
    }

    private func tracker(pace: Int = 480, hr: Int = 0, cadence: Int = 0,
                         distanceMi: Double = 0) -> WorkoutTracker {
        let t = WorkoutTracker()
        t.setFixture(pace: pace, hr: hr, cadence: cadence, distanceMi: distanceMi)
        return t
    }

    // MARK: - Race numbers · delta against goal

    @Test func projectedFinish_needsMeaningfulDistanceFirst() {
        let t = tracker(distanceMi: 0.08)
        let e = WorkoutEngine.fixture(workout: makeRace(), currentIndex: 0,
                                      phaseElapsedSec: 40, totalElapsedSec: 40)
        e.tracker = t
        // A projection off the first hundred metres is noise, and drawing it
        // would be a claim the run cannot support.
        #expect(e.projectedFinishSec == nil)
        #expect(e.projectedDeltaSec == nil)

        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 0.09)
        #expect(e.projectedFinishSec != nil)
    }

    @Test func goalDelta_isNegativeWhenAheadOfGoal() {
        // 2.00 mi in 15:00 = 7:30/mi. Goal pace is 8:00/mi over 10 mi.
        // Projected finish = 900 × 10 / 2 = 4500 s = 1:15:00.
        // Delta = 4500 − 4800 = −300 s. Hand-check: 30 s/mi quicker × 10 mi
        // = 300 s in hand. Five minutes ahead, drawn as "−5:00".
        let e = WorkoutEngine.fixture(workout: makeRace(), currentIndex: 0,
                                      phaseElapsedSec: 900, totalElapsedSec: 900)
        e.tracker = tracker(distanceMi: 2.0)
        #expect(e.projectedFinishSec == 4500)
        #expect(e.projectedDeltaSec == -300)
        #expect(WFmt.short(abs(e.projectedDeltaSec ?? 0)) == "5:00")
    }

    @Test func goalDelta_isPositiveWhenBehindGoal() {
        // 2.00 mi in 16:40 (1000 s) = 8:20/mi. Projected = 1000 × 10 / 2
        // = 5000 s. Delta = +200 s. Hand-check: 20 s/mi slower × 10 mi
        // = 200 s down. Drawn as "+3:20".
        let e = WorkoutEngine.fixture(workout: makeRace(), currentIndex: 0,
                                      phaseElapsedSec: 1000, totalElapsedSec: 1000)
        e.tracker = tracker(distanceMi: 2.0)
        #expect(e.projectedFinishSec == 5000)
        #expect(e.projectedDeltaSec == 200)
        #expect(WFmt.short(200) == "3:20")
    }

    @Test func goalDelta_isZeroExactlyOnGoalPace() {
        // 5.00 mi in 40:00 (2400 s) = 8:00/mi, which IS goal pace.
        // Projected = 2400 × 10 / 5 = 4800 = the goal. Delta must be 0,
        // not ±1 — an on-pace runner shown "+0:01" is being told a lie
        // about the only number they are watching.
        let e = WorkoutEngine.fixture(workout: makeRace(), currentIndex: 0,
                                      phaseElapsedSec: 2400, totalElapsedSec: 2400)
        e.tracker = tracker(distanceMi: 5.0)
        #expect(e.projectedFinishSec == 4800)
        #expect(e.projectedDeltaSec == 0)
    }

    @Test func goalDelta_signIsConsistentAcrossTheWholeRun() {
        // Four points of one race, each hand-computed. The sign must never
        // flip meaning: negative is always "in hand", positive always "down".
        let e = WorkoutEngine.fixture(workout: makeRace(), currentIndex: 0,
                                      phaseElapsedSec: 0, totalElapsedSec: 0)
        let t = tracker()
        e.tracker = t

        // mile 1 at 7:45 → proj 4650, delta −150
        let points: [(mi: Double, sec: Int, proj: Int, delta: Int)] = [
            (1.0,  465,  4650,  -150),
            (4.0, 1860,  4650,  -150),   // still 7:45/mi
            (8.0, 3800,  4750,   -50),   // 7:55/mi — ahead, but less so
            (8.0, 4000,  5000,   200),   // 8:20/mi — now behind
        ]
        for p in points {
            t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: p.mi)
            let e2 = WorkoutEngine.fixture(workout: makeRace(), currentIndex: 0,
                                           phaseElapsedSec: p.sec, totalElapsedSec: p.sec)
            e2.tracker = t
            #expect(e2.projectedFinishSec == p.proj)
            #expect(e2.projectedDeltaSec == p.delta)
            // Ahead reads negative, behind reads positive. Always.
            if p.delta < 0 { #expect((e2.projectedDeltaSec ?? 0) < 0) }
            if p.delta > 0 { #expect((e2.projectedDeltaSec ?? 0) > 0) }
        }
        _ = e
    }

    @Test func distanceToGo_clampsAtZeroPastTheLine() {
        let t = tracker(distanceMi: 2.0)
        let e = WorkoutEngine.fixture(workout: makeRace(), currentIndex: 0,
                                      phaseElapsedSec: 900, totalElapsedSec: 900)
        e.tracker = t
        #expect(e.distanceToGoMi == 8.0)

        // Course measured long / GPS over-reads: "−0.3 to go" is not a thing.
        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 10.3)
        #expect(e.distanceToGoMi == 0)
    }

    @Test func nextGel_countsFromTheNextUncrossedMark() {
        let t = tracker(distanceMi: 2.0)
        let e = WorkoutEngine.fixture(workout: makeRace(gels: [3, 6, 9]),
                                      currentIndex: 0, phaseElapsedSec: 900,
                                      totalElapsedSec: 900)
        e.tracker = t
        #expect(e.nextGel?.number == 1)
        #expect(e.nextGel?.toGoMi == 1.0)

        // Standing exactly ON the aid station — it is behind you now.
        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 3.0)
        #expect(e.nextGel?.number == 2)
        #expect(e.nextGel?.toGoMi == 3.0)

        // Past the last one — no register rather than a zero.
        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 9.5)
        #expect(e.nextGel == nil)
    }

    // MARK: - Averages

    @Test func phaseAverages_matchHandComputedMeanAtOneHertz() {
        let e = WorkoutEngine(workout: makeThreePhase())
        e.tracker = WorkoutTracker()
        e.start()
        // AFTER start(): `WorkoutEngine.start()` calls `tracker.start()`,
        // which zeroes distance / HR / cadence so a second run never
        // inherits the first one's totals. A fixture set before start is
        // wiped before the first tick reads it.
        e.tracker?.setFixture(pace: 480, hr: 140, cadence: 170, distanceMi: 0)

        // 10 ticks at 140 bpm / 170 spm, then 10 at 160 / 180.
        ticks(e, count: 10)
        e.tracker?.setFixture(pace: 480, hr: 160, cadence: 180, distanceMi: 0)
        ticks(e, count: 10)

        e.endCurrentPhase()
        e.abandon()

        let warmup = e.completion?.phases.first
        // (140×10 + 160×10) / 20 = 3000 / 20 = 150
        #expect(warmup?.avgHr == 150)
        // (170×10 + 180×10) / 20 = 3500 / 20 = 175
        #expect(warmup?.avgCadence == 175)
        #expect(warmup?.maxHr == 160)
        #expect(warmup?.actualDurationSec == 20)
        e.reset()
    }

    @Test func topLevelAveragesAreDurationWeightedAcrossWorkPhasesOnly() {
        // Warmup at a high HR must NOT drag the run's headline average —
        // the completion re-derives from work phases only.
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup", durationSec: 600,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "Rep 1", durationSec: 600,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 8, haptic: .transitionWork),
            WatchPhase(index: 2, type: .work, label: "Rep 2", durationSec: 600,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 8, haptic: .transitionWork),
        ]
        let w = WatchWorkout(workoutId: "num-avg", name: "A", summary: "a",
                             totalEstimatedMinutes: 30, phases: phases,
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z")
        let e = WorkoutEngine(workout: w)
        e.tracker = WorkoutTracker()
        e.start()
        e.tracker?.setFixture(pace: 391, hr: 199, cadence: 199, distanceMi: 0)

        ticks(e, count: 5)                       // warmup, 199 bpm — must be excluded
        e.endCurrentPhase()

        e.tracker?.setFixture(pace: 391, hr: 150, cadence: 170, distanceMi: 0)
        ticks(e, count: 10)                      // rep 1: 10 s at 150
        e.endCurrentPhase()

        e.tracker?.setFixture(pace: 391, hr: 170, cadence: 190, distanceMi: 0)
        ticks(e, count: 30)                      // rep 2: 30 s at 170
        e.endCurrentPhase()                      // last phase → overtime
        e.abandon()

        let c = e.completion
        // (150×10 + 170×30) / 40 = 6600 / 40 = 165. The 199 bpm warmup is
        // nowhere in that number, which is the whole point.
        #expect(c?.avgHr == 165)
        // (170×10 + 190×30) / 40 = 7400 / 40 = 185
        #expect(c?.avgCadence == 185)
        e.reset()
    }

    @Test func avgHrAndCadenceAreWeightedByTimeNotByTick() {
        // BUG: the per-phase HR / cadence averages accumulate ONE sample per
        // tick (`phaseHrSum += hr` in tick()), but the engine's tick interval
        // is not constant: `startTimer()` sleeps 5 s instead of 1 s whenever
        // `tracker.isLuminanceReduced` — i.e. for the whole of every
        // wrist-down Always-On stretch. A minute spent with the wrist down
        // therefore contributes 12 samples where a minute with the wrist up
        // contributes 60, so that minute is weighted 5× too lightly.
        //
        // The completion then compounds it: buildCompletion() rolls the
        // per-phase averages up weighted by actualDurationSec (WALL seconds),
        // on the stated assumption that "each phase aggregate is itself
        // sample-count-weighted at ~1 Hz". It is not.
        //
        // REAL-WORLD CONSEQUENCE: a runner who holds a hard effort with their
        // arm down and only lifts the wrist for the easy stretches gets an
        // average heart rate biased toward the easy stretches. It is the
        // headline number on the finish board and on the phone recap, and it
        // feeds the recap's "was this actually easy" reads.
        //
        // Below: 60 s at 200 bpm sampled at the Always-On rate (12 ticks of
        // 5 s), then 10 s at 100 bpm sampled at 1 Hz (10 ticks of 1 s).
        let e = WorkoutEngine(workout: makeThreePhase())
        e.tracker = WorkoutTracker()
        e.start()
        e.tracker?.setFixture(pace: 480, hr: 200, cadence: 190, distanceMi: 0)

        ticks(e, count: 12, secondsEach: 5)      // 60 s of wall clock, 12 samples
        e.tracker?.setFixture(pace: 480, hr: 100, cadence: 160, distanceMi: 0)
        ticks(e, count: 10, secondsEach: 1)      // 10 s of wall clock, 10 samples

        e.endCurrentPhase()
        e.abandon()
        let p = e.completion?.phases.first

        // The phase really lasted 70 s — that part is right.
        #expect(p?.actualDurationSec == 70)

        // FIXED 2026-08-24. Each sample is weighted by the seconds it stands
        // for, derived from the clock rather than from an assumed 1 Hz — the
        // tick loop sleeps FIVE seconds whenever the display is dimmed, which
        // is the whole of every wrist-down stretch.
        //
        // WAS: a mean over ticks, so a minute of not looking contributed
        // twelve samples against ten seconds of looking contributing ten, and
        // the run's saved averages leaned five to one toward the parts the
        // runner happened to be watching. HR reported 155 against a true 186.
        //
        // (200×60 + 100×10) / 70 = 13000 / 70 = 185.71 → 186 bpm
        // (190×60 + 160×10) / 70 = 13000 / 70 = 185.71 → 186 spm
        #expect(p?.avgHr == 186)
        #expect(p?.avgCadence == 186)
        e.reset()
    }

    // MARK: - Split times

    @Test func mileSplits_firstOneMeasuresFromTheStart() {
        let e = WorkoutEngine(workout: makeEasyRun(units: "mi"))
        let t = tracker()
        e.tracker = t
        e.start()
        e.transition = nil

        // Cross mile 1 at 8:00 elapsed.
        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 1.01)
        simulate(e, seconds: 480)
        #expect(e.totalElapsedSec == 480)
        // The first split is the whole 8:00 from the gun — NOT a lap that
        // starts counting at zero the moment mile 1 is crossed.
        #expect(e.transition == .split(mileNo: 1, paceSec: 480))
        e.reset()
    }

    @Test func mileSplits_eachLapMeasuresItsOwnMile() {
        let e = WorkoutEngine(workout: makeEasyRun(units: "mi"))
        let t = tracker()
        e.tracker = t
        e.start()
        e.transition = nil

        // mile 1 · 8:00 (elapsed 480)
        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 1.01)
        simulate(e, seconds: 480)
        #expect(e.transition == .split(mileNo: 1, paceSec: 480))

        // mile 2 · 8:00 (elapsed 960, 960 − 480 = 480)
        e.transition = nil
        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 2.01)
        simulate(e, seconds: 480)
        #expect(e.totalElapsedSec == 960)
        #expect(e.transition == .split(mileNo: 2, paceSec: 480))

        // mile 3 · 9:00 (elapsed 1500, 1500 − 960 = 540)
        e.transition = nil
        t.setFixture(pace: 540, hr: 0, cadence: 0, distanceMi: 3.02)
        simulate(e, seconds: 540)
        #expect(e.totalElapsedSec == 1500)
        #expect(e.transition == .split(mileNo: 3, paceSec: 540))

        // mile 4 · 7:12 (elapsed 1932, 1932 − 1500 = 432)
        e.transition = nil
        t.setFixture(pace: 432, hr: 0, cadence: 0, distanceMi: 4.00)
        simulate(e, seconds: 432)
        #expect(e.transition == .split(mileNo: 4, paceSec: 432))
        e.reset()
    }

    @Test func mileSplits_pausedSecondsDoNotInflateTheLap() {
        // The clock the split is diffed against is paused-corrected, so a
        // stoplight between mile 1 and mile 2 must not appear in mile 2's
        // time. (Pause here carries ~0 s of real wall clock; what the test
        // proves is that the frozen ticks contribute nothing.)
        let e = WorkoutEngine(workout: makeEasyRun(units: "mi"))
        let t = tracker()
        e.tracker = t
        e.start()
        e.transition = nil

        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 1.01)
        simulate(e, seconds: 480)
        #expect(e.transition == .split(mileNo: 1, paceSec: 480))

        e.transition = nil
        e.pause()
        for _ in 0..<20 { e.tick() }             // frozen — no clock, no split
        #expect(e.transition == nil)
        e.resume()

        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 2.01)
        simulate(e, seconds: 480)
        // resume() shifts the phase origin by the REAL pause duration
        // (sub-millisecond here), so the lap can land one second either
        // side of 8:00 — what matters is that twenty frozen ticks did not
        // add twenty seconds to it.
        guard case .split(let mileNo, let paceSec)? = e.transition else {
            Issue.record("mile 2 split did not fire after the pause")
            return
        }
        #expect(mileNo == 2)
        #expect(abs(paceSec - 480) <= 2)
        e.reset()
    }

    @Test func splitsAreCountedInTheRunnersOwnUnit() {
        // REGRESSION GUARD. The split index was `Int(coveredMi)` — an
        // integer MILE — while the router drew the label as
        //     (WFmt.isKm(units) ? "Km " : "Mile ") + String(index)
        // so the LABEL converted and the FIGURE did not: a metric runner got
        // "Km 1" after a mile, carrying a mile's split time. It is now
        // `Int(coveredMi × 1.609344)` when the payload says km.
        //
        // The lap DURATION needs no conversion once the index is right — it
        // is measured between crossings of whatever unit is being counted —
        // and that is the half of the pair this test pins hardest.
        //
        // Driven at 5:00/km, which is 8:03/mi. A correct board reads
        // "Km 1 · 5:00", never "Km 1 · 8:03".
        let e = WorkoutEngine(workout: makeEasyRun(units: "km"))
        let t = WorkoutTracker()
        e.tracker = t
        e.start()
        e.transition = nil

        // 1 km = 0.621371 mi. At 0.63 mi the first kilometre is banked.
        t.setFixture(pace: 483, hr: 0, cadence: 0, distanceMi: 0.63)
        simulate(e, seconds: 300)
        #expect(e.transition == .split(mileNo: 1, paceSec: 300))   // 5:00

        // 2 km = 1.2427 mi.
        e.transition = nil
        t.setFixture(pace: 483, hr: 0, cadence: 0, distanceMi: 1.25)
        simulate(e, seconds: 300)
        #expect(e.transition == .split(mileNo: 2, paceSec: 300))

        // 3 km = 1.8641 mi, run 10 s quicker.
        e.transition = nil
        t.setFixture(pace: 467, hr: 0, cadence: 0, distanceMi: 1.87)
        simulate(e, seconds: 290)
        #expect(e.transition == .split(mileNo: 3, paceSec: 290))   // 4:50
        e.reset()
    }

    @Test func aMilesRunnerStillSplitsOnMiles() {
        // The other half of the pair: the same code path with the miles
        // payload must not have moved. 1.61 km is NOT a split for them.
        let e = WorkoutEngine(workout: makeEasyRun(units: "mi"))
        let t = WorkoutTracker()
        e.tracker = t
        e.start()
        e.transition = nil

        // 0.63 mi — past a kilometre, nowhere near a mile. Silence.
        t.setFixture(pace: 483, hr: 0, cadence: 0, distanceMi: 0.63)
        simulate(e, seconds: 300)
        #expect(e.transition == nil)

        t.setFixture(pace: 483, hr: 0, cadence: 0, distanceMi: 1.01)
        simulate(e, seconds: 183)
        #expect(e.transition == .split(mileNo: 1, paceSec: 483))   // 8:03
        e.reset()
    }

    @Test func finishSummarySplitsAreOneRowForTheWholeEasyRun() {
        // BUG: `engine.splits` is one row per WORK PHASE, and the backend
        // emits every easy / long / recovery / just-run session as ONE work
        // phase. The finish summary labels the rows
        //     noun = hasReps ? "Rep" : (isKm ? "Km" : "Mile")
        // where `hasReps` is `work phases > 1` — so a single-work-phase run
        // takes the "Mile" branch and draws exactly one row, "Mile 1",
        // carrying the average pace of the ENTIRE run.
        //
        // REAL-WORLD CONSEQUENCE: after a six-mile long run whose first mile
        // was a 8:00 warm-up jog and whose last five were 6:00, the summary
        // says "Mile 1 — 6:20" and nothing else. The runner reads it as
        // their opening mile. It is the whole run.
        //
        // Below: mile 1 at 8:00 (480 s), miles 2-6 at 6:00 (1800 s).
        // Total 2280 s over 6.00 mi → 380 s/mi = 6:20/mi.
        let e = WorkoutEngine(workout: makeEasyRun(units: "mi"))
        let t = tracker()
        e.tracker = t
        e.start()

        t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 1.0)
        simulate(e, seconds: 480)
        t.setFixture(pace: 360, hr: 0, cadence: 0, distanceMi: 6.0)
        simulate(e, seconds: 1800)
        e.endCurrentPhase()

        // `e.splits` is one row per WORK PHASE and still is — that is what it
        // means, and 2280 / 6.00 = 380 s/mi is the honest phase average.
        #expect(e.splits.count == 1)
        #expect(e.splits.first?.paceSPerMi == 380)
        #expect(e.splits.first?.state == .done)

        // FIXED 2026-08-24. The defect was the summary DRAWING that single
        // phase row as "Mile 1", so a six-mile run opened at 8:00 and finished
        // at 6:00 read as a 6:20 opening mile. The engine records every unit
        // boundary now, and the summary uses those for a run with no reps.
        //
        // Mile 1 is its own row at its own pace — 480 s — rather than the
        // run's average wearing a mile's label.
        #expect(e.mileSplits.first?.unitIndex == 1)
        #expect(e.mileSplits.first?.sec == 480,
                "the opening mile keeps its own time")
        #expect(e.mileSplits.count >= 2, "and it is not the only row")
        e.reset()
    }

    // MARK: - Pace zone boundaries

    /// The zone a runner is graded into on their FIRST reading of a rep.
    /// A fresh evaluator each time, because `PaceDriftEvaluator` carries
    /// `lastZone` and the thresholds move with it — see the hysteresis test
    /// below. Every probe here starts from the documented initial state
    /// ("a run has not drifted until it has drifted").
    private func firstZone(target: Int, tolerance: Int, pace: Int) -> PaceZone {
        var ev = PaceDriftEvaluator(targetPaceSPerMi: target, toleranceSPerMi: tolerance)
        return ev.update(currentPaceSPerMi: pace).zone
    }

    @Test func paceZone_exactEdgesForATenSecondBand() {
        // tolerance 10 → hardDrift = max(15, 10 + 5) = 15, and the ±3
        // edgeMargin is applied outward while the runner is still graded
        // on target. So from a clean start:
        //   |Δ| ≤ 13  green    |Δ| ≤ 18  amber    otherwise red
        func z(_ pace: Int) -> PaceZone { firstZone(target: 480, tolerance: 10, pace: pace) }
        #expect(z(480) == .onTarget)      // Δ 0
        #expect(z(490) == .onTarget)      // Δ +10 · the prescribed band edge
        #expect(z(493) == .onTarget)      // Δ +13 · the sticky edge
        #expect(z(494) == .drifting)      // Δ +14 · first amber
        #expect(z(498) == .drifting)      // Δ +18 · the sticky hard edge
        #expect(z(499) == .offTarget)     // Δ +19 · first red
    }

    @Test func paceZone_isSymmetricAboutTheTarget() {
        // Too fast is exactly as much a drift as too slow, and at the same
        // distances — a runner ahead of the band must not be graded kinder
        // than one behind it.
        func z(_ pace: Int) -> PaceZone { firstZone(target: 480, tolerance: 10, pace: pace) }
        #expect(z(467) == .onTarget)      // Δ −13
        #expect(z(466) == .drifting)      // Δ −14
        #expect(z(462) == .drifting)      // Δ −18
        #expect(z(461) == .offTarget)     // Δ −19

        // The signed delta the face draws follows the same convention in
        // both directions: negative means quicker than asked.
        var ev = PaceDriftEvaluator(targetPaceSPerMi: 480, toleranceSPerMi: 10)
        #expect(ev.update(currentPaceSPerMi: 461).deltaSPerMi == -19)
        #expect(ev.update(currentPaceSPerMi: 499).deltaSPerMi == 19)
    }

    @Test func paceZone_wideEasyBandWidensTheAmberBandToo() {
        // tolerance 20 (the easy / long / recovery default from
        // build-workout.ts) → hardDrift = max(15, 25) = 25.
        //   |Δ| ≤ 23  green    |Δ| ≤ 28  amber    otherwise red
        func z(_ pace: Int) -> PaceZone { firstZone(target: 540, tolerance: 20, pace: pace) }
        #expect(z(563) == .onTarget)      // Δ +23
        #expect(z(564) == .drifting)      // Δ +24
        #expect(z(568) == .drifting)      // Δ +28
        #expect(z(569) == .offTarget)     // Δ +29
    }

    @Test func paceZone_tightQualityBandKeepsTheFifteenSecondFloor() {
        // tolerance 8 (threshold / intervals) → hardDrift = max(15, 13) = 15,
        // so the amber band is 12…18 rather than 12…16: the 15 s/mi floor is
        // what stops a tight band collapsing straight from green to red.
        func z(_ pace: Int) -> PaceZone { firstZone(target: 391, tolerance: 8, pace: pace) }
        #expect(z(402) == .onTarget)      // Δ +11
        #expect(z(403) == .drifting)      // Δ +12
        #expect(z(409) == .drifting)      // Δ +18
        #expect(z(410) == .offTarget)     // Δ +19
    }

    @Test func paceZone_hysteresisMakesLeavingCostMoreThanEntering() {
        // One evaluator walked through a sequence, because the thresholds
        // depend on the zone last returned. tolerance 10, hard 15, margin 3.
        var ev = PaceDriftEvaluator(targetPaceSPerMi: 480, toleranceSPerMi: 10)

        #expect(ev.update(currentPaceSPerMi: 493).zone == .onTarget)   // Δ13 · 10+3
        #expect(ev.update(currentPaceSPerMi: 494).zone == .drifting)   // Δ14 · out
        // Coming back, the green band is now 10−3 = 7 wide, so Δ13 — which
        // was green a moment ago — is still amber. That is the point: the
        // colour stops repainting every time the pace crosses one number.
        #expect(ev.update(currentPaceSPerMi: 493).zone == .drifting)   // Δ13
        #expect(ev.update(currentPaceSPerMi: 488).zone == .drifting)   // Δ8
        #expect(ev.update(currentPaceSPerMi: 487).zone == .onTarget)   // Δ7 · back in

        // Same asymmetry at the red edge.
        #expect(ev.update(currentPaceSPerMi: 499).zone == .offTarget)  // Δ19 · 15+3+1
        #expect(ev.update(currentPaceSPerMi: 493).zone == .offTarget)  // Δ13 · 15−3 = 12
        #expect(ev.update(currentPaceSPerMi: 492).zone == .drifting)   // Δ12
    }

    @Test func paceZone_greenFaceNeverFiresTheEaseOffCue() {
        // BUG: the hysteresis widened the ZONE thresholds by ±3 s/mi but the
        // sustained-drift haptic gate below it still tests the raw
        // `magnitude > toleranceSPerMi`. In the 3 s/mi strip between the two,
        // the evaluator returns `.onTarget` AND `fireHaptic == true`.
        //
        // The engine acts on both: `paceZone` colours the pace number band
        // green, and `fireHaptic` plays the ease-off texture and flashes
        // `.headsUp`, which the router draws as a full-screen "Ease off"
        // board naming the band the runner is supposedly outside of.
        //
        // REAL-WORLD CONSEQUENCE: on a 391 ± 10 threshold rep, a runner
        // holding 403 gets a buzz and a takeover telling them to correct a
        // pace the same screen has just graded as on target. The one graded
        // value on the face and the cue that interrupts it disagree.
        var ev = PaceDriftEvaluator(targetPaceSPerMi: 480, toleranceSPerMi: 10)
        let t0 = Date()

        // Δ +12 — inside the sticky green band (≤13), outside the
        // prescribed one (>10).
        let first = ev.update(currentPaceSPerMi: 492, now: t0)
        #expect(first.zone == .onTarget)
        #expect(first.fireHaptic == false)          // sustain window not met yet

        let sustained = ev.update(currentPaceSPerMi: 492, now: t0.addingTimeInterval(5))
        #expect(sustained.zone == .onTarget)        // still graded green
        // FIXED 2026-08-24. The hysteresis widened the ZONE and left this gate
        // on the raw threshold, so inside that three-second strip the evaluator
        // returned .onTarget and fireHaptic together: a band-green pace number
        // while the watch buzzed and took the screen with an "Ease off" board
        // naming a band the runner was not outside. The cue follows the zone
        // now — one source of truth, and a grade and a correction can no longer
        // disagree.
        #expect(sustained.fireHaptic == false,
                "no correction may fire while the zone reads on target")
    }

    @Test func engineZoneHelperIgnoresThePhaseTolerance() {
        // `WorkoutEngine.zone(forPace:target:)` hardcodes 10 / 15 and never
        // reads the phase's own tolerance, so it disagrees with the live
        // evaluator for any band that is not exactly 10 s/mi wide: on a
        // 20 s/mi easy band, a Δ of 18 is GREEN live and RED here.
        //
        // NOT marked as a bug: the helper has no caller anywhere in the
        // target — the splits and session-map views it was written to
        // colour do not use it. Pinned so that wiring it up is a decision
        // taken with this divergence in view.
        let e = WorkoutEngine(workout: makeEasyRun(units: "mi"))
        #expect(e.zone(forPace: 498, target: 480) == .offTarget)          // Δ 18

        var live = PaceDriftEvaluator(targetPaceSPerMi: 480, toleranceSPerMi: 20)
        #expect(live.update(currentPaceSPerMi: 498).zone == .onTarget)

        // Its own documented edges, for completeness.
        #expect(e.zone(forPace: 490, target: 480) == .onTarget)           // Δ 10
        #expect(e.zone(forPace: 491, target: 480) == .drifting)           // Δ 11
        #expect(e.zone(forPace: 495, target: 480) == .drifting)           // Δ 15
        #expect(e.zone(forPace: 496, target: 480) == .offTarget)          // Δ 16
        #expect(e.zone(forPace: nil, target: 480) == .onTarget)
        #expect(e.zone(forPace: 496, target: nil) == .onTarget)
    }

    // MARK: - Elapsed accounting

    @Test func totalElapsedEqualsBankedPlusCurrentPhaseMidRun() {
        let e = WorkoutEngine(workout: makeThreePhase())
        e.start()

        simulate(e, seconds: 601)                // warmup banks 601
        #expect(e.currentIndex == 1)
        simulate(e, seconds: 30)                 // 30 s into the work rep
        #expect(e.phaseElapsedSec == 30)
        #expect(e.totalElapsedSec == 631)        // 601 + 30
        e.reset()
    }

    @Test func phaseDurationsSumToTotalDuration() {
        let workout = makeThreePhase()
        let e = WorkoutEngine(workout: workout)
        e.start()
        for p in workout.phases { simulate(e, seconds: p.durationSec + 1) }
        e.abandon()                              // from overtime → completed

        let c = e.completion
        // 601 + 421 + 601 = 1623
        #expect(c?.phases.map(\.actualDurationSec).reduce(0, +) == 1623)
        #expect(c?.totalDurationSec == 1623)
        #expect(c?.phases.map(\.actualDurationSec).reduce(0, +) == c?.totalDurationSec)
        e.reset()
    }

    @Test func pausedSecondsAreExcludedAndTheSumStillAgrees() {
        let workout = makeThreePhase()
        let e = WorkoutEngine(workout: workout)
        e.start()

        simulate(e, seconds: 100)
        e.pause()
        for _ in 0..<50 { e.tick() }             // frozen
        #expect(e.totalElapsedSec == 100)
        e.resume()
        simulate(e, seconds: 501)                // 601 total in warmup → advance
        #expect(e.currentIndex == 1)

        simulate(e, seconds: 421)
        simulate(e, seconds: 601)
        e.abandon()

        let c = e.completion
        // The absolute total is not asserted: resume() shifts the phase
        // origin by the real (sub-millisecond) pause, so the warmup can
        // bank 600 or 601. The LEDGER is the invariant — whatever the run
        // says it lasted, the phases must add up to exactly that.
        #expect(c?.phases.map(\.actualDurationSec).reduce(0, +) == c?.totalDurationSec)
        #expect((c?.totalDurationSec ?? 0) >= 1622)
        #expect((c?.totalDurationSec ?? 0) <= 1623)
        e.reset()
    }

    @Test func extendedRecoveryLengthensThePhaseAndTheSumStillAgrees() {
        let workout = makeIntervalWithRecovery()
        let e = WorkoutEngine(workout: workout)
        e.start()

        simulate(e, seconds: 61)                 // warmup done  (61)
        simulate(e, seconds: 61)                 // rep 1 done   (61)
        #expect(e.currentPhase?.type == .recovery)

        // "+30 sec" on the recovery face. 120 prescribed + 30 = 150.
        e.recordRecoveryExtension(addedSec: 30)
        #expect(e.phaseAddedSec == 30)
        #expect(e.phaseRemainingSec == 150)
        #expect(e.recoveryExtensionCount == 1)

        simulate(e, seconds: 121)                // 121 < 150 — still resting
        #expect(e.currentPhase?.type == .recovery)
        #expect(e.phaseRemainingSec == 29)       // 150 − 121
        simulate(e, seconds: 30)                 // 151 ≥ 150 → advance (151)
        #expect(e.currentPhase?.label == "Rep 2")

        simulate(e, seconds: 61)                 // rep 2 done   (61)
        simulate(e, seconds: 61)                 // cooldown     (61) → overtime
        #expect(e.planComplete)
        e.abandon()

        let c = e.completion
        // 61 + 61 + 151 + 61 + 61 = 395. The bought thirty seconds are in
        // the recovery's own duration, not in a ledger kept somewhere else.
        #expect(c?.phases.map(\.actualDurationSec).reduce(0, +) == 395)
        #expect(c?.totalDurationSec == 395)
        #expect(c?.phases[2].actualDurationSec == 151)
        e.reset()
    }

    @Test func extendedRecoveryDoesNotLeakIntoTheNextRep() {
        let e = WorkoutEngine(workout: makeIntervalWithRecovery())
        e.start()
        simulate(e, seconds: 61)
        simulate(e, seconds: 61)
        e.recordRecoveryExtension(addedSec: 30)
        #expect(e.phaseAddedSec == 30)
        simulate(e, seconds: 151)                // recovery ends
        // Rep 2 gets the duration the plan prescribed, not 90 s.
        #expect(e.phaseAddedSec == 0)
        #expect(e.phaseRemainingSec == 60)
        e.reset()
    }

    @Test func endingWhilePausedBanksThePausedSecondsIntoThePhase() {
        // BUG: `abandon()` guards on `state == .running` but not on
        // `isPaused`, and `recordCurrentPhase()` measures the phase with
        // `elapsedSincePhaseStart()` — raw wall clock since the phase began.
        // `phaseStart` is only shifted forward on `resume()`, so ending the
        // run straight from the pause board folds every paused second into
        // the phase's duration. The run's own `totalDurationSec` is taken
        // from `totalElapsedSec`, which correctly froze, so the two
        // disagree.
        //
        // Reachable in two taps: WMomentPaused draws "End run" →
        // router.confirm = .end → FaceEndConfirmV5 "End and save" →
        // engine.finish(save: true) → abandon(), never resuming.
        //
        // REAL-WORLD CONSEQUENCE: the per-phase record is what the phone
        // recap grades a session on. A five-minute wait at a level crossing
        // before ending the run adds five minutes to the last phase and
        // dilutes its average pace by the same amount — the phase below is
        // recorded at 14:00/mi for a stretch actually run at 10:00/mi.
        let e = WorkoutEngine(workout: makeThreePhase())
        let t = tracker(distanceMi: 0.0)
        e.tracker = t
        e.start()

        t.setFixture(pace: 600, hr: 0, cadence: 0, distanceMi: 0.5)
        simulate(e, seconds: 300)                // 5:00 running, 0.50 mi
        #expect(e.totalElapsedSec == 300)

        e.pause()
        // 120 s of real wall clock elapses while the runner stands still.
        // BOTH clocks have to move: rolling `phaseStart` alone models time
        // passing but not a PAUSE passing, and the engine would then close a
        // zero-length pause on the way out.
        e.phaseStart = e.phaseStart.addingTimeInterval(-120)
        e.pauseStart = e.pauseStart?.addingTimeInterval(-120)
        e.abandon()

        let p = e.completion?.phases.first
        // The run's own clock is right: the pause is excluded.
        #expect(e.completion?.totalDurationSec == 300)

        // FIXED 2026-08-24. `abandon()` closes a standing pause before it
        // records, so the phase and the run agree.
        //
        // WAS: `phaseStart` is only shifted forward by `resume()` and
        // `recordCurrentPhase()` measures raw, so ending from the paused
        // board folded the pause into the phase — 420 s over 0.50 mi recorded
        // as 14:00/mi for a stretch actually run at 10:00, while the run's own
        // totalDurationSec correctly said 300 s. Two numbers from one run that
        // disagreed, and the phase record is what the phone grades on.
        #expect(p?.actualDurationSec == 300)
        // 300 s over 0.50 mi = 600 s/mi = 10:00/mi.
        #expect(p?.actualPaceSPerMi == 600)
        // The ledger balances.
        #expect(p?.actualDurationSec == e.completion?.totalDurationSec)
        e.reset()
    }

    @Test func endingWithoutPausingRecordsThePhaseHonestly() {
        // Positive control for the test above — same drive, no pause.
        let e = WorkoutEngine(workout: makeThreePhase())
        let t = tracker(distanceMi: 0.0)
        e.tracker = t
        e.start()
        t.setFixture(pace: 600, hr: 0, cadence: 0, distanceMi: 0.5)
        simulate(e, seconds: 300)
        e.abandon()

        let p = e.completion?.phases.first
        #expect(p?.actualDurationSec == 300)
        #expect(p?.actualPaceSPerMi == 600)      // 10:00/mi
        #expect(p?.actualDurationSec == e.completion?.totalDurationSec)
        e.reset()
    }

    // MARK: - Phase-boundary cue strings

    @Test func workRepCueDrawsThePaceInTheRunnersOwnUnit() {
        // BUG: WorkoutEngine composes the phase-boundary cue as
        //     sub = "\(rep) · \(PaceFormat.mmss(t))/mi"
        // — `mmss` takes seconds-per-MILE and the "/mi" is a string literal.
        // Nothing here reads `workout.unitsDistance`.
        //
        // `PaceFormat.mmssWithUnit(_:unitsPref:)` exists for exactly this,
        // was added by the 2026-07-07 units audit, and has ZERO callers in
        // the target. Three sites in WorkoutEngine still hardcode "/mi":
        // the race segment cue, the long-run finish cue, and this one.
        //
        // REAL-WORLD CONSEQUENCE: the router hands the same board a band
        // computed through WFmt, which DOES convert. So a km runner's
        // phase board draws the detail line "Rep 1 of 1 · 6:31/mi" directly
        // above a band reading "/km" — two units on one board, at the one
        // moment the runner is being told what pace to run.
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup", durationSec: 60,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start),
            // No tolerance → the cue carries the point target itself.
            WatchPhase(index: 1, type: .work, label: "Threshold", durationSec: 600,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: nil, haptic: .transitionWork),
        ]
        let w = WatchWorkout(workoutId: "num-cue", name: "T", summary: "t",
                             totalEstimatedMinutes: 11, phases: phases,
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z",
                             unitsDistance: "km")
        let e = WorkoutEngine(workout: w)
        e.start()
        e.transition = nil
        simulate(e, seconds: 61)                 // advance into the work rep

        // FIXED 2026-08-24. 6:31/mi is 4:03/km — see
        // PaceFormat.mmssWithUnit(391, "km"), which the units audit wrote for
        // exactly this and which had zero callers while three cue strings a
        // few lines apart each hardcoded "/mi".
        #expect(e.transition == .phase(title: "Threshold",
                                       sub: "Rep 1 of 1 · 4:03/km"))
        e.reset()
    }

    @Test func raceSegmentCueDrawsThePaceInTheRunnersOwnUnit() {
        // Same defect, the race branch (WorkoutEngine's `isRace` phase-change
        // cue). A course segment boundary mid-race is the highest-stakes
        // place on the watch to state a target in the wrong unit.
        let phases = [
            WatchPhase(index: 0, type: .work, label: "The flat", durationSec: 60,
                       targetPaceSPerMi: 407, tolerancePaceSPerMi: 15, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "The hill", durationSec: 1200,
                       targetPaceSPerMi: 407, tolerancePaceSPerMi: 15, haptic: .transitionWork),
        ]
        let w = WatchWorkout(workoutId: "num-race-cue", name: "R", summary: "r",
                             totalEstimatedMinutes: 21, phases: phases,
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z",
                             isRace: true, goalSec: 4800, unitsDistance: "km")
        let e = WorkoutEngine(workout: w)
        e.start()
        e.transition = nil
        simulate(e, seconds: 61)

        // FIXED 2026-08-24. 6:47/mi is 4:13/km.
        #expect(e.transition == .phase(title: "The hill",
                                       sub: "4:13/km · hold effort"))
        e.reset()
    }

    @Test func longRunFinishCueDrawsThePaceInTheRunnersOwnUnit() {
        // Third of the three hardcoded "/mi" sites, all now going through
        // PaceFormat.mmssWithUnit — the HM/M finish segment of a long run.
        let phases = [
            WatchPhase(index: 0, type: .work, label: "Long", durationSec: 60,
                       targetPaceSPerMi: 540, tolerancePaceSPerMi: 20, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "2 mi", durationSec: 900,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: 12,
                       haptic: .transitionWork, isFinishSegment: true),
        ]
        let w = WatchWorkout(workoutId: "num-finish-cue", name: "L", summary: "l",
                             totalEstimatedMinutes: 16, phases: phases,
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z",
                             unitsDistance: "km")
        let e = WorkoutEngine(workout: w)
        e.start()
        e.transition = nil
        simulate(e, seconds: 61)

        // FIXED 2026-08-24. 6:31/mi is 4:03/km.
        #expect(e.transition == .phase(title: "Finish", sub: "2 mi · 4:03/km"))
        e.reset()
    }

    @Test func workRepCueIsCorrectForAMilesRunner() {
        // Positive control: the miles payload is right, which is why the
        // defect above has never been visible to the only runner using it.
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup", durationSec: 60,
                       targetPaceSPerMi: nil, tolerancePaceSPerMi: nil, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "Threshold", durationSec: 600,
                       targetPaceSPerMi: 391, tolerancePaceSPerMi: nil, haptic: .transitionWork),
        ]
        let w = WatchWorkout(workoutId: "num-cue-mi", name: "T", summary: "t",
                             totalEstimatedMinutes: 11, phases: phases,
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z",
                             unitsDistance: "mi")
        let e = WorkoutEngine(workout: w)
        e.start()
        e.transition = nil
        simulate(e, seconds: 61)
        #expect(e.transition == .phase(title: "Threshold",
                                       sub: "Rep 1 of 1 · 6:31/mi"))
        e.reset()
    }

    // MARK: - The remaining-distance cue (already fixed · regression guard)

    @Test func almostDoneCueIsStatedInTheRunnersOwnUnit() {
        // The bug that was fixed: a km runner told "0.25 left" a quarter of
        // a MILE from the end. A quarter mile is 0.40 km, and the board must
        // say so — with a unit word that matches.
        let phase = WatchPhase(index: 0, type: .work, label: "Easy",
                               durationSec: 100_000, targetPaceSPerMi: nil,
                               tolerancePaceSPerMi: nil, haptic: .start)
        func run(units: String?, covered: Double) -> WorkoutEngine.TransitionCue? {
            let w = WatchWorkout(workoutId: "num-almost", name: "E", summary: "e",
                                 totalEstimatedMinutes: 60, phases: [phase],
                                 completionEndpoint: "/c",
                                 expiresAt: "2099-12-31T00:00:00Z",
                                 distanceMi: 6.0, unitsDistance: units)
            let e = WorkoutEngine(workout: w)
            let t = WorkoutTracker()
            e.tracker = t
            e.start()
            // Consume the pending unit crossing on its own tick first — the
            // split takeover is evaluated AFTER the almost-done cue in
            // tick(), so letting both land on one tick would overwrite the
            // cue under test with a split board. 5.70 mi is 9.17 km, and
            // both the 5.75 and 5.80 probes below sit inside the same mile
            // (5) and the same kilometre (9), so neither crosses.
            t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: 5.70)
            e.phaseStart = e.phaseStart.addingTimeInterval(-60)
            e.tick()
            e.transition = nil

            t.setFixture(pace: 480, hr: 0, cadence: 0, distanceMi: covered)
            e.phaseStart = e.phaseStart.addingTimeInterval(-60)
            e.tick()
            let cue = e.transition
            e.reset()
            return cue
        }

        // 5.80 of 6.00 mi → 0.20 mi left.
        #expect(run(units: "mi", covered: 5.8) == .almostDone(value: "0.2", unit: "mi left"))
        // Same point of the same run, read in kilometres: 0.20 mi = 0.32 km.
        #expect(run(units: "km", covered: 5.8) == .almostDone(value: "0.32", unit: "km left"))
        // 5.75 of 6.00 → 0.25 mi = 0.40 km. The literal number from the
        // bug report, both ways round.
        #expect(run(units: "mi", covered: 5.75) == .almostDone(value: "0.25", unit: "mi left"))
        #expect(run(units: "km", covered: 5.75) == .almostDone(value: "0.4", unit: "km left"))
    }

    // MARK: - Distance remaining on the face

    @Test func phaseRemainingMiIsExactAtTheEdges() {
        let phase = WatchPhase(index: 0, type: .work, label: "Rep", durationSec: 600,
                               targetPaceSPerMi: 391, tolerancePaceSPerMi: 8,
                               haptic: .start, repUnit: .distance, distanceMi: 1.0)
        let w = WatchWorkout(workoutId: "num-dist", name: "D", summary: "d",
                             totalEstimatedMinutes: 10, phases: [phase],
                             completionEndpoint: "/c", expiresAt: "2099-12-31T00:00:00Z")
        let e = WorkoutEngine(workout: w)
        let t = tracker()
        e.tracker = t
        e.start()

        #expect(e.phaseRemainingMi == 1.0)
        t.setFixture(pace: 391, hr: 0, cadence: 0, distanceMi: 0.25)
        #expect(e.phaseRemainingMi == 0.75)
        t.setFixture(pace: 391, hr: 0, cadence: 0, distanceMi: 1.0)
        #expect(e.phaseRemainingMi == 0)
        // Overshoot clamps — "−0.20 to go" is not a reading.
        t.setFixture(pace: 391, hr: 0, cadence: 0, distanceMi: 1.2)
        #expect(e.phaseRemainingMi == 0)
        e.reset()
    }

    @Test func phaseRemainingSecFollowsAnExtendedRecovery() {
        let e = WorkoutEngine(workout: makeIntervalWithRecovery())
        e.start()
        simulate(e, seconds: 61)
        simulate(e, seconds: 61)
        #expect(e.currentPhase?.type == .recovery)
        #expect(e.phaseRemainingSec == 120)
        e.recordRecoveryExtension(addedSec: 30)
        #expect(e.phaseRemainingSec == 150)
        e.recordRecoveryExtension(addedSec: 30)
        #expect(e.phaseRemainingSec == 180)
        simulate(e, seconds: 200)                // past the extended boundary
        #expect(e.phaseRemainingSec >= 0)        // never negative
        e.reset()
    }

    @Test func recoveryExtensionIsRefusedOutsideARecovery() {
        // "+30 sec" mid-rep is not a thing the design offers, and silently
        // extending a work interval would corrupt the rep the whole session
        // is built around.
        let e = WorkoutEngine(workout: makeIntervalWithRecovery())
        e.start()
        e.recordRecoveryExtension(addedSec: 30)  // in the warmup
        #expect(e.phaseAddedSec == 0)
        #expect(e.recoveryExtensionCount == 0)
        simulate(e, seconds: 61)
        #expect(e.currentPhase?.type == .work)
        e.recordRecoveryExtension(addedSec: 30)  // in a work rep
        #expect(e.phaseAddedSec == 0)
        #expect(e.recoveryExtensionCount == 0)
        e.reset()
    }
}
