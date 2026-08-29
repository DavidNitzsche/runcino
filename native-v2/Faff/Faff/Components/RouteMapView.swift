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
//  Stack (matches RouteMap.tsx):
//   · CARTO's "Dark Matter" MapLibre GL style, rendered by MLNMapView.
//   · Per-mile pace bucketing · five quintile buckets across the run's own
//     splits, colored warm→cool (fastest → slowest). Baseline coral underlay
//     drawn first so the line shows even if the bucket walk degenerates.
//   · Endpoints · start = green ring, finish = coral dot.
//   · Non-interactive · reads as a still image embedded in the card.
//

import SwiftUI
import MapLibre
import CoreLocation
import UIKit

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

    /// The pace window the session asked for, seconds per mile. When present,
    /// the route stops grading and starts answering the same question the
    /// split chart answers.
    ///
    /// ROUND THREE, ITEM 4 · THE ROUTE FOLLOWS THE SPLITS. The old colouring
    /// was a five-hue quintile ramp with green at the fast end, which grades a
    /// number good — out everywhere else in this palette, and wrong on its own
    /// terms: a fast mile inside an easy run is off the prescription, not
    /// good. The 0821 line asking for a single-hue opacity ramp does not fix
    /// it either; darker still looks worse, so an opacity ramp is a quieter
    /// verdict rather than no verdict.
    ///
    /// Two flat fills carry no gradient of judgement at all, and the payoff is
    /// that the grey stretch on the map and the grey bar in the chart are THE
    /// SAME MILE. The two graphics answer each other instead of competing,
    /// which is worth more than either being individually cleverer.
    ///
    /// Nil — an unplanned run, or a session kind with no single pace window —
    /// draws the whole line in signal and asserts nothing.
    var paceBand: (lo: Int, hi: Int)? = nil

    /// True when this run colors by HR zone (steady effort + per-mile HR + zone
    /// bands present, and not a structured/phase workout). The single rule, used
    /// by both the route coloring and the card's legend so they never diverge.
    ///
    /// A PRESCRIPTION OUTRANKS THE AXIS. Round three item 4 asks the route to
    /// follow the splits, and the payoff it names is that "the grey stretch on
    /// the map and the grey bar in the chart are THE SAME MILE". The zone axis
    /// broke exactly that, and it broke it in the only case the ruling was
    /// written for: `RunDetailV5.splitBand` hands a band to steady runs ONLY —
    /// easy, long, recovery — which is the same set that turns this on. So an
    /// easy run with HR zones drew a five-hue ramp beside a two-fill chart,
    /// and the two graphics competed on the one screen that shows both.
    ///
    /// Worse on its own terms: the zone ramp puts GREEN at Z2, and Z2 is where
    /// an easy run is asked to sit. A hue that lands on the prescription is
    /// the chart saying "good", which this palette never does.
    ///
    /// A zone is still an identity, not a grade, so the axis is kept where
    /// nothing was prescribed — an unplanned run has no band, and there the
    /// zone ramp says which zone without answering a question nobody asked.
    static func usesHrZones(effort: FaffEffort, hrZones: [HRZoneRange],
                            splits: [RunSplit], phases: [PhaseSample],
                            paceBand: (lo: Int, hi: Int)? = nil) -> Bool {
        guard paceBand == nil else { return false }
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

    /// Quintile palette · fastest → slowest. Byte-identical to the web's
    /// BUCKET_COLORS (rose · coral · amber · green · blue).
    static let bucketColors: [UIColor] = [
        UIColor(Color(hex: 0xFC4D64)),
        UIColor(Color(hex: 0xD03F3F)),
        UIColor(Color(hex: 0xF3AD38)),
        UIColor(Color(hex: 0x3EBD41)),   // green · = Success (was #14C08C teal)
        UIColor(Color(hex: 0x27B4E0)),
    ]

    /// In the window, or out of it. ONE grey in BOTH directions — a mile run
    /// fast and a mile run slow are both "not what was asked", and giving fast
    /// its own colour would grade it good.
    ///
    /// The grey is `materialControl`, the same token the split chart uses, so
    /// the same mile reads the same in both graphics. The handoff names
    /// `#3A3E42`, a hair lighter for legibility on a dark basemap; that is a
    /// new hex against a byte-locked palette, so the shared token wins unless
    /// it proves too dark to read on the map.
    static func bandColor(_ paceSec: Double, _ band: (lo: Int, hi: Int)?) -> UIColor {
        guard let band else { return UIColor(V5.signal) }
        let inBand = paceSec >= Double(band.lo) && paceSec <= Double(band.hi)
        return UIColor(inBand ? V5.signal : V5.materialControl)
    }

    /// Continuous warm→cool ramp across the five bucket colors · t in 0…1.
    /// RETAINED for the HR-zone axis's own palette only — a zone is an
    /// identity, not a grade, and round three does not touch it.
    static func rampColor(_ t: Double) -> UIColor {
        let cs = bucketColors
        let tt = max(0, min(1, t)) * Double(cs.count - 1)
        let i = min(Int(floor(tt)), cs.count - 2)
        return lerp(cs[i], cs[i + 1], CGFloat(tt - Double(i)))
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
        let map = MLNMapView(frame: .zero, styleURL: CartoConfig.styleURL(labels: showLabels))
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
        // the color axis so it never peeks the wrong hue at segment joints:
        // mid-zone green under an HR route, coral under a pace route.
        let hrMode = RouteMapView.usesHrZones(effort: effort, hrZones: hrZones, splits: splits,
                                              phases: phases, paceBand: paceBand)
        // With a band the whole line is one of two flat fills, so the underlay
        // takes the in-band fill rather than a third colour that could peek
        // through at a joint and read as a mile that was neither.
        let baselineColor: UIColor = paceBand != nil
            ? UIColor(V5.signal)
            : (hrMode ? RouteMapView.zoneColors[1] : UIColor(Color(hex: 0xD03F3F)))
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
        // segment's color as an attribute; MLNFeature's `attributes` accepts a
        // UIColor directly (converted to its CSS string form when added to the
        // source — see MLNFeature.h), and a single data-driven line layer reads
        // it back via a key-path NSExpression — the MapLibre equivalent of the
        // old per-segment MKOverlay-with-its-own-stroke-color technique.
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
    ///     reads at its true pace (a 6:45 rep stays red even though its mile
    ///     averages ~8:00 with the recovery jog), with a SHORT eased boundary so
    ///     the join to the recovery fades instead of hard-switching.
    ///   · steady + HR + zones (easy / long / recovery) → HR ZONE per mile,
    ///     smoothly interpolated, on the zone palette.
    ///   · else → per-mile PACE, smoothly interpolated, on the pace palette.
    /// Segments are short and share boundary vertices; with a continuous value
    /// function the colors FADE between buckets ("the small gradient transition
    /// needs to be on all maps" · David 2026-06-17), without re-washing reps.
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
            colorFn = { [paceBand] v in RouteMapView.bandColor(v, paceBand) }
        } else if RouteMapView.usesHrZones(effort: effort, hrZones: hrZones, splits: splits,
                                           phases: phases, paceBand: paceBand) {
            // Steady · per-mile HR → zone position, SMOOTH, on the zone palette.
            let hrs = RouteMapView.perMileFilled(splits.map { ($0.hr).flatMap { $0 > 0 ? Double($0) : nil } })
            guard !hrs.isEmpty else { return [] }
            let zones = hrZones
            let denom = Double(max(1, zones.count - 1))
            valueFn = { d in RouteMapView.mileSmooth(d, hrs) }
            colorFn = { hr in RouteMapView.zoneRampColor(RouteMapView.zonePosition(hr, zones) / denom) }
        } else {
            // Per-mile PACE, SMOOTH, on the pace palette.
            let paces = RouteMapView.perMileFilled(splits.map { paceToSec($0.pace).flatMap { $0 > 0 ? Double($0) : nil } })
            guard !paces.isEmpty else { return [] }
            valueFn = { d in RouteMapView.mileSmooth(d, paces) }
            colorFn = { [paceBand] v in RouteMapView.bandColor(v, paceBand) }
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
