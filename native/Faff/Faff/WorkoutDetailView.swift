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
                    if !workoutText.isEmpty { section("The workout", workoutText) }
                    section("Effort", effortText)
                    if !coachText.isEmpty {
                        Divider().overlay(Faff.C.divider)
                        coachSection
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
            tile(OverviewFormat.pace(dw?.paceSPerMi), OverviewFormat.paceUnit(dw?.paceSPerMi), "Pace target")
            tile(durationStr.0, durationStr.1, "Duration")
        }
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

    private var coachSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(Faff.C.recovery).frame(width: 7, height: 7)
                Text((overview?.briefing?.answer.label ?? "Coach").uppercased())
                    .font(Faff.F.inter(10, .semibold)).tracking(1.4)
                    .foregroundStyle(Faff.C.textDim)
            }
            faffMarkdown(coachText)
                .font(Faff.F.inter(15)).foregroundStyle(Faff.C.ink)
                .lineSpacing(5).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
    private var title: String { dw?.label ?? "Threshold · Cruise Intervals" }
    private var zoneSub: String {
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
    private var effortText: String { dw?.guidance ?? "Controlled, sustainable work for today's phase." }
    private var coachText: String { overview?.composedCoach ?? "" }
}

#Preview { WorkoutDetailView() }
