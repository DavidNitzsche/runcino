//  WatchFaces.swift
//  Reference primitives + secondary-page faces.
//
//  The PRIMARY in-run faces (WorkIntervalFace / RaceFace / EasyFace / etc.)
//  have moved to Faces.swift + FaceKit.swift — the locked redesign. This
//  file now holds:
//    · The WP / WF tokens still used by secondary pages
//      (Controls / Splits / Session Map / In-run stats / Pause veil / etc.)
//    · The shared primitives those pages rely on
//      (Eyebrow, FaceHeader, Hero, RefLine, Stat, StatsRow, ProgressRow,
//       SegmentStrip, BigMetric, executionFace)
//
//  WP.green / amber / orange / warn are kept token-stable so existing call
//  sites compile; the *values* have been updated to the locked palette
//  (Faff.live, Faff.goal, Faff.over). Fonts (Bebas/Inter/Oswald) stay as-is.

import SwiftUI

// MARK: - Palette (legacy WP tokens, retuned to the locked grammar)

enum WP {
    static let bg     = Color.black
    static let ink    = Color.white
    static let muted  = Color.white.opacity(0.60)
    static let faint  = Color.white.opacity(0.40)
    static let line   = Color.white.opacity(0.15)
    // Token names kept stable; values point at the locked Faff palette so
    // secondary pages read the same grammar as the new faces.
    static let green  = Faff.live    // on pace / done / recovery
    static let amber  = Faff.goal    // drift / "act now"
    static let orange = Faff.goal    // legacy alias — "race / work-progress" maps to amber-goal
    static let warn   = Faff.over    // alert / off-pace / over

    /// Pace color vs the target band: green ≤10s, amber 10–15s, red >15s.
    /// Now keyed off the same drift bands as the new faces.
    static func pace(forDeltaSeconds delta: Int) -> Color {
        let a = abs(delta)
        if a <= 10 { return green }
        if a <= 15 { return amber }
        return warn
    }
}

// (Color(hex:) is provided by FaceKit.swift as `init(hex: UInt32)`.)

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
    /// Base size. Faces with more room + narrow time values (warmup/cooldown/recovery,
    /// no strip or ref) pass a larger size; the work/race face keeps the default.
    var size: CGFloat = 118
    var body: some View {
        Text(value)
            .font(WF.bebas(size))
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
    /// How full the `.current` segment is drawn (0…1) — so the bar PROGRESSES as
    /// you move through the phase instead of sitting solid. `done` = full,
    /// `upcoming` = empty track. Defaults to 1 (solid) for non-progress uses.
    var currentFraction: Double = 1
    var body: some View {
        GeometryReader { g in
            let gap: CGFloat = 2
            let total = max(1, segments.reduce(0) { $0 + $1.weight })
            let avail = g.size.width - gap * CGFloat(max(0, segments.count - 1))
            HStack(spacing: gap) {
                ForEach(segments) { s in
                    let w = avail * s.weight / total
                    if s.state == .current {
                        // Track + a proportional fill that grows with progress.
                        Capsule().fill(WP.line)
                            .frame(width: w)
                            .overlay(alignment: .leading) {
                                Capsule().fill(WP.orange)
                                    .frame(width: w * CGFloat(min(max(currentFraction, 0), 1)))
                            }
                    } else {
                        Capsule().fill(color(s.state)).frame(width: w)
                    }
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

/// Pace delta vs the target. Small misses read in seconds ("+8S"); big ones
/// roll up to minutes:seconds so a walk-test doesn't show an absurd "+1016S".
func paceDeltaLabel(_ sec: Int) -> String {
    let a = abs(sec)
    let sign = sec >= 0 ? "+" : "-"
    if a < 60 { return "\(sign)\(a)s" }
    return "\(sign)\(a / 60):" + String(format: "%02d", a % 60)
}

// MARK: - Big stacked metric (one huge number per line · in-run faces)

/// A single big metric row: a huge Bebas value, a small unit, and an optional
/// sub-line (used by the work face for the target/delta under pace). Left-
/// aligned so the numbers stack like a glanceable dashboard while running.
struct BigMetric: View {
    let value: String
    var unit: String? = nil
    var sub: String? = nil
    var color: Color = WP.ink
    var size: CGFloat = 50
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value).font(WF.bebas(size)).monospacedDigit().foregroundStyle(color)
                    .lineLimit(1).minimumScaleFactor(0.5)
                if let unit { Text(unit).font(WF.interSemi(14)).foregroundStyle(WP.muted) }
            }
            if let sub {
                Text(sub).font(WF.interBold(12)).tracking(0.4).foregroundStyle(color)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 8)
    }
}

// (The WorkIntervalFace and RaceFace structs that used to live here have
// moved to Faces.swift — the locked redesign. The remaining primitives
// above are still used by the secondary pages: Controls, Splits, Session
// Map, In-run stats, Pause veil, Transition flips.)
