//
//  RaceName.swift
//  Shared abbreviation helper for long race names.
//
//  Rules (mirror the web spine renderer):
//   · short names (3 words or fewer AND under 18 chars) pass through.
//   · long names collapse to initials of major words (drop "the", "of",
//     "and", "a", "an", "&" so "Tour of the Riviera" → "TR" not "TOTR").
//   · trailing race-type words ("Marathon", "Half", "10K", "5K", "Trail")
//     drop when initials alone would be ambiguous; e.g.
//        "California International Marathon" → "CIM"
//        "America's Finest City Half Marathon" → "AFC"
//        "Big Sur International Marathon" → "BSIM"
//

import Foundation

enum RaceName {
    /// Returns a display-safe short label for a race name.
    /// `abbreviateAlways: true` forces the initials form even for short names.
    static func short(_ name: String?, abbreviateAlways: Bool = false) -> String {
        guard let name, !name.isEmpty else { return "" }
        let words = significantWords(in: name)

        let collapse = abbreviateAlways
            || words.count >= 4
            || name.count > 18

        if !collapse { return name }

        // A single significant word has no meaningful initials form — "CIM"
        // (California International Marathon, already an acronym) must not
        // collapse to "C", nor "Boston" to "B". Return the word whole.
        if words.count == 1 { return String(words[0]) }

        let initials = words.compactMap { $0.first.map { String($0).uppercased() } }
        if initials.isEmpty { return name }
        return initials.joined()
    }

    /// Words we keep for initials. Drops articles, prepositions, conjunctions,
    /// and trailing race-type qualifiers.
    private static func significantWords(in name: String) -> [Substring] {
        let drop: Set<String> = [
            "the","of","and","a","an","&","de","la","du","le","les"
        ]
        let trailingTypes: Set<String> = [
            "marathon","half","10k","5k","ultra","trail",
            "championship","championships","relay","invitational"
        ]
        let raw = name.split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "'" })
        var sig = raw.filter { !drop.contains($0.lowercased()) }
        // Drop "marathon"/"half" etc only if the remaining initials still
        // produce a recognizable 2+ letter code.
        while sig.count > 2, let last = sig.last, trailingTypes.contains(last.lowercased()) {
            sig.removeLast()
        }
        return sig
    }
}
