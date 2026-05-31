//
//  RootTabView.swift
//  v3 host · 5 tabs (Today · Train · Activity · Health · Targets).
//  Profile is reached via the avatar in each tab header.
//
//  Each tab is wrapped in its own NavigationStack so push detail screens
//  (RunDetail, Planned, WatchMirror, RaceDay, Settings, etc.) land within
//  the originating tab. Destinations are dispatched via a shared FaffRoute
//  enum so every tab can navigate to every screen consistently.
//

import SwiftUI

enum FaffTab: String, CaseIterable, Identifiable {
    case today, train, activity, health, targets
    var id: String { rawValue }
    var label: String {
        switch self {
        case .today:    return "Today"
        case .train:    return "Train"
        case .activity: return "Activity"
        case .health:   return "Health"
        case .targets:  return "Targets"
        }
    }
    var icon: String {
        switch self {
        case .today:    return "calendar"
        case .train:    return "chart.line.uptrend.xyaxis"
        case .activity: return "waveform.path.ecg"
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
    case completed(runId: String)
    case watchMirror
    case treadmill
    case raceDay(slug: String)
    case weekAhead
    case settings
    case shoes
    case pro
    case paywall
    /// Learn modal — 45 doctrine articles seeded server-side after the
    /// 2026-05-30 backend audit. Pushed from health-tab tile taps and
    /// from any coach card with a `learn` deep-link.
    case learn(slug: String)
}

struct RootTabView: View {
    @State private var selected: FaffTab = .today
    @State private var pushProfile = false

    init() {
        styleTabBar()
    }

    var body: some View {
        TabView(selection: $selected) {
            navStack { TodayView(onProfile: { pushProfile = true }) }
                .tabItem { Label(FaffTab.today.label, systemImage: FaffTab.today.icon) }
                .tag(FaffTab.today)
            navStack { TrainView(onProfile: { pushProfile = true }) }
                .tabItem { Label(FaffTab.train.label, systemImage: FaffTab.train.icon) }
                .tag(FaffTab.train)
            navStack { ActivityView(onProfile: { pushProfile = true }) }
                .tabItem { Label(FaffTab.activity.label, systemImage: FaffTab.activity.icon) }
                .tag(FaffTab.activity)
            navStack { HealthView(onProfile: { pushProfile = true }) }
                .tabItem { Label(FaffTab.health.label, systemImage: FaffTab.health.icon) }
                .tag(FaffTab.health)
            navStack { TargetsView(onProfile: { pushProfile = true }) }
                .tabItem { Label(FaffTab.targets.label, systemImage: FaffTab.targets.icon) }
                .tag(FaffTab.targets)
        }
        .tint(.white)
        .sheet(isPresented: $pushProfile) {
            NavigationStack {
                ProfileView(onDismiss: { pushProfile = false })
                    .navigationDestination(for: FaffRoute.self) { routeDestination($0) }
            }
        }
    }

    @ViewBuilder
    private func navStack<Content: View>(@ViewBuilder _ root: () -> Content) -> some View {
        NavigationStack {
            root()
                .navigationBarHidden(true)
                .navigationDestination(for: FaffRoute.self) { routeDestination($0) }
        }
    }

    @ViewBuilder
    private func routeDestination(_ route: FaffRoute) -> some View {
        switch route {
        case .runDetail(let id):   RunDetailView(runId: id).navigationBarHidden(true)
        case .planned(let d):      PlannedView(date: d).navigationBarHidden(true)
        case .completed(let id):   CompletedView(runId: id).navigationBarHidden(true)
        case .watchMirror:         WatchMirrorView().navigationBarHidden(true)
        case .treadmill:           TreadmillView().navigationBarHidden(true)
        case .raceDay(let slug):   RaceDayView(raceSlug: slug).navigationBarHidden(true)
        case .weekAhead:           WeekAheadView().navigationBarHidden(true)
        case .settings:            SettingsView().navigationBarHidden(true)
        case .shoes:               ShoesView().navigationBarHidden(true)
        case .pro:                 ProView().navigationBarHidden(true)
        case .paywall:             PaywallView().navigationBarHidden(true)
        case .learn(let slug):     LearnArticleSheet(slug: slug).navigationBarHidden(true)
        }
    }

    private func styleTabBar() {
        let app = UITabBarAppearance()
        app.configureWithTransparentBackground()
        app.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialDark)
        app.backgroundColor = UIColor(red: 16/255, green: 9/255, blue: 7/255, alpha: 0.62)
        app.shadowColor = UIColor.white.withAlphaComponent(0.09)

        let onAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont(name: "Inter-Bold", size: 10) ?? .systemFont(ofSize: 10, weight: .bold),
            .foregroundColor: UIColor.white,
            .kern: 0.3
        ]
        let offAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont(name: "Inter-Bold", size: 10) ?? .systemFont(ofSize: 10, weight: .bold),
            .foregroundColor: UIColor.white.withAlphaComponent(0.46),
            .kern: 0.3
        ]
        app.stackedLayoutAppearance.selected.titleTextAttributes = onAttrs
        app.stackedLayoutAppearance.normal.titleTextAttributes = offAttrs
        app.stackedLayoutAppearance.selected.iconColor = .white
        app.stackedLayoutAppearance.normal.iconColor = UIColor.white.withAlphaComponent(0.46)

        UITabBar.appearance().standardAppearance = app
        UITabBar.appearance().scrollEdgeAppearance = app
    }
}
