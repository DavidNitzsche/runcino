//
//  TreadmillView.swift
//  Guided treadmill console · 2026-06-01 v2 (build 136 target).
//
//  Previously: hardcoded 4-interval session, no plan read, no POST,
//  nothing persisted. Visual stub only.
//
//  Now:
//  · Fetches today's WatchWorkout via /api/watch/today on appear
//  · Derives segments from the plan's WatchPhase array (warmup/
//    work/recovery/cooldown). Falls back to a single open-run
//    segment when no plan / rest day / fetch fails.
//  · Real timer counts elapsed seconds via TimelineView; pause halts,
//    skip advances, end POSTs.
//  · Runner enters actual speed (±0.1 mph) + incline (±0.5%) per
//    segment via the existing steppers. Initial values come from the
//    plan's target pace (mph-converted) when available, else 5.5/1.0.
//  · Per-segment actuals (speed + incline at end of segment) get
//    recorded into a phase buffer. On End, the buffer becomes the
//    POST payload's `phases[].actualSpeedMph` + `actualInclinePct`.
//  · Distance accumulates from speed × time per tick (treadmill GPS
//    is unavailable on the phone).
//  · End button POSTs WatchCompletion-shaped payload to
//    /api/watch/workouts/complete with source='treadmill' +
//    indoor=true. Backend ingest changes are in
//    designs/briefs/treadmill-backend-wire-brief.md (must land
//    alongside this for source to be respected).
//
//  HR-from-HK (live): when the runner wears an Apple Watch on the
//  treadmill, the watch streams HR samples into HealthKit. The view
//  reads them via TreadmillHRStreamer (HKObserverQuery + HKAnchored
//  ObjectQuery, anchored at session start) with ~5-30s latency.
//  Per-phase avgHr/maxHr land in actualsBySegment[i] and flow into the
//  POST payload. Non-watch users see no HR pill and the payload stays
//  null for HR fields, which backend resolveCalories tier 3 handles.
//

import SwiftUI
import HealthKit

struct TreadmillView: View {
    @Environment(\.dismiss) private var dismiss

    // ── Live HR feed (HK · build 136) ───────────────────────────────
    @StateObject private var hrStreamer = TreadmillHRStreamer()

    // ── Plan source · fetched on .task ──────────────────────────────
    @State private var workout: WatchWorkout?
    @State private var loaded: Bool = false

    // ── Live session state ──────────────────────────────────────────
    /// Index into `segments` for the active segment.
    @State private var idx: Int = 0
    /// Seconds elapsed within the current segment (counts UP from 0).
    @State private var elapsedInSeg: Int = 0
    /// Cumulative elapsed seconds across the whole session.
    @State private var totalSec: Int = 0
    /// Cumulative distance in miles, accumulated each tick from speedMph.
    @State private var dist: Double = 0
    /// Cumulative elevation gain in ft · accumulated each tick from the set
    /// incline (rise = distance × grade) so incline reflects as real climb.
    @State private var elev: Double = 0
    /// Current runner-input speed (mph). Initialized per segment from
    /// the plan's target; runner adjusts via steppers.
    @State private var speedMph: Double = 5.5
    /// Current runner-input incline (%).
    @State private var inclinePct: Double = 1.0
    /// Timer playing vs paused.
    @State private var playing: Bool = false
    /// Workout startedAt wall-clock · stamped on first play.
    @State private var startedAt: Date?
    /// Stable workout id · generated once on first play. Used as the
    /// WatchConnectivity sessionId for the watch HR bridge AND as the
    /// payload's workoutId so backend idempotency is consistent across
    /// retries.
    @State private var workoutId: String?
    /// Did we successfully ask the watch to stream HR? false when the
    /// Faff watch app isn't launched/reachable · drives the "Open Faff
    /// on watch for live HR" pill in the topbar so the runner knows to
    /// fix the bridge if they want live HR.
    @State private var watchHRBridgeUp: Bool = false
    /// Per-segment actuals captured at segment end (or on Skip/End).
    /// Keyed by segment index. Stored as arrays so swift-friendly.
    @State private var actualsBySegment: [Int: PhaseActual] = [:]
    /// Wall-clock instant of the last tick · used by TimelineView to
    /// derive `delta` since we last advanced state, so background
    /// pauses don't double-count.
    @State private var lastTickAt: Date = .now

    /// Confirm-end prompt before POST.
    @State private var showEndConfirm: Bool = false
    /// Status indicator for the POST request.
    @State private var posting: Bool = false
    @State private var postError: String?

    private struct PhaseActual {
        var avgSpeedMph: Double
        var avgInclinePct: Double
        var distanceMi: Double
        var durationSec: Int
        var completed: Bool
        // Live HR from TreadmillHRStreamer · null when no watch is
        // paired or HK hasn't surfaced any samples yet for this phase.
        var avgHr: Int?
        var maxHr: Int?
    }

    // ── Derived: segments from workout.phases ──────────────────────

    private var segments: [TreadSeg] {
        guard let phases = workout?.phases, !phases.isEmpty else {
            // Cold path · no plan loaded yet OR rest day OR fetch
            // failed. Single open segment, runner just logs.
            return [TreadSeg(label: "Just Run", sub: "",
                             kind: .work, mph: 5.5, inc: 1.0, dur: 30 * 60)]
        }
        return phases.map { phase in
            let mph = mphFromPaceSPerMi(phase.targetPaceSPerMi) ?? defaultMphFor(phase.type)
            let kind: TreadSegKind = {
                switch phase.type {
                case .warmup:   return .warm
                case .work:     return .work
                case .recovery: return .rec
                case .cooldown: return .cool
                }
            }()
            return TreadSeg(
                label: phase.label,
                sub: "",
                kind: kind,
                mph: mph,
                inc: 1.0,   // treadmill default; runner adjusts
                dur: phase.durationSec
            )
        }
    }

    /// Convert sec/mi pace into mph. 7:00/mi → 8.57 mph.
    private func mphFromPaceSPerMi(_ secPerMi: Int?) -> Double? {
        guard let s = secPerMi, s > 0 else { return nil }
        return 3600.0 / Double(s)
    }

    /// Sensible defaults when the plan didn't carry a target pace.
    private func defaultMphFor(_ type: WatchPhaseType) -> Double {
        switch type {
        case .warmup:   return 5.5
        case .work:     return 7.0
        case .recovery: return 5.0
        case .cooldown: return 5.0
        }
    }

    // MARK: - body

    var body: some View {
        // 2026-06-02 round 36 · per-RUN effort mesh (not per-segment,
        // not time-of-day). The run's overall type (easy / tempo /
        // long / intervals / recovery / rest) drives the palette ·
        // matches every other run surface in the app + the web app.
        // Derive from the workout's paceLabel (T/E/I/L tag) with a
        // fallback to easy for null/unknown.
        let effort = FaffEffort.fromType(workout?.paceLabel ?? "easy")
        let mesh = effort.mesh
        ZStack {
            FaffMeshView(mesh: mesh)

            VStack(spacing: 0) {
                topHead
                    .padding(.horizontal, 20)
                    .padding(.top, 8)

                segRow
                    .padding(.horizontal, 20)
                    .padding(.top, 24)

                segProgressBar
                    .padding(.horizontal, 20)
                    .padding(.top, 16)

                console
                    .padding(.horizontal, 20)
                    .padding(.top, 20)

                Spacer(minLength: 0)

                bottomBlock
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
            }
            .foregroundStyle(Theme.txt)
            // Live tick. Drives elapsedInSeg / totalSec / dist forward
            // by `delta = now - lastTickAt` each frame. TimelineView at
            // 1s cadence is plenty for a treadmill counter; saves
            // battery vs continuous redraw.
            .background(
                TimelineView(.periodic(from: .now, by: 1.0)) { ctx in
                    Color.clear
                        .onChange(of: ctx.date) { _, now in tick(at: now) }
                }
            )
        }
        .task {
            await loadPlan()
        }
        .onDisappear {
            if let id = workoutId {
                WatchSync.shared.stopTreadmillHRSession(sessionId: id)
            }
        }
        .alert("End workout?", isPresented: $showEndConfirm) {
            Button("End and save", role: .destructive) { endAndPost(status: "completed") }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Saves what you've done so far · skips remaining segments.")
        }
        // 2026-06-02 round 34 · hide the floating tab bar while the
        // treadmill console is on screen. The console's End/Skip/Pause
        // buttons sit at the bottom and were getting clipped by the
        // tab bar pill. Active run = full-screen takeover.
        .hideFaffTabBar()
    }

    // MARK: - Load plan

    private func loadPlan() async {
        guard !loaded else { return }
        let fetched = try? await API.fetchWatchWorkout()
        await MainActor.run {
            self.workout = fetched
            self.loaded = true
            // Seed first segment's speed/incline from its derived defaults.
            if let first = segments.first {
                self.speedMph = first.mph
                self.inclinePct = first.inc
            }
        }
    }

    // MARK: - Tick

    private func tick(at now: Date) {
        guard playing else { lastTickAt = now; return }
        let delta = max(0, Int(now.timeIntervalSince(lastTickAt).rounded()))
        lastTickAt = now
        guard delta > 0 else { return }
        // Advance elapsed counters.
        elapsedInSeg += delta
        totalSec += delta
        // Distance accumulates · mph × hours = miles
        let distDeltaMi = Double(delta) / 3600.0 * speedMph
        dist += distDeltaMi
        // Elevation accumulates from the set incline · rise = run × grade.
        // A treadmill at incline% over distDeltaMi miles climbs
        // distDeltaMi × 5280 × (incline / 100) feet. Reflects incline as real
        // elevation gain so a harder treadmill run isn't recorded as flat.
        elev += distDeltaMi * 5280.0 * (inclinePct / 100.0)
        // Auto-advance only INTERMEDIATE segments when they run out. The
        // last (or only) segment never auto-advances or auto-ends — the
        // runner can keep going past the target (run longer if they want)
        // and taps End when they're done. Auto-ending mid-run was wrong.
        let seg = segments[safe: idx]
        if let seg, elapsedInSeg >= seg.dur, idx + 1 < segments.count {
            recordActual(forSegment: idx, completed: true)
            let next = idx + 1
            idx = next
            elapsedInSeg = 0
            let nseg = segments[next]
            speedMph = nseg.mph
            inclinePct = nseg.inc
        }
    }

    private func recordActual(forSegment i: Int, completed: Bool) {
        let seg = segments[i]
        // The last/only segment is open-ended — the runner can keep going
        // past the target — so record its true elapsed time. Intermediate
        // segments auto-advance at their target, so an over-target value
        // there means a clock glitch (e.g. backgrounding); cap it at 2×.
        let isLast = i == segments.count - 1
        let durActual = isLast ? elapsedInSeg : min(elapsedInSeg, seg.dur * 2)
        // Close the HR phase here · returns (avg, max) for everything
        // streamed since the last phase boundary and clears the phase
        // buffer for the next segment.
        let hr = hrStreamer.closePhase()
        actualsBySegment[i] = PhaseActual(
            avgSpeedMph: speedMph,
            avgInclinePct: inclinePct,
            distanceMi: Double(durActual) / 3600.0 * speedMph,
            durationSec: durActual,
            completed: completed,
            avgHr: hr.avg,
            maxHr: hr.max
        )
    }

    // MARK: - Topbar

    private var topHead: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(workout?.name ?? "Just Run")
                    .font(.body(19, weight: .extraBold))
                    .tracking(-0.3)
                    .lineLimit(1)
                SpecLabel(text: "TREADMILL · GUIDED", size: 10, tracking: 2, color: Theme.txt.opacity(0.6))
            }
            // Watch-HR-bridge hint · only shows when session has started
            // but the watch wasn't reachable. Tells the runner what they
            // need to do to light up the live BPM in the SPEED tile.
            if startedAt != nil, !watchHRBridgeUp, hrStreamer.currentBpm == nil {
                Text("Open Faff on your watch for live HR")
                    .font(.body(10, weight: .semibold))
                    .tracking(0.3)
                    .foregroundStyle(Theme.txt.opacity(0.75))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.white.opacity(0.12), in: Capsule())
                    .overlay(Capsule().stroke(Color.white.opacity(0.22)))
            }
            HStack(alignment: .top, spacing: 0) {
                topStat("TIME", formatClock(totalSec))
                topStat("DISTANCE", String(format: "%.2f mi", dist))
                topStat("PHASE", "\(min(idx + 1, segments.count))/\(segments.count)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func topStat(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SpecLabel(text: k, size: 9, tracking: 1.5, color: Theme.txt.opacity(0.58))
            Text(v).font(.display(21, weight: .bold)).tracking(-0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Segment row + bar

    private var segRow: some View {
        HStack {
            Text(segLabelText)
                .font(.body(14, weight: .extraBold))
                .tracking(1.5)
                .textCase(.uppercase)
                .padding(.horizontal, 18).padding(.vertical, 9)
                .background(Color.white.opacity(0.18), in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(0.32), lineWidth: 1))
                .background(.ultraThinMaterial, in: Capsule())
            Spacer()
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Text(isOverTarget ? "+\(formatClock(overInSeg))" : formatClock(remainingInSeg))
                    .font(.display(42, weight: .bold))
                    .tracking(-1)
                    .foregroundStyle(isOverTarget ? Theme.green : Theme.txt)
                Text(isOverTarget ? "OVER" : "LEFT")
                    .font(.label(11)).tracking(1.5)
                    .foregroundStyle(isOverTarget ? Theme.green.opacity(0.85) : Theme.txt.opacity(0.6))
            }
        }
    }

    private var remainingInSeg: Int {
        guard let seg = segments[safe: idx] else { return 0 }
        return max(0, seg.dur - elapsedInSeg)
    }

    /// True once the runner passes the target on the open-ended last
    /// segment. The clock flips from counting down ("LEFT") to counting
    /// up ("OVER") so a hit target reads as bonus time, not a stuck 0:00.
    private var isOverTarget: Bool {
        guard let seg = segments[safe: idx] else { return false }
        return idx == segments.count - 1 && seg.dur > 0 && elapsedInSeg >= seg.dur
    }

    private var overInSeg: Int {
        guard let seg = segments[safe: idx] else { return 0 }
        return max(0, elapsedInSeg - seg.dur)
    }

    private var segProgressBar: some View {
        let seg = segments[safe: idx]
        let frac = seg.map { max(0, min(1, Double(elapsedInSeg) / Double($0.dur))) } ?? 0
        let fill: Color = isOverTarget ? Theme.green : Color.white
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.2)).frame(height: 8)
                Capsule().fill(fill).frame(width: geo.size.width * frac, height: 8)
            }
        }
        .frame(height: 8)
    }

    // MARK: - Console (speed + incline steppers)

    private var console: some View {
        VStack(spacing: 11) {
            consoleTile(
                label: "SPEED",
                value: String(format: "%.1f", speedMph),
                unit: "mph",
                valueFontSize: 74,
                // When HK streams a live HR sample, append it to the
                // sub line · "8:34 /mi · 162 bpm". Nil when no watch
                // is paired, sub stays pace-only.
                sub: hrSubLine(pace: "\(paceStr(speedMph)) /mi"),
                onMinus: { speedMph = max(0.5, round((speedMph - 0.1) * 10) / 10) },
                onPlus:  { speedMph = min(12, round((speedMph + 0.1) * 10) / 10) }
            )
            consoleTile(
                label: "INCLINE",
                value: String(format: "%.1f", inclinePct),
                unit: "%",
                valueFontSize: 54,
                sub: " ",
                onMinus: { inclinePct = max(0, round((inclinePct - 0.5) * 2) / 2) },
                onPlus:  { inclinePct = min(15, round((inclinePct + 0.5) * 2) / 2) }
            )
        }
    }

    private func consoleTile(label: String, value: String, unit: String, valueFontSize: CGFloat, sub: String, onMinus: @escaping () -> Void, onPlus: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            bigStepButton(symbol: "−", action: onMinus)
            VStack(spacing: 5) {
                SpecLabel(text: label, size: 11, tracking: 2.5, color: Theme.txt.opacity(0.62))
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(value).font(.display(valueFontSize, weight: .bold)).tracking(-3)
                        .foregroundStyle(Theme.txt)
                        .shadow(color: .black.opacity(0.32), radius: 22, y: 2)
                    Text(unit).font(.display(valueFontSize * 0.27, weight: .bold)).foregroundStyle(Theme.txt.opacity(0.85))
                }
                Text(sub)
                    .font(.body(10, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(Theme.txt.opacity(0.72))
                    .frame(height: 12)
            }
            .frame(maxWidth: .infinity)
            bigStepButton(symbol: "+", action: onPlus)
        }
        .padding(14)
        .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(Color.white.opacity(0.22), lineWidth: 1))
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private func bigStepButton(symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(symbol)
                .font(.display(32))
                .foregroundStyle(Theme.txt)
                .frame(width: 60, height: 60)
                .background(Color.white.opacity(0.18), in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Bottom (next-up + ticks + controls)

    private var bottomBlock: some View {
        VStack(spacing: 11) {
            nextUpCard
            overallTicks
            controlRow
            if let err = postError {
                Text(err)
                    .font(.body(11, weight: .medium))
                    .foregroundStyle(Theme.over)
                    .multilineTextAlignment(.center)
                // Escape hatch · the console hides the tab bar, so a failed
                // save would otherwise trap the runner here. Let them leave
                // without saving rather than be stuck retrying.
                Button { dismiss() } label: {
                    Text("Discard and exit")
                        .font(.body(13, weight: .extraBold))
                        .foregroundStyle(Theme.txt.opacity(0.7))
                        .underline()
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var nextUpCard: some View {
        let next = idx + 1 < segments.count ? segments[idx + 1] : nil
        return VStack(alignment: .leading, spacing: 5) {
            SpecLabel(text: "NEXT UP", size: 10, tracking: 2, color: Theme.txt.opacity(0.6))
            HStack(alignment: .bottom) {
                Text(next.map { fullName($0) } ?? "Finish")
                    .font(.body(18, weight: .extraBold))
                    .tracking(-0.3)
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    HStack(alignment: .lastTextBaseline, spacing: 2) {
                        Text(next.map { String(format: "%.1f", $0.mph) } ?? "—")
                            .font(.display(32, weight: .bold)).tracking(-1)
                        Text(next != nil ? "mph" : "")
                            .font(.body(13, weight: .bold))
                    }
                    Text(next.map { "\(String(format: "%.1f", $0.inc))% · \(formatClock($0.dur))" } ?? "complete")
                        .font(.body(11, weight: .bold))
                        .foregroundStyle(Theme.txt.opacity(0.78))
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .background(Color(hex: 0x0A0408).opacity(0.42), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.white.opacity(0.18), lineWidth: 1))
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var overallTicks: some View {
        HStack(spacing: 4) {
            ForEach(0..<segments.count, id: \.self) { i in
                let done = i < idx
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.22)).frame(height: 4)
                        Capsule().fill(Color.white).frame(width: done ? geo.size.width : 0, height: 4)
                    }
                }
                .frame(height: 4)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var controlRow: some View {
        HStack(spacing: 9) {
            controlBtn(
                icon: playing ? "pause.fill" : "play.fill",
                label: playing ? "Pause" : (totalSec == 0 ? "Start" : "Resume"),
                style: .secondary
            ) {
                if !playing && startedAt == nil {
                    startedAt = .now
                    // Stamp the workoutId once so the WatchConnectivity
                    // sessionId, HR streamer anchor, and POST payload all
                    // agree across pause/resume + retries.
                    let id = "trd_\(UUID().uuidString)"
                    workoutId = id
                    // Kick off the HR stream the first time the runner
                    // starts the session · idempotent on re-calls.
                    let anchor = startedAt ?? .now
                    Task { await hrStreamer.start(from: anchor) }
                    // Ask the watch to open a parallel indoor-running
                    // workout session so HK gets fast HR samples (5-15s
                    // cadence) instead of the passive every-5-min baseline.
                    // Best-effort · falls through when watch not reachable.
                    watchHRBridgeUp = WatchSync.shared.startTreadmillHRSession(sessionId: id)
                }
                lastTickAt = .now
                playing.toggle()
            }
            controlBtn(icon: "forward.fill", label: "Skip", style: .secondary) { advance() }
            controlBtn(icon: "stop.fill", label: posting ? "Saving" : "End", style: .primary) {
                playing = false
                showEndConfirm = true
            }
            .disabled(posting)
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
            .frame(maxWidth: .infinity).padding(.vertical, 13)
            .background(
                style == .primary
                    ? Color.white.opacity(0.92)
                    : Color.white.opacity(0.14),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(style == .primary ? Color.white : Color.white.opacity(0.26), lineWidth: 1)
            )
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - State helpers

    private var segLabelText: String {
        guard let s = segments[safe: idx] else { return "" }
        return s.sub.isEmpty ? s.label.uppercased() : "\(s.label.uppercased()) \(s.sub)"
    }

    private func advance() {
        guard idx + 1 < segments.count else { return }
        recordActual(forSegment: idx, completed: false)   // skipped before timer ran out
        let nextIdx = idx + 1
        withAnimation(.easeInOut(duration: 0.4)) {
            idx = nextIdx
            elapsedInSeg = 0
            speedMph = segments[nextIdx].mph
            inclinePct = segments[nextIdx].inc
        }
    }

    private func formatClock(_ s: Int) -> String {
        let m = s / 60, x = s % 60
        return "\(m < 10 ? "0" : "")\(m):\(x < 10 ? "0" : "")\(x)"
    }

    private func fullName(_ s: TreadSeg) -> String {
        s.sub.isEmpty ? s.label : "\(s.label) \(s.sub)"
    }

    private func paceStr(_ mph: Double) -> String {
        let pmin = 60.0 / mph
        var m = Int(pmin)
        var s = Int(round((pmin - Double(m)) * 60))
        if s == 60 { m += 1; s = 0 }
        return "\(m):\(s < 10 ? "0" : "")\(s)"
    }

    /// Speed-tile sub line · pace plus live HR if a watch is streaming.
    /// Nil HR keeps the line clean for non-watch users.
    private func hrSubLine(pace: String) -> String {
        if let bpm = hrStreamer.currentBpm { return "\(pace) · \(bpm) bpm" }
        return pace
    }

    private func meshFor(_ kind: TreadSegKind) -> FaffMesh {
        switch kind {
        case .warm: return FaffMesh(c1: 0x62E3D4, c2: 0x3AB0CF, c3: 0x1C6F9A, c4: 0x0F8F93, c5: 0x0F6A84, base: 0x07323F)
        case .work: return FaffMesh(c1: 0xFFA566, c2: 0xFF5A52, c3: 0xEC2F54, c4: 0xC01D48, c5: 0xA8163F, base: 0x4E0A22)
        case .rec:  return FaffMesh(c1: 0x8EF0B0, c2: 0x34C194, c3: 0x1F8A68, c4: 0x128A64, c5: 0x137259, base: 0x06382E)
        case .cool: return FaffMesh(c1: 0x7FE0D0, c2: 0x34B0A0, c3: 0x1F8A8A, c4: 0x127A72, c5: 0x0F6A64, base: 0x06322E)
        }
    }

    // MARK: - End + POST

    private func endAndPost(status: String) {
        // Record the active segment's actual before flushing.
        if idx < segments.count {
            recordActual(forSegment: idx, completed: status == "completed" && elapsedInSeg >= segments[idx].dur)
        }
        // Stop streaming new HR samples · session rollup happens inside
        // buildPayload via closeSession().
        hrStreamer.stop()
        // Tell the watch to end its parallel HR workout session so the
        // watch returns to passive HR sensing. Idempotent · safe even
        // if the watch never received the start.
        if let id = workoutId {
            WatchSync.shared.stopTreadmillHRSession(sessionId: id)
        }
        posting = true
        postError = nil
        let payload = buildPayload(status: status)
        Task {
            let ok = await postTreadmillCompletion(payload: payload)
            await MainActor.run {
                posting = false
                if ok {
                    dismiss()
                } else {
                    postError = "Couldn't save · check connection and try End again."
                }
            }
        }
    }

    private func buildPayload(status: String) -> [String: Any] {
        let iso = ISO8601DateFormatter()
        let started = startedAt ?? Date(timeIntervalSinceNow: -Double(totalSec))
        let phasePayloads: [[String: Any]] = segments.enumerated().map { i, seg in
            let act = actualsBySegment[i]
            var phase: [String: Any] = [
                "label": seg.label,
                "type": treadKindToWatchType(seg.kind),
                "completed": act?.completed ?? false,
                "actualSpeedMph": act?.avgSpeedMph ?? seg.mph,
                "actualInclinePct": act?.avgInclinePct ?? seg.inc,
            ]
            if let act {
                phase["actualDistanceMi"] = (act.distanceMi * 100).rounded() / 100
                phase["actualDurationSec"] = act.durationSec
                // Approximate pace from speed for backend's split row.
                let paceSec = Int(round(3600.0 / max(0.5, act.avgSpeedMph)))
                phase["actualPaceSPerMi"] = paceSec
                // Per-phase HR from live HK stream · null when no watch.
                if let avgHr = act.avgHr { phase["avgHr"] = avgHr }
                if let maxHr = act.maxHr { phase["maxHr"] = maxHr }
            }
            return phase
        }
        // Session-level HR rollup · separate from per-phase buffers so
        // it captures samples that may have landed between phase
        // boundaries. Null when no watch.
        let sessionHr = hrStreamer.closeSession()
        var payload: [String: Any] = [
            // Reuse the stable workoutId stamped at first play · keeps
            // the WatchConnectivity sessionId, HR streamer anchor, and
            // backend idempotency key all in sync.
            "workoutId": workoutId ?? "trd_\(UUID().uuidString)",
            "startedAt": iso.string(from: started),
            "completedAt": iso.string(from: .now),
            "status": status,
            "totalDistanceMi": (dist * 100).rounded() / 100,
            "totalDurationSec": totalSec,
            // Incline-derived elevation gain · so a treadmill run with incline
            // shows real climb instead of flat (0 ft). Source flags it as
            // incline-derived, not barometric.
            "elevGainFt": elev.rounded(),
            "elevGainSource": "treadmill_incline",
            // kcal stays null on iPhone-treadmill v1 · backend
            // resolveCalories tier 3 estimator picks up.
            "source": "treadmill",
            "indoor": true,
            "phases": phasePayloads,
        ]
        if let avgHr = sessionHr.avg { payload["avgHr"] = avgHr }
        if let maxHr = sessionHr.max { payload["maxHr"] = maxHr }
        return payload
    }

    private func treadKindToWatchType(_ k: TreadSegKind) -> String {
        switch k {
        case .warm: return "warmup"
        case .work: return "work"
        case .rec:  return "recovery"
        case .cool: return "cooldown"
        }
    }

    private func postTreadmillCompletion(payload: [String: Any]) async -> Bool {
        do {
            var req = URLRequest(url: API.baseURL.appendingPathComponent("api/watch/workouts/complete"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // Fail fast · the default 60s left the End button stuck on
            // "Saving" for a full minute when the network stalled.
            req.timeoutInterval = 20
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, http) = try await API.authedSend(req)
            return (200..<300).contains(http.statusCode)
        } catch {
            print("[treadmill] POST failed: \(error)")
            return false
        }
    }
}

private enum TreadSegKind { case warm, work, rec, cool }

private struct TreadSeg {
    let label: String
    let sub: String
    let kind: TreadSegKind
    let mph: Double
    let inc: Double
    let dur: Int
}

private extension Array {
    subscript(safe i: Int) -> Element? {
        indices.contains(i) ? self[i] : nil
    }
}
