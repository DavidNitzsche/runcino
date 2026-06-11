//
//  RootTabView.swift
//  v4 host (2026-06-02 round 33) · custom floating glass tab bar with
//  a centered RUN action that opens a popover menu.
//
//  Tabs: Today · Train · RUN (action, not route) · Health · Targets.
//  ACTIVITY tab is retired from the bar · Activity view stays
//  reachable as a route (.activity case) for deep-links from other
//  surfaces.
//
//  Center RUN tab toggles a RunActionMenu (Outdoor · Treadmill ·
//  Log niggle · Log non-run). Per design: most runs start from the
//  watch, so phone-side run starting is a low-key option tucked
//  inside this menu rather than a prominent button on Today.
//
//  Each non-Run tab is wrapped in its own NavigationStack so push
//  destinations (RunDetail, WatchMirror, Treadmill, etc.) land
//  within the originating tab via the shared FaffRoute dispatcher.
//
//  Reference: /Users/david/Downloads/design_handoff_runner_menu/
//

import SwiftUI

/// Visible tabs · Activity stays as a route via FaffRoute for any
/// surface that links to it, but doesn't appear in the bar.
enum FaffTab: String, CaseIterable, Identifiable {
    case today, train, health, targets
    var id: String { rawValue }
    var label: String {
        switch self {
        case .today:    return "Today"
        case .train:    return "Train"
        case .health:   return "Health"
        case .targets:  return "Goal"
        }
    }
    var icon: String {
        switch self {
        case .today:    return "calendar"
        case .train:    return "chart.line.uptrend.xyaxis"
        case .health:   return "heart.fill"
        case .targets:  return "flag.fill"
        }
    }
}

/// Push destinations available from any tab. Adding a new one is a single
/// case here + a single line in `routeDestination` below.
enum FaffRoute: Hashable {
    case runDetail(id: String)
    case planned(date: String?)
    case watchMirror
    case treadmill
    case raceDay(slug: String)
    case weekAhead
    case settings
    case shoes
    case pro
    case paywall
    case activity
    /// Learn modal — 45 doctrine articles seeded server-side after the
    /// 2026-05-30 backend audit. Pushed from health-tab tile taps and
    /// from any coach card with a `learn` deep-link.
    case learn(slug: String)
}

/// PreferenceKey that lets pushed views hide the floating tab bar.
/// Any view (e.g. TreadmillView, WatchMirrorView) that wants to take
/// over the full screen adds `.hideFaffTabBar()` and the bar fades
/// out. Defaults to false so most surfaces keep the bar.
struct HideFaffTabBarKey: PreferenceKey {
    static let defaultValue: Bool = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) {
        value = nextValue() || value
    }
}

extension View {
    /// Hide the floating tab bar while this view is on screen. Used by
    /// active-run surfaces (TreadmillView, WatchMirrorView) where the
    /// run console is the only thing that should be tappable.
    func hideFaffTabBar(_ hide: Bool = true) -> some View {
        self.preference(key: HideFaffTabBarKey.self, value: hide)
    }
}

struct RootTabView: View {
    @State private var selected: FaffTab = .today
    @State private var pushProfile = false
    @State private var showRunMenu: Bool = false
    @State private var showSymptomSheet: Bool = false
    @State private var showLogNonRunSheet: Bool = false
    @State private var showTrainingCal: Bool = false
    @State private var showInbox: Bool = false
    /// Pending navigation set by the run-menu mode buttons · triggers a
    /// push into the active tab's NavigationStack via the .navigationDestination(item:)
    /// hook below. Cleared once the push lands.
    @State private var pendingRoute: FaffRoute? = nil
    /// Per-tab hideFaffTabBar preference — only the selected tab's value
    /// drives actual bar visibility, so a hidden tab with a pushed run
    /// screen doesn't bleed its hide-request onto other tabs.
    @State private var tabBarHiddenPerTab: [FaffTab: Bool] = [:]
    /// Tracks which tabs have been visited at least once. Non-visited tabs
    /// are excluded from the ZStack so SwiftUI doesn't pay their layout
    /// cost until first visit. Once in the ZStack they're never removed,
    /// so switching back to a visited tab restores its state instantly.
    @State private var visitedTabs: Set<FaffTab> = [.today]
    private var tabBarHidden: Bool { tabBarHiddenPerTab[selected] ?? false }

    var body: some View {
        ZStack {
            // Content layer · all visited tabs live here simultaneously.
            // Invisible tabs keep their SwiftUI state so returning to a
            // tab is instant — no recreation, no loadAll re-fire.
            content
                .ignoresSafeArea(.keyboard)
                .onChange(of: selected) { _, tab in visitedTabs.insert(tab) }

            // Global top bar · sits above content as a ZStack overlay so
            // FaffMeshView's .ignoresSafeArea() doesn't swallow the inset.
            // Each tab view adds its own 44pt top clearance.
            VStack(spacing: 0) {
                globalTopBar
                Spacer(minLength: 0)
            }

            // Run action menu · scrim + menu card. Renders ABOVE the
            // content but BELOW the tab bar (per design z-order: scrim
            // 4 / tabbar 5 / menu 6). The component handles its own
            // dim + scale-in animation.
            RunActionMenu(
                isOpen: $showRunMenu,
                // AFC fix 2 · was a hardcoded one-off orange (#EE6038) ·
                // the run accent is the race/tempo slot of the locked palette.
                accent: Theme.race,
                onOutdoor: { pendingRoute = .watchMirror },
                onTreadmill: { pendingRoute = .treadmill },
                onNiggle: { showSymptomSheet = true },
                onNonRun: { showLogNonRunSheet = true }
            )
            .allowsHitTesting(showRunMenu)

            // Custom floating glass tab bar · always visible on top
            // EXCEPT when an active run view (TreadmillView /
            // WatchMirrorView) sets hideFaffTabBar() · the run console
            // is full-screen and the tab bar would clip its controls.
            VStack {
                Spacer()
                tabBar
                    .padding(.horizontal, 12)
                    .padding(.bottom, 14)
            }
            .opacity(tabBarHidden ? 0 : 1)
            .allowsHitTesting(!tabBarHidden)
            .animation(.easeInOut(duration: 0.22), value: tabBarHidden)
        }
        .sheet(isPresented: $pushProfile) {
            NavigationStack {
                ProfileView(onDismiss: { pushProfile = false })
                    .navigationDestination(for: FaffRoute.self) { routeDestination($0) }
            }
        }
        .sheet(isPresented: $showSymptomSheet) {
            // SymptomReportSheet (Niggle | Sick) · existing toolkit component.
            SymptomReportSheet(onSubmitted: { showSymptomSheet = false })
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showLogNonRunSheet) {
            LogNonRunSheet(onSubmitted: { showLogNonRunSheet = false })
                .presentationDetents([.medium])
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffShowRunMenu)) { _ in
            showRunMenu = true
        }
        .sheet(isPresented: $showTrainingCal) {
            TrainingCalendarView()
                .presentationDragIndicator(.hidden)
        }
        .sheet(isPresented: $showInbox) {
            NotificationInboxSheet()
                .presentationDetents([.large])
        }
    }

    // MARK: - Global top bar

    /// Single-line header present on every tab.
    /// ZStack keeps "FAFF" screen-centered regardless of button widths.
    private var globalTopBar: some View {
        ZStack {
            FaffLogoMark(color: Theme.txt, height: 20)
                .allowsHitTesting(false)

            HStack(spacing: 0) {
                // Profile avatar
                Button { pushProfile = true } label: {
                    Image(systemName: "person.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.txt)
                        .frame(width: 30, height: 30)
                        .background(Theme.Glass.fill, in: Circle())
                        .overlay(Circle().stroke(Theme.Glass.line, lineWidth: 1))
                }
                .buttonStyle(.plain)

                // Bell / inbox
                Button { showInbox = true } label: {
                    Image(systemName: "bell")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.75))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .padding(.leading, 4)

                Spacer(minLength: 0)

                // Training calendar
                Button { showTrainingCal = true } label: {
                    Image(systemName: "calendar")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.75))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 2)
        .padding(.bottom, 4)
        .background(Color.clear)
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        ZStack {
            // Each tab is wrapped in its own NavigationStack and lives
            // at a stable position in the ZStack. Tabs are created on
            // first visit and never destroyed — SwiftUI preserves their
            // @State so returning to a tab is instant.
            if visitedTabs.contains(.today) {
                tabStack(.today) { TodayView(onProfile: { pushProfile = true }) }
            }
            if visitedTabs.contains(.train) {
                tabStack(.train) { TrainView(onProfile: { pushProfile = true }) }
            }
            if visitedTabs.contains(.health) {
                tabStack(.health) { HealthView(onProfile: { pushProfile = true }) }
            }
            if visitedTabs.contains(.targets) {
                tabStack(.targets) { TargetsView(onProfile: { pushProfile = true }) }
            }
        }
    }

    @ViewBuilder
    private func tabStack<Content: View>(_ tab: FaffTab, @ViewBuilder _ root: () -> Content) -> some View {
        NavigationStack {
            root()
                .navigationBarHidden(true)
                .navigationDestination(for: FaffRoute.self) { routeDestination($0) }
                // Route pendingRoute only to the currently selected tab so
                // multiple NavigationStacks in the ZStack don't all respond.
                .navigationDestination(item: Binding(
                    get: { selected == tab ? pendingRoute : nil },
                    set: { pendingRoute = $0 }
                )) { routeDestination($0) }
        }
        .opacity(selected == tab ? 1 : 0)
        .allowsHitTesting(selected == tab)
        // Capture per-tab bar-hide preference so a hidden tab with a pushed
        // run screen can't bleed its hide-state onto whichever tab is visible.
        .onPreferenceChange(HideFaffTabBarKey.self) { tabBarHiddenPerTab[tab] = $0 }
    }

    @ViewBuilder
    private func routeDestination(_ route: FaffRoute) -> some View {
        switch route {
        case .runDetail(let id):   RunDetailView(runId: id).navigationBarHidden(true)
        case .planned(let d):      PlannedView(date: d).navigationBarHidden(true)
        case .watchMirror:         WatchMirrorView().navigationBarHidden(true)
        case .treadmill:           TreadmillView().navigationBarHidden(true)
        case .raceDay(let slug):   RaceDayView(raceSlug: slug).navigationBarHidden(true)
        case .weekAhead:           WeekAheadView().navigationBarHidden(true)
        case .settings:            SettingsView().navigationBarHidden(true)
        case .shoes:               ShoesView().navigationBarHidden(true)
        case .pro:                 ProView().navigationBarHidden(true)
        case .paywall:             PaywallView().navigationBarHidden(true)
        case .activity:            ActivityView(onProfile: { pushProfile = true }).navigationBarHidden(true)
        case .learn(let slug):     LearnArticleSheet(slug: slug).navigationBarHidden(true)
        }
    }

    // MARK: - Floating glass tab bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            tabButton(.today)
            tabButton(.train)
            runTabButton
            tabButton(.health)
            tabButton(.targets)
        }
        .padding(6)
        .frame(height: 62)
        // Brief v2 §3 · glass is retired on chrome (queued task 1).
        // Was: 72%-opacity navy + .ultraThinMaterial + a 38pt drop
        // shadow. Now: solid dark neutral (Theme.card) + the standard
        // hairline. Contrast on the solid fill: active label #F6F7F8 on
        // #11141A ≈ 15.9:1 (AAA) · inactive 50% white ≈ 5.0:1 (AA).
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Theme.line, lineWidth: 1)
        )
    }

    private func tabButton(_ tab: FaffTab) -> some View {
        let isSelected = selected == tab
        return Button {
            // Dismiss the run menu if the runner taps a different tab
            // while it's open · matches the design's expectation that
            // any nav action collapses the menu.
            if showRunMenu { showRunMenu = false }
            selected = tab
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 19, weight: .semibold))
                Text(tab.label.uppercased())
                    .font(.body(9, weight: .extraBold)).tracking(0.4)
            }
            .foregroundStyle(isSelected ? .white : Color.white.opacity(0.5))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(TabPressStyle())
    }

    private var runTabButton: some View {
        Button {
            showRunMenu.toggle()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: "figure.run")
                    .font(.system(size: 22, weight: .bold))
                Text("RUN")
                    .font(.body(9, weight: .extraBold)).tracking(0.4)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(TabPressStyle())
    }
}

/// Brief scale-down on tab press · matches the design's `:active` state.
private struct TabPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.11), value: configuration.isPressed)
    }
}
