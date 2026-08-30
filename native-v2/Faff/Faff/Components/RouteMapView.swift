//
//  RouteMapView.swift
//  Native mirror of the web's RouteMap.tsx — a pace-graded run route on
//  CartoDB Dark Matter tiles.
//
//  2026-08-28 · MIGRATED OFF MKMapView + MKTileOverlay. CARTO retired its
//  raster tile CDN — the old `basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x
//  .png` endpoint this file used to point an MKTileOverlay at now returns an
//  "API KEY REQUIRED" watermark tile UNCONDITIONALLY, confirmed by direct
//  testing that a valid key makes no difference. CARTO only continues to
//  serve vector tiles, consumed here via a ready-made MapLibre GL style JSON
//  (basemaps.cartocdn.com/gl/dark-matter-gl-style) — CARTO's own "Dark
//  Matter" style, which is the exact look this file was already going for.
//  MLNMapView (MapLibre GL Native, a Swift Package — see project.yml
//  `packages:`) replaces MKMapView; the route/gradient/endpoint overlays are
//  rebuilt as MLNShapeSource + MLNStyleLayer instead of MKOverlay subclasses.
//  See CartoConfig.swift for the style-key plumbing.
//
//  Why a vector basemap and not Apple's own: CartoDB's dark basemap has far
//  more muted street labels than Apple's standard style, so the names recede
//  instead of fighting the route (David 2026-06-16 · "the street names over
//  the route is weird … do it the same way we do it on the web app"). That
//  reasoning is untouched by the tile-format migration — CARTO's GL style
//  carries the same muted-label design, and `showLabels: false` swaps in
//  CARTO's dedicated "Dark Matter without labels" style (the vector-tile
//  equivalent of the old `dark_nolabels` raster variant) for race courses
//  that span a whole city.
//
//  Stack:
//   · CARTO's "Dark Matter" MapLibre GL style, rendered by MLNMapView.
//   · A CONTINUOUS PACE GRADIENT · attention amber (the run's own slowest)
//     through to signal orange (its own fastest), normalised across the run's
//     OWN range rather than against any prescription. Baseline signal underlay
//     drawn first so the line shows even if the gradient walk degenerates.
//   · Endpoints · start = green ring, finish = coral dot.
//   · Non-interactive · reads as a still image embedded in the card.
//

import SwiftUI
import MapLibre
import CoreLocation
import UIKit

/// 2026-08-30 · REGRESSION FIX — route line missing on real GPS runs, live on
/// TestFlight 244, confirmed on David's own phone (endpoints + basemap fine,
/// the polyline alone absent).
///
/// `makeUIView` creates the `MLNMapView` at `frame: .zero` — its real size
/// only exists once SwiftUI finishes laying the card out. Style loading is
/// asynchronous and races that layout pass. When `didFinishLoadingStyle:`
/// fires FIRST (confirmed by instrumented on-device-equivalent logging: a
/// real launch caught `didFinishLoading` firing with `map.bounds ==
/// (0, 0, 0, 0)`), `drawRoute`'s `setVisibleCoordinateBounds` call fits the
/// camera against a ZERO-SIZED viewport — MapLibre computes a degenerate
/// transform, landing the camera roughly 70km from the run's actual
/// location (measured directly: fit for a Mission-district SF sample route,
/// `(lat 37.7749, lng -122.4194)`, produced a centre of `(37.105,
/// -122.601)`). One second later the SAME logging showed `map.bounds`
/// correctly resolved to `(0, 0, 334, 200)` — but the camera was never
/// recomputed, because `updateUIView` is not guaranteed to fire again
/// merely because AutoLayout resolved the represented UIView's frame — it
/// only reliably fires on SwiftUI's OWN state diffs, and a static
/// `RunDetail` screen may have none after the first render. The basemap
/// tiles for that wrong, distant location still load fine (a real CARTO
/// style, just pointed at the wrong 200×200 pt patch of the planet), and the
/// whole route collapses into a sub-pixel cluster at that off-target zoom —
/// which is why start/finish (which always draw regardless of the line's
/// length) still show as two dots while the connecting line reads as
/// genuinely absent, matching the reported symptom exactly.
///
/// `FaffRouteMapView` closes the gap the SDK doesn't: it is the one thing
/// in this file that IS guaranteed to observe the view's real bounds
/// resolving, because `layoutSubviews` is UIKit's own hook for exactly this,
/// independent of whatever triggered the layout pass. Combined with
/// `drawRoute` skipping the camera fit while bounds are still zero (below),
/// the route now draws either immediately (bounds already valid — the
/// common case, unaffected) or the instant AutoLayout gives the view its
/// real size (the race case this fixes), and never draws against a bogus
/// viewport in between.
private final class FaffRouteMapView: MLNMapView {
    var onBoundsSettled: (() -> Void)?
    private var lastSettledBounds: CGRect = .zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.height > 0, bounds != lastSettledBounds else { return }
        lastSettledBounds = bounds
        onBoundsSettled?()
    }
}

struct RouteMapView: UIViewRepresentable {
    let coords: [CLLocationCoordinate2D]
    let splits: [RunSplit]
    /// Workout phases (distance + pace). When present (intervals / tempo) the
    /// route colors by PHASE — so the reps and the tempo block read at their
    /// true pace instead of being smeared into mile-split averages. Empty for
    /// easy / long runs → the per-mile gradient. (David 2026-06-16: "the
    /// heat map should show what was important to that run.")
    var phases: [PhaseSample] = []

    /// The run's effort decides the color AXIS (David 2026-06-17):
    ///   · steady runs (easy / long / recovery) color by HR ZONE — on those
    ///     days the story is zone discipline (am I holding Z2?), not pace wiggle,
    ///     so a faster→slower pace gradient there is just noise.
    ///   · structured runs (tempo / intervals / race) color by pace / phase —
    ///     pace IS the target, and the reps must read at their true pace.
    var effort: FaffEffort = .easy

    /// LTHR-derived zone bands · enables HR-zone coloring on steady runs. Empty
    /// (no physiology) → falls back to the per-mile pace gradient.
    var hrZones: [HRZoneRange] = []

    /// Place labels on the basemap. The post-run route keeps them (small area,
    /// names recede). The race course map spans a whole city, where CartoDB's
    /// baked "SAN DIEGO / CORONADO" labels render huge — pass false there to use
    /// the label-free GL style for a clean route (David 2026-06-17).
    var showLabels: Bool = true

    /// True when this run colors by HR zone (steady effort + per-mile HR + zone
    /// bands present, and not a structured/phase workout). The single rule, used
    /// by both the route coloring and the card's legend so they never diverge.
    ///
    /// 2026-08-30 · THE `paceBand` ARGUMENT IS GONE, along with the band axis
    /// it gated. The map no longer knows what the session prescribed, so
    /// "a prescription outranks the axis" has nothing left to decide. See
    /// `gradientSegments()` for the ruling that removed it. Behaviour is
    /// unchanged at every call site: the v5 route cards pass no zone bands at
    /// all, and the one card that does — legacy `RoutePolylineCard` — never
    /// passed a band either.
    static func usesHrZones(effort: FaffEffort, hrZones: [HRZoneRange],
                            splits: [RunSplit], phases: [PhaseSample]) -> Bool {
        guard phases.filter({ $0.mi > 0 && $0.sec > 0 }).count < 2 else { return false }
        guard [.easy, .long, .recovery].contains(effort) else { return false }
        guard hrZones.count >= 2 else { return false }
        return splits.contains { ($0.hr ?? 0) > 0 }
    }

    /// Build phase samples (per-mile pace, in seconds) from a run's phase
    /// breakdown. Prefers duration/distance; falls back to the pace string.
    static func phaseSamples(from phases: [PhaseBreakdown]?) -> [PhaseSample] {
        guard let phases else { return [] }
        return phases.compactMap { p in
            guard let mi = p.actual_distance_mi, mi > 0 else { return nil }
            var sec = 0
            if let d = p.actual_duration_sec, d > 0 { sec = Int(Double(d) / mi) }
            else if let parsed = paceToSec(p.actual_pace) { sec = parsed }
            guard sec > 0 else { return nil }
            return PhaseSample(mi: mi, sec: sec)
        }
    }

    // THE FIVE-BUCKET QUINTILE PALETTE IS GONE (2026-08-30). It was rose ·
    // coral · amber · green · blue, none of them a v5 token, and it graded a
    // number good at the fast end — which this palette never does, and which
    // is wrong on its own terms besides: a fast mile inside an easy run is
    // not a better mile. It had already stopped colouring the route; its last
    // consumer was `RoutePolylineCard`'s legend, which now samples
    // `paceRampColor` so a legend cannot name a colour the map does not
    // paint. Nothing is left to keep it alive, and leaving it declared is an
    // invitation to reintroduce it.

    /// THE PACE RAMP · `V5.attention` amber (this run's slowest) through to
    /// `V5.signal` orange (this run's fastest), interpolated continuously.
    /// `t` is 0 at the slow end and 1 at the fast end.
    ///
    /// INTENSITY, NOT QUALITY. Neither end of this ramp is a verdict, and the
    /// direction is not a ranking: an easy run is SUPPOSED to be easy, so the
    /// amber end of a Sunday long run is the run going exactly as asked. The
    /// ramp says how hard the runner was working at each point of the route
    /// and stops there. Nothing on this map answers "was that good" — the run
    /// recap under it answers "was that what the session asked for" in words,
    /// which is a different question and the only one that is anybody's to
    /// ask.
    ///
    /// WHY THESE TWO TOKENS AND NOTHING ELSE. `V5.fault` is barred outright —
    /// "never used to render a real value", and every point on this line is a
    /// real value. There is no green in the palette on purpose. Every
    /// remaining colour is a surface step or `textQuiet`, i.e. a grey, and
    /// grey is what the previous encoding used and what David rejected by
    /// name ("no grey it blends in too much"). Amber and orange are what is
    /// left, they are the palette's two loudest non-error inks, and both
    /// clear the basemap comfortably — signal measured 6.19:1 against CARTO
    /// Dark Matter's (14, 14, 14) ground, attention brighter still.
    static func paceRampColor(_ t: Double) -> UIColor {
        lerp(UIColor(V5.attention), UIColor(V5.signal), CGFloat(max(0, min(1, t))))
    }

    /// The smallest spread, in seconds per mile between the run's own fastest
    /// and slowest sample, that this map will draw a gradient across.
    ///
    /// Normalising to the run's own range is what makes the gradient
    /// informative whether or not the runner followed the plan — but the same
    /// property turns a genuinely flat run into a full amber→orange sweep
    /// built entirely out of measurement error. GPS distance error runs around
    /// 1% per mile, which is ±5-6 s on a 9:00 mile before the runner has done
    /// anything at all, so two adjacent miles can differ by ~11 s/mi with the
    /// legs doing nothing different. 20 s/mi is roughly double that: below it
    /// there is no pace story worth telling and the line draws in one flat
    /// `V5.signal` instead, which is the fill this file has always used for
    /// "the map asserts nothing about pace here".
    static let paceRangeFloorSec: Double = 20

    /// Builds the pace colour function for a set of observed values (seconds
    /// per mile), normalised across THEIR OWN min…max.
    ///
    /// NORMALISED AGAINST THE RUN, NEVER AGAINST THE PRESCRIPTION. That is the
    /// whole of the 2026-08-30 ruling — see `gradientSegments()`.
    static func paceColorFn(over values: [Double]) -> (Double) -> UIColor {
        guard !paceIsFlat(over: values), let lo = values.min(), let hi = values.max() else {
            return { _ in UIColor(V5.signal) }
        }
        let span = hi - lo
        // Pace is seconds per mile, so SMALLER is faster: the fast end of the
        // data is the orange (t = 1) end of the ramp.
        return { v in paceRampColor((hi - max(lo, min(hi, v))) / span) }
    }

    /// TRUE when this run has no pace story to tell, i.e. its own spread is
    /// under `paceRangeFloorSec` and a gradient would be drawn out of
    /// measurement error.
    ///
    /// One definition, because three things now depend on the answer: the
    /// colour function above, the mile table that reuses it, and the sentence
    /// under each of them that says what the colour means. A caption promising
    /// amber at the slow end, over a graphic that drew one flat orange, is the
    /// same defect as a legend naming a colour the map does not paint.
    static func paceIsFlat(over values: [Double]) -> Bool {
        guard let lo = values.min(), let hi = values.max() else { return true }
        return hi - lo < paceRangeFloorSec
    }

    // MARK: - One ramp for the whole screen

    /// THE VALUES THIS RUN'S PACE RAMP IS NORMALISED ACROSS.
    ///
    /// Lifted out of `gradientSegments()` so the axis decision is made ONCE
    /// and everything that draws or explains the ramp reads the same answer.
    /// Structured runs normalise across their phases' paces, everything else
    /// across the run's own miles — see `gradientSegments()` for why.
    ///
    /// PRECONDITION, and it holds on both v5 route cards: the caller passes no
    /// HR zones, so `usesHrZones` is false and the line is a pace ramp. The
    /// legacy `RoutePolylineCard` does pass zones and draws its own Z1-Z5
    /// legend rather than these captions.
    static func paceRampValues(splits: [RunSplit], phases: [PhaseSample]) -> [Double] {
        let validPhases = phases.filter { $0.mi > 0 && $0.sec > 0 }
        if validPhases.count >= 2 { return validPhases.map { Double($0.sec) } }
        return perMileFilled(splits.map { paceToSec($0.pace).flatMap { $0 > 0 ? Double($0) : nil } })
    }

    /// The pace ramp for one run, as a function of seconds per mile.
    ///
    /// THE COUPLING, MADE STRUCTURAL (2026-08-30). The mile table under this
    /// map used to colour its pace column by BAND ADHERENCE while the line
    /// above it coloured by SPEED, so on the runner's own 13.49 mi long run
    /// his fastest mile drew bright orange on the map and plain ink in the
    /// table, two inches apart. His ruling: "make the mile table match the
    /// map" — orange means one thing on this screen, you ran faster here, and
    /// band adherence is said in words instead, because a colour cannot tell
    /// you whether running fast was good or bad on a given day and a sentence
    /// can.
    ///
    /// So the table calls THIS, rather than owning a second ramp and a second
    /// normalisation that would drift apart on the first edit to either.
    static func runPaceColorFn(splits: [RunSplit], phases: [PhaseSample]) -> (Double) -> UIColor {
        paceColorFn(over: paceRampValues(splits: splits, phases: phases))
    }

    /// THE ROUTE LINE'S COLOUR RULE, SAID IN WORDS.
    ///
    /// The map had none. It drew a two-colour gradient and printed only the
    /// run's climb beside it, which is the same unexplained-visual defect the
    /// split chart already carried its own sentence against and the runner has
    /// flagged twice elsewhere: without a sentence the fill is a code the
    /// screen never breaks.
    ///
    /// NO VERDICT IN IT. Faster is not better — an easy run is supposed to be
    /// easy, and the amber end of a Sunday long run is the run going exactly
    /// as asked. The sentence says what the colour is measuring and stops.
    ///
    /// NIL WHEN THE RUN CARRIED NO PACE AT ALL. Caught on the runner's real
    /// 2026-08-26 easy run, whose splits reached the phone without paces: the
    /// map fell back to its flat "asserts nothing about pace here" fill, and
    /// the first version of this caption read that fill as "held a single
    /// pace" — a claim about a run nothing had measured the pace of. Silence
    /// is the honest caption for a line that is saying nothing.
    static func routeCaption(splits: [RunSplit], phases: [PhaseSample]) -> String? {
        let values = paceRampValues(splits: splits, phases: phases)
        if values.isEmpty { return nil }
        return paceIsFlat(over: values)
            ? "One colour the whole way: this run held a single pace."
            : "The line runs amber where you were slowest and orange where you were fastest. It reads speed, not whether the pace was right."
    }

    /// The same rule for the mile table's pace column.
    ///
    /// SAME WORDS, NO CROSS-REFERENCE. The two sentences are deliberately
    /// built out of the same vocabulary so they read as one system, and
    /// deliberately do not point at each other: the map sits BELOW the table
    /// on run detail and ABOVE it on the after-run sheet, and a run with no
    /// GPS draws no line for a caption to name. A sentence that says "like the
    /// route above" is wrong on two of those three screens.
    static func paceColumnCaption(splits: [RunSplit], phases: [PhaseSample]) -> String? {
        let values = paceRampValues(splits: splits, phases: phases)
        if values.isEmpty { return nil }
        return paceIsFlat(over: values)
            ? "One colour the whole way: these miles ran within seconds of each other."
            : "Amber is this run's slowest mile, orange its fastest. Colour reads speed, not whether the pace was right."
    }

    static func lerp(_ a: UIColor, _ b: UIColor, _ f: CGFloat) -> UIColor {
        var ar: CGFloat = 0, ag: CGFloat = 0, ab: CGFloat = 0, aa: CGFloat = 0
        var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
        a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
        b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
        return UIColor(red: ar + (br - ar) * f, green: ag + (bg - ag) * f,
                       blue: ab + (bb - ab) * f, alpha: aa + (ba - aa) * f)
    }

    /// HR-zone palette · Z1 lightest to Z5 densest, ordinal density on one
    /// neutral ink.
    ///
    /// IT WAS A v4 RAMP ON A v5 SURFACE. Teal, green, cream, red, rose — not
    /// one of the five is a v5 token, and brief v2 forbids green as a grade
    /// outright. That mattered most where it was most visible: the zone tile
    /// two inches above the map paints the asked-for zone in `V5.signal`,
    /// while the map painted the same zone #3EBD41 green, so one screen gave
    /// two answers about what zone 2 looks like, about one run. Worse on its
    /// own terms, as this file already argues for the pace axis three
    /// paragraphs up: a hue that lands on the prescription is the graphic
    /// saying "good", which this app never does.
    ///
    /// Density, not hue — it says WHICH zone without saying whether the
    /// distribution was good, which is exactly the shape `ZoneBar.restFill`
    /// already uses on the tile. Opaque rather than an alpha, because the
    /// route is drawn as many short overlapping segments and a translucent
    /// stroke doubles up at every round-capped joint, beading the line.
    ///
    /// The v5 route cards no longer colour by zone at all — see
    /// `MileBreakdownV5`, which carries the per-mile reading as numbers
    /// instead. This remains for the legacy `RoutePolylineCard`, which still
    /// draws the axis and its own Z1–Z5 legend, and which had no business
    /// drawing retired hexes either.
    static let zoneColors: [UIColor] = (0..<5).map {
        UIColor(white: CGFloat(0.50 + Double($0) * 0.11), alpha: 1)
    }

    /// Continuous Z1→Z5 ramp · t in 0…1. Lets HR drift fade across the zone
    /// colors instead of hard-switching at zone edges.
    static func zoneRampColor(_ t: Double) -> UIColor {
        let cs = zoneColors
        let tt = max(0, min(1, t)) * Double(cs.count - 1)
        let i = min(Int(floor(tt)), cs.count - 2)
        return lerp(cs[i], cs[i + 1], CGFloat(tt - Double(i)))
    }

    // MARK: - UIViewRepresentable

    func makeUIView(context: Context) -> MLNMapView {
        let map = FaffRouteMapView(frame: .zero, styleURL: CartoConfig.styleURL(labels: showLabels))
        map.delegate = context.coordinator
        map.isZoomEnabled = false
        map.isScrollEnabled = false
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.isUserInteractionEnabled = false   // purely visual · touches pass through
        map.showsUserLocation = false
        map.compassView.isHidden = true
        map.logoView.isHidden = true
        // No Apple "Legal" link to hide here (unlike MKMapView) — MapLibre's
        // own attribution control is a plain UIButton we own directly. Hidden
        // for the same parity reason the old MKMapView code hid Apple's: the
        // web RouteMap shows no attribution either (David 2026-06-17).
        map.attributionButton.isHidden = true
        map.backgroundColor = UIColor(Color(hex: 0x0A0E16))
        context.coordinator.owner = self
        // See FaffRouteMapView's header comment — this is what closes the
        // zero-bounds camera-fit race. `[weak map]` is safe/inert once the
        // view is torn down; the closure only ever re-runs the same
        // idempotent draw path.
        map.onBoundsSettled = { [weak map] in
            guard let map else { return }
            context.coordinator.applyRoute(to: map)
        }

        if map.style != nil {
            // Style already loaded synchronously from cache · draw immediately,
            // didFinishLoadingStyle won't fire again for this load.
            context.coordinator.applyRoute(to: map)
        }
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.owner = self

        let wantURL = CartoConfig.styleURL(labels: showLabels)
        if map.styleURL != wantURL {
            // Label toggle changed · full style reload, applyRoute runs again
            // from didFinishLoadingStyle once the new style lands.
            map.styleURL = wantURL
            return
        }
        if map.style != nil {
            context.coordinator.applyRoute(to: map)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    // MARK: - Delegate

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var owner: RouteMapView!

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            applyRoute(to: mapView)
        }

        func applyRoute(to map: MLNMapView) {
            guard let style = map.style, let owner else { return }
            // THE FIX · see FaffRouteMapView's header comment for the
            // measured root cause. `didFinishLoadingStyle:` can fire before
            // SwiftUI has given this view its real frame — fitting the
            // camera against a zero-sized viewport lands it at a wrong,
            // unrelated coordinate that nothing later corrects. Skip the
            // whole draw (layers included, so nothing shows at the wrong
            // camera position either) until the view actually has a size;
            // `onBoundsSettled` above re-invokes this the instant it does.
            guard map.bounds.width > 0, map.bounds.height > 0 else { return }
            RouteMapView.removeFaffLayers(from: style)
            owner.drawRoute(on: map, style: style)
        }
    }

    // MARK: - Drawing

    private static let faffSourceIDs = ["faff-baseline", "faff-gradient", "faff-endpoints"]
    private static let faffLayerIDs = ["faff-baseline-line", "faff-gradient-line", "faff-endpoints-circle"]

    /// Re-drawing on every SwiftUI update means every source/layer id must be
    /// unique-or-absent before re-adding — MLNStyle.addSource/addLayer throws
    /// (as an NSException, not a Swift error) on a duplicate identifier.
    private static func removeFaffLayers(from style: MLNStyle) {
        for lid in faffLayerIDs {
            if let layer = style.layer(withIdentifier: lid) { style.removeLayer(layer) }
        }
        for sid in faffSourceIDs {
            if let source = style.source(withIdentifier: sid) { style.removeSource(source) }
        }
    }

    private func drawRoute(on map: MLNMapView, style: MLNStyle) {
        guard coords.count >= 2 else { return }

        // Baseline line drawn first (always visible · belt + suspenders). Match
        // the color axis so it never peeks the wrong hue at segment joints.
        let hrMode = RouteMapView.usesHrZones(effort: effort, hrZones: hrZones, splits: splits,
                                              phases: phases)
        // THE UNDERLAY IS NEVER GREY. It used to be a retired coral
        // (#D03F3F) — a hex from the five-bucket ramp that no longer colours
        // anything — and the whole point of an underlay is that it is what
        // shows at a joint, at a GPS gap, and on a run whose splits are too
        // thin to build a gradient from. `V5.signal` is one of the ramp's own
        // two endpoints, so a peek can only ever read as a legal pace, and it
        // is the loudest ink the palette has on this basemap. It is also
        // already this file's answer for "no pace story to tell", which is
        // exactly the case where the underlay is the only line drawn.
        let baselineColor: UIColor = hrMode
            ? RouteMapView.zoneColors[1]
            : UIColor(V5.signal)
        let baselineFeature = MLNPolylineFeature(coordinates: coords, count: UInt(coords.count))
        let baselineSource = MLNShapeSource(identifier: "faff-baseline", features: [baselineFeature], options: nil)
        style.addSource(baselineSource)
        let baselineLayer = MLNLineStyleLayer(identifier: "faff-baseline-line", source: baselineSource)
        baselineLayer.lineColor = NSExpression(forConstantValue: baselineColor)
        baselineLayer.lineWidth = NSExpression(forConstantValue: 5)
        baselineLayer.lineCap = NSExpression(forConstantValue: "round")
        baselineLayer.lineJoin = NSExpression(forConstantValue: "round")
        style.addLayer(baselineLayer)

        // Pace-graded line · many short segments, each a continuously
        // interpolated color, so the buckets fade into each other instead of
        // hard-switching (David 2026-06-16). Consecutive segments share a
        // boundary vertex and round caps blend the joints. One shape source
        // holds every segment as its own LineString feature carrying the
        // segment's color as an attribute, and a single data-driven line layer
        // reads it back via a key-path NSExpression — the MapLibre equivalent
        // of the old per-segment MKOverlay-with-its-own-stroke-color technique.
        //
        // 2026-08-30 · the note that used to sit here claimed `attributes`
        // converts a UIColor "to its CSS string form". It does not: dumping
        // `geoJSONDictionary()` on a real feature gives
        // `strokeColor = "UIExtendedSRGBColorSpace 0.164706 0.180392 0.196078 1"`,
        // which is just `-[UIColor description]`. The UIColor still renders
        // correctly (MapLibre special-cases the object on its way into the
        // source rather than going through that dictionary, and a segment
        // asked for #2A2E32 measured (42, 45, 49) on screen — one unit off
        // per channel from the requested (42, 46, 50), i.e. a colour-space
        // rounding difference and nothing more). Keeping the UIColor because
        // it demonstrably works; correcting the reason, because the old one
        // was invented and sent an investigation down a false trail.
        var segFeatures: [MLNPolylineFeature] = []
        for seg in gradientSegments() where seg.coords.count >= 2 {
            let f = MLNPolylineFeature(coordinates: seg.coords, count: UInt(seg.coords.count))
            f.attributes = ["strokeColor": seg.color]
            segFeatures.append(f)
        }
        if !segFeatures.isEmpty {
            let gradientSource = MLNShapeSource(identifier: "faff-gradient", features: segFeatures, options: nil)
            style.addSource(gradientSource)
            let gradientLayer = MLNLineStyleLayer(identifier: "faff-gradient-line", source: gradientSource)
            gradientLayer.lineColor = NSExpression(forKeyPath: "strokeColor")
            gradientLayer.lineWidth = NSExpression(forConstantValue: 6)
            gradientLayer.lineCap = NSExpression(forConstantValue: "round")
            gradientLayer.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(gradientLayer)
        }

        // Endpoints last · one circle layer, data-driven per-feature color
        // (same UIColor-attribute trick as the gradient line) so start/finish
        // share a single source and layer.
        let start = MLNPointFeature()
        start.coordinate = coords.first!
        start.attributes = ["circleColor": UIColor(Color(hex: 0x3EBD41))]   // start · Success green (palette)
        let finish = MLNPointFeature()
        finish.coordinate = coords.last!
        finish.attributes = ["circleColor": UIColor(Color(hex: 0xFC4D64))]  // finish · Warning red (palette)
        let endpointsSource = MLNShapeSource(identifier: "faff-endpoints", features: [start, finish], options: nil)
        style.addSource(endpointsSource)
        let endpointsLayer = MLNCircleStyleLayer(identifier: "faff-endpoints-circle", source: endpointsSource)
        endpointsLayer.circleRadius = NSExpression(forConstantValue: 7)
        endpointsLayer.circleColor = NSExpression(forKeyPath: "circleColor")
        endpointsLayer.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
        endpointsLayer.circleStrokeWidth = NSExpression(forConstantValue: 1.5)
        endpointsLayer.circleOpacity = NSExpression(forConstantValue: 1)
        style.addLayer(endpointsLayer)

        var minLat = coords[0].latitude, maxLat = coords[0].latitude
        var minLng = coords[0].longitude, maxLng = coords[0].longitude
        for c in coords {
            minLat = min(minLat, c.latitude); maxLat = max(maxLat, c.latitude)
            minLng = min(minLng, c.longitude); maxLng = max(maxLng, c.longitude)
        }
        let bounds = MLNCoordinateBoundsMake(
            CLLocationCoordinate2D(latitude: minLat, longitude: minLng),
            CLLocationCoordinate2D(latitude: maxLat, longitude: maxLng)
        )
        map.setVisibleCoordinateBounds(
            bounds,
            edgePadding: UIEdgeInsets(top: 26, left: 26, bottom: 26, right: 26),
            animated: false,
            completionHandler: nil
        )
    }

    // MARK: - Pace gradient

    /// Short colored segments along the route, colored by what mattered in the
    /// run. Three axes (David 2026-06-17):
    ///   · structured (phases ≥2 · intervals / tempo) → PACE per phase. Each rep
    ///     reads at its true pace (a 6:45 rep stays orange even though its mile
    ///     averages ~8:00 with the recovery jog), with a SHORT eased boundary so
    ///     the join to the recovery fades instead of hard-switching.
    ///   · steady + HR + zones (easy / long / recovery) → HR ZONE per mile,
    ///     smoothly interpolated, on the zone palette.
    ///   · else → per-mile PACE, smoothly interpolated, on the pace ramp.
    /// Segments are short and share boundary vertices; with a continuous value
    /// function the colors FADE into each other ("the small gradient transition
    /// needs to be on all maps" · David 2026-06-17), without re-washing reps.
    ///
    /// 2026-08-30 · BOTH PACE AXES NORMALISE AGAINST THE RUN, NOT THE PLAN.
    /// David's ruling, asked directly what the line should show: "Pace gradient
    /// but no grey it blends in too much. Use the faff color system."
    ///
    /// What it replaced: the pace axes graded each point BINARY against the
    /// prescribed window and painted everything outside it one flat grey. On
    /// his real 13.49 mi long run — prescribed 8:37–9:12/mi, actually run at
    /// 6:52–8:38 with a friend, off-plan — twelve of thirteen miles fell
    /// outside the window, so the entire map rendered as a single constant.
    /// Made visible by the contrast fix that preceded this one, and still
    /// carrying no information whatsoever: a picture of one number, about a
    /// run with a 106 s/mi spread in it.
    ///
    /// His stated principle is the fix: the map's job is to show WHERE YOU
    /// RAN, running off-plan is normal life, and the graphic must never
    /// flatten or hide the route for it. So the ramp is normalised across the
    /// run's own fastest and slowest — the gradient is informative whether or
    /// not the plan was followed, because the plan is no longer an input.
    /// `paceRangeFloorSec` guards the one case where that could lie.
    ///
    /// WHERE BAND ADHERENCE WENT · CORRECTED SAME DAY. The first version of
    /// this note said it moved down the screen to `MileBreakdownV5`, which
    /// still coloured its pace column by the window. That left ORANGE meaning
    /// two opposite things eight hundred points apart on one screen: fastest,
    /// on the line; inside the prescription, in the table. On the runner's own
    /// 13.49 mi long run — prescribed 8:37-9:12, run 7:16-8:38 — mile 4 at
    /// 6:52 was the fastest mile of the day and drew bright orange on the map
    /// and plain ink in the table, because fast was out of band.
    ///
    /// His ruling: make the table match the map. The table now colours from
    /// `runPaceColorFn`, the same function this map draws with, and band
    /// adherence is stated in WORDS by the run recap instead of being a
    /// colour anywhere. A colour cannot say whether running fast was good or
    /// bad on a given day. A sentence can.
    private func gradientSegments() -> [(coords: [CLLocationCoordinate2D], color: UIColor)] {
        guard coords.count >= 2 else { return [] }

        // Cumulative distance per GPS point.
        var dist = [Double](repeating: 0, count: coords.count)
        for i in 1..<coords.count { dist[i] = dist[i - 1] + haversineMi(coords[i - 1], coords[i]) }
        let total = dist.last ?? 0
        guard total > 0 else { return [] }

        // valueFn(d) → scalar at distance d · colorFn(value) → UIColor.
        var valueFn: ((Double) -> Double)?
        var colorFn: ((Double) -> UIColor)?

        let validPhases = phases.filter { $0.mi > 0 && $0.sec > 0 }
        if validPhases.count >= 2 {
            // Structured · phase pace, SHARP with a short eased boundary.
            let phaseSum = validPhases.reduce(0.0) { $0 + $1.mi }
            let scale = phaseSum > 0 ? total / phaseSum : 1
            var spans: [(start: Double, end: Double, v: Double)] = []
            var cum = 0.0
            for p in validPhases { let s = cum; cum += p.mi * scale; spans.append((s, cum, Double(p.sec))) }
            let w = max(0.35, min(0.65, total * 0.08))  // boundary fade wide enough to be visible at map scale
            valueFn = { d in RouteMapView.phaseValue(d, spans, w) }
            // Normalised across the PHASES' own paces, so the reps sit at the
            // orange end and the recoveries at the amber end of the same run.
            // `phaseValue` only ever eases BETWEEN two neighbouring phase
            // values, so every value it can return is inside this min…max.
            // Through `runPaceColorFn` rather than `paceColorFn` directly, so
            // this branch and the mile table cannot pick different axes.
            colorFn = RouteMapView.runPaceColorFn(splits: splits, phases: phases)
        } else if RouteMapView.usesHrZones(effort: effort, hrZones: hrZones, splits: splits,
                                           phases: phases) {
            // Steady · per-mile HR → zone position, SMOOTH, on the zone palette.
            let hrs = RouteMapView.perMileFilled(splits.map { ($0.hr).flatMap { $0 > 0 ? Double($0) : nil } })
            guard !hrs.isEmpty else { return [] }
            let zones = hrZones
            let denom = Double(max(1, zones.count - 1))
            valueFn = { d in RouteMapView.mileSmooth(d, hrs) }
            colorFn = { hr in RouteMapView.zoneRampColor(RouteMapView.zonePosition(hr, zones) / denom) }
        } else {
            // Per-mile PACE, SMOOTH, on the pace ramp.
            let paces = RouteMapView.perMileFilled(splits.map { paceToSec($0.pace).flatMap { $0 > 0 ? Double($0) : nil } })
            guard !paces.isEmpty else { return [] }
            valueFn = { d in RouteMapView.mileSmooth(d, paces) }
            // Normalised across the run's own miles. `mileSmooth` interpolates
            // between mile centres and clamps at both ends, so every value it
            // can return is inside this min…max — the ramp's two endpoints are
            // reached exactly at the run's own fastest and slowest mile.
            // `runPaceColorFn` recomputes the same `paces`; that is the point,
            // it is the one place the normalisation is decided and the mile
            // table calls it too.
            colorFn = RouteMapView.runPaceColorFn(splits: splits, phases: phases)
        }

        guard let value = valueFn, let color = colorFn else { return [] }

        // Fine segments · ~one per 0.025 mi so a color transition spans several
        // segments and renders as a visible SHORT fade, not a hard line (David
        // 2026-06-17: "they can be short, but I don't like the hardlines"). The
        // old fixed 90 made each segment ~0.067 mi on a 6 mi route, so an eased
        // boundary covered barely one segment → still read hard. Bounded 100…320
        // (limited in practice by GPS point density).
        let maxSegs = min(320, max(100, Int(total / 0.025)))
        let chunk = max(1, Int(ceil(Double(coords.count - 1) / Double(maxSegs))))
        var segs: [(coords: [CLLocationCoordinate2D], color: UIColor)] = []
        var i = 0
        while i < coords.count - 1 {
            let end = min(i + chunk, coords.count - 1)
            let mid = (dist[i] + dist[end]) / 2
            segs.append((Array(coords[i...end]), color(value(mid))))
            i = end
        }
        return segs
    }

    /// HR (bpm) → continuous zone position 0…(n-1): zone index + fraction
    /// through that zone's band. Drives the zone ramp so HR drift inside Z2
    /// shifts gently and crossing into Z3 lands on amber.
    ///
    /// ZONE-BANDS-1 (2026-08-24) · the outermost bands are OPEN, and a
    /// fraction through an open band is not a real number. Zone 1 is Friel's
    /// "< 85% LTHR": it has no floor, and this used to substitute 0 for the
    /// missing one, which made the band 138 bpm wide at LTHR 162. A 128 bpm
    /// mile — deep, obvious Z1 — then sat 93% of the way up it and painted
    /// almost the colour of Z2. The mile was not nearly Z2; the denominator
    /// was fiction.
    ///
    /// So an open edge borrows the width of its bounded neighbour. Zone 1
    /// ramps only across the last Z2-width below Z2's floor and is otherwise
    /// flat Z1; the top zone ramps one band-width above its floor and then
    /// holds at full. Below and above that, the colour stops moving, which is
    /// the honest reading: at 128 bpm the answer is "Z1", not "93% of the way
    /// to somewhere else".
    private static func zonePosition(_ hr: Double, _ zones: [HRZoneRange]) -> Double {
        guard !zones.isEmpty else { return 0 }
        // Width of the nearest band that actually has two ends. Used only to
        // give an open edge a scale; never to invent a bound.
        func neighbourWidth(from i: Int) -> Double {
            for j in [i - 1, i + 1] where j >= 0 && j < zones.count {
                if let lo = zones[j].lower, let hi = zones[j].upper, hi > lo { return hi - lo }
            }
            return 10   // last resort · roughly a Friel band on a typical LTHR
        }
        for (i, z) in zones.enumerated() {
            let hi = z.upper
            guard let lo = z.lower else {
                // Open below · ramp across one neighbour-width up to this
                // band's ceiling, flat Z1 beneath that.
                guard let hi else { return Double(i) }
                if hr > hi { continue }
                let w = neighbourWidth(from: i)
                return Double(i) + min(1, max(0, (hr - (hi - w)) / w))
            }
            if hr < lo { return Double(i) }
            guard let hi else {
                // Open above · ramp one neighbour-width, then hold at full.
                let w = neighbourWidth(from: i)
                return Double(i) + min(1, max(0, (hr - lo) / w))
            }
            if hr <= hi {
                let frac = hi > lo ? (hr - lo) / (hi - lo) : 0
                return Double(i) + min(1, max(0, frac))
            }
        }
        return Double(zones.count - 1)
    }

    /// Forward-then-backward fill so every mile has a value (a missing split
    /// borrows its nearest neighbor). Returns [] if nothing is fillable.
    private static func perMileFilled(_ raw: [Double?]) -> [Double] {
        var filled = raw
        var last: Double? = nil
        for i in filled.indices { if filled[i] == nil { filled[i] = last } else { last = filled[i] } }
        var nxt: Double? = nil
        for i in stride(from: filled.count - 1, through: 0, by: -1) {
            if filled[i] == nil { filled[i] = nxt } else { nxt = filled[i] }
        }
        let out = filled.compactMap { $0 }
        return out.count == filled.count ? out : []
    }

    /// SMOOTH per-mile value · linear interpolation between mile CENTERS (mile i
    /// centered at i + 0.5), clamped at the ends. Adjacent miles on an easy/long
    /// run are close, so this reads as a continuous gradient.
    private static func mileSmooth(_ d: Double, _ vals: [Double]) -> Double {
        guard let first = vals.first, let lastV = vals.last else { return 0 }
        let x = d - 0.5
        if x <= 0 { return first }
        let i = Int(floor(x))
        if i >= vals.count - 1 { return lastV }
        return vals[i] + (vals[i + 1] - vals[i]) * (x - Double(i))
    }

    /// SHARP-with-eased-boundary value for phases · the phase's value across its
    /// body, ramping to the neighbor only within ±w/2 of each internal boundary.
    /// Keeps a 6:45 rep true-red through its length, fading only at the join.
    private static func phaseValue(_ d: Double, _ spans: [(start: Double, end: Double, v: Double)], _ w: Double) -> Double {
        guard !spans.isEmpty else { return 0 }
        var idx = spans.count - 1
        for (k, s) in spans.enumerated() where d <= s.end + 0.0001 { idx = k; break }
        let cur = spans[idx]
        if idx < spans.count - 1, d > cur.end - w / 2 {
            let nxt = spans[idx + 1]
            let f = min(1, max(0, (d - (cur.end - w / 2)) / w))
            return cur.v + (nxt.v - cur.v) * f
        }
        if idx > 0, d < cur.start + w / 2 {
            let prv = spans[idx - 1]
            let f = min(1, max(0, ((cur.start + w / 2) - d) / w))
            return cur.v + (prv.v - cur.v) * f
        }
        return cur.v
    }
}

/// A workout phase reduced to what the route map needs: its distance and its
/// pace (seconds per mile). Built by RouteMapView.phaseSamples(from:).
struct PhaseSample {
    let mi: Double
    let sec: Int
}

// MARK: - Pace + distance helpers (mirror RouteMap.tsx)

/// "7:42" → 462 seconds. nil for missing/garbled paces.
private func paceToSec(_ s: String?) -> Int? {
    guard let s, let colon = s.firstIndex(of: ":") else { return nil }
    let mm = Int(s[s.startIndex..<colon])
    let ss = Int(s[s.index(after: colon)...])
    guard let mm, let ss else { return nil }
    return mm * 60 + ss
}

private let EARTH_MI = 3958.7613
private func haversineMi(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
    let toRad = { (d: Double) in d * .pi / 180 }
    let dLat = toRad(b.latitude - a.latitude)
    let dLng = toRad(b.longitude - a.longitude)
    let lat1 = toRad(a.latitude)
    let lat2 = toRad(b.latitude)
    let x = sin(dLat / 2) * sin(dLat / 2)
        + sin(dLng / 2) * sin(dLng / 2) * cos(lat1) * cos(lat2)
    return 2 * EARTH_MI * asin(min(1, sqrt(x)))
}
