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

// MARK: - Full-bleed-safe attachment (FULLBLEED-1)
//
// The three hosts that draw this banner (Today, Block, Races) all used to
// attach it the same copy-pasted way: `.safeAreaInset(edge: .top)` on a
// screen that opens with a `DayPanel` (`PanelV5.swift`). `DayPanel` reaches
// behind the status bar by reading `\.v5TopInset` — the device's own
// physical inset, measured ONCE by a `GeometryReader` at the shell's root
// (`ShellV5.swift`'s `RootV5.body`), before any host has had a chance to add
// this banner — and pulling itself up by exactly that much. A
// `.safeAreaInset` added below the root grows the ambient safe area for
// everything inside it by the banner's own rendered height, but
// `\.v5TopInset` never learns about that growth: it is a value captured once,
// at the top of the tree, and the banner lives beneath it. So the panel's
// pull-up falls short by exactly the banner's height, and the gap it leaves
// is painted in the ordinary page background — a BLACK STRIP, the same
// colour as the rest of the app, sitting between the banner and the panel.
// Invisible when nothing is stale (the gap is 0pt), and exactly the shape of
// "the colour stops short of the top" the moment a runner is offline, which
// is a completely ordinary thing to be mid-run.
//
// The fix stays local to the banner: measure its own rendered height and
// feed the difference back into `\.v5TopInset` for everything the banner
// sits above, so `DayPanel` always pulls up by the FULL amount actually
// consumed — the device inset alone when nothing else is stacked above it,
// device inset plus banner height when there is. One call site
// (`v5StaleBanner`), reused by all three hosts, rather than the same lines
// duplicated a third time with no shared owner to keep them in sync.
private struct V5BannerHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct V5StaleBannerModifier: ViewModifier {
    let stale: Bool
    let cachedAt: Date?
    let onRetry: () -> Void

    /// The device's own inset, as published at the shell's root — correct
    /// on its own, and the base this modifier adds the banner's height to.
    @Environment(\.v5TopInset) private var deviceTopInset
    @State private var bannerHeight: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if stale {
                    StaleBannerV5(cachedAt: cachedAt, onRetry: onRetry)
                        .padding(.horizontal, V5.S.gutter)
                        .padding(.bottom, V5.S.s12)
                        .background(V5.surfacePage)
                        .background(
                            GeometryReader { geo in
                                Color.clear.preference(key: V5BannerHeightKey.self,
                                                        value: geo.size.height)
                            }
                        )
                        .transition(.opacity)
                }
            }
            .onPreferenceChange(V5BannerHeightKey.self) { bannerHeight = $0 }
            .animation(V5.Motion.fill, value: stale)
            // Reaches every `DayPanel` beneath this point in the tree — see
            // the header comment above for why the plain device inset alone
            // is not enough once this banner is actually on screen.
            .environment(\.v5TopInset, deviceTopInset + (stale ? bannerHeight : 0))
    }
}

extension View {
    /// The offline/stale banner (`StaleBannerV5`), attached the one correct
    /// way: in the top safe area, AND keeping any full-bleed `DayPanel`
    /// beneath it pulled up by the banner's own height too. See
    /// `V5StaleBannerModifier`'s header comment for the bug this replaces.
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
