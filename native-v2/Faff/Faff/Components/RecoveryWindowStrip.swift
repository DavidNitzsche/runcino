//
//  RecoveryWindowStrip.swift
//  Today's post-race RECOVERY WINDOW · the phone's mirror of
//  web-v2/lib/today/post-race-composition.ts (deck Decision 1, approved
//  2026-08-17).
//
//  ── The thing that must not be hardcoded ──────────────────────────────
//
//  Recovery windows are CONTEXT-AWARE as of 52174bcd. A half marathon in
//  the middle of a marathon build prescribes roughly 17 then 23 miles of
//  EASY RUNNING across two weeks, on four then six running days — NOT two
//  weeks of rest. Research/00b-recovery-protocols.md carries two distinct
//  columns and "no quality for 10-14 days" is not "no running for 10-14
//  days"; spending the first as if it were the second is the exact defect
//  52174bcd fixed. A marathon's own window is a four-week reverse taper.
//
//  So nothing in here assumes a length, a shape, or a rest day. Every
//  field is read off the ACTIVE PLAN: the RECOVERY phase span from
//  `TrainingState.phases`, and the real prescribed days inside it from
//  `TrainingState.weeks[].days`. What the plan says is what the strip
//  renders, easy runs included. The word "rest" appears only when the
//  plan really did prescribe zero running days.
//
//  When no recovery block covers today (no plan, or the covering block is
//  not a recovery block) the selector returns nil and the caller degrades
//  to the race hero alone. Nothing is invented.
//
//  The selector is PURE for the same reason its TypeScript twin is: the
//  window's shape is the part worth reasoning about independently of how
//  it is painted.
//

import SwiftUI

// MARK: - Model

/// One cell of the strip, rendered exactly as prescribed.
struct RecoveryDay: Identifiable, Equatable {
    let iso: String
    /// MON / TUE / … derived from the date, noon-UTC anchored.
    let dow: String
    /// Day of month, for the numeral.
    let dayNum: Int
    let type: String
    /// "Easy 4" / "Long 8" / "Off" — derived from the row, never invented.
    let label: String
    let miles: Double
    let isRunning: Bool
    let isToday: Bool
    let isPast: Bool
    let done: Bool
    var id: String { iso }
}

struct RecoveryWindow: Equatable {
    let startISO: String
    let endISO: String
    /// "Aug 17 to 30" — the window's real span, not a fixed 7 or 14.
    let rangeLabel: String
    /// "next block opens Aug 31", or nil when the plan ends with the window.
    let nextBlockLabel: String?
    /// 1-based week within the window, and how many it actually spans.
    let weekIndex: Int
    let weeksTotal: Int
    /// The current week's prescribed days, in plan order. Drives the strip.
    let days: [RecoveryDay]
    /// Planned + already-logged miles in the current window week.
    let weekPlannedMi: Double
    let weekDoneMi: Double
    /// How many days of the current week actually prescribe a run.
    let runningDays: Int
    /// The phase label the plan authored, e.g. "RECOVERY".
    let phaseLabel: String
}

// MARK: - Selector (pure)

enum RecoveryWindows {

    /// Days 0 to 7 after a race, per the deck.
    static let postRaceTodayWindowDays = 7

    /// Find the recovery block that covers the current week and read its
    /// real shape. Returns nil when no phase whose label reads as recovery
    /// contains `nowIdx` — including the ordinary case of a runner
    /// mid-build. The caller must handle nil; there is no synthetic
    /// fallback window.
    static func select(
        phases: [TrainingPlanPhase],
        weeks: [TrainingPlanWeek],
        nowIdx: Int,
        todayISO: String
    ) -> RecoveryWindow? {
        guard !phases.isEmpty, !weeks.isEmpty else { return nil }
        guard let phase = phases.first(where: {
            isRecoveryLabel($0.label) && nowIdx >= $0.startWeekIdx && nowIdx <= $0.endWeekIdx
        }) else { return nil }

        let startWeek = max(0, phase.startWeekIdx)
        let endWeek = min(weeks.count - 1, phase.endWeekIdx)
        guard endWeek >= startWeek else { return nil }

        // Every dated day inside the window, so the span is the plan's own
        // span rather than a count of weeks times seven.
        var allDates: [String] = []
        for w in startWeek...endWeek {
            for d in weeks[w].days where !d.date.isEmpty { allDates.append(d.date) }
        }
        guard !allDates.isEmpty else { return nil }
        allDates.sort()
        let startISO = allDates[0]
        let endISO = allDates[allDates.count - 1]

        // The plan may continue past the recovery block. When it does, the
        // next block opens the day after; when it does not, say nothing.
        let hasLaterWeek = endWeek < weeks.count - 1 &&
            weeks[endWeek + 1].days.contains { !$0.date.isEmpty }
        let nextBlockISO = hasLaterWeek ? addDays(endISO, 1) : nil

        let currentWeek = weeks[max(startWeek, min(endWeek, nowIdx))]
        let days: [RecoveryDay] = currentWeek.days
            .filter { !$0.date.isEmpty }
            .map { d in
                let mi = max(0, d.mi)
                let isRunning = d.type.lowercased() != "rest" && mi > 0
                return RecoveryDay(
                    iso: d.date,
                    dow: dowLabel(d.date),
                    dayNum: dayOfMonth(d.date),
                    type: d.type,
                    label: dayLabel(type: d.type, mi: mi),
                    miles: mi,
                    isRunning: isRunning,
                    isToday: d.date == todayISO,
                    isPast: d.date < todayISO,
                    done: d.doneMi > 0.1
                )
            }

        let planned = (days.reduce(0.0) { $0 + $1.miles } * 10).rounded() / 10
        let done = (currentWeek.days.reduce(0.0) { $0 + $1.doneMi } * 10).rounded() / 10

        return RecoveryWindow(
            startISO: startISO,
            endISO: endISO,
            rangeLabel: formatWindowRange(startISO, endISO),
            nextBlockLabel: nextBlockISO.map { "next block opens \(shortDate($0))" },
            weekIndex: max(1, min(endWeek - startWeek + 1, nowIdx - startWeek + 1)),
            weeksTotal: endWeek - startWeek + 1,
            days: days,
            weekPlannedMi: planned,
            weekDoneMi: done,
            runningDays: days.filter(\.isRunning).count,
            phaseLabel: phase.label
        )
    }

    /// The window's one-line summary, spoken from what the plan
    /// prescribes. "Week 1 of 2 · 4 running days · 17 mi easy" for a
    /// half's context-aware window; "Week 1 of 2 · rest only" ONLY when
    /// the plan really did prescribe no running. Derived, never asserted.
    static func weekSummary(_ w: RecoveryWindow) -> String {
        let weekPart = "Week \(w.weekIndex) of \(w.weeksTotal)"
        if w.runningDays == 0 { return "\(weekPart) · rest only" }
        let dayPart = "\(w.runningDays) running day\(w.runningDays == 1 ? "" : "s")"
        return "\(weekPart) · \(dayPart) · \(fmtMi(w.weekPlannedMi)) mi easy"
    }

    /// The window's own cap, not a target.
    static func volumeNote(_ w: RecoveryWindow?) -> String {
        guard let w else { return "no target this week" }
        if w.runningDays == 0 { return "rest week · no target" }
        return "recovery week · \(fmtMi(w.weekPlannedMi)) mi prescribed"
    }

    /// The strip's eyebrow · carries the real range when a window exists.
    static func stripHeader(_ w: RecoveryWindow?) -> String {
        guard let w else { return "RECOVERY WEEK" }
        return "RECOVERY WINDOW · \(w.rangeLabel)"
    }

    // MARK: Helpers

    /// "recovery", "injury-return" and the generator's other recovery
    /// labels all read as recovery — same test the TS twin uses (/recover/i)
    /// plus the injury-return alias TrainPhase already maps to .recovery.
    static func isRecoveryLabel(_ label: String) -> Bool {
        let l = label.lowercased()
        return l.contains("recover") || l.contains("injury-return")
    }

    /// "Easy 4" / "Long 8" / "Off". Reads the prescription, never guesses.
    static func dayLabel(type: String, mi: Double) -> String {
        let t = type.lowercased()
        if t == "rest" || mi <= 0 { return "Off" }
        let noun: String
        switch t {
        case "long":     noun = "Long"
        case "recovery": noun = "Recovery"
        case "easy":     noun = "Easy"
        default:
            // A recovery block should not carry quality, but if the plan
            // authored something else, say what it says rather than
            // flattening it to Easy.
            noun = t.prefix(1).uppercased() + t.dropFirst()
        }
        return "\(noun) \(fmtMi(mi))"
    }

    /// "Aug 17 to 30" in one month, "Aug 28 to Sep 10" across one. Written
    /// the way a coach says it, not as a range glyph.
    static func formatWindowRange(_ startISO: String, _ endISO: String) -> String {
        let a = shortDate(startISO)
        let b = shortDate(endISO)
        let sameMonth = a.split(separator: " ").first == b.split(separator: " ").first
        return sameMonth ? "\(a) to \(dayOfMonth(endISO))" : "\(a) to \(b)"
    }

    static func fmtMi(_ mi: Double) -> String {
        let r = (mi * 10).rounded() / 10
        return r == r.rounded() ? String(Int(r.rounded())) : String(format: "%.1f", r)
    }

    /// Noon-UTC anchored so no label ever shifts a day (same trick the TS
    /// twin uses).
    private static func parseISO(_ iso: String) -> Date? {
        guard iso.count >= 10 else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        return f.date(from: "\(iso.prefix(10))T12:00:00Z")
    }

    private static func utcFormatter(_ fmt: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = fmt
        return f
    }

    static func shortDate(_ iso: String) -> String {
        guard let d = parseISO(iso) else { return iso }
        return utcFormatter("MMM d").string(from: d)
    }

    static func dowLabel(_ iso: String) -> String {
        guard let d = parseISO(iso) else { return "" }
        return utcFormatter("EEE").string(from: d).uppercased()
    }

    static func dayOfMonth(_ iso: String) -> Int {
        guard let d = parseISO(iso) else { return 0 }
        return Calendar(identifier: .gregorian).dateComponents(
            in: TimeZone(identifier: "UTC")!, from: d
        ).day ?? 0
    }

    static func addDays(_ iso: String, _ n: Int) -> String {
        guard let d = parseISO(iso),
              let out = Calendar(identifier: .gregorian).date(byAdding: .day, value: n, to: d)
        else { return iso }
        return utcFormatter("yyyy-MM-dd").string(from: out)
    }
}

// MARK: - View

/// The RECOVERY WINDOW strip · the post-race replacement for the ordinary
/// week strip. Renders the plan's real prescribed days, so a week of easy
/// running reads as a week of easy running.
struct RecoveryWindowStrip: View {
    let window: RecoveryWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(RecoveryWindows.stripHeader(window))
                    .font(.body(9.5, weight: .extraBold))
                    .tracking(1.4)
                    .foregroundStyle(Theme.txt.opacity(0.6))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                Spacer(minLength: 4)
                if let note = window.nextBlockLabel {
                    Text(note)
                        .font(.body(10, weight: .semibold))
                        .foregroundStyle(Theme.txt.opacity(0.42))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .padding(.bottom, 12)

            HStack(spacing: 6) {
                ForEach(window.days) { d in
                    dayCell(d)
                }
            }

            Text(RecoveryWindows.weekSummary(window))
                .font(.body(12, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.74))
                .padding(.top, 12)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous)
                .stroke(Theme.Glass.line, lineWidth: 1)
        )
    }

    /// One prescribed day. A running day carries its effort dot and its
    /// real distance; an off day says Off and stays grey. Nothing here
    /// makes an easy day look like a rest day.
    private func dayCell(_ d: RecoveryDay) -> some View {
        let effort = FaffEffort.fromType(d.type)
        let accent: Color = d.isRunning ? effort.dot : Theme.mute
        return VStack(spacing: 5) {
            Text(d.dow)
                .font(.body(8.5, weight: .extraBold))
                .tracking(0.6)
                .foregroundStyle(Theme.txt.opacity(d.isToday ? 0.85 : 0.45))
            Text("\(d.dayNum)")
                .font(.display(15, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(d.isPast && !d.done ? 0.45 : 0.95))
            Circle()
                .fill(accent)
                .frame(width: 5, height: 5)
                .opacity(d.isRunning ? 1 : 0.5)
            Text(d.isRunning ? RecoveryWindows.fmtMi(d.miles) : "Off")
                .font(.body(9.5, weight: .bold))
                .foregroundStyle(d.isRunning ? Theme.txt.opacity(0.78) : Theme.txt.opacity(0.35))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(
            d.isToday ? Theme.txt.opacity(0.10) : Color.clear,
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay {
            if d.done {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Theme.green.opacity(0.45), lineWidth: 1)
            }
        }
    }
}
