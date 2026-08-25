//
//  RunLogV5.swift
//  faff.run iPhone · a way to browse past runs.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE GAP THIS CLOSES
//
//  Nothing in v5 could open a finished run. `GET /api/log` (`API.fetchLog()`,
//  `LogState` in `Models/Runs.swift`) already has the whole history — weeks of
//  `LogRun` rows, each carrying its own server id — and nothing on the phone
//  pointed at it. This screen is the index: a pushed, plain list (the shell
//  exception `RaceDetailV5` already uses — there is no single "place" to open
//  a gradient panel on, since a history is not a day), one `ListGroup` per
//  week, exactly mirroring `TodayCalendarWeek`/`TodayCalendarDay` in
//  `TodayBeforeV5.swift`. Tapping a run hands its id to `onOpenRun`; this view
//  does not know what opens next — see `RunDetailV5.swift`.
//
//  Reached from the Block tab (`BlockV5.swift`'s new "Runs" row) — Block is
//  the plan, and "what did I actually run against it" is the natural next
//  question once a runner is looking at the 16 weeks. It is deliberately NOT
//  hung off the calendar sheet in `TodayBeforeV5.swift`: that sheet's rows
//  carry a plan-day id (`pw-…` / `date:…`), not a run id, and reusing it as
//  a run browser would mean inventing an id join the wire contract does not
//  make. The calendar's own "Done" days get a smaller, honest fix instead —
//  they now call the SAME `onPickDay` the week strip already uses, which
//  re-opens that day inline as the after-run screen it already knows how to
//  render. See that file's report note.
//
//  This file does not fetch. `log: LogState` arrives already resolved.
//
//  RULE ONE: every distance here is a LOGGED number — read from a run that
//  happened — so every value is `.measured`, never `.modelled`.
//

import SwiftUI

// MARK: - Screen

struct RunLogV5: View {
    let log: LogState

    var onOpenRun: (String) -> Void = { _ in }
    var onBack: (() -> Void)? = nil

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // 22a's drawn AppBar title. "Runs" was the Block row's label
                // leaking into the screen it opens; the screen is a history,
                // and the drawn title says so.
                AppBar(title: "Past runs", eyebrow: eyebrow, onBack: onBack)

                VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                    if log.weeks.isEmpty {
                        // RULE THREE: a runner with nothing logged yet is not
                        // an error — a designed silence, not an empty list
                        // that looks like the fetch failed.
                        Silence(reason: "Nothing logged yet. Once a run is in, it shows up here.")
                    } else {
                        ForEach(log.weeks) { week in
                            ListGroup(header: week.label, footer: weekFooter(week)) {
                                ForEach(week.runs) { run in
                                    ListRow(label: rowLabel(run),
                                            sub: rowSub(run),
                                            value: .measured(FaffFmt.milesUnit(run.distance_mi)),
                                            onTap: { onOpenRun(run.id) })
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, V5.S.gutter)
                .padding(.bottom, V5.S.s24)
            }
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: - Header

    private var eyebrow: String? {
        guard log.totalRuns > 0 else { return nil }
        let mi = FaffFmt.milesUnit(log.totalMi) ?? "0 mi"
        return "\(log.totalRuns) run\(log.totalRuns == 1 ? "" : "s") \u{00B7} \(mi)"
    }

    private func weekFooter(_ week: LogWeek) -> String? {
        week.totalMi > 0 ? FaffFmt.milesUnit(week.totalMi) : nil
    }

    // MARK: - Row content

    /// The run's real name when it has one worth showing (`LogRun.hasMeaningfulName`
    /// already filters device-default names like "Run" / "Treadmill Run"), else
    /// the effort word the engine classified it as.
    private func rowLabel(_ run: LogRun) -> String {
        if run.hasMeaningfulName { return run.name }
        if let type = run.type, !type.isEmpty { return type.prefix(1).uppercased() + type.dropFirst() }
        return "Run"
    }

    private func rowSub(_ run: LogRun) -> String? {
        var parts: [String] = []
        if let day = Self.shortDate(run.date) { parts.append(day) }
        if let pace = run.pace, !pace.isEmpty { parts.append("\(pace)/mi") }
        if let badge = run.badge, !badge.isEmpty { parts.append(badge) }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    /// "2026-08-18" → "Tue 18 Aug". Local to this screen: nothing else in the
    /// v5 surface needed a bare weekday-and-day formatter yet.
    private static func shortDate(_ iso: String) -> String? {
        guard let date = isoDayFormatter.date(from: iso) else { return nil }
        return displayFormatter.string(from: date)
    }
    private static let isoDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
    private static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEE d MMM"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
}

// MARK: - Preview

#Preview("Run log") {
    RunLogV5(log: RunLogV5Sample.log, onOpenRun: { _ in }, onBack: {})
        .preferredColorScheme(.dark)
}

enum RunLogV5Sample {
    static let log: LogState = decode(json)

    private static func decode(_ json: String) -> LogState {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(LogState.self, from: Data(json.utf8))
    }

    /// 2026-08-25 · the three totals in here were 24.3 mi / 17.2 mi /
    /// "2:34:10" and not one of them was the sum of the runs underneath: the
    /// header claimed 24.3 mi over four runs that add to 36.3, and THIS WEEK
    /// claimed 17.2 over three that add to 29.2 — a 12-mile week invented in a
    /// sample. `log-state.ts` builds both by reducing the very rows it sends,
    /// so production cannot produce this. But the catalog is where a screen
    /// gets LOOKED AT, and a sample whose figures do not add up makes a real
    /// summation bug indistinguishable from the sample being nonsense.
    /// `FaffTests/CatalogSampleArithmeticTests.swift` now adds them up.
    private static let json = """
    {
      "today": "2026-08-20",
      "totalRuns": 4,
      "totalMi": 36.3,
      "weeks": [
        {
          "monday": "2026-08-17",
          "label": "This week",
          "totalMi": 29.2,
          "totalDuration": "3:54:53",
          "isCurrent": true,
          "runs": [
            { "id": "run_9f21", "date": "2026-08-18", "dow": 2, "name": "Run",
              "source": "watch", "type": "easy", "distance_mi": 6.02,
              "pace": "9:02", "time_moving": "54:16", "avg_hr": 141 },
            { "id": "run_2b7a", "date": "2026-08-19", "dow": 3, "name": "Run",
              "source": "watch", "type": "threshold", "distance_mi": 10.1,
              "pace": "7:47", "time_moving": "1:18:44", "avg_hr": 169 },
            { "id": "run_c114", "date": "2026-08-20", "dow": 4, "name": "AFC Half",
              "source": "strava", "type": "race", "distance_mi": 13.1,
              "pace": "7:47", "time_moving": "1:41:53", "avg_hr": 172,
              "isRace": true, "raceSlug": "afc-half", "badge": "RACE" }
          ]
        },
        {
          "monday": "2026-08-10",
          "label": "Week 5",
          "totalMi": 7.1,
          "totalDuration": null,
          "isCurrent": false,
          "runs": [
            { "id": "run_a001", "date": "2026-08-12", "dow": 3, "name": "Run",
              "source": "apple_health", "type": "recovery", "distance_mi": 7.1,
              "pace": "9:48", "time_moving": "1:09:34", "avg_hr": 132 }
          ]
        }
      ]
    }
    """
}
