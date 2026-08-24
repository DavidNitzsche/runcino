//
//  WireProbe.swift
//  faff.run iPhone · reading a decoded model back out, field by field.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY REFLECTION AND NOT A HAND-WRITTEN READER
//
//  The sweep's second property needs to see what a model HOLDS after a
//  corruption, not merely whether it decoded. That is the difference between
//  the two defect classes on this side of the wire:
//
//    · the decode THREW          → the screen is empty, and the runner knows
//                                  something is wrong
//    · the decode SUCCEEDED with
//      a plausible default       → the screen shows a confident 0, and the
//                                  runner does not
//
//  The second is worse, and it is the one nothing was watching. `?? 0` on a
//  wire-sourced number is rule one broken quietly: an absent value presented
//  with exactly the same weight as a measured one. A runner reads "0" as a
//  reading, because every other number on that screen is.
//
//  A hand-written reader per model would cover the models someone remembered
//  to write one for. `Mirror` covers all of them, including the ones added
//  next month, which is the only version of this worth having.
//

import Foundation

/// One field's value, flattened to something two decodes can be compared on.
enum ProbeValue: Equatable {
    case number(Double)
    case text(String)
    case flag(Bool)
    /// The optional was nil. THE HONEST ANSWER for something we could not read.
    case absent

    var isAbsent: Bool { self == .absent }

    var number: Double? {
        if case .number(let d) = self { return d }
        return nil
    }

    var display: String {
        switch self {
        case .number(let d): return d == d.rounded() ? String(Int(d)) : String(d)
        case .text(let s):   return "\"\(s)\""
        case .flag(let b):   return String(b)
        case .absent:        return "nil"
        }
    }
}

enum WireProbe {

    /// Every readable field in a decoded model, keyed by its Swift path.
    ///
    /// Depth-capped: these models nest, and a runaway walk in a test harness
    /// is a hang rather than a failure, which is the least useful thing a
    /// gate can do.
    static func fields(of subject: Any, prefix: String = "", depth: Int = 0) -> [String: ProbeValue] {
        guard depth < 10 else { return [:] }

        let mirror = Mirror(reflecting: subject)

        // An Optional reflects as `.optional` with one child when it is
        // populated and none when it is nil. Nil is the answer we most want to
        // record, so it gets its own case rather than a missing key.
        if mirror.displayStyle == .optional {
            if let child = mirror.children.first {
                return fields(of: child.value, prefix: prefix, depth: depth + 1)
            }
            return prefix.isEmpty ? [:] : [prefix: .absent]
        }

        // Scalars. Bool is checked before the numerics because a Bool that
        // reads as a number would make `false` and `0` the same finding.
        if let b = subject as? Bool { return leaf(prefix, .flag(b)) }
        if let s = subject as? String { return leaf(prefix, .text(s)) }
        if let i = subject as? Int { return leaf(prefix, .number(Double(i))) }
        if let d = subject as? Double { return leaf(prefix, .number(d)) }
        if let f = subject as? CGFloat { return leaf(prefix, .number(Double(f))) }
        if let d = subject as? Date { return leaf(prefix, .number(d.timeIntervalSince1970)) }

        switch mirror.displayStyle {
        case .collection, .set:
            var out: [String: ProbeValue] = [:]
            for (i, child) in mirror.children.enumerated() {
                out.merge(fields(of: child.value, prefix: "\(prefix)[\(i)]", depth: depth + 1)) { a, _ in a }
            }
            // The COUNT is itself a field. A list that silently shortened is a
            // finding — four reps drawn where the watch recorded five.
            out["\(prefix).count"] = .number(Double(mirror.children.count))
            return out

        case .struct, .class, .tuple:
            var out: [String: ProbeValue] = [:]
            for child in mirror.children {
                guard let label = child.label else { continue }
                let path = prefix.isEmpty ? label : "\(prefix).\(label)"
                out.merge(fields(of: child.value, prefix: path, depth: depth + 1)) { a, _ in a }
            }
            return out

        default:
            // Enums and anything else with no children: record the case name.
            // `String(describing:)` on a RawRepresentable enum gives the case,
            // which is exactly the granularity a comparison needs.
            return leaf(prefix, .text(String(describing: subject)))
        }
    }

    private static func leaf(_ prefix: String, _ value: ProbeValue) -> [String: ProbeValue] {
        prefix.isEmpty ? [:] : [prefix: value]
    }
}
