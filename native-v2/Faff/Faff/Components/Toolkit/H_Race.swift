//
//  H_Race.swift
//  Family H · Race surfaces.
//
//  Components: RaceResultHero · RaceLogisticsTile · CountdownLadder ·
//              GelMileMarkers · CourseAnnotations.
//

import SwiftUI

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
