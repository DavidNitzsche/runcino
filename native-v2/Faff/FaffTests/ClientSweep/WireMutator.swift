//
//  WireMutator.swift
//  faff.run iPhone · the client sweep's corruption engine.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS IS FOR
//
//  The TypeScript side gained a conservation harness that pushes known runs
//  through the real transforms. Nothing did that for Swift. `native-v2`
//  decodes the wire and re-formats every number in it, so a value that leaves
//  the server correct can still reach the runner wrong, and until this file
//  nothing on the client would have known.
//
//  This engine does not know anything about any particular payload. It takes
//  a REAL fixture — the composer's own output, never a hand-written shape —
//  walks every leaf in it, and plants one corruption at a time. The decoder
//  under test is the app's own.
//
//  THE FOUR CORRUPTIONS, and why each one is the shape that actually ships:
//
//    · fractional      144 → 144.5
//      HealthKit and the Apple Watch average heart rates and cadences. The
//      result is JSON-valid and throws `Int.self`. This is the exact shape
//      that would have taken down the ENTIRE run detail rather than one
//      phase list (see PhaseBreakdown's init in Models/Runs.swift).
//
//    · numberAsString  144 → "144"
//      A column read straight out of Postgres through a driver that hands
//      back numerics as strings. node-pg does this for int8 and numeric.
//
//    · nulled          x → null
//      The engine could not read it. Rule three says a refusal is a correct
//      answer; a refusal must not be able to take the screen down with it.
//
//    · removed         the key is deleted outright
//      An older server, or a field behind a flag. The phone must survive a
//      server that is one deploy behind it.
//
//  A leaf that is NOT part of a payload's identity must never be able to fail
//  the whole payload. That is the property. Where failing IS correct — the
//  discriminator that says which screen this is — the corpus entry names the
//  path explicitly, so "this one may refuse" is a decision on the record
//  rather than a silence.
//

import Foundation

// MARK: - Path

/// One step into a JSON document. An enum rather than a dotted string so a
/// key containing a dot cannot be mistaken for a nesting level.
enum WirePathStep: Equatable {
    case key(String)
    case index(Int)
}

extension Array where Element == WirePathStep {
    /// `weekStrip[0].isDone` — for a human reading a finding.
    var display: String {
        var out = ""
        for step in self {
            switch step {
            case .key(let k):   out += out.isEmpty ? k : ".\(k)"
            case .index(let i): out += "[\(i)]"
            }
        }
        return out.isEmpty ? "<root>" : out
    }
}

// MARK: - Mutation

struct WireMutation {
    enum Kind: String, CaseIterable {
        case fractional
        case numberAsString
        case nulled
        case removed

        /// What a reader should picture when this one fires.
        var story: String {
            switch self {
            case .fractional:     return "the watch averaged it and sent 144.5"
            case .numberAsString: return "the driver handed the column back as a string"
            case .nulled:         return "the engine could not read it"
            case .removed:        return "the server is one deploy behind the phone"
            }
        }
    }

    let path: [WirePathStep]
    let kind: Kind
    /// The corrupted document, ready to hand to a decoder.
    let json: String

    var display: String { "\(path.display) · \(kind.rawValue)" }
}

// MARK: - The engine

enum WireMutator {

    /// Every corruption this fixture can carry, one planted at a time.
    ///
    /// Returns [] when the fixture does not parse, which the caller must treat
    /// as a failure rather than as "nothing to do" — a sweep that generates
    /// zero cases and reports clean is the bug this whole file exists to stop.
    static func mutations(for json: String) -> [WireMutation] {
        guard let root = try? JSONSerialization.jsonObject(
            with: Data(json.utf8), options: [.fragmentsAllowed]
        ) else { return [] }

        var out: [WireMutation] = []
        for (path, value) in leaves(of: root) {
            for kind in kinds(for: value) {
                guard let mutated = apply(kind, at: path, to: root),
                      let data = try? JSONSerialization.data(
                        withJSONObject: mutated, options: [.fragmentsAllowed, .sortedKeys]
                      ),
                      let text = String(data: data, encoding: .utf8)
                else { continue }
                out.append(WireMutation(path: path, kind: kind, json: text))
            }
        }
        return out
    }

    /// Every addressable position in the document, containers included — a
    /// whole object can be nulled or removed just as a scalar can, and a
    /// screen that dies because an optional sub-object went missing is the
    /// same defect one level up.
    static func leaves(of root: Any, prefix: [WirePathStep] = []) -> [([WirePathStep], Any)] {
        var out: [([WirePathStep], Any)] = []
        switch root {
        case let dict as [String: Any]:
            // Sorted so a run is reproducible and a finding cites a stable path.
            for key in dict.keys.sorted() {
                let path = prefix + [.key(key)]
                out.append((path, dict[key]!))
                out.append(contentsOf: leaves(of: dict[key]!, prefix: path))
            }
        case let arr as [Any]:
            for (i, v) in arr.enumerated() {
                let path = prefix + [.index(i)]
                out.append((path, v))
                out.append(contentsOf: leaves(of: v, prefix: path))
            }
        default:
            break
        }
        return out
    }

    /// Which corruptions make sense against the value that is actually there.
    /// Planting `fractional` on a string proves nothing.
    private static func kinds(for value: Any) -> [WireMutation.Kind] {
        var out: [WireMutation.Kind] = [.nulled, .removed]
        if isNumber(value) { out.insert(.fractional, at: 0); out.insert(.numberAsString, at: 1) }
        return out
    }

    /// `NSNumber` covers Bool too, and a Bool must not be treated as a number:
    /// turning `true` into `1.5` tests nothing anyone will ever ship.
    private static func isNumber(_ value: Any) -> Bool {
        guard let n = value as? NSNumber else { return false }
        return CFGetTypeID(n) != CFBooleanGetTypeID()
    }

    // MARK: Applying one corruption

    private static func apply(_ kind: WireMutation.Kind,
                              at path: [WirePathStep],
                              to root: Any) -> Any? {
        guard let first = path.first else { return nil }
        let rest = Array(path.dropFirst())

        switch root {
        case let dict as [String: Any]:
            guard case .key(let k) = first, let existing = dict[k] else { return nil }
            var copy = dict
            if rest.isEmpty {
                switch kind {
                case .removed: copy.removeValue(forKey: k)
                case .nulled:  copy[k] = NSNull()
                case .fractional:
                    guard let n = existing as? NSNumber else { return nil }
                    copy[k] = n.doubleValue + 0.5
                case .numberAsString:
                    guard let n = existing as? NSNumber else { return nil }
                    copy[k] = "\(n)"
                }
            } else {
                guard let child = apply(kind, at: rest, to: existing) else { return nil }
                copy[k] = child
            }
            return copy

        case let arr as [Any]:
            guard case .index(let i) = first, arr.indices.contains(i) else { return nil }
            var copy = arr
            if rest.isEmpty {
                switch kind {
                // Removing an ELEMENT shortens the array. That is a real wire
                // shape — a phase list with one phase dropped — and a reader
                // that indexes rather than iterates breaks on exactly this.
                case .removed: copy.remove(at: i)
                case .nulled:  copy[i] = NSNull()
                case .fractional:
                    guard let n = copy[i] as? NSNumber else { return nil }
                    copy[i] = n.doubleValue + 0.5
                case .numberAsString:
                    guard let n = copy[i] as? NSNumber else { return nil }
                    copy[i] = "\(n)"
                }
            } else {
                guard let child = apply(kind, at: rest, to: copy[i]) else { return nil }
                copy[i] = child
            }
            return copy

        default:
            return nil
        }
    }
}
