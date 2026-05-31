//
//  LoadState.swift
//  Shared async-load lifecycle + failure surface for the main tabs.
//
//  Was missing: every tab swallowed fetch errors via `try?` and either
//  rendered an empty UI or stuck with stale cache. The runner had no
//  way to know "I'm offline" vs "no data exists yet" vs "I'm loading."
//
//  Doctrine 2026-05-31:
//    · Hydrate from AppCache → render immediately (state = .loaded
//      if cache present, .idle if not)
//    · On reload, flip to .loading only when no cached data is present
//      (so the cached UI doesn't blink to a skeleton on every refresh)
//    · On success → .loaded · on failure → .failed(message)
//    · Views render the cached/loaded content always when present, and
//      overlay a FailedLoadBanner pill when state = .failed AND nothing
//      is cached — that's the case that used to show as silent empty.
//

import SwiftUI

/// Async-fetch lifecycle for a single state-loader on a major tab.
/// `Equatable` so SwiftUI can diff and animate state transitions.
enum LoadState: Equatable {
    case idle           // never fetched and no cache hydrated
    case loading        // first-pass fetch in flight, no cached data
    case loaded         // fetch succeeded at least once
    case failed(String) // last fetch errored; message displayed in the banner

    var isFailed: Bool {
        if case .failed = self { return true }
        return false
    }
    var failureMessage: String? {
        if case let .failed(m) = self { return m }
        return nil
    }
}

/// Pill shown at the top of a tab body when the last fetch failed AND
/// no cached data is present. Tap to dismiss · pull-to-refresh on the
/// parent ScrollView is the retry affordance.
struct FailedLoadBanner: View {
    let message: String
    var retry: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.over)
            VStack(alignment: .leading, spacing: 2) {
                Text("COULDN'T LOAD")
                    .font(.body(10, weight: .extraBold))
                    .tracking(1.5)
                    .foregroundStyle(Theme.over)
                Text(message)
                    .font(.body(12, weight: .medium))
                    .foregroundStyle(Theme.txt.opacity(0.85))
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if let retry {
                Button(action: retry) {
                    Text("RETRY")
                        .font(.body(11, weight: .extraBold))
                        .tracking(1)
                        .foregroundStyle(Theme.txt)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Theme.over.opacity(0.18), in: Capsule())
                        .overlay(Capsule().stroke(Theme.over.opacity(0.55), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black.opacity(0.32))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Theme.over.opacity(0.45), lineWidth: 1)
                )
        )
    }
}

/// Helper to extract a short human message from any Error · `localizedDescription`
/// is verbose for URLSession errors. Trims to one short line.
func loadFailureMessage(_ error: Error) -> String {
    let raw = (error as NSError).localizedDescription
    // Trim verbose URLSession boilerplate to keep the banner one line.
    return raw
        .replacingOccurrences(of: "The Internet connection appears to be offline.",
                              with: "Internet appears to be offline.")
        .replacingOccurrences(of: "A server with the specified hostname could not be found.",
                              with: "Server not reachable.")
        .prefix(140)
        .description
}
