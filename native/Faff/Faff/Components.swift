//
//  Components.swift
//  Faff
//
//  The reusable v4 pieces from docs/design/handoff/components.md, built
//  once and shared across screens. Literal values trace to
//  docs/design/faff-app.html (390 pt). Tokens come from Theme.swift.
//

import SwiftUI

// MARK: - Tabs

enum FaffTab: String, CaseIterable {
    case today, plan, coach, health, races
    var title: String {
        switch self {
        case .today: return "Today"; case .plan: return "Plan"
        case .coach: return "Coach"; case .health: return "Health"
        case .races: return "Races"
        }
    }
    func icon(active: Bool) -> String {
        switch self {
        case .today:  return active ? "house.fill" : "house"
        case .plan:   return "calendar"
        case .coach:  return "questionmark.circle"
        case .health: return "waveform.path.ecg"
        case .races:  return "flag.checkered"
        }
    }
}

/// Bottom tab bar — 5 items, active = race orange (components.md §5).
struct FaffTabBar: View {
    let active: FaffTab
    var onSelect: (FaffTab) -> Void = { _ in }
    var body: some View {
        HStack(spacing: 0) {
            ForEach(FaffTab.allCases, id: \.self) { t in
                Button { onSelect(t) } label: {
                    VStack(spacing: 4) {
                        Image(systemName: t.icon(active: t == active)).font(.system(size: 18))
                        Text(t.title).font(Faff.F.inter(9.5, .semibold))
                    }
                    .foregroundStyle(t == active ? Faff.C.race : Faff.C.textDim)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 10)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity)
        .background(Faff.C.bg)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .top)
    }
}

// MARK: - Sheet chrome (grab handle + close) — every sheet must be exitable

struct SheetCloseButton: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Faff.C.textMuted)
                .frame(width: 30, height: 30)
                .background(Faff.C.pillBg)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

struct SheetGrabHandle: View {
    var body: some View {
        Capsule().fill(Faff.C.textFaint).frame(width: 38, height: 5)
            .frame(maxWidth: .infinity).padding(.top, 8)
    }
}

// MARK: - Avatar / race chip / sticky top bar

struct FaffAvatar: View {
    var initial: String
    var size: CGFloat = 28
    var body: some View {
        Circle().fill(Color.faffMark)
            .frame(width: size, height: size)
            .overlay(Text(initial).font(Faff.F.oswald(size * 0.5, .semibold)).foregroundStyle(.white))
    }
}

struct RaceChip: View {
    let name: String
    let daysOut: Int
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "flag.checkered").font(.system(size: 10, weight: .bold))
            Text(name).font(Faff.F.inter(12, .bold))
            Text("· \(daysOut)d").font(Faff.F.inter(12, .semibold)).foregroundStyle(Faff.C.race.opacity(0.7))
        }
        .foregroundStyle(Faff.C.race)
        .padding(.horizontal, 11).padding(.vertical, 6)
        .background(Faff.C.orangeWash)
        .clipShape(RoundedRectangle(cornerRadius: Faff.R.chipSm, style: .continuous))
    }
}

/// Sticky brand + race chip + avatar bar above every tab (components.md §2).
struct StickyTopBar: View {
    var raceName: String?
    var raceDaysOut: Int?
    var avatarInitial: String
    var onRaceTap: () -> Void = {}
    var onAvatarTap: () -> Void = {}
    var body: some View {
        HStack(spacing: 10) {
            Text("FAFF").font(Faff.F.display(22)).italic().tracking(1.5)
                .foregroundStyle(Color.faffMark)
            Spacer()
            if let raceName, let raceDaysOut {
                Button(action: onRaceTap) { RaceChip(name: raceName, daysOut: raceDaysOut) }
                    .buttonStyle(.plain)
            }
            Button(action: onAvatarTap) { FaffAvatar(initial: avatarInitial) }
                .buttonStyle(.plain)
        }
        .padding(.horizontal, 16).padding(.top, 5).padding(.bottom, 6)
        .background(.ultraThinMaterial)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Faff.C.divider), alignment: .bottom)
    }
}

// MARK: - Badge (tone-based, on-wash text via amberInk)

struct Badge: View {
    enum Tone { case green, amber, orange, grey, warn }
    let text: String
    var tone: Tone = .grey
    private var fg: Color {
        switch tone {
        case .green: return Faff.C.recovery
        case .amber: return Faff.C.amberInk
        case .orange: return .white
        case .grey: return Faff.C.textDim
        case .warn: return Faff.C.warn
        }
    }
    private var bg: Color {
        switch tone {
        case .green: return Faff.C.greenWash
        case .amber: return Faff.C.amberWash
        case .orange: return Faff.C.race
        case .grey: return Faff.C.pillBg
        case .warn: return Faff.C.warn.opacity(0.12)
        }
    }
    var body: some View {
        Text(text.uppercased())
            .font(Faff.F.inter(9.5, .bold)).tracking(0.6)
            .padding(.horizontal, 8).padding(.vertical, 3.5)
            .foregroundStyle(fg).background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Faff.R.chip, style: .continuous))
    }
}

// MARK: - Stat pill

struct StatPill: View {
    let value: String
    var unit: String? = nil
    let label: String
    var accent: Bool = false        // orange value (pace)
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(Faff.F.display(27))
                    .foregroundStyle(accent ? Faff.C.race : Faff.C.ink)
                    .lineLimit(1).minimumScaleFactor(0.5)
                if let unit { Text(unit).font(Faff.F.inter(11, .medium)).foregroundStyle(Faff.C.textMuted) }
            }
            Text(label.uppercased()).font(Faff.F.inter(9, .semibold)).tracking(0.9)
                .foregroundStyle(Faff.C.textDim).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 11)
        .background(Faff.C.pillBg)
        .overlay(RoundedRectangle(cornerRadius: Faff.R.pill).stroke(Faff.C.pillLine, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Faff.R.pill, style: .continuous))
    }
}

// MARK: - Buttons

struct PrimaryButton: View {
    let title: String
    var icon: String? = "play.fill"
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let icon { Image(systemName: icon).font(.system(size: 11, weight: .bold)) }
                Text(title.uppercased()).font(Faff.F.oswald(13, .semibold)).tracking(1.4)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 13)
            .foregroundStyle(.white).background(Faff.C.ink)
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct GhostButton: View {
    let title: String
    var icon: String? = nil
    var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: 10, weight: .bold)) }
                Text(title.uppercased()).font(Faff.F.oswald(11.5, .semibold)).tracking(1.2)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 11)
            .foregroundStyle(Faff.C.ink)
            .background(Faff.C.surface)
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(Faff.C.pillLine, lineWidth: 1.5))
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Why chip (Today hero)

struct WhyChip: View {
    var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: "questionmark.circle").font(.system(size: 11))
                Text("Why this").font(Faff.F.oswald(10, .semibold)).tracking(1)
            }
            .foregroundStyle(Faff.C.textMuted)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Faff.C.pillBg)
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Faff.C.pillLine, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Readiness ring (270° arc)

struct ReadinessRing: View {
    /// 0…100, or nil for the dashed empty state.
    var score: Int?
    var tone: Color = Faff.C.recovery
    var size: CGFloat = 54
    private let span = 0.75   // 270° of the circle
    var body: some View {
        ZStack {
            Circle()
                .trim(from: 0, to: span)
                .stroke(Faff.C.track, style: StrokeStyle(lineWidth: size * 0.13, lineCap: .round,
                                                         dash: score == nil ? [3, 4] : []))
                .rotationEffect(.degrees(135))
            if let score {
                Circle()
                    .trim(from: 0, to: span * CGFloat(min(max(score, 0), 100)) / 100)
                    .stroke(tone, style: StrokeStyle(lineWidth: size * 0.13, lineCap: .round))
                    .rotationEffect(.degrees(135))
                Text("\(score)").font(Faff.F.display(size * 0.46)).foregroundStyle(Faff.C.ink)
            } else {
                Text("—").font(Faff.F.display(size * 0.42)).foregroundStyle(Faff.C.textFaint)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Coach verdict block (3pt left border)

struct CoachVerdict: View {
    let label: String
    let body_: String
    var color: Color = Faff.C.recovery
    init(_ label: String, _ body: String, color: Color = Faff.C.recovery) {
        self.label = label; self.body_ = body; self.color = color
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(Faff.F.inter(9.5, .bold)).tracking(1.1).foregroundStyle(color)
            Text(body_).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 12)
        .overlay(Rectangle().frame(width: 3).foregroundStyle(color), alignment: .leading)
    }
}

// MARK: - Signal row (Coach / Why-this)

struct SignalRow: View {
    let badge: String
    var tone: Badge.Tone = .green
    let body_: String
    init(_ badge: String, tone: Badge.Tone = .green, _ body: String) {
        self.badge = badge; self.tone = tone; self.body_ = body
    }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Badge(text: badge, tone: tone)
            Text(body_).font(Faff.F.inter(12)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Metric tile (Health dashboard)

struct MetricTile: View {
    let label: String
    var value: String           // "—" when no data
    var unit: String? = nil
    var delta: String? = nil    // "↑ 6 · 7d" / "No data"
    enum DeltaTone { case good, watch, flat }
    var deltaTone: DeltaTone = .flat
    var onTap: (() -> Void)? = nil
    private var dColor: Color {
        switch deltaTone { case .good: return Faff.C.recovery; case .watch: return Faff.C.amberInk; case .flat: return Faff.C.textDim }
    }
    var body: some View {
        let content = VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(Faff.F.inter(8.5, .semibold)).tracking(0.6)
                .foregroundStyle(Faff.C.textDim).lineLimit(1).minimumScaleFactor(0.7)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(Faff.F.display(26)).foregroundStyle(Faff.C.ink)
                    .lineLimit(1).minimumScaleFactor(0.5)
                if let unit { Text(unit).font(Faff.F.inter(8.5, .medium)).foregroundStyle(Faff.C.textMuted) }
            }
            Text(delta ?? " ").font(Faff.F.inter(8.5, .bold)).foregroundStyle(dColor).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Faff.S.tilePadding)
        .background(Faff.C.surface)
        .clipShape(RoundedRectangle(cornerRadius: Faff.R.tile, style: .continuous))
        .shadow(color: .black.opacity(0.05), radius: 1, x: 0, y: 1)
        if let onTap {
            Button(action: onTap) { content }.buttonStyle(.plain)
        } else { content }
    }
}

/// 3-column metric grid.
struct MetricGrid<T: Identifiable, Cell: View>: View {
    let items: [T]
    @ViewBuilder let cell: (T) -> Cell
    private let cols = [GridItem(.flexible(), spacing: Faff.S.tileGap),
                        GridItem(.flexible(), spacing: Faff.S.tileGap),
                        GridItem(.flexible(), spacing: Faff.S.tileGap)]
    var body: some View {
        LazyVGrid(columns: cols, spacing: Faff.S.tileGap) {
            ForEach(items) { cell($0) }
        }
    }
}

// MARK: - Structure row (Workout detail)

struct StructureRow: View {
    let name: String
    let sub: String
    let distance: String
    var work: Bool = false
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(work ? Faff.C.recovery : Faff.C.ink.opacity(0.14))
                .frame(width: 4, height: 38)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(Faff.F.inter(15.5, .bold)).foregroundStyle(work ? Faff.C.recovery : Faff.C.ink)
                Text(sub).font(Faff.F.inter(11.5)).foregroundStyle(Faff.C.textDim)
            }
            Spacer()
            Text(distance).font(Faff.F.display(27)).foregroundStyle(Faff.C.ink)
        }
        .padding(.vertical, 7)
    }
}

// MARK: - Strength mark ("S" badge for days with a strength session)

struct StrengthMark: View {
    var size: CGFloat = 18
    var body: some View {
        Text("S")
            .font(Faff.F.inter(size * 0.56, .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(Faff.C.ink))
            .accessibilityLabel("Strength session")
    }
}

// MARK: - Segmented control (Metric detail range)

struct Segmented: View {
    let options: [String]
    var selected: String
    var onSelect: (String) -> Void = { _ in }
    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { o in
                Button { onSelect(o) } label: {
                    Text(o).font(Faff.F.inter(11, .semibold))
                        .foregroundStyle(o == selected ? Faff.C.ink : Faff.C.textMuted)
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                        .background(o == selected ? Faff.C.surface : .clear,
                                    in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .shadow(color: o == selected ? .black.opacity(0.06) : .clear, radius: 2, y: 1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Faff.C.pillBg)
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Faff.C.pillLine, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

// MARK: - Progress bar

struct FaffProgressBar: View {
    var fraction: Double          // 0…1
    var tint: Color = Faff.C.recovery
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Faff.C.track).frame(height: 6)
                Capsule().fill(tint).frame(width: geo.size.width * max(0, min(1, fraction)), height: 6)
            }
        }
        .frame(height: 6)
    }
}

// MARK: - Page scaffold (eyebrow + big title) under the sticky bar

struct FaffScreen<Content: View>: View {
    let eyebrow: String
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(eyebrow.uppercased()).font(Faff.F.inter(10, .semibold)).tracking(2)
                        .foregroundStyle(Faff.C.textDim)
                    Text(title.uppercased()).font(Faff.F.display(40))
                        .foregroundStyle(Faff.C.ink)
                }
                content
            }
            .padding(.horizontal, Faff.S.pageEdge)
            .padding(.top, Faff.S.scrollTop)
            .padding(.bottom, Faff.S.scrollBottom)
        }
        .background(Faff.C.bg)
    }
}
