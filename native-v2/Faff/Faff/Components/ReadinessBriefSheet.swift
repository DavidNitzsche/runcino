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
//    3. 2×2 signal tiles (SLEEP / RECOVERY / RESTING HR / TRAINING LOAD)
//       tap → 7-night mini sparkline
//    4. TODAY'S RUN · action + why from BriefPrescription (when present)
//
//  Cold-start variant (band='no-data'): replaces the body with the
//  baseline-building progress ring + connect HK CTA.
//
//  Doctrine: dark-first · text always solid white · no prescription ·
//  state both numbers (no derived deltas) · no em dashes.
//

import SwiftUI

// MARK: - Color tokens (per the README spec)

// Both band maps now route to the ONE canonical map (Theme.ReadinessBand).
// The canonical `from()` already absorbs the design's {good/ok/watch/low}
// aliases, so older envelopes still resolve.
private enum BriefBand {
    static func tint(_ raw: String) -> Color {
        // "pull_back" underscore variant → canonical handles "pull-back".
        Theme.ReadinessBand.fill(raw.replacingOccurrences(of: "_", with: "-"))
    }
}

private enum PillarBand {
    /// Tint for the pillar dot + today's history bar.
    static func tint(_ raw: String) -> Color {
        Theme.ReadinessBand.fill(raw.replacingOccurrences(of: "_", with: "-"))
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
                .foregroundStyle(Theme.warnText)
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
            if let cold = b.coldStart {
                BriefColdStartView(brief: b, cold: cold)
            } else {
                if let o = b.subjectiveOverride { subjectiveOverrideCard(o) }
                heroBlock(b)
                sectionDivider.padding(.top, 22)
                signalsGrid(b)
                if let rx = b.prescription, !rx.action.isEmpty {
                    sectionDivider.padding(.top, 22)
                    todaysRunSection(rx)
                }
            }
        }
    }

    private var sectionDivider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.09))
            .frame(height: 1)
    }

    // MARK: - 1. Subjective override

    private func subjectiveOverrideCard(_ o: SubjectiveOverride) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 8) {
                Circle()
                    .fill(Color(hex: 0xF3AD38))
                    .frame(width: 8, height: 8)
                Text("SUBJECTIVE OVERRIDE")
                    .font(.body(10, weight: .extraBold))
                    .tracking(1.4)
                    .foregroundStyle(Color(hex: 0xF3AD38))
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

    // MARK: - 3. 2×2 signals grid

    private func signalsGrid(_ b: ReadinessBriefSeed) -> some View {
        let tiles = b.pillars.filter { $0.key != "hr_recovery" }
        return LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
            alignment: .leading,
            spacing: 12
        ) {
            ForEach(tiles) { p in
                SignalTile(pillar: p)
            }
        }
        .padding(.top, 16)
    }

    // MARK: - 4. Today's run prescription

    private func todaysRunSection(_ rx: BriefPrescription) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TODAY'S RUN")
                .font(.body(10.5, weight: .bold))
                .tracking(2)
                .foregroundStyle(Color.white.opacity(0.48))
            Text(rx.action)
                .font(.body(17, weight: .bold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            if !rx.why.isEmpty {
                Text(rx.why)
                    .font(.body(13.5, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.72))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 16)
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

// MARK: - Signal tile (2×2 grid card)

private struct SignalTile: View {
    let pillar: ReadinessPillar
    @State private var showHistory: Bool = false

    private var tint: Color { PillarBand.tint(pillar.band) }
    private var isNoData: Bool { pillar.band.lowercased().contains("no-data") || pillar.band.isEmpty }

    /// Leading chunk before " · " — the compact value shown big.
    private var displayValue: String {
        let v = pillar.observedValue
        guard let dot = v.range(of: " · ") else { return v }
        return String(v[..<dot.lowerBound])
    }

    /// Trailing qualifier after " · " — shown small below the value.
    private var displaySub: String {
        let v = pillar.observedValue
        guard let dot = v.range(of: " · ") else { return pillar.observedSub }
        let trailing = String(v[dot.upperBound...])
        return trailing.isEmpty ? pillar.observedSub : trailing
    }

    /// True when the value is a word (no digit) — use smaller font.
    private var valueIsWord: Bool {
        displayValue.first.map { !$0.isNumber } ?? false
    }

    var body: some View {
        Button(action: {
            if !pillar.trend.isEmpty {
                withAnimation(.easeInOut(duration: 0.18)) { showHistory.toggle() }
            }
        }) {
            VStack(alignment: .leading, spacing: 0) {
                // Label row
                HStack(spacing: 5) {
                    Circle()
                        .fill(tint)
                        .frame(width: 6, height: 6)
                    Text(pillar.label)
                        .font(.body(8, weight: .extraBold))
                        .tracking(1.2)
                        .foregroundStyle(tint)
                    Spacer(minLength: 0)
                }

                // Big value
                Text(isNoData ? "—" : displayValue)
                    .font(.body(valueIsWord ? 14 : 20, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .padding(.top, 8)

                // Sub label
                if !displaySub.isEmpty && !isNoData {
                    Text(displaySub)
                        .font(.body(9, weight: .regular))
                        .foregroundStyle(Color.white.opacity(0.5))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .padding(.top, 2)
                }

                // Meaning description
                if !pillar.meaning.isEmpty {
                    Text(pillar.meaning)
                        .font(.body(10, weight: .regular))
                        .foregroundStyle(Color.white.opacity(0.56))
                        .lineSpacing(1.5)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 7)
                }

                // 7-day mini sparkline (tap reveal)
                if showHistory && !pillar.trend.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Rectangle()
                            .fill(Color.white.opacity(0.1))
                            .frame(height: 1)
                            .padding(.top, 9)
                        PillarHistoryBars(points: pillar.trend, tint: tint)
                        HStack {
                            Text("7 NIGHTS AGO")
                                .font(.body(7.5, weight: .bold))
                                .foregroundStyle(Color.white.opacity(0.36))
                            Spacer()
                            Text("LAST NIGHT")
                                .font(.body(7.5, weight: .bold))
                                .foregroundStyle(Color.white.opacity(0.36))
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color.white.opacity(showHistory ? 0.08 : 0.05),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(tint.opacity(isNoData ? 0.1 : 0.22), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
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

