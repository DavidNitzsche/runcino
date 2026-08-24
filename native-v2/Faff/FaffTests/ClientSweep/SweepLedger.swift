//
//  SweepLedger.swift
//  faff.run iPhone · the thing that stops this suite reporting a green nothing.
//
//  ─────────────────────────────────────────────────────────────────────────
//  A HARNESS THAT RUNS ZERO CASES AND REPORTS CLEAN IS THE SAME BUG ONE LEVEL
//  UP, AND IT HAS ALREADY HAPPENED HERE TWICE.
//
//  `check-xcodeproj-sync.sh` carries the same idea in shell — "a check that
//  inspects nothing must never report clean" — and it carries it because the
//  wire-keys gate once passed cleanly and every time over a watch wire it had
//  never read. A green light above an unwatched road is worse than no light.
//
//  So every sweep in this directory books its work here, and the ledger fails
//  the run if the count comes in under the floor. The floor is not a target;
//  it is a tripwire. Raise it when the corpus grows.
//

import XCTest

/// Books cases and findings for one sweep, and refuses to pass on nothing.
final class SweepLedger {

    /// One thing the sweep found wrong.
    struct Finding {
        let surface: String
        let detail: String
        /// What the runner would have seen. Not optional — a finding nobody
        /// can picture does not get acted on.
        let onScreen: String
    }

    let name: String
    /// The minimum number of cases this sweep must actually have exercised.
    let floor: Int

    private(set) var cases = 0
    private(set) var findings: [Finding] = []
    /// Surfaces the sweep touched, so a report can say what it covered rather
    /// than only what it caught.
    private(set) var surfaces: Set<String> = []

    init(_ name: String, floor: Int) {
        self.name = name
        self.floor = floor
    }

    func exercised(_ surface: String, cases n: Int = 1) {
        surfaces.insert(surface)
        cases += n
    }

    func found(_ surface: String, _ detail: String, onScreen: String) {
        findings.append(Finding(surface: surface, detail: detail, onScreen: onScreen))
    }

    /// Call at the end of every sweep. Fails on findings, and fails just as
    /// hard on an empty run.
    func settle(file: StaticString = #filePath, line: UInt = #line) {
        let covered = surfaces.sorted().joined(separator: ", ")
        print("""

        ── client sweep · \(name) ────────────────────────────────────────────
           cases exercised : \(cases)   (floor \(floor))
           surfaces        : \(covered.isEmpty ? "NONE" : covered)
           findings        : \(findings.count)
        """)

        for f in findings {
            print("""
               ✗ \(f.surface) · \(f.detail)
                 on screen: \(f.onScreen)
            """)
        }
        print("──────────────────────────────────────────────────────────────\n")

        if cases < floor {
            XCTFail("""
            \(name): exercised \(cases) cases, below the floor of \(floor).

            This is a FAILURE OF THE HARNESS, not a pass. A sweep that stops \
            finding work to do reports clean for the same reason a broken one \
            does, and the whole point of this file is that the two must not \
            look alike. Either the corpus stopped loading or a fixture stopped \
            parsing — check that before touching the floor.
            """, file: file, line: line)
        }

        guard !findings.isEmpty else { return }
        let body = findings
            .map { "  · \($0.surface) — \($0.detail)\n    on screen: \($0.onScreen)" }
            .joined(separator: "\n")
        XCTFail("\(name): \(findings.count) finding(s)\n\(body)", file: file, line: line)
    }
}
