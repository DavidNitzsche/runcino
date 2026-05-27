//
//  RunDetailSheet.swift
//  P28 — single run drill-down (matches web /runs/[id] modal).
//  Stats hero · splits · HR zones · form metrics · route polyline.
//

import SwiftUI

struct RunDetailSheet: View {
    let runId: String
    let fallback: LogRun

    @Environment(\.dismiss) private var dismiss
    @State private var detail: RunDetail?
    @State private var loading = true
    @State private var shoes: [Shoe] = []
    @State private var assignedShoeId: Int?
    @State private var showShoePicker = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if loading {
                        HStack { Spacer(); ProgressView().tint(Theme.green); Spacer() }
                            .padding(40)
                    } else if let d = detail {
                        hero(d)
                        statRow(d)
                        shoeRow()
                        if let phases = d.phase_breakdown, !phases.isEmpty {
                            phaseBreakdownBlock(phases)
                        }
                        if !d.splits.isEmpty { splitsBlock(d.splits) }
                        hrZonesBlock(d)
                        if hasAnyForm(d.form) { formBlock(d.form) }
                        if d.has_route, let poly = d.route_polyline, !poly.isEmpty {
                            routeBlock(poly)
                        }
                    } else {
                        Text("Couldn't load this run's details.")
                            .font(.body(13))
                            .foregroundStyle(Theme.mute)
                            .padding(.horizontal, 24)
                    }
                }
                .padding(.vertical, 18)
            }
            .background(Theme.bg.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.green)
                }
            }
        }
        .task { await load() }
    }

    // MARK: - Hero

    private func hero(_ d: RunDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text((d.type ?? "RUN").uppercased())
                .font(.body(10, weight: .bold)).tracking(1.4)
                .foregroundStyle(Theme.green)
            Text(d.name ?? "Run")
                .font(.display(34))
                .foregroundStyle(Theme.ink)
            Text(d.date).font(.body(12)).foregroundStyle(Theme.mute)
        }
        .padding(.horizontal, 24)
    }

    // MARK: - Stat row (distance · time · pace · HR · cadence · elev)

    private struct StatKV { let key: String; let value: String }

    private func buildStats(_ d: RunDetail) -> [StatKV] {
        var out: [StatKV] = []
        out.append(.init(key: "DIST", value: String(format: "%.2f mi", d.distance_mi)))
        out.append(.init(key: "TIME", value: d.time_moving ?? "—"))
        out.append(.init(key: "PACE", value: d.pace ?? "—"))
        out.append(.init(key: "HR AVG", value: d.hr_avg.map { "\($0) bpm" } ?? "—"))
        out.append(.init(key: "HR MAX", value: d.hr_max.map { "\($0) bpm" } ?? "—"))
        out.append(.init(key: "CAD", value: d.cadence_avg.map { String($0) } ?? "—"))
        out.append(.init(key: "ELEV", value: d.elev_gain_ft.map { "\($0) ft" } ?? "—"))
        out.append(.init(key: "TEMP", value: d.temp_f.map { String(format: "%.0f°F", $0) } ?? "—"))
        return out
    }

    private func statRow(_ d: RunDetail) -> some View {
        let stats = buildStats(d)
        return VStack(alignment: .leading, spacing: 14) {
            statRowSlice(Array(stats.prefix(4)))
            if stats.count > 4 {
                statRowSlice(Array(stats.suffix(from: 4)))
            }
        }
        .padding(16)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        .padding(.horizontal, 24)
    }

    private func statRowSlice(_ stats: [StatKV]) -> some View {
        HStack(spacing: 14) {
            ForEach(0..<stats.count, id: \.self) { i in
                VStack(alignment: .leading, spacing: 2) {
                    Text(stats[i].key)
                        .font(.body(9, weight: .bold)).tracking(1.2)
                        .foregroundStyle(Theme.mute)
                    Text(stats[i].value)
                        .font(.body(14, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(0..<max(0, 4 - stats.count), id: \.self) { _ in
                Color.clear.frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - P44 Phase breakdown (plan vs actual)

    private func phaseBreakdownBlock(_ phases: [PhaseBreakdown]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("BREAKDOWN · PLAN vs ACTUAL")
                .font(.body(10, weight: .bold)).tracking(1.4).foregroundStyle(Theme.goal)
                .padding(.horizontal, 24)
            VStack(spacing: 0) {
                ForEach(phases) { p in
                    phaseRow(p)
                    if p.index != phases.last?.index {
                        Divider().background(Theme.line).padding(.leading, 16)
                    }
                }
            }
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
            .padding(.horizontal, 24)
        }
    }

    private func phaseRow(_ p: PhaseBreakdown) -> some View {
        let showPace = p.type == "work"
        let targetText: String = {
            if showPace { return p.target_pace ?? "—" }
            if let sec = p.target_duration_sec, sec > 0 { return fmtPhaseDuration(sec) }
            return p.target_pace ?? "—"
        }()
        let actualText: String = {
            if showPace { return p.actual_pace ?? "—" }
            if let sec = p.actual_duration_sec, sec > 0 { return fmtPhaseDuration(sec) }
            return p.actual_pace ?? "—"
        }()
        let statusColor: Color = {
            switch p.status {
            case "on": return Theme.green
            case "fast": return Theme.over
            case "slow": return Theme.goal
            default: return Theme.mute
            }
        }()
        let statusLabel: String = {
            switch p.status {
            case "on": return "ON"
            case "fast": return "FAST"
            case "slow": return "SLOW"
            default: return "—"
            }
        }()
        let typeBadgeColor: Color = {
            switch p.type {
            case "warmup", "cooldown": return Theme.rest
            case "recovery": return Theme.mute
            case "work": return Theme.goal
            default: return Theme.ink
            }
        }()
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(p.type.uppercased())
                        .font(.body(8, weight: .bold)).tracking(1.0)
                        .foregroundStyle(typeBadgeColor)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Theme.bg.opacity(0.5))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                    Text(p.label).font(.body(12)).foregroundStyle(Theme.ink)
                }
                if let mi = p.actual_distance_mi {
                    Text(String(format: "%.2f mi", mi))
                        .font(.body(10)).foregroundStyle(Theme.mute)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 1) {
                Text("TARGET").font(.body(8, weight: .bold)).tracking(0.8).foregroundStyle(Theme.mute)
                Text(targetText).font(.body(12, weight: .semibold)).foregroundStyle(Theme.mute)
            }
            .frame(width: 64, alignment: .trailing)
            VStack(alignment: .trailing, spacing: 1) {
                Text("ACTUAL").font(.body(8, weight: .bold)).tracking(0.8).foregroundStyle(Theme.mute)
                Text(actualText).font(.body(12, weight: .semibold)).foregroundStyle(Theme.ink)
            }
            .frame(width: 64, alignment: .trailing)
            VStack(alignment: .trailing, spacing: 1) {
                Text("HR").font(.body(8, weight: .bold)).tracking(0.8).foregroundStyle(Theme.mute)
                Text(p.avg_hr.map { String($0) } ?? "—")
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(p.avg_hr != nil ? Theme.ink : Theme.mute)
            }
            .frame(width: 42, alignment: .trailing)
            Text(statusLabel)
                .font(.body(9, weight: .bold)).tracking(0.8)
                .foregroundStyle(statusColor)
                .frame(width: 38, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func fmtPhaseDuration(_ secs: Int) -> String {
        let m = secs / 60
        let s = secs % 60
        if m == 0 { return "\(s)s" }
        return String(format: "%d:%02d", m, s)
    }

    // MARK: - Splits

    private func splitsBlock(_ splits: [RunSplit]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SPLITS")
                .font(.body(10, weight: .bold)).tracking(1.4).foregroundStyle(Theme.mute)
                .padding(.horizontal, 24)
            VStack(spacing: 0) {
                ForEach(splits) { s in
                    HStack {
                        Text("Mile \(s.mile)").font(.body(12)).foregroundStyle(Theme.ink)
                        Spacer()
                        if let p = s.pace { Text(p).font(.body(12, weight: .semibold)).foregroundStyle(Theme.ink) }
                        if let hr = s.hr { Text("\(hr) bpm").font(.body(11)).foregroundStyle(Theme.mute).frame(width: 70, alignment: .trailing) }
                        if let el = s.elev_change_ft {
                            let sign = el >= 0 ? "+" : ""
                            Text("\(sign)\(el)ft").font(.body(11)).foregroundStyle(el >= 0 ? Theme.over : Theme.dist).frame(width: 60, alignment: .trailing)
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    if s.mile != splits.last?.mile {
                        Divider().background(Theme.line).padding(.leading, 16)
                    }
                }
            }
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
            .padding(.horizontal, 24)
        }
    }

    // MARK: - HR zones

    private func hrZonesBlock(_ d: RunDetail) -> some View {
        let zones: [(label: String, pct: Double, color: Color)] = [
            ("Z1", d.hrZonePcts.z1, Theme.rest),
            ("Z2", d.hrZonePcts.z2, Theme.dist),
            ("Z3", d.hrZonePcts.z3, Theme.green),
            ("Z4", d.hrZonePcts.z4, Theme.goal),
            ("Z5", d.hrZonePcts.z5, Theme.over),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            Text("HR ZONES")
                .font(.body(10, weight: .bold)).tracking(1.4).foregroundStyle(Theme.mute)
                .padding(.horizontal, 24)
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(zones, id: \.label) { z in
                        Rectangle()
                            .fill(z.color)
                            .frame(width: max(2, geo.size.width * z.pct / 100.0))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .frame(height: 10)
            .padding(.horizontal, 24)
            HStack {
                ForEach(zones, id: \.label) { z in
                    VStack(spacing: 2) {
                        Text(z.label).font(.body(9, weight: .bold)).foregroundStyle(z.color)
                        Text("\(Int(z.pct))%").font(.body(10)).foregroundStyle(Theme.mute)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 24)
        }
    }

    // MARK: - Form

    private func hasAnyForm(_ f: RunForm) -> Bool {
        f.cadence_spm != nil || f.stride_length_m != nil || f.vertical_oscillation_cm != nil
            || f.ground_contact_ms != nil || f.run_power_w != nil
    }

    private func formBlock(_ f: RunForm) -> some View {
        let cols: [(String, String)] = [
            ("CADENCE", f.cadence_spm.map { "\(Int($0)) spm" } ?? "—"),
            ("STRIDE",  f.stride_length_m.map { String(format: "%.2f m", $0) } ?? "—"),
            ("V-OSC",   f.vertical_oscillation_cm.map { String(format: "%.1f cm", $0) } ?? "—"),
            ("GCT",     f.ground_contact_ms.map { "\(Int($0)) ms" } ?? "—"),
            ("POWER",   f.run_power_w.map { "\(Int($0)) W" } ?? "—"),
            ("V-RATIO", f.vertical_ratio_pct.map { String(format: "%.1f%%", $0) } ?? "—"),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            Text("FORM")
                .font(.body(10, weight: .bold)).tracking(1.4).foregroundStyle(Theme.mute)
                .padding(.horizontal, 24)
            VStack(spacing: 10) {
                ForEach(0..<2) { row in
                    HStack(spacing: 10) {
                        ForEach(0..<3) { col in
                            let i = row * 3 + col
                            if i < cols.count {
                                let (k, v) = cols[i]
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(k).font(.body(9, weight: .bold)).tracking(1.0).foregroundStyle(Theme.mute)
                                    Text(v).font(.body(13, weight: .semibold)).foregroundStyle(Theme.ink)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
            }
            .padding(16)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
            .padding(.horizontal, 24)
        }
    }

    // MARK: - Route

    private func routeBlock(_ polyline: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ROUTE")
                .font(.body(10, weight: .bold)).tracking(1.4).foregroundStyle(Theme.mute)
                .padding(.horizontal, 24)
            // Sparkline-style decoded polyline. Decoding is best-effort
            // and matches the web /runs/[id] approach (no MapKit).
            RoutePolylineSparkline(encoded: polyline)
                .frame(height: 140)
                .padding(.horizontal, 24)
        }
    }

    // MARK: - P32 shoe picker

    @ViewBuilder
    private func shoeRow() -> some View {
        Button { showShoePicker = true } label: {
            HStack(spacing: 12) {
                Image(systemName: "shoe.2.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.green)
                    .frame(width: 28, height: 28)
                    .background(Theme.green.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                VStack(alignment: .leading, spacing: 2) {
                    Text("SHOES").font(.body(9, weight: .bold)).tracking(1.2).foregroundStyle(Theme.mute)
                    Text(currentShoeLabel())
                        .font(.body(13, weight: .semibold))
                        .foregroundStyle(assignedShoeId == nil ? Theme.mute : Theme.ink)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.mute)
            }
            .padding(14)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 24)
        .sheet(isPresented: $showShoePicker) {
            ShoePickerSheet(shoes: shoes, assigned: assignedShoeId) { id in
                Task { await assignShoe(id) }
                showShoePicker = false
            }
        }
    }

    private func currentShoeLabel() -> String {
        if let id = assignedShoeId, let s = shoes.first(where: { $0.id == id }) {
            return s.displayName
        }
        return "Tap to assign"
    }

    private func assignShoe(_ shoeId: Int?) async {
        do {
            try await API.assignShoeToRun(runId: runId, shoeId: shoeId)
            assignedShoeId = shoeId
        } catch {
            print("[ShoePicker] assign failed: \(error)")
        }
    }

    private func load() async {
        defer { loading = false }
        self.detail = try? await API.fetchRunDetail(id: runId)
        if let s = try? await API.fetchShoes()?.shoes {
            self.shoes = s.filter { !($0.retired ?? false) }
        }
        // TODO: server doesn't yet return assigned shoe_id on RunDetail.
        // Coach + log views will pick it up via the recomputed mileage.
        // Future patch: extend RunDetail with shoe_id.
    }
}

// MARK: - Shoe picker sheet

private struct ShoePickerSheet: View {
    let shoes: [Shoe]
    let assigned: Int?
    let onPick: (Int?) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { onPick(nil) } label: {
                        HStack {
                            Text("None — clear assignment")
                            Spacer()
                            if assigned == nil {
                                Image(systemName: "checkmark").foregroundStyle(Theme.green)
                            }
                        }
                    }
                }
                Section("Active") {
                    ForEach(shoes) { s in
                        Button { onPick(s.id) } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.displayName).foregroundStyle(Theme.ink)
                                    Text(mileageLine(s)).font(.body(11)).foregroundStyle(Theme.mute)
                                }
                                Spacer()
                                if assigned == s.id {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.green)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Pick shoes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func mileageLine(_ s: Shoe) -> String {
        let cur = s.mileage ?? 0
        if let cap = s.mileage_cap, cap > 0 {
            let remain = max(0, cap - cur)
            return String(format: "%.0f mi · %.0f remaining", cur, remain)
        }
        return String(format: "%.0f mi", cur)
    }
}

// MARK: - Polyline sparkline

private struct RoutePolylineSparkline: View {
    let encoded: String
    var body: some View {
        Canvas { ctx, size in
            let coords = decodePolyline(encoded)
            guard coords.count >= 2 else { return }
            // Normalize to canvas
            let lats = coords.map { $0.0 }
            let lngs = coords.map { $0.1 }
            let minLat = lats.min()!, maxLat = lats.max()!
            let minLng = lngs.min()!, maxLng = lngs.max()!
            let dLat = max(maxLat - minLat, 1e-6)
            let dLng = max(maxLng - minLng, 1e-6)
            let pad: CGFloat = 8
            var path = Path()
            for (i, (lat, lng)) in coords.enumerated() {
                let x = pad + CGFloat((lng - minLng) / dLng) * (size.width - pad * 2)
                let y = pad + CGFloat(1.0 - (lat - minLat) / dLat) * (size.height - pad * 2)
                if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                else      { path.addLine(to: CGPoint(x: x, y: y)) }
            }
            ctx.stroke(path, with: .color(Theme.green), lineWidth: 2)
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.rCard))
        .overlay(RoundedRectangle(cornerRadius: Theme.rCard).stroke(Theme.line, lineWidth: 1))
    }

    /// Google polyline decoder (precision 5).
    private func decodePolyline(_ s: String) -> [(Double, Double)] {
        var coords: [(Double, Double)] = []
        var index = s.startIndex
        var lat = 0, lng = 0
        while index < s.endIndex {
            func decodeOne() -> Int {
                var shift = 0, result = 0
                while index < s.endIndex {
                    let b = Int(s[index].asciiValue ?? 0) - 63
                    index = s.index(after: index)
                    result |= (b & 0x1f) << shift
                    if b < 0x20 { break }
                    shift += 5
                }
                return (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
            }
            lat += decodeOne()
            lng += decodeOne()
            coords.append((Double(lat) / 1e5, Double(lng) / 1e5))
        }
        return coords
    }
}
