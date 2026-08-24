//
//  FormatConformanceTests.swift
//  faff.run iPhone · the phone's half of the cross-language format contract.
//
//  ─────────────────────────────────────────────────────────────────────────
//  A PACE FORMATTED ON THE PHONE MUST EQUAL THE PACE FORMATTED ON THE SERVER
//  FOR THE SAME RUN.
//
//  The server sends seconds and pre-formatted strings in the same payload —
//  `V5Number.text` is already a string, `PhaseBreakdown.target_pace_sec` is
//  still a number — so the SAME run can reach one part of a screen through the
//  server's formatter and another part through `FaffFmt`. If the two disagree,
//  one screen shows one run at two paces, and until this file nothing in
//  either language could have noticed.
//
//  `FormatVectors.generated.swift` is the server's own answers, emitted by
//  `web-v2/lib/wire-format/_format_vectors.test.ts`. This test replays them
//  through the phone's formatters.
//
//  WHAT THIS ALREADY CAUGHT. Nineteen server-side formatters rounded the
//  REMAINDER rather than the total:
//
//      const s = Math.round(sPerMi % 60);      // 479.7 → 59.7 → 60
//
//  The server printed `7:60/mi` and `59:60`; the phone printed `8:00` and
//  `1:00:00` for the same values. Fractional seconds are the normal case here,
//  not the exotic one — a pace IS a quotient.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE SECOND SEAM, WHICH IS INSIDE SWIFT
//
//  The phone has more than one formatter of its own: `FaffFmt.pace` and
//  `Units.formatPaceBare` both turn seconds-per-mile into `M:SS`, by different
//  arithmetic, and different screens call different ones. They are checked
//  against each other below for the same reason.
//

import XCTest
@testable import Faff

final class FormatConformanceTests: XCTestCase {

    /// 138 at the time of writing. The floor is a tripwire, not a target: a
    /// vectors file that failed to generate would otherwise leave this test
    /// passing over an empty table.
    private static let floor = 120

    func testPhoneAgreesWithServerOnEveryVector() {
        let ledger = SweepLedger("format · phone against server", floor: Self.floor)

        for v in FormatVectors.all {
            ledger.exercised(v.fn.rawValue)

            let phone: String? = {
                switch v.fn {
                case .paceMinSec:   return FaffFmt.pace(secPerMi: v.input)
                case .clock:        return FaffFmt.clock(sec: v.input)
                case .raceTime:     return FaffFmt.raceTime(sec: v.input)
                case .miles:        return FaffFmt.miles(v.input)
                case .paceDeltaSec: return FaffFmt.paceDeltaSec(v.input)
                case .bpm:          return FaffFmt.bpm(v.input)
                }
            }()

            guard phone != v.expected else { continue }
            ledger.found(
                v.fn.rawValue,
                "\(v.fn.rawValue)(\(v.input)) · server \(v.expected.map { "\"\($0)\"" } ?? "nil") · phone \(phone.map { "\"\($0)\"" } ?? "nil")",
                onScreen: "the same run showing two different numbers, one from each side of the wire"
            )
        }

        ledger.settle()
    }

    // MARK: - The seam inside Swift

    /// `Units.formatPaceBare` is the OTHER pace formatter on this phone, and
    /// several screens call it instead of `FaffFmt.pace`. Same input, same
    /// units, so it must produce the same string — a runner switching between
    /// two screens must not see their pace change.
    func testTheTwoSwiftPaceFormattersAgree() {
        let ledger = SweepLedger("format · FaffFmt against Units", floor: 30)

        for v in FormatVectors.all where v.fn == .paceMinSec {
            guard v.input > 0 else { continue }     // Units has no null case.
            ledger.exercised("Units.formatPaceBare")

            let a = FaffFmt.pace(secPerMi: v.input)
            let b = Units.formatPaceBare(secPerMile: v.input, unit: .mi)
            guard a != b else { continue }
            ledger.found("Units.formatPaceBare",
                         "\(v.input) s/mi · FaffFmt \"\(a ?? "nil")\" · Units \"\(b)\"",
                         onScreen: "a pace that changes when the runner moves between two screens of the same app")
        }

        ledger.settle()
    }

    /// A guard on the guard. If the generated table ever comes back empty, the
    /// two tests above would pass over nothing — the floor catches that, and
    /// this says plainly which half broke.
    func testTheVectorTableIsPopulated() {
        XCTAssertGreaterThan(FormatVectors.all.count, Self.floor,
            "FormatVectors.generated.swift holds \(FormatVectors.all.count) rows. Regenerate with UPDATE_FORMAT_VECTORS=1 npx vitest run lib/wire-format/")
        XCTAssertTrue(FormatVectors.all.contains { $0.fn == .clock },
                      "the table lost a whole formatter")
    }
}
