//
//  D_Disclosure.swift
//  Family D · Disclosure & education.
//
//  Components: WorkoutWhyCard · FormMetricsGrid · WatchPreviewTimeline ·
//              ArticleIndexCard.
//
//  FormMetricsGrid is the "render what you already decode" win · all 8
//  metrics live on RunDetail.form on-device; nothing renders them today.
//

import SwiftUI

// MARK: - WorkoutWhyCard
//
// Collapsible "WHY" at the foot of Day Detail. Tap reuses the Learn
// reader; the RACE REHEARSAL eyebrow is the same card pattern with a
// fueling note.

struct WorkoutWhyCard: View {
    let title: String
    let text: String            // renamed from `body` to avoid clashing with SwiftUI's `var body`
    let source: String?         // "Daniels Table 4 · Research/04 §threshold"
    let learnSlug: String?      // deep link via FaffRoute.learn(slug:)
    @State private var open: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(Theme.Motion.smooth) { open.toggle() } } label: {
                HStack {
                    Text(title)
                        .font(.body(13, weight: .extraBold))
                        .tracking(0.4)
                        .foregroundStyle(Theme.txt)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.mute)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            if open {
                Divider().background(Color.white.opacity(0.06))
                VStack(alignment: .leading, spacing: 10) {
                    Text(text)
                        .font(.body(13, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.92))
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let s = source, !s.isEmpty {
                        Text(s)
                            .font(.body(10.5, weight: .extraBold))
                            .tracking(1)
                            .foregroundStyle(Theme.Accent.amberBright)
                    }
                    if let slug = learnSlug, !slug.isEmpty {
                        NavigationLink(value: FaffRoute.learn(slug: slug)) {
                            HStack(spacing: 4) {
                                Text("Read the article")
                                    .font(.body(12, weight: .extraBold))
                                    .foregroundStyle(Theme.dist)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(Theme.dist)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }
}

// MARK: - FormMetricsGrid
//
// A FORM section on Run Detail. Each cell colored by band; tap reveals
// the drill from the tips library. Pairs the form-metrics-decoded +
// form-tips-library coverage rows into one surface.
//
// Bands come from /api/tips · "good" / "watch" / "flag" / "elite".

enum FormMetricBand: String {
    case elite, good, watch, flag, none

    var color: Color {
        switch self {
        case .elite: return Theme.green
        case .good:  return Theme.green
        case .watch: return Theme.goal
        case .flag:  return Theme.over
        case .none:  return Theme.mute
        }
    }
}

struct FormMetricCell: Identifiable {
    let key: String        // tips library slug · "cadence", "ground_contact_ms"
    let label: String
    let value: String
    let unit: String
    let band: FormMetricBand
    var id: String { key }
}

struct FormMetricsGrid: View {
    let cells: [FormMetricCell]?     // nil → loading; empty → "no form data"
    var onTap: (FormMetricCell) -> Void = { _ in }

    private let cols = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        if let cs = cells {
            if cs.isEmpty {
                emptyState
            } else {
                LazyVGrid(columns: cols, spacing: 10) {
                    ForEach(cs) { c in
                        Button { onTap(c) } label: { cell(c) }
                            .buttonStyle(.plain)
                    }
                }
            }
        } else {
            LazyVGrid(columns: cols, spacing: 10) {
                ForEach(0..<8, id: \.self) { _ in skeletonCell }
            }
        }
    }

    private func cell(_ c: FormMetricCell) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(c.value)
                    .font(.display(20, weight: .bold)).monospacedDigit()
                    .foregroundStyle(Theme.txt)
                Text(c.unit)
                    .font(.body(10, weight: .semibold))
                    .foregroundStyle(Theme.mute)
            }
            Text(c.label.uppercased())
                .font(.body(9, weight: .extraBold))
                .tracking(1.5)
                .foregroundStyle(Theme.mute)
            // 2-px band swatch underlines the value
            Rectangle().fill(c.band.color).frame(height: 2).cornerRadius(1)
                .padding(.top, 4)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private var skeletonCell: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08)).frame(width: 60, height: 18)
            RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08)).frame(width: 80, height: 10)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
    }

    private var emptyState: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(Theme.mute)
            Text("No form data on this run. Cadence + contact metrics come from a watch or Stryd-style pod.")
                .font(.body(12.5, weight: .medium))
                .foregroundStyle(Theme.mute)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }
}

// MARK: - WatchPreviewTimeline
//
// One row per phase with the haptic icon + target + duration. Builds
// confidence the watch matches the plan.

struct WatchPhasePreview: Identifiable {
    let index: Int
    let name: String        // "Warm up", "Tempo block ×3"
    let hapticNote: String  // "1 buzz · ease in"
    let pace: String?       // "8:40"
    let duration: String    // "12 min"
    var id: Int { index }
}

struct WatchPreviewTimeline: View {
    let phases: [WatchPhasePreview]?    // nil → loading

    var body: some View {
        if let ps = phases {
            if ps.isEmpty {
                Text("No watch preview · workout has no phases.")
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(ps.enumerated()), id: \.element.id) { idx, p in
                        phaseRow(p)
                        if idx < ps.count - 1 { Divider().background(Color.white.opacity(0.06)).padding(.leading, 50) }
                    }
                }
                .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
            }
        } else {
            VStack(spacing: 0) {
                ForEach(0..<3, id: \.self) { _ in
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 9).fill(Color.white.opacity(0.08)).frame(width: 30, height: 30)
                        RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08)).frame(maxWidth: .infinity).frame(height: 12)
                    }
                    .padding(14)
                }
            }
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        }
    }

    private func phaseRow(_ p: WatchPhasePreview) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: hapticIcon(for: p))
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.Accent.amberBright)
                .frame(width: 30, height: 30)
                .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name)
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                Text(p.hapticNote)
                    .font(.body(11, weight: .medium))
                    .foregroundStyle(Theme.mute)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                if let pace = p.pace {
                    Text(pace).font(.body(13, weight: .bold)).monospacedDigit().foregroundStyle(Theme.txt)
                }
                Text(p.duration).font(.body(10, weight: .semibold)).foregroundStyle(Theme.mute)
            }
        }
        .padding(14)
    }

    private func hapticIcon(for p: WatchPhasePreview) -> String {
        // Map by name keyword · keeps the model simple, no extra haptic enum.
        let n = p.name.lowercased()
        if n.contains("warm") { return "sun.haze" }
        if n.contains("tempo") || n.contains("interval") { return "bolt.fill" }
        if n.contains("recovery") || n.contains("float") { return "circle" }
        if n.contains("cool") { return "checkmark" }
        return "circle"
    }
}

// MARK: - ArticleIndexCard
//
// Grid card for the /learn index, grouped by eyebrow. iOS already ships the
// reader; this is the browse layer for all 45 articles. Tap → push the
// existing LearnArticleSheet route.

struct ArticleIndexCard: View {
    let slug: String
    let eyebrow: String           // "System doctrine"
    let title: String             // "The effort temperature scale"
    let excerpt: String           // first line of body_md

    var body: some View {
        NavigationLink(value: FaffRoute.learn(slug: slug)) {
            VStack(alignment: .leading, spacing: 6) {
                Text(eyebrow.uppercased())
                    .font(.body(9, weight: .extraBold))
                    .tracking(1.5)
                    .foregroundStyle(Theme.Accent.mintReady)
                Text(title)
                    .font(.body(15, weight: .extraBold))
                    .foregroundStyle(Theme.txt)
                    .fixedSize(horizontal: false, vertical: true)
                Text(excerpt)
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Theme.mute)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct ArticleIndexCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08)).frame(width: 60, height: 10)
            RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08)).frame(width: 160, height: 16)
            RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08)).frame(maxWidth: .infinity).frame(height: 12)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
    }
}
