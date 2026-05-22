//
//  RunRecapView.swift
//  Faff
//
//  Recap of a completed run synced from Apple Watch → Strava. Real data
//  from /api/runs/by-date: header stats, GPS route, per-mile splits with
//  HR, and a factual split-trend summary. Honest empty state when no run
//  has synced for the date (NO fabricated runs).
//

import SwiftUI
import MapKit

struct RunRecapView: View {
    let date: String
    @Environment(\.dismiss) private var dismiss
    @State private var run: RunRecap?
    @State private var loading = true
    @State private var dynamics: HealthKitManager.RunDynamics?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Faff.S.rowGap) {
                SheetGrabHandle()
                if loading {
                    HStack(spacing: 8) { ProgressView().scaleEffect(0.85); Text("Loading run…").font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted) }
                        .padding(.top, 40).frame(maxWidth: .infinity)
                } else if let r = run {
                    RunRecapContent(run: r, dynamics: dynamics, fallbackDate: date)
                } else {
                    emptyState
                }
            }
            .padding(.horizontal, Faff.S.pageEdge).padding(.bottom, Faff.S.scrollBottom)
        }
        .overlay(alignment: .topTrailing) { SheetCloseButton { dismiss() }.padding(.top, 8).padding(.trailing, 14) }
        .background(Faff.C.bg.ignoresSafeArea())
        .task { await load() }
    }

    private func load() async {
        defer { loading = false }
        run = (try? await RunByDateAPI.fetch(date: date))?.run
        // Per-run running dynamics from Apple Health for THIS run (cadence,
        // stride, oscillation, ground contact, etc.). The Health tab carries
        // the cumulative 30-day average; the per-run read lives here.
        dynamics = await HealthKitManager.shared.runDynamics(forDateISO: run?.date ?? date)
    }

    // MARK: Empty state (honest, no fabricated run)
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(RunRecapView.prettyDate(date)) · RECAP")
                .font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            Text("NO RUN YET").font(Faff.F.display(40)).foregroundStyle(Faff.C.ink)
            VStack(alignment: .leading, spacing: 6) {
                Text("No run has synced for this day. Connect Strava in Profile and your Apple Watch runs land here with route, mile splits and heart rate.")
                    .font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }.faffCard().padding(.top, 10)
        }.padding(.top, 6)
    }

    // MARK: Helpers
    static func prettyDate(_ iso: String) -> String {
        let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.timeZone = TimeZone(identifier: "UTC")
        guard let d = inF.date(from: String(iso.prefix(10))) else { return iso }
        let out = DateFormatter(); out.dateFormat = "EEE MMM d"; out.timeZone = TimeZone(identifier: "UTC")
        return out.string(from: d).uppercased()
    }

    /// Factual split-trend line (computed, not generated narrative).
    static func splitSummary(_ splits: [RunSplit]) -> String? {
        guard splits.count >= 2 else { return nil }
        let first = splits.first!.paceSPerMi, last = splits.last!.paceSPerMi
        let delta = Int((first - last).rounded())   // + = finished faster
        if delta >= 8 { return "Negative split, finished \(delta) s/mi quicker than you started." }
        if delta <= -8 { return "Positive split, faded \(abs(delta)) s/mi over the run." }
        return "Even pacing, held within \(abs(delta)) s/mi start to finish."
    }

    // (decodePolyline below)
    /// Decode a Google encoded polyline into coordinates.
    static func decodePolyline(_ encoded: String?) -> [CLLocationCoordinate2D]? {
        guard let encoded, !encoded.isEmpty else { return nil }
        var coords: [CLLocationCoordinate2D] = []
        var index = encoded.startIndex
        var lat = 0, lon = 0
        let chars = Array(encoded.unicodeScalars)
        var i = 0
        func next() -> Int {
            var result = 0, shift = 0, b = 0
            repeat {
                guard i < chars.count else { break }
                b = Int(chars[i].value) - 63
                i += 1
                result |= (b & 0x1f) << shift
                shift += 5
            } while b >= 0x20
            return (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
        }
        _ = index
        while i < chars.count {
            lat += next()
            lon += next()
            coords.append(CLLocationCoordinate2D(latitude: Double(lat) / 1e5, longitude: Double(lon) / 1e5))
        }
        return coords.isEmpty ? nil : coords
    }
}

// MARK: - Reusable recap body
//
// The populated recap, header, stats, route, mile splits, summary, per-run
// dynamics, note. Lives in its own view so it can render BOTH in the recap
// sheet (RunRecapView) and inline on the Today tab (past-day / just-finished
// runs), instead of hiding the data behind a "View full recap" tap.
struct RunRecapContent: View {
    let run: RunRecap
    var dynamics: HealthKitManager.RunDynamics?
    var fallbackDate: String = ""
    /// The sheet shows its own header; the inline Today usage already has the
    /// hero above it, so it can hide the duplicate title/date row.
    var showHeader: Bool = true

    var body: some View {
        let r = run
        VStack(alignment: .leading, spacing: Faff.S.rowGap) {
            if showHeader {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text("\(RunRecapView.prettyDate(r.date ?? fallbackDate)) · SYNCED")
                            .font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                        Badge(text: r.type ?? "Run", tone: .green)
                        Spacer()
                    }
                    Text((r.name ?? "Run").uppercased()).font(Faff.F.display(40)).foregroundStyle(Faff.C.ink)
                }
                HStack(spacing: Faff.S.inlineGap) {
                    StatPill(value: OverviewFormat.distance(r.distanceMi), unit: "mi", label: "Distance")
                    StatPill(value: r.paceDisplay, unit: "/mi", label: "Avg pace", accent: true)
                    StatPill(value: r.durationDisplay, unit: nil, label: "Time")
                    if let hr = r.avgHr { StatPill(value: "\(Int(hr))", unit: "bpm", label: "Avg HR") }
                }
            }
            if let coords = RunRecapView.decodePolyline(r.summaryPolyline), coords.count > 1 {
                routeCard(coords)
            }
            if let splits = r.splits, !splits.isEmpty {
                splitsCard(splits)
                if let line = RunRecapView.splitSummary(splits) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("SUMMARY").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                        Text(line).font(Faff.F.inter(13)).foregroundStyle(Faff.C.ink).lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }.faffCard()
                }
            }
            if let dyn = dynamics, dyn.hasAny { dynamicsCard(dyn) }
            if let d = r.description, !d.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("NOTE").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
                    Text(d).font(Faff.F.inter(13)).foregroundStyle(Faff.C.textMuted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }.faffCard()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func routeCard(_ coords: [CLLocationCoordinate2D]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ROUTE").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            Map(initialPosition: .region(RaceDetailView.region(for: coords)), interactionModes: []) {
                MapPolyline(coordinates: coords).stroke(Faff.C.race, lineWidth: 3)
                Annotation("Start", coordinate: coords.first!) {
                    Circle().fill(Faff.C.recovery).frame(width: 11, height: 11).overlay(Circle().stroke(.white, lineWidth: 2))
                }
                Annotation("Finish", coordinate: coords.last!) {
                    Circle().fill(Faff.C.race).frame(width: 11, height: 11).overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .frame(height: 180)
            .clipShape(RoundedRectangle(cornerRadius: Faff.R.tile, style: .continuous))
            .allowsHitTesting(false)
        }.faffCard()
    }

    private func splitsCard(_ splits: [RunSplit]) -> some View {
        let paces = splits.map(\.paceSPerMi)
        let fast = paces.min() ?? 1, slow = paces.max() ?? 1
        return VStack(alignment: .leading, spacing: 10) {
            Text("MILE SPLITS").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            ForEach(splits) { s in
                HStack(spacing: 10) {
                    Text("\(s.mile)").font(Faff.F.display(15)).foregroundStyle(Faff.C.textMuted).frame(width: 18, alignment: .leading)
                    GeometryReader { geo in
                        let frac = slow > fast ? CGFloat((slow - s.paceSPerMi) / (slow - fast)) : 1
                        ZStack(alignment: .leading) {
                            Capsule().fill(Faff.C.track).frame(height: 7)
                            Capsule().fill(Faff.C.recovery).frame(width: max(geo.size.width * (0.25 + 0.75 * frac), 8), height: 7)
                        }.frame(maxHeight: .infinity, alignment: .center)
                    }.frame(height: 16)
                    Text(s.paceDisplay ?? OverviewFormat.pace(s.paceSPerMi)).font(Faff.F.display(16)).foregroundStyle(Faff.C.ink).frame(width: 50, alignment: .trailing)
                    if let hr = s.avgHr {
                        Text("\(Int(hr))").font(Faff.F.inter(11)).foregroundStyle(Faff.C.textDim).frame(width: 30, alignment: .trailing)
                    }
                }
            }
        }.faffCard()
    }

    private struct DynTile: Identifiable { let id = UUID(); let label, value: String; let unit: String? }

    private func dynamicsCard(_ d: HealthKitManager.RunDynamics) -> some View {
        func f(_ v: Double?, _ dec: Int) -> String {
            v.map { dec == 0 ? "\(Int($0.rounded()))" : String(format: "%.\(dec)f", $0) } ?? ", "
        }
        let tiles: [DynTile] = [
            DynTile(label: "Cadence", value: f(d.cadenceSpm, 0), unit: d.cadenceSpm != nil ? "spm" : nil),
            DynTile(label: "Stride", value: f(d.strideM, 2), unit: d.strideM != nil ? "m" : nil),
            DynTile(label: "Vert Osc", value: f(d.vertOscCm, 1), unit: d.vertOscCm != nil ? "cm" : nil),
            DynTile(label: "Grnd Contact", value: f(d.groundContactMs, 0), unit: d.groundContactMs != nil ? "ms" : nil),
            DynTile(label: "Vert Ratio", value: f(d.vertRatioPct, 1), unit: d.vertRatioPct != nil ? "%" : nil),
            DynTile(label: "Run Power", value: f(d.runPowerW, 0), unit: d.runPowerW != nil ? "W" : nil),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            Text("RUNNING DYNAMICS · THIS RUN").font(Faff.F.inter(10, .semibold)).tracking(1.4).foregroundStyle(Faff.C.textDim)
            MetricGrid(items: tiles) { t in
                MetricTile(label: t.label, value: t.value, unit: t.unit,
                           delta: t.unit != nil ? "this run" : "No data", deltaTone: .flat)
            }
        }
    }
}
