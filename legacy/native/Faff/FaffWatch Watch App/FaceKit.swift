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
    static let live   = Color(hex: 0x3EBD41) // Success — on-pace / governed
    static let goal   = Color(hex: 0xF3AD38) // Attention — target / "act now" (fuel)
    static let dist   = Color(hex: 0x27B4E0) // Light Blue — DISTANCE, always
    static let over   = Color(hex: 0xFC4D64) // Warning — off / behind / over ceiling (LIVE DATA)
    static let redish = Color(hex: 0xD03F3F) // Destructive-action red (BUTTONS — matches web --color-phase-2)
    static let rest   = Color(hex: 0x008FEC) // Corporate blue — recovery / landmark chrome
    static let ink    = Color(hex: 0xF6F7F8) // neutral readout (white)
    static let mute   = Color(hex: 0x8A90A0)
    static let dim    = Color(hex: 0x646464)
    static let brand  = Color(hex: 0x008FEC)
    static let bonus  = Color(hex: 0xA78BFA) // purple — distance gone past the plan (counts up)
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
    /// Background color for the face. Defaults to black; override for
    /// washed takeovers (GoFace = green wash, etc).
    var faceBackground: Color = .black

    // ═══════════════════════════════════════════════════════════════════
    // LAYOUT RULES — every face built on NumberFace obeys these.
    // Change a rule here and the WHOLE face recomputes. Stop nudging.
    // ═══════════════════════════════════════════════════════════════════

    /// TOP MARGIN · empty space from screen top to top label cap.
    /// Locked: 0.050 puts the top label baseline on the OS clock's
    /// baseline (the system clock occupies the status-bar zone above
    /// this and "absorbs" the perceived top whitespace).
    private let TOP_MARGIN: CGFloat = 0.050

    /// BOTTOM MARGIN · empty space from bottom label cap-bottom to screen
    /// bottom. BIGGER than TOP_MARGIN because the bottom has no status
    /// bar to absorb whitespace — what you see is what you get. The
    /// extra margin gives the bottom label the same VISUAL breathing
    /// room as the top label has (where the status bar provides it).
    ///
    /// Value 0.147 is the rules-consistent calibration: at this margin
    /// the height-bound row size equals the width-bound row size (the
    /// top row's clock-clearance cap). That makes the `max(0, …)`
    /// centering offset evaluate to zero, so every consecutive pair of
    /// lines — top label↔row 0, row↔row, row N↔bottom label — sits at
    /// exactly LINE_GAP. Smaller values (e.g. 0.090) re-introduce a
    /// centering pad that silently inflates the top-label↔row 0 gap
    /// well above LINE_GAP, breaking rule #3. Larger values shrink the
    /// big rows below the width cap, breaking rule #5.
    private let BOTTOM_MARGIN: CGFloat = 0.147

    /// LINE GAP · vertical gap between ANY two consecutive lines, measured
    /// cap-bottom to cap-top. Same value whether the lines are two big
    /// rows, a label-to-row, or a row-to-label. ONE gap rule.
    private let LINE_GAP: CGFloat = 0.030

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
    /// it back so element bounds ≈ visible cap bounds.
    private let cropK: CGFloat = 0.22

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
        case "1":                      fraction = 0.00  // narrow stem at left edge
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
            let hasBottomLabel = bottomLabel != nil
            let hasTopLabel = (topLabel != nil) || (topIcon != nil)
            let bigN = CGFloat(rows.count)

            // ── Derive ALL positions from the layout rules above ─────────
            // (TOP_MARGIN, BOTTOM_MARGIN, LINE_GAP, LABEL_FONT, leadF)
            // No magic numbers in this block. Want to change the look?
            // Edit a rule at the top of NumberFace and recompile — the
            // whole face recomputes.
            let labelCap = LABEL_FONT * capRatio

            // Top label sits at TOP_MARGIN with cap-bottom at TOP_MARGIN +
            // labelCap. Data band starts LINE_GAP below the label cap-bottom.
            let topLabelTop: CGFloat = TOP_MARGIN
            let bandTop: CGFloat = hasTopLabel
                ? (topLabelTop + labelCap + LINE_GAP)
                : 0.060   // bare default when no top label
            // Bottom label cap-bottom is at (1 - BOTTOM_MARGIN). Its cap-top
            // is one cap above that. Data band ends LINE_GAP above the
            // label cap-top.
            let bottomLabelTop: CGFloat = 1 - BOTTOM_MARGIN - labelCap
            let bandBottom: CGFloat = hasStrip
                ? (1 - stripBottomF - stripBarF - 0.028)
                : (hasBottomLabel ? (bottomLabelTop - LINE_GAP) : (1 - 0.060))
            let span = bandBottom - bandTop

            // Big rows fill the band: N caps + (N-1) gaps = span.
            // → glyphF = (span - (N-1) * LINE_GAP) / N.
            let heightG = (span - LINE_GAP * (bigN - 1)) / bigN
            let heightF = (heightG / capRatio) * H

            // Width cap so the TOP row clears the OS clock (top-right).
            let clearance = clockClearF * W - H * leadF
            let topEm = NumberFace.emWidth(rows.first?.text ?? "")
            let widthF = topEm > 0 ? clearance / topEm : heightF
            let F = max(1, min(heightF, widthF))

            // After possibly being width-capped, recompute glyph height +
            // pitch. Pitch = cap height + LINE_GAP. ONE inter-line spacing
            // rule across all rows AND the bottom label.
            let glyphF = (capRatio * F) / H
            let pitchF = glyphF + LINE_GAP
            let groupSpan = (bigN - 1) * pitchF + glyphF
            // Center the row group inside the data band (small symmetric
            // padding if the width cap shrunk the rows).
            let startF = bandTop + max(0, (span - groupSpan) / 2)
            // ── Locked rule: one leadF, applied identically to every
            // element on the face. Labels share HelveticaNeue-Bold with
            // the digits (NOT FaceLabel's system font, NOT the
            // .tracking() spread that throws off the leading edge).
            // Smaller text + same font + same offset = same metric
            // origin. The font's own bearing decides what shows where;
            // we don't fight it with per-element nudges.
            ZStack(alignment: .topLeading) {
                faceBackground
                // Top label (or icon) — baseline-aligned with the OS clock.
                // y: 0.067 puts text TOP at ~17pt on Ultra, baseline at
                // ~28pt — matches the system clock's baseline (top-right).
                // ── Rule of law: every visible left edge lands at H * leadF.
                // Each element's bounding-box offset.x is `H * leadF -
                // firstCharLSB(...)` so the visible ink edge ends up at
                // exactly H * leadF regardless of which character starts
                // the row. No per-element nudging.
                let alignmentX = H * leadF
                let labelSize = H * LABEL_FONT
                if let topIcon {
                    Image(systemName: topIcon)
                        .font(.system(size: labelSize, weight: .bold))
                        .foregroundStyle(topIconColor)
                        .padding(.vertical, -labelSize * cropK)
                        .fixedSize()
                        .offset(x: alignmentX, y: H * topLabelTop)
                } else if let topLabel {
                    let lsb = NumberFace.firstCharLSB(topLabel.uppercased(), fontSize: labelSize)
                    Text(topLabel.uppercased())
                        .font(.custom("HelveticaNeue-Bold", size: labelSize))
                        .foregroundStyle(topLabelColor)
                        .padding(.vertical, -labelSize * cropK)
                        .fixedSize()
                        .offset(x: alignmentX - lsb, y: H * topLabelTop)
                }
                // Big number rows — each compensates for its own first-char LSB.
                ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                    let lsb = NumberFace.firstCharLSB(r.text, fontSize: F)
                    rowContent(r, F)
                        .padding(.vertical, -F * cropK)
                        .fixedSize()
                        .offset(x: alignmentX - lsb, y: H * (startF + CGFloat(i) * pitchF))
                }
                // Bottom label — same LSB-aligned rule as every other line.
                // Negative vertical padding crops SwiftUI's Text line box
                // down to the cap height, so .offset positions the visible
                // cap top — symmetric with the top label and big rows.
                if let bottomLabel {
                    let lsb = NumberFace.firstCharLSB(bottomLabel.uppercased(), fontSize: labelSize)
                    Text(bottomLabel.uppercased())
                        .font(.custom("HelveticaNeue-Bold", size: labelSize))
                        .foregroundStyle(Faff.mute)
                        .padding(.vertical, -labelSize * cropK)
                        .fixedSize()
                        .offset(x: alignmentX - lsb, y: H * bottomLabelTop)
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
