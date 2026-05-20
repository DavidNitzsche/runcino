//
//  WorkoutDetailView.swift
//  Faff
//
//  Workout detail — opened (sheet) from the Today hero. Sourced from the
//  PLAN artifact (DerivedWorkout) so it matches the web, not the old
//  engine: title, stat tiles, the workout (from the plan notes), effort.
//  Light v4. (overview == nil renders a sample, for #Preview only.)
//

import SwiftUI

struct WorkoutDetailView: View {
    var overview: OverviewResponse? = nil
    @Environment(\.dismiss) private var dismiss

    private var dw: DerivedWorkout? { overview.map { $0.todayWorkout } }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Faff.C.textMuted)
                        .frame(width: 30, height: 30)
                        .background(Faff.C.pillBg)
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.top, 16).padding(.bottom, 2)

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    statTiles
                    Divider().overlay(Faff.C.divider)
                    if let steps = dw?.detail?.steps, !steps.isEmpty {
                        recipe(steps)
                    } else if !workoutText.isEmpty {
                        section("The workout", workoutText)
                    }
                    section("How it should feel", effortText)
                    if let why = dw?.detail?.why, !why.isEmpty {
                        section("Why this workout", why)
                    }
                    Button { dismiss() } label: {
                        Text("CLOSE").font(Faff.F.oswald(13, .semibold)).tracking(2)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .foregroundStyle(.white).background(Faff.C.ink)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain).padding(.top, 4)
                }
                .padding(.horizontal, Faff.S.pageEdge).padding(.top, 6).padding(.bottom, 28)
            }
        }
        .background(Faff.C.bg.ignoresSafeArea())
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow.uppercased())
                .font(Faff.F.inter(10, .medium)).tracking(2).foregroundStyle(Faff.C.textDim)
            Text(title.uppercased())
                .font(Faff.F.display(50)).tracking(-1).foregroundStyle(Faff.C.ink)
                .lineSpacing(-6).fixedSize(horizontal: false, vertical: true)
            if !zoneSub.isEmpty {
                Text(zoneSub.uppercased())
                    .font(Faff.F.oswald(11)).tracking(1.4).foregroundStyle(Faff.C.textMuted)
                    .padding(.top, 2)
            }
        }
    }

    private var statTiles: some View {
        HStack(spacing: Faff.S.inlineGap) {
            tile(distanceStr, "mi", "Distance")
            tile(dw?.paceDisplay ?? "Easy", paceUnit, "Pace target")
            tile(durationStr.0, durationStr.1, "Duration")
        }
    }
    private var paceUnit: String? {
        let p = dw?.paceDisplay ?? ""
        return p.contains(":") ? "/mi" : nil
    }

    // ── Structured recipe (simple + loop steps) ───────────────────
    private func recipe(_ steps: [OStep]) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(i + 1)").font(Faff.F.oswald(20, .bold))
                        .foregroundStyle(Faff.C.ink).frame(width: 22, alignment: .leading)
                    if s.kind == "loop" {
                        loopStep(s)
                    } else {
                        simpleStep(s)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func simpleStep(_ s: OStep) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text((s.name ?? "").uppercased())
                .font(Faff.F.oswald(14, .semibold)).tracking(0.5).foregroundStyle(Faff.C.ink)
            (
                faffMarkdown("**\(s.duration ?? "")**")
                + Text(stepPaceSuffix(pace: s.pace, zone: s.zone)).foregroundStyle(Faff.C.textMuted)
            )
            .font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func loopStep(_ s: OStep) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text((s.name ?? "").uppercased())
                .font(Faff.F.oswald(14, .semibold)).tracking(0.5).foregroundStyle(Faff.C.ink)
            Text("\(s.times ?? 0) ROUNDS OF")
                .font(Faff.F.oswald(11, .semibold)).tracking(1).foregroundStyle(Faff.C.race)
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array((s.items ?? []).enumerated()), id: \.offset) { _, it in
                    HStack(alignment: .top, spacing: 6) {
                        Text("·").foregroundStyle(Faff.C.textDim)
                        loopItemText(it)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func loopItemText(_ it: OLoopItem) -> Text {
        var t = Text("\(it.verb ?? "") ").font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink)
            + faffMarkdown("**\(it.duration ?? "")**").font(Faff.F.inter(13))
        if let p = it.pace, !p.isEmpty {
            t = t + Text(" at ").font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted)
                + faffMarkdown("**\(p)**").font(Faff.F.inter(13))
        }
        if let z = it.zone, !z.isEmpty {
            t = t + Text(" (\(z))").font(Faff.F.inter(12)).foregroundStyle(Faff.C.textDim)
        }
        if let suf = it.suffix, !suf.isEmpty {
            t = t + Text(" \(suf)").font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted)
        }
        return t
    }

    private func stepPaceSuffix(pace: String?, zone: String?) -> String {
        var s = ""
        if let p = pace, !p.isEmpty { s += " at \(p)" }
        if let z = zone, !z.isEmpty { s += " (\(z))" }
        return s
    }
    private func tile(_ value: String, _ unit: String?, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(Faff.F.display(22)).foregroundStyle(Faff.C.ink)
                    .lineLimit(1).minimumScaleFactor(0.5)
                if let unit { Text(unit).font(Faff.F.inter(9, .medium)).foregroundStyle(Faff.C.textMuted) }
            }
            Text(label.uppercased()).font(Faff.F.inter(7.5, .medium)).tracking(0.6)
                .foregroundStyle(Faff.C.textDim).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 12)
        .background(Faff.C.pillBg)
        .clipShape(RoundedRectangle(cornerRadius: Faff.R.pill, style: .continuous))
    }

    private func section(_ label: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(Faff.F.inter(10, .bold)).tracking(1.4)
                .foregroundStyle(Faff.C.textDim)
            Text(body).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink)
                .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // ── Derived ───────────────────────────────────────────────────
    private var eyebrow: String {
        guard let iso = overview?.today else { return "Today" }
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let d = inF.date(from: String(iso.prefix(10))) else { return "Today" }
        let out = DateFormatter(); out.dateFormat = "EEEE · MMM d, yyyy"
        out.timeZone = TimeZone(identifier: "UTC")
        return "\(out.string(from: d)) · Today"
    }
    private var title: String { dw?.label ?? "Today's run" }
    private var zoneSub: String {
        if let z = dw?.detail?.zone, !z.isEmpty { return z }
        guard let dw else { return "" }
        var parts = [DerivedWorkout.niceType(dw.type)]
        if let z = dw.zone { parts.append("Zone \(z)") }
        return parts.joined(separator: " · ")
    }
    private var distanceStr: String {
        guard let mi = dw?.distanceMi else { return "—" }
        return mi == mi.rounded() ? String(Int(mi)) : String(format: "%.1f", mi)
    }
    private var durationStr: (String, String?) {
        guard let m = dw?.durationMin else { return ("—", nil) }
        return ("~\(m)", "min")
    }
    /// The structure, straight from the plan notes (the truth). Falls back
    /// to a one-line summary when notes are absent.
    private var workoutText: String {
        if let n = dw?.notes, !n.isEmpty { return n }
        guard let dw else { return "" }
        let pace = OverviewFormat.pace(dw.paceSPerMi)
        return pace == "Easy" ? "Run \(distanceStr) mi easy, conversational." : "Run \(distanceStr) mi at \(pace)/mi."
    }
    private var effortText: String {
        if let e = dw?.detail?.effort, !e.isEmpty { return e }
        return dw?.guidance ?? "Controlled, sustainable work for today's phase."
    }
}

#Preview { WorkoutDetailView() }
