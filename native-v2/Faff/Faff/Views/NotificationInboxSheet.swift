//
//  NotificationInboxSheet.swift
//  Past pushes + ack visibility for the runner. Reads
//  /api/notifications/inbox · groups by day + tags by category color.
//
//  2026-07-06 audit P2-48 · rows promised "Tap a row to ack from here"
//  but had no tap handler. Tap now acks in-app via the same
//  /api/notifications/ack the lock-screen actions use, passing the
//  row's `id` as notification_id so the ack lands on THAT row (not the
//  dedup-key-latest heuristic the lock-screen path relies on).
//  Categories with a real rating choice (skip_recovery / weekly_checkin /
//  niggle_sick) present the same options as the push's inline actions via
//  a confirmation sheet; everything else (race_day, streak, ...) acks
//  with a neutral "viewed" action — the endpoint's default branch treats
//  those as log-only, so there's no side-effect to choose between.
//

import SwiftUI

struct NotificationInboxSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var items: [NotifInboxItem] = []
    @State private var loading: Bool = true
    @State private var loadError: String? = nil
    /// Row awaiting a rating pick (skip_recovery / weekly_checkin / niggle_sick).
    @State private var actionSheetItem: NotifInboxItem?
    /// Locally-acked ids · optimistic UI so a tapped row shows "acked"
    /// immediately without waiting on a full reload.
    @State private var ackedLocally: [Int: String] = [:]

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
        .confirmationDialog(
            "How's it going?",
            isPresented: Binding(
                get: { actionSheetItem != nil },
                set: { if !$0 { actionSheetItem = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let item = actionSheetItem {
                ForEach(ratingOptions(item), id: \.self) { option in
                    Button(option.uppercased()) {
                        Task { await ack(item, action: option) }
                    }
                }
                Button("Cancel", role: .cancel) { actionSheetItem = nil }
            }
        }
    }

    /// Rating choices per category · mirrors the lock-screen action set
    /// (NotificationCategories.swift) so in-app acking answers the same
    /// question the push offered. niggle_sick shares one wire category
    /// for two different check-ins (FAFF_NIGGLE vs FAFF_SICK) — the ack
    /// route disambiguates by dedup_key prefix ('sick-check:' vs
    /// 'niggle-check:'), so the in-app picker mirrors that split off the
    /// row's own dedup_key rather than guessing from title text.
    private func ratingOptions(_ item: NotifInboxItem) -> [String] {
        switch item.category {
        case "skip_recovery":  return ["ready", "still_skipping"]
        case "weekly_checkin": return ["solid", "tired", "wrecked"]
        case "niggle_sick":
            if item.dedup_key?.hasPrefix("sick-check:") == true {
                return ["better", "same", "worse", "recovered"]
            }
            return ["better", "same", "worse", "gone"]
        default: return []
        }
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
        // Local optimistic ack wins over the server value until the next
        // full reload picks up the real ack_at/ack_action.
        let effectiveAck = ackedLocally[item.id] ?? item.ack_action
        return Button(action: { handleRowTap(item) }) {
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
                        if let act = effectiveAck {
                            Text("· acked \(act)".uppercased())
                                .font(.body(9, weight: .extraBold)).tracking(1)
                                .foregroundStyle(Theme.Accent.mintReady)
                        }
                    }
                }
                Spacer(minLength: 8)
                if effectiveAck == nil {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.32))
                        .padding(.top, 3)
                }
            }
            .padding(14)
            .background(Theme.Glass.fill, in: RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rTile, style: .continuous).stroke(Theme.Glass.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(effectiveAck != nil)
    }

    /// Row tap · categories with a real rating choice open the picker,
    /// everything else acks immediately with a neutral "viewed" action
    /// (the endpoint's default branch treats unlisted categories as
    /// log-only, so there's nothing to choose between).
    private func handleRowTap(_ item: NotifInboxItem) {
        guard ackedLocally[item.id] == nil, item.ack_action == nil else { return }
        if ratingOptions(item).isEmpty {
            Task { await ack(item, action: "viewed") }
        } else {
            actionSheetItem = item
        }
    }

    /// POST /api/notifications/ack with this row's id so the ack lands on
    /// THIS row (not the dedup-key-latest heuristic the lock-screen path
    /// uses). Optimistically marks the row acked locally.
    private func ack(_ item: NotifInboxItem, action: String) async {
        // The ack route infers niggle-vs-sick from the dedup_key prefix
        // server-side (ack/route.ts ackNiggleSick) — no separate `kind`
        // param needed here, mirroring the lock-screen path.
        await API.ackNotification(
            category: item.category,
            action: action,
            dedupKey: item.dedup_key,
            notificationId: item.id
        )
        await MainActor.run {
            ackedLocally[item.id] = action
            actionSheetItem = nil
        }
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
