//
//  FaceKit.swift
//  FaffWatch
//
//  The locked face primitive system (recipe-driven number-stack layout) — the
//  approved redesign that REPLACES the old WatchFaces face structs.
//
//  Verified against the HTML mock by pixel measurement on the rep-work face:
//    · topF = 0.050, gapRatio = 0.15, capRatio = 0.73 (HelveticaNeue-Bold)
//    · cropK = 0.22 (line-box → glyph), leadF = 0.045 left inset
//    · clockClearF = 0.72 (top row width-capped so it never collides with the OS clock)
//
//  The grammar this enforces is the locked one — see MIGRATION_PLAN.md:
//      🟢 live = on target   ⚪ neutral = reference / readout
//      🔴 over = alert        🔵 blue = distance, always
//      🟠 goal = act now      🟦 rest = recovery / chrome
//      🟣 bonus = past plan
//

import SwiftUI

// MARK: - Faff palette (canonical tokens — single source of truth)

extension Color {
    init(hex: UInt32) {
        self.init(
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue:  Double(hex & 0xFF) / 255
        )
    }
}

enum Faff {
    static let live  = Color(hex: 0x3EBD41) // Success — on-pace / governed
    static let goal  = Color(hex: 0xF3AD38) // Attention — target / "act now" (fuel)
    static let dist  = Color(hex: 0x27B4E0) // Light Blue — DISTANCE, always
    static let over  = Color(hex: 0xFC4D64) // Warning — off / behind / over ceiling
    static let rest  = Color(hex: 0x008FEC) // Corporate blue — recovery / landmark chrome
    static let ink   = Color(hex: 0xF6F7F8) // neutral readout (white)
    static let mute  = Color(hex: 0x8A90A0)
    static let dim   = Color(hex: 0x646464)
    static let brand = Color(hex: 0x008FEC)
    static let bonus = Color(hex: 0xA78BFA) // purple — distance gone past the plan (counts up)
}

// MARK: - A number's role decides its colour

enum Role {
    case live, goal, dist, neutral, over, rest, dim, mute, bonus
    var color: Color {
        switch self {
        case .live:    return Faff.live
        case .goal:    return Faff.goal
        case .dist:    return Faff.dist
        case .neutral: return Faff.ink
        case .over:    return Faff.over
        case .rest:    return Faff.rest
        case .dim:     return Faff.dim
        case .mute:    return Faff.mute
        case .bonus:   return Faff.bonus
        }
    }
}

struct NumRow {
    let text: String
    let role: Role
    let icon: String?   // optional SF Symbol (e.g. "heart.fill") for rotating-metric slots
    init(_ text: String, _ role: Role, icon: String? = nil) {
        self.text = text; self.role = role; self.icon = icon
    }
}

// MARK: - Screen scaffold (black bleed)

struct Screen<Content: View>: View {
    var background: AnyView = AnyView(Color.black)
    @ViewBuilder var content: () -> Content
    var body: some View {
        // watchOS draws the time in the status bar, so faces don't render their own clock.
        ZStack {
            background.ignoresSafeArea()
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 4)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Tight number — crops SwiftUI's line-box leading so the GLYPH fills,
// not the line box. SwiftUI reserves a full line box; a font sized to the row
// leaves ~30% air, so we oversize + negative-pad to strip it.

struct TightNumber: ViewModifier {
    let size: CGFloat
    func body(content: Content) -> some View {
        content
            .font(.custom("HelveticaNeue-Bold", size: size))
            .lineLimit(1)
            .minimumScaleFactor(0.25)
            .padding(.vertical, -size * 0.22)
    }
}
extension View {
    func tightNumber(_ size: CGFloat) -> some View { modifier(TightNumber(size: size)) }
}

// MARK: - NumberFace — THE locked face recipe (verified against the HTML by pixel
// measurement on the rep-work face). Numbers fill top→bottom with uniform gaps;
// font/pitch are computed so any number of rows fills the same way. Optional slim
// low strip occupies a reserved row so digits can never collide with it.

struct NumberFace: View {
    let rows: [NumRow]
    var strip: Strip? = nil

    // recipe constants — calibrated against TestFlight hardware (corner radius
    // crops content within ~9% of the rounded corners). Sim screenshots are
    // flat-rectangular and hide the clip; hardware reveals it. Bumped strip-
    // bottom safety so the progress capsules stay clear of the curve.
    private let topF: CGFloat = 0.060         // 6% from top — clears upper bezel curve
    private let gapRatio: CGFloat = 0.15      // inter-line gap as a fraction of glyph height
    private let capRatio: CGFloat = 0.73      // HelveticaNeue-Bold cap-height ÷ point-size
    private let cropK: CGFloat = 0.22         // line-box crop so element ≈ glyph
    private let leadF: CGFloat = 0.060        // 6% left inset — left edge of digits clears bezel
    private let stripBottomF: CGFloat = 0.075 // 7.5% bottom safety — strip can't be curve-clipped
    private let stripBarF: CGFloat = 0.027
    private let clockClearF: CGFloat = 0.70   // top row must end left of here (system clock lives right of it)

    // rough per-glyph advance (em) for HelveticaNeue-Bold, to clear the clock without measuring
    static func emWidth(_ s: String) -> CGFloat {
        s.reduce(0) { acc, c in
            switch c {
            case ":", ".", " ": return acc + 0.30
            case "+", "-":       return acc + 0.58
            default:             return acc + 0.56
            }
        }
    }

    var body: some View {
        GeometryReader { geo in
            let H = geo.size.height
            let W = geo.size.width
            let hasStrip = strip != nil
            // strip faces fill above the strip; strip-less faces use a symmetric band so the centered group is screen-centered
            let bottomLimit: CGFloat = hasStrip ? (1 - stripBottomF - stripBarF - 0.028) : (1 - topF)
            let n = CGFloat(rows.count)
            let span = bottomLimit - topF
            // 1) font that would fill the height
            let heightG = span / (n + gapRatio * (n - 1))
            let heightF = (heightG / capRatio) * H
            // 2) cap so the TOP row clears the clock (top-right)
            let clearance = clockClearF * W - H * leadF
            let topEm = NumberFace.emWidth(rows.first?.text ?? "")
            let widthF = topEm > 0 ? clearance / topEm : heightF
            let F = max(1, min(heightF, widthF))
            // 3) keep the locked tight spacing; vertically center the group in the band
            let glyphF = (capRatio * F) / H
            let pitchF = glyphF * (1 + gapRatio)
            let groupSpan = CGFloat(n - 1) * pitchF + glyphF
            // center the group; nudge up by ~6% of a glyph to correct the digits' low ink-bias in the box
            let startF = topF + max(0, (bottomLimit - topF - groupSpan) / 2 - glyphF * 0.06)
            ZStack(alignment: .topLeading) {
                Color.black
                ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                    rowContent(r, F)
                        .padding(.vertical, -F * cropK)
                        .fixedSize()
                        .offset(x: H * leadF, y: H * (startF + CGFloat(i) * pitchF))
                }
                if let strip {
                    strip
                        .frame(height: H * stripBarF)
                        .padding(.horizontal, W * 0.13)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, H * stripBottomF)
                }
            }
            .frame(width: W, height: H)
        }
        .ignoresSafeArea()
    }

    @ViewBuilder
    private func rowContent(_ r: NumRow, _ F: CGFloat) -> some View {
        if let icon = r.icon {
            HStack(spacing: F * 0.16) {
                Text(r.text)
                    .font(.custom("HelveticaNeue-Bold", size: F))
                Image(systemName: icon)
                    .font(.system(size: F * 0.42, weight: .bold))
            }
            .foregroundStyle(r.role.color)
        } else {
            Text(r.text)
                .font(.custom("HelveticaNeue-Bold", size: F))
                .foregroundStyle(r.role.color)
        }
    }
}

// MARK: - Bottom progress strip (reps / phases)

struct Strip: View {
    /// states: 0 empty, 1 done, 2 now
    let states: [Int]
    var doneColor: Color = Faff.live
    var nowColor: Color = .white
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(states.enumerated()), id: \.offset) { _, s in
                Capsule()
                    .fill(s == 1 ? doneColor : s == 2 ? nowColor : Color(hex: 0x2C2F35))
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 7)
    }
}

// MARK: - A small uppercase label (REST / NEXT / MILE)

struct FaceLabel: View {
    let text: String
    var color: Color = Faff.mute
    var size: CGFloat = 15
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: size, weight: .bold, design: .default))
            .tracking(2)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}

// MARK: - Big value with monospaced digits (helper for inline layouts)

struct BigValue: View {
    let text: String
    let role: Role
    let size: CGFloat
    var opacity: Double = 1
    var body: some View {
        Text(text)
            .foregroundStyle(role.color)
            .opacity(opacity)
            .tightNumber(size)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Pace zone → Role helper (called by router to colour the hero)

extension Role {
    /// Map the engine's pace zone to a NumRow role for the live-pace slot.
    /// (Mirror of the prototype's PaceColor.role(...).)
    static func from(zone: PaceZone) -> Role {
        switch zone {
        case .onTarget:  return .live
        case .drifting:  return .goal
        case .offTarget: return .over
        }
    }
}
