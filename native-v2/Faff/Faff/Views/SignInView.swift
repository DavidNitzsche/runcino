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

    @State private var toast: String?
    @State private var emailSheet: Bool = false
    /// Which mode the email sheet opens in — sign-in (have an account) or
    /// request-access (invite-only · stranger asks for a login).
    @State private var sheetStartInRequestMode: Bool = false

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                // Logo — top-left, reasonably sized
                HStack {
                    Brandmark(size: 36, style: .swept)
                    Spacer()
                }
                .padding(.top, 64)
                .padding(.horizontal, 30)
                .faffEntrance(0)

                Spacer(minLength: 0)

                // Hero block — centered vertically
                hero
                    .padding(.horizontal, 30)
                    .faffEntrance(1)

                Spacer(minLength: 0)
                Spacer(minLength: 0)

                // Auth + fine print — bottom
                VStack(spacing: 0) {
                    authStack.faffEntrance(2)
                    fine.padding(.top, 16).faffEntrance(3)
                }
                .padding(.horizontal, 30)
                .padding(.bottom, 36)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

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
            EmailSignInSheet(startInRequestMode: sheetStartInRequestMode, onSignedIn: onSignedIn)
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Your running,\ncoached.")
                .font(.heroDisplay(52))
                .tracking(-2)
                .foregroundStyle(Theme.txt)
                .fixedSize(horizontal: false, vertical: true)
            Text("A plan that adapts every day, built from your own training.")
                .font(.body(16, weight: .semibold))
                .foregroundStyle(Theme.txt.opacity(0.55))
                .lineSpacing(3)
        }
    }

    private var authStack: some View {
        // 2026-06-10 · email + password is the only auth path (David:
        // "remove apple sign on, just email and password"). Apple + Google
        // buttons retired. Faff is invite-only, so the secondary CTA is
        // "Request access" (opens the same sheet in request mode), not
        // open signup.
        VStack(spacing: 11) {
            // Primary: white pill, the committed action.
            Button {
                sheetStartInRequestMode = false
                emailSheet = true
            } label: {
                Text("Sign in with email")
                    .font(.body(16, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x0B0B0B))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 17)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(FaffPressStyle())

            // Secondary: request access (invite-only door for new runners).
            Button {
                sheetStartInRequestMode = true
                emailSheet = true
            } label: {
                Text("Request access")
                    .font(.body(15, weight: .bold))
                    .foregroundStyle(Theme.txt.opacity(0.85))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
            .buttonStyle(FaffPressStyle())
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
        .font(.body(10, weight: .semibold))
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
