//
//  CoachFacts.swift
//  Wire model for GET /api/coach/facts?surface=<…>.
//
//  Backend: web-v2/lib/coach/fact-reciter.ts. The endpoint returns a
//  deterministic "block" of facts the surface can render verbatim. No
//  LLM (Cardinal Rule #1). Supported surfaces: today / plan / races /
//  race_detail / health / me.
//
//  Use this in any iOS surface that wants real coach copy without
//  hand-rolling its own SQL or duplicating server-side logic.
//

import Foundation

struct CoachFactsEnvelope: Decodable {
    let block: CoachFactsBlock
}

struct CoachFactsBlock: Decodable {
    let surface: String
    let state: String?
    let facts: [CoachFact]
}

struct CoachFact: Decodable, Identifiable {
    let label: String
    let value: String
    /// "race" / "amber" / "over" / "green" — for tinting the value text.
    let valueColor: String?
    /// Sub-line meta beneath the fact value.
    let meta: String?

    var id: String { label }

    var tintedColor: String? { valueColor }
}
