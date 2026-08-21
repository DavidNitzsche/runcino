//
//  TodayChangedV5.swift
//  faff.run iPhone · 17a — Today changed overnight.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE TWO, ON A SCREEN
//
//  "One signal never changes a session." The engine grades readiness from
//  five independent domains and needs THREE to converge before it may
//  downgrade one — a build gate on the server. So this screen's whole reason
//  to exist is `V5Convergence`, and it never composes its own explanation for
//  why the session changed: `coachLine` arrives already naming the
//  convergence and is rendered verbatim.
//
//  `ConvergenceList` (ChartsV5.swift) is where the gate is actually enforced
//  on the client: it refuses to render fewer than three domain rows. This
//  view adds one more guard on top of that, at the screen level rather than
//  the list level — `V5Convergence.namesAConvergence` — because a screen
//  with a one-line coach note about a change and an empty list beneath it
//  would still look like a changed-session story with the evidence quietly
//  missing. If the payload cannot name a convergence, this is not that
//  screen, and the caller should be presenting the ordinary Today instead.
//  This view still checks the guard itself as a second line of defence: it
//  renders nothing rather than a half-true story if it is ever handed a
//  payload the guard rejects.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT MOVED, OR DIDN'T
//
//  `movedTo` is nil when the downgrade replaced today's session in place,
//  which is the usual case — the threshold session did not go anywhere, it
//  stopped being today's plan. The design's instinct to show "where it went"
//  only applies when it truly went somewhere, so a nil `movedTo` renders no
//  row at all rather than a fabricated "stayed on today."
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE GRADIENT IS A SCREEN CHOICE, NOT A DATA READ
//
//  The prototype hard-codes `background:var(--g-rest-panel)` on 17a — it is
//  not driven by `panel.dayState` (which reports the new session's OWN kind,
//  "easy" here). The rest-hue ramp is what marks THIS as an overnight-change
//  story rather than an ordinary easy day, so it is fixed here to `.rest`
//  regardless of what the panel's own day state says.
//

import SwiftUI

struct TodayChangedV5: View {
    /// The new session — already downgraded, e.g. type "Easy", dose "5 mi".
    /// Read `type` and `dose` only; `dayState` is deliberately not used for
    /// the panel fill (see header comment).
    let panel: V5Panel
    let convergence: V5Convergence

    /// Initials shown in the header's account control. Not carried by either
    /// model above — every other v5 screen's header needs the same value, so
    /// it is expected to come from a shared shell/account source once one
    /// exists, and defaults to the prototype's own sample runner.
    var initials: String = "JR"
    var onOpenAccount: () -> Void = {}

    var body: some View {
        if convergence.namesAConvergence {
            content
        }
        // else: not this screen's story to tell. See header comment.
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                header

                CoachSay(text: convergence.coachLine, size: .md)

                ConvergenceList(domains: convergence.converged.map(\.row))

                if let movedTo = convergence.movedTo {
                    ListGroup(header: "What moved") {
                        ListRow(label: movedTo.label, sub: movedTo.sub)
                    }
                }
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: - Header

    /// "Updated 3:12 AM · was Threshold" — composed from the two atomic
    /// fields the server sends, not from a single pre-formatted string. This
    /// is layout, not diagnosis: it states a time and a label, never a cause.
    private var kicker: String {
        guard let was = convergence.wasType, !was.isEmpty else {
            return "Updated \(convergence.updatedAt)"
        }
        return "Updated \(convergence.updatedAt) \u{00b7} was \(was)"
    }

    private var header: some View {
        DayPanel(fill: .state(.rest)) {
            HStack(alignment: .center, spacing: V5.S.s12) {
                Text(panel.place.isEmpty ? "Today" : panel.place)
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.OnPanel.primary)
                Spacer(minLength: 0)
                Button(action: onOpenAccount) {
                    Text(initials)
                        .font(.faffText(12, weight: .semibold, scales: false))
                        .foregroundStyle(V5.OnPanel.primary)
                        .frame(width: V5.Shell.headerButton, height: V5.Shell.headerButton)
                        .background(V5.OnPanel.control, in: Circle())
                }
                .buttonStyle(V5PressStyle())
                .v5HeaderTarget("Account and settings")
            }

            VStack(alignment: .leading, spacing: V5.S.s2) {
                Text(kicker)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.OnPanel.secondary)
                Text(panel.type)
                    .faffDisplayV5(TypeScaleV5.display56)
                    .foregroundStyle(V5.OnPanel.primary)
            }

            FaffValueText(panel.dose.unreadableIfAbsent,
                          font: .faffText(28, weight: .semibold),
                          color: V5.OnPanel.primary)
        }
    }
}

// MARK: - Preview

#Preview("17a · converged, session moved") {
    TodayChangedV5(panel: TodayChangedV5Sample.panel,
                   convergence: TodayChangedV5Sample.convergedAndMoved)
        .preferredColorScheme(.dark)
}

#Preview("17a · converged, replaced in place") {
    TodayChangedV5(panel: TodayChangedV5Sample.panel,
                   convergence: TodayChangedV5Sample.convergedInPlace)
        .preferredColorScheme(.dark)
}

#Preview("17a · guard: fewer than three domains renders nothing") {
    TodayChangedV5(panel: TodayChangedV5Sample.panel,
                   convergence: TodayChangedV5Sample.notAConvergence)
        .background(V5.surfacePage)
        .preferredColorScheme(.dark)
}

/// Sample data lifted verbatim from the approved prototype's own
/// `OVERNIGHT` constant (`docs/design/iphone-v5/reference/screens/_script-data.js`),
/// decoded through the real wire types rather than constructed in Swift, so
/// the preview exercises the same `Decodable` path production payloads do.
enum TodayChangedV5Sample {
    static let panel: V5Panel = decode(V5Panel.self, """
    {
      "dayState": "easy",
      "quiet": false,
      "place": "Today",
      "dateLine": "",
      "type": "Easy",
      "dose": { "text": "5 mi", "modelled": false }
    }
    """)

    static let convergedAndMoved: V5Convergence = decode(V5Convergence.self, """
    {
      "updatedAt": "3:12 AM",
      "wasType": "Threshold",
      "coachLine": "Three short nights, four days of low HRV and a resting heart rate above your usual. Today is easy running instead. The threshold session comes back when the numbers do.",
      "converged": [
        { "id": "sleep", "domain": "Sleep, 7-day median", "value": { "text": "5h 40m", "modelled": false }, "baseline": "Your baseline is 7h 10m" },
        { "id": "hrv", "domain": "HRV, four days low", "value": { "text": "52 ms", "modelled": false }, "baseline": "Your baseline is 68 ms" },
        { "id": "rhr", "domain": "Resting heart", "value": { "text": "54", "modelled": false }, "baseline": "Your baseline is 48" }
      ],
      "movedTo": { "id": "thu-threshold", "label": "Threshold, 2 \\u00d7 3 mi", "sub": "Moves to Thursday, the last day it still fits", "value": null, "action": null }
    }
    """)

    static let convergedInPlace: V5Convergence = decode(V5Convergence.self, """
    {
      "updatedAt": "3:12 AM",
      "wasType": "Threshold",
      "coachLine": "Three short nights, four days of low HRV and a resting heart rate above your usual. Today is easy running instead. The threshold session comes back when the numbers do.",
      "converged": [
        { "id": "sleep", "domain": "Sleep, 7-day median", "value": { "text": "5h 40m", "modelled": false }, "baseline": "Your baseline is 7h 10m" },
        { "id": "hrv", "domain": "HRV, four days low", "value": { "text": "52 ms", "modelled": false }, "baseline": "Your baseline is 68 ms" },
        { "id": "rhr", "domain": "Resting heart", "value": { "text": "54", "modelled": false }, "baseline": "Your baseline is 48" }
      ],
      "movedTo": null
    }
    """)

    /// Only two domains. `namesAConvergence` is false, and the screen must
    /// render nothing rather than tell a one-signal story.
    static let notAConvergence: V5Convergence = decode(V5Convergence.self, """
    {
      "updatedAt": "3:12 AM",
      "wasType": "Threshold",
      "coachLine": "Sleep was short last night.",
      "converged": [
        { "id": "sleep", "domain": "Sleep, 7-day median", "value": { "text": "5h 40m", "modelled": false }, "baseline": "Your baseline is 7h 10m" }
      ],
      "movedTo": null
    }
    """)

    private static func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(T.self, from: Data(json.utf8))
    }
}
