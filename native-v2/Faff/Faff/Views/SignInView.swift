//
//  SignInView.swift
//  Cool teal welcome. The mesh heats up as the runner commits through onboarding.
//  Pixel spec: designs/faff-iphone-signin.html.
//
//  Apple = the only working path in this PR. Google + email render at full
//  visual fidelity per the design but tapping them fires a "Coming soon"
//  toast. Wiring those flows is a separate workstream (per IPHONE_AGENT_BRIEF_LOGIN.md).
//

import SwiftUI

struct SignInView: View {
    /// Called when sign-in succeeds. `skipOnboarding` is true when the
    /// server told us the runner has `onboarding_complete=true` (returning
    /// user, e.g. David) so the gate should drop them straight into the
    /// main app instead of walking RolePick + Onboarding again.
    let onSignedIn: (_ skipOnboarding: Bool) -> Void

    /// 5-blob mesh in the canonical RECOVERY teal palette (matches
    /// color-system.md). FaffMeshView already paints the design's 4-blob
    /// shape · the extra blob is a deeper base layer that adds weight at
    /// the bottom and never conflicts with the spec.
    private let mesh = FaffMesh(
        c1: 0x7FE6D6, c2: 0x3FB6B0, c3: 0x27B4E0,
        c4: 0x1F8F76, c5: 0x11605E, base: 0x072A28
    )

    @State private var toast: String?
    @State private var emailSheet: Bool = false

    var body: some View {
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(alignment: .leading, spacing: 0) {
                Brandmark(size: 22, style: .swept)
                    .padding(.top, 56)

                Spacer(minLength: 0)

                hero
                    .padding(.top, 4)

                Spacer(minLength: 0)

                authStack
                    .padding(.top, 22)

                fine
                    .padding(.top, 18)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, 30)
            .padding(.bottom, 34)

            // Bottom-anchored toast surface · slides in over the auth stack
            // when Google / email fires; auto-dismisses after 2.4s. Lives
            // above the main VStack so the layout never reflows.
            if let msg = toast {
                ToastBar(text: msg)
                    .padding(.horizontal, 30)
                    .padding(.bottom, 130)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $emailSheet) {
            EmailSignInSheet(onSignedIn: onSignedIn)
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Your\nrunning,\ncoached.")
                .font(.heroDisplay(50))
                .tracking(-2.5)
                .foregroundStyle(Theme.txt)
                .lineSpacing(-6)
                .shadow(color: .black.opacity(0.3), radius: 26, y: 2)
                .fixedSize(horizontal: false, vertical: true)
            Text("A plan that adapts every day, built from your own training. Let's find your starting line.")
                .font(.body(16, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.78))
                .lineSpacing(3)
                .frame(maxWidth: 300, alignment: .leading)
        }
    }

    private var authStack: some View {
        VStack(spacing: 11) {
            // Apple is the canonical button · the native AS framework
            // renders the lockup so we don't recreate the glyph in SwiftUI.
            // Apple flow doesn't yet thread the redirect, so default to
            // the gated path (skipOnboarding: false) — new Apple sign-ups
            // walk RolePick + Onboarding, returning users see one extra
            // tap. Email flow honors the server's redirect directly.
            SignInWithAppleView(onResult: { ok in if ok { onSignedIn(false) } })

            // Google: glass-style button with the real Google G mark.
            // Tap = toast only (no OAuth in this PR per the brief).
            Button {
                showToast("Google sign-in coming soon.")
            } label: {
                HStack(spacing: 11) {
                    GoogleGMark()
                        .frame(width: 18, height: 18)
                    Text("Continue with Google")
                        .font(.body(15, weight: .extraBold))
                }
                .foregroundStyle(Theme.txt)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.26), lineWidth: 1))
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)

            // Email: real path now (2026-05-31). Apple is the primary
            // flow on this build · email is here as the fallback so
            // David can get in while the Apple signin issue is sorted.
            Button {
                emailSheet = true
            } label: {
                Text("Sign in with email")
                    .font(.body(15, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.85))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
            .buttonStyle(.plain)
        }
    }

    /// Oswald 10pt fine print with underlined links. Links are visual-only
    /// in this PR (no routing) per the brief.
    private var fine: some View {
        (
            Text("By continuing you agree to Faff's ")
            + Text("Terms").underline()
            + Text(" & ")
            + Text("Privacy Policy").underline()
            + Text(".")
        )
        .font(.display(10, weight: .semibold))
        .foregroundStyle(Theme.txt.opacity(0.5))
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .lineSpacing(2)
    }

    /// Animate a toast in for 2.4s then back out. Re-tapping the same
    /// button while a toast is already showing replaces the message.
    private func showToast(_ message: String) {
        withAnimation(.easeOut(duration: 0.22)) { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            await MainActor.run {
                withAnimation(.easeIn(duration: 0.22)) { toast = nil }
            }
        }
    }
}

// MARK: - Toast bar
//
// Minimal glass pill that floats above the auth stack. Used only for the
// "Coming soon" feedback on Google + email taps so the runner sees their
// tap registered without sliding to a real flow.

private struct ToastBar: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.body(13, weight: .semibold))
            .foregroundStyle(Theme.txt)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(Color.black.opacity(0.55), in: Capsule())
            .overlay(Capsule().stroke(Color.white.opacity(0.18), lineWidth: 1))
            .background(.ultraThinMaterial, in: Capsule())
            .shadow(color: .black.opacity(0.4), radius: 18, y: 6)
    }
}

// MARK: - Google G mark
//
// Path-rendered Google logo at 18×18 pt. White-tinted at varying opacity
// per the design spec (the 4 wedges read as one mark on a dark background
// without needing the brand's exact red/yellow/green/blue). Pulled from
// the SVG paths in designs/faff-iphone-signin.html.

private struct GoogleGMark: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width
            let h = size.height
            // The original SVG uses viewBox 0 0 24 24. Scale uniformly.
            let s = min(w, h) / 24.0
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: x * s, y: y * s)
            }
            func arcPath(_ build: (inout Path) -> Void) -> Path {
                var p = Path(); build(&p); return p
            }

            // Top-right blue wedge.
            let topRight = arcPath { p in
                p.move(to: point(21.8, 12.2))
                p.addLine(to: point(21.62, 10.4))
                p.addLine(to: point(12, 10.4))
                p.addLine(to: point(12, 13.7))
                p.addLine(to: point(17.6, 13.7))
                p.addLine(to: point(15.6, 16.9))
                p.addLine(to: point(15.58, 17.02))
                p.addLine(to: point(18.48, 19.22))
                p.addLine(to: point(18.68, 19.24))
                p.closeSubpath()
            }

            // Bottom green wedge.
            let bottom = arcPath { p in
                p.move(to: point(12, 22))
                p.addLine(to: point(18.4, 19.66))
                p.addLine(to: point(15.35, 17.3))
                p.addLine(to: point(12, 18.26))
                p.addLine(to: point(6.5, 14.22))
                p.addLine(to: point(6.39, 14.23))
                p.addLine(to: point(3.39, 16.53))
                p.addLine(to: point(3.35, 16.63))
                p.closeSubpath()
            }

            // Left yellow wedge.
            let left = arcPath { p in
                p.move(to: point(6.5, 14.2))
                p.addLine(to: point(6.18, 12.3))
                p.addLine(to: point(6.48, 10.4))
                p.addLine(to: point(6.47, 10.27))
                p.addLine(to: point(3.43, 7.91))
                p.addLine(to: point(3.33, 7.96))
                p.addLine(to: point(2, 12.3))
                p.addLine(to: point(3.07, 16.7))
                p.closeSubpath()
            }

            // Top-left red wedge.
            let topLeft = arcPath { p in
                p.move(to: point(12, 6.4))
                p.addLine(to: point(15.7, 7.83))
                p.addLine(to: point(18.4, 5.19))
                p.addLine(to: point(16.8, 3.7))
                p.addLine(to: point(12, 2.8))
                p.addLine(to: point(3.43, 7.9))
                p.addLine(to: point(6.85, 10.4))
                p.closeSubpath()
            }

            ctx.fill(topRight, with: .color(.white.opacity(1.0)))
            ctx.fill(bottom,   with: .color(.white.opacity(0.8)))
            ctx.fill(left,     with: .color(.white.opacity(0.6)))
            ctx.fill(topLeft,  with: .color(.white.opacity(0.9)))
        }
    }
}
