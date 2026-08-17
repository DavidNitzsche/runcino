//
//  CoachLog.swift
//  Wire models for GET /api/coach/log · the coach's log.
//
//  Mirrors the contract documented in web-v2/app/api/coach/log/route.ts:
//    { ok, entries: [{ id, kind, dateISO, title, body, meta, ts }],
//      nextBefore: string | null }
//
//  The route header is explicit that native must "decode entries[]
//  leniently (unknown kinds render as plain title+body rows)", so `kind`
//  stays a String rather than a closed enum — a fifth kind added
//  server-side must not cost us the page. `meta` is deliberately NOT
//  decoded: it is kind-specific numbers the log rows never render, and
//  decoding a free-shape blob is the one thing that could make an
//  otherwise-fine entry throw.
//
//  Lenient decode per doctrine 2026-05-31 · every field defaults.
//

import Foundation
import SwiftUI

struct CoachLogEntry: Decodable, Identifiable, Equatable {
    let id: String
    /// "week_close" | "phase_boundary" | "first_ever" | "fitness_shift",
    /// or anything the server adds later.
    let kind: String
    /// The day the entry is ABOUT (YYYY-MM-DD).
    let dateISO: String
    /// Short eyebrow · "WEEK CLOSED" / "PHASE" / "FIRST" / "FITNESS".
    let title: String
    /// The coach's line. One or two short sentences, already citation-stripped.
    let body: String
    /// ISO timestamp the entry was written · the paging cursor.
    let ts: String

    enum CodingKeys: String, CodingKey { case id, kind, dateISO, title, body, ts }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
        self.dateISO = try c.decodeIfPresent(String.self, forKey: .dateISO) ?? ""
        self.title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        self.body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
        self.ts = try c.decodeIfPresent(String.self, forKey: .ts) ?? ""
        // Synthesise an id when the server omits one so ForEach can still
        // diff. (ts, kind) is unique per entry by construction — the write
        // seam is idempotent on (reason, field).
        let wire = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        self.id = wire.isEmpty ? "\(self.ts)|\(self.kind)|\(self.dateISO)" : wire
    }

    /// Preview / test constructor · NOT a wire path.
    init(id: String, kind: String, dateISO: String, title: String, body: String, ts: String) {
        self.id = id; self.kind = kind; self.dateISO = dateISO
        self.title = title; self.body = body; self.ts = ts
    }

    /// True when the row carries something worth rendering. An entry with
    /// no body is a write-path bug, not a row to show.
    var isRenderable: Bool {
        !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// "AUG 17" · the deck's right-hand stamp. Falls back to the raw ISO
    /// when the date can't be parsed rather than showing nothing.
    var stampLabel: String {
        CoachLogEntry.stampFormatter(dateISO) ?? dateISO
    }

    /// Kind-driven accent, all inside the locked ten-color palette.
    ///   phase_boundary → attention amber (a boundary is a marker)
    ///   first_ever     → PR gold (an all-time first IS a milestone)
    ///   fitness_shift  → good-state green (mirrors the web coach-log
    ///                    fitness-shift accent, migrated to #3EBD41 by the
    ///                    2026-08-17 ladder ruling)
    ///   week_close /
    ///   anything else  → neutral ink · plain history, no color claim
    var accent: Color {
        switch kind {
        case "phase_boundary": return Theme.goal
        case "first_ever":     return Theme.Accent.amberGold
        case "fitness_shift":  return Theme.green
        default:               return Theme.txt.opacity(0.55)
        }
    }

    /// Noon-anchored so a date-only string never shifts a day across the
    /// device timezone (same trick post-race-composition.ts uses).
    private static func stampFormatter(_ iso: String) -> String? {
        guard iso.count >= 10 else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: String(iso.prefix(10))) else { return nil }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US_POSIX")
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = "MMM d"
        return out.string(from: d).uppercased()
    }
}

struct CoachLogPage: Decodable {
    let ok: Bool
    let entries: [CoachLogEntry]
    /// Pass back as `?before=` for the next page. Nil = end of the log.
    let nextBefore: String?

    enum CodingKeys: String, CodingKey { case ok, entries, nextBefore }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        self.entries = (try? c.decode([CoachLogEntry].self, forKey: .entries)) ?? []
        self.nextBefore = try? c.decode(String.self, forKey: .nextBefore)
    }

    init(ok: Bool, entries: [CoachLogEntry], nextBefore: String?) {
        self.ok = ok; self.entries = entries; self.nextBefore = nextBefore
    }
}
