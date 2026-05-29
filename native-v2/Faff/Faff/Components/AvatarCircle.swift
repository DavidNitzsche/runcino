//
//  AvatarCircle.swift
//
//  iPhone mirror of the inline avatar block in
//  web-v2/app/profile/page.tsx (the gradient circle showing the
//  runner's initials in the `accent` slot of FaffPageShell).
//
//  Web reference:
//    /Volumes/WP/06 Claude Code/Runcino/web-v2/app/profile/page.tsx:34-44
//
//      <div style={{
//        width: 96, height: 96, borderRadius: '50%',
//        background: 'linear-gradient(135deg, var(--learn), var(--race))',
//        color: '#1a0f33',
//        fontFamily: 'var(--f-display)', fontSize: 40,
//        display: 'flex', alignItems: 'center', justifyContent: 'center',
//        letterSpacing: '1px',
//      }}>{initials}</div>
//
//  The gradient is the locked learn → race spectrum from Theme tokens
//  (#B084FF → #FF8847). On iPhone the inline ZStack in the legacy
//  ProfileView used this same gradient; this component lifts it into a
//  reusable surface so the PageHeader accent slot mirrors the web 1:1.
//

import SwiftUI

struct AvatarCircle: View {
    /// 2-letter initials to render inside the circle (e.g. "DN").
    let initials: String
    /// Circle diameter — defaults to 64pt for the PageHeader accent slot
    /// (a touch smaller than the 96pt web disc to preserve the iPhone
    /// 44pt title's visual weight). Callers can pass 88 for the legacy
    /// hero-block placement.
    var diameter: CGFloat = 64

    var body: some View {
        ZStack {
            Circle().fill(
                LinearGradient(
                    colors: [Theme.learn, Theme.race],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            // The web uses font-size 40 at width 96 (≈ 42% of disc).
            // Match that ratio so the 64pt iPhone disc lands on 27pt.
            Text(initials)
                .font(.display(diameter * 0.42))
                .foregroundStyle(Color(white: 0.1))
                .tracking(1)
        }
        .frame(width: diameter, height: diameter)
    }
}
