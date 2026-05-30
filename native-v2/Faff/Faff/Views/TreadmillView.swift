//
//  TreadmillView.swift
//  Guided treadmill console. Mesh shifts with current segment type.
//  State management: per-segment countdown, total accumulated stats.
//

import SwiftUI

struct TreadmillView: View {
    private let segments: [TreadSeg] = [
        TreadSeg(label: "Warm Up",  sub: "",       kind: .warm, mph: 5.5, inc: 1.0, dur: 300),
        TreadSeg(label: "Interval", sub: "1 / 3",  kind: .work, mph: 7.0, inc: 1.5, dur: 180),
        TreadSeg(label: "Recovery", sub: "1 / 3",  kind: .rec,  mph: 5.0, inc: 0.5, dur: 120),
        TreadSeg(label: "Interval", sub: "2 / 3",  kind: .work, mph: 7.0, inc: 1.5, dur: 180),
        TreadSeg(label: "Recovery", sub: "2 / 3",  kind: .rec,  mph: 5.0, inc: 0.5, dur: 120),
        TreadSeg(label: "Interval", sub: "3 / 3",  kind: .work, mph: 7.2, inc: 1.5, dur: 180),
        TreadSeg(label: "Recovery", sub: "3 / 3",  kind: .rec,  mph: 5.0, inc: 0.5, dur: 120),
        TreadSeg(label: "Cool Down",sub: "",       kind: .cool, mph: 5.0, inc: 0.5, dur: 300)
    ]

    @State private var idx: Int = 1
    @State private var leftInSeg: Int = 180
    @State private var totalSec: Int = 330
    @State private var dist: Double = 0.52
    @State private var elev: Double = 29
    @State private var speedMph: Double = 7.0
    @State private var inclinePct: Double = 1.5
    @State private var playing: Bool = true

    var body: some View {
        let mesh = meshFor(segments[min(idx, segments.count - 1)].kind)
        ZStack {
            FaffMeshView(mesh: mesh)
                .animation(.easeInOut(duration: 0.8), value: mesh)

            VStack(spacing: 0) {
                topHead
                    .padding(.horizontal, 20)
                    .padding(.top, 8)

                segRow
                    .padding(.horizontal, 20)
                    .padding(.top, 24)

                segProgressBar
                    .padding(.horizontal, 20)
                    .padding(.top, 16)

                console
                    .padding(.horizontal, 20)
                    .padding(.top, 20)

                Spacer(minLength: 0)

                bottomBlock
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
            }
            .foregroundStyle(Theme.txt)
        }
    }

    private var topHead: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Threshold Intervals")
                    .font(.body(19, weight: .extraBold))
                    .tracking(-0.3)
                SpecLabel(text: "TREADMILL · GUIDED", size: 10, tracking: 2, color: Theme.txt.opacity(0.6))
            }
            HStack(alignment: .top, spacing: 0) {
                topStat("TIME", formatClock(totalSec))
                topStat("DISTANCE", "\(String(format: "%.2f", dist)) mi")
                topStat("ELEV GAIN", "\(Int(round(elev))) ft")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func topStat(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SpecLabel(text: k, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.58))
            Text(v).font(.display(21, weight: .bold)).tracking(-0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var segRow: some View {
        HStack {
            Text(segLabelText)
                .font(.body(14, weight: .extraBold))
                .tracking(1.5)
                .textCase(.uppercase)
                .padding(.horizontal, 18).padding(.vertical, 9)
                .background(Color.white.opacity(0.18), in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(0.32), lineWidth: 1))
                .background(.ultraThinMaterial, in: Capsule())
            Spacer()
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Text(formatClock(leftInSeg))
                    .font(.display(42, weight: .bold))
                    .tracking(-1)
                Text("LEFT")
                    .font(.label(11)).tracking(1.5)
                    .foregroundStyle(Theme.txt.opacity(0.6))
            }
        }
    }

    private var segProgressBar: some View {
        let s = segments[idx]
        let elapsed = max(0, s.dur - leftInSeg)
        let frac = max(0, min(1, Double(elapsed) / Double(s.dur)))
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.2)).frame(height: 8)
                Capsule().fill(Color.white).frame(width: geo.size.width * frac, height: 8)
            }
        }
        .frame(height: 8)
    }

    private var console: some View {
        VStack(spacing: 11) {
            consoleTile(
                label: "SPEED",
                value: String(format: "%.1f", speedMph),
                unit: "mph",
                valueFontSize: 74,
                sub: "\(paceStr(speedMph)) /mi",
                onMinus: { speedMph = max(0.5, round((speedMph - 0.1) * 10) / 10) },
                onPlus:  { speedMph = min(12, round((speedMph + 0.1) * 10) / 10) }
            )
            consoleTile(
                label: "INCLINE",
                value: String(format: "%.1f", inclinePct),
                unit: "%",
                valueFontSize: 54,
                sub: " ",
                onMinus: { inclinePct = max(0, round((inclinePct - 0.5) * 2) / 2) },
                onPlus:  { inclinePct = min(15, round((inclinePct + 0.5) * 2) / 2) }
            )
        }
    }

    private func consoleTile(label: String, value: String, unit: String, valueFontSize: CGFloat, sub: String, onMinus: @escaping () -> Void, onPlus: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            bigStepButton(symbol: "−", action: onMinus)
            VStack(spacing: 5) {
                SpecLabel(text: label, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.62))
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(value).font(.display(valueFontSize, weight: .bold)).tracking(-3)
                        .foregroundStyle(Theme.txt)
                        .shadow(color: .black.opacity(0.32), radius: 22, y: 2)
                    Text(unit).font(.display(valueFontSize * 0.27, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.85))
                }
                Text(sub)
                    .font(.display(10, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(Theme.txt.opacity(0.72))
                    .frame(height: 12)
            }
            .frame(maxWidth: .infinity)
            bigStepButton(symbol: "+", action: onPlus)
        }
        .padding(14)
        .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(Color.white.opacity(0.22), lineWidth: 1))
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private func bigStepButton(symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(symbol)
                .font(.display(32))
                .foregroundStyle(Theme.txt)
                .frame(width: 60, height: 60)
                .background(Color.white.opacity(0.18), in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var bottomBlock: some View {
        VStack(spacing: 11) {
            nextUpCard
            overallTicks
            controlRow
        }
    }

    private var nextUpCard: some View {
        let next = idx + 1 < segments.count ? segments[idx + 1] : nil
        return VStack(alignment: .leading, spacing: 5) {
            SpecLabel(text: "NEXT UP", size: 10, tracking: 2, color: Theme.txt.opacity(0.6))
            HStack(alignment: .bottom) {
                Text(next.map { fullName($0) } ?? "Finish")
                    .font(.body(18, weight: .extraBold))
                    .tracking(-0.3)
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    HStack(alignment: .lastTextBaseline, spacing: 2) {
                        Text(next.map { String(format: "%.1f", $0.mph) } ?? "—")
                            .font(.display(32, weight: .bold)).tracking(-1)
                        Text(next != nil ? "mph" : "")
                            .font(.display(13, weight: .bold))
                    }
                    Text(next.map { "\(String(format: "%.1f", $0.inc))% · \(formatClock($0.dur))" } ?? "complete")
                        .font(.display(11, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.78))
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .background(Color(hex: 0x0A0408).opacity(0.42), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.white.opacity(0.18), lineWidth: 1))
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var overallTicks: some View {
        HStack(spacing: 4) {
            ForEach(0..<segments.count, id: \.self) { i in
                let done = i < idx
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.22)).frame(height: 4)
                        Capsule().fill(Color.white).frame(width: done ? geo.size.width : 0, height: 4)
                    }
                }
                .frame(height: 4)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var controlRow: some View {
        HStack(spacing: 9) {
            controlBtn(icon: playing ? "pause.fill" : "play.fill", label: playing ? "Pause" : "Resume", style: .secondary) {
                playing.toggle()
            }
            controlBtn(icon: "forward.fill", label: "Skip", style: .secondary) { advance() }
            controlBtn(icon: "stop.fill", label: "End", style: .primary) { /* end */ }
        }
    }

    private enum CtrlStyle { case primary, secondary }

    private func controlBtn(icon: String, label: String, style: CtrlStyle, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .bold))
                Text(label).font(.body(13, weight: .extraBold))
            }
            .foregroundStyle(style == .primary ? Color(hex: 0x1A0D12) : Theme.txt)
            .frame(maxWidth: .infinity).padding(.vertical, 13)
            .background(
                style == .primary
                    ? Color.white.opacity(0.92)
                    : Color.white.opacity(0.14),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(style == .primary ? Color.white : Color.white.opacity(0.26), lineWidth: 1)
            )
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - State helpers

    private var segLabelText: String {
        let s = segments[idx]
        return s.sub.isEmpty ? s.label.uppercased() : "\(s.label.uppercased()) \(s.sub)"
    }

    private func advance() {
        let nextIdx = idx + 1
        guard nextIdx < segments.count else { return }
        withAnimation(.easeInOut(duration: 0.4)) {
            idx = nextIdx
            leftInSeg = segments[nextIdx].dur
            speedMph = segments[nextIdx].mph
            inclinePct = segments[nextIdx].inc
        }
    }

    private func formatClock(_ s: Int) -> String {
        let m = s / 60, x = s % 60
        return "\(m < 10 ? "0" : "")\(m):\(x < 10 ? "0" : "")\(x)"
    }

    private func fullName(_ s: TreadSeg) -> String {
        s.sub.isEmpty ? s.label : "\(s.label) \(s.sub)"
    }

    private func paceStr(_ mph: Double) -> String {
        let pmin = 60.0 / mph
        var m = Int(pmin)
        var s = Int(round((pmin - Double(m)) * 60))
        if s == 60 { m += 1; s = 0 }
        return "\(m):\(s < 10 ? "0" : "")\(s)"
    }

    private func meshFor(_ kind: TreadSegKind) -> FaffMesh {
        switch kind {
        case .warm: return FaffMesh(c1: 0x62E3D4, c2: 0x3AB0CF, c3: 0x1C6F9A, c4: 0x0F8F93, c5: 0x0F6A84, base: 0x07323F)
        case .work: return FaffMesh(c1: 0xFFA566, c2: 0xFF5A52, c3: 0xEC2F54, c4: 0xC01D48, c5: 0xA8163F, base: 0x4E0A22)
        case .rec:  return FaffMesh(c1: 0x8EF0B0, c2: 0x34C194, c3: 0x1F8A68, c4: 0x128A64, c5: 0x137259, base: 0x06382E)
        case .cool: return FaffMesh(c1: 0x7FE0D0, c2: 0x34B0A0, c3: 0x1F8A8A, c4: 0x127A72, c5: 0x0F6A64, base: 0x06322E)
        }
    }
}

private enum TreadSegKind { case warm, work, rec, cool }

private struct TreadSeg {
    let label: String
    let sub: String
    let kind: TreadSegKind
    let mph: Double
    let inc: Double
    let dur: Int
}
