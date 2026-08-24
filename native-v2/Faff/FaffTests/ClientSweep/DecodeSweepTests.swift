//
//  DecodeSweepTests.swift
//  faff.run iPhone · the client half of the conservation harness.
//
//  ─────────────────────────────────────────────────────────────────────────
//  FOUR PROPERTIES, ONE ENGINE.
//
//  Every one is asked of REAL payloads — `composeV5Today`'s own dump and
//  production run detail — corrupted one field at a time by `WireMutator`.
//  None can be answered by reading the code, which is why none was answered
//  before.
//
//  A · A DETAIL MUST NOT TAKE DOWN THE SCREEN.
//      `phase_breakdown` is read with `try c.decodeIfPresent`, which re-raises.
//      One fractional bpm inside one rep used to fail the ENTIRE `RunDetail`
//      decode — the runner opened a run they had just finished and got
//      nothing, because HealthKit averaged a heart rate. That struct was fixed
//      by hand. This asks the same question of every field of every payload.
//
//  B · A DETAIL MUST NOT TAKE DOWN ITS LIST.
//      The lenient helpers in APIV5.swift are `(try? decodeIfPresent([T])) ?? []`.
//      Right for a list the server did not send; wrong for a list with one bad
//      element, because the two are then indistinguishable and the screen draws
//      nothing that looks exactly like a design decision. Rule three says a
//      refusal is a correct answer — silence is not a refusal.
//
//  C · AN ABSENCE MUST NOT ARRIVE AS A CONFIDENT ZERO.
//      Rule one, broken quietly. A runner reads "0" as a reading, because
//      every other number on that screen is one.
//
//  D · A PAYLOAD THAT CANNOT SAY WHAT IT IS MUST REFUSE.
//      Where the corpus marks a field as identity, surviving without it is the
//      finding, not the pass.
//

import XCTest
@testable import Faff

final class DecodeSweepTests: XCTestCase {

    /// Observed 1,806 across twelve surfaces. Below that with room for a
    /// fixture to change shape, and far above zero — the number that matters
    /// is that this cannot pass on an empty corpus.
    private static let floor = 1_500

    func testWireCorpusSurvivesOneCorruptionAtATime() throws {
        let ledger = SweepLedger("decode · one corruption at a time", floor: Self.floor)
        var seen = Set<String>()
        var firedExemptions = Set<String>()

        for entry in WireCorpus.all {

            /// One defect, reported once, and only if it is not already on the
            /// record as a known violation.
            func report(_ key: String, _ detail: @autoclosure () -> String,
                        onScreen: @autoclosure () -> String) {
                guard seen.insert("\(entry.name)|\(key)").inserted else { return }
                if entry.exempt[key] != nil {
                    firedExemptions.insert("\(entry.name)|\(key)")
                    return
                }
                ledger.found(entry.name, "\(detail())   [key: \(key)]", onScreen: onScreen())
            }

            let mutations = WireMutator.mutations(for: entry.json)
            XCTAssertFalse(mutations.isEmpty,
                           "\(entry.name): the fixture produced no mutations — it no longer parses as JSON")

            let pristine: Any
            do { pristine = try entry.decode(entry.json) } catch {
                XCTFail("\(entry.name): the UNCORRUPTED fixture does not decode — \(error)")
                continue
            }
            let before = WireProbe.fields(of: pristine)

            for mutation in mutations {
                ledger.exercised(entry.name)
                let isIdentity = mutation.path.count == 1 && {
                    if case .key(let k) = mutation.path[0] { return entry.identity.contains(k) }
                    return false
                }()

                do {
                    let after = WireProbe.fields(of: try entry.decode(mutation.json))

                    if isIdentity && mutation.kind == .removed {
                        report("identity|\(mutation.path.display)",
                               "\(mutation.path.display) removed, and the payload decoded anyway",
                               onScreen: "a screen drawn from a payload that cannot say which state or which run it is")
                    }

                    guard mutation.kind == .nulled else { continue }
                    inspect(before: before, after: after, mutation: mutation, report: report)

                } catch {
                    guard !isIdentity else { continue }   // A refusal is correct here.
                    report("collapse|\(mutation.display)",
                           "\(mutation.display) — \(mutation.kind.story), and the WHOLE payload failed to decode",
                           onScreen: "an empty screen where the run was, because one detail could not be read")
                }
            }
        }

        // A known violation that stopped happening must be DELETED, not left
        // sitting there. Otherwise the list only grows and stops meaning
        // anything — which is how an allowlist becomes a hole with paperwork.
        var stale: [String] = []
        for entry in WireCorpus.all {
            for (key, reason) in entry.exempt where !firedExemptions.contains("\(entry.name)|\(key)") {
                stale.append("  · \(entry.name) · \(key) — \(reason)")
            }
        }
        XCTAssertTrue(stale.isEmpty, """
        \(stale.count) exemption(s) no longer fire. The decoder was fixed and \
        the record was not updated. Delete these entries from WireCorpus:
        \(stale.joined(separator: "\n"))
        """)

        ledger.settle()
    }

    // MARK: - What changed, and was it honest

    private func inspect(before: [String: ProbeValue],
                         after: [String: ProbeValue],
                         mutation: WireMutation,
                         report: (String, @autoclosure () -> String, @autoclosure () -> String) -> Void) {

        for (path, was) in before {
            guard let old = was.number, old != 0 else { continue }
            guard case .number(0) = after[path] ?? .absent else { continue }

            if path.hasSuffix(".count") {
                // B · a list emptied. Only a finding when the corruption landed
                // INSIDE an element: nulling the list itself, or one whole
                // element, legitimately yields a shorter list.
                let listPath = String(path.dropLast(".count".count))
                guard isInsideElement(of: listPath, mutation: mutation) else { continue }
                let leaf = listPath.split(separator: ".").last.map(String.init) ?? listPath
                report("list|\(listPath)",
                       "\(listPath) — one null on \(mutation.path.display) emptied the whole list (\(Int(old)) → 0)",
                       "the entire \(leaf) section silently absent, which reads as a design decision rather than a failure")
            } else {
                // C · a scalar fell to a hard zero.
                report("zero|\(path)",
                       "\(path) fell from \(was.display) to a hard 0 rather than to nil when \(mutation.path.display) went null",
                       "a confident \"0\" where the honest answer is that we could not read it")
            }
        }
    }

    /// True when the corruption landed on a field WITHIN an element of this
    /// list, rather than on the list or on a whole element.
    private func isInsideElement(of listPath: String, mutation: WireMutation) -> Bool {
        let m = mutation.path.display
        guard m.hasPrefix(listPath) else { return false }
        let tail = m.dropFirst(listPath.count)          // e.g. "[0].letter"
        guard tail.hasPrefix("[") else { return false }
        return tail.contains(".")
    }
}
