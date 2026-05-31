//
//  CoachPayloads.swift
//  Faff
//
//  Decodable mirrors of the coach engine's purpose + recap payloads.
//  Backend doctrine: web-v2/lib/coach/run-purpose.ts +
//                    web-v2/lib/coach/run-recap.ts
//
//  Both endpoints return the same shape · verdict + facts + citations,
//  plus conditions_note + coach_tip on the post-run side. The
//  deterministic engine reads workout type + phase + execution +
//  weather and produces research-cited copy that this layer just
//  has to render. No per-run hand-crafted strings on the iPhone ·
//  the coach derives it on its own.
//
//  Decode is lenient on every field so a server shape drift doesn't
//  nuke the whole payload. Missing facts → empty array, missing
//  citations → empty, missing verdict → empty string · view code
//  hides the surface entirely when verdict is empty.
//
//  Created 2026-05-31.
//

import Foundation

/// Pre-run "WHY THIS RUN" payload from GET /api/today/purpose.
///
/// Voice doctrine (David, 2026-05-31): plain runner-English, no PhD
/// jargon, no citations on the payload. The science is in the rules ·
/// it's not in the words shown to the runner.
struct RunPurpose: Decodable {
    let ok: Bool
    let date: String
    let type: String
    let phase: String?
    let plannedMi: Double
    let raceDistanceMi: Double?
    let weeksToRace: Int?
    let verdict: String
    let facts: [String]

    enum CodingKeys: String, CodingKey {
        case ok, date, type, phase, plannedMi, raceDistanceMi, weeksToRace
        case verdict, facts
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? ""
        self.phase = try c.decodeIfPresent(String.self, forKey: .phase)
        self.plannedMi = try c.decodeIfPresent(Double.self, forKey: .plannedMi) ?? 0
        self.raceDistanceMi = try c.decodeIfPresent(Double.self, forKey: .raceDistanceMi)
        self.weeksToRace = try c.decodeIfPresent(Int.self, forKey: .weeksToRace)
        self.verdict = try c.decodeIfPresent(String.self, forKey: .verdict) ?? ""
        self.facts = (try? c.decode([String].self, forKey: .facts)) ?? []
    }
}

/// Post-run "WHAT THIS RUN DID" payload from GET /api/runs/[id]/recap.
/// `conditions_note` and `coach_tip` are null when neutral conditions /
/// no forward-looking advice apply · view should hide the chrome
/// entirely instead of rendering an empty box.
struct RunRecap: Decodable {
    let ok: Bool
    let runId: String
    let date: String
    let type: String
    let phase: String?
    let verdict: String
    let facts: [String]
    let coach_tip: String?
    let conditions_note: String?

    enum CodingKeys: String, CodingKey {
        case ok, runId, date, type, phase
        case verdict, facts, coach_tip, conditions_note
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.runId = try c.decodeIfPresent(String.self, forKey: .runId) ?? ""
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? ""
        self.phase = try c.decodeIfPresent(String.self, forKey: .phase)
        self.verdict = try c.decodeIfPresent(String.self, forKey: .verdict) ?? ""
        self.facts = (try? c.decode([String].self, forKey: .facts)) ?? []
        self.coach_tip = try c.decodeIfPresent(String.self, forKey: .coach_tip)
        self.conditions_note = try c.decodeIfPresent(String.self, forKey: .conditions_note)
    }
}
