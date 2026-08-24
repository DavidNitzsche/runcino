//
//  SweepPositiveControlTests.swift
//  faff.run iPhone · proving the harness can still fail.
//
//  ─────────────────────────────────────────────────────────────────────────
//  A HARNESS THAT RUNS ZERO CASES AND REPORTS CLEAN IS THE SAME BUG ONE LEVEL
//  UP, AND THAT HAS ALREADY HAPPENED HERE TWICE.
//
//  The floor in `SweepLedger` catches one half of it: a sweep that stopped
//  looking. This file catches the other half, which is worse because it looks
//  identical from outside — a sweep that looks at everything and cannot see.
//
//  Each control below plants a corruption of a KNOWN shape into a struct
//  written to be broken in exactly that way, and asserts the engine reports
//  it. If a control ever goes quiet, the real sweep's green means nothing and
//  this file is the only thing that would say so.
//
//  The structs here are deliberately NOT app types. Pointing a positive
//  control at a real model means it starts failing the day someone fixes that
//  model, and a control that fails when the code gets better teaches everyone
//  to delete controls.
//

import XCTest
@testable import Faff

// MARK: - Deliberately broken probes

/// THE FRAGILE ONE. A synthesised initialiser over a non-optional `Int`.
///
/// This is the shape `PhaseBreakdown` had before it was written out by hand:
/// one fractional value off a wrist and the decode throws, and because the
/// parent reads its array with `try`, the throw takes the whole screen with
/// it. Nothing about the source code looks wrong.
private struct FragileProbe: Decodable {
    let index: Int
    let label: String
    let avg_hr: Int?
}

/// THE QUIETLY WRONG ONE. Decodes, always — and turns every hole into a zero.
private struct DefaultingProbe: Decodable {
    let index: Int
    let distanceMi: Double
    let avgHr: Int

    enum CodingKeys: String, CodingKey { case index, distanceMi, avgHr }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // `try?` over `decodeIfPresent` gives a double optional; both layers
        // collapse to the same zero, which is precisely the sin being modelled.
        index = ((try? c.decodeIfPresent(Int.self, forKey: .index)) ?? nil) ?? 0
        distanceMi = ((try? c.decodeIfPresent(Double.self, forKey: .distanceMi)) ?? nil) ?? 0
        avgHr = ((try? c.decodeIfPresent(Int.self, forKey: .avgHr)) ?? nil) ?? 0
    }
}

/// The control's fixture. Shaped like a phase because that is the payload the
/// real incident happened in.
private let probeJSON = """
{ "index": 3, "label": "Rep 2", "avg_hr": 164, "distanceMi": 1.0, "avgHr": 164 }
"""

final class SweepPositiveControlTests: XCTestCase {

    // MARK: - The engine produces work at all

    /// The cheapest way for this whole directory to become decorative is for
    /// the mutator to quietly return nothing.
    func testMutatorProducesCasesForEveryCorpusFixture() {
        for entry in WireCorpus.all {
            let n = WireMutator.mutations(for: entry.json).count
            XCTAssertGreaterThan(n, 20,
                "\(entry.name) produced only \(n) mutations. A fixture that stopped parsing removes a whole surface from the sweep and leaves the suite green.")
        }
    }

    func testMutatorPlantsEachCorruptionKind() {
        let kinds = Set(WireMutator.mutations(for: probeJSON).map(\.kind))
        XCTAssertEqual(kinds, Set(WireMutation.Kind.allCases),
                       "the engine stopped planting one of the four corruptions")
    }

    // MARK: - Control 1 · a fragile decode is CAUGHT

    func testFragileStructIsReportedFragile() {
        let ledger = SweepLedger("control · fragile", floor: 1)
        var threwOnFractional = false

        for m in WireMutator.mutations(for: probeJSON) where m.kind == .fractional {
            ledger.exercised("FragileProbe")
            do {
                _ = try JSONDecoder().decode(FragileProbe.self, from: Data(m.json.utf8))
            } catch {
                threwOnFractional = true
                ledger.found("FragileProbe", "\(m.display) threw", onScreen: "an empty run detail")
            }
        }

        XCTAssertTrue(threwOnFractional, """
        THE HARNESS IS BLIND. `FragileProbe` has a synthesised initialiser over \
        a non-optional Int, so a fractional value must throw — that is the whole \
        defect class this sweep exists for. It did not. Fix the engine before \
        trusting any green run of DecodeSweepTests.
        """)
        XCTAssertFalse(ledger.findings.isEmpty, "the ledger recorded no finding for a decode that threw")
    }

    // MARK: - Control 2 · a defaulted zero is CAUGHT

    func testDefaultedZeroIsReportedByTheProbe() throws {
        let pristine = try JSONDecoder().decode(DefaultingProbe.self, from: Data(probeJSON.utf8))
        let before = WireProbe.fields(of: pristine)
        XCTAssertEqual(before["avgHr"], .number(164), "the probe could not read the pristine value back")

        // Null exactly the one field, exactly as the real sweep does.
        let nulled = try XCTUnwrap(
            WireMutator.mutations(for: probeJSON).first {
                $0.kind == .nulled && $0.path.display == "avgHr"
            }, "the engine no longer plants a null on avgHr")

        let after = WireProbe.fields(of:
            try JSONDecoder().decode(DefaultingProbe.self, from: Data(nulled.json.utf8)))

        XCTAssertEqual(after["avgHr"], .number(0), """
        THE HARNESS IS BLIND. `DefaultingProbe.avgHr` is `?? 0`, so nulling it \
        must produce a hard zero — the exact "absence arrives as a confident \
        number" shape the sweep claims to catch. It did not.
        """)
        XCTAssertNotEqual(after["avgHr"], .absent)
    }

    /// And the honest shape must NOT be reported, or the sweep is noise and
    /// will be turned off. A control that only ever fires is as useless as one
    /// that never does.
    func testAnHonestOptionalIsNotReported() throws {
        let nulled = try XCTUnwrap(
            WireMutator.mutations(for: probeJSON).first {
                $0.kind == .nulled && $0.path.display == "avg_hr"
            })
        let after = WireProbe.fields(of:
            try JSONDecoder().decode(FragileProbe.self, from: Data(nulled.json.utf8)))

        XCTAssertEqual(after["avg_hr"], .absent,
                       "an honest `Int?` must read back as nil, not as a zero — otherwise the sweep cannot tell the two apart")
    }

    // MARK: - Control 3 · the floor actually fails

    func testLedgerFailsWhenItExercisedNothing() {
        // The one place in this suite where a failure is the pass. Without
        // this, "floor" is a comment.
        XCTExpectFailure("a ledger under its floor must fail the run") {
            SweepLedger("control · empty run", floor: 10).settle()
        }
    }
}
