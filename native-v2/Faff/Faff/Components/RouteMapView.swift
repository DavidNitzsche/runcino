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
//   · Per-coordinate gradient · MKGradientPolylineRenderer (iOS 14+) with a
//     color computed at every GPS point → pixel-smooth transitions, not
//     flat-color segment steps. Baseline coral underlay drawn first so the
//     line shows even if the gradient walk degenerates.
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
        UIColor(Color(hex: 0xD03F3F)),
        UIColor(Color(hex: 0xF3AD38)),
        UIColor(Color(hex: 0x3EBD41)),   // green · = Success (was #14C08C teal)
        UIColor(Color(hex: 0x27B4E0)),
    ]

    /// Continuous warm→cool ramp across the five bucket colors · t in 0…1.
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
        UIColor(Color(hex: 0xD03F3F)),   // Z4 · Redish (palette · orange retired 2026-06-18)
        UIColor(Color(hex: 0xFC4D64)),   // Z5 · Warning red (palette)
    ]

    /// Continuous Z1→Z5 ramp · t in 0…1.
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

        let style = showLabels ? "dark_all" : "dark_nolabels"
        let overlay = MKTileOverlay(
            urlTemplate: "https://a.basemaps.cartocdn.com/\(style)/{z}/{x}/{y}@2x.png"
        )
        overlay.canReplaceMapContent = true
        overlay.tileSize = CGSize(width: 512, height: 512)
        map.addOverlay(overlay, level: .aboveLabels)

        drawRoute(on: map)
        hideAttribution(map)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        map.removeOverlays(map.overlays.filter { !($0 is MKTileOverlay) })
        map.removeAnnotations(map.annotations)
        drawRoute(on: map)
        hideAttribution(map)
    }

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

        let hrMode = RouteMapView.usesHrZones(effort: effort, hrZones: hrZones,
                                              splits: splits, phases: phases)

        // Baseline underlay — always visible, correct hue for the axis.
        let baseline = ColoredPolyline(coordinates: coords, count: coords.count)
        baseline.strokeColor = hrMode
            ? RouteMapView.zoneColors[1]
            : UIColor(Color(hex: 0xD03F3F))
        baseline.strokeWidth = 5
        map.addOverlay(baseline, level: .aboveLabels)

        // Gradient line — one polyline with a color at every GPS coordinate.
        // MKGradientPolylineRenderer (iOS 14+) pixel-interpolates between them,
        // so transitions are smooth regardless of GPS point density.
        if let gd = gradientData() {
            let gradLine = GradientPolyline(coordinates: coords, count: coords.count)
            gradLine.gradientColors = gd.colors
            gradLine.gradientLocations = gd.locations
            map.addOverlay(gradLine, level: .aboveLabels)
        }

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

    // MARK: - Gradient data

    /// Compute one UIColor per GPS coordinate, plus its normalized location
    /// (0…1) along the route. Fed directly into MKGradientPolylineRenderer so
    /// MapKit interpolates the colors pixel-by-pixel between GPS points — no
    /// discrete segment steps, no hard color joins.
    private func gradientData() -> (colors: [UIColor], locations: [CGFloat])? {
        guard coords.count >= 2 else { return nil }

        var dist = [Double](repeating: 0, count: coords.count)
        for i in 1..<coords.count { dist[i] = dist[i - 1] + haversineMi(coords[i - 1], coords[i]) }
        let total = dist.last ?? 0
        guard total > 0 else { return nil }

        var valueFn: ((Double) -> Double)?
        var colorFn: ((Double) -> UIColor)?

        let validPhases = phases.filter { $0.mi > 0 && $0.sec > 0 }
        if validPhases.count >= 2 {
            // Structured · phase pace with short eased boundary.
            let phaseSum = validPhases.reduce(0.0) { $0 + $1.mi }
            let scale = phaseSum > 0 ? total / phaseSum : 1
            var spans: [(start: Double, end: Double, v: Double)] = []
            var cum = 0.0
            for p in validPhases {
                let s = cum; cum += p.mi * scale
                spans.append((s, cum, Double(p.sec)))
            }
            let w = max(0.05, min(0.12, total * 0.022))
            valueFn = { d in RouteMapView.phaseValue(d, spans, w) }
            let vals = validPhases.map { Double($0.sec) }.sorted()
            let lo = vals[Int(Double(vals.count - 1) * 0.1)]
            let hi = vals[Int(Double(vals.count - 1) * 0.9)]
            let span = max(1, hi - lo)
            colorFn = { v in RouteMapView.rampColor((v - lo) / span) }

        } else if RouteMapView.usesHrZones(effort: effort, hrZones: hrZones,
                                            splits: splits, phases: phases) {
            // Steady · per-mile HR → zone position.
            let hrs = RouteMapView.perMileFilled(
                splits.map { ($0.hr).flatMap { $0 > 0 ? Double($0) : nil } })
            guard !hrs.isEmpty else { return nil }
            let zones = hrZones
            let denom = Double(max(1, zones.count - 1))
            valueFn = { d in RouteMapView.mileSmooth(d, hrs) }
            colorFn = { hr in
                RouteMapView.zoneRampColor(RouteMapView.zonePosition(hr, zones) / denom)
            }

        } else {
            // Per-mile PACE, smooth.
            let paces = RouteMapView.perMileFilled(
                splits.map { paceToSec($0.pace).flatMap { $0 > 0 ? Double($0) : nil } })
            guard !paces.isEmpty else { return nil }
            let sorted = paces.sorted()
            let lo = sorted[Int(Double(sorted.count - 1) * 0.1)]
            let hi = sorted[Int(Double(sorted.count - 1) * 0.9)]
            let span = max(1, hi - lo)
            valueFn = { d in RouteMapView.mileSmooth(d, paces) }
            colorFn = { v in RouteMapView.rampColor((v - lo) / span) }
        }

        guard let value = valueFn, let color = colorFn else { return nil }

        // One color per GPS coordinate + its normalized distance location.
        let colors = dist.map { color(value($0)) }
        let locations = dist.map { CGFloat($0 / total) }
        return (colors, locations)
    }

    /// HR (bpm) → continuous zone position 0…(n-1).
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

    private static func mileSmooth(_ d: Double, _ vals: [Double]) -> Double {
        guard let first = vals.first, let lastV = vals.last else { return 0 }
        let x = d - 0.5
        if x <= 0 { return first }
        let i = Int(floor(x))
        if i >= vals.count - 1 { return lastV }
        return vals[i] + (vals[i + 1] - vals[i]) * (x - Double(i))
    }

    private static func phaseValue(_ d: Double,
                                   _ spans: [(start: Double, end: Double, v: Double)],
                                   _ w: Double) -> Double {
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
            if let line = overlay as? GradientPolyline {
                // MKGradientPolylineRenderer (iOS 14+): pixel-smooth gradient
                // between every GPS point — no hard segment joins.
                let r = MKGradientPolylineRenderer(polyline: line)
                r.setColors(line.gradientColors, locations: line.gradientLocations)
                r.lineWidth = 6
                r.lineCap = .round
                r.lineJoin = .round
                return r
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

            let dot = UIView(frame: view.bounds)
            dot.layer.cornerRadius = size / 2
            dot.backgroundColor = ep.kind == .start
                ? UIColor(Color(hex: 0x3EBD41))
                : UIColor(Color(hex: 0xFC4D64))
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

/// Single-color baseline underlay (belt-and-suspenders, drawn under gradient).
final class ColoredPolyline: MKPolyline {
    var strokeColor: UIColor = .systemRed
    var strokeWidth: CGFloat = 5
}

/// One polyline carrying per-GPS-point colors for MKGradientPolylineRenderer.
/// gradientColors[i] is the color at coordinate[i]; gradientLocations[i] is
/// the normalized distance (0…1) of that point along the full route.
final class GradientPolyline: MKPolyline {
    var gradientColors: [UIColor] = []
    var gradientLocations: [CGFloat] = []
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
