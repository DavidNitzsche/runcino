//
//  WorkoutDetailView.swift
//  Faff
//
//  Workout detail (handoff §2) — slides up from Today. Eyebrow, big
//  title, the Structure card (real describeWorkout steps), the coach's
//  Why + Focus, then Start Run (primary) + Move/Skip/Swap. "Start Run"
//  replaces the old "Send to Watch" — it hands today's workout to the
//  watch to record (the watch is the tracker).
//

import SwiftUI

struct WorkoutDetailView: View {
    var overview: OverviewResponse? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var handedOff = false

    private var dw: DerivedWorkout? { overview.map { $0.todayWorkout } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 9) {
                        Text(eyebrow.uppercased())
                            .font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                        Text(titleLine)
                            .font(Faff.F.display(46)).tracking(-0.5).foregroundStyle(Faff.C.ink)
                            .lineSpacing(-8).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    SheetCloseButton { dismiss() }
                }

                if let steps = dw?.detail?.steps, !steps.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("STRUCTURE").font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                            .padding(.bottom, 4)
                        ForEach(Array(steps.enumerated()), id: \.offset) { _, s in stepView(s) }
                    }.faffCard()
                } else if let n = dw?.notes, !n.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("THE WORKOUT").font(Faff.F.inter(10, .semibold)).tracking(1.6).foregroundStyle(Faff.C.textDim)
                        Text(n).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }.faffCard()
                }

                if let why = dw?.detail?.why, !why.isEmpty {
                    CoachVerdict("Why this run", why, color: Faff.C.recovery)
                }
                CoachVerdict("Focus", dw?.detail?.effort ?? dw?.guidance ?? "Controlled, sustainable work for today's phase.",
                             color: Faff.C.milestone)

                PrimaryButton(title: handedOff ? "Sent to watch" : "Start Run", icon: "figure.run") { startRun() }
                HStack(spacing: 8) {
                    GhostButton(title: "Move")
                    GhostButton(title: "Skip")
                    GhostButton(title: "Swap")
                }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }

    // ── Structure rows ────────────────────────────────────────────
    @ViewBuilder private func stepView(_ s: OStep) -> some View {
        if s.kind == "loop" {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 2).fill(Faff.C.recovery).frame(width: 4, height: 20)
                    Text((s.name ?? "").uppercased()).font(Faff.F.oswald(14, .semibold)).tracking(0.5).foregroundStyle(Faff.C.ink)
                }
                Text("\(s.times ?? 0) ROUNDS OF").font(Faff.F.oswald(11, .semibold)).tracking(1).foregroundStyle(Faff.C.race)
                    .padding(.leading, 16)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array((s.items ?? []).enumerated()), id: \.offset) { _, it in
                        HStack(alignment: .top, spacing: 6) {
                            Text("·").foregroundStyle(Faff.C.textDim)
                            loopItemText(it)
                        }
                    }
                }.padding(.leading, 16)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 7)
        } else {
            StructureRow(name: s.name ?? "", sub: simpleSub(s), distance: "",
                         work: (s.zone ?? "").lowercased().contains("threshold") || (s.zone ?? "").contains("T"))
        }
    }
    private func simpleSub(_ s: OStep) -> String {
        var parts: [String] = []
        if let d = s.duration, !d.isEmpty { parts.append(d) }
        if let p = s.pace, !p.isEmpty { parts.append(p) }
        if let z = s.zone, !z.isEmpty { parts.append(z) }
        return parts.joined(separator: " · ")
    }
    private func loopItemText(_ it: OLoopItem) -> Text {
        var t = Text("\(it.verb ?? "") ").font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink)
            + faffMarkdown("**\(it.duration ?? "")**").font(Faff.F.inter(13))
        if let p = it.pace, !p.isEmpty {
            t = t + Text(" at ").font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted)
                + faffMarkdown("**\(p)**").font(Faff.F.inter(13))
        }
        if let suf = it.suffix, !suf.isEmpty { t = t + Text(" \(suf)").font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted) }
        return t
    }

    // ── Action ────────────────────────────────────────────────────
    private func startRun() {
        WatchSync.shared.activate()
        Task { await WatchSync.shared.syncTodayToWatch() }
        handedOff = true
    }

    // ── Derived ───────────────────────────────────────────────────
    private var eyebrow: String {
        let dw = self.dw
        let phase = overview?.planCurrentPhase ?? "Today"
        let type = dw.map { DerivedWorkout.niceType($0.type) } ?? "Workout"
        return "\(type) · \(phase) · today"
    }
    private var titleLine: String {
        let label = dw?.label ?? "Today's run"
        let nice: String = {
            switch label.lowercased() { case "easy": return "Easy Run"; case "long": return "Long Run"; default: return label }
        }()
        if let mi = dw?.distanceMi, mi > 0 {
            return "\(nice.uppercased())\n\(OverviewFormat.distance(mi)) MI"
        }
        return nice.uppercased()
    }
}

#Preview { WorkoutDetailView() }
