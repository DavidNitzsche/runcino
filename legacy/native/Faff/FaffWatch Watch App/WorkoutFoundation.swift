//
//  WorkoutFoundation.swift
//  FaffWatch
//
//  The native shell, and the metric primitives that sit in it.
//
//  "Native structure. Branded information." — David, 2026-08-23.
//  watchOS owns geometry, safe areas, navigation, Crown behaviour and baseline
//  typography. Our product owns hierarchy, coaching logic, data density,
//  grading, transitions and branded moments.
//
//  EVERY NUMBER BELOW WAS MEASURED, on watchOS 26.5 simulators at 42 / 46 /
//  49mm, and the measurements are recorded here because three earlier attempts
//  at this layout were guesses and all three were wrong.
//
//  Usable content height on a 46mm, by shell:
//
//      NavigationStack + title ................ 150.0  (60.5%)
//      bare root / verticalPage alone ......... 159.0  (64.1%)
//      chrome hidden .......................... 167.5  (67.5%)
//      chrome hidden + verticalPage ........... 167.5  (67.5%)
//      full-bleed, insets 30/22 (THIS) ........ 196.0  (79.0%)
//      full-bleed, insets 18/18 (Apple's kit).. 212.0  (85.5%)
//
//  The runtime safe area reserves a full-width rectangle for a clock that only
//  occupies the top-RIGHT corner. A left-aligned column does not need that
//  reservation, which is why the lead metric can sit level with the clock
//  without colliding. Apple's own Sketch kit puts the text margins at 18/18 on
//  this device — so going full-bleed and re-insetting is not pushing past the
//  platform, it is matching the platform's own design guide.
//
//  THE TRAP, recorded because it cost an hour: padding INSIDE the safe area
//  makes the region smaller, not larger. Reclaiming space means ignoring the
//  safe area on the content layer and taking your own insets from the full
//  screen height. The first attempt at this went 167.5 -> 131.5.
//

import SwiftUI
import UIKit
import WatchKit

// MARK: - Shell

enum WorkoutShellMetrics {
    /// Top inset. Clears the system clock, which the app cannot restyle.
    /// Apple's kit says 18; this keeps 12pt of insurance because the corner
    /// mask is NOT in the simulator framebuffer and cannot be verified without
    /// a physical watch.
    static let top: CGFloat = 30
    /// Bottom inset. The corner curve bites hardest here, under a left-aligned
    /// column whose last row sits in the bottom-left corner.
    static let bottom: CGFloat = 22

    /// Usable content height on the watch this is running on.
    static var contentHeight: CGFloat {
        WKInterfaceDevice.current().screenBounds.height - top - bottom
    }
}

/// The active-workout shell.
///
/// Vertical paging, Crown-navigable, chrome hidden, full-bleed. The page
/// indicator sits beside the Digital Crown, which is where watchOS puts it for
/// vertical paging — not centred at the bottom, which is the horizontal
/// convention this app deliberately does not use.
struct WorkoutShell<Content: View>: View {
    @Binding var page: Int
    @ViewBuilder var content: () -> Content

    var body: some View {
        NavigationStack {
            TabView(selection: $page) {
                content()
            }
            .tabViewStyle(.verticalPage)
            .navigationBarHidden(true)
            .toolbar(.hidden, for: .navigationBar)
        }
        .ignoresSafeArea()
    }
}

/// One page inside the shell. Full-bleed ground, content inset by our own
/// margins, horizontal margin from `scenePadding` so it tracks the platform.
struct WorkoutPage<Content: View>: View {
    var background: AnyView = AnyView(Color.black)
    @ViewBuilder var content: () -> Content

    var body: some View {
        GeometryReader { full in
            ZStack(alignment: .topLeading) {
                background.ignoresSafeArea()

                // ORDER MATTERS. scenePadding FIRST, then the frame.
                //
                // The other way round lays the content out at full screen
                // width and then insets the result, so the trailing edge ends
                // up past the display — a right-aligned detail on the phase
                // header rendered as "9:5" with the rest off-screen. Padding
                // first means the content is measured inside the margins,
                // which is what a margin is.
                //
                // Apple's own margin, from the runtime rather than a constant:
                // 13pt on a 42mm, 15 on a 46mm, 16.5 on Ultra. Plain
                // .padding() is a flat 8 everywhere and is wrong here.
                content()
                    .scenePadding(.horizontal)
                    .frame(width: full.size.width,
                           height: full.size.height - WorkoutShellMetrics.top - WorkoutShellMetrics.bottom,
                           alignment: .topLeading)
                    .offset(y: WorkoutShellMetrics.top)
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Grading
//
// COLOUR MEANS COACHING STATE, NOT METRIC IDENTITY. Ruled 2026-08-23.
//
// A metric does not get a permanent hue. If pace were always blue and heart
// always red, green would stop meaning "on target" — the strongest signal in
// the app would be spent replacing labels we already agreed to remove.
//
// Identity comes from position, format and the runner's own configuration.
// Colour is reserved for the one thing the session is asking them to hold.

enum MetricGrade {
    /// Measured, ungraded. Almost every number, almost all the time.
    case neutral
    /// On target. The only green in the product.
    case onTarget
    /// Drifting, or outside the band.
    case drifting

    var color: Color {
        switch self {
        case .neutral:  return .white
        case .onTarget: return WatchV5.band
        case .drifting: return WatchV5.attention
        }
    }
}

// MARK: - Metric

/// One live number.
///
/// No persistent label, by ruling. During a run the screen reads
/// `7:38 / 154 / 8.72 / 158`, not `PACE 7:38`. The label exists only for
/// VoiceOver, which is why `role` draws nothing.
struct WorkoutMetric: View {
    let value: String
    var unit: String? = nil
    var grade: MetricGrade = .neutral
    /// This row names a SENSOR instead of carrying a figure.
    ///
    /// It still occupies its slot, which is the whole point: the run keeps its
    /// four rows, the numbers above and below do not move, and the failure
    /// reads as one broken slot rather than one broken screen.
    ///
    /// It is drawn at a fixed 17pt rather than the column's size, because it
    /// is words. A fifteen-character sentence at the column's 46pt would set
    /// the width ceiling for every number on the board — the sensor that
    /// failed would shrink the three that did not.
    var fault: Bool = false
    /// Accessibility only. Never drawn.
    var role: String

    /// Set by the stack, which owns sizing.
    var size: CGFloat = 38

    /// Fixed, and deliberately not proportional to the column.
    static let faultSize: CGFloat = 17

    var body: some View {
        if fault { faultBody } else { metricBody }
    }

    private var faultBody: some View {
        Text(value)
            .font(.system(size: Self.faultSize, weight: .semibold, design: .rounded))
            .foregroundStyle(WatchV5.fault)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(role)
            .accessibilityValue(value)
    }

    private var metricBody: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value)
                // SF Compact Rounded — `.rounded` resolves to the platform's
                // rounded system design, which on watchOS is SF Compact
                // Rounded. Tabular figures so a changing number does not
                // shift the column every second.
                .font(.system(size: size, weight: .semibold, design: .rounded))
                // Tabular figures. A KNOWN AND ACCEPTED COST: in a tabular
                // font every digit takes a full-width slot, so a narrow "1"
                // sits centred in its slot and a row beginning "1:12" reads
                // about 3pt more indented than one beginning "4:12". Measured
                // across the running boards the spread is 2.5-4pt.
                //
                // It is not corrected, and should not be. The only correction
                // is to shift each row by its leading glyph's side bearing,
                // which means the column steps sideways the moment a countdown
                // rolls from 1:00 to 0:59 — a moving left edge on the number
                // the runner is watching, to fix an edge that is a few points
                // soft. Proportional figures have the same defect continuously.
                .monospacedDigit()
                .foregroundStyle(grade.color)
                .lineLimit(1)
                // NO minimumScaleFactor. It shrank whichever row overflowed —
                // in practice the one carrying a unit — so a column that is
                // supposed to be one size rendered "6:31" visibly smaller than
                // "5:30" beside it. The stack's width calculation is what
                // guarantees the fit now; if that is wrong the answer is to
                // fix the estimate, not to let one row quietly opt out.
            if let unit {
                Text(unit)
                    .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.45))
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(role)
        .accessibilityValue(spokenValue)
    }

    private var spokenValue: String {
        var s = value
        if let unit { s += " " + Self.spoken(unit) }
        switch grade {
        case .onTarget: s += ", on target"
        case .drifting: s += ", drifting"
        case .neutral:  break
        }
        return s
    }

    private static func spoken(_ u: String) -> String {
        switch u {
        case "/mi": return "per mile"
        case "/km": return "per kilometre"
        case "mi":  return "miles"
        case "km":  return "kilometres"
        case "bpm": return "beats per minute"
        case "spm": return "steps per minute"
        case "W":   return "watts"
        case "ft":  return "feet"
        case "m":   return "metres"
        default:    return u
        }
    }
}

// MARK: - The band
//
// THE ANSWER TO "WHAT SPEED SHOULD I BE DOING".
//
// Colour tells a runner whether they are holding the ask. It does not tell
// them what the ask IS, which is the only thing that lets them correct when
// they are not. A green number says "yes" and a amber one says "no", and
// neither says "6:20 to 6:45".
//
// The strip says it in the one way that needs no label: the lit segment is the
// prescribed band, the mark is where the runner is, and the distance between
// them is how far off they are. Reading it takes no words and no arithmetic.
//
// The lit segment goes WHITE the moment the mark leaves it, so the strip can
// never show two greens — it says one thing at a time, and it agrees with the
// number above it by construction.

struct MetricBand: View {
    /// Prescribed band, as fractions of the strip.
    let start: Double
    let end: Double
    /// Where the runner is.
    let marker: Double
    let inBand: Bool

    var body: some View {
        GeometryReader { g in
            let w = g.size.width
            let h: CGFloat = 4
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.16))
                    .frame(width: w, height: h)

                Capsule()
                    .fill(inBand ? MetricGrade.onTarget.color : Color.white.opacity(0.5))
                    .frame(width: max(2, w * (end - start)), height: h)
                    .offset(x: w * start)

                Circle()
                    .fill(inBand ? MetricGrade.onTarget.color : MetricGrade.drifting.color)
                    .frame(width: 9, height: 9)
                    .offset(x: min(w - 9, max(0, w * marker - 4.5)))
            }
            .frame(height: 9)
        }
        .frame(height: 9)
        .accessibilityHidden(true)   // the grade is spoken by the metric above
    }
}

// MARK: - Type measurement

/// The real width of a string in the real font, per point of type size.
///
/// Exists because the width model it replaces was a plausible guess that was
/// wrong in the direction that costs size: it over-charged, so the sizing rule
/// shrank the type to fit a line it already fitted.
///
/// Advances scale linearly with point size for a given font, so measuring once
/// at a reference size and dividing gives an exact ratio at every size.
///
/// Cached by SHAPE, not by string. A clock changes every second and caching
/// "5:59:59" would grow without bound; every digit has the same advance under
/// `.monospacedDigit()`, so "5:59:59" and "1:11:48" share the key "0:00:00"
/// and the cache stays a handful of entries for the life of the run.
enum MetricType {
    private static let reference: CGFloat = 100
    private static var cache: [String: CGFloat] = [:]
    private static let lock = NSLock()

    private static let font: UIFont = {
        let base = UIFont.systemFont(ofSize: reference, weight: .semibold)
        let d = base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor
        // Tabular figures, so the measurement matches what `.monospacedDigit()`
        // actually draws. Without this a proportional "1" measures narrow and
        // the board clips the moment the clock rolls past an hour.
        let tabular = d.addingAttributes([
            .featureSettings: [[
                UIFontDescriptor.FeatureKey.type: kNumberSpacingType,
                UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector,
            ]]
        ])
        return UIFont(descriptor: tabular, size: reference)
    }()

    /// Digits collapse to "0" so the cache is keyed on shape.
    private static func key(_ s: String) -> String {
        String(s.map { $0.isNumber ? "0" : $0 })
    }

    static func widthPerPoint(_ s: String) -> CGFloat {
        let k = key(s)
        lock.lock(); defer { lock.unlock() }
        if let hit = cache[k] { return hit }
        let w = (k as NSString).size(withAttributes: [.font: font]).width / reference
        cache[k] = w
        return w
    }
}

// MARK: - Stack

/// One to four metrics, filling the page.
///
/// Size comes from `available height / count`, not from a fixed ladder — so
/// the same rule produces 45pt on a 46mm and a different number on a 42mm,
/// rather than one design scaled down.
///
/// Row pitch is Apple's measured value, 1.08 x point size, which is the HIG
/// leading and about 10% tighter than the font's own line box. SwiftUI applies
/// that automatically only to text STYLES; at a fixed size it gives 1.20x, so
/// a naive stack loses roughly 11% per row — about 18pt over four rows.
struct WorkoutMetricStack: View {
    /// Drawn under `bandRow`. DECLARED BEFORE `metrics` because Swift's
    /// memberwise initialiser is positional: with `metrics` first, every
    /// caller that supplies a band has to write the array literal before it,
    /// which reads backwards and fails to compile if it does not.
    var band: (start: Double, end: Double, marker: Double, inBand: Bool)? = nil
    var bandRow: Int = 0
    let metrics: [WorkoutMetric]

    /// Apple ships four and allows five. Four is the cap here: the fifth is
    /// available on Ultra in Apple's own app and is not a shape this product
    /// needs.
    static let maxMetrics = 4

    /// Ceiling per count, so a single metric does not become absurd.
    private func ceiling(_ n: Int) -> CGFloat {
        switch n {
        case 1:  return 96
        case 2:  return 72
        case 3:  return 56
        default: return 46
        }
    }

    /// Units are drawn at 0.38 of the value's size.
    private static let unitRatio: CGFloat = 0.38
    /// Gap between value and unit, ALSO as a fraction of point size.
    private static let gapRatio: CGFloat = 0.12

    /// How many points of width one point of type size costs, for this metric.
    ///
    /// MEASURED, NOT MODELLED. This was a character-count model — every glyph
    /// billed at a flat 0.66 of the point size — and it was wrong by about
    /// 40% on exactly the strings these boards are made of. A colon is roughly
    /// half the width of a digit, and a clock is a third colons, so "5:59:59"
    /// was charged 176pt of a 178pt line when it actually draws in 124. Width
    /// then bound before height on every four-metric board and the type came
    /// out at 37pt where 46 fits.
    ///
    /// Caught by measuring the ink in a screenshot rather than re-reading the
    /// arithmetic, which is the only reason it was ever found: the model was
    /// internally consistent and produced boards that looked deliberate.
    ///
    /// So nothing is estimated now. CoreText measures the real string in the
    /// real font at a reference size, and font advances scale linearly with
    /// point size, so one measurement divided by the reference is exact at
    /// every size.
    ///
    /// EVERYTHING HERE STILL SCALES. The first version of this function added
    /// a literal 4pt gap inside a per-point-size calculation, so at size 1 the
    /// constant swamped the fractions and every board rendered at a third of
    /// its size. A constant in a ratio is not a constant, it is a bug with a
    /// plausible face.
    private func widthPerPoint(_ m: WorkoutMetric) -> CGFloat {
        // A fault row is drawn at its own fixed size, so it does not
        // participate in the column's width ceiling at all. Returning its
        // character count here would let "No heart signal" decide how big the
        // pace is.
        if m.fault { return 0.5 }
        var w = MetricType.widthPerPoint(m.value)
        if let u = m.unit {
            w += Self.gapRatio + MetricType.widthPerPoint(u) * Self.unitRatio
        }
        // Trailing allowance so the last glyph never kisses the margin.
        return max(0.5, w + 0.15)
    }

    var body: some View {
        GeometryReader { g in
            let shown = Array(metrics.prefix(Self.maxMetrics))
            let n = max(1, shown.count)
            // THE BAND NEEDS ITS OWN HEIGHT. It is drawn inside the graded
            // row's slot, so if the slots are simply height/count the strip
            // gets squeezed into the row beneath it — which is exactly what
            // tightening the line spacing exposed: the band landed on top of
            // the next number.
            let bandReserve: CGFloat = band == nil ? 0 : 13
            // The height ONE row may occupy if the rows are spread to fill.
            let slot = (g.size.height - bandReserve) / CGFloat(n)

            // HEIGHT ALONE IS NOT THE CONSTRAINT.
            //
            // Sizing from `height / count` and stopping there truncated the
            // one-metric board: "10:59 /mi" at the 96pt ceiling is far wider
            // than the 178pt content width, so it rendered "10:..." with the
            // unit off the edge. Caught by the ugly-value fixtures, which is
            // what they are for.
            //
            // The widest metric in the stack sets the ceiling for ALL of them,
            // because a column whose rows are different sizes is not a column.
            // 1.02, not Apple's 1.08. Tighter on purpose: these boards carry
            // three or four numbers and no labels, so the rows can sit closer
            // without crowding, and the space is better spent on size.
            // 1.05, between Apple's 1.08 and the 1.02 that proved too tight
            // once the band had to fit between two rows.
            let byHeight = slot / 1.05
            let byWidth = shown
                .map { g.size.width / widthPerPoint($0) }
                .min() ?? byHeight
            let size = min(ceiling(n), byHeight, byWidth)

            // THE GROUP IS CENTRED; THE ROWS ARE NOT SPREAD.
            //
            // When the size is set by height — four metrics, usually — these
            // are the same thing and this changes nothing. When it is set by
            // the per-count ceiling or by width, they are very different: a
            // two-metric recovery board capped at 72pt was spreading two rows
            // across 196pt, which put one number near the top, one near the
            // bottom, and a 26pt void between them that read as a missing
            // third metric rather than as a quieter board.
            //
            // So rows keep their natural pitch and the block sits in the
            // middle of the region. A lower-density board then looks composed
            // instead of half-empty, which was the "awful use of space" note.
            // 1.18 is the ratio when there is room; `slot` caps it when there
            // is not, so this only ever loosens a board that had slack.
            //
            // At four metrics the slot is the binding constraint and the pitch
            // stays the 1.05 that was approved. At two it is not: 1.05 of a
            // 72pt numeral is tighter than the font's own line box, so the
            // countdown and the heart rate came within a few points of
            // touching. Same rule, and it reads as tight where the board is
            // full and open where it is not — which is the way round it
            // should be.
            let pitch = min(slot, size * 1.18)
            let used = pitch * CGFloat(n) + bandReserve
            let inset = max(0, (g.size.height - used) / 2)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.offset) { i, m in
                    var sized = m
                    let _ = (sized.size = size)
                    VStack(alignment: .leading, spacing: 1) {
                        sized
                        if let band, i == bandRow {
                            MetricBand(start: band.start, end: band.end,
                                       marker: band.marker, inBand: band.inBand)
                        }
                    }
                    .frame(height: pitch + (band != nil && i == bandRow ? 13 : 0),
                           alignment: .center)
                }
            }
            .padding(.top, inset)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - Previews
//
// The brief asks for 3 sizes x 4 metric counts before a component is called
// complete. Real fixtures, not round numbers — ugly values are what expose
// clipping and column shift.

#Preview("4 metrics") {
    WorkoutPage {
        WorkoutMetricStack(metrics: [
            WorkoutMetric(value: "7:38", unit: "/mi", grade: .onTarget, role: "Pace"),
            WorkoutMetric(value: "154", unit: "bpm", role: "Heart rate"),
            WorkoutMetric(value: "8.72", unit: "mi", role: "Distance"),
            WorkoutMetric(value: "158", unit: "spm", role: "Cadence"),
        ])
    }
}

#Preview("3 metrics, drifting") {
    WorkoutPage {
        WorkoutMetricStack(metrics: [
            WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
            WorkoutMetric(value: "199", unit: "bpm", role: "Heart rate"),
            WorkoutMetric(value: "26.22", unit: "mi", role: "Distance"),
        ])
    }
}

#Preview("2 metrics") {
    WorkoutPage {
        WorkoutMetricStack(metrics: [
            WorkoutMetric(value: "3:48:21", role: "Elapsed"),
            WorkoutMetric(value: "1,002", unit: "W", role: "Power"),
        ])
    }
}

#Preview("1 metric") {
    WorkoutPage {
        WorkoutMetricStack(metrics: [
            WorkoutMetric(value: "--:--", unit: "/mi", role: "Pace"),
        ])
    }
}
