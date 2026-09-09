//
//  StaleStateV5.swift
//  faff.run iPhone · saying which of the three facts this screen is showing.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT WAS WRONG
//
//  With the server unreachable, the app was VISUALLY IDENTICAL to a healthy
//  app. The audit killed the dev server, relaunched, and Today rendered
//  completely normally: the gradient poster, INTERVALS 6.5 mi, the week strip,
//  `Readiness 73 / 100`, `5K fitness 0:19:40 – 0:22:00`, `This week 21.1 mi`,
//  `Sleep 6.6h` — every number served from a twelve-hour disk cache, with no
//  banner, no timestamp, no amber, nothing.
//
//  A runner could not tell whether they were looking at today's plan or
//  Tuesday's. On the morning of a session that is the difference between
//  running the right workout and the wrong one.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY IT WAS INVISIBLE, AND WHY THIS FILE IS SMALL
//
//  Not because the signal was missing. `V5Surface` has carried BOTH halves of
//  the answer since it was written:
//
//      @Published private(set) var stale = false
//      /// A refresh failed. If `model` is non-nil the screen is old, not
//      /// wrong — keep rendering it and let the affected section say it
//      /// could not refresh.
//
//      let cachedAt: Date?
//      /// When the payload in hand was written. For a "cached 12m ago"
//      /// affordance, IF A SCREEN WANTS ONE.
//
//  No screen ever wanted one. The flag was set correctly on every failed
//  refresh and read by exactly nothing, and `isOutage` — the only consumer —
//  is `model == nil && stale`, so it is false in precisely the case that
//  matters here: we HAVE data, and it is old.
//
//  Wired, correct and inert. So this file adds no new state, no second
//  reachability store and no new notification. It renders the two fields the
//  store already computes. One quantity, one name.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 11 AT THE SURFACE
//
//  Fresh, stale and unreachable are three different facts and the screen says
//  which:
//
//    · fresh        — `stale == false`. Nothing is drawn. Silence is the
//                     correct rendering of "this is current".
//    · stale        — `stale == true` with a payload. THIS BANNER: what we
//                     could not do, how old what you are reading is, and a
//                     way to try again. The content stays on screen, because
//                     it is old rather than wrong.
//    · unreachable  — `stale == true` with NO payload. `isOutage`, which the
//                     hosts already route to `OutageBodyV5`. Untouched here.
//
//  The banner never blanks anything and never guesses. Where the age is
//  unknown it says so rather than inventing a time — an unknown age and a
//  fresh one are not the same fact either.
//

import SwiftUI

struct StaleBannerV5: View {
    /// When the payload currently on screen was written. Nil when the store
    /// has no timestamp for it.
    let cachedAt: Date?
    let onRetry: () -> Void

    /// Recomputed each minute so a banner left on screen does not keep
    /// claiming "just now" twenty minutes later. A stale-state surface that
    /// itself goes stale would be the same bug one level up.
    @State private var now = Date()
    private let tick = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: V5.S.s12) {
            Text(sentence)
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: onRetry) {
                Text("Retry")
                    .font(.faffText(TypeScaleV5.label13, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                    .padding(.horizontal, V5.S.s12)
                    .frame(height: 30)
                    .background(V5.materialControl, in: Capsule())
            }
            .buttonStyle(V5PressStyle())
        }
        .padding(.vertical, V5.S.s10)
        .padding(.horizontal, V5.S.tilePad)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(V5.materialTile,
                    in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        // Amber, not red. Nothing has failed for the RUNNER — the plan is
        // intact and what is on screen is real. Fault red is reserved for
        // something being wrong, and old-but-true is not wrong.
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: V5.R.r6, style: .continuous)
                .fill(V5.attention)
                .frame(width: 3)
                .padding(.vertical, V5.S.s8)
                .padding(.leading, V5.S.s6)
        }
        .onReceive(tick) { now = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(sentence)
    }

    /// Coach voice: what we could not do, then how old this is. No hype, no
    /// exclamation, no em dash, and no apology.
    private var sentence: String {
        guard let cachedAt else {
            // Rule 11 again, one level down: "we do not know how old this is"
            // is not "this is current". Say the true, smaller thing.
            return "Can't reach faff. This is your last saved copy."
        }
        return "Can't reach faff. Showing what you had \(Self.age(from: cachedAt, to: now))."
    }

    /// Deliberately coarse. A false precision ("14m ago") on a clock that only
    /// ticks each minute reads as more certain than it is.
    static func age(from then: Date, to now: Date) -> String {
        let secs = max(0, now.timeIntervalSince(then))
        let mins = Int(secs / 60)
        if mins < 2 { return "a moment ago" }
        if mins < 60 { return "\(mins) minutes ago" }
        let hours = mins / 60
        if hours < 24 { return hours == 1 ? "an hour ago" : "\(hours) hours ago" }
        let days = hours / 24
        return days == 1 ? "yesterday" : "\(days) days ago"
    }
}

// MARK: - Full-bleed-safe attachment (FULLBLEED-1, corrected by FULLBLEED-2)
//
// The three hosts that draw this banner (Today, Block, Races) all attach it
// the same way: `.safeAreaInset(edge: .top)` on a screen that opens with a
// `DayPanel` (`PanelV5.swift`). FULLBLEED-1's own diagnosis was that
// `DayPanel`'s pull-up trick — reading `\.v5TopInset`, published ONCE by
// `RootV5.body`'s root `GeometryReader` (`ShellV5.swift`) before this banner
// exists — falls short once the banner grows the ambient safe area, leaving
// a black strip between banner and panel. The prescribed fix was to measure
// the banner's real height and republish `\.v5TopInset` (device inset +
// banner height) for everything beneath it, so `DayPanel` would "pull up by
// the full amount actually consumed."
//
// THAT FIX DOES NOTHING, AND HERE IS THE PROOF (FULLBLEED-2, 2026-09-09).
//
// `DayPanel` reaches behind the status bar with a paired
// `.padding(.top, topInset)` / `.padding(.top, -topInset)` around its
// `.background`+`.clipShape` — see `PanelV5.swift`. That trick only has a
// visible effect when it is bleeding into NON-VIEW safe area (the physical
// status bar / Dynamic Island, which is window chrome, not a SwiftUI view
// competing for space). It has NO effect once a real `.safeAreaInset` — a
// SwiftUI view actively reserving space, exactly what this banner is — is
// active above it: SwiftUI's own automatic safe-area avoidance is what
// places the ScrollView's content in that case, and it does not consult
// `\.v5TopInset` at all.
//
// Verified four independent ways with a real `DayPanel` + real
// `v5StaleBanner`, real `.safeAreaInset`, and pixel-sampled screenshots (see
// the FULLBLEED-2 investigation notes in `docs/PRODUCT_DECISIONS.md`):
// with the host's own ancestor `.animation(value:)` present and absent, with
// `\.v5TopInset` pinned to the OLD, banner-unaware value (62pt) instead of
// the "corrected" one (132.5pt), and with `.id(topInset)` forcing a full
// view-identity reset. All four rendered PIXEL-IDENTICAL: the panel starts
// exactly at the banner's own reserved safe area, regardless of what
// `\.v5TopInset` said. Changing `\.v5TopInset` is not being ignored on some
// stale render — the value the fixed code computes is simply never consulted
// by the geometry that would need it, in this configuration.
//
// So `\.v5TopInset` republishing is deleted here: it is provably inert, and
// leaving it in place — with a comment asserting it is "how DayPanel always
// pulls up by the full amount actually consumed" — is exactly the Rule 20
// failure mode (a claim nothing verifies, now disproven). `.safeAreaInset`
// alone already places the panel correctly against the banner; there is
// nothing left for `DayPanel` to be told.
//
// WHAT IS STILL OPEN. The panel lands flush against the banner's full
// reserved footprint, which includes the banner's own trailing
// `.padding(.bottom, V5.S.s12)` — a small (~12pt), same-colour band that
// reads as more black than a true zero-gap full-bleed would. One attempt to
// close it (deleting that padding outright) produced a much larger, harder
// regression — the panel overlapping the banner entirely — that this session
// did not have a verified explanation for, so it was reverted rather than
// shipped as a guess. See the follow-up task spawned for that specific gap.
private struct V5StaleBannerModifier: ViewModifier {
    let stale: Bool
    let cachedAt: Date?
    let onRetry: () -> Void

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if stale {
                    StaleBannerV5(cachedAt: cachedAt, onRetry: onRetry)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.bottom, V5.S.s12)
                        .background(V5.surfacePage)
                        .transition(.opacity)
                }
            }
            .animation(V5.Motion.fill, value: stale)
    }
}

extension View {
    /// The offline/stale banner (`StaleBannerV5`), attached in the top safe
    /// area. `.safeAreaInset` alone is what keeps any full-bleed `DayPanel`
    /// beneath it correctly placed — see `V5StaleBannerModifier`'s header
    /// comment for why nothing else is needed, and for the fix this replaced
    /// that turned out to be inert.
    func v5StaleBanner(stale: Bool, cachedAt: Date?, onRetry: @escaping () -> Void) -> some View {
        modifier(V5StaleBannerModifier(stale: stale, cachedAt: cachedAt, onRetry: onRetry))
    }
}

#Preview("Stale · known age") {
    VStack(spacing: V5.S.s16) {
        StaleBannerV5(cachedAt: Date().addingTimeInterval(-42 * 60), onRetry: {})
        StaleBannerV5(cachedAt: Date().addingTimeInterval(-9 * 3600), onRetry: {})
        StaleBannerV5(cachedAt: nil, onRetry: {})
    }
    .padding()
    .background(V5.surfacePage)
}
