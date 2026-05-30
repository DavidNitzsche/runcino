//
//  StickyCTABar.swift
//  Bottom CTA with linear-gradient mask. Used on planned/today completed.
//

import SwiftUI

struct StickyCTABar<Content: View>: View {
    let bgColor: Color
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            LinearGradient(
                stops: [
                    .init(color: bgColor.opacity(0.0), location: 0.0),
                    .init(color: bgColor.opacity(0.96), location: 0.6),
                    .init(color: bgColor.opacity(1.0), location: 1.0)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 64)
            .overlay(alignment: .bottom) {
                content()
                    .padding(.horizontal, 22)
                    .padding(.bottom, 30)
            }
        }
        .allowsHitTesting(true)
    }
}

struct FaffPrimaryButton: View {
    let title: String
    var accentDot: Color? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let dot = accentDot {
                    Circle()
                        .fill(dot)
                        .frame(width: 11, height: 11)
                        .shadow(color: dot, radius: 4)
                }
                Text(title)
                    .font(.body(16.5, weight: .extraBold))
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 17)
            .background(Color(hex: 0x1B1814), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: .black.opacity(0.45), radius: 12, y: 4)
        }
        .buttonStyle(.plain)
    }
}
