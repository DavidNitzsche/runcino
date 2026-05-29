//
//  PageHeader.swift
//
//  iPhone mirror of web-v2/components/faff/FaffPageShell.tsx — the
//  shared chrome wrapper that gives every secondary surface (training /
//  races / health / log / profile) the same display-recipe title +
//  caps-tracked eyebrow + optional accent slot.
//
//  Web reference:
//    /Volumes/WP/06 Claude Code/Runcino/web-v2/components/faff/FaffPageShell.tsx
//    /Volumes/WP/06 Claude Code/Runcino/web-v2/components/faff/FaffPageShell.module.css
//
//  Mirrors the locked display recipe (Oswald 700, -0.015em tracking,
//  0.86 line-height) so headers look the same across surfaces. On the
//  web, the title sizes via `clamp(48px, 7vw, 80px)`; on iPhone we lock
//  to a fixed 44pt display size that matches the 7vw mid-size at typical
//  iPhone widths (390–430pt). The locked title color is `Theme.ink`; the
//  caller can override via `titleColor` (e.g. `Theme.over` for the
//  Health WATCH-RED headline, mirroring `titleColor` on the web shell).
//
//  Placement note: SwiftUI views typically rely on `.navigationTitle()`
//  for system chrome. Here we paint the title *inside* the ScrollView so
//  it scrolls with the content (matching the web band that lives above
//  the content card area), and let the parent suppress the system title
//  by setting `.navigationBarTitleDisplayMode(.inline)` or hiding it
//  outright. The legacy `.navigationTitle("Training")` line in the
//  caller is fine to keep — the in-shell PageHeader is what carries the
//  display recipe.
//

import SwiftUI

struct PageHeader: View {
    /// The hero phrase. Mirrors `title` on FaffPageShell — the
    /// display-recipe verb (Oswald 700, ink, large).
    let title: String
    /// Caps-tracked secondary line above (web) or below (iPhone) the title.
    /// Mirrors `eyebrow` on FaffPageShell. Optional.
    let eyebrow: String?
    /// Optional subhead — Inter medium 13pt, mute. Mirrors `subhead` on
    /// FaffPageShell. Used by surfaces that need a third line of meta.
    var subhead: String? = nil
    /// Optional title color override (e.g. Theme.over for the WATCH-RED
    /// Health headline). Defaults to Theme.ink.
    var titleColor: Color = Theme.ink
    /// Optional right-side affordance — chip, button, avatar block.
    /// Mirrors `accent` slot on FaffPageShell.
    var accent: AnyView? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                Text(title)
                    // Oswald 700 + -0.015em tracking + 0.86 line-height.
                    // 44pt matches the mid-clamp web size at typical iPhone
                    // widths (390–430pt screens).
                    .displayRecipe(size: 44)
                    .foregroundStyle(titleColor)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let accent {
                    accent
                }
            }
            if let eyebrow, !eyebrow.isEmpty {
                Text(eyebrow)
                    .font(.body(11, weight: .bold))
                    .tracking(1.6)
                    .foregroundStyle(Theme.mute)
                    .textCase(.uppercase)
            }
            if let subhead, !subhead.isEmpty {
                Text(subhead)
                    .font(.body(13, weight: .medium))
                    .foregroundStyle(Theme.mute)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 18)
    }
}
