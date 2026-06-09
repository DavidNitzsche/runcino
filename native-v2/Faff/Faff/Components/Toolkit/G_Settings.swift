//
//  G_Settings.swift
//  Family G · Settings rows.
//
//  Components: NotificationPrefsList · ConnectionRow · SettingValueRow.
//
//  CONSOLIDATION (per coverage memo): NotificationPrefsList is the
//  single panel for the 7-category taxonomy PLUS the strava_auto_push
//  and phone_hr_alerts booleans. One switch row reused per line.
//

import SwiftUI

// MARK: - Panel row container · local to the toolkit settings panel.
//   Renamed from GlassRow to avoid colliding with Components/Primitives.swift
//   which already exports a different GlassRow shape (trailing-content based).

private struct PanelRow<Content: View>: View {
    let content: () -> Content
    init(@ViewBuilder _ content: @escaping () -> Content) { self.content = content }
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            content()
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }
}

// MARK: - SwitchRow (the row primitive)

struct SwitchRow: View {
    let label: String
    let sub: String?
    @Binding var value: Bool

    var body: some View {
        PanelRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.body(13.5, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                if let s = sub, !s.isEmpty {
                    Text(s)
                        .font(.body(11.5, weight: .medium))
                        .foregroundStyle(Theme.mute)
                }
            }
            Spacer(minLength: 8)
            Toggle("", isOn: $value)
                .labelsHidden()
                .tint(Theme.Accent.mintReady)
        }
    }
}

// MARK: - NotificationPrefsList
//
// One Settings → Notifications panel. Reads + writes /api/profile/notifications
// (jsonb) for the 7-category taxonomy, plus the strava_auto_push and
// phone_hr_alerts booleans from /api/settings.

struct NotificationPrefsList: View {
    @Binding var prefs: NotificationPrefs?
    /// Optional binding for `strava_auto_push` (lives on /api/profile,
    /// not /api/profile/notifications). Pass nil to hide that row.
    var stravaAutoPush: Binding<Bool>? = nil
    /// Optional binding for `phone_hr_alerts` (lives on /api/profile too).
    var phoneHrAlerts: Binding<Bool>? = nil
    var loading: Bool = false
    var onPrefChange: (NotificationPrefs) -> Void = { _ in }

    var body: some View {
        if loading || prefs == nil {
            loadingState
        } else {
            VStack(spacing: 0) {
                row("Readiness alerts",
                    sub: "When your body says ease off",
                    bind: bindPref(\.readiness_enabled))
                divider()
                row("Workout reminders",
                    sub: "Morning ping with today's session",
                    bind: bindPref(\.workout_reminder_enabled))
                divider()
                row("Weekly recap",
                    sub: "Sunday wrap of the week's training",
                    bind: bindPref(\.recap_enabled))
                divider()
                row("Race countdown",
                    sub: "T-30 / T-14 / T-7 / T-3 cadence",
                    bind: bindPref(\.race_countdown_enabled))
                divider()
                row("Streak milestones",
                    sub: "Celebrate 7 / 14 / 30 / 100 days",
                    bind: bindPref(\.streak_enabled))
                divider()
                row("Plan adaptations",
                    sub: "When Faff changes today",
                    bind: bindPref(\.adaptation_enabled))
                divider()
                row("Strava reconnect",
                    sub: "Nudge if the sync breaks",
                    bind: bindPref(\.reconnect_enabled))
                if let push = stravaAutoPush {
                    divider()
                    row("Auto-push runs to Strava",
                        sub: "Send completed runs without tapping",
                        bind: push)
                }
                if let hr = phoneHrAlerts {
                    divider()
                    row("Phone HR alerts",
                        sub: "Vibrate when HR overshoots the cap",
                        bind: hr)
                }
            }
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        }
    }

    @ViewBuilder private func row(_ label: String, sub: String?, bind: Binding<Bool>) -> some View {
        SwitchRow(label: label, sub: sub, value: bind)
    }
    private func divider() -> some View {
        Divider().background(Color.white.opacity(0.06)).padding(.leading, 16)
    }
    private func bindPref(_ kp: WritableKeyPath<NotificationPrefs, Bool>) -> Binding<Bool> {
        Binding(
            get: { prefs?[keyPath: kp] ?? false },
            set: { v in
                guard var p = prefs else { return }
                p[keyPath: kp] = v
                prefs = p
                onPrefChange(p)
            }
        )
    }

    private var loadingState: some View {
        VStack(spacing: 0) {
            ForEach(0..<5, id: \.self) { _ in
                PanelRow {
                    RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08))
                        .frame(maxWidth: 160).frame(height: 14)
                    Spacer()
                    RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.08))
                        .frame(width: 46, height: 28)
                }
                divider()
            }
        }
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
    }
}

// MARK: - NotificationPrefs (model)

struct NotificationPrefs: Codable, Equatable {
    var readiness_enabled: Bool
    var workout_reminder_enabled: Bool
    var recap_enabled: Bool
    var race_countdown_enabled: Bool
    var streak_enabled: Bool
    var adaptation_enabled: Bool
    var reconnect_enabled: Bool

    static let defaults = NotificationPrefs(
        readiness_enabled: true,
        workout_reminder_enabled: true,
        recap_enabled: true,
        race_countdown_enabled: true,
        streak_enabled: true,
        adaptation_enabled: true,
        reconnect_enabled: true
    )

    enum CodingKeys: String, CodingKey {
        case readiness_enabled, workout_reminder_enabled, recap_enabled
        case race_countdown_enabled, streak_enabled, adaptation_enabled
        case reconnect_enabled
    }
    init(readiness_enabled: Bool, workout_reminder_enabled: Bool, recap_enabled: Bool,
         race_countdown_enabled: Bool, streak_enabled: Bool, adaptation_enabled: Bool,
         reconnect_enabled: Bool) {
        self.readiness_enabled = readiness_enabled
        self.workout_reminder_enabled = workout_reminder_enabled
        self.recap_enabled = recap_enabled
        self.race_countdown_enabled = race_countdown_enabled
        self.streak_enabled = streak_enabled
        self.adaptation_enabled = adaptation_enabled
        self.reconnect_enabled = reconnect_enabled
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.readiness_enabled = (try? c.decode(Bool.self, forKey: .readiness_enabled)) ?? true
        self.workout_reminder_enabled = (try? c.decode(Bool.self, forKey: .workout_reminder_enabled)) ?? true
        self.recap_enabled = (try? c.decode(Bool.self, forKey: .recap_enabled)) ?? true
        self.race_countdown_enabled = (try? c.decode(Bool.self, forKey: .race_countdown_enabled)) ?? true
        self.streak_enabled = (try? c.decode(Bool.self, forKey: .streak_enabled)) ?? true
        self.adaptation_enabled = (try? c.decode(Bool.self, forKey: .adaptation_enabled)) ?? true
        self.reconnect_enabled = (try? c.decode(Bool.self, forKey: .reconnect_enabled)) ?? true
    }
}

// MARK: - ConnectionRow
//
// Shows connected + last-sync per source; amber when lastSync > 24h on an
// active connection. The existing ProfileView ConnectionsCard already
// renders Strava / Apple Health / Apple Watch · this is the styled
// re-export that matches the new design tokens.

struct ConnectionRowItem: Identifiable {
    let id: String
    let name: String          // "Strava", "Apple Watch", "Apple Health"
    let connected: Bool
    let lastSyncIso: String?  // ISO timestamp
    let note: String          // "Connected · synced 2h ago" — UI computes if isStale
    let logoSymbol: String    // SF Symbol name
    let logoColor: Color
}

struct ConnectionRow: View {
    let item: ConnectionRowItem
    var onManage: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: item.logoSymbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(item.logoColor)
                .frame(width: 32, height: 32)
                .background(item.logoColor.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                    .font(.body(13.5, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                HStack(spacing: 6) {
                    Circle()
                        .fill(syncColor)
                        .frame(width: 6, height: 6)
                    Text(syncLine)
                        .font(.body(11.5, weight: .medium))
                        .foregroundStyle(isStale ? Theme.goal : Theme.mute)
                }
            }
            Spacer(minLength: 8)
            Button(action: onManage) {
                Text("MANAGE")
                    .font(.body(10, weight: .extraBold))
                    .tracking(1)
                    .foregroundStyle(Theme.txt)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Theme.Glass.fill, in: Capsule())
                    .overlay(Capsule().stroke(Theme.Glass.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private var syncLine: String {
        if !item.connected { return "Not connected" }
        if let ago = relativeAgo { return "Connected · synced \(ago)" }
        return item.note.isEmpty ? "Connected" : item.note
    }

    private var syncColor: Color {
        if !item.connected { return Theme.over }
        return isStale ? Theme.goal : Theme.green
    }

    private var isStale: Bool {
        guard let iso = item.lastSyncIso else { return false }
        guard let ago = secondsSince(iso) else { return false }
        return ago > 24 * 3600
    }

    private var relativeAgo: String? {
        guard let iso = item.lastSyncIso else { return nil }
        guard let secs = secondsSince(iso) else { return nil }
        if secs < 60 { return "just now" }
        if secs < 3600 { return "\(secs / 60) min ago" }
        if secs < 86400 { return "\(secs / 3600)h ago" }
        let days = secs / 86400
        return "\(days) day\(days == 1 ? "" : "s") ago"
    }

    private func secondsSince(_ iso: String) -> Int? {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let cleaned = iso.replacingOccurrences(of: " ", with: "T")
        guard let d = fmt.date(from: cleaned) ?? fmt.date(from: cleaned + "Z") else { return nil }
        return Int(Date().timeIntervalSince(d))
    }
}

// MARK: - SettingValueRow
//
// Right-aligned value row. When `interactive` is true (default) it renders
// as a Button with a disclosure chevron — the caller handles the picker.
// When `interactive` is false it renders the label+value as display-only
// (no chevron, no button affordance) — used for rows whose pickers are
// not yet wired so the runner doesn't tap and get silence.

struct SettingValueRow: View {
    let label: String
    let value: String
    let sub: String?
    let onTap: () -> Void
    var interactive: Bool = true

    var body: some View {
        if interactive {
            Button(action: onTap) { rowContent }
                .buttonStyle(.plain)
        } else {
            rowContent
        }
    }

    private var rowContent: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.body(13.5, weight: .semibold))
                    .foregroundStyle(Theme.txt)
                if let s = sub, !s.isEmpty {
                    Text(s)
                        .font(.body(11.5, weight: .medium))
                        .foregroundStyle(Theme.mute)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Text(value)
                .font(.body(13, weight: .extraBold))
                .foregroundStyle(Theme.txt)
            if interactive {
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.mute)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }
}
