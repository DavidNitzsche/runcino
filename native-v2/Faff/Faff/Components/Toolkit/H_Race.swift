//
//  H_Race.swift
//  Family H · Race surfaces.
//
//  Components: RaceResultHero · RaceLogisticsTile · CountdownLadder ·
//              GelMileMarkers · CourseAnnotations.
//

import SwiftUI
import UIKit

// MARK: - DetectingText · free text with tappable addresses / phones / links
//
// SwiftUI Text can't auto-link addresses. A non-editable, non-scrolling
// UITextView with data detectors does: addresses open Apple Maps, phone numbers
// the dialer, URLs Safari. Used for the prose DETAILS / GOOD TO KNOW values so
// addresses are ALWAYS tappable (David 2026-06-17).

struct DetectingText: UIViewRepresentable {
    let text: String
    var textColor: Color = Theme.txt
    var fontSize: CGFloat = 14

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.isEditable = false
        tv.isScrollEnabled = false
        tv.isSelectable = true
        tv.backgroundColor = .clear
        tv.textContainerInset = .zero
        tv.textContainer.lineFragmentPadding = 0
        tv.dataDetectorTypes = [.address, .link, .phoneNumber]
        tv.setContentCompressionResistancePriority(.required, for: .vertical)
        tv.setContentHuggingPriority(.required, for: .vertical)
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        let para = NSMutableParagraphStyle()
        para.lineSpacing = 2
        tv.attributedText = NSAttributedString(string: text, attributes: [
            .font: UIFont.systemFont(ofSize: fontSize),
            .foregroundColor: UIColor(textColor),
            .paragraphStyle: para,
        ])
        tv.linkTextAttributes = [.foregroundColor: UIColor(Theme.race)]
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 320
        let fit = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(fit.height))
    }
}

// MARK: - RaceResultHero
//
// Past races render the upcoming-race hero today with no result. Swap in
// this block; gold styling when pb=true, plus a deep link into the
// matched run.

struct RaceResultHero: View {
    enum Variant {
        case pr(time: String, raceName: String, pace: String?, avgHr: Int?, activityId: String?)
        case finished(time: String, raceName: String, pace: String?, avgHr: Int?, activityId: String?)
        case loading
    }
    let variant: Variant
    var onViewRun: (String) -> Void = { _ in }

    var body: some View {
        switch variant {
        case .pr(let t, let name, let pace, let hr, let aid):
            container(border: Theme.Accent.amberGold.opacity(0.55)) {
                HStack(spacing: 6) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.Accent.amberGold)
                    Text("Finished · personal best")
                        .font(.body(10, weight: .extraBold))
                        .tracking(1.4).textCase(.uppercase)
                        .foregroundStyle(Theme.Accent.amberGold)
                }
                hero(time: t, color: Theme.Accent.amberGold)
                meta(name: name, pace: pace, hr: hr)
                viewRunLink(aid: aid)
            }
        case .finished(let t, let name, let pace, let hr, let aid):
            container(border: Theme.Glass.line) {
                Text("Finished")
                    .font(.body(10, weight: .extraBold))
                    .tracking(1.4).textCase(.uppercase)
                    .foregroundStyle(Theme.mute)
                hero(time: t, color: Theme.txt)
                meta(name: name, pace: pace, hr: hr)
                viewRunLink(aid: aid)
            }
        case .loading:
            container(border: Theme.Glass.line) {
                RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08))
                    .frame(width: 120, height: 12)
                RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08))
                    .frame(width: 200, height: 44)
                RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08))
                    .frame(maxWidth: .infinity).frame(height: 14)
            }
        }
    }

    @ViewBuilder
    private func container<C: View>(border: Color, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) { content() }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rCard, style: .continuous).stroke(border, lineWidth: 1))
    }

    private func hero(time: String, color: Color) -> some View {
        Text(time)
            .font(.display(44, weight: .bold))
            .monospacedDigit()
            .tracking(-1.5)
            .foregroundStyle(color)
    }

    private func meta(name: String, pace: String?, hr: Int?) -> some View {
        HStack(spacing: 6) {
            Text(name)
                .font(.body(12.5, weight: .semibold))
                .foregroundStyle(Theme.txt)
            if let p = pace {
                sep()
                Text("\(p) /mi").font(.body(12, weight: .medium)).foregroundStyle(Theme.mute)
            }
            if let h = hr {
                sep()
                Text("\(h) avg bpm").font(.body(12, weight: .medium)).foregroundStyle(Theme.mute)
            }
        }
    }
    private func sep() -> some View {
        Text("·").font(.body(12)).foregroundStyle(Theme.dim)
    }

    @ViewBuilder
    private func viewRunLink(aid: String?) -> some View {
        if let id = aid, !id.isEmpty {
            Button { onViewRun(id) } label: {
                HStack(spacing: 4) {
                    Text("View the run")
                        .font(.body(11.5, weight: .extraBold))
                        .foregroundStyle(Theme.dist)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.dist)
                }
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - RaceLogisticsTile
//
// Race-week tile (bib · wave · start time). B-target sits next to the
// A-target so the runner has a fallback line.

struct RaceLogisticsTile: View {
    let bib: String?
    let wave: String?            // "2 · 7:10"
    let startTime: String?       // "7:00"
    let aGoal: String?
    let bGoal: String?
    var onAddLogistics: () -> Void = {}

    private var hasAny: Bool {
        bib != nil || wave != nil || startTime != nil
    }

    var body: some View {
        if hasAny {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    if let b = bib { cell("Bib", b) }
                    if let w = wave { cell("Wave", w) }
                    if let s = startTime { cell("Start", s) }
                }
                if aGoal != nil || bGoal != nil {
                    HStack(spacing: 12) {
                        if let a = aGoal { abTarget(label: "A goal", value: a, color: Theme.race) }
                        if let b = bGoal { abTarget(label: "B goal · safe", value: b, color: Theme.goal) }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        } else {
            VStack(spacing: 10) {
                Image(systemName: "checkmark.seal")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(Theme.mute)
                Text("No bib or wave yet.")
                    .font(.body(12.5, weight: .semibold))
                    .foregroundStyle(Theme.mute)
                Button(action: onAddLogistics) {
                    Text("Add race-day details")
                        .font(.body(11.5, weight: .extraBold))
                        .foregroundStyle(Theme.dist)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Theme.dist.opacity(0.12), in: Capsule())
                        .overlay(Capsule().stroke(Theme.dist.opacity(0.40), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity)
            .padding(16)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        }
    }

    private func cell(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(k.uppercased())
                .font(.body(9, weight: .extraBold)).tracking(1.4)
                .foregroundStyle(Theme.mute)
            Text(v)
                .font(.body(15, weight: .bold)).monospacedDigit()
                .foregroundStyle(Theme.txt)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func abTarget(label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.body(9, weight: .extraBold)).tracking(1.2)
                .foregroundStyle(color)
            Text(value)
                .font(.display(18, weight: .bold)).monospacedDigit()
                .foregroundStyle(Theme.txt)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(color.opacity(0.35), lineWidth: 1))
    }
}

// MARK: - CountdownLadder
//
// Race-week vertical ladder that mirrors the push cadence as an
// always-visible timeline. Today's rung glows.

struct CountdownRung: Identifiable {
    let id: String
    let label: String       // "T-7", "Race"
    let title: String       // "Race week begins"
    let isPast: Bool
    let isToday: Bool
    let isRace: Bool
}

struct CountdownLadder: View {
    let rungs: [CountdownRung]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rungs.enumerated()), id: \.element.id) { idx, r in
                HStack(alignment: .center, spacing: 14) {
                    ZStack {
                        Circle()
                            .fill(rungBg(r))
                            .frame(width: 36, height: 36)
                        if r.isToday {
                            Circle()
                                .stroke(Theme.race, lineWidth: 2)
                                .frame(width: 36, height: 36)
                        }
                        Text(r.label)
                            .font(.body(10.5, weight: .bold)).monospacedDigit()
                            .foregroundStyle(rungTextColor(r))
                    }
                    Text(r.title)
                        .font(.body(13, weight: r.isToday ? .extraBold : .semibold))
                        .foregroundStyle(r.isPast ? Theme.mute : Theme.txt)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 6)
                if idx < rungs.count - 1 {
                    HStack {
                        Rectangle()
                            .fill(r.isPast ? Theme.Glass.line : Theme.mute.opacity(0.20))
                            .frame(width: 2, height: 16)
                            .padding(.leading, 17)
                        Spacer()
                    }
                }
            }
        }
        .padding(16)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private func rungBg(_ r: CountdownRung) -> Color {
        if r.isRace { return Theme.race.opacity(0.18) }
        if r.isToday { return Theme.race.opacity(0.16) }
        if r.isPast { return Color.white.opacity(0.05) }
        return Color.white.opacity(0.07)
    }
    private func rungTextColor(_ r: CountdownRung) -> Color {
        if r.isToday || r.isRace { return Theme.race }
        if r.isPast { return Theme.mute }
        return Theme.txt
    }
}

// MARK: - GelMileMarkers
//
// Tick marks on the elevation curve at the gel points, plus a row below.
// Distance-anchored, so the runner can rehearse on a long run.

struct GelMileMarkers: View {
    let gelsMi: [Double]              // e.g. [6.5, 13.1, 19.7, 25.0]
    let totalMi: Double               // race distance in mi (e.g. 26.2)
    let elevationPoints: [Double]?    // 0..1 normalised, nil → straight baseline

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    // baseline curve / line
                    Path { p in
                        let h = geo.size.height - 22
                        let w = geo.size.width
                        let pts = elevationPoints ?? (0...20).map { _ in 0.5 }
                        let step = w / CGFloat(max(1, pts.count - 1))
                        for i in pts.indices {
                            let x = CGFloat(i) * step
                            let y = 4 + h * CGFloat(1 - pts[i])
                            if i == 0 { p.move(to: CGPoint(x: x, y: y)) }
                            else { p.addLine(to: CGPoint(x: x, y: y)) }
                        }
                    }
                    .stroke(Color.white.opacity(0.30), lineWidth: 2)
                    // gel ticks
                    ForEach(Array(gelsMi.enumerated()), id: \.offset) { _, mi in
                        let x = CGFloat(min(1.0, max(0, mi / max(totalMi, 1)))) * geo.size.width
                        VStack(spacing: 0) {
                            Circle()
                                .fill(Theme.Accent.amberGold)
                                .frame(width: 8, height: 8)
                            Rectangle()
                                .fill(Theme.Accent.amberGold.opacity(0.55))
                                .frame(width: 1, height: 26)
                        }
                        .position(x: x, y: geo.size.height / 2 - 4)
                    }
                }
            }
            .frame(height: 80)
            HStack(spacing: 0) {
                Text("Gels at mile ")
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                Text(gelsMi.map { String(format: "%.1f", $0) }.joined(separator: " · "))
                    .font(.body(12, weight: .semibold))
                    .foregroundStyle(Theme.Accent.amberGold)
            }
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }
}

// MARK: - CourseAnnotations
//
// Endpoint pins + what-to-expect note for editorial courses, credit line
// by source.

struct CourseAnnotations: View {
    enum Variant {
        case editorial(startLabel: String, finishLabel: String, note: String, credit: String)
        case crowdSourced(contributors: Int)
        case stub(onUpload: () -> Void)
    }
    let variant: Variant

    var body: some View {
        switch variant {
        case .editorial(let s, let f, let note, let credit):
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 16) {
                    pin(small: "Start", main: s, color: Theme.green)
                    pin(small: "Finish", main: f, color: Theme.race)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("What to expect")
                        .font(.body(10, weight: .extraBold)).tracking(1.4)
                        .foregroundStyle(Theme.Accent.amberBright)
                    Text(note)
                        .font(.body(13, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.92))
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(credit)
                    .font(.body(10, weight: .extraBold)).tracking(1.4)
                    .foregroundStyle(Theme.mute)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        case .crowdSourced(let n):
            HStack(spacing: 6) {
                Image(systemName: "person.3.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.dist)
                Text("Crowd-sourced by \(n) runners")
                    .font(.body(11, weight: .extraBold)).tracking(0.8)
                    .foregroundStyle(Theme.dist)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Theme.dist.opacity(0.10), in: Capsule())
            .overlay(Capsule().stroke(Theme.dist.opacity(0.35), lineWidth: 1))
        case .stub(let onUpload):
            VStack(spacing: 8) {
                Image(systemName: "map")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(Theme.mute)
                Text("Course preview unavailable.")
                    .font(.body(12.5, weight: .semibold))
                    .foregroundStyle(Theme.mute)
                Button(action: onUpload) {
                    Text("Upload GPX to contribute")
                        .font(.body(11.5, weight: .extraBold))
                        .foregroundStyle(Theme.dist)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Theme.dist.opacity(0.12), in: Capsule())
                        .overlay(Capsule().stroke(Theme.dist.opacity(0.40), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity).padding(16)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        }
    }

    private func pin(small: String, main: String, color: Color) -> some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 10, height: 10)
                .overlay(Circle().stroke(Color.white.opacity(0.25), lineWidth: 2))
            VStack(alignment: .leading, spacing: 2) {
                Text(small.uppercased())
                    .font(.body(9, weight: .extraBold)).tracking(1.4)
                    .foregroundStyle(Theme.mute)
                Text(main)
                    .font(.body(13, weight: .semibold))
                    .foregroundStyle(Theme.txt)
            }
        }
    }
}

// MARK: - CourseElevationProfile
//
// The course terrain plotted by TRUE cumulative distance. GPS samples cluster
// on hills / slow stretches, so plotting by index stretches the busy parts and
// squashes the rest — we resample by great-circle distance so the x-axis is
// honest. Filled race-orange area + line (Theme.race == web's #FF5722), a
// dashed halfway marker, and distance ticks scaled to the race distance. Mirror
// of the web race-page profile (RaceView.tsx · #40). Terrain-only and static —
// it does NOT change as the race approaches (David 2026-06-17).

struct CourseElevationProfile: View {
    let trackPoints: [CourseTrackPoint]
    let distanceMi: Double

    var body: some View {
        let samples = Self.resampleByDistance(trackPoints, count: 160)
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                let w = geo.size.width, h = geo.size.height
                if samples.count >= 2 {
                    let lo = samples.min() ?? 0
                    let hi = samples.max() ?? 1
                    // Floor the visual span so a pancake-flat course renders
                    // flat near the baseline, not as amplified GPS noise.
                    let span = max(hi - lo, 25)
                    ZStack {
                        area(samples, w: w, h: h, lo: lo, span: span)
                            .fill(LinearGradient(
                                colors: [Theme.race.opacity(0.42), Theme.race.opacity(0.0)],
                                startPoint: .top, endPoint: .bottom))
                        line(samples, w: w, h: h, lo: lo, span: span)
                            .stroke(Theme.race, style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                        // Halfway marker · the dashed centerline.
                        Path { p in
                            p.move(to: CGPoint(x: w / 2, y: 0))
                            p.addLine(to: CGPoint(x: w / 2, y: h))
                        }
                        .stroke(Color.white.opacity(0.18), style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    }
                }
            }
            .frame(height: 112)

            // Distance ticks · space-between so START sits at 0 and FINISH at the
            // far edge, the rest distributed across the course.
            let ticks = Self.axisTicks(distanceMi)
            HStack(spacing: 0) {
                ForEach(Array(ticks.enumerated()), id: \.offset) { i, t in
                    Text(t)
                        .font(.body(9.5, weight: .bold)).tracking(0.5)
                        .foregroundStyle(Theme.txt.opacity(0.45))
                    if i < ticks.count - 1 { Spacer(minLength: 0) }
                }
            }
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private func line(_ s: [Double], w: CGFloat, h: CGFloat, lo: Double, span: Double) -> Path {
        Path { p in
            for (i, v) in s.enumerated() {
                let x = CGFloat(i) / CGFloat(s.count - 1) * w
                let y = (1 - CGFloat((v - lo) / span)) * h
                if i == 0 { p.move(to: CGPoint(x: x, y: y)) } else { p.addLine(to: CGPoint(x: x, y: y)) }
            }
        }
    }

    private func area(_ s: [Double], w: CGFloat, h: CGFloat, lo: Double, span: Double) -> Path {
        Path { p in
            p.move(to: CGPoint(x: 0, y: h))
            for (i, v) in s.enumerated() {
                let x = CGFloat(i) / CGFloat(s.count - 1) * w
                let y = (1 - CGFloat((v - lo) / span)) * h
                p.addLine(to: CGPoint(x: x, y: y))
            }
            p.addLine(to: CGPoint(x: w, y: h))
            p.closeSubpath()
        }
    }

    // MARK: - Model helpers (static · the section caption reuses startFinishLabel)

    /// First/last valid elevation in feet → "357 → 227 FT". nil with no ele.
    static func startFinishLabel(_ trackPoints: [CourseTrackPoint]) -> String? {
        let eles = trackPoints.compactMap { $0.ele }
        guard let first = eles.first, let last = eles.last else { return nil }
        return "\(Int((first * 3.28084).rounded())) → \(Int((last * 3.28084).rounded())) FT"
    }

    /// Resample elevation (→ feet) to `count` points evenly spaced by cumulative
    /// great-circle distance. Linear-interpolates ele at each distance target.
    static func resampleByDistance(_ pts: [CourseTrackPoint], count: Int) -> [Double] {
        let valid = pts.compactMap { p -> (lat: Double, lon: Double, ele: Double)? in
            guard let la = p.lat, let lo = p.lon, let e = p.ele else { return nil }
            return (la, lo, e)
        }
        guard valid.count >= 2, count >= 2 else { return [] }
        var cum: [Double] = [0]
        cum.reserveCapacity(valid.count)
        for i in 1..<valid.count { cum.append(cum[i - 1] + haversine(valid[i - 1], valid[i])) }
        let total = cum.last ?? 0
        guard total > 0 else { return valid.map { $0.ele * 3.28084 } }
        var out: [Double] = []
        out.reserveCapacity(count)
        var j = 0
        for k in 0..<count {
            let target = Double(k) / Double(count - 1) * total
            while j < valid.count - 2 && cum[j + 1] < target { j += 1 }
            let d0 = cum[j], d1 = cum[j + 1]
            let t = d1 > d0 ? (target - d0) / (d1 - d0) : 0
            let e = valid[j].ele + (valid[j + 1].ele - valid[j].ele) * t
            out.append(e * 3.28084)   // metres → feet
        }
        return out
    }

    /// X-axis ticks scaled to the race distance. START + FINISH always; the
    /// three interior ticks at the quarter / HALF / three-quarter points — in km
    /// for the marathon family (familiar split markers), else in miles. NOTE:
    /// the center tick is the HALFWAY distance (0.5), unlike the web's #40 which
    /// mislabeled the center with the full distance.
    static func axisTicks(_ distMi: Double) -> [String] {
        let d = distMi > 0 ? distMi : 26.2
        let km = d * 1.609344
        if d >= 13 {
            func q(_ f: Double) -> String { "\(Int((km * f / 5).rounded()) * 5)K" }
            return ["START", q(0.25), q(0.5), q(0.75), "FINISH"]
        }
        func q(_ f: Double) -> String { String(format: "%.1f", d * f) }
        return ["START", q(0.25), q(0.5), q(0.75), "FINISH"]
    }

    private static func haversine(_ a: (lat: Double, lon: Double, ele: Double),
                                  _ b: (lat: Double, lon: Double, ele: Double)) -> Double {
        let R = 6_371_000.0
        let toRad = { (x: Double) in x * .pi / 180 }
        let dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
        let la1 = toRad(a.lat), la2 = toRad(b.lat)
        let hv = sin(dLat / 2) * sin(dLat / 2) + cos(la1) * cos(la2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * R * asin(min(1, sqrt(hv)))
    }
}

// MARK: - RaceDetailsCard · inline-edit logistics ("THE DETAILS")
//
// The practical race-day facts, each editable IN PLACE — tap a row, the value
// turns into a field, commit saves just that one key. The logistics PATCH
// carries no date/goal/priority, so it never triggers a plan rebuild. Replaces
// the read-only list + giant edit sheet (David 2026-06-17: "not so hard to
// edit ... this has to be a killer feature"). The website opens as a link;
// empty rows take an Add tap. The Auto-fill action (parent-owned) populates
// everything from the race site.

struct RaceDetailsCard: View {
    let race: RaceDetail
    let slug: String
    /// Which rows this card manages — lets ONE card drive both THE DETAILS
    /// (logistics) and the GOOD TO KNOW intel card.
    var fields: [Field] = [.start, .corral, .bib, .location, .parking, .shuttle, .packet, .website, .notes]
    /// When true, empty rows hide behind an "Add more" expander so a sparse
    /// race stays clean (David 2026-06-17: "less is more, let the runner fill
    /// any other data needed").
    var collapseEmpty: Bool = false
    /// Parent-owned · opens the AI auto-fill flow. Hidden when nil.
    var onAutofill: (() -> Void)? = nil
    /// Reload the detail after a successful field save.
    var onSaved: () -> Void = {}

    enum Field: String, CaseIterable, Identifiable {
        case start, corral, bib, location, parking, shuttle, packet, website, notes
        case weather, timeLimit, gearCheck, pacers, spectators
        var id: String { rawValue }
        var label: String {
            switch self {
            case .start:    return "START"
            case .corral:   return "CORRAL"
            case .bib:      return "BIB"
            case .location: return "WHERE"
            case .parking:  return "PARKING"
            case .shuttle:  return "SHUTTLE"
            case .packet:   return "PACKET PICKUP"
            case .website:  return "WEBSITE"
            case .notes:    return "NOTES"
            case .weather:    return "WEATHER"
            case .timeLimit:  return "TIME LIMIT"
            case .gearCheck:  return "GEAR CHECK"
            case .pacers:     return "PACERS"
            case .spectators: return "SPECTATORS"
            }
        }
        /// Backend meta key for the PATCH.
        var key: String {
            switch self {
            case .start:    return "startTime"
            case .corral:   return "wave"
            case .bib:      return "bib"
            case .location: return "location"
            case .parking:  return "parking"
            case .shuttle:  return "shuttle"
            case .packet:   return "packetPickup"
            case .website:  return "officialUrl"
            case .notes:    return "notes"
            case .weather:    return "weatherNorms"
            case .timeLimit:  return "timeLimit"
            case .gearCheck:  return "gearCheck"
            case .pacers:     return "pacers"
            case .spectators: return "spectators"
            }
        }
        var placeholder: String {
            switch self {
            case .start:    return "7:00 AM"
            case .corral:   return "Corral / wave"
            case .bib:      return "Bib number"
            case .location: return "Start line / venue"
            case .parking:  return "Where to park"
            case .shuttle:  return "Shuttle / transport"
            case .packet:   return "Where + when"
            case .website:  return "Race website"
            case .notes:    return "Anything to remember"
            case .weather:    return "Typical conditions"
            case .timeLimit:  return "Cutoff / required pace"
            case .gearCheck:  return "Bag drop"
            case .pacers:     return "Pace groups + times"
            case .spectators: return "Where to watch"
            }
        }
        var multiline: Bool {
            // Anything that can be a phrase/sentence wraps (label on top,
            // full-width value below) so it NEVER truncates. Only the genuinely
            // short facts (start time, bib) and the website link stay one-line.
            switch self {
            case .start, .bib, .website: return false
            default: return true
            }
        }
    }

    @State private var editing: Field? = nil
    @State private var draft: String = ""
    @State private var saving: Field? = nil
    @FocusState private var focused: Bool

    private func value(_ f: Field) -> String {
        let raw: String?
        switch f {
        case .start:    raw = race.gun_time
        case .corral:   raw = race.wave
        case .bib:      raw = race.bib
        case .location: raw = race.location
        case .parking:  raw = race.parking
        case .shuttle:  raw = race.shuttle
        case .packet:   raw = race.packet_pickup
        case .website:  raw = race.website
        case .notes:    raw = race.notes
        case .weather:    raw = race.weather_forecast ?? race.weather_norms  // live forecast in race week, else the norm
        case .timeLimit:  raw = race.time_limit
        case .gearCheck:  raw = race.gear_check
        case .pacers:     raw = race.pacers
        case .spectators: raw = race.spectators
        }
        return raw?.trimmingCharacters(in: .whitespaces) ?? ""
    }

    // Empty rows collapse behind an "Add more" expander when collapseEmpty.
    private var shownFields: [Field] {
        // collapseEmpty (the GOOD TO KNOW intel card) shows ONLY what we have —
        // no empty "Add" rows, no expander. THE DETAILS (logistics) shows every
        // row so the runner can fill them (David 2026-06-17: "just show them if
        // we have it").
        collapseEmpty ? fields.filter { !value($0).isEmpty } : fields
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let onAutofill {
                Button { onAutofill() } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "sparkles").font(.system(size: 12, weight: .bold))
                        Text("Auto-fill from the race website")
                            .font(.body(12, weight: .extraBold))
                        Spacer()
                        Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                    }
                    .foregroundStyle(Theme.race)
                    .padding(14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Divider().background(Color.white.opacity(0.08))
            }
            ForEach(Array(shownFields.enumerated()), id: \.element.id) { i, f in
                row(f)
                if i < shownFields.count - 1 {
                    Divider().background(Color.white.opacity(0.08))
                }
            }
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    @ViewBuilder
    private func row(_ f: Field) -> some View {
        if editing == f { editRow(f) } else { displayRow(f) }
    }

    // Display · tap the label/value to edit; the website also opens as a link.
    @ViewBuilder
    private func displayRow(_ f: Field) -> some View {
        let v = value(f)
        if f.multiline && !v.isEmpty {
            // Prose reads top-down: small label, then a full-width value that
            // auto-links addresses (→ Apple Maps), phones, and URLs via
            // DetectingText. Tap the label/padding to edit; the value owns its
            // own link taps (David 2026-06-17).
            VStack(alignment: .leading, spacing: 5) {
                SpecLabel(text: f.label, size: 10, tracking: 1.5, color: Theme.txt.opacity(0.55))
                DetectingText(text: v, textColor: Theme.txt.opacity(0.9))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .contentShape(Rectangle())
            .onTapGesture { begin(f, current: v) }
        } else {
            // Short fields: label left, value right, single line.
            HStack(spacing: 10) {
                HStack(spacing: 10) {
                    SpecLabel(text: f.label, size: 10, tracking: 1.5, color: Theme.txt.opacity(0.55))
                    Spacer(minLength: 12)
                    if v.isEmpty {
                        Text("Add").font(.body(13, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.3))
                        Image(systemName: "plus").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.3))
                    } else {
                        Text(f == .website ? Self.hostOnly(v) : v)
                            .font(.body(15, weight: .bold))
                            .foregroundStyle(f == .website ? Theme.race : Theme.txt)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { begin(f, current: v) }

                // Website open glyph · a sibling Link (not nested in the edit tap).
                if f == .website, !v.isEmpty, let url = Self.normalizedURL(v) {
                    Link(destination: url) {
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.race)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(14)
        }
    }

    // Edit · inline field with Save / Cancel.
    @ViewBuilder
    private func editRow(_ f: Field) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SpecLabel(text: f.label, size: 10, tracking: 1.5, color: Theme.race)
                Spacer()
                if saving == f { ProgressView().controlSize(.mini).tint(Theme.mute) }
            }
            Group {
                if f.multiline {
                    TextField(f.placeholder, text: $draft, axis: .vertical)
                        .lineLimit(2...5)
                } else {
                    TextField(f.placeholder, text: $draft)
                        .keyboardType(f == .website ? .URL : (f == .bib ? .numbersAndPunctuation : .default))
                        .autocorrectionDisabled(f == .website)
                        .textInputAutocapitalization(f == .website ? .never : .sentences)
                        .submitLabel(.done)
                        .onSubmit { Task { await commit(f) } }
                }
            }
            .focused($focused)
            .font(.body(15, weight: .semibold))
            .foregroundStyle(Theme.txt)
            .padding(.vertical, 8).padding(.horizontal, 10)
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))

            HStack(spacing: 16) {
                Button("Save") { Task { await commit(f) } }
                    .font(.body(12, weight: .extraBold)).foregroundStyle(Theme.race)
                Button("Cancel") { cancel() }
                    .font(.body(12, weight: .semibold)).foregroundStyle(Theme.txt.opacity(0.5))
                Spacer()
            }
            .buttonStyle(.plain)
        }
        .padding(14)
    }

    private func begin(_ f: Field, current: String) {
        draft = current
        editing = f
        focused = true
    }
    private func cancel() {
        editing = nil
        focused = false
    }
    private func commit(_ f: Field) async {
        let val = draft.trimmingCharacters(in: .whitespaces)
        await MainActor.run { saving = f }
        let ok = await API.patchRaceMeta(slug: slug, [f.key: val])
        await MainActor.run {
            saving = nil
            if ok {
                editing = nil
                focused = false
                onSaved()
            }
        }
    }

    // URL helpers · normalize a typed site to a tappable URL + a clean host.
    static func normalizedURL(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return nil }
        let low = s.lowercased()
        if !low.hasPrefix("http://") && !low.hasPrefix("https://") { s = "https://" + s }
        return URL(string: s)
    }
    static func prettyHost(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespaces)
        for p in ["https://", "http://"] where s.lowercased().hasPrefix(p) { s = String(s.dropFirst(p.count)) }
        if s.lowercased().hasPrefix("www.") { s = String(s.dropFirst(4)) }
        if s.hasSuffix("/") { s = String(s.dropLast()) }
        return s
    }

    /// Just the domain for a tappable link label — "inmotionevents.com" — so it
    /// never trails off with a long path. The full URL still opens via
    /// normalizedURL (David 2026-06-17: "don't list the URL").
    static func hostOnly(_ raw: String) -> String {
        var s = prettyHost(raw)
        if let slash = s.firstIndex(of: "/") { s = String(s[..<slash]) }
        return s
    }
}

// MARK: - RaceAutofillSheet · AI fill from the race site (review-before-save)
//
// The killer affordance: paste the race URL (or leave blank to find it by name)
// → Claude reads the official site → a PROPOSAL of race-day logistics the
// runner reviews, edits, and toggles before any save. Nothing writes until the
// runner taps Apply. Gated server-side on ANTHROPIC_API_KEY; when it's off the
// sheet degrades to a clear "not switched on" message (David 2026-06-17).

struct RaceAutofillSheet: View {
    let slug: String
    var seedName: String? = nil
    var seedUrl: String? = nil
    var onApplied: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    enum Phase { case input, loading, review, message }
    @State private var phase: Phase = .input
    @State private var url: String = ""
    @State private var message: (title: String, body: String) = ("", "")
    @State private var sources: [String] = []
    @State private var include: Set<String> = []
    @State private var values: [String: String] = [:]
    @State private var saving = false

    private let order: [(key: String, label: String)] = [
        ("summary", "What to expect"),
        ("notableMiles", "Notable miles"),
        ("startTime", "Start time"), ("wave", "Corral / wave"), ("location", "Where"),
        ("aidStations", "Water / aid"),
        ("weatherNorms", "Weather"), ("timeLimit", "Time limit"),
        ("gearCheck", "Gear check"), ("pacers", "Pacers"), ("spectators", "Spectators"),
        ("parking", "Parking"), ("shuttle", "Shuttle"), ("packetPickup", "Packet pickup"),
        ("officialUrl", "Website"), ("notes", "Notes"),
    ]

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .input:   inputForm
                case .loading: loadingView
                case .review:  reviewForm
                case .message: messageView
                }
            }
            .navigationTitle("Auto-fill details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { confirmButton }
            }
            .onAppear { if url.isEmpty, let s = seedUrl { url = s } }
        }
    }

    @ViewBuilder private var confirmButton: some View {
        switch phase {
        case .input:
            Button("Fill") { Task { await runFill() } }
        case .review:
            Button(saving ? "Saving…" : "Apply") { Task { await apply() } }
                .disabled(saving || include.isEmpty)
        default:
            EmptyView()
        }
    }

    private var inputForm: some View {
        Form {
            Section {
                TextField("Race website (optional)", text: $url)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            } header: {
                Text("RACE SITE")
            } footer: {
                Text(seedName?.isEmpty == false
                     ? "Paste the official site, or leave it blank and we'll find \(seedName!) by name. Claude reads the page and fills in start time, corral, parking, shuttle, packet pickup and notes — you review before anything saves."
                     : "Paste the official race site. Claude reads the page and fills in the details — you review before anything saves.")
                    .font(.body(11))
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: 14) {
            ProgressView().controlSize(.large).tint(Theme.race)
            Text("Reading the race site…")
                .font(.body(14, weight: .bold)).foregroundStyle(Theme.txt)
            Text("Finding start time, corral, parking and more. This can take a moment.")
                .font(.body(12)).foregroundStyle(Theme.txt.opacity(0.6))
                .multilineTextAlignment(.center).padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var reviewForm: some View {
        Form {
            Section {
                ForEach(order, id: \.key) { item in
                    if values[item.key] != nil { reviewRow(item.key, item.label) }
                }
            } header: {
                Text("Found — review before saving")
            } footer: {
                if let src = sources.first {
                    Text("Source: \(RaceDetailsCard.prettyHost(src))").font(.body(11))
                }
            }
        }
    }

    @ViewBuilder private func reviewRow(_ key: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: Binding(
                get: { include.contains(key) },
                set: { on in if on { include.insert(key) } else { include.remove(key) } }
            )) {
                Text(label).font(.body(13, weight: .bold))
            }
            TextField(label, text: Binding(
                get: { values[key] ?? "" },
                set: { values[key] = $0 }
            ), axis: .vertical)
                .lineLimit(1...4)
                .font(.body(14))
                .foregroundStyle(include.contains(key) ? Theme.txt : Theme.txt.opacity(0.4))
                .disabled(!include.contains(key))
        }
        .padding(.vertical, 2)
    }

    private var messageView: some View {
        VStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 28, weight: .bold)).foregroundStyle(Theme.race.opacity(0.7))
            Text(message.title).font(.body(16, weight: .bold)).foregroundStyle(Theme.txt)
            Text(message.body).font(.body(12)).foregroundStyle(Theme.txt.opacity(0.6))
                .multilineTextAlignment(.center).padding(.horizontal, 36)
            Button("Try again") { phase = .input }
                .font(.body(13, weight: .extraBold)).foregroundStyle(Theme.race).padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func runFill() async {
        await MainActor.run { phase = .loading }
        let res = await API.autofillRace(slug: slug, url: url, name: seedName)
        await MainActor.run {
            guard let res else {
                message = ("Couldn't reach the assistant", "Check your connection and try again. You can also enter the details by hand.")
                phase = .message; return
            }
            if !res.available {
                message = ("Auto-fill isn't switched on", "This feature needs a one-time setup on the server. Until then, you can enter the details by hand.")
                phase = .message; return
            }
            guard let p = res.proposed else {
                message = ("Couldn't find the details", "Try pasting the exact race website URL, or enter the details by hand.")
                phase = .message; return
            }
            var v: [String: String] = [:]
            var inc: Set<String> = []
            func put(_ key: String, _ val: String?) {
                if let val, !val.trimmingCharacters(in: .whitespaces).isEmpty { v[key] = val; inc.insert(key) }
            }
            put("summary", p.summary); put("aidStations", p.aidStations)
            put("notableMiles", p.notableMiles); put("weatherNorms", p.weatherNorms)
            put("timeLimit", p.timeLimit); put("gearCheck", p.gearCheck)
            put("pacers", p.pacers); put("spectators", p.spectators)
            put("startTime", p.startTime); put("wave", p.wave); put("location", p.location)
            put("parking", p.parking); put("shuttle", p.shuttle); put("packetPickup", p.packetPickup)
            put("officialUrl", p.officialUrl); put("notes", p.notes)
            // bib intentionally skipped — personal, not on the public site.
            sources = res.sources ?? []
            values = v
            include = inc
            if v.isEmpty {
                message = ("Couldn't find the details", "Try pasting the exact race website URL, or enter the details by hand.")
                phase = .message
            } else {
                phase = .review
            }
        }
    }

    private func apply() async {
        await MainActor.run { saving = true }
        var fields: [String: Any] = [:]
        for key in include {
            let val = (values[key] ?? "").trimmingCharacters(in: .whitespaces)
            if !val.isEmpty { fields[key] = val }
        }
        let ok = fields.isEmpty ? true : await API.patchRaceMeta(slug: slug, fields)
        await MainActor.run {
            saving = false
            if ok { onApplied(); dismiss() }
            else { message = ("Save failed", "Check your connection and try again."); phase = .message }
        }
    }
}
