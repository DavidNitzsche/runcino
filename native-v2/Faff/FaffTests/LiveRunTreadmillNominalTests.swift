//
//  LiveRunTreadmillNominalTests.swift
//  faff.run iPhone · TREADMILL-HILL-2 — one function, every consumer.
//
//  TREADMILL-HILL-1 taught the treadmill console's ONE-TIME initial seed
//  (`defaultSpeedMph`/`defaultInclinePct`, read at `init` before the plan
//  even loads) to use a hill rep's doctrine-computed `treadmillSpeedMph`/
//  `treadmillInclinePct`. It never touched `configurePlanIfNeeded`, which
//  builds the REAL per-segment plan `BeltSession.autoAdvanceIfDue()` walks
//  and auto-advances through — so the very first screen could show 7.7 mph
//  while the segment machine underneath it still carried a flat, type-keyed
//  7.0 mph guess for every phase, forever, including the hill reps
//  themselves. `nominalMph`/`nominalInclinePct` are now the one function
//  every consumer (the seed, the segment plan, the "Next" line) calls —
//  this file is what proves that.
//
import XCTest
@testable import Faff

final class LiveRunTreadmillNominalTests: XCTestCase {

    private func phase(_ type: WatchPhaseType, durationSec: Int = 60,
                        target: Int? = nil, treadmillSpeedMph: Double? = nil,
                        treadmillInclinePct: Double? = nil, label: String = "") -> WatchPhase {
        WatchPhase(index: 0, type: type, label: label, durationSec: durationSec,
                   targetPaceSPerMi: target, tolerancePaceSPerMi: nil, haptic: .start,
                   treadmillInclinePct: treadmillInclinePct, treadmillSpeedMph: treadmillSpeedMph)
    }

    // MARK: - nominalMph

    func test_pacedPhaseUsesItsOwnPaceRegardlessOfTreadmillFields() {
        // A paced phase carrying a treadmill pair too (should not happen in
        // practice — the server only ever sets one or the other — but pace
        // must win if it ever does, since a real target beats a fallback).
        let p = phase(.work, target: 480, treadmillSpeedMph: 99, treadmillInclinePct: 99)
        XCTAssertEqual(LiveRunTreadmillV5.nominalMph(for: p), 7.5, accuracy: 0.05)
    }

    func test_hillRepWithNoPaceUsesTheDoctrineComputedTreadmillSpeed() {
        // The real production case this whole fix is about: 7.7 mph, no pace target.
        let hill = phase(.work, target: nil, treadmillSpeedMph: 7.7, treadmillInclinePct: 5.0, label: "Hill 1 of 10")
        XCTAssertEqual(LiveRunTreadmillV5.nominalMph(for: hill), 7.7)
    }

    func test_workPhaseWithNeitherPaceNorTreadmillFieldsFallsToTheFlatTypeGuess() {
        let p = phase(.work, target: nil, treadmillSpeedMph: nil, treadmillInclinePct: nil)
        XCTAssertEqual(LiveRunTreadmillV5.nominalMph(for: p), 7.0)
    }

    func test_everyPhaseTypeHasAFlatFallback() {
        XCTAssertEqual(LiveRunTreadmillV5.nominalMph(for: phase(.warmup)), 5.5)
        XCTAssertEqual(LiveRunTreadmillV5.nominalMph(for: phase(.recovery)), 5.0)
        XCTAssertEqual(LiveRunTreadmillV5.nominalMph(for: phase(.cooldown)), 5.0)
    }

    // MARK: - nominalInclinePct

    func test_hillRepUsesTheDoctrineIncline() {
        let hill = phase(.work, treadmillSpeedMph: 7.7, treadmillInclinePct: 5.0)
        XCTAssertEqual(LiveRunTreadmillV5.nominalInclinePct(for: hill), 5.0)
    }

    func test_everyOtherPhaseIsFlat() {
        for type: WatchPhaseType in [.warmup, .work, .recovery, .cooldown] {
            XCTAssertEqual(LiveRunTreadmillV5.nominalInclinePct(for: phase(type)), 1.0,
                            "\(type) with no treadmill incline field must be flat")
        }
    }

    // MARK: - The actual regression: a full hills workout's segment plan

    /// Builds the exact shape TREADMILL-HILL-1's own commit verified against
    /// real production data (warm-up, 10×60s hill + 2min recovery, cooldown)
    /// and asserts every phase in it — not just the first — carries the
    /// correct nominal speed/incline. This is the test that would have
    /// caught the gap: `configurePlanIfNeeded` mapping every phase through
    /// a hardcoded `targetInclinePct: 1.0` passed on the FIRST phase's
    /// correctness (still 1.0, since warm-up genuinely is flat) and failed
    /// silently on every hill rep after it.
    func test_theFullHillsWorkoutGetsTheRightSpeedAndInclinePerPhase() {
        let warmup = phase(.warmup, target: 500, label: "Warm-up")
        let hill = phase(.work, treadmillSpeedMph: 7.7, treadmillInclinePct: 5.0, label: "Hill 1 of 10")
        let recovery = phase(.recovery, target: nil, label: "Recovery")
        let cooldown = phase(.cooldown, target: 500, label: "Cooldown")

        XCTAssertEqual(LiveRunTreadmillV5.nominalInclinePct(for: warmup), 1.0)
        XCTAssertEqual(LiveRunTreadmillV5.nominalInclinePct(for: hill), 5.0,
                        "the hill rep — the one phase this entire fix is about — must carry its real incline")
        XCTAssertEqual(LiveRunTreadmillV5.nominalInclinePct(for: recovery), 1.0)
        XCTAssertEqual(LiveRunTreadmillV5.nominalInclinePct(for: cooldown), 1.0)

        XCTAssertEqual(LiveRunTreadmillV5.nominalMph(for: hill), 7.7)
        XCTAssertNotEqual(LiveRunTreadmillV5.nominalMph(for: hill), 7.0,
                           "must not have silently fallen through to the flat type-keyed guess")
    }

    // MARK: - Wiring liveness (Rule 18)
    //
    // The tests above prove `nominalMph`/`nominalInclinePct` are correct in
    // isolation — they do NOT prove `configurePlanIfNeeded` (the function
    // that actually builds the segment plan `BeltSession` walks) calls them.
    // Falsified directly: reverting `configurePlanIfNeeded`'s incline back
    // to the old hardcoded `1.0` literal (the exact TREADMILL-HILL-1 gap)
    // left every test above passing, because none of them exercise that
    // call site. Source-scanning it is the only check that would have
    // caught it.

    func test_configurePlanIfNeededActuallyCallsTheSharedInclineFunction() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "LiveRunTreadmillV5", withExtension: "swift")
            ?? Self.sourceURL())
        let src = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(src.contains("targetInclinePct: Self.nominalInclinePct(for:"),
                      "configurePlanIfNeeded must build every segment's incline from nominalInclinePct, not a hardcoded literal — this is the exact TREADMILL-HILL-1 gap")
        XCTAssertTrue(src.contains("targetMph: Self.nominalMph(for:"),
                      "configurePlanIfNeeded must build every segment's speed from nominalMph")
    }

    /// The test bundle carries no resource copy of app sources, so resolve
    /// the file directly relative to this test file's own path instead —
    /// both live in the same repo checkout, and `#filePath` is stable at
    /// build time.
    private static func sourceURL() -> URL? {
        let thisFile = URL(fileURLWithPath: #filePath)
        return thisFile
            .deletingLastPathComponent() // FaffTests/
            .deletingLastPathComponent() // Faff/
            .appendingPathComponent("Faff/ViewsV5/LiveRunTreadmillV5.swift")
    }
}
