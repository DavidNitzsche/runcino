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

/// One-line uppercase eyebrow (top-left of the metric faces). Never wraps — a long phase
/// label scales down, then truncates with an ellipsis rather than wrapping or overflowing.
struct Eyebrow: View {
    let text: String
    var color: Color = WP.muted
    var body: some View {
        Text(text.uppercased())
            .font(WF.interBold(13)).tracking(1.1)
            .foregroundStyle(color)
            .lineLimit(1).minimumScaleFactor(0.7).truncationMode(.tail)
    }
}

/// Top strip for every execution face: the eyebrow ONLY, lifted up so it sits LEFT and
/// baseline-aligns with the OS clock. watchOS owns the top-right (wall clock in the sim, the
/// live workout-elapsed timer during a real run), so we never draw our own time there — that
/// was the duplicate-clock collision the hero face fixed. Elapsed lives on a 2nd page.
struct FaceHeader: View {
    let label: String
    var color: Color = WP.muted
    var body: some View {
        HStack(spacing: 0) {
            Eyebrow(text: label, color: color)
            Spacer(minLength: 78)    // reserve the top-right zone the OS clock occupies — the
                                     // eyebrow scales/truncates within the rest, never under the clock
        }
        .padding(.leading, 8)        // clear the rounded top-left corner at the clock's height
        .padding(.top, 20)           // baseline-align the eyebrow with the OS clock
    }
}

extension View {
    /// Standard execution-face container: side margins, a bottom inset off the edge, the
    /// true-black fill, and a lift into the top status row so FaceHeader aligns with the clock.
    /// `bottom` clears the rounded bottom corners — bump it for faces with a taller bottom read.
    func executionFace(bottom: CGFloat = 4) -> some View {
        self
            .padding(.horizontal, 6)
            .padding(.bottom, bottom)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(WP.bg)
            .ignoresSafeArea(.container, edges: .top)
    }
}

/// THE HERO. The single biggest thing on the face. A large fixed Bebas size with NO
/// monospaced digits (so the thin colon lets "6:33" fill the width the way the deck does,
/// 92px hero), lineLimit(1) + minimumScaleFactor as a width safety for narrower screens and
/// longer h:mm:ss values. Takes its natural height and is centered by the surrounding zone —
/// no greedy GeometryReader (which height-caps it) and no clipping (which crops the glyphs).
struct Hero: View {
    let value: String
    var color: Color = WP.ink
    var body: some View {
        Text(value)
            .font(WF.bebas(118))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(maxWidth: .infinity)
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
            .font(WF.interBold(15)).textCase(.uppercase)
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
                Text(value).font(WF.bebas(36)).foregroundStyle(color).monospacedDigit()
                if let unit { Text(unit).font(WF.interSemi(13)).foregroundStyle(WP.muted) }
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
            FaceHeader(label: rep, color: WP.amber)
            SegmentStrip(segments: segments).padding(.top, 8)

            VStack(spacing: -10) {               // middle zone: hero (dominant) + ref. Negative spacing pulls
                Hero(value: currentPace, color: paceColor)   // the ref UP into Bebas's tall line-box dead space
                RefLine(target: targetPace, delta: deltaText, deltaColor: paceColor)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            StatsRow(
                left:  Stat(value: heartRate, unit: "bpm"),   // HEART RATE
                right: Stat(value: cadence,   unit: "spm")    // CADENCE
            )
            Text(repTimeLeft).font(WF.bebas(22)).monospacedDigit().foregroundStyle(WP.ink)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8)
        }
        .executionFace(bottom: 8)
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
    let projectedFinish: String // "3:49"  (predicted total finish)
    let goalDeltaSec: Int?     // proj − goal; − = ahead of goal. nil until enough banked.
    let distanceToGo: String  // "15.8"  (whole-race miles remaining)
    let nextFuel: String      // "Gel 3 · 1.6mi"

    private var paceColor: Color { WP.pace(forDeltaSeconds: deltaSeconds) }
    private var deltaText: String { (deltaSeconds >= 0 ? "+" : "") + "\(deltaSeconds)s" }

    // Predicted finish vs goal: the race headline. − = ahead (green), + = behind (red).
    private var goalText: String {
        guard let d = goalDeltaSec else { return "PROJ FINISH" }
        let a = abs(d)
        let mag = a >= 60 ? "\(a / 60):" + String(format: "%02d", a % 60) : "\(a)s"
        return d <= 0 ? "\(mag) UNDER" : "\(mag) OVER"
    }
    private var goalColor: Color {
        guard let d = goalDeltaSec else { return WP.muted }
        return d <= 0 ? WP.green : WP.warn
    }

    var body: some View {
        VStack(spacing: 0) {
            FaceHeader(label: phase, color: WP.orange)
            SegmentStrip(segments: segments).padding(.top, 8)

            // Hero zone — current pace is by far the biggest thing, filling the
            // width, with the terrain-aware target + delta right under it.
            VStack(spacing: -10) {
                Hero(value: currentPace, color: paceColor)
                RefLine(target: phaseTarget, delta: deltaText, deltaColor: paceColor)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Bottom read: predicted finish (with the goal delta as its colored sub —
            // the race headline) on the left, miles-to-go on the right.
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                RaceStat(value: projectedFinish, label: goalText, labelColor: goalColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Rectangle().fill(WP.line).frame(width: 1, height: 30)
                RaceStat(value: distanceToGo, unit: "mi", label: "TO GO", align: .trailing)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(.top, 4)
            // No progress bar — course position is the strip up top. Just the next-fuel
            // cue, centered along the bottom.
            Text(nextFuel).font(WF.oswald(13)).foregroundStyle(WP.orange)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8)
        }
        .executionFace(bottom: 10)
    }
}

/// A bottom race stat: a big Bebas value (+ optional unit) over a tiny label.
private struct RaceStat: View {
    let value: String
    var unit: String? = nil
    let label: String
    var labelColor: Color = WP.muted
    var align: HorizontalAlignment = .leading
    var body: some View {
        VStack(alignment: align, spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value).font(WF.bebas(40)).foregroundStyle(WP.ink).monospacedDigit()
                if let unit { Text(unit).font(WF.interSemi(13)).foregroundStyle(WP.muted) }
            }
            Text(label).font(WF.interBold(9)).tracking(0.8).foregroundStyle(labelColor)
        }
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
        projectedFinish: "3:49", goalDeltaSec: -48, distanceToGo: "15.8",
        nextFuel: "Gel 3 · 1.6mi"
    )
}
