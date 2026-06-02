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
    /// 2026-06-02 round 41 · single-sentence coach-voice SESSION CUE.
    /// Backend commit 126784bd · composed by lib/coach/session-cue.ts.
    /// Rendered as the pre-run sheet CUE row. Null on rest / unplanned
    /// days · the row hides.
    let cue: String?

    enum CodingKeys: String, CodingKey {
        case ok, date, type, phase, plannedMi, raceDistanceMi, weeksToRace
        case verdict, facts, cue
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? ""
        self.phase = try c.decodeIfPresent(String.self, forKey: .phase)
        self.plannedMi = try c.decodeIfPresent(Double.self, forKey: .plannedMi) ?? 0
        self.raceDistanceMi = try c.decodeIfPresent(Double.self, forKey: .raceDistanceMi)
        self.weeksToRace = c.decodeFlexInt(forKey: .weeksToRace)
        self.verdict = try c.decodeIfPresent(String.self, forKey: .verdict) ?? ""
        self.facts = (try? c.decode([String].self, forKey: .facts)) ?? []
        self.cue = try c.decodeIfPresent(String.self, forKey: .cue)
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
    /// 2026-06-01 · coach-voice "win line" composed by lib/coach/run-win.ts
    /// (backend commits cd091124 + 9fd07cdf). 4-10 words, type-specific
    /// signals (negative-split detection, pace CV, work-split paces for
    /// intervals, etc.). Null when verdict gates off-plan/DNF or when
    /// data is insufficient · iPhone hides the green check + win line
    /// and falls back to just the verdict.
    let win: String?

    enum CodingKeys: String, CodingKey {
        case ok, runId, date, type, phase
        case verdict, facts, coach_tip, conditions_note, win
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
        self.win = try c.decodeIfPresent(String.self, forKey: .win)
    }
}
