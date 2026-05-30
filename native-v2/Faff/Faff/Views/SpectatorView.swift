//
//  SpectatorView.swift
//  Live spectator follow. Ember mesh, glass panels. How he's doing up
//  top, tap −/+ to your spot for the countdown, send cheers that buzz
//  his watch. Opened from his magic link.
//

import SwiftUI

struct SpectatorView: View {
    @State private var mileSpot: Double = 20.0
    @State private var toastVisible: Bool = false
    @State private var lastCheer: String = ""

    private let totalMiles: Double = 26.2
    private let runnerMile: Double = 18.2
    private let runnerPace: Double = 6.8
    private let nowMinutes: Int = 9 * 60 + 4

    var body: some View {
        let mesh = FaffEffort.race.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    topRow
                        .padding(.horizontal, 22)
                        .padding(.top, 8)

                    hero
                        .padding(.horizontal, 24)
                        .padding(.top, 26)

                    bePanel
                        .padding(.horizontal, 18)
                        .padding(.top, 24)

                    cheers
                        .padding(.top, 20)
                        .padding(.bottom, 40)
                }
            }

            if toastVisible {
                VStack {
                    Spacer()
                    HStack(spacing: 9) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Color(hex: 0xD6263C))
                        Text("Cheer sent to David!")
                            .font(.body(14, weight: .extraBold))
                            .foregroundStyle(Color(hex: 0xD6263C))
                    }
                    .padding(.horizontal, 22).padding(.vertical, 13)
                    .background(Color.white, in: Capsule())
                    .shadow(color: .black.opacity(0.4), radius: 14, y: 10)
                    .padding(.bottom, 30)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
    }

    private var topRow: some View {
        HStack(spacing: 11) {
            Text("D")
                .font(.display(16, weight: .bold))
                .foregroundStyle(Color(hex: 0xD6263C))
                .frame(width: 40, height: 40)
                .background(Color.white, in: Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text("David")
                    .font(.display(17, weight: .bold))
                    .tracking(-0.3)
                    .foregroundStyle(Theme.txt)
                Text("CIM · California Marathon")
                    .font(.display(10, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.7))
            }

            Spacer()

            HStack(spacing: 6) {
                LivePulseDot(color: Color(hex: 0xFF3B30), size: 7)
                    .frame(width: 11, height: 11)
                Text("LIVE")
                    .font(.label(10)).tracking(1)
                    .foregroundStyle(Color(hex: 0xD6263C))
            }
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(Color.white, in: Capsule())
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("He's flying.\nOn pace for sub-3!")
                .font(.display(40, weight: .bold))
                .tracking(-1.8)
                .lineSpacing(-8)
                .foregroundStyle(Theme.txt)
                .shadow(color: .black.opacity(0.3), radius: 22, y: 2)

            HStack(spacing: 8) {
                statusPill("Mile 18.2 / 26.2", solid: false)
                statusPill("6:48/mi", solid: false)
                statusPill("Finish ≈ 9:58 AM", solid: true)
            }
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statusPill(_ s: String, solid: Bool) -> some View {
        Text(s)
            .font(.display(12, weight: .bold))
            .foregroundStyle(solid ? Color(hex: 0xD6263C) : Theme.txt)
            .padding(.horizontal, 11).padding(.vertical, 5)
            .background(
                solid ? Color.white : Color.white.opacity(0.14),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(solid ? Color.white : Color.white.opacity(0.24), lineWidth: 1)
            )
    }

    private var bePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            SpecLabel(text: "BE THERE WHEN HE REACHES YOU", size: 11, tracking: 2, color: Theme.txt.opacity(0.6))

            HStack(spacing: 14) {
                stepperButton(symbol: "−") {
                    mileSpot = max(0, mileSpot - 0.5)
                }
                VStack(spacing: 4) {
                    SpecLabel(text: "YOUR SPOT", size: 10, tracking: 1.5, color: Theme.txt.opacity(0.55))
                    Text(mileLabel)
                        .font(.display(30, weight: .bold))
                        .tracking(-1)
                        .foregroundStyle(Theme.txt)
                }
                .frame(maxWidth: .infinity)
                stepperButton(symbol: "+") {
                    mileSpot = min(totalMiles, mileSpot + 0.5)
                }
            }
            .padding(.top, 14)

            VStack(spacing: 9) {
                Text(etaBigLabel)
                    .font(.display(48, weight: .bold))
                    .tracking(-2)
                    .foregroundStyle(Color(hex: 0xFFCE8A))
                Text(etaSubLabel)
                    .font(.display(12, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.66))
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 18)

            if minutesUntil > 0 && minutesUntil < 15 {
                HStack(spacing: 6) {
                    Image(systemName: "flag.fill")
                        .font(.system(size: 11, weight: .bold))
                    Text("He's almost to you — get ready to cheer!")
                        .font(.body(13, weight: .extraBold))
                }
                .foregroundStyle(Color(hex: 0x9AF0BF))
                .frame(maxWidth: .infinity)
                .padding(.top, 13)
            }
        }
        .padding(20)
        .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Color.white.opacity(0.18), lineWidth: 1))
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func stepperButton(symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(symbol)
                .font(.display(28))
                .foregroundStyle(Theme.txt)
                .frame(width: 50, height: 50)
                .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.22), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var cheers: some View {
        VStack(alignment: .leading, spacing: 11) {
            SpecLabel(text: "SEND A CHEER · BUZZES HIS WATCH", size: 11, tracking: 2, color: Theme.txt.opacity(0.7))
                .padding(.leading, 22)

            FlowRow(spacing: 9) {
                cheerButton("Go David!")
                cheerButton("You've got this")
                cheerButton("Almost home")
                cheerHeart
            }
            .padding(.horizontal, 18)
        }
    }

    private func cheerButton(_ text: String) -> some View {
        Button {
            lastCheer = text
            withAnimation(Theme.Motion.sheet) { toastVisible = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
                withAnimation(Theme.Motion.sheet) { toastVisible = false }
            }
        } label: {
            Text(text)
                .font(.body(14, weight: .extraBold))
                .foregroundStyle(Color(hex: 0xD6263C))
                .padding(.horizontal, 17).padding(.vertical, 12)
                .background(Color.white, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private var cheerHeart: some View {
        Button {
            lastCheer = "heart"
            withAnimation(Theme.Motion.sheet) { toastVisible = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
                withAnimation(Theme.Motion.sheet) { toastVisible = false }
            }
        } label: {
            Image(systemName: "heart.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color(hex: 0xD6263C))
                .frame(width: 44, height: 44)
                .background(Color.white, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Derived

    private var mileLabel: String {
        mileSpot >= totalMiles - 0.05 ? "Finish line" : "Mile \(String(format: "%.1f", mileSpot))"
    }

    private var minutesUntil: Int {
        let d = mileSpot - runnerMile
        return Int(round(d * runnerPace))
    }

    private var etaBigLabel: String {
        let d = mileSpot - runnerMile
        let n = abs(Int(round(d * runnerPace)))
        if d >= -0.05 { return "~\(n) min" }
        return "\(n) min ago"
    }

    private var etaSubLabel: String {
        let d = mileSpot - runnerMile
        let dm = d * runnerPace
        let clock = formatClock(nowMinutes + Int(round(dm)))
        if d >= -0.05 {
            return "reaches you \(clock) · \(String(format: "%.1f", d)) mi away"
        }
        return "passed you at \(clock) · \(String(format: "%.1f", abs(d))) mi back"
    }

    private func formatClock(_ totalMin: Int) -> String {
        var h = totalMin / 60
        var m = totalMin % 60
        if m == 60 { m = 0; h += 1 }
        let ap = h >= 12 ? "PM" : "AM"
        var hh = h % 12
        if hh == 0 { hh = 12 }
        return "\(hh):\(String(format: "%02d", m)) \(ap)"
    }
}

// Simple wrapping flow row for the cheer chips.
private struct FlowRow<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: () -> Content

    var body: some View {
        // SwiftUI doesn't have a stable Flow layout pre-iOS 16; fall back to HStack
        // with wrap support via Layout. iPhone target is iOS 16+ here, so use Layout.
        FlowLayout(spacing: spacing) { content() }
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowH: CGFloat = 0
        var totalH: CGFloat = 0
        for sv in subviews {
            let size = sv.sizeThatFits(.unspecified)
            if x + size.width > maxWidth {
                totalH += rowH + spacing
                x = 0
                rowH = 0
            }
            x += size.width + spacing
            rowH = max(rowH, size.height)
            y = totalH + rowH
        }
        totalH += rowH
        return CGSize(width: maxWidth, height: max(totalH, y))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = bounds.minX
        var y: CGFloat = bounds.minY
        var rowH: CGFloat = 0
        for sv in subviews {
            let size = sv.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowH + spacing
                rowH = 0
            }
            sv.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
    }
}
