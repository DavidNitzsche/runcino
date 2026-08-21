//
//  ShellV5.swift
//  faff.run iPhone · the v5 shell.
//
//  Three destinations — Today, Block, Races — plus a filled RUN pill that only
//  appears when "start runs from this phone" is on in Settings. Everything else
//  in the design is reached from those three.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE BAR'S OWN RULE, FROM THE PROTOTYPE
//
//      "Destinations only, icon over label. The verb lives on the screen it
//       acts on, never in the bar."
//      "The same three, plus RUN as a filled slot inside the band. One verb,
//       flush with the bar, never raised."
//
//  So RUN is a slot in the band, not a floating action button and not a raised
//  centre tab. The previous shell's centre RUN opened a popover of four
//  unrelated things; this one opens exactly the two the design names.
//
//  Metrics are the prototype's, verbatim: a 62pt band on `--surface-page`,
//  12pt side padding, 4pt between destinations and 6pt once RUN joins them.
//  A destination is flex 1, full height, radius 18, transparent, icon 22 over
//  a 12pt label with 4pt between. RUN is flex 1.1, 44pt tall, a 999 pill in
//  `--material-action`, a 16pt glyph and a 14/700 label in a row with 6pt
//  between and 12pt of side padding.
//
//  The home-indicator strip below it comes from the device's safe area, not
//  from the design's 34pt constant — "build to the actual device safe areas,
//  not a fixed 390×844 box".
//

import SwiftUI

// MARK: - Destinations

enum FaffTabV5: String, CaseIterable, Identifiable, Hashable {
    case today, block, races
    var id: String { rawValue }

    var label: String {
        switch self {
        case .today: return "Today"
        case .block: return "Block"
        case .races: return "Races"
        }
    }

    /// The design draws Lucide strokes and says to "swap for the target app's
    /// own icon set". These are the SF Symbols that match them: sun, list,
    /// flag. Stroke weights are left at regular so they read as drawn lines
    /// rather than as filled shapes.
    var symbol: String {
        switch self {
        case .today: return "sun.max"
        case .block: return "list.bullet"
        case .races: return "flag"
        }
    }
}

// MARK: - Push destinations
//
// Everything the three places lead to. Adding one is a case here and a line in
// the host's `destination`.

enum V5Route: Hashable {
    case raceDetail(slug: String)
    /// Adding a race. A pushed SCREEN, not a bottom sheet: the form runs to
    /// name, date, distance, priority, goal and a course import, which is
    /// far more than a sheet sized to its content can hold without its
    /// title climbing under the notch and its buttons sliding under the bar.
    case addRace
    /// The run history, and one run out of it.
    case runLog
    case runDetail(id: String)
    case settings
    case shoes
    /// The paces-moved screen. Reached from a coach line, not from the bar.
    case pacesMoved
    /// The eight-stage walk-run ladder, once a flare has cleared to return.
    case returnToRunning
    /// The injury-flare screen, reached from a niggle flagged on a finished run.
    case injuryFlare
}

// MARK: - The bar

struct TabBarV5: View {
    @Binding var selected: FaffTabV5
    /// `user_settings.phone_run_enabled`. THE single source of truth for
    /// whether this phone offers to record a run. When it is off, the pill is
    /// not here — the design is explicit that RUN "only appears when 'start
    /// runs from this phone' is on in Settings".
    let showRun: Bool
    let onRun: () -> Void

    /// The prototype's flex ratios: each destination is flex 1, RUN is flex
    /// 1.1. SwiftUI has no flex, and `layoutPriority` is NOT it — priority
    /// decides who gets their IDEAL size first, and RUN's ideal size is wide,
    /// so it ate the bar and squeezed "Today" onto two lines. The ratio has to
    /// be measured and divided.
    private static let runFlex: CGFloat = 1.1

    var body: some View {
        GeometryReader { geo in
            let gap = showRun ? V5.S.s6 : V5.S.s4
            let slots = CGFloat(FaffTabV5.allCases.count)
            let gaps = gap * (slots - 1 + (showRun ? 1 : 0))
            // ── the bar's own gutter ──────────────────────────────────────
            //
            // The prototype writes `bandPad: '0 12px'`, and 12 is right for a
            // row of ICONS: each destination is centred in its slot, so its
            // glyph never comes near the edge and the padding is invisible.
            //
            // RUN is not an icon. It FILLS its slot, so its right edge lands
            // exactly on the padding — and at 12 that is 4pt outside the 16pt
            // gutter every tile, panel and list on the screen above it aligns
            // to. David caught it: the pill reads as pushed too far right
            // against a Today label that sits comfortably inside.
            //
            // So the bar takes the content gutter. The destinations do not
            // care (their glyphs are centred either way) and the one control
            // with a hard edge now lines up with everything above it.
            let usable = geo.size.width - V5.S.gutter * 2 - gaps
            let unit = usable / (slots + (showRun ? Self.runFlex : 0))

            HStack(spacing: gap) {
                ForEach(FaffTabV5.allCases) { tab in
                    Button {
                        guard selected != tab else { return }
                        selected = tab
                    } label: {
                        VStack(spacing: V5.S.s4) {
                            Image(systemName: tab.symbol)
                                .font(.system(size: 20, weight: .regular))
                                .frame(height: 22)
                            Text(tab.label)
                                .font(.faffText(TypeScaleV5.label12,
                                                weight: selected == tab ? .semibold : .medium))
                                .lineLimit(1)
                                .fixedSize()
                        }
                        .foregroundStyle(selected == tab ? V5.textPrimary : V5.textQuiet)
                        .frame(width: unit, height: geo.size.height)
                        .contentShape(RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
                    }
                    .buttonStyle(V5PressStyle())
                    .accessibilityAddTraits(selected == tab ? [.isSelected] : [])
                }

                if showRun {
                    Button(action: onRun) {
                        HStack(spacing: V5.S.s6) {
                            Image(systemName: "play.fill")
                                .font(.system(size: 13, weight: .bold))
                                .frame(width: 16, height: 16)
                            Text("RUN")
                                .font(.faffText(TypeScaleV5.label14, weight: .bold))
                                .lineLimit(1)
                        }
                        .foregroundStyle(V5.actionPrimaryText)
                        .frame(width: unit * Self.runFlex, height: 44)
                        .background(V5.materialAction, in: Capsule(style: .continuous))
                    }
                    .buttonStyle(V5PressStyle())
                }
            }
            .padding(.horizontal, V5.S.gutter)
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .frame(height: V5.Shell.tabBarHeight)
        .frame(maxWidth: .infinity)
        .background(V5.surfacePage)
    }
}

// MARK: - The RUN picker
//
// "Tapping RUN opens a bottom sheet from any screen: two choices, Outdoor (GPS
//  pace and route) or Treadmill (speed and incline, no GPS)."
//
// This is the one navigation action in the whole design that jumps to a
// different top-level screen rather than expanding in place, because starting a
// run is a real mode switch.

struct RunPickerV5: View {
    let onOutdoor: () -> Void
    let onTreadmill: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: V5.S.s16) {
            choice(title: "Outdoor",
                   sub: "GPS pace and route",
                   action: onOutdoor)
            choice(title: "Treadmill",
                   sub: "Speed and incline, no GPS",
                   action: onTreadmill)

            // This used to read "Recording needs the app open and the screen
            // on. A phone in a pocket stops the run." — true of the old
            // foreground-only recorder, and false as of the background
            // location entitlement (native-v2/project.yml · UIBackgroundModes).
            // Left here rather than deleted because the runner still has to
            // know the run keeps going with the phone away, and that the app
            // is the thing holding it: force-quitting still ends it.
            Text("An outdoor run keeps recording with your screen locked and the phone in a pocket. Closing the app ends it.")
                .font(.faffText(TypeScaleV5.label13))
                .foregroundStyle(V5.textQuiet)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, V5.S.s4)

            FaffButton("Cancel", variant: .ghost, size: .md, action: onCancel)
        }
    }

    private func choice(title: String, sub: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: V5.S.s2) {
                Text(title)
                    .font(.faffText(16, weight: .semibold))
                    .foregroundStyle(V5.textPrimary)
                Text(sub)
                    .font(.faffText(TypeScaleV5.label13))
                    .foregroundStyle(V5.textQuiet)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, V5.S.s16)
            .padding(.horizontal, V5.S.tilePad)
            .background(V5.materialTile,
                        in: RoundedRectangle(cornerRadius: V5.R.r18, style: .continuous))
        }
        .buttonStyle(V5PressStyle())
    }
}

// MARK: - Which run is running

/// A live run takes the whole screen. No tab bar — the design calls it
/// immersive, and the run console is the only thing that should be tappable.
enum LiveRunMode: Identifiable, Hashable {
    case outdoor, treadmill
    var id: String { self == .outdoor ? "outdoor" : "treadmill" }
}

// MARK: - The shell

/// The three places, the bar, the picker, and one navigation stack per place.
///
/// Content comes in as builders so this file owns the SHELL and nothing else:
/// the screens are separate views that take a decoded model and render it, and
/// the composition root wires the two together.
struct RootV5<TodayContent: View, BlockContent: View, RacesContent: View, RouteContent: View, LiveContent: View>: View {
    @Binding var selected: FaffTabV5
    let showRun: Bool

    @ViewBuilder var today: (Binding<[V5Route]>) -> TodayContent
    @ViewBuilder var block: (Binding<[V5Route]>) -> BlockContent
    @ViewBuilder var races: (Binding<[V5Route]>) -> RacesContent
    /// A pushed screen sometimes needs to push again — the run log opens a
    /// run. It gets the same path the stack is driven by rather than starting
    /// a nested NavigationStack, which would give the runner two back chains
    /// and no way to tell which one they were in.
    @ViewBuilder var route: (V5Route, Binding<[V5Route]>) -> RouteContent
    @ViewBuilder var live: (LiveRunMode, @escaping () -> Void) -> LiveContent

    @State private var paths: [FaffTabV5: [V5Route]] = [:]
    @State private var runPickerOpen = false
    @State private var liveRun: LiveRunMode?

    private func path(_ tab: FaffTabV5) -> Binding<[V5Route]> {
        Binding(get: { paths[tab] ?? [] }, set: { paths[tab] = $0 })
    }

    var body: some View {
        // Measure the device's real top inset once, at the root, and publish
        // it. Every full-bleed panel reads it from the environment — reading
        // the window from inside a view body deadlocks, which is how the first
        // attempt crashed on launch.
        GeometryReader { root in
            shell.environment(\.v5TopInset, max(root.safeAreaInsets.top, 0))
        }
        // TAPPING A NOTIFICATION HAS TO LAND SOMEWHERE.
        //
        // `NotificationsAppDelegate` opens a `faff://` URL when a notification
        // is tapped, and its comment said the app "already listens for these
        // URLs via .onOpenURL". Nothing did. The scheme is registered, but only
        // for the Strava OAuth callback, so every deep link the sender emits
        // was opened and silently dropped: the app came forward on whichever
        // tab it was already on, and a race-morning wake landed on Block if
        // that is where you left it.
        //
        // Six shapes are sent (lib/notifications/templates.ts). They are mapped
        // here rather than guessed at the call site, so adding a seventh is one
        // case in one place.
        .onOpenURL { url in route(url) }
    }

    /// `faff://<host>/<path…>` onto a tab, and where the tab has a matching
    /// pushed screen, onto that too. Anything unrecognised falls to Today
    /// rather than doing nothing — a notification the runner tapped should
    /// always open something.
    private func route(_ url: URL) {
        guard url.scheme == "faff" else { return }
        let parts = url.path.split(separator: "/").map(String.init)

        switch url.host {
        case "races":
            selected = .races
            // faff://races/{slug} and faff://races/{slug}/checklist both open
            // the race. v5 has no separate checklist screen — the gear plan
            // lives on the race detail, which IS the checklist.
            if let slug = parts.first, !slug.isEmpty {
                paths[.races] = [.raceDetail(slug: slug)]
            } else {
                paths[.races] = []
            }

        case "plan":
            selected = .block
            paths[.block] = []

        case "settings":
            // faff://settings/integrations/strava/reconnect — Settings is a
            // pushed screen off Today, and Strava lives on it.
            selected = .today
            paths[.today] = [.settings]

        // faff://health has no v5 screen of its own: readiness is an expansion
        // on Today, which is where this correctly lands.
        case "today", "health", .none:
            selected = .today
            paths[.today] = []

        default:
            selected = .today
            paths[.today] = []
        }
    }

    private var shell: some View {
        ZStack {
            V5.surfacePage.ignoresSafeArea()

            VStack(spacing: 0) {
                // All three destinations stay alive, and only the selected one
                // is shown. Two reasons, both load-bearing:
                //
                //   · The launch gate holds the splash until every destination
                //     reports it is painted. A `switch` builds one view, so the
                //     other two would never load and the splash would never
                //     lift.
                //   · Switching tabs then paints from state that is already
                //     there, rather than starting a fetch and reflowing — which
                //     is the rule the whole design is built on.
                ZStack {
                    NavigationStack(path: path(.today)) {
                        today(path(.today))
                            .navigationDestination(for: V5Route.self) { r in
                                route(r, path(.today))
                            }
                    }
                    // Flatten before hiding: a blend mode inside (the panel
                    // grain) otherwise composites into the shared context even
                    // at zero opacity, and the hidden tabs' gradients bleed out
                    // as a hairline round the screen edge.
                    .compositingGroup()
                    .opacity(selected == .today ? 1 : 0)
                    .allowsHitTesting(selected == .today)

                    NavigationStack(path: path(.block)) {
                        block(path(.block))
                            .navigationDestination(for: V5Route.self) { r in
                                route(r, path(.block))
                            }
                    }
                    // Flatten before hiding: a blend mode inside (the panel
                    // grain) otherwise composites into the shared context even
                    // at zero opacity, and the hidden tabs' gradients bleed out
                    // as a hairline round the screen edge.
                    .compositingGroup()
                    .opacity(selected == .block ? 1 : 0)
                    .allowsHitTesting(selected == .block)

                    NavigationStack(path: path(.races)) {
                        races(path(.races))
                            .navigationDestination(for: V5Route.self) { r in
                                route(r, path(.races))
                            }
                    }
                    // Flatten before hiding: a blend mode inside (the panel
                    // grain) otherwise composites into the shared context even
                    // at zero opacity, and the hidden tabs' gradients bleed out
                    // as a hairline round the screen edge.
                    .compositingGroup()
                    .opacity(selected == .races ? 1 : 0)
                    .allowsHitTesting(selected == .races)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                TabBarV5(selected: Binding(
                    get: { selected },
                    set: { tab in
                        // Tapping the tab you are already on pops that tab's
                        // stack to its root, which is the only thing a second
                        // tap can usefully mean.
                        if tab == selected { paths[tab] = [] } else { selected = tab }
                    }
                ), showRun: showRun) {
                    runPickerOpen = true
                }
            }

            V5SheetHost(isPresented: $runPickerOpen, title: "Start the run") {
                RunPickerV5(
                    onOutdoor: { runPickerOpen = false; liveRun = .outdoor },
                    onTreadmill: { runPickerOpen = false; liveRun = .treadmill },
                    onCancel: { runPickerOpen = false }
                )
            }
        }
        // ── THE END OF ONBOARDING HAD NOWHERE TO LAND ────────────────────
        //
        // Onboarding's last screen offers "Set up a race", and the gate answers
        // it by posting `.faffOpenRaceSetup` (FaffApp.swift). The only listeners
        // were `RootTabView` and `TargetsView` — both v4, both reachable only
        // under `-faffLegacy`. On the shipping shell the notification went
        // nowhere: a runner who had just asked to train for a race was dropped
        // on Today with no race, no plan, and the "not here yet" refusal, which
        // is the answer for a mode they had not chosen.
        //
        // Onboarding never captures a race (it posts `distance:"none"` by
        // design — the plan is authored when the race is added), so this hop IS
        // the race path. It has to arrive somewhere.
        .onReceive(NotificationCenter.default.publisher(for: .faffOpenRaceSetup)) { _ in
            selected = .races
            paths[.races] = [.addRace]
        }
        // The console has no dismiss gesture of its own, so the shell has to
        // hand it a real way out. It used to be given `{}` at the call site,
        // which meant End did nothing visible and the runner was stuck.
        .fullScreenCover(item: $liveRun) { mode in
            live(mode, { liveRun = nil })
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Not on the phone yet
//
// RULE THREE, applied to a whole mode.
//
// Coached runners, just-run runners and distance-goal-without-a-race work end
// to end in the backend. They get no phone screens for now, and the design is
// explicit that what they need is "a graceful 'not on phone yet' rather than
// three blank screens — a refusal, not a screen set".
//
// So this is `Silence`, not `ErrorNote`. Nothing failed. We read it, and the
// answer is that this mode is not here yet.

struct NotOnPhoneYetV5: View {
    /// The engine's own sentence. Falls back to the design's default rather
    /// than to an empty screen.
    var reason: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: V5.S.betweenGroups) {
                DayPanel(fill: .quiet) {
                    Color.clear.frame(height: V5.S.s56)
                    Text("Not here yet")
                        .faffDisplayV5(TypeScaleV5.display44)
                        .foregroundStyle(V5.textPrimary)
                }

                Silence(reason: reason ?? "The phone is built for a runner training toward a race. Your training is on the web, and it is working. This screen arrives when the phone can do it justice.")
            }
            .padding(.horizontal, V5.S.gutter)
            .padding(.bottom, V5.S.s24)
        }
        .background(V5.surfacePage)
        .scrollIndicators(.hidden)
    }
}

#Preview("Not on phone yet") {
    NotOnPhoneYetV5(reason: nil)
}
