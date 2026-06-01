//
//  NotificationInboxSheet.swift
//  Past pushes + ack visibility for the runner. Reads
//  /api/notifications/inbox · groups by day + tags by category color.
//

import SwiftUI

struct NotificationInboxSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var items: [NotifInboxItem] = []
    @State private var loading: Bool = true
    @State private var loadError: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if loading {
                VStack { Spacer(); ProgressView().tint(Theme.txt); Spacer() }
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else if let e = loadError, items.isEmpty {
                FailedLoadBanner(message: e, retry: { Task { await load() } })
                    .padding(20)
            } else if items.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(groupedDays, id: \.day) { group in
                            Text(group.day)
                                .font(.body(10, weight: .extraBold)).tracking(1.5)
                                .foregroundStyle(Theme.mute)
                                .padding(.horizontal, 22).padding(.top, 18).padding(.bottom, 8)
                            VStack(spacing: 8) {
                                ForEach(group.items) { item in row(item) }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                    .padding(.bottom, 24)
                }
            }
        }
        .background(Theme.Glass.strong)
        .ignoresSafeArea(edges: .bottom)
        .task { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Capsule().fill(Color.white.opacity(0.18))
                .frame(width: 40, height: 4)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 8)
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Notification inbox")
                        .font(.display(22, weight: .bold))
                        .foregroundStyle(Theme.txt)
                    Text("Last 14 days of pushes. Tap a row to ack from here.")
                        .font(.body(12.5, weight: .medium))
                        .foregroundStyle(Theme.mute)
                }
                Spacer()
            }
            .padding(.horizontal, 24).padding(.top, 12)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "bell.slash")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Theme.mute)
            Text("No nudges yet.")
                .font(.body(13, weight: .semibold))
                .foregroundStyle(Theme.mute)
            Text("Faff will notify you about race week, plan adaptations, and check-ins.")
                .font(.body(12, weight: .medium))
                .foregroundStyle(Theme.mute)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    private func row(_ item: NotifInboxItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(categoryColor(item.category)).frame(width: 8, height: 8)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
                if !item.title.isEmpty {
                    Text(item.title)
                        .font(.body(13, weight: .extraBold))
                        .foregroundStyle(Theme.txt)
                }
                if !item.body.isEmpty {
                    Text(item.body)
                        .font(.body(12.5, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.86))
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 6) {
                    Text(formatTime(item.fired_at))
                        .font(.body(10.5, weight: .semibold))
                        .foregroundStyle(Theme.mute)
                    if let act = item.ack_action {
                        Text("· acked \(act)".uppercased())
                            .font(.body(9, weight: .extraBold)).tracking(1)
                            .foregroundStyle(Theme.Accent.mintReady)
                    }
                }
            }
            Spacer(minLength: 8)
        }
        .padding(14)
        .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
    }

    private func categoryColor(_ c: String) -> Color {
        switch c {
        case "race_day", "race_eve":   return Theme.race
        case "skip_recovery":          return Theme.goal
        case "weekly_checkin":         return Theme.dist
        case "niggle_sick":            return Theme.over
        case "streak":                 return Theme.Accent.amberGold
        case "strava_reconnect":       return Theme.over
        default:                       return Theme.mute
        }
    }

    // MARK: - Grouping

    private struct DayGroup { let day: String; let items: [NotifInboxItem] }
    private var groupedDays: [DayGroup] {
        let df = DateFormatter(); df.dateFormat = "EEE · MMM d"
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var byDay: [(String, NotifInboxItem)] = []
        for item in items {
            let cleaned = item.fired_at.replacingOccurrences(of: " ", with: "T")
            let d = iso.date(from: cleaned) ?? iso.date(from: cleaned + "Z") ?? Date()
            byDay.append((df.string(from: d).uppercased(), item))
        }
        var order: [String] = []
        var groups: [String: [NotifInboxItem]] = [:]
        for (day, item) in byDay {
            if groups[day] == nil { order.append(day); groups[day] = [] }
            groups[day]!.append(item)
        }
        return order.map { DayGroup(day: $0, items: groups[$0] ?? []) }
    }

    private func formatTime(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let cleaned = iso.replacingOccurrences(of: " ", with: "T")
        guard let d = f.date(from: cleaned) ?? f.date(from: cleaned + "Z") else { return "" }
        let df = DateFormatter(); df.dateFormat = "h:mm a"
        return df.string(from: d)
    }

    private func load() async {
        loading = true
        loadError = nil
        do {
            let result = try await API.fetchNotificationInbox(days: 14, limit: 50)
            await MainActor.run { items = result; loading = false }
        } catch {
            await MainActor.run {
                loadError = loadFailureMessage(error)
                loading = false
            }
        }
    }
}
