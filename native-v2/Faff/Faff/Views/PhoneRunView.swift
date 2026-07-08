//
//  PhoneRunView.swift
//  Phone-only GPS run recorder — live HUD (wave3b/phone-gps-recording).
//
//  Entry point: RunActionMenu's Outdoor button (RootTabView.onOutdoor).
//  When WatchSync reports no paired/installed Apple Watch, Outdoor routes
//  here instead of dead-ending into WatchMirrorView (which is read-only —
//  it mirrors a workout the WATCH is running, so a runner with no watch
//  had no live in-run screen at all). A reachable watch still gets the
//  existing WatchMirrorView path unchanged.
//
//  Layout mirrors TreadmillView / WatchMirrorView's visual language:
//  per-effort mesh background, Oswald-display hero numbers, glass pill
//  controls. Header follows TreadmillView's plain-inline pattern (not
//  WatchMirrorView's faffHeaderPill) — this is an active-console surface
//  like TreadmillView, not a tab-root surface, and the two existing
//  active-run consoles already disagree on this (WatchMirrorView pills,
//  TreadmillView doesn't), so there's no single precedent to break.
//  Recording itself is unstructured ("Just run" shape, single open .work
//  phase) — the phone has no execution engine to walk a plan's phases
//  against; today's planned workout (if any) is shown for CONTEXT only,
//  same idea as WatchMirrorView's "PLANNED" hero, not as a target the
//  HUD grades against.
//
//  MVP scope note (per task instructions): splits, live elevation, and
//  route-map pace-gradient coloring (no completed splits exist mid-run
//  to grade a gradient against) are deliberately deferred — see
//  needs_decision in the delivery report. What ships: start / pause /
//  resume / discard(confirm) / finish, live distance + time + pace, a
//  live route line on the same CartoDB-dark RouteMapView the rest of the
//  app uses, and a completion save through the durable watch-completion
//  queue (WatchSync.saveCompletionDurably) so a lost network connection
//  never means a lost run.
//

import SwiftUI
import CoreLocation
import UIKit

struct PhoneRunView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var tracker = PhoneRunTracker()

    /// Today's planned workout, fetched for CONTEXT only (see file header).
    /// nil on a rest day, a fetch failure, or before the .task completes —
    /// all handled by falling back to a generic "Outdoor run" header.
    @State private var plannedWorkout: WatchWorkout?

    @State private var showDiscardConfirm = false
    @State private var showFinishConfirm = false
    @State private var posting = false
    @State private var postError: String?
    @State private var savedSyncing = false
    @State private var didSave = false

    var body: some View {
        let effort = FaffEffort.fromType(plannedWorkout?.paceLabel ?? "easy")
        let mesh = effort.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                header
                    .padding(.horizontal, 20)
                    .padding(.top, 8)

                if tracker.authorizationDenied {
                    permissionDeniedState
                } else if tracker.state == .finished {
                    summaryBody
                } else {
                    recordingBody
                }
            }
            .foregroundStyle(Theme.txt)
            // Live tick — identical cadence/pattern to TreadmillView.tick:
            // TimelineView drives a 1s pulse, tracker.tick(at:) advances the
            // published elapsedSec from its own start/pause bookkeeping.
            .background(
                TimelineView(.periodic(from: .now, by: 1.0)) { ctx in
                    Color.clear
                        .onChange(of: ctx.date) { _, now in tracker.tick(at: now) }
                }
            )
        }
        .task {
            plannedWorkout = try? await API.fetchWatchWorkout()
            tracker.requestPermission()
        }
        // Keep the screen awake only while actively recording — same scope
        // TreadmillView uses (pausing/finishing re-enables auto-lock).
        .onChange(of: tracker.state) { _, state in
            UIApplication.shared.isIdleTimerDisabled = (state == .running)
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            // Belt-and-suspenders: if the runner navigates away mid-run
            // (e.g. force-quits back to Today via a system gesture) without
            // going through Finish/Discard, stop GPS rather than leaving it
            // spinning in the background with no UI to control it. The run
            // itself is NOT saved by this path — only an explicit Finish
            // saves. This only fires on a genuine view teardown, not on the
            // normal finish/discard flows (which already stopped GPS).
            if tracker.state == .running || tracker.state == .paused {
                tracker.pause()
            }
        }
        .alert("Discard this run?", isPresented: $showDiscardConfirm) {
            Button("Discard", role: .destructive) {
                tracker.discard()
                dismiss()
            }
            Button("Keep recording", role: .cancel) {}
        } message: {
            Text("This deletes the GPS track and can't be undone.")
        }
        .alert("Finish run?", isPresented: $showFinishConfirm) {
            Button("Finish and save") { tracker.finish() }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text("Saves \(String(format: "%.2f", tracker.distanceMi)) mi · \(formatClock(tracker.elapsedSec)).")
        }
        .hideFaffTabBar()
    }

    // MARK: - Header pill

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                LivePulseDot(
                    color: tracker.state == .running ? Theme.green : Theme.txt.opacity(0.4),
                    size: 8
                )
                .frame(width: 14, height: 14)
                Text(plannedWorkout?.name ?? "Outdoor run")
                    .font(.body(15, weight: .extraBold))
                    .tracking(-0.2)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if tracker.state != .finished {
                    Button {
                        if tracker.state == .idle {
                            dismiss()
                        } else {
                            showDiscardConfirm = true
                        }
                    } label: {
                        Text(tracker.state == .idle ? "Cancel" : "Discard")
                            .font(.body(13, weight: .extraBold))
                            .foregroundStyle(Theme.txt)
                            .padding(.horizontal, 15).padding(.vertical, 9)
                            .background(Color.white.opacity(0.12), in: Capsule())
                            .overlay(Capsule().stroke(Color.white.opacity(0.22), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            SpecLabel(text: "PHONE GPS · NO WATCH NEEDED", size: 9.5, tracking: 1.6, color: Theme.txt.opacity(0.55))
        }
        .padding(.top, 6)
    }

    // MARK: - Recording body

    private var recordingBody: some View {
        VStack(spacing: 0) {
            liveStats
                .padding(.horizontal, 24)
                .padding(.top, 18)

            routeCard
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .frame(maxHeight: .infinity)

            if tracker.lastFixAgeIsStale {
                Text("GPS signal weak · distance may pause until it returns.")
                    .font(.body(11, weight: .semibold))
                    .foregroundStyle(Theme.goal)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 30)
                    .padding(.top, 10)
            }

            controls
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 24)
        }
    }

    private var liveStats: some View {
        VStack(spacing: 14) {
            VStack(spacing: 2) {
                Text(formatClock(tracker.elapsedSec))
                    .displayRecipe(size: 58, weight: .bold)
                    .foregroundStyle(Theme.txt)
                    .shadow(color: .black.opacity(0.32), radius: 26, y: 3)
                SpecLabel(text: "ELAPSED", size: 10, tracking: 2, color: Theme.txt.opacity(0.6))
            }
            HStack(spacing: 22) {
                statBlock(value: String(format: "%.2f", tracker.distanceMi), key: "MI")
                statBlock(
                    value: tracker.currentPaceSecPerMi.map { PaceFormat.mmss($0) } ?? "—:—",
                    key: "PACE"
                )
            }
        }
    }

    private func statBlock(value: String, key: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.display(30, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
            SpecLabel(text: key, size: 9, tracking: 1.4, color: Theme.txt.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
    }

    private var routeCard: some View {
        ZStack {
            if tracker.routeCoords.count >= 2 {
                // Downsampled for the LIVE map only — RouteMapView redraws
                // its polyline on every routeCoords change (roughly every
                // ~5m of movement, per PhoneRunTracker's distanceFilter), so
                // an ultra-length run's full-resolution point count would
                // make every redraw progressively slower over many hours.
                // tracker.routeCoords itself is NEVER downsampled — that's
                // the full-resolution source of truth encoded into the
                // saved routePolyline, this is display-only.
                RouteMapView(coords: liveMapCoords, splits: [])
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            } else {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Color.black.opacity(0.28))
                    .overlay(
                        VStack(spacing: 8) {
                            Image(systemName: tracker.authorizationGranted ? "location.circle" : "location.slash")
                                .font(.system(size: 26, weight: .regular))
                                .foregroundStyle(Theme.txt.opacity(0.55))
                            Text(tracker.authorizationGranted ? "Finding GPS…" : "Waiting on location access")
                                .font(.body(12, weight: .semibold))
                                .foregroundStyle(Theme.txt.opacity(0.6))
                        }
                    )
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.14), lineWidth: 1)
        )
    }

    private var controls: some View {
        HStack(spacing: 9) {
            controlBtn(
                icon: tracker.state == .running ? "pause.fill" : "play.fill",
                label: tracker.state == .running ? "Pause" : (tracker.state == .idle ? "Start" : "Resume"),
                style: .secondary
            ) {
                if tracker.state == .running { tracker.pause() } else { tracker.start() }
            }
            controlBtn(
                icon: "stop.fill",
                label: "Finish",
                style: .primary
            ) {
                // Button is disabled while .idle (below), so reaching here
                // always means at least one Start has happened. Zero
                // elapsed/distance at that point (tapped Finish within the
                // same instant as Start, before any tick or GPS fix landed)
                // is really a Discard, not a save — skip the "saves 0.00 mi
                // · 0:00" confirm copy, which would just be noise.
                if tracker.elapsedSec == 0 && tracker.distanceMi == 0 {
                    tracker.discard()
                    dismiss()
                } else {
                    showFinishConfirm = true
                }
            }
            .disabled(tracker.state == .idle)
        }
    }

    private enum CtrlStyle { case primary, secondary }

    private func controlBtn(icon: String, label: String, style: CtrlStyle, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .bold))
                Text(label).font(.body(13, weight: .extraBold))
            }
            .foregroundStyle(style == .primary ? Color(hex: 0x1A0D12) : Theme.txt)
            .frame(maxWidth: .infinity).padding(.vertical, 15)
            .background(
                style == .primary ? Color.white.opacity(0.92) : Color.white.opacity(0.14),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(style == .primary ? Color.white : Color.white.opacity(0.26), lineWidth: 1)
            )
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .opacity(style == .primary && tracker.state == .idle ? 0.5 : 1)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Summary (post-finish, pre-dismiss)

    private var summaryBody: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(spacing: 18) {
                SpecLabel(text: "RUN COMPLETE", size: 11, tracking: 2.5, color: Theme.txt.opacity(0.6))
                Text(String(format: "%.2f mi", tracker.distanceMi))
                    .displayRecipe(size: 46, weight: .bold)
                    .foregroundStyle(Theme.txt)
                    .shadow(color: .black.opacity(0.32), radius: 26, y: 3)
                HStack(spacing: 22) {
                    statBlock(value: formatClock(tracker.elapsedSec), key: "TIME")
                    statBlock(value: overallPace, key: "AVG PACE")
                }
            }
            .padding(.top, 8)

            routeCard
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .frame(maxHeight: 240)

            Spacer(minLength: 0)

            VStack(spacing: 11) {
                if didSave {
                    Text(savedSyncing
                        ? "Saved on this phone · syncs when you're back online."
                        : "Saved.")
                        .font(.body(12, weight: .medium))
                        .foregroundStyle(Theme.txt.opacity(0.78))
                    Button { dismiss() } label: {
                        Text("Done")
                            .font(.body(15, weight: .extraBold))
                            .foregroundStyle(Theme.txt)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                            .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.26), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                } else {
                    if let err = postError {
                        Text(err)
                            .font(.body(11, weight: .medium))
                            .foregroundStyle(Theme.over)
                            .multilineTextAlignment(.center)
                    }
                    Button { save() } label: {
                        Text(posting ? "Saving…" : "Save run")
                            .font(.body(15, weight: .extraBold))
                            .foregroundStyle(Color(hex: 0x1A0D12))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                            .background(Color.white.opacity(0.92), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(posting)
                    Button {
                        // Same confirm alert the in-progress HUD uses (see
                        // .alert("Discard this run?") on the root view) — a
                        // completed run with real distance/time/route is
                        // exactly the accidental-tap-loses-data case the
                        // task calls out, so this does NOT discard directly.
                        showDiscardConfirm = true
                    } label: {
                        Text("Discard instead")
                            .font(.body(12, weight: .semibold))
                            .foregroundStyle(Theme.txt.opacity(0.55))
                    }
                    .buttonStyle(.plain)
                    .disabled(posting)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
            .padding(.top, 20)
        }
        .task {
            // Auto-save on arrival at the summary screen — matches
            // TreadmillView's End-always-saves flow. The explicit "Save
            // run" button above is the retry affordance if this first
            // attempt fails (postError set, didSave stays false).
            if !didSave && !posting { save() }
        }
    }

    /// Evenly-strided subset of tracker.routeCoords, capped around 1500
    /// points — plenty of visual fidelity for a card-sized map, bounded so
    /// MKMapView's per-redraw cost stays flat regardless of run length.
    /// Always includes the true last point so the live route's leading
    /// edge (where the runner currently is) never lags behind a stride
    /// step. See routeCard's comment for why this doesn't touch
    /// tracker.routeCoords itself.
    private var liveMapCoords: [CLLocationCoordinate2D] {
        let coords = tracker.routeCoords
        let cap = 1500
        guard coords.count > cap else { return coords }
        let strideBy = Int(ceil(Double(coords.count) / Double(cap)))
        var out = stride(from: 0, to: coords.count, by: strideBy).map { coords[$0] }
        // Strided sampling can land short of the true final point (e.g.
        // count=4001, strideBy=3 → last sampled index 3999, true last is
        // 4000) — always append it so the live line's leading edge tracks
        // exactly where the runner is right now, never a stride step behind.
        let last = coords[coords.count - 1]
        if out.last.map({ $0.latitude != last.latitude || $0.longitude != last.longitude }) ?? true {
            out.append(last)
        }
        return out
    }

    private var overallPace: String {
        guard tracker.elapsedSec > 0, tracker.distanceMi > 0.05 else { return "—:—" }
        return PaceFormat.mmss(Int((Double(tracker.elapsedSec) / tracker.distanceMi).rounded()))
    }

    // MARK: - Permission denied

    private var permissionDeniedState: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 0)
            Image(systemName: "location.slash")
                .font(.system(size: 36, weight: .regular))
                .foregroundStyle(Theme.txt.opacity(0.7))
            Text("Location access needed")
                .font(.display(20, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.txt)
            Text("Faff needs location access to record your route and distance. Turn it on in Settings to record an outdoor run from your phone.")
                .font(.body(14, weight: .semibold))
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.txt.opacity(0.7))
                .lineSpacing(3)
                .padding(.horizontal, 32)
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            } label: {
                Text("Open Settings")
                    .font(.body(14, weight: .extraBold))
                    .foregroundStyle(Color(hex: 0x1A0D12))
                    .padding(.horizontal, 22).padding(.vertical, 13)
                    .background(Color.white.opacity(0.92), in: Capsule())
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Save

    private func save() {
        guard !posting else { return }
        posting = true
        postError = nil
        let payload = tracker.buildCompletionPayload(status: "completed")
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            // Can't happen · payload is built from JSON-safe types.
            posting = false
            postError = "Couldn't prepare this run to save · try again."
            return
        }
        Task {
            // Durable-first save — same queue TreadmillView uses. Persisted
            // to disk BEFORE the network attempt, so a failed POST here is
            // "will sync later," never "run gone." WatchSync retries this
            // exact payload on next launch/foreground/reachability change.
            let synced = await WatchSync.shared.saveCompletionDurably(data)
            await MainActor.run {
                posting = false
                didSave = true
                savedSyncing = !synced
            }
        }
    }

    // MARK: - Helpers

    private func formatClock(_ s: Int) -> String {
        let h = s / 3600
        let m = (s % 3600) / 60
        let x = s % 60
        if h > 0 {
            return "\(h):\(m < 10 ? "0" : "")\(m):\(x < 10 ? "0" : "")\(x)"
        }
        return "\(m):\(x < 10 ? "0" : "")\(x)"
    }
}
