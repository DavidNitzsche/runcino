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
    var onReload: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var handedOff = false
    @State private var reschedule: RescheduleTarget?
    @State private var showSkipConfirm = false
    @State private var working = false

    private var dw: DerivedWorkout? { overview.map { $0.todayWorkout } }
    private var todayISO: String { overview?.today ?? "" }

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
                    GhostButton(title: "Move") { reschedule = RescheduleTarget(action: "move") }
                    GhostButton(title: "Skip") { showSkipConfirm = true }
                    GhostButton(title: "Swap") { reschedule = RescheduleTarget(action: "swap") }
                }
                .disabled(working)
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg.ignoresSafeArea())
        .sheet(item: $reschedule) { t in
            RescheduleSheet(action: t.action, fromDateISO: todayISO,
                            days: overview?.planWeekWorkouts ?? [],
                            onDone: { onReload(); dismiss() })
        }
        .confirmationDialog("Skip today's \(dw?.label.lowercased() ?? "run")?",
                            isPresented: $showSkipConfirm, titleVisibility: .visible) {
            Button("Skip workout", role: .destructive) { Task { await skip() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The coach treats a skip as a recovery signal and adapts the days around it.")
        }
    }

    private func skip() async {
        guard !todayISO.isEmpty else { return }
        working = true; defer { working = false }
        try? await PlanActionAPI.skip(dateISO: todayISO, type: dw?.label, mi: dw?.distanceMi)
        onReload(); dismiss()
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

// MARK: - Reschedule (move / swap a workout to another day)

struct RescheduleTarget: Identifiable { let id = UUID(); let action: String }  // "move" | "swap"

struct RescheduleSheet: View {
    let action: String
    let fromDateISO: String
    let days: [OPlanDay]
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var working = false
    @State private var errorMsg: String?

    private var isMove: Bool { action == "move" }
    private var candidates: [OPlanDay] {
        days.filter {
            ($0.dateISO ?? "") != fromDateISO
            && (isMove || !DerivedWorkout(plan: $0, fallback: nil).isRest)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(isMove ? "MOVE WORKOUT" : "SWAP WITH")
                            .font(Faff.F.inter(10, .semibold)).tracking(2).foregroundStyle(Faff.C.textDim)
                        Text(isMove ? "Pick a new day" : "Pick a day to swap")
                            .font(Faff.F.display(32)).foregroundStyle(Faff.C.ink)
                    }
                    Spacer()
                    SheetCloseButton { dismiss() }
                }
                VStack(spacing: 0) {
                    ForEach(Array(candidates.enumerated()), id: \.offset) { i, d in
                        if i > 0 { Divider().overlay(Faff.C.divider) }
                        Button { Task { await go(d.dateISO) } } label: { dayRow(d) }
                            .buttonStyle(.plain).disabled(working)
                    }
                }.faffCard()
                if let e = errorMsg {
                    Text(e).font(Faff.F.inter(12)).foregroundStyle(Faff.C.warn)
                }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom).padding(.top, 6)
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }

    private func dayRow(_ d: OPlanDay) -> some View {
        let dw = DerivedWorkout(plan: d, fallback: nil)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(weekday(d.dateISO)).font(Faff.F.inter(13, .semibold)).foregroundStyle(Faff.C.ink)
                Text(dw.isRest ? "Rest day" : "\(dw.label) · \(OverviewFormat.distance(d.distanceMi)) mi")
                    .font(Faff.F.inter(10)).foregroundStyle(Faff.C.textDim)
            }
            Spacer()
            if working { ProgressView().scaleEffect(0.7) }
            else { Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Faff.C.race) }
        }.padding(.vertical, 11).contentShape(Rectangle())
    }

    private func go(_ to: String?) async {
        guard let to, !fromDateISO.isEmpty else { return }
        working = true; defer { working = false }
        do {
            try await PlanActionAPI.reschedule(action: action, from: fromDateISO, to: to)
            onDone()
        } catch {
            errorMsg = "Couldn't \(action) the workout. Try again."
        }
    }

    private func weekday(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "—" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let dt = inF.date(from: String(iso.prefix(10))) else { return iso }
        let out = DateFormatter(); out.dateFormat = "EEEE, MMM d"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: dt)
    }
}
