//
//  PageHeader.swift
//  Standard header strip: small left eyebrow + avatar (right) or back-chip (left).
//  Used at the top of every tab + most pushed views.
//

import SwiftUI

struct PageHeader: View {
    let title: String
    var rightLabel: String? = nil
    /// Avatar initials for tappable profile entry.
    var avatarInitials: String? = nil
    var onAvatarTap: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .center) {
            SpecLabel(text: title, size: 13, tracking: 2.5, color: Theme.txt)
            Spacer()
            if let avatar = avatarInitials {
                Button { onAvatarTap?() } label: {
                    Text(avatar)
                        .font(.body(12, weight: .bold))
                        .foregroundStyle(Theme.txt)
                        .frame(width: 32, height: 32)
                        .background(
                            LinearGradient(colors: [Color(hex: 0xD03F3F), Color(hex: 0xD6263C)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: Circle()
                        )
                }
                .buttonStyle(.plain)
            } else if let r = rightLabel {
                Text(r)
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Theme.txt.opacity(0.78))
            }
        }
    }
}
