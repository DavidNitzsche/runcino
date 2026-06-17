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
    /// easy / long runs → the per-mile pace gradient. (David 2026-06-16: "the
    /// heat map should show what was important to that run.")
    var phases: [PhaseSample] = []

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
        UIColor(Color(hex: 0xF43F5E)),
        UIColor(Color(hex: 0xFF5722)),
        UIColor(Color(hex: 0xF3AD38)),
        UIColor(Color(hex: 0x14C08C)),
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
        let overlay = MKTileOverlay(
            urlTemplate: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
        )
        overlay.canReplaceMapContent = true
        overlay.tileSize = CGSize(width: 512, height: 512)   // @2x retina tiles
        map.addOverlay(overlay, level: .aboveLabels)

        drawRoute(on: map)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        // Re-draw the route on data change · keep the tile overlay in place.
        map.removeOverlays(map.overlays.filter { !($0 is MKTileOverlay) })
        map.removeAnnotations(map.annotations)
        drawRoute(on: map)
    }

    private func drawRoute(on map: MKMapView) {
        guard coords.count >= 2 else { return }

        // Baseline coral line drawn first (always visible · belt + suspenders).
        let baseline = ColoredPolyline(coordinates: coords, count: coords.count)
        baseline.strokeColor = UIColor(Color(hex: 0xFF5722))
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
    /// run. Workout phases win when present (a 6:45 rep reads red even though
    /// the mile split that contains it averages ~8:00 with its recovery jog);
    /// otherwise per-mile splits drive an easy/long pace gradient. Per-mile uses
    /// a STEP per mile, not cross-mile interpolation — interpolation washed fast
    /// reps into the surrounding recovery (David 2026-06-16).
    private func gradientSegments() -> [(coords: [CLLocationCoordinate2D], color: UIColor)] {
        guard coords.count >= 2 else { return [] }

        // Cumulative distance per GPS point.
        var dist = [Double](repeating: 0, count: coords.count)
        for i in 1..<coords.count { dist[i] = dist[i - 1] + haversineMi(coords[i - 1], coords[i]) }
        let total = dist.last ?? 0

        // Build pace-at-distance + the run's pace values, from PHASES (reps /
        // tempo block) when there are ≥2, else per-mile splits (easy / long).
        var paceFn: ((Double) -> Double)?
        var paceValues: [Double] = []

        let validPhases = phases.filter { $0.mi > 0 && $0.sec > 0 }
        if validPhases.count >= 2 {
            let phaseSum = validPhases.reduce(0.0) { $0 + $1.mi }
            let scale = phaseSum > 0 ? total / phaseSum : 1
            var bounds: [(end: Double, sec: Double)] = []
            var cum = 0.0
            for p in validPhases { cum += p.mi * scale; bounds.append((cum, Double(p.sec))) }
            paceValues = validPhases.map { Double($0.sec) }
            paceFn = { d in
                for b in bounds where d <= b.end + 0.0001 { return b.sec }
                return bounds.last?.sec ?? 0
            }
        } else {
            let raw = splits.map { paceToSec($0.pace) }
            guard raw.contains(where: { ($0 ?? 0) > 0 }) else { return [] }
            var filled: [Double?] = raw.map { $0.flatMap { $0 > 0 ? Double($0) : nil } }
            var last: Double? = nil
            for i in filled.indices { if filled[i] == nil { filled[i] = last } else { last = filled[i] } }
            var nxt: Double? = nil
            for i in stride(from: filled.count - 1, through: 0, by: -1) {
                if filled[i] == nil { filled[i] = nxt } else { nxt = filled[i] }
            }
            let mile = filled.compactMap { $0 }
            guard mile.count == filled.count, !mile.isEmpty else { return [] }
            paceValues = mile
            paceFn = { d in mile[max(0, min(mile.count - 1, Int(floor(d))))] }
        }

        guard let pace = paceFn, !paceValues.isEmpty else { return [] }
        let sorted = paceValues.sorted()
        // Robust color range · one very fast/slow segment shouldn't flatten the
        // whole gradient, so anchor on the 10th/90th percentiles.
        let lo = sorted[Int(Double(sorted.count - 1) * 0.1)]
        let hi = sorted[Int(Double(sorted.count - 1) * 0.9)]
        let span = max(1, hi - lo)
        func colorAt(_ d: Double) -> UIColor { RouteMapView.rampColor((pace(d) - lo) / span) }

        // Chunk into ~90 short segments · color by midpoint pace, sharing the
        // boundary vertex with the next so the line stays joined.
        let maxSegs = 90
        let chunk = max(1, Int(ceil(Double(coords.count - 1) / Double(maxSegs))))
        var segs: [(coords: [CLLocationCoordinate2D], color: UIColor)] = []
        var i = 0
        while i < coords.count - 1 {
            let end = min(i + chunk, coords.count - 1)
            let mid = (dist[i] + dist[end]) / 2
            segs.append((Array(coords[i...end]), colorAt(mid)))
            i = end
        }
        return segs
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
                ? UIColor(Color(hex: 0x14C08C))
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
