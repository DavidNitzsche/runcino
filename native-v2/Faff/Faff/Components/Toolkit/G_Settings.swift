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
    /// Fires with the CANONICAL wire key + new value on each toggle so the
    /// caller PATCHes only the changed field (audit P1-15 · the old
    /// full-struct PATCH 400'd on the first unknown key and every toggle
    /// silently never saved).
    var onPrefChange: (String, Bool) -> Void = { _, _ in }

    var body: some View {
        if loading || prefs == nil {
            loadingState
        } else {
            VStack(spacing: 0) {
                // Rows mirror web Settings.tsx ROW_DEFS · same canonical
                // categories, same order, same copy.
                row("All notifications",
                    sub: "Master switch · turns everything off when off",
                    bind: bindPref(\.master_enabled, "master_enabled"))
                divider()
                row("Race day",
                    sub: "Race-morning wake + start window",
                    bind: bindPref(\.race_day_enabled, "race_day_enabled"))
                divider()
                row("Race eve",
                    sub: "Evening-before brief at T-21h",
                    bind: bindPref(\.race_eve_enabled, "race_eve_enabled"))
                divider()
                row("Workout reminders",
                    sub: "Pre-run brief on planned days",
                    bind: bindPref(\.skip_recovery_enabled, "skip_recovery_enabled"))
                divider()
                row("Weekly check-in",
                    sub: "Sunday recap + week-ahead context",
                    bind: bindPref(\.weekly_checkin_enabled, "weekly_checkin_enabled"))
                divider()
                row("Niggle / sick check",
                    sub: "Daily check-in when something is active",
                    bind: bindPref(\.niggle_sick_enabled, "niggle_sick_enabled"))
                divider()
                row("Streak milestones",
                    sub: "7 · 14 · 30 · 100 day streaks",
                    bind: bindPref(\.streak_enabled, "streak_enabled"))
                divider()
                row("Strava reconnect",
                    sub: "Nudge when the token goes stale",
                    bind: bindPref(\.strava_reconnect_enabled, "strava_reconnect_enabled"))
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
    private func bindPref(_ kp: WritableKeyPath<NotificationPrefs, Bool>, _ wireKey: String) -> Binding<Bool> {
        Binding(
            get: { prefs?[keyPath: kp] ?? false },
            set: { v in
                guard var p = prefs else { return }
                p[keyPath: kp] = v
                prefs = p
                onPrefChange(wireKey, v)
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
//
// 2026-07-06 · audit P1-15 · migrated to the server's CANONICAL key set
// (web-v2/lib/notifications/prefs.ts NotificationPrefs). The old 7-key
// phone dialect (readiness/workout_reminder/recap/race_countdown/
// adaptation/reconnect) shared only streak_enabled with the server, so
// GET never decoded real prefs and PATCH 400'd on the first unknown key.
// GET /api/profile/notifications emits these keys at the TOP LEVEL of the
// body; PATCH sends one changed key at a time (see NotificationPrefsList
// onPrefChange). Per-key tolerant decode · a missing key falls back to the
// server default (true), matching DEFAULT_PREFS.

struct NotificationPrefs: Codable, Equatable {
    var master_enabled: Bool
    var race_day_enabled: Bool
    var race_eve_enabled: Bool
    var skip_recovery_enabled: Bool
    var weekly_checkin_enabled: Bool
    var niggle_sick_enabled: Bool
    var streak_enabled: Bool
    var strava_reconnect_enabled: Bool

    static let defaults = NotificationPrefs(
        master_enabled: true,
        race_day_enabled: true,
        race_eve_enabled: true,
        skip_recovery_enabled: true,
        weekly_checkin_enabled: true,
        niggle_sick_enabled: true,
        streak_enabled: true,
        strava_reconnect_enabled: true
    )

    enum CodingKeys: String, CodingKey {
        case master_enabled, race_day_enabled, race_eve_enabled
        case skip_recovery_enabled, weekly_checkin_enabled, niggle_sick_enabled
        case streak_enabled, strava_reconnect_enabled
    }
    init(master_enabled: Bool, race_day_enabled: Bool, race_eve_enabled: Bool,
         skip_recovery_enabled: Bool, weekly_checkin_enabled: Bool,
         niggle_sick_enabled: Bool, streak_enabled: Bool,
         strava_reconnect_enabled: Bool) {
        self.master_enabled = master_enabled
        self.race_day_enabled = race_day_enabled
        self.race_eve_enabled = race_eve_enabled
        self.skip_recovery_enabled = skip_recovery_enabled
        self.weekly_checkin_enabled = weekly_checkin_enabled
        self.niggle_sick_enabled = niggle_sick_enabled
        self.streak_enabled = streak_enabled
        self.strava_reconnect_enabled = strava_reconnect_enabled
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.master_enabled = (try? c.decode(Bool.self, forKey: .master_enabled)) ?? true
        self.race_day_enabled = (try? c.decode(Bool.self, forKey: .race_day_enabled)) ?? true
        self.race_eve_enabled = (try? c.decode(Bool.self, forKey: .race_eve_enabled)) ?? true
        self.skip_recovery_enabled = (try? c.decode(Bool.self, forKey: .skip_recovery_enabled)) ?? true
        self.weekly_checkin_enabled = (try? c.decode(Bool.self, forKey: .weekly_checkin_enabled)) ?? true
        self.niggle_sick_enabled = (try? c.decode(Bool.self, forKey: .niggle_sick_enabled)) ?? true
        self.streak_enabled = (try? c.decode(Bool.self, forKey: .streak_enabled)) ?? true
        self.strava_reconnect_enabled = (try? c.decode(Bool.self, forKey: .strava_reconnect_enabled)) ?? true
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
