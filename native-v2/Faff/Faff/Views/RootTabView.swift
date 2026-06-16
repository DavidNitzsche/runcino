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
    @State private var showReachabilityBanner: Bool = false
    /// No race AND no goal → the runner is in "just run" casual mode.
    /// Drives hiding the Train tab (no plan to show). Defaults true so the
    /// tab never flash-hides before the first profile fetch resolves.
    @State private var hasTarget: Bool = true
    // Run-menu pushes (watchMirror / treadmill) and all NavigationLink(value:)
    // pushes go through the per-tab `tabPaths` stacks below — a single,
    // poppable navigation mechanism. (Was a separate `pendingRoute` +
    // navigationDestination(item:), which couldn't be cleared by a tab tap.)
    /// Per-tab hideFaffTabBar preference — only the selected tab's value
    /// drives actual bar visibility, so a hidden tab with a pushed run
    /// screen doesn't bleed its hide-request onto other tabs.
    @State private var tabBarHiddenPerTab: [FaffTab: Bool] = [:]
    /// Per-tab navigation path. Tapping a tab clears its path back to root
    /// (standard iOS "tap the active tab → pop to root"), so a pushed route
    /// like Activity or a run detail can always be escaped via the tab bar.
    @State private var tabPaths: [FaffTab: [FaffRoute]] = [:]
    /// Tracks which tabs have been visited at least once. Non-visited tabs
    /// are excluded from the ZStack so SwiftUI doesn't pay their layout
    /// cost until first visit. Once in the ZStack they're never removed,
    /// so switching back to a visited tab restores its state instantly.
    // Zero-pop launch · pre-create ALL tabs so they load behind the FAFF
    // splash. RootContainer holds the splash until every tab signals
    // .faffSurfaceReady, so by the time it fades, switching tabs paints from
    // loaded state — nothing pops. Was [.today] (lazy per-visit → first-tap pop).
    @State private var visitedTabs: Set<FaffTab> = Set(FaffTab.allCases)
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
                reachabilityBanner
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
                onOutdoor: { tabPaths[selected, default: []].append(.watchMirror) },
                onTreadmill: { tabPaths[selected, default: []].append(.treadmill) },
                onNiggle: { showSymptomSheet = true },
                onNonRun: { showLogNonRunSheet = true }
            )
            .allowsHitTesting(showRunMenu)

            // Gradient scrim — covers home-indicator area below the tab bar
            // pill only. Height kept to 90pt so the scrim never reaches
            // DragSheet content (chips sit ~120pt above screen bottom) —
            // previously 150pt caused the top of the gradient to darken
            // content cards above the pill zone.
            VStack {
                Spacer()
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: Theme.bg.opacity(0.82), location: 0.55),
                        .init(color: Theme.bg, location: 1)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 90)
            }
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)

            // Custom floating glass tab bar · always visible on top
            // EXCEPT when an active run view (TreadmillView /
            // WatchMirrorView) sets hideFaffTabBar() · the run console
            // is full-screen and the tab bar would clip its controls.
            VStack {
                Spacer()
                tabBar
                    .padding(.horizontal, 12)
                    .padding(.bottom, 24)
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
        .task { await refreshTarget() }
        .onReceive(NotificationCenter.default.publisher(for: .faffForegroundRefresh)) { _ in
            Task { await refreshTarget() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffShowRunMenu)) { _ in
            showRunMenu = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .faffReachabilityLost)) { _ in
            withAnimation(.easeInOut(duration: 0.25)) { showReachabilityBanner = true }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 6_000_000_000)
                withAnimation(.easeInOut(duration: 0.25)) { showReachabilityBanner = false }
            }
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

    /// Loud "can't reach Faff" banner · appears on a NETWORK failure so the
    /// runner reads it as connectivity, not lost data (the silent-empty trap).
    /// Auto-hides after a few seconds; Retry kicks a foreground refresh.
    @ViewBuilder private var reachabilityBanner: some View {
        if showReachabilityBanner {
            HStack(spacing: 9) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(hex: 0xFC4D64))
                Text("Can't reach Faff")
                    .font(.body(13, weight: .bold)).foregroundStyle(Theme.txt)
                Spacer(minLength: 8)
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { showReachabilityBanner = false }
                    NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
                } label: {
                    Text("Retry").font(.body(13, weight: .extraBold)).foregroundStyle(Color(hex: 0x8FD0FF))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 15).padding(.vertical, 10)
            .background(Color(hex: 0x2A1416), in: Capsule())
            .overlay(Capsule().stroke(Color(hex: 0xFC4D64).opacity(0.40), lineWidth: 1))
            .padding(.horizontal, 14).padding(.top, 4)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
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
                tabStack(.today) { TodayView(onProfile: { pushProfile = true }, selectedTab: $selected) }
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
        NavigationStack(path: Binding(
            get: { tabPaths[tab] ?? [] },
            set: { tabPaths[tab] = $0 }
        )) {
            root()
                .navigationBarHidden(true)
                .navigationDestination(for: FaffRoute.self) { routeDestination($0) }
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

    /// Resolve "just run" mode · no race and no goal means there's no plan,
    /// so the Train tab is hidden. Cheap single profile-state fetch; runs on
    /// launch, on foreground, and whenever a goal/race is added or cleared
    /// (those surfaces post .faffForegroundRefresh after saving).
    private func refreshTarget() async {
        guard let p = try? await API.fetchProfileState() else { return }
        let hasRace = !((p.nextARace?.slug ?? "").isEmpty)
        let hasGoal = p.fitnessGoal != nil
        await MainActor.run {
            let next = hasRace || hasGoal
            if next != hasTarget { hasTarget = next }
            // If Train got hidden out from under the selection, fall back.
            if !next && selected == .train { selected = .today }
        }
    }

    // MARK: - Floating glass tab bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            tabButton(.today)
            if hasTarget { tabButton(.train) }
            runTabButton
            tabButton(.health)
            tabButton(.targets)
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
        .frame(height: 50)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
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
            // Tapping a tab always returns it to its root — pops any pushed
            // route (Activity, run detail, …) so the runner is never stuck
            // on a sub-page with no visible way back.
            tabPaths[tab] = []
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
                // Match the other four tabs exactly (was 22pt bold — read as
                // oversized next to the 19pt semibold siblings · David).
                Image(systemName: "figure.run")
                    .font(.system(size: 19, weight: .semibold))
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
