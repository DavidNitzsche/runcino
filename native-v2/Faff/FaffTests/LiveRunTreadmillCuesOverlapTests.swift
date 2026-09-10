//
//  LiveRunTreadmillCuesOverlapTests.swift
//  faff.run iPhone · TREADMILL-CUES-OVERLAP-1 — the cues menu may never
//  occlude the current-interval label.
//
//  Confirmed on device (2026-09-09), screen 12b (`-faffV5Screens 12b`), at
//  the default content size AND at the app's own Dynamic Type ceiling
//  (`FaffTypeScalingV5.ceiling`, `.accessibilityMedium`): `cuesMenu` was a
//  `.overlay(alignment: .topTrailing)` pinned to the screen's own
//  top-trailing corner, and `topRow`'s current-interval label is ALSO
//  right-aligned into that same corner (via its own `Spacer`). An overlay
//  never reserves layout space — it draws on top of whatever is already
//  there — so the label's trailing characters rendered directly underneath
//  the speaker glyph ("Warm u|p", "Interval N of |M"). This reproduced at
//  every Dynamic Type size tested (extra-small through the app's
//  accessibility ceiling) because neither element's geometry depends on
//  text size: the label is drawn at the fixed 34pt "value register" (see
//  `Font.faffText`'s own `scales` contract — nothing at or above
//  `TypeScaleV5.valueMin` follows the runner's text-size setting) and the
//  button is a fixed 36pt circle.
//
//  This is the one label the console exists to make legible from a few feet
//  away, mid-stride (Nielsen H1 — visibility of system status), so it may
//  never be silently covered, cues menu open or closed.
//
//  The fix moved `cuesMenu` from a floating `.overlay` into a real sibling
//  inside `topRow`'s own HStack, so SwiftUI's ordinary layout reserves its
//  width before anything else is drawn — the label's already-present
//  `.lineLimit(1)` + `.minimumScaleFactor` now shrinks INTO the space that
//  is actually left, rather than being drawn full-width and then covered.
//
//  This is a pure layout-composition change with no numeric formula to unit
//  test (per `V5GaugeGeometryTests`'s own model — "a pure-function seam
//  underneath a view"), so this test follows `LiveRunTreadmillNominalTests
//  .test_configurePhasesActuallyCallsTheSharedFunctions`'s pattern instead:
//  read the view's own source and assert the structural invariant a render
//  cannot otherwise gate. Falsified against the pre-fix source before this
//  landed (Rule 18) — the old file's `topRow` slice contained zero
//  occurrences of `cuesMenu`, and the full file contained the floating
//  `.overlay(alignment: .topTrailing) { cuesMenu` line this test forbids.
//
import XCTest
@testable import Faff

final class LiveRunTreadmillCuesOverlapTests: XCTestCase {

    private func fullSource() throws -> String {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "LiveRunTreadmillV5", withExtension: "swift")
                ?? Self.sourceURL())
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// The test bundle carries no resource copy of app sources, so resolve
    /// the file directly relative to this test file's own path — same trick
    /// as `LiveRunTreadmillNominalTests.sourceURL()`.
    private static func sourceURL() -> URL? {
        let thisFile = URL(fileURLWithPath: #filePath)
        return thisFile
            .deletingLastPathComponent() // FaffTests/
            .deletingLastPathComponent() // Faff/
            .appendingPathComponent("Faff/ViewsV5/LiveRunTreadmillV5.swift")
    }

    /// `topRow` is the property that draws the current-interval label. Slice
    /// its own source between two stable anchors already in the file — the
    /// property's own declaration and the very next property's — rather than
    /// counting braces, so the test reads the same way a person auditing the
    /// file would.
    private func topRowSource(in src: String) throws -> String {
        guard let start = src.range(of: "private var topRow: some View {"),
              let end = src.range(of: "private var intervalShortText: String {", range: start.upperBound..<src.endIndex)
        else {
            XCTFail("topRow or intervalShortText anchor not found — the file moved and this test's anchors need updating")
            return ""
        }
        return String(src[start.lowerBound..<end.lowerBound])
    }

    /// THE regression this whole file exists to catch: a floating overlay
    /// pinned to the screen's own top-trailing corner, independent of
    /// `topRow`'s own layout, is exactly what let the cues menu draw over
    /// the interval label. Confirmed this exact string was present, and the
    /// collision reproduced on device, before the fix.
    func test_cuesMenuIsNeverAFloatingTopTrailingOverlay() throws {
        let src = try fullSource()
        XCTAssertFalse(src.contains(".overlay(alignment: .topTrailing) { cuesMenu"),
                        "cuesMenu must not float as a screen-corner overlay — that overlay drew on top of topRow's " +
                        "current-interval label, which is right-aligned into the exact same corner. Compose cuesMenu " +
                        "as a real layout sibling instead, so its width is reserved rather than drawn over.")
    }

    /// The positive half: `cuesMenu` is composed INSIDE `topRow`'s own
    /// layout, in the same row as the label it must never cover — so
    /// SwiftUI's ordinary stack layout reserves its space by construction.
    func test_cuesMenuIsComposedInsideTopRowsOwnLayout() throws {
        let src = try fullSource()
        let topRow = try topRowSource(in: src)
        XCTAssertTrue(topRow.contains("cuesMenu"),
                       "cuesMenu must be a sibling inside topRow's own HStack — that's what reserves its width " +
                       "before the interval label is laid out, instead of drawing over it after the fact.")
    }

    /// `cuesMenu` is a non-text view; without an explicit baseline guide it
    /// would fall back to its own default inside a `.lastTextBaseline`
    /// HStack, which reads as visibly low against the 34pt label beside it.
    /// This is a visual-quality assertion, not a correctness one, but it is
    /// exactly the kind of "looked fine in the diff, wrong on the runner's
    /// phone" gap Rule 13 exists to catch — cheap to keep honest here since
    /// the source already states the intent.
    func test_cuesMenuCarriesAnExplicitBaselineGuide() throws {
        let src = try fullSource()
        let topRow = try topRowSource(in: src)
        XCTAssertTrue(topRow.contains(".alignmentGuide(.lastTextBaseline)"),
                       "cuesMenu sits in a .lastTextBaseline HStack next to 34pt text — without an explicit " +
                       "alignment guide it adopts a default baseline that reads visibly low next to the label.")
    }

    /// The label's own overflow contract must still be intact — this is what
    /// actually keeps a long "Interval N of M" readable once cuesMenu's
    /// fixed-width sibling narrows the space left for it. Losing either half
    /// would silently reintroduce truncation-behind-the-icon in a new shape.
    func test_intervalLabelStillShrinksToFitRatherThanClipping() throws {
        let src = try fullSource()
        let topRow = try topRowSource(in: src)
        XCTAssertTrue(topRow.contains(".lineLimit(1)"),
                       "the interval label must stay single-line — without this a long label wraps under cuesMenu " +
                       "instead of shrinking to fit beside it")
        XCTAssertTrue(topRow.contains(".minimumScaleFactor("),
                       "the interval label must be allowed to shrink — without this a long label clips instead of " +
                       "reading in full at a smaller size")
    }
}
