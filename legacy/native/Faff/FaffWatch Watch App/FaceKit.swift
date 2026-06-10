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

// LOCKED TEN-COLOR PALETTE (brief v2, AFC fix 4) · byte-for-byte with
// WatchTheme.C, iPhone Theme.swift, and web globals.css :root.
enum Faff {
    static let live   = Color(hex: 0x3EBD41) // Good state — on-pace / governed
    static let goal   = Color(hex: 0xF3AD38) // Watch attention — target / "act now" (fuel)
    static let race   = Color(hex: 0xFF5722) // Race / now — brand hero (--race web token)
    static let dist   = Color(hex: 0x27B4E0) // Recovery blue — DISTANCE, always
    static let over   = Color(hex: 0xFC4D64) // Off/warn — behind / over ceiling (LIVE DATA)
    static let redish = Color(hex: 0xFC4D64) // Destructive-action red (= warn slot · #D03F3F deleted)
    static let rest   = Color(hex: 0x27B4E0) // Recovery blue — rest / landmark chrome (corporate #008FEC deleted)
    static let ink    = Color(hex: 0xF6F7F8) // neutral readout (near-white)
    static let mute   = Color(hex: 0x8A90A0)
    static let dim    = Color(hex: 0x646464)
    static let brand  = Color(hex: 0x27B4E0) // (= rest · corporate blue deleted)
    static let bonus  = Color(hex: 0xF5C518) // PR gold — distance gone past the plan
    // Surface neutrals for non-run views (previously via WatchTheme.C)
    static let t2     = Color.white.opacity(0.62) // secondary labels
    static let t3     = Color.white.opacity(0.40) // dim / eyebrow labels
    static let track  = Color.white.opacity(0.14) // progress ring track
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
    /// Optional small label at the top of the face (OS-clock-baseline slot).
    /// Renders in HelveticaNeue-Bold (same font as the digits) so its leading
    /// edge aligns perfectly with the number column — DIFFERENT from
    /// `FaceLabel` which uses the system font and has slightly different
    /// internal leading. Hand-tuned padding overlays kept landing visibly
    /// off; baking the label into the same offset pipeline as the rows is
    /// the correct fix.
    var topLabel: String? = nil
    var topLabelColor: Color = Faff.mute
    /// Optional SF Symbol that takes the top slot INSTEAD of a text label
    /// (e.g. ✓ on the post-Done face). Sized + positioned identically.
    var topIcon: String? = nil
    var topIconColor: Color = Faff.live
    /// Optional small label at the bottom of the face (above bezel safety).
    /// Same alignment + font as topLabel.
    var bottomLabel: String? = nil
    /// Color for the bottom label. Defaults to the muted gray; the post-run
    /// verdict row (brief v2 §9) passes its state role color here.
    var bottomLabelColor: Color = Faff.mute
    /// Optional bottom progress strip (reps / phases). Replaces the
    /// symmetric bottom margin when present.
    var strip: Strip? = nil
    /// Override the bottom reservation (as a fraction of H) when the
    /// face overlays a button or other custom bottom widget — the
    /// content above flexes to clear this area. When nil, the strip
    /// computes its own reservation; without a strip, the symmetric
    /// bottom margin is used.
    var bottomReservation: CGFloat? = nil
    /// Background color for the face. Defaults to black; override for
    /// washed takeovers (GoFace = green wash, etc).
    var faceBackground: Color = .black

    // ═══════════════════════════════════════════════════════════════════
    // LAYOUT RULES — every face built on NumberFace obeys these.
    // Change a rule here and the WHOLE face recomputes. Stop nudging.
    // ═══════════════════════════════════════════════════════════════════

    /// OS CLOCK BASELINE · y-fraction (of screen H) at which the watchOS
    /// system clock's baseline sits — the cap-bottom of the digits at
    /// top-right. Calibrated by pixel-measuring `xcrun simctl io
    /// screenshot` against the live clock on Apple Watch Ultra 3 (49mm,
    /// 422×514). The clock font / status-bar geometry scales similarly
    /// on the other watch sizes (≈ ±2 px) so a single constant is fine.
    /// Update this if Apple changes the status-bar metrics.
    private let CLOCK_BASELINE: CGFloat = 0.1323

    /// TOP MARGIN · derived. The small top label's CAP-TOP lands here so
    /// its cap-bottom (= baseline for digits and other non-descending
    /// glyphs) lands exactly on the OS clock baseline. NOT a free
    /// parameter — set CLOCK_BASELINE or LABEL_FONT to change it.
    private var TOP_MARGIN: CGFloat { CLOCK_BASELINE - LABEL_FONT * capRatio }

    /// BOTTOM MARGIN · identical to TOP_MARGIN, strict symmetry. The
    /// bottom-most line's cap-bottom is at (1 - TOP_MARGIN), so the
    /// pixel distance from the bottom of the bottom line to the screen
    /// bottom edge equals the pixel distance from the screen top edge
    /// to the cap-top of the top line. (Applies to faces WITH a top
    /// label — bare-rows faces use centered layout, see below.)
    private var BOTTOM_MARGIN: CGFloat { TOP_MARGIN }

    /// CANONICAL_GAP · the inter-line gap value produced by the reference
    /// 5-line warmup-shape layout (top label + 3 rows + bottom label,
    /// width-bound rows on watchOS aspect). Faces WITHOUT a top label
    /// use this CONSTANT gap and CENTER the row group vertically — so
    /// the visual rhythm matches the warmup canonical, and the group
    /// floats in the available stack rather than being anchored to the
    /// (absent) clock baseline. Locked in by David on 2026-05-26.
    private var CANONICAL_GAP: CGFloat {
        let refGlyph: CGFloat = 0.189  // width-bound glyph fraction on watchOS aspect (~0.818)
        return (1 - 2 * TOP_MARGIN - 2 * (LABEL_FONT * capRatio) - 3 * refGlyph) / 4
    }

    /// LINE GAP is DERIVED, not constant. Big rows expand/contract so
    /// that the gap between every consecutive pair of lines (top
    /// label↔row 0, row↔row, row N↔bottom label) is exactly equal,
    /// filling whatever stack remains after small labels + big rows
    /// have been laid out. Solve once per face from the layout
    /// equation in `body`. Do not reintroduce a LINE_GAP constant.

    /// LEFT ALIGNMENT · visible left edge of every line lands at this X
    /// fraction of H. Each element's bounding-box offset is computed via
    /// `firstCharLSB(...)` so different first characters all visually
    /// align at this column.
    private let leadF: CGFloat = 0.060

    /// LABEL FONT FRACTION · top + bottom labels are this fraction of H.
    /// Big rows derive their size from the available data band.
    private let LABEL_FONT: CGFloat = 0.080

    /// HelveticaNeue-Bold cap-height ÷ point-size. Used to convert between
    /// font point size and visible cap height.
    private let capRatio: CGFloat = 0.73

    /// Crop factor — Text's line-box is taller than the cap. cropK pulls
    /// it back so element bounds ≈ visible cap bounds. The residual
    /// (cap-top doesn't land EXACTLY at offset.y) is captured by K_SMALL
    /// and K_BIG below, and pre-compensated in the offset.
    private let cropK: CGFloat = 0.22

    /// Cap-top residual offset, as a fraction of font size, AFTER the
    /// `.padding(.vertical, -size * cropK).fixedSize()` shrink. Empirically
    /// measured by pixel-counting on watchOS Ultra 3 sim (49mm, 422×514)
    /// against `cruise-warmup` fixture, build 78:
    ///   · label at size 41.12 (= LABEL_FONT · H) → residual = 1.3 px →  K_SMALL = 0.0316
    ///   · big row at size 133.6 (width-bound)   → residual = 5.8 px →  K_BIG   = 0.0434
    /// SwiftUI's negative-padding crop doesn't scale linearly with font
    /// size (line-height + leading metrics behave differently for small
    /// vs. large faces), so two calibration constants are required. The
    /// offset code subtracts `size · K_*` so the VISIBLE cap-top lands
    /// at the math-computed Y.
    static let K_SMALL: CGFloat = 0.0316
    static let K_BIG:   CGFloat = 0.0434

    /// Bottom safety reserved for the progress strip when present.
    private let stripBottomF: CGFloat = 0.075
    private let stripBarF: CGFloat = 0.027

    /// Top row width cap so it ends left of the OS clock (top-right).
    private let clockClearF: CGFloat = 0.70

    /// Left-side bearing of the FIRST character of a string, as a fraction
    /// of the font size. HelveticaNeue-Bold: digits / letters / punctuation
    /// each have their own visual ink offset inside the glyph's bounding
    /// box. To align visible left edges across rows we subtract this from
    /// each row's offset.x — so the BOUNDING BOX of a row starting with
    /// "8" sits slightly LEFT of a row starting with "1", but their
    /// VISIBLE ink edges land at the same X.
    ///
    /// This is the rule-of-law system: `H * leadF` is the canonical
    /// visible-left-edge X of every face. Bounding-box offsets are
    /// derived from it via this table. No per-row hand-tuning.
    static func firstCharLSB(_ s: String, fontSize: CGFloat) -> CGFloat {
        guard let c = s.first else { return 0 }
        let fraction: CGFloat
        switch c {
        case "1":                      fraction = 0.115 // HelveticaNeue-Bold "1" has a big internal LSB — the stem is in the middle of the glyph box, not at the left edge. Empirically measured on Ultra 3: visible "1" stem sits ~18px / F=157pt to the right of the bounding-box left edge. Compensate by pulling the row's offset.x left by 0.115·F so the "1" lines up with rows starting with "8" / "9".
        case "0", "6", "8", "9":       fraction = 0.06  // round bowls inset
        case "2", "3", "5":            fraction = 0.05
        case "4", "7":                 fraction = 0.04
        case "W", "M", "N":            fraction = 0.02
        case "—", "–":                 fraction = 0.00  // dashes start at origin
        default:                       fraction = 0.04
        }
        return fraction * fontSize
    }

    // rough per-glyph advance (em) for HelveticaNeue-Bold, to clear the clock
    // without measuring. CRITICAL: em-dash (—) and en-dash (–) are 1.0em /
    // 0.5em respectively by typographic definition — that's where the names
    // come from. Defaulting them to the digit width (0.56em) lets a
    // placeholder like "—:—" sneak past the width cap, the recipe then sizes
    // the font to the height-limit (~90pt vs the ~56pt a real pace gets),
    // and every row in the face inherits the oversized F. (Caught on real
    // hardware mid-run when GPS hadn't locked yet.)
    static func emWidth(_ s: String) -> CGFloat {
        s.reduce(0) { acc, c in
            switch c {
            case "—":            return acc + 1.00   // em-dash IS 1 em
            case "–":            return acc + 0.50   // en-dash IS ½ em
            case ":", ".", " ", ",": return acc + 0.30
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
            let hasBottomLabel = bottomLabel != nil && !hasStrip
            let hasTopLabel = (topLabel != nil) || (topIcon != nil)

            // ── Solve the layout equation ────────────────────────────────
            // Two branches:
            //
            // (A) hasTopLabel = true → ANCHORED layout.
            //     Top label cap-top at TOP_MARGIN (rides OS clock
            //     baseline). Bottom label cap-bot at 1-TOP_MARGIN.
            //     glyphF max under width cap. gap DERIVED from
            //     2·TOP_MARGIN + nLabels·labelCap + nRows·glyphF + nGaps·gap = 1
            //     so it equals LINE_GAP everywhere — top-label↔row 0,
            //     row↔row, row N↔bottom-label.
            //
            // (B) hasTopLabel = false → CENTERED layout.
            //     No clock-baseline anchor. Use CANONICAL_GAP (the gap
            //     value the warmup-canonical face produces). Center the
            //     row group vertically in the available stack (above
            //     the strip if present). Visual rhythm matches the
            //     anchored faces, position is symmetric.
            //
            // Strip replaces the bottom symmetric region in both modes.
            let labelCap = LABEL_FONT * capRatio
            let nRows = rows.count
            let nLabels = (hasTopLabel ? 1 : 0) + (hasBottomLabel ? 1 : 0)

            // Big numbers ALWAYS use the canonical gap. Locked by David:
            // "big numbers always need the approved line spacing. always.
            // we will NEVER space things out this wide. EVER." (2026-05-26)
            // Glyph size FLEXES vertically so the canonical gap can be
            // preserved while bottom margin stays symmetric to top.
            //
            // (A) hasTopLabel → ANCHORED. Top label cap-top at TOP_MARGIN
            //     (rides clock baseline). Big rows below the clock zone
            //     get full-screen width — they don't need to clear the
            //     OS clock since they're already below it. glyphF flexes
            //     to fill: 2·TOP_MARGIN + labels + N·glyphF + nGaps·gap = 1
            //     so bottom margin = top margin by construction.
            //
            // (B) !hasTopLabel → CENTERED. The top row sits at the top
            //     of the screen and competes with the OS clock at top-
            //     right, so it MUST use the clock-clear width cap. The
            //     row group is centered in the available area (above
            //     strip if present).
            //
            // The labelsTotal value is used in both branches.
            let labelsTotal = CGFloat(nLabels) * labelCap
            let nLines = nLabels + nRows
            let nGaps = max(nLines - 1, 0)
            let usedByGaps = CGFloat(nGaps) * CANONICAL_GAP

            // Width cap depends on whether the top line is a small label
            // (rows below clock) or the top row itself (competes with
            // clock at top-right).
            let widthAvailable: CGFloat = hasTopLabel
                ? (W - 2 * H * leadF)            // full screen minus bezel margins
                : (clockClearF * W - H * leadF)  // clear OS clock at top-right
            // Cap by the WIDEST row across the face — not just the first.
            // A row like "1:47:18" (h:mm:ss, 3.4 em) is far wider than
            // "9:02" (m:ss, 1.98 em); sizing on row 0 alone makes the
            // wider rows overflow the screen. Icons add ~0.58 em (icon +
            // HStack spacing per `rowContent`).
            let maxEm: CGFloat = rows.map { row in
                NumberFace.emWidth(row.text) + (row.icon != nil ? 0.58 : 0)
            }.max() ?? 0
            let widthF = maxEm > 0 ? widthAvailable / maxEm : .greatestFiniteMagnitude
            let glyphF_widthMax = (capRatio * widthF) / H

            // Vertical fit. Anchored: fill stack from TOP_MARGIN to
            // (1 - TOP_MARGIN). Centered: fit row group in available
            // area above any strip.
            // bottomReservation > strip > symmetric bottom (caller-provided
            // button overlay area gets priority).
            let centeredAreaBottom: CGFloat = {
                if let r = bottomReservation { return 1 - r }
                if hasStrip { return 1 - stripBottomF - stripBarF - 0.028 }
                return 1
            }()
            let glyphF_fitMax: CGFloat = {
                guard nRows > 0 else { return 0 }
                if hasTopLabel {
                    // Anchored: fill from TOP_MARGIN to the bottom edge.
                    // Bottom edge = strip-top / button-reservation-top
                    // when present, else the symmetric (1 - TOP_MARGIN) line.
                    let bottomEdge: CGFloat = (hasStrip || bottomReservation != nil)
                        ? centeredAreaBottom
                        : (1 - TOP_MARGIN)
                    return (bottomEdge - TOP_MARGIN - labelsTotal - usedByGaps) / CGFloat(nRows)
                } else {
                    return (centeredAreaBottom - labelsTotal - usedByGaps) / CGFloat(nRows)
                }
            }()
            let glyphF = max(0, min(glyphF_widthMax, glyphF_fitMax))
            let F = (glyphF / capRatio) * H

            // Gap is the canonical value in BOTH modes.
            let gap: CGFloat = CANONICAL_GAP

            // Row group position. Anchored: pinned below top label —
            // BUT if the rows are width-bound and don't fill the band
            // (1-row or short-content faces leave slack below), shift
            // down so the group is vertically centered in the band.
            // Prevents the "top-heavy single number floating with empty
            // bottom" look David flagged on GO / FUEL / CALIBRATE.
            // Multi-row anchored faces that fill the band exactly get
            // extraSpace ≈ 0 and stay at their natural top position.
            //
            // Centered (no top label): floats vertically in the
            // available area (above any strip or bottom reservation).
            let firstRowTop: CGFloat = {
                if hasTopLabel {
                    let bandTop = TOP_MARGIN + labelCap + gap
                    let bandBottom: CGFloat = (hasStrip || bottomReservation != nil)
                        ? centeredAreaBottom
                        : (1 - TOP_MARGIN)
                    let rowGroupHeight = CGFloat(nRows) * glyphF
                        + CGFloat(max(nRows - 1, 0)) * gap
                        + (hasBottomLabel ? gap + labelCap : 0)
                    let extraSpace = (bandBottom - bandTop) - rowGroupHeight
                    return bandTop + max(0, extraSpace / 2)
                } else {
                    let groupHeight = CGFloat(nRows) * glyphF
                        + CGFloat(nGaps) * gap
                        + (hasBottomLabel ? labelCap : 0)
                    return max(0, (centeredAreaBottom - groupHeight) / 2)
                }
            }()
            let pitchF = glyphF + gap
            // Bottom label (if any) sits one gap below the last row.
            let bottomLabelTop: CGFloat = firstRowTop + CGFloat(nRows) * pitchF
            let topLabelTop: CGFloat = TOP_MARGIN
            let startF = firstRowTop
            // ── Pixel-precise positioning via cropK + per-element
            // capCorrection. The negative vertical padding shrinks the
            // text's layout box to ≈ cap height, but the resulting
            // .offset(y:) lands the cap-top at `Y + capCorrection(size)`,
            // not at Y. capCorrection grows with font size (1.3 px at
            // labelSize, 5.8 px at width-bound big rows). Pre-compensate
            // the offset so the VISIBLE cap-top lands exactly at the
            // math-computed Y — that's what makes gaps + margins line
            // up to the pixel.
            //
            // Horizontal: each line's bounding-box x is `H * leadF -
            // firstCharLSB(...)`, so visible ink edges land at the same
            // column regardless of which character starts the row.
            ZStack(alignment: .topLeading) {
                faceBackground
                let alignmentX = H * leadF
                let labelSize = H * LABEL_FONT
                let labelCorrection = labelSize * Self.K_SMALL
                let rowCorrection = F * Self.K_BIG
                if let topIcon {
                    Image(systemName: topIcon)
                        .font(.system(size: labelSize, weight: .bold))
                        .foregroundStyle(topIconColor)
                        .padding(.vertical, -labelSize * cropK)
                        .fixedSize()
                        .offset(x: alignmentX, y: H * topLabelTop - labelCorrection)
                } else if let topLabel {
                    let lsb = NumberFace.firstCharLSB(topLabel.uppercased(), fontSize: labelSize)
                    Text(topLabel.uppercased())
                        .font(.custom("HelveticaNeue-Bold", size: labelSize))
                        .foregroundStyle(topLabelColor)
                        .padding(.vertical, -labelSize * cropK)
                        .fixedSize()
                        .offset(x: alignmentX - lsb, y: H * topLabelTop - labelCorrection)
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                    let lsb = NumberFace.firstCharLSB(r.text, fontSize: F)
                    rowContent(r, F)
                        .padding(.vertical, -F * cropK)
                        .fixedSize()
                        .offset(x: alignmentX - lsb, y: H * (startF + CGFloat(i) * pitchF) - rowCorrection)
                }
                if let bottomLabel, !hasStrip {
                    let lsb = NumberFace.firstCharLSB(bottomLabel.uppercased(), fontSize: labelSize)
                    Text(bottomLabel.uppercased())
                        .font(.custom("HelveticaNeue-Bold", size: labelSize))
                        .foregroundStyle(bottomLabelColor)
                        .padding(.vertical, -labelSize * cropK)
                        .fixedSize()
                        .offset(x: alignmentX - lsb, y: H * bottomLabelTop - labelCorrection)
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

// MARK: - Top-tag positioning (baseline-aligned with the OS clock)

extension View {
    /// Position a small top-left tag so its baseline lines up with the OS
    /// clock at the top-right. Empirically tuned on watchOS Ultra 3 against
    /// a `size: h * 0.06` FaceLabel — same numbers reliably hit the clock
    /// baseline on Series 9/10/SE because ResponsiveFace scales the canvas
    /// uniformly. Use everywhere a tag appears at the top of a face.
    func topTagInset(_ h: CGFloat) -> some View {
        self
            .padding(.top, h * 0.085)
            .padding(.leading, h * 0.020)
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
