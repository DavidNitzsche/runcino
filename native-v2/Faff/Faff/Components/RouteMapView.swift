//
//  RouteMapView.swift
//  Native mirror of the web's RouteMap.tsx — a pace-graded run route on
//  CartoDB Dark Matter tiles.
//
//  Why MKMapView and not SwiftUI Map: SwiftUI's Map can't host a custom tile
//  overlay, and we want CartoDB's dark basemap specifically — its street
//  labels are far more muted than Apple's standard style, so the names recede
//  instead of fighting the route (David 2026-06-16 · "the street names over
//  the route is weird … do it the same way we do it on the web app").
//
//  Stack (matches RouteMap.tsx):
//   · CartoDB dark_all @2x raster tiles · canReplaceMapContent hides Apple's
//     own basemap so ONLY these tiles render (no Apple labels at all).
//   · Per-mile pace bucketing · five quintile buckets across the run's own
//     splits, colored warm→cool (fastest → slowest). Baseline coral underlay
//     drawn first so the line shows even if the bucket walk degenerates.
//   · Endpoints · start = green ring, finish = coral dot.
//   · Non-interactive · reads as a still image embedded in the card.
//

import SwiftUI
import MapKit
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
    /// the dark_nolabels tiles for a clean route (David 2026-06-17).
    var showLabels: Bool = true

    /// True when this run colors by HR zone (steady effort + per-mile HR + zone
    /// bands present, and not a structured/phase workout). The single rule, used
    /// by both the route coloring and the card's legend so they never diverge.
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

    /// Quintile palette · fastest → slowest. Byte-identical to the web's
    /// BUCKET_COLORS (rose · coral · amber · green · blue).
    static let bucketColors: [UIColor] = [
        UIColor(Color(hex: 0xFC4D64)),
        UIColor(Color(hex: 0xE88021)),
        UIColor(Color(hex: 0xF3AD38)),
        UIColor(Color(hex: 0x3EBD41)),   // green · = Success (was #14C08C teal)
        UIColor(Color(hex: 0x27B4E0)),
    ]

    /// Continuous warm→cool ramp across the five bucket colors · t in 0…1.
    /// Lets the pace line fade between buckets instead of hard-switching.
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

    /// HR-zone palette · Z1→Z5 (teal → green → cream → orange → red). = the
    /// app's Theme.Zone time-in-zones colors, deliberately distinct from the
    /// pace bucketColors so HR mode reads as a different axis at a glance.
    static let zoneColors: [UIColor] = [
        UIColor(Color(hex: 0x27B4E0)),   // Z1 · Light Blue (palette)
        UIColor(Color(hex: 0x3EBD41)),   // Z2 · Success green (palette)
        UIColor(Color(hex: 0xF3AD38)),   // Z3 · Attention amber (palette)
        UIColor(Color(hex: 0xE88021)),   // Z4 · Dark Orange (palette)
        UIColor(Color(hex: 0xFC4D64)),   // Z5 · Warning red (palette)
    ]

    /// Continuous Z1→Z5 ramp · t in 0…1. Lets HR drift fade across the zone
    /// colors instead of hard-switching at zone edges.
    static func zoneRampColor(_ t: Double) -> UIColor {
        let cs = zoneColors
        let tt = max(0, min(1, t)) * Double(cs.count - 1)
        let i = min(Int(floor(tt)), cs.count - 2)
        return lerp(cs[i], cs[i + 1], CGFloat(tt - Double(i)))
    }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.isZoomEnabled = false
        map.isScrollEnabled = false
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.isUserInteractionEnabled = false   // purely visual · touches pass through
        map.showsCompass = false
        map.showsScale = false
        map.showsUserLocation = false
        map.pointOfInterestFilter = .excludingAll
        map.overrideUserInterfaceStyle = .dark
        map.backgroundColor = UIColor(Color(hex: 0x0A0E16))

        // CartoDB Dark Matter raster tiles. canReplaceMapContent = true tells
        // MapKit the overlay covers everything, so it skips drawing its own
        // basemap (and labels) entirely — only the muted CartoDB tiles show.
        let style = showLabels ? "dark_all" : "dark_nolabels"
        let overlay = MKTileOverlay(
            urlTemplate: "https://a.basemaps.cartocdn.com/\(style)/{z}/{x}/{y}@2x.png"
        )
        overlay.canReplaceMapContent = true
        overlay.tileSize = CGSize(width: 512, height: 512)   // @2x retina tiles
        map.addOverlay(overlay, level: .aboveLabels)

        drawRoute(on: map)
        hideAttribution(map)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        // Re-draw the route on data change · keep the tile overlay in place.
        map.removeOverlays(map.overlays.filter { !($0 is MKTileOverlay) })
        map.removeAnnotations(map.annotations)
        drawRoute(on: map)
        hideAttribution(map)
    }

    /// Hide MapKit's "Legal" attribution link. We replace the basemap entirely
    /// with CartoDB tiles (canReplaceMapContent), so Apple's map data — and the
    /// legal link it requires — isn't used; the web RouteMap shows no attribution
    /// either (parity · David 2026-06-17). Apple exposes no public API to remove
    /// it, so locate the label among the map's subviews and hide it. Re-run after
    /// a tick because MapKit adds it lazily on first layout.
    private func hideAttribution(_ map: MKMapView) {
        func hide(in view: UIView) {
            for sub in view.subviews {
                let name = String(describing: type(of: sub))
                if name.contains("Attribution") || name.contains("Legal") { sub.isHidden = true }
                hide(in: sub)
            }
        }
        hide(in: map)
        DispatchQueue.main.async { hide(in: map) }
    }

    private func drawRoute(on map: MKMapView) {
        guard coords.count >= 2 else { return }

        // Baseline line drawn first (always visible · belt + suspenders). Match
        // the color axis so it never peeks the wrong hue at segment joints:
        // mid-zone green under an HR route, coral under a pace route.
        let hrMode = RouteMapView.usesHrZones(effort: effort, hrZones: hrZones, splits: splits, phases: phases)
        let baseline = ColoredPolyline(coordinates: coords, count: coords.count)
        baseline.strokeColor = hrMode ? RouteMapView.zoneColors[1] : UIColor(Color(hex: 0xE88021))
        baseline.strokeWidth = 5
        map.addOverlay(baseline, level: .aboveLabels)

        // Pace-graded line · many short segments, each a continuously
        // interpolated color, so the buckets fade into each other instead of
        // hard-switching (David 2026-06-16). Consecutive segments share a
        // boundary vertex and round caps blend the joints.
        for seg in gradientSegments() where seg.coords.count >= 2 {
            let line = ColoredPolyline(coordinates: seg.coords, count: seg.coords.count)
            line.strokeColor = seg.color
            line.strokeWidth = 6
            map.addOverlay(line, level: .aboveLabels)
        }

        // Endpoints last · annotations always render above overlays.
        let start = RouteEndpoint(coordinate: coords.first!, kind: .start)
        let finish = RouteEndpoint(coordinate: coords.last!, kind: .finish)
        map.addAnnotations([start, finish])

        map.setVisibleMapRect(
            baseline.boundingMapRect,
            edgePadding: UIEdgeInsets(top: 26, left: 26, bottom: 26, right: 26),
            animated: false
        )
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

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
            let w = max(0.05, min(0.12, total * 0.022))  // boundary fade · short but multi-segment
            valueFn = { d in RouteMapView.phaseValue(d, spans, w) }
            let vals = validPhases.map { Double($0.sec) }.sorted()
            let lo = vals[Int(Double(vals.count - 1) * 0.1)]
            let hi = vals[Int(Double(vals.count - 1) * 0.9)]
            let span = max(1, hi - lo)
            colorFn = { v in RouteMapView.rampColor((v - lo) / span) }
        } else if RouteMapView.usesHrZones(effort: effort, hrZones: hrZones, splits: splits, phases: phases) {
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
            let sorted = paces.sorted()
            let lo = sorted[Int(Double(sorted.count - 1) * 0.1)]
            let hi = sorted[Int(Double(sorted.count - 1) * 0.9)]
            let span = max(1, hi - lo)
            valueFn = { d in RouteMapView.mileSmooth(d, paces) }
            colorFn = { v in RouteMapView.rampColor((v - lo) / span) }
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
    private static func zonePosition(_ hr: Double, _ zones: [HRZoneRange]) -> Double {
        guard !zones.isEmpty else { return 0 }
        for (i, z) in zones.enumerated() {
            let lo = z.lower ?? 0
            let hi = z.upper ?? .greatestFiniteMagnitude
            if hr < lo { return Double(i) }
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

    // MARK: - Delegate

    final class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let tile = overlay as? MKTileOverlay {
                return MKTileOverlayRenderer(tileOverlay: tile)
            }
            if let line = overlay as? ColoredPolyline {
                let r = MKPolylineRenderer(polyline: line)
                r.strokeColor = line.strokeColor
                r.lineWidth = line.strokeWidth
                r.lineCap = .round
                r.lineJoin = .round
                return r
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let ep = annotation as? RouteEndpoint else { return nil }
            let id = "route-endpoint"
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: id)
                ?? MKAnnotationView(annotation: annotation, reuseIdentifier: id)
            view.annotation = annotation
            view.subviews.forEach { $0.removeFromSuperview() }

            let size: CGFloat = 14
            view.frame = CGRect(x: 0, y: 0, width: size, height: size)
            view.backgroundColor = .clear
            view.centerOffset = .zero

            // Solid dot with a thin white ring · start green, finish coral.
            // (Was a green ring around a near-black center, which David found
            // weird · 2026-06-16.) Symmetric with the finish marker.
            let dot = UIView(frame: view.bounds)
            dot.layer.cornerRadius = size / 2
            dot.backgroundColor = ep.kind == .start
                ? UIColor(Color(hex: 0x3EBD41))   // start · Success green (palette)
                : UIColor(Color(hex: 0xFC4D64))   // finish · Warning red (palette)
            dot.layer.borderColor = UIColor.white.cgColor
            dot.layer.borderWidth = 1.5
            view.addSubview(dot)
            return view
        }
    }
}

/// A workout phase reduced to what the route map needs: its distance and its
/// pace (seconds per mile). Built by RouteMapView.phaseSamples(from:).
struct PhaseSample {
    let mi: Double
    let sec: Int
}

// MARK: - Overlay / annotation carriers

/// MKPolyline that carries its own stroke color + width so the single
/// delegate can render many differently-colored pace segments.
final class ColoredPolyline: MKPolyline {
    var strokeColor: UIColor = .systemRed
    var strokeWidth: CGFloat = 5
}

final class RouteEndpoint: NSObject, MKAnnotation {
    enum Kind { case start, finish }
    let coordinate: CLLocationCoordinate2D
    let kind: Kind
    init(coordinate: CLLocationCoordinate2D, kind: Kind) {
        self.coordinate = coordinate
        self.kind = kind
    }
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
