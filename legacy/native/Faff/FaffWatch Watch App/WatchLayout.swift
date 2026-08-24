//
//  WatchLayout.swift
//  FaffWatch
//
//  Apple's layout guides, as numbers. THE SKELETON EVERY BOARD SITS IN.
//
//  SOURCE: "Apple watchOS UI Kit.sketch", page "Layout Guides", artboards
//  `Guides - Layout / {44,46,49}mm / {Foundation, Pill, Three Bottom Controls,
//  List View, Infographic}`. Read out of the file's own JSON — not measured
//  off a screenshot, not inferred from a fraction, not derived from one size
//  and scaled.
//
//  RULING (David, 2026-08-23): "Apples templates win. You need to set up the
//  watch app to be correct and then port our designs into it."
//
//  So where the 0821 handoff and this file disagree, THIS FILE WINS on
//  geometry — margins, control size, row positions. The handoff still owns
//  everything else: palette, type, copy, what each board says and what it
//  refuses to say. Geometry is the platform's; meaning is the design's.
//
//  WHAT CAME BEFORE, so nobody repeats it
//
//  The boards were laid out three times without opening this kit.
//    1. Ignore the safe area, hardcode 22pt top / 10pt sides. Too tight at the
//       sides, so a full-width control ran into the corner curve. Tuned to one
//       device.
//    2. Respect the system safe area instead. Measured: top 53 / bottom 36 on
//       a 46mm out of 248pt, because watchOS reserves a navigation title area
//       this app does not use. A third of the display went dead.
//    3. Fractions of screen size. Closer, but wrong: the margins are 5.7% of
//       width at 44mm, 7.2% at 46mm and 7.6% at 49mm. There is no single
//       fraction, which is why this is a table.
//

import SwiftUI
import WatchKit

enum WatchLayout {

    // MARK: - One device's guides

    struct Guides {
        let screen: CGSize

        /// The content rectangle. Everything a board draws lives inside it.
        let margins: CGRect

        /// Primary full-width control: `Guides - Layout / Pill`.
        let pill: CGRect

        /// First text baseline under the top margin.
        let firstBaseline: CGFloat

        /// Where content must start to clear the SYSTEM CLOCK.
        ///
        /// Apple's content box starts at 18 on a 46mm and the clock's own ink
        /// sits at y 20-34 — measured off the simulator, not assumed. So the
        /// top of Apple's box is inside the clock's line, and any board whose
        /// first element is display-register type lands level with the time.
        /// Small-caps kickers beside the clock are a normal watchOS pattern
        /// and read fine; a 26pt word does not.
        ///
        /// This is the number the design's own rule 5 was reaching for when it
        /// said "the top 22pt of every board is empty". 22 was measured off the
        /// design file's shell; this is measured off the device.
        var clockClearance: CGFloat { 36 }

        /// `Three Bottom Controls`: two 35pt side slots and one 46pt centre
        /// slot, all sharing a centre line.
        let sideControl: CGFloat
        let centerControl: CGFloat
        let controlCenterY: CGFloat
        let sideControlX: (leading: CGFloat, trailing: CGFloat)
        let centerControlX: CGFloat

        /// `List View`: where the header rule sits, and where the first
        /// screenful ends. The fold is the number the summary's
        /// "never slice a row" rule has to be computed against — it is NOT
        /// the screen height.
        let listHeaderRule: CGFloat
        let scrollFold: CGFloat

        /// `Infographic`: the row positions a dense data board snaps to.
        /// These are absolute y values from the top of the display.
        let infographicRows: [CGFloat]

        /// The same guides, reported against the real display.
        ///
        /// The margins, control slots and rows are kept exactly as Apple
        /// measured them; only `screen` and the widths that hang off the right
        /// margin follow the device.
        func onScreen(_ size: CGSize) -> Guides {
            guard size != screen else { return self }
            let dw = size.width - screen.width
            return Guides(
                screen: size,
                margins: CGRect(x: margins.minX, y: margins.minY,
                                width: margins.width + dw, height: margins.height),
                pill: CGRect(x: pill.minX, y: pill.minY,
                             width: pill.width + dw, height: pill.height),
                firstBaseline: firstBaseline,
                sideControl: sideControl, centerControl: centerControl,
                controlCenterY: controlCenterY,
                sideControlX: (sideControlX.leading, sideControlX.trailing + dw),
                centerControlX: centerControlX + dw / 2,
                listHeaderRule: listHeaderRule,
                scrollFold: scrollFold + (size.height - screen.height),
                infographicRows: infographicRows
            )
        }

        var contentWidth: CGFloat { margins.width }
        var leading: CGFloat { margins.minX }
        var top: CGFloat { margins.minY }
        var bottom: CGFloat { screen.height - margins.maxY }
    }

    // MARK: - The table

    private static let guides: [Int: Guides] = [
        224: Guides(
            screen: CGSize(width: 184, height: 224),
            margins: CGRect(x: 10.5, y: 12.5, width: 163, height: 199),
            pill: CGRect(x: 10.5, y: 162.5, width: 163, height: 51),
            firstBaseline: 29,
            sideControl: 34, centerControl: 44.5, controlCenterY: 194.5,
            sideControlX: (10.5, 139.5), centerControlX: 69.8,
            listHeaderRule: 45.8, scrollFold: 194,
            infographicRows: [29, 45.8, 61.8, 126.2, 151.8, 185.8, 202.2]
        ),
        248: Guides(
            screen: CGSize(width: 208, height: 248),
            margins: CGRect(x: 15, y: 18, width: 178, height: 212),
            pill: CGRect(x: 15, y: 180.5, width: 178, height: 52.5),
            firstBaseline: 34.2,
            sideControl: 35, centerControl: 46, controlCenterY: 212.5,
            sideControlX: (15, 158), centerControlX: 81,
            listHeaderRule: 59.8, scrollFold: 207.2,
            infographicRows: [34.8, 52, 68.3, 141.8, 167.8, 203.8, 221.2]
        ),
        251: Guides(
            screen: CGSize(width: 205, height: 251),
            margins: CGRect(x: 15.5, y: 19, width: 174, height: 213),
            pill: CGRect(x: 15.5, y: 181.5, width: 174, height: 54),
            firstBaseline: 36.5,
            sideControl: 36, centerControl: 47, controlCenterY: 214,
            sideControlX: (15.5, 153.5), centerControlX: 79,
            listHeaderRule: 63.5, scrollFold: 211.2,
            infographicRows: [36.5, 54.2, 72.2, 141.2, 168.2, 204.3, 222.2]
        ),
    ]

    /// The guides for the watch this is running on.
    ///
    /// Keyed on screen HEIGHT, which is unique across the three current sizes
    /// (224 / 248 / 251) where width is not — 46mm is 208 wide and 49mm 205,
    /// so a width key sorts them backwards.
    static var current: Guides {
        let b = WKInterfaceDevice.current().screenBounds
        let h = Int(b.height.rounded())
        if let exact = guides[h] { return exact }
        // Nearest shipped size within a few points, else scale the 46mm guide.
        //
        // A NEAR MATCH KEEPS APPLE'S MARGINS AND THE DEVICE'S OWN SIZE.
        //
        // Returning the table row verbatim handed callers the size of the
        // watch the row was measured on, not the one in the user's hand — and
        // both current watches are near matches, not exact ones: the Series 11
        // 42mm is 187x223 against the kit's 184x224, and the Ultra 3 is
        // 211x257 against the Ultra 2's 205x251. Every board is pinned to
        // `screen`, so the ramp stopped 3pt short of the left and right bezels
        // on both, which is precisely the full-bleed failure this was pinned
        // to fix. Caught only by rendering on all three sizes.
        //
        // The margins are still Apple's, unscaled: they are a physical
        // thumb-and-bezel measurement, not a fraction of the display.
        if let near = guides.keys.min(by: { abs($0 - h) < abs($1 - h) }), abs(near - h) <= 6 {
            return guides[near]!.onScreen(CGSize(width: b.width, height: b.height))
        }
        return scaled(to: CGSize(width: b.width, height: b.height))
    }

    /// A size Apple has not shipped yet. Scales the 46mm guide rather than
    /// reusing it verbatim, because a future watch will be a different size
    /// and 15pt of margin on a much narrower screen is a different design.
    private static func scaled(to size: CGSize) -> Guides {
        let base = guides[248]!
        let sx = size.width / base.screen.width
        let sy = size.height / base.screen.height
        func r(_ rect: CGRect) -> CGRect {
            CGRect(x: rect.minX * sx, y: rect.minY * sy,
                   width: rect.width * sx, height: rect.height * sy)
        }
        return Guides(
            screen: size,
            margins: r(base.margins),
            pill: r(base.pill),
            firstBaseline: base.firstBaseline * sy,
            sideControl: base.sideControl * sx,
            centerControl: base.centerControl * sx,
            controlCenterY: base.controlCenterY * sy,
            sideControlX: (base.sideControlX.leading * sx, base.sideControlX.trailing * sx),
            centerControlX: base.centerControlX * sx,
            listHeaderRule: base.listHeaderRule * sy,
            scrollFold: base.scrollFold * sy,
            infographicRows: base.infographicRows.map { $0 * sy }
        )
    }
}
