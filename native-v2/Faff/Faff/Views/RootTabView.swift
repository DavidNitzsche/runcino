//
//  RootTabView.swift
//  v3 host · 5 tabs (Today · Train · Activity · Health · Targets).
//  Profile is reached via the avatar in each tab header, not a sixth tab.
//
//  Each tab provides its own effort-mesh background; the host TabView's bar
//  is restyled to the dark-glass spec from shell.css (blur 26, opacity .46
//  inactive / 1.0 active, 25pt icons, 10pt/700 labels).
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

struct RootTabView: View {
    @State private var selected: FaffTab = .today
    @State private var pushProfile = false

    init() {
        styleTabBar()
    }

    var body: some View {
        TabView(selection: $selected) {
            TodayView(onProfile: { pushProfile = true })
                .tabItem { Label(FaffTab.today.label, systemImage: FaffTab.today.icon) }
                .tag(FaffTab.today)
            TrainView(onProfile: { pushProfile = true })
                .tabItem { Label(FaffTab.train.label, systemImage: FaffTab.train.icon) }
                .tag(FaffTab.train)
            ActivityView(onProfile: { pushProfile = true })
                .tabItem { Label(FaffTab.activity.label, systemImage: FaffTab.activity.icon) }
                .tag(FaffTab.activity)
            HealthView(onProfile: { pushProfile = true })
                .tabItem { Label(FaffTab.health.label, systemImage: FaffTab.health.icon) }
                .tag(FaffTab.health)
            TargetsView(onProfile: { pushProfile = true })
                .tabItem { Label(FaffTab.targets.label, systemImage: FaffTab.targets.icon) }
                .tag(FaffTab.targets)
        }
        .tint(.white)
        .sheet(isPresented: $pushProfile) {
            NavigationStack { ProfileView(onDismiss: { pushProfile = false }) }
        }
    }

    private func styleTabBar() {
        let app = UITabBarAppearance()
        app.configureWithTransparentBackground()
        app.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialDark)
        app.backgroundColor = UIColor(red: 16/255, green: 9/255, blue: 7/255, alpha: 0.62)
        app.shadowColor = UIColor.white.withAlphaComponent(0.09)

        // Active (selected)
        let onAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont(name: "Inter-Bold", size: 10) ?? .systemFont(ofSize: 10, weight: .bold),
            .foregroundColor: UIColor.white,
            .kern: 0.3
        ]
        // Inactive
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
