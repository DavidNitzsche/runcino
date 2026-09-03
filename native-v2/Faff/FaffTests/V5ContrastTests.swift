//
//  V5ContrastTests.swift
//  faff.run iPhone · what the ink actually measures against what it sits on.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  The day-state panel is the one surface in the app whose background MOVES
//  under its own type. Every other fill is a flat step from the locked palette
//  and can be checked by eye once; a 135° oklab ramp cannot, because the same
//  12pt label measures 7.0:1 at one end of a row and 4.2:1 at the other.
//
//  Two rounds of fixes have now been landed on that ramp by reasoning about it
//  in prose, and both rounds got a sign wrong:
//
//    · Round one put WHITE type on the two light ramps. 1.94:1.
//    · Round two moved to dark ink but carried the dark-ramp habits across —
//      a .82 opacity haircut on the secondary tiers, and a plate that was
//      DARKENED to "invert with the ink". Under dark ink a dark plate pulls
//      the background toward the type: the stats plate's own 12pt label
//      measured 2.49:1, worse than having no plate at all.
//
//  So the ramp gets a test rather than a paragraph. Everything here samples
//  the REAL `V5Ramp.stops(...)` — the same function `DayPanel` paints with,
//  including the oklab conversion, the CSS easing hints and the 185% terminal
//  re-sampling — and the REAL `V5.PanelInk` tokens. Nothing is re-derived, so
//  a test cannot agree with itself while the app disagrees.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE DEPTHS ARE MEASURED, NOT GUESSED
//
//  A `LinearGradient` from `.topLeading` to `.bottomTrailing` puts a point at
//  `(x·W + y·H) / (W² + H²)` along its ramp, so a panel's ink depends on
//  BOTH coordinates. The bands below come from a device screenshot of screen
//  5a on an iPhone 17 (1206px / 393pt = 3.07 px/pt): panel bottom edge at
//  542pt, week-strip letters at 220pt and numbers at 244pt, cell centres from
//  43pt to 349pt. That puts the week strip at panel depth 0.30 to 0.60 — the
//  band this file guards.
//

import XCTest
import SwiftUI
import UIKit
@testable import Faff

final class V5ContrastTests: XCTestCase {

    // MARK: - WCAG plumbing

    private func rgb(_ c: Color) -> (r: Double, g: Double, b: Double, a: Double) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b), Double(a))
    }

    private func lin(_ v: Double) -> Double {
        v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
    }

    private func luminance(_ c: (r: Double, g: Double, b: Double, a: Double)) -> Double {
        0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }

    /// Source-over composite of a possibly-translucent ink onto an opaque
    /// background. This is what the renderer does and what the ink tokens rely
    /// on — they are expressed as an opacity precisely so they composite.
    private func over(_ fg: Color, _ bg: (r: Double, g: Double, b: Double, a: Double))
        -> (r: Double, g: Double, b: Double, a: Double) {
        let f = rgb(fg)
        return (f.r * f.a + bg.r * (1 - f.a),
                f.g * f.a + bg.g * (1 - f.a),
                f.b * f.a + bg.b * (1 - f.a),
                1)
    }

    private func contrast(_ fg: Color, on bg: (r: Double, g: Double, b: Double, a: Double)) -> Double {
        let a = luminance(over(fg, bg)), b = luminance(bg)
        let hi = max(a, b), lo = min(a, b)
        return (hi + 0.05) / (lo + 0.05)
    }

    /// The panel's own ramp, sampled at `depth` along the gradient line, using
    /// the app's real gradient builder.
    private func ramp(_ state: V5.DayState, at depth: Double) -> (r: Double, g: Double, b: Double, a: Double) {
        let stops = V5Ramp.stops(colors: state.stops, locations: state.locations)
        // `V5Ramp` hands SwiftUI 33 stops evenly spaced across 0…1, so the
        // nearest stop IS what the renderer draws within a JND.
        let nearest = stops.min { abs($0.location - depth) < abs($1.location - depth) }!
        return rgb(nearest.color)
    }

    // MARK: - Constants under test

    /// The two ramps `DayState.wantsDarkInk` marks light.
    private let lightRamps: [V5.DayState] = [.quality, .race]

    /// Measured from a device screenshot of 5a — see the file header.
    private let weekStripDepths: [Double] = stride(from: 0.30, through: 0.60, by: 0.05).map { $0 }

    private let normalText = 4.5
    private let largeText  = 3.0

    // MARK: - The ramp classification itself

    /// A ramp marked LIGHT must genuinely need dark ink — otherwise the
    /// boolean has drifted from the hexes and a panel is being inked for a
    /// problem it does not have.
    ///
    /// The converse is NOT asserted, and that is the finding rather than an
    /// omission: `easy` (2.45:1), `long` (2.42:1) and `phase` (2.77:1) all
    /// fail white on their own start stop too. `wantsDarkInk` is
    /// under-inclusive. See `testDarkRampSmallTypeGapHasNotWidened`.
    func testRampsMarkedLightGenuinelyNeedDarkInk() {
        for state in lightRamps {
            let white = contrast(.white, on: ramp(state, at: 0.0))
            XCTAssertLessThan(white, largeText,
                "\(state) is marked light, but white on its start stop measures "
                + "\(String(format: "%.2f", white)):1 — it does not need dark ink")
        }
    }

    // MARK: - The week strip · the regression this file was written for

    /// FAILS AGAINST THE PREVIOUS CODE.
    ///
    /// The week strip draws a 12pt letter in `quiet` and a 16pt number in
    /// `secondary`. Both are normal text at 4.5:1. With those tiers at
    /// `darkInk.opacity(0.82)` the whole strip failed — 5.03:1 down to 3.34:1
    /// across the row, with only the leftmost cell of the quality ramp
    /// clearing. Cells 1 to 5 now clear; see the ratchet below for 6 and 7.
    func testWeekStripSmallTypeClearsNormalTextOnLightRamps() {
        for state in lightRamps {
            let ink = state.ink
            for depth in weekStripDepths where depth <= 0.50 {
                let bg = ramp(state, at: depth)
                for (name, colour) in [("quiet · 12pt letter", ink.quiet),
                                       ("secondary · 16pt number", ink.secondary)] {
                    let c = contrast(colour, on: bg)
                    XCTAssertGreaterThanOrEqual(c, normalText,
                        "\(state) \(name) at panel depth \(String(format: "%.2f", depth)) "
                        + "measures \(String(format: "%.2f", c)):1, needs \(normalText):1")
                }
            }
        }
    }

    /// THE RESIDUAL, PINNED.
    ///
    /// The week strip is one row of identical type laid across a DIAGONAL
    /// ramp, so its seven cells sit at panel depths 0.30 through 0.60 and the
    /// same 12pt letter measures 5.89:1 in cell 1 and 4.35:1 in cell 7. Full
    /// opacity is already spent — these ARE the full-ink numbers — so cells 6
    /// and 7 land at 4.43:1 and 4.22:1 against 4.5:1.
    ///
    /// Closing the last 0.3 needs one of two things, both design decisions:
    /// a plate under the strip the way the stats plate has one, or a shallower
    /// ramp. The ramp is locked and the plate changes how all six panels look,
    /// so this is recorded rather than taken.
    ///
    /// It was 3.34:1 before this pass. The ratchet holds the gain.
    func testWeekStripDeepCellsHaveNotRegressed() {
        for state in lightRamps {
            for depth in [0.55, 0.60] {
                let c = contrast(state.ink.quiet, on: ramp(state, at: depth))
                XCTAssertGreaterThanOrEqual(c, 4.20,
                    "\(state) week-strip cell at depth \(depth) has REGRESSED to "
                    + "\(String(format: "%.2f", c)):1")
                XCTAssertLessThan(c, normalText,
                    "\(state) week-strip cell at depth \(depth) now measures "
                    + "\(String(format: "%.2f", c)):1 and CLEARS 4.5:1 · the design closed the "
                    + "gap, fold this back into testWeekStripSmallTypeClearsNormalTextOnLightRamps")
            }
        }
    }

    /// The tiers on EVERY ramp are ONE ink. Hierarchy is size and weight,
    /// because no ramp leaves opacity to spend. If a future edit
    /// reintroduces a haircut, the assertion above is the one that catches the
    /// contrast; this one catches the intent, so the reason is in the failure.
    ///
    /// WIDENED FROM LIGHT RAMPS TO ALL SIX. The dark ramps kept `secondary` at
    /// .78 and `quiet` at .62 on the same reasoning the light ramps had already
    /// abandoned, and it cost the same 1.3-1.6x. Measured on a rendered Block
    /// screen: `14 weeks to California International Marathon`, on bare ramp,
    /// 3.56:1 at .78 against 4.76:1 at full white — where 4.5 is the bar. The
    /// haircut was the difference between passing and failing.
    func testRampTiersAreOneInk() {
        for state in V5.DayState.allCases {
            let ink = state.ink
            XCTAssertEqual(rgb(ink.secondary).a, 1.0, accuracy: 0.001,
                "\(state) secondary is held back — this ramp has no opacity to spend")
            XCTAssertEqual(rgb(ink.quiet).a, 1.0, accuracy: 0.001,
                "\(state) quiet is held back — this ramp has no opacity to spend")
        }
    }

    // MARK: - The plate · the sign error

    /// FAILS AGAINST THE PREVIOUS CODE.
    ///
    /// A plate exists to lift its contents off the surface. Under dark ink
    /// that means the plate must be LIGHTER than the ramp it sits on. It was
    /// `darkInk.opacity(0.13)`, which is darker, so it moved the background
    /// toward the ink and cost contrast rather than adding it.
    ///
    /// NOW ALL SIX RAMPS. It used to read "LIGHT RAMPS ONLY, ON PURPOSE",
    /// because the four dark ramps carried a WHITE plate under WHITE ink —
    /// the identical mistake mirrored — and that was recorded as "the unfixed
    /// half of the problem … a design change to five more screens, not a token
    /// edit."
    ///
    /// It turned out to be a token edit after all. A rendered Block screen
    /// measured the stats plate's 12pt labels at 2.84:1 and 3.05:1; inverting
    /// the dark-ramp plate to `.black.opacity(0.20)` takes the same label to
    /// 4.85:1 without touching a single screen. So the exemption is spent and
    /// the scope is the whole enum — which is what it should always have been,
    /// since the rule ("a plate lifts away from its ink") never mentioned
    /// which direction the ink went.
    ///
    /// WHAT THIS TEST STILL CANNOT FAIL ON (Rule 22): it compares a plate
    /// against the BARE ramp under it, so it proves the plate is not making
    /// things worse. It does NOT prove the result clears 4.5:1 — that is
    /// `testStatPlateTypeClearsOnLightRamps` and its new dark-ramp sibling.
    /// A plate that improved contrast from 1.5:1 to 1.6:1 would pass here.
    func testPlateAndControlLiftAwayFromTheirInk() {
        for state in V5.DayState.allCases {
            let ink = state.ink
            for depth in [0.2, 0.5, 0.8] {
                let bare = ramp(state, at: depth)
                for (name, layer) in [("plate", ink.plate), ("control", ink.control)] {
                    let plated = over(layer, bare)
                    let onBare = contrast(ink.primary, on: bare)
                    let onPlate = contrast(ink.primary, on: plated)
                    XCTAssertGreaterThanOrEqual(onPlate, onBare,
                        "\(state) \(name) at depth \(depth) makes its own ink HARDER to read "
                        + "(\(String(format: "%.2f", onPlate)):1 on the \(name) vs "
                        + "\(String(format: "%.2f", onBare)):1 without it) — it is inverted")
                }
            }
        }
    }

    /// The stats plate carries a 12pt label in `secondary` and a 17pt semibold
    /// value in `primary`. It sits low on the panel, which is the deepest and
    /// therefore darkest part of the ramp any text reaches.
    func testStatPlateTypeClearsOnLightRamps() {
        for state in lightRamps {
            let ink = state.ink
            // Measured band for the plate on 5a: depth 0.57 to 0.85.
            for depth in stride(from: 0.57, through: 0.85, by: 0.07) {
                let bg = over(ink.plate, ramp(state, at: depth))
                let label = contrast(ink.secondary, on: bg)
                let value = contrast(ink.primary, on: bg)
                XCTAssertGreaterThanOrEqual(label, normalText,
                    "\(state) plate label at depth \(String(format: "%.2f", depth)) "
                    + "measures \(String(format: "%.2f", label)):1")
                XCTAssertGreaterThanOrEqual(value, largeText,
                    "\(state) plate value at depth \(String(format: "%.2f", depth)) "
                    + "measures \(String(format: "%.2f", value)):1")
            }
        }
    }

    /// FAILS AGAINST THE PREVIOUS CODE — 2.84:1 and 3.05:1 on a rendered Block
    /// screen, 2026-09-03.
    ///
    /// The dark ramps' own stats plate, which is what Block's `Quality share` /
    /// `Long run` / `This week's mileage` row and Races' `Goal` / `Projected`
    /// row sit inside. Same assertion as `testStatPlateTypeClearsOnLightRamps`,
    /// same measured depth band, pointed at the other four ramps — which is
    /// the half that had no clearance test at all while the plate was inverted.
    ///
    /// This is the test that would have caught the shipped defect. The
    /// "lift away" test above could not: a plate can be an improvement on the
    /// bare ramp and still be unreadable.
    func testStatPlateTypeClearsOnDarkRamps() {
        for state in V5.DayState.allCases where !state.wantsDarkInk {
            let ink = state.ink
            for depth in stride(from: 0.57, through: 0.85, by: 0.07) {
                let bg = over(ink.plate, ramp(state, at: depth))
                let label = contrast(ink.secondary, on: bg)
                let value = contrast(ink.primary, on: bg)
                XCTAssertGreaterThanOrEqual(label, normalText,
                    "\(state) plate label at depth \(String(format: "%.2f", depth)) "
                    + "measures \(String(format: "%.2f", label)):1, needs \(normalText):1")
                XCTAssertGreaterThanOrEqual(value, largeText,
                    "\(state) plate value at depth \(String(format: "%.2f", depth)) "
                    + "measures \(String(format: "%.2f", value)):1")
            }
        }
    }

    /// FAILS AGAINST THE PREVIOUS CODE.
    ///
    /// RULE ONE'S MARK HAS TO BE VISIBLE TO BE A MARK.
    ///
    /// `FaffValueText` hard-coded the modelled tilde to `V5.attention`. Amber
    /// on a tile is 9.28:1 and that is where the token was checked. On the two
    /// LIGHT ramps it is amber on amber: 1.45:1 on the stats plate, where the
    /// Races poster draws its projected finish time. The one glyph that says
    /// "this number is estimated rather than measured" was the least legible
    /// thing on the panel.
    /// LIGHT RAMPS ONLY. Amber fails on the four dark ramps too — it is amber
    /// on cyan, amber on green, amber on violet, and the luminances are close
    /// in every case. That is pre-existing and unchanged by this pass; it is
    /// pinned by `testDarkRampModelledMarkGapHasNotWidened` below.
    func testModelledMarkIsVisibleOnLightPanels() {
        for state in lightRamps {
            let ink = state.ink
            for depth in [0.3, 0.6, 0.85] {
                let bg = over(ink.plate, ramp(state, at: depth))
                let c = contrast(ink.mark, on: bg)
                XCTAssertGreaterThanOrEqual(c, largeText,
                    "\(state) modelled mark at depth \(depth) measures "
                    + "\(String(format: "%.2f", c)):1 · a runner cannot tell a projected "
                    + "number from a measured one")
            }
        }
        // Off a panel the mark stays amber, which is what it means everywhere
        // else and what the design states.
        XCTAssertGreaterThanOrEqual(contrast(V5.attention, on: rgb(V5.materialTile)), normalText)
    }

    /// RULE ONE'S MARK IS NOT VISIBLE ON ANY GRADIENT PANEL, AND ON FOUR OF
    /// THEM IT STILL IS NOT.
    ///
    /// Amber `#F2B03C` is a mid-luminance warm yellow. It reads beautifully on
    /// the near-black surface steps (9.28:1 on a tile) and that is where it was
    /// ever checked. On a day-state ramp it is competing with a saturated
    /// mid-luminance colour at every depth:
    ///
    ///   ramp     modelled mark on its stats plate, worst of three depths
    ///   easy                     1.37:1
    ///   long                     1.49:1
    ///   phase                    1.59:1
    ///   rest                     2.03:1
    ///
    /// The light ramps are fixed — they take the panel's dark ink, which keeps
    /// the tilde and drops a hue that was doing nothing anyway. The dark ramps
    /// cannot take the same fix: their ink is white, and a white tilde before a
    /// white number is not a mark at all.
    ///
    /// Closing this needs the design to say what marks a modelled number on a
    /// saturated ground — a different glyph, a rule, a small plate behind the
    /// value. Recorded rather than guessed at, because rule one is the app's
    /// first rule and inventing a treatment for it is not an audit's call.
    /// RE-MEASURED 2026-09-03. Inverting the dark-ramp plate to a dark scrim
    /// lifted the mark along with everything else standing on that plate:
    ///
    ///     easy  1.37 -> 2.46      phase 1.59 -> 2.95
    ///     long  1.49 -> 2.71      rest  2.03 -> 3.84   CLEARS
    ///
    /// `rest` is deleted rather than re-recorded, on this ratchet's own
    /// instruction. `phase` at 2.95 is within a rounding error of 3:1 and is
    /// still recorded as failing, because 2.95 is not 3.00 and a gate that
    /// rounds in its own favour is worth nothing.
    private let darkRampMarkFloor: [V5.DayState: Double] = [
        .easy: 2.46, .long: 2.71, .phase: 2.95,
    ]

    func testDarkRampModelledMarkGapHasNotWidened() {
        for (state, floor) in darkRampMarkFloor {
            XCTAssertFalse(state.wantsDarkInk,
                "\(state) is now a light ramp · delete its entry from darkRampMarkFloor")
            let worst = [0.3, 0.6, 0.85]
                .map { contrast(state.ink.mark, on: over(state.ink.plate, ramp(state, at: $0))) }
                .min()!
            XCTAssertGreaterThanOrEqual(worst, floor - 0.02,
                "\(state) modelled mark has REGRESSED to \(String(format: "%.2f", worst)):1 "
                + "from a recorded \(floor):1")
            XCTAssertLessThan(worst, largeText,
                "\(state) modelled mark now measures \(String(format: "%.2f", worst)):1 and CLEARS "
                + "3:1 · the design closed the gap, fold this back into "
                + "testModelledMarkIsVisibleOnLightPanels")
        }
    }

    /// A header disc's glyph is drawn in `primary` on `control`. It is a
    /// control, so its glyph is read as text. Light ramps only — see the note
    /// on `testPlateAndControlLiftAwayFromTheirInk`.
    func testHeaderDiscGlyphClearsOnLightRamps() {
        for state in lightRamps {
            let ink = state.ink
            // The header sits at the very top of the panel: depth 0.05–0.25.
            for depth in [0.05, 0.15, 0.25] {
                let disc = over(ink.control, ramp(state, at: depth))
                let c = contrast(ink.primary, on: disc)
                XCTAssertGreaterThanOrEqual(c, normalText,
                    "\(state) header disc glyph at depth \(depth) measures "
                    + "\(String(format: "%.2f", c)):1")
            }
        }
    }

    // MARK: - The display register on a light ramp
    //
    // FAILS AGAINST THE PREVIOUS CODE, via `RacesV5` and `BlockV5`, which drew
    // this register from `V5.OnPanel` (hard-coded white) instead of from their
    // own fill. Measured on device at 2.47:1 through 2.68:1. The token check
    // is here; the screens are covered by `testScreensOwningAFillComputeInk`.

    func testPrimaryInkClearsLargeTextEverywhereOnLightRamps() {
        for state in lightRamps {
            let ink = state.ink
            for step in 0...20 {
                let depth = Double(step) / 20.0
                let c = contrast(ink.primary, on: ramp(state, at: depth))
                XCTAssertGreaterThanOrEqual(c, largeText,
                    "\(state) primary ink at depth \(String(format: "%.2f", depth)) measures "
                    + "\(String(format: "%.2f", c)):1, under the \(largeText):1 large text needs")
            }
        }
    }

    // MARK: - The gap this audit could not close
    //
    // `DayState.wantsDarkInk` flags the two ramps whose START STOP is light
    // enough to fail the DISPLAY register. That is a real test and it caught
    // the two worst ramps. It is not the whole question.
    //
    // Measured at the positions the elements actually occupy on 5a, WHITE INK
    // FAILS THE SMALL REGISTER ON ALL FOUR REMAINING RAMPS:
    //
    //   ramp    week-strip 12pt letter   13pt kicker   plate 12pt label
    //   easy            2.09:1              2.67:1          2.49:1
    //   long            2.27:1              3.04:1          2.92:1
    //   phase           2.45:1              3.27:1          3.03:1
    //   rest            3.08:1              4.40:1          3.91:1
    //
    // `easy` is the most common day a runner sees, and it is the worst of the
    // four. `easy` and `long` additionally fail their 20pt display place label
    // (2.79:1 and 2.93:1) against the 3:1 large text needs.
    //
    // There is no token fix. Taking the dark-ramp tiers to FULL white — the
    // move that rescued the light ramps — lifts the easy week strip only to
    // 3.15:1, still short of 4.5:1. Closing this needs the design: a scrim or
    // a plate under the panel's small register, or darker ramp starts. Both
    // are decisions above an audit's authority, so this is pinned rather than
    // papered over.
    //
    // The assertion is a RATCHET. It records what each ramp measures today and
    // fails if any of them gets worse. It does not bless the numbers.

    /// The measured floor per ramp for the week strip's 12pt letter, which is
    /// the smallest and worst-placed type on the panel. Delete an entry when
    /// the design closes the gap, and this test will tell you to.
    /// RE-MEASURED 2026-09-03, after the dark-ramp tiers collapsed to one ink.
    /// The haircut was costing 1.3-1.6x here too, so every ramp moved up:
    ///
    ///     easy  2.09 -> 3.14      phase 2.45 -> 3.85
    ///     long  2.27 -> 3.51      rest  3.08 -> 5.25   CLEARS
    ///
    /// `rest` is GONE from this map rather than recorded higher, because this
    /// ratchet's own second assertion demands it: an entry whose gap has closed
    /// fails until it is deleted. That is the ratchet working, not a
    /// regression — `rest` is now covered by
    /// `testDarkRampWeekStripClearsWhereItCan` below.
    ///
    /// The remaining three still fail 4.5:1 and are still PINNED, not blessed.
    /// Full ink is now genuinely spent, so closing the last gap needs the
    /// design decision the previous pass named — a plate under the strip, or
    /// darker ramp starts — and that is above this change's authority.
    private let darkRampWeekStripFloor: [V5.DayState: Double] = [
        .easy: 3.14, .long: 3.51, .phase: 3.85,
    ]

    /// THE OTHER HALF OF DELETING A PIN.
    ///
    /// `rest` came off `darkRampWeekStripFloor` because it now clears 4.5:1
    /// across the whole strip. Deleting a pin must not delete the coverage —
    /// otherwise the ramp that just got fixed is the one nothing watches, and
    /// a future token edit could quietly take it back to 3.08:1 with no gate
    /// saying so.
    ///
    /// So every dark ramp NOT in the pin map is asserted positively, at every
    /// measured strip depth. The two maps and this test partition the four
    /// dark ramps between them: a ramp is either pinned as failing or asserted
    /// as passing, and it cannot be in neither.
    func testDarkRampWeekStripClearsWhereItCan() {
        let pinned = Set(darkRampWeekStripFloor.keys)
        let unpinned = V5.DayState.allCases.filter { !$0.wantsDarkInk && !pinned.contains($0) }
        XCTAssertFalse(unpinned.isEmpty,
            "every dark ramp is pinned as failing · this test is asserting nothing")
        for state in unpinned {
            for depth in weekStripDepths {
                let c = contrast(state.ink.quiet, on: ramp(state, at: depth))
                XCTAssertGreaterThanOrEqual(c, normalText,
                    "\(state) week-strip letter at depth \(String(format: "%.2f", depth)) "
                    + "measures \(String(format: "%.2f", c)):1 · it cleared 4.5:1 when its pin "
                    + "was deleted, so this is a REGRESSION")
            }
        }
    }

    func testDarkRampSmallTypeGapHasNotWidened() {
        // Week-strip letter, left cell: measured depth 0.30, ink `quiet`.
        for (state, floor) in darkRampWeekStripFloor {
            XCTAssertFalse(state.wantsDarkInk,
                "\(state) is now a light ramp · delete its entry from darkRampWeekStripFloor")
            let c = contrast(state.ink.quiet, on: ramp(state, at: 0.30))
            XCTAssertGreaterThanOrEqual(c, floor - 0.02,
                "\(state) week-strip letter has REGRESSED to \(String(format: "%.2f", c)):1 "
                + "from a recorded \(floor):1")
            XCTAssertLessThan(c, normalText,
                "\(state) week-strip letter now measures \(String(format: "%.2f", c)):1 and CLEARS "
                + "4.5:1 · the gap is closed, delete its entry from darkRampWeekStripFloor")
        }
    }

    // MARK: - Flat surfaces

    /// The four locked surface steps against the three text tiers. These do
    /// not move, so this is a tripwire rather than a discovery: it catches a
    /// token edit that looked harmless.
    func testTextTiersClearOnEverySurfaceStep() {
        let surfaces: [(String, Color)] = [
            ("surfacePage", V5.surfacePage), ("surface1", V5.surface1),
            ("materialTile", V5.materialTile), ("materialTileRaised", V5.materialTileRaised),
            ("materialControl", V5.materialControl),
        ]
        for (name, surface) in surfaces {
            let bg = rgb(surface)
            XCTAssertGreaterThanOrEqual(contrast(V5.textPrimary, on: bg), normalText, "textPrimary on \(name)")
            XCTAssertGreaterThanOrEqual(contrast(V5.textSecondary, on: bg), normalText, "textSecondary on \(name)")
            // `textQuiet` is the one tier with no headroom: it measures 4.92:1
            // on a tile and 4.40:1 on `materialControl`. The design does not
            // put quiet text on a control — a control carries `textPrimary` —
            // so the tile is the surface it is asserted against.
            if name != "materialControl" {
                XCTAssertGreaterThanOrEqual(contrast(V5.textQuiet, on: bg), normalText, "textQuiet on \(name)")
            }
        }
    }

    /// FAILS AGAINST THE PREVIOUS CODE.
    ///
    /// `SplitBars` drew an out-of-band mile in `materialControl` on a
    /// `materialTile`: 1.29:1. The fill is the only thing separating a mile
    /// that sat inside what the session asked for from one that did not — the
    /// height axis carries pace — so an invisible bar is a missing datum, not
    /// a quiet one.
    func testSplitBarsOutOfBandFillIsVisibleOnItsTile() {
        let tile = rgb(V5.materialTile)
        // The chart's own fill choice, not a copy of the token.
        let out = contrast(SplitBars.barFill(inBand: false), on: tile)
        let inb = contrast(SplitBars.barFill(inBand: true), on: tile)
        XCTAssertGreaterThanOrEqual(out, largeText,
            "the out-of-band split bar measures \(String(format: "%.2f", out)):1 against the tile "
            + "it is drawn on · a mile that fell outside the session is the one datum on this "
            + "chart a runner cannot see")
        XCTAssertGreaterThanOrEqual(inb, largeText,
            "the in-band split bar measures \(String(format: "%.2f", inb)):1 against its tile")
    }

    /// FAILS AGAINST THE PREVIOUS CODE.
    ///
    /// `ZoneBar`'s density ramp ran white .136 through .484, so Z1 (1.51:1),
    /// Z2 (2.06:1) and Z3 (2.81:1) were under the 3:1 a graphic needs. The
    /// extent of a segment is the content of a stacked bar.
    func testZoneBarRestFillsAreVisibleOnTheirTile() {
        let tile = rgb(V5.materialTile)
        for zone in 0..<5 {
            // The app's own ramp, not a copy of its arithmetic.
            let c = contrast(ZoneBar.restFill(zone), on: tile)
            XCTAssertGreaterThanOrEqual(c, largeText,
                "ZoneBar Z\(zone + 1) measures \(String(format: "%.2f", c)):1 against its tile")
        }
    }
}
