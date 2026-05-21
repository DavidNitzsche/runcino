//  WatchFaces.swift
//  Reference SwiftUI for the Faff watch faces — copy this into the FaffWatch target.
//
//  This is the implementation of the APPROVED design (docs/design/watch-app.html).
//  The sample data below matches scripts/watch/refs/ so you can preview each face,
//  screenshot the sim, and diff it with scripts/watch/compare.mjs until it PASSes.
//
//  FONTS — REQUIRED. These are NOT system fonts. Add the files to the watch target and
//  list them in Info.plist UIAppFonts. PostScript names used here:
//      BebasNeue-Regular   (numbers + titles)
//      Inter-Bold / Inter-SemiBold / Inter-Regular   (labels + body)
//      Oswald-SemiBold     (sub-headers / fuel cue)
//  If a custom font name is wrong, SwiftUI silently falls back to the system font — so
//  verify the Bebas hero actually looks like Bebas, not San Francisco.
//
//  THINGS THE BUILD KEEPS GETTING WRONG (do not repeat):
//   • Top-right is ELAPSED workout/race time, NOT the wall clock.
//   • Left stat is HEART RATE -> "bpm". Right stat is CADENCE -> "spm". They are different units.
//   • The hero FILLS the width (large base font + minimumScaleFactor), it is not a fixed small size.
//   • The progress time sits INLINE at the end of the bar, not on its own row.

import SwiftUI

// MARK: - Palette (dark watch variant of the v4 system)

enum WP {
    static let bg     = Color.black
    static let ink    = Color.white
    static let muted  = Color.white.opacity(0.60)
    static let faint  = Color.white.opacity(0.40)
    static let line   = Color.white.opacity(0.15)
    static let green  = Color(hex: 0x2CA82F)   // on pace / done / recovery
    static let amber  = Color(hex: 0xD4900A)   // drift / in-progress / interval label
    static let orange = Color(hex: 0xE85D26)   // brand / race / work-progress bar
    static let warn   = Color(hex: 0xF43F5E)   // sustained over

    /// Pace color vs the target band: green <=10s, amber 10–15s, red >15s.
    static func pace(forDeltaSeconds delta: Int) -> Color {
        let a = abs(delta)
        if a <= 10 { return green }
        if a <= 15 { return amber }
        return warn
    }
}

extension Color {
    init(hex: UInt) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

// MARK: - Fonts

enum WF {
    static func bebas(_ size: CGFloat) -> Font { .custom("BebasNeue-Regular", size: size) }
    static func interBold(_ s: CGFloat) -> Font { .custom("Inter-Bold", size: s) }
    static func interSemi(_ s: CGFloat) -> Font { .custom("Inter-SemiBold", size: s) }
    static func oswald(_ s: CGFloat) -> Font { .custom("Oswald-SemiBold", size: s) }
}

// MARK: - Shared components

/// One-line uppercase eyebrow (top-left of the metric faces). Never wraps.
struct Eyebrow: View {
    let text: String
    var color: Color = WP.muted
    var body: some View {
        Text(text.uppercased())
            .font(WF.interBold(13)).tracking(1.1)
            .foregroundStyle(color)
            .lineLimit(1).minimumScaleFactor(0.8)
    }
}

/// Orientation strip: eyebrow (left) + ELAPSED time (right). The right value is the workout/
/// race elapsed time, NOT Date(). Pass it in as a formatted string.
struct TopBar: View {
    let label: String
    var labelColor: Color = WP.muted
    let elapsed: String
    var body: some View {
        HStack(spacing: 6) {
            Eyebrow(text: label, color: labelColor)
            Spacer(minLength: 4)
            Text(elapsed)
                .font(WF.interBold(13)).monospacedDigit()
                .foregroundStyle(WP.faint).lineLimit(1)
        }
    }
}

/// THE HERO. Fills the content width and auto-scales so 3- and 4-digit values are both huge.
struct Hero: View {
    let value: String
    var color: Color = WP.ink
    var body: some View {
        Text(value)
            .font(WF.bebas(130))                 // big base; minimumScaleFactor scales it DOWN to fit
            .foregroundStyle(color)
            .monospacedDigit()
            .minimumScaleFactor(0.3)
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
    }
}

/// "6:31 · +2s" reference line: target (white) + delta (colored to the pace state).
struct RefLine: View {
    let target: String
    let delta: String
    var deltaColor: Color
    var body: some View {
        (Text(target).foregroundStyle(WP.ink)
         + Text("  ·  ").foregroundStyle(WP.muted)
         + Text(delta).foregroundStyle(deltaColor))
            .font(WF.interBold(12)).textCase(.uppercase)
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

/// Bottom stat. Two flavors:
///  • unit:  "168" + "bpm"   (the unit IS the label — used for HR / cadence)
///  • label: "3:49" over "PROJ FINISH"  (race stats need a word label)
struct Stat: View {
    let value: String
    var unit: String? = nil
    var label: String? = nil
    var color: Color = WP.ink
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value).font(WF.bebas(28)).foregroundStyle(color).monospacedDigit()
                if let unit { Text(unit).font(WF.interSemi(11)).foregroundStyle(WP.muted) }
            }
            if let label {
                Text(label.uppercased())
                    .font(WF.interBold(9)).tracking(0.7)
                    .foregroundStyle(WP.muted).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StatsRow: View {
    let left: Stat
    let right: Stat
    var body: some View {
        VStack(spacing: 9) {
            Rectangle().fill(WP.line).frame(height: 1)         // top divider
            HStack(spacing: 12) {
                left
                Rectangle().fill(WP.line).frame(width: 1, height: 26)   // vertical divider
                right
            }
        }
    }
}

/// Progress bar with an inline trailing element (the rep time, or the next-fuel text).
struct ProgressRow<Trailing: View>: View {
    let fraction: Double
    var fill: Color = WP.orange
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack(spacing: 10) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(WP.line)
                    Capsule().fill(fill).frame(width: max(6, g.size.width * fraction))
                }
            }
            .frame(height: 6)
            trailing
        }
    }
}

/// Whole-course / whole-workout segment strip, proportional to each segment's length.
enum SegState { case done, current, upcoming }
struct Seg: Identifiable { let id = UUID(); let weight: CGFloat; let state: SegState }

struct SegmentStrip: View {
    let segments: [Seg]
    var body: some View {
        GeometryReader { g in
            let gap: CGFloat = 2
            let total = max(1, segments.reduce(0) { $0 + $1.weight })
            let avail = g.size.width - gap * CGFloat(max(0, segments.count - 1))
            HStack(spacing: gap) {
                ForEach(segments) { s in
                    Capsule().fill(color(s.state)).frame(width: avail * s.weight / total)
                }
            }
        }
        .frame(height: 4)
    }
    private func color(_ s: SegState) -> Color {
        switch s {
        case .done: return WP.green
        case .current: return WP.orange
        case .upcoming: return WP.line
        }
    }
}

// MARK: - WORK INTERVAL face

struct WorkIntervalFace: View {
    // Model — wire these to HKLiveWorkoutBuilder + the pushed workout payload.
    let rep: String           // "Int 3 / 6"
    let elapsed: String       // ELAPSED workout time, e.g. "24:18" (NOT wall clock)
    let segments: [Seg]
    let currentPace: String   // "6:33"
    let targetPace: String    // "6:31"
    let deltaSeconds: Int      // +2  -> drives the pace color + "+2S"
    let heartRate: String     // "168"  (bpm)
    let cadence: String       // "182"  (spm)
    let repFraction: Double   // 0.0...1.0
    let repTimeLeft: String   // "0:24"  (time left in this rep)

    private var paceColor: Color { WP.pace(forDeltaSeconds: deltaSeconds) }
    private var deltaText: String { (deltaSeconds >= 0 ? "+" : "") + "\(deltaSeconds)s" }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(label: rep, labelColor: WP.amber, elapsed: elapsed)
            SegmentStrip(segments: segments).padding(.top, 6)

            VStack(spacing: 6) {                 // middle zone: hero + ref, centered
                Spacer(minLength: 0)
                Hero(value: currentPace, color: paceColor)
                RefLine(target: targetPace, delta: deltaText, deltaColor: paceColor)
                Spacer(minLength: 0)
            }

            StatsRow(
                left:  Stat(value: heartRate, unit: "bpm"),   // HEART RATE
                right: Stat(value: cadence,   unit: "spm")    // CADENCE
            )
            ProgressRow(fraction: repFraction, fill: WP.orange) {
                Text(repTimeLeft).font(WF.bebas(18)).monospacedDigit().foregroundStyle(WP.ink)
            }
            .padding(.top, 9)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

// MARK: - RACE face

struct RaceFace: View {
    let phase: String         // "Hurricane"
    let elapsed: String       // "1:34:20"  (race elapsed)
    let segments: [Seg]
    let currentPace: String   // "10:42"
    let phaseTarget: String   // "10:38"  (THIS phase's target — even effort, shifts by terrain)
    let deltaSeconds: Int      // +4
    let projectedFinish: String // "3:49"
    let distanceToGo: String  // "15.8"
    let raceFraction: Double  // 0.0...1.0
    let nextFuel: String      // "Gel 3 · 1.6mi"

    private var paceColor: Color { WP.pace(forDeltaSeconds: deltaSeconds) }
    private var deltaText: String { (deltaSeconds >= 0 ? "+" : "") + "\(deltaSeconds)s" }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(label: phase, labelColor: WP.orange, elapsed: elapsed)
            SegmentStrip(segments: segments).padding(.top, 6)

            VStack(spacing: 6) {
                Spacer(minLength: 0)
                Hero(value: currentPace, color: paceColor)
                RefLine(target: phaseTarget, delta: deltaText, deltaColor: paceColor)
                Spacer(minLength: 0)
            }

            StatsRow(
                left:  Stat(value: projectedFinish, label: "proj finish"),
                right: Stat(value: distanceToGo, unit: "mi", label: "to go")
            )
            ProgressRow(fraction: raceFraction, fill: WP.orange) {
                Text(nextFuel).font(WF.oswald(11)).foregroundStyle(WP.muted)
                    .lineLimit(1).fixedSize()
            }
            .padding(.top, 9)
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WP.bg)
    }
}

// MARK: - Previews (sample data matches scripts/watch/refs/ — diff against those)

#Preview("Work interval") {
    WorkIntervalFace(
        rep: "Int 3 / 6",
        elapsed: "24:18",
        segments: [
            Seg(weight: 1.3, state: .done), Seg(weight: 1, state: .done), Seg(weight: 0.5, state: .done),
            Seg(weight: 1, state: .done), Seg(weight: 0.5, state: .done), Seg(weight: 1, state: .current),
            Seg(weight: 0.5, state: .upcoming), Seg(weight: 1, state: .upcoming), Seg(weight: 0.5, state: .upcoming),
            Seg(weight: 1, state: .upcoming), Seg(weight: 0.5, state: .upcoming), Seg(weight: 1, state: .upcoming),
            Seg(weight: 1.3, state: .upcoming)
        ],
        currentPace: "6:33", targetPace: "6:31", deltaSeconds: 2,
        heartRate: "168", cadence: "182",
        repFraction: 0.5, repTimeLeft: "0:24"
    )
}

#Preview("Race") {
    RaceFace(
        phase: "Hurricane",
        elapsed: "1:34:20",
        segments: [
            Seg(weight: 5, state: .done), Seg(weight: 5, state: .done), Seg(weight: 2, state: .current),
            Seg(weight: 2, state: .upcoming), Seg(weight: 8, state: .upcoming), Seg(weight: 4.2, state: .upcoming)
        ],
        currentPace: "10:42", phaseTarget: "10:38", deltaSeconds: 4,
        projectedFinish: "3:49", distanceToGo: "15.8",
        raceFraction: 0.40, nextFuel: "Gel 3 · 1.6mi"
    )
}
