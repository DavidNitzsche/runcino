//
//  ReturnToRunningV5.swift
//  faff.run iPhone · 19a — Return to running.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE LADDER
//
//  Eight stages, one at a time — max one advance per week, two sessions
//  minimum at each, no walk-only stage (stage 1 is run 1 · walk 4 × 5). The
//  panel states which stage the runner is on and what today's session is;
//  the full eight-row list below states where every other stage sits
//  (done / today / upcoming) so the whole ladder is visible, not just the
//  rung the runner is standing on.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE THREE, ON THE ONE ROW THAT MATTERS HERE
//
//  "Bone stress injuries are clinician-gated; a niggle is not." When the
//  engine will not advance the ladder on a self-report alone,
//  `V5Return.refusal` carries the reason and this view renders it with
//  `Alert` — the "we read it and the answer is no" component, with no
//  confirm action, because there is nothing to confirm. It is deliberately
//  NOT `ErrorNote` (that says we could not read this, which would be untrue —
//  we read it perfectly, clinician gating is the policy) and deliberately
//  not a greyed-out check-in with no explanation. The refusal REPLACES the
//  check-in section; the ladder list above it stays, because knowing where
//  you stand is still true even while advancing is gated.
//
//  ─────────────────────────────────────────────────────────────────────────
//  NEVER SCOLD
//
//  "A repeated stage states what happens next and says nothing about the
//  runner." `checkIn` rows arrive with their own `sub` text ("Repeat this
//  stage tomorrow"), already written in that voice, and this view reuses it
//  verbatim as the settled note rather than composing a new sentence that
//  risks commentary the design does not want.
//

import SwiftUI

struct ReturnToRunningV5: View {
    let ret: V5Return

    var initials: String = "JR"
    var onOpenAccount: () -> Void = {}
    /// Fires once a check-in write finishes. The caller decides what a
    /// settled stage should do next (e.g. re-pull `/api/v5/return`).
    var onCheckedIn: (() -> Void)? = nil

    @State private var settledOption: V5Row?
    @State private var isBusy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                header
                CoachSay(text: ret.coachLine, size: .md)
                ladderList

                if let refusal = ret.refusal {
                    Alert(text: refusal, tone: .attention)
                } else {
                    checkInSection
                }
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }

    // MARK: - Header
    //
    // Quiet fill, same designed state as 13a/18a — text tokens, not the
    // on-panel white-at-opacity set a gradient screen would use.

    private var header: some View {
        DayPanel(fill: .quiet) {
            HStack(alignment: .center, spacing: V5.S.s12) {
                Text(ret.panel.place.isEmpty ? "Today" : ret.panel.place)
                    .font(.faffDisplay(20))
                    .textCase(.uppercase)
                    .tracking(20 * 0.02)
                    .foregroundStyle(V5.textPrimary)
                Spacer(minLength: 0)
                Button(action: onOpenAccount) {
                    Text(initials)
                        .font(.faffText(12, weight: .semibold, scales: false))
                        .foregroundStyle(V5.textPrimary)
                        .frame(width: V5.Shell.headerButton, height: V5.Shell.headerButton)
                        .background(V5.materialControl, in: Circle())
                }
                .buttonStyle(V5PressStyle())
                .v5HeaderTarget("Account and settings")
            }

            VStack(alignment: .leading, spacing: V5.S.s2) {
                Text(ret.panel.dateLine)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                Text("Stage \(ret.stage) of \(ret.stageCount)")
                    .faffDisplayV5(TypeScaleV5.display44)
                    .foregroundStyle(V5.textPrimary)
            }

            Text(ret.prescription)
                .font(.faffText(20, weight: .semibold))
                .foregroundStyle(V5.textPrimary)
        }
    }

    // MARK: - The ladder
    //
    // Every stage, not just the current one. `V5ReturnStage.label` is the
    // stage's own prescription ("Run 3 min · walk 2 min · ×5"); "Stage N" is
    // built from `number` rather than duplicated on the wire.

    private var ladderList: some View {
        ListGroup(header: "The ladder") {
            ForEach(ret.stages) { stage in
                ListRow(label: "Stage \(stage.number)",
                        sub: stage.label,
                        value: statusValue(stage.status))
            }
        }
    }

    private func statusValue(_ status: String) -> FaffValue? {
        switch status {
        case "done":  return .measured("Done")
        case "today": return .measured("Today")
        default:      return nil   // upcoming — nothing printed, matching the design's blank cell.
        }
    }

    // MARK: - Check-in
    //
    // "Calf stayed silent" advances the stage; "Something felt off" repeats
    // it. Same expand-in-place-adjacent pattern as the injury flare's own
    // check-in (13a): a plain tile of tappable rows, no picker, no sheet.

    private var checkInSection: some View {
        VStack(alignment: .leading, spacing: V5.S.s10) {
            V5SectionLabel(text: "How did today go")
            VStack(spacing: 0) {
                ForEach(ret.checkIn) { row in
                    ListRow(label: row.label, sub: row.sub) {
                        checkIn(row)
                    }
                }
            }
            .background(V5.materialTile, in: RoundedRectangle(cornerRadius: V5.R.r22, style: .continuous))

            if let settledOption {
                Text(settledOption.sub ?? "Logged.")
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textSecondary)
                    .padding(.horizontal, V5.S.s4)
            }
        }
    }

    private func checkIn(_ row: V5Row) {
        guard !isBusy else { return }
        isBusy = true
        Task {
            _ = try? await API.returnCheckIn(outcome: row.action ?? "silent")
            await MainActor.run {
                isBusy = false
                settledOption = row
                onCheckedIn?()
            }
        }
    }
}

// MARK: - Preview

#Preview("19a · stage 3 of 8") {
    ReturnToRunningV5(ret: ReturnToRunningV5Sample.stage3)
        .preferredColorScheme(.dark)
}

#Preview("19a · refused, clinician-gated") {
    ReturnToRunningV5(ret: ReturnToRunningV5Sample.refused)
        .preferredColorScheme(.dark)
}

/// Stage prescriptions are the prototype's own `LADDER_STAGES` constant
/// (`docs/design/iphone-v5/reference/screens/_script-data.js`); the
/// surrounding payload is a plausible `/api/v5/return` response decoded
/// through the real `V5Return` type.
enum ReturnToRunningV5Sample {
    private static let stageLabels = [
        "Run 1 min \u{00b7} walk 4 min \u{00b7} \u{00d7}5",
        "Run 2 min \u{00b7} walk 3 min \u{00b7} \u{00d7}5",
        "Run 3 min \u{00b7} walk 2 min \u{00b7} \u{00d7}5",
        "Run 5 min \u{00b7} walk 2 min \u{00b7} \u{00d7}4",
        "Run 8 min \u{00b7} walk 2 min \u{00b7} \u{00d7}3",
        "Run 12 min \u{00b7} walk 2 min \u{00b7} \u{00d7}2",
        "Run 20 min \u{00b7} walk 1 min \u{00b7} \u{00d7}2",
        "Run 30 min \u{00b7} continuous, no walking",
    ]

    private static func stagesJSON(currentStage: Int) -> String {
        let rows = stageLabels.enumerated().map { i, label -> String in
            let n = i + 1
            let status = n < currentStage ? "done" : n == currentStage ? "today" : "upcoming"
            return #"{ "id": "stage-\#(n)", "number": \#(n), "label": "\#(label)", "status": "\#(status)" }"#
        }
        return "[" + rows.joined(separator: ",") + "]"
    }

    static let stage3: V5Return = decode("""
    {
      "panel": { "dayState": "easy", "quiet": true, "place": "Today", "dateLine": "Left calf \\u00b7 cleared to return", "type": "", "dose": null },
      "stage": 3,
      "stageCount": 8,
      "prescription": "\(stageLabels[2])",
      "coachLine": "A stage advances only if the calf stayed silent during the session and silent again the next morning \\u00b7 a good session does not skip a stage.",
      "stages": \(stagesJSON(currentStage: 3)),
      "checkIn": [
        { "id": "silent", "label": "Calf stayed silent", "sub": "Advance to the next stage", "value": null, "action": "silent" },
        { "id": "off", "label": "Something felt off", "sub": "Repeat this stage tomorrow", "value": null, "action": "something_off" }
      ],
      "refusal": null
    }
    """)

    static let refused: V5Return = decode("""
    {
      "panel": { "dayState": "easy", "quiet": true, "place": "Today", "dateLine": "Left tibia \\u00b7 bone stress, clearing", "type": "", "dose": null },
      "stage": 2,
      "stageCount": 8,
      "prescription": "\(stageLabels[1])",
      "coachLine": "A stage advances only if the calf stayed silent during the session and silent again the next morning \\u00b7 a good session does not skip a stage.",
      "stages": \(stagesJSON(currentStage: 2)),
      "checkIn": [
        { "id": "silent", "label": "Calf stayed silent", "sub": "Advance to the next stage", "value": null, "action": "silent" },
        { "id": "off", "label": "Something felt off", "sub": "Repeat this stage tomorrow", "value": null, "action": "something_off" }
      ],
      "refusal": "A bone stress injury needs a clinician's clearance before this stage can advance. Log the session as usual. The ladder holds until that clearance is on file."
    }
    """)

    private static func decode(_ json: String) -> V5Return {
        // swiftlint:disable:next force_try
        try! JSONDecoder().decode(V5Return.self, from: Data(json.utf8))
    }
}
