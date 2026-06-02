//
//  ReadinessBriefSheet.swift
//  Full-height readiness brief surface · pushed from the Today
//  readiness panel tap. Mobile counterpart of the web's
//  ReadinessBriefPanel · same composer (loadReadinessBrief).
//
//  Reference: designs/from Design agent/Readiness brief page/
//    · Faff Readiness Brief (iPhone).html (prototype)
//    · README.md (spec)
//
//  Content order:
//    1. Subjective override (when present) · loud amber-red banner
//    2. Hero · 92pt ring (number only) + READINESS · LABEL + headline + oneLineMover
//    3. 14-day score trend bar chart · the lead element
//    4. Streaks · tappable banners (collapsed → short, expanded → meaning)
//    5. Pillars · 5 tap-to-expand rows · contribution bar + pillar history + confounders
//    6. Watch tomorrow · glass card list (when present)
//
//  Cold-start variant (band='no-data'): replaces the body with the
//  baseline-building progress ring + connect HK CTA.
//
//  Doctrine: dark-first · text always solid white · no prescription ·
//  state both numbers (no derived deltas) · no em dashes.
//

import SwiftUI

// MARK: - Color tokens (per the README spec)

private enum BriefBand {
    static func tint(_ raw: String) -> Color {
        switch raw.lowercased() {
        case "sharp":     return Color(hex: 0x34D058)
        case "ready":     return Color(hex: 0x3EBD41)
        case "moderate":  return Color(hex: 0xF3AD38)
        case "pull-back", "pullback", "pull_back":
                          return Color(hex: 0xFC4D64)
        case "no-data", "no_data", "":
                          return Color(hex: 0x8A90A0)
        default:          return Color(hex: 0x8A90A0)
        }
    }
}

private enum PillarBand {
    /// Tint for the pillar dot + today's history bar. Maps both the
    /// {sharp/ready/moderate/pull-back} band names AND the design's
    /// {good/ok/watch/low} aliases so older envelopes don't grey out.
    static func tint(_ raw: String) -> Color {
        switch raw.lowercased() {
        case "good", "sharp", "ready":  return Color(hex: 0x3EBD41)
        case "ok":                       return Color(hex: 0x8A90A0)
        case "watch", "moderate":        return Color(hex: 0xF3AD38)
        case "low", "pull-back", "pullback", "pull_back":
                                         return Color(hex: 0xFC4D64)
        case "no-data", "no_data", "":   return Color(hex: 0x8A90A0)
        default:                         return Color(hex: 0x8A90A0)
        }
    }
}

/// Signed-contribution tint per the spec:
///   ≤ -8 red · < 0 amber-orange · > 0 green · 0 grey
private func contributionTint(_ pts: Int) -> Color {
    if pts <= -8 { return Color(hex: 0xFC4D64) }
    if pts <  0  { return Color(hex: 0xFFB24D) }
    if pts >  0  { return Color(hex: 0x3EBD41) }
    return Color(hex: 0x8A90A0)
}

private func signed(_ n: Int) -> String {
    if n > 0 { return "+\(n)" }
    if n < 0 { return "−\(abs(n))" }
    return "0"
}

private func humanPillar(_ key: String) -> String {
    switch key.lowercased() {
    case "sleep": return "Sleep"
    case "hrv":   return "HRV"
    case "rhr":   return "RHR"
    case "load":  return "Load"
    case "hr_recovery", "hr-rec", "hr_rec": return "HR recovery"
    default:      return key.capitalized
    }
}

// MARK: - Sheet container

struct ReadinessBriefSheet: View {
    @Environment(\.dismiss) private var dismiss

    /// The current Today time-of-day · the sheet inherits the parent
    /// mesh and tracks it (animated across hour boundaries).
    let timeOfDay: TimeOfDay

    @State private var brief: ReadinessBriefSeed?
    @State private var loadState: LoadState = .idle
    @State private var refreshing: Bool = false

    var body: some View {
        ZStack {
            // Parent Today mesh shows through the blur. Re-emitting it
            // here means the sheet feels glued to the screen behind.
            FaffMeshView(mesh: FaffMesh.forTimeOfDay(timeOfDay))
                .ignoresSafeArea()

            // Sheet glass · rgba(8,11,15,.6) + blur(28) saturate(125%)
            // per spec. SwiftUI's `Material` is the closest first-class
            // match; layer a tint on top to land the rgba(8,11,15,.6).
            VStack(spacing: 0) {
                // Top gap so the parent mesh peeks · ~64pt the spec
                // calls out. Use ignoresSafeArea for the bottom; SwiftUI
                // pushes the top down to the safe-area inset naturally.
                Spacer().frame(height: 64)
                sheetBody
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .task {
            if brief == nil { await loadBrief() }
        }
    }

    @ViewBuilder
    private var sheetBody: some View {
        VStack(spacing: 0) {
            grabber
            header
            ScrollView {
                if refreshing { refreshHint }
                content
                    .padding(.horizontal, 22)
                    .padding(.bottom, 60)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                refreshing = true
                await loadBrief()
                refreshing = false
            }
        }
        .background(
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                Rectangle().fill(Color(hex: 0x080B0F).opacity(0.6))
            }
        )
        .clipShape(RoundedCornerShape(radius: 30, corners: [.topLeft, .topRight]))
        .overlay(
            // Top hairline border per spec
            RoundedCornerShape(radius: 30, corners: [.topLeft, .topRight])
                .stroke(Color.white.opacity(0.14), lineWidth: 1)
        )
    }

    // MARK: chrome · grabber + header

    private var grabber: some View {
        Capsule()
            .fill(Color.white.opacity(0.34))
            .frame(width: 40, height: 5)
            .padding(.top, 10)
            .padding(.bottom, 2)
    }

    private var header: some View {
        HStack {
            Text("READINESS · TODAY")
                .font(.body(12, weight: .bold)).tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.6))
            Spacer()
            Button(action: { dismiss() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color.white.opacity(0.12), in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 12)
    }

    private var refreshHint: some View {
        Text("LOADING · READINESS")
            .font(.body(10, weight: .bold)).tracking(1.0)
            .foregroundStyle(Color.white.opacity(0.38))
            .padding(.top, 2).padding(.bottom, 12)
            .frame(maxWidth: .infinity)
    }

    // MARK: content router

    @ViewBuilder
    private var content: some View {
        switch loadState {
        case .idle, .loading:
            // Brief MAY be hydrated from cache; render it if present.
            if let b = brief { briefContent(b) } else { loadingPlaceholder }
        case .loaded:
            if let b = brief { briefContent(b) }
            else { coldStartFallback }
        case .failed(let msg):
            failedState(message: msg)
        }
    }

    private var loadingPlaceholder: some View {
        VStack {
            ProgressView()
                .progressViewStyle(.circular)
                .tint(.white)
                .padding(.top, 80)
            Spacer()
        }
    }

    private var coldStartFallback: some View {
        VStack(alignment: .center, spacing: 16) {
            Spacer().frame(height: 20)
            ProgressRing(progress: 0)
                .frame(width: 118, height: 118)
                .overlay(
                    VStack(spacing: 6) {
                        Text("—")
                            .font(.display(36, weight: .semibold))
                            .foregroundStyle(.white)
                        Text("no signal yet")
                            .font(.body(10, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(Color.white.opacity(0.5))
                    }
                )
            Text("Building your baseline.")
                .font(.body(23, weight: .bold))
                .foregroundStyle(.white)
                .padding(.top, 6)
            Text("Wear the watch overnight for a few nights and your readiness reading lights up.")
                .font(.body(13.5, weight: .regular))
                .foregroundStyle(Color.white.opacity(0.78))
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .padding(.horizontal, 16)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func failedState(message: String) -> some View {
        VStack(alignment: .center, spacing: 12) {
            Spacer().frame(height: 60)
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Color(hex: 0xFFB24D))
            Text(message)
                .font(.body(13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.82))
                .multilineTextAlignment(.center)
            Button("Retry") { Task { await loadBrief() } }
                .font(.body(12, weight: .extraBold))
                .tracking(1)
                .foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 9)
                .background(Color.white.opacity(0.12), in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(0.2), lineWidth: 1))
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: brief content (real data)

    @ViewBuilder
    private func briefContent(_ b: ReadinessBriefSeed) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Cold-start envelope takes over the whole body when present.
            if let cold = b.coldStart {
                BriefColdStartView(brief: b, cold: cold)
            } else {
                if let o = b.subjectiveOverride { subjectiveOverrideCard(o) }
                heroBlock(b)
                if b.scoreTrend.count > 1 { trendSection(b) }
                if !b.streaks.isEmpty { streaksSection(b.streaks) }
                pillarsSection(b)
                if !b.watchTomorrow.isEmpty { watchSection(b.watchTomorrow) }
            }
        }
    }

    // MARK: - 1. Subjective override

    private func subjectiveOverrideCard(_ o: SubjectiveOverride) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 8) {
                Circle()
                    .fill(Color(hex: 0xFFCE8A))
                    .frame(width: 8, height: 8)
                Text("SUBJECTIVE OVERRIDE")
                    .font(.body(10, weight: .extraBold))
                    .tracking(1.4)
                    .foregroundStyle(Color(hex: 0xFFCE8A))
            }
            HStack(alignment: .center, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(o.subjectiveScore)")
                        .font(.display(36, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("HOW YOU FEEL")
                        .font(.body(8.5, weight: .extraBold))
                        .tracking(1.2)
                        .foregroundStyle(Color.white.opacity(0.6))
                }
                Text("vs")
                    .font(.body(11, weight: .semibold))
                    .italic()
                    .foregroundStyle(Color.white.opacity(0.4))
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(o.objectiveScore)")
                        .font(.display(36, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.42))
                    Text("THE NUMBERS")
                        .font(.body(8.5, weight: .extraBold))
                        .tracking(1.2)
                        .foregroundStyle(Color.white.opacity(0.6))
                }
                Spacer(minLength: 0)
            }
            Text(o.advice)
                .font(.body(13.5, weight: .regular))
                .foregroundStyle(.white)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .background(
            LinearGradient(
                colors: [Color(hex: 0xF3AD38).opacity(0.22),
                         Color(hex: 0xFC4D64).opacity(0.14)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color(hex: 0xF3AD38).opacity(0.45), lineWidth: 1)
        )
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    // MARK: - 2. Hero (ring + words)

    private func heroBlock(_ b: ReadinessBriefSeed) -> some View {
        HStack(alignment: .center, spacing: 18) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.2), lineWidth: 6)
                Circle()
                    .trim(from: 0, to: max(0, min(1, Double(b.score) / 100.0)))
                    .stroke(BriefBand.tint(b.band),
                            style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.6), value: b.score)
                Text("\(b.score)")
                    .font(.display(38, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 92, height: 92)

            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    Text("READINESS")
                        .font(.body(10.5, weight: .extraBold))
                        .tracking(2)
                        .foregroundStyle(Color.white.opacity(0.62))
                    Text(b.label.isEmpty ? b.band.uppercased() : b.label.uppercased())
                        .font(.body(10.5, weight: .extraBold))
                        .tracking(2)
                        .foregroundStyle(BriefBand.tint(b.band))
                }
                Text(b.headline)
                    .font(.body(19, weight: .bold))
                    .foregroundStyle(.white)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                if let mover = b.oneLineMover, !mover.isEmpty {
                    Text(mover)
                        .font(.body(12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.6))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 4)
    }

    // MARK: - 3. 14-day trend bar chart

    @ViewBuilder
    private func trendSection(_ b: ReadinessBriefSeed) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("14-DAY TREND")
                .font(.body(10.5, weight: .bold))
                .tracking(2)
                .foregroundStyle(Color.white.opacity(0.48))
            TrendBarChart(points: b.scoreTrend)
            HStack {
                Text(formatTrendDate(b.scoreTrend.first?.date))
                    .font(.body(9.5, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(Color.white.opacity(0.42))
                Spacer()
                Text("TODAY")
                    .font(.body(9.5, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(Color.white.opacity(0.42))
            }
            if let note = b.trendNote, !note.isEmpty {
                Text(note)
                    .font(.body(13, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.8))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
        }
        .padding(.top, 26)
    }

    // MARK: - 4. Streaks

    private func streaksSection(_ streaks: [ReadinessStreak]) -> some View {
        VStack(spacing: 10) {
            ForEach(streaks) { s in
                StreakRow(streak: s)
            }
        }
        .padding(.top, 26)
    }

    // MARK: - 5. Pillars + composition

    @ViewBuilder
    private func pillarsSection(_ b: ReadinessBriefSeed) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("WHAT'S DRIVING IT")
                    .font(.body(10.5, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(Color.white.opacity(0.48))
                Spacer()
                Text("WEIGHTED CONTRIBUTION")
                    .font(.body(9.5, weight: .medium))
                    .tracking(0.3)
                    .foregroundStyle(Color.white.opacity(0.34))
            }
            .padding(.bottom, 13)

            VStack(spacing: 2) {
                ForEach(b.pillars) { p in
                    PillarRowView(pillar: p)
                }
            }

            if let comp = b.composition {
                HStack(spacing: 0) {
                    Text("BASELINE \(comp.baseline)")
                        .foregroundStyle(Color.white.opacity(0.6))
                    Text("  ·  ")
                        .foregroundStyle(Color.white.opacity(0.4))
                    Text("NET ")
                        .foregroundStyle(Color.white.opacity(0.6))
                    Text(signed(comp.net))
                        .foregroundStyle(contributionTint(comp.net))
                    Text("  ·  ")
                        .foregroundStyle(Color.white.opacity(0.4))
                    Text("TODAY ")
                        .foregroundStyle(Color.white.opacity(0.6))
                    Text("\(comp.today)")
                        .foregroundStyle(BriefBand.tint(b.band))
                    Spacer(minLength: 0)
                }
                .font(.body(11.5, weight: .extraBold))
                .tracking(0.5)
                .padding(.top, 18)
            }
        }
        .padding(.top, 26)
    }

    // MARK: - 6. Watch tomorrow

    private func watchSection(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("WATCH TOMORROW")
                .font(.body(10.5, weight: .bold))
                .tracking(2)
                .foregroundStyle(Color.white.opacity(0.48))
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.offset) { idx, line in
                    HStack(alignment: .top, spacing: 11) {
                        Circle()
                            .fill(Color(hex: 0xFFCE8A))
                            .frame(width: 5, height: 5)
                            .padding(.top, 7)
                        Text(line)
                            .font(.body(13.5, weight: .regular))
                            .foregroundStyle(Color.white.opacity(0.92))
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 12)
                    if idx != items.count - 1 {
                        Rectangle()
                            .fill(Color.white.opacity(0.07))
                            .frame(height: 1)
                    }
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 5)
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
        }
        .padding(.top, 26)
    }

    // MARK: - load

    private func loadBrief() async {
        await MainActor.run { loadState = .loading }
        do {
            let b = try await API.fetchReadinessBrief()
            await MainActor.run {
                self.brief = b
                self.loadState = .loaded
            }
        } catch {
            await MainActor.run {
                self.loadState = .failed("Couldn't load the brief · pull to retry.")
            }
        }
    }
}

// MARK: - Trend bar chart

private struct TrendBarChart: View {
    let points: [ScoreTrendPoint]

    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(Array(points.enumerated()), id: \.offset) { idx, p in
                    let isToday = idx == points.count - 1
                    let h = barHeight(score: p.score) * geo.size.height
                    let tint = BriefBand.tint(p.band)
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(tint)
                        .frame(height: max(5, h))
                        .opacity(isToday ? 1 : 0.5)
                        .shadow(color: isToday ? tint.opacity(0.45) : .clear, radius: 6)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(height: 96)
    }

    /// score domain clamped 35-95 → bar 14% to 100% of height
    /// (per spec L25-L26 of README).
    private func barHeight(score: Int) -> Double {
        let clamped = max(35.0, min(95.0, Double(score)))
        return 0.14 + ((clamped - 35.0) / 60.0) * 0.86
    }
}

// MARK: - Streak row

private struct StreakRow: View {
    let streak: ReadinessStreak
    @State private var open: Bool = false

    private var isDown: Bool { streak.direction.lowercased() == "below" }
    private var tint: Color { isDown ? Color(hex: 0xFC4D64) : Color(hex: 0x3EBD41) }
    private var fillBg: Color {
        isDown ? Color(hex: 0xFC4D64).opacity(0.12) : Color(hex: 0x3EBD41).opacity(0.12)
    }
    private var border: Color {
        isDown ? Color(hex: 0xFC4D64).opacity(0.3) : Color(hex: 0x3EBD41).opacity(0.28)
    }

    var body: some View {
        Button(action: { withAnimation(.easeInOut(duration: 0.16)) { open.toggle() } }) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 9) {
                    Text(humanPillar(streak.pillar).uppercased())
                        .font(.body(10.5, weight: .extraBold))
                        .tracking(1.2)
                        .foregroundStyle(.white)
                    Text("\(isDown ? "↓" : "↑") \(streak.days) days \(streak.direction)")
                        .font(.body(11, weight: .bold))
                        .foregroundStyle(isDown ? Color(hex: 0xFF9AA8) : Color(hex: 0x8FE6A0))
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.5))
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                Text(streak.short)
                    .font(.body(13.5, weight: .medium))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                if open && streak.meaning != streak.short && !streak.meaning.isEmpty {
                    Rectangle()
                        .fill(Color.white.opacity(0.1))
                        .frame(height: 1)
                        .padding(.top, 2)
                    Text(streak.meaning)
                        .font(.body(12.5, weight: .regular))
                        .foregroundStyle(Color.white.opacity(0.74))
                        .multilineTextAlignment(.leading)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fillBg, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Pillar row (collapsed + expanded)

private struct PillarRowView: View {
    let pillar: ReadinessPillar
    @State private var open: Bool = false

    private var isNoData: Bool { pillar.band.lowercased() == "no-data" }
    private var tint: Color { contributionTint(pillar.weightContribution) }
    private var dotColor: Color { PillarBand.tint(pillar.band) }

    /// 2026-06-02 round 45 · pillar value · just the leading number
    /// chunk ("5.9h") · the qualifier part is moved to the subtitle.
    /// Split on " · " · if the source doesn't carry the separator we
    /// pass the whole string through unchanged.
    private var pillarValueShort: String {
        let v = pillar.observedValue
        guard let dot = v.range(of: " · ") else { return v }
        return String(v[..<dot.lowerBound])
    }

    /// 2026-06-02 round 45 · subtitle · trailing qualifier from
    /// observedValue joined with the baseline copy. Examples:
    ///   "7-night avg · target 8.0h"  (had qualifier + baseline)
    ///   "target 8.0h"                (baseline only)
    ///   "7-night avg"                (qualifier only · no baseline)
    private var pillarBaselineCombined: String {
        let v = pillar.observedValue
        let baseline = pillar.baseline
        guard let dot = v.range(of: " · ") else { return baseline }
        let trailing = String(v[dot.upperBound...])
        if baseline.isEmpty { return trailing }
        return "\(trailing) · \(baseline)"
    }

    var body: some View {
        VStack(spacing: 0) {
            Button(action: { if !isNoData { withAnimation(.easeInOut(duration: 0.16)) { open.toggle() } } }) {
                HStack(spacing: 11) {
                    Circle()
                        .fill(dotColor)
                        .frame(width: 8, height: 8)
                    Text(pillar.label)
                        .font(.body(11, weight: .extraBold))
                        .tracking(0.4)
                        .foregroundStyle(Color.white.opacity(isNoData ? 0.5 : 0.82))
                        .frame(width: 44, alignment: .leading)

                    contributionBar
                        .frame(height: 8)
                        .frame(maxWidth: .infinity)

                    VStack(alignment: .trailing, spacing: 1) {
                        // 2026-06-02 round 45 · "5.9h · 7-night avg" used
                        // to overflow the 96pt column and truncate to
                        // "5.9h · 7-nigh...". Split on " · " so the
                        // value line stays compact ("5.9h") and the
                        // qualifier rolls into the subtitle alongside
                        // the baseline copy.
                        Text(isNoData ? "·" : pillarValueShort)
                            .font(.body(12.5, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Text(pillarBaselineCombined)
                            .font(.body(9.5, weight: .regular))
                            .foregroundStyle(Color.white.opacity(0.5))
                            .lineLimit(1)
                    }
                    .frame(width: 96, alignment: .trailing)

                    Text(isNoData ? "—" : signed(pillar.weightContribution))
                        .font(.body(12.5, weight: .extraBold))
                        .foregroundStyle(isNoData ? Color.white.opacity(0.3) : tint)
                        .frame(width: 28, alignment: .trailing)

                    if !isNoData {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.white.opacity(0.6))
                            .rotationEffect(.degrees(open ? 180 : 0))
                    }
                }
                .padding(.vertical, 13)
                .padding(.horizontal, 12)
                .opacity(isNoData ? 0.56 : 1)
            }
            .buttonStyle(.plain)
            .disabled(isNoData)

            if open && !isNoData {
                expandedDetail
                    .padding(.horizontal, 14)
                    .padding(.bottom, 18)
            }
        }
        .background(open ? Color.white.opacity(0.05) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    @ViewBuilder
    private var contributionBar: some View {
        GeometryReader { geo in
            ZStack {
                Capsule()
                    .fill(Color.white.opacity(0.12))
                Rectangle()
                    .fill(Color.white.opacity(0.3))
                    .frame(width: 1, height: 12)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)

                if !isNoData {
                    let pts = abs(pillar.weightContribution)
                    let widthPct = min(46.0, Double(pts) * 3.2 + 4) / 100.0
                    let half = geo.size.width / 2
                    let fillW = max(8, half * CGFloat(widthPct * 2))   // bar can extend up to ~46% of full width
                    let xPos = pillar.weightContribution >= 0
                        ? half + fillW / 2
                        : half - fillW / 2
                    Capsule()
                        .fill(tint)
                        .frame(width: fillW, height: 8)
                        .position(x: xPos, y: geo.size.height / 2)
                }
            }
        }
    }

    private var expandedDetail: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !pillar.meaning.isEmpty {
                Text(pillar.meaning)
                    .font(.body(13.5, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            pillarHistory
            confounderList
        }
    }

    @ViewBuilder
    private var pillarHistory: some View {
        if !pillar.trend.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("14-DAY HISTORY")
                        .font(.body(9.5, weight: .extraBold))
                        .tracking(1)
                        .foregroundStyle(Color.white.opacity(0.42))
                    Spacer()
                    Text("TODAY · ")
                        .font(.body(9.5, weight: .extraBold))
                        .tracking(1)
                        .foregroundStyle(Color.white.opacity(0.42))
                    + Text(pillar.observedValue)
                        .font(.body(9.5, weight: .extraBold))
                        .tracking(1)
                        .foregroundStyle(.white)
                }
                PillarHistoryBars(points: pillar.trend, tint: dotColor)
                HStack {
                    Text("14 DAYS AGO")
                        .font(.body(9, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.38))
                    Spacer()
                    Text("TODAY")
                        .font(.body(9, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.38))
                }
            }
        }
    }

    @ViewBuilder
    private var confounderList: some View {
        let likely = pillar.confounders.filter { $0.likely }
        let other  = pillar.confounders.filter { !$0.likely }
        if !likely.isEmpty || !other.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                if !likely.isEmpty {
                    confounderGroup(label: "MOST LIKELY BEHIND IT", items: likely, accent: Color(hex: 0xFFCE8A))
                }
                if !other.isEmpty {
                    confounderGroup(label: "ALSO WORTH CHECKING", items: other, accent: Color.white.opacity(0.78))
                }
            }
        }
    }

    private func confounderGroup(label: String, items: [ReadinessConfounder], accent: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.body(9.5, weight: .extraBold))
                .tracking(1)
                .foregroundStyle(Color.white.opacity(0.42))
            VStack(alignment: .leading, spacing: 5) {
                ForEach(items) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Text(item.pillar)
                            .font(.body(12.5, weight: .bold))
                            .foregroundStyle(accent)
                            .frame(width: 66, alignment: .leading)
                        Text(item.explanation)
                            .font(.body(12.5, weight: .regular))
                            .foregroundStyle(Color.white.opacity(0.84))
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

// MARK: - Pillar history bars

private struct PillarHistoryBars: View {
    let points: [PillarTrendPoint]
    let tint: Color

    var body: some View {
        GeometryReader { geo in
            let values = points.map { $0.value }
            let lo = values.min() ?? 0
            let hi = values.max() ?? 1
            let pad = max((hi - lo) * 0.25, 0.001)
            let mn = lo - pad
            let mx = hi + pad
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(Array(points.enumerated()), id: \.offset) { idx, p in
                    let isToday = idx == points.count - 1
                    let frac = (p.value - mn) / (mx - mn)
                    let h = max(3, CGFloat(frac) * geo.size.height)
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(isToday ? tint : Color.white.opacity(0.16))
                        .frame(height: h)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(height: 44)
    }
}

// MARK: - Cold start (band='no-data')

private struct BriefColdStartView: View {
    let brief: ReadinessBriefSeed
    let cold: ColdStart

    var body: some View {
        VStack(alignment: .center, spacing: 16) {
            Spacer().frame(height: 24)
            ProgressRing(progress: progress)
                .frame(width: 118, height: 118)
                .overlay(
                    VStack(spacing: 6) {
                        Text("\(cold.nightsLogged)")
                            .font(.display(36, weight: .semibold))
                            .foregroundStyle(.white)
                        Text("of \(cold.nightsNeeded)")
                            .font(.body(11, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.5))
                    }
                )
            Text("Building your baseline.")
                .font(.body(23, weight: .bold))
                .foregroundStyle(.white)
                .padding(.top, 12)
            let body = combinedNote
            if !body.isEmpty {
                Text(body)
                    .font(.body(13.5, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.78))
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 6)
            }
            Text("\(max(0, cold.nightsNeeded - cold.nightsLogged)) MORE NIGHTS TO YOUR FIRST SCORE")
                .font(.body(10, weight: .extraBold))
                .tracking(1)
                .foregroundStyle(Color.white.opacity(0.5))
                .padding(.top, 8)
            if !cold.healthConnected {
                HStack(spacing: 7) {
                    Text("Connect Apple Health to skip the wait")
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.82))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.82))
                }
                .padding(.top, 14)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var progress: Double {
        guard cold.nightsNeeded > 0 else { return 0 }
        return min(1.0, Double(cold.nightsLogged) / Double(cold.nightsNeeded))
    }

    private var combinedNote: String {
        let a = brief.headline.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = cold.note.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return b }
        if b.isEmpty { return a }
        return "\(a) \(b)"
    }
}

// MARK: - Progress ring atom

private struct ProgressRing: View {
    let progress: Double
    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.14), lineWidth: 7)
            Circle()
                .trim(from: 0, to: max(0, min(1, progress)))
                .stroke(Color(hex: 0xCFD6DC),
                        style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.6), value: progress)
        }
    }
}

// MARK: - Rounded-top corner shape

private struct RoundedCornerShape: Shape {
    var radius: CGFloat
    var corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        let p = UIBezierPath(roundedRect: rect, byRoundingCorners: corners,
                             cornerRadii: CGSize(width: radius, height: radius))
        return Path(p.cgPath)
    }
}

// MARK: - helpers

private func formatTrendDate(_ iso: String?) -> String {
    guard let iso, !iso.isEmpty else { return "" }
    let parts = iso.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return iso.uppercased() }
    let mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
    let mi = parts[1] - 1
    guard mi >= 0 && mi < 12 else { return iso.uppercased() }
    return "\(mon[mi]) \(parts[2])"
}
