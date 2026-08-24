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

                content()
                    .frame(width: full.size.width,
                           height: full.size.height - WorkoutShellMetrics.top - WorkoutShellMetrics.bottom,
                           alignment: .topLeading)
                    .offset(y: WorkoutShellMetrics.top)
                    // Apple's own margin, from the runtime rather than a
                    // constant: 13pt on a 42mm, 15 on a 46mm, 16.5 on Ultra.
                    // Plain .padding() is a flat 8 everywhere and is wrong for
                    // a top-level margin.
                    .scenePadding(.horizontal)
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
    /// Accessibility only. Never drawn.
    var role: String

    /// Set by the stack, which owns sizing.
    var size: CGFloat = 38

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value)
                // SF Compact Rounded — `.rounded` resolves to the platform's
                // rounded system design, which on watchOS is SF Compact
                // Rounded. Tabular figures so a changing number does not
                // shift the column every second.
                .font(.system(size: size, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(grade.color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
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

    /// Digit advance for SF Compact Rounded semibold, as a fraction of point
    /// size. Measured off the rendered matrix rather than assumed: a 4-glyph
    /// value at 46pt occupied ~114pt of the 178pt content width.
    private static let digitAdvance: CGFloat = 0.62
    private static let unitRatio: CGFloat = 0.38

    /// Widest the value + unit can be drawn at `size`.
    private func width(of m: WorkoutMetric, at size: CGFloat) -> CGFloat {
        let v = CGFloat(m.value.count) * size * Self.digitAdvance
        guard let u = m.unit else { return v }
        return v + 4 + CGFloat(u.count) * size * Self.unitRatio * Self.digitAdvance
    }

    var body: some View {
        GeometryReader { g in
            let shown = Array(metrics.prefix(Self.maxMetrics))
            let n = max(1, shown.count)
            let pitch = g.size.height / CGFloat(n)

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
            let byHeight = pitch / 1.08
            let byWidth = shown
                .map { m in g.size.width / max(1, width(of: m, at: 1)) }
                .min() ?? byHeight
            let size = min(ceiling(n), byHeight, byWidth)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.offset) { _, m in
                    var sized = m
                    let _ = (sized.size = size)
                    sized.frame(height: pitch, alignment: .center)
                }
            }
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
