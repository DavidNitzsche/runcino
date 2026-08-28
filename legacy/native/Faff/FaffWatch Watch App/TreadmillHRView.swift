//
//  TreadmillHRView.swift
//  FaffWatch
//
//  The watch as a heart-rate strap for the iPhone's treadmill console.
//  The phone owns the belt, the plan and the run itself — this screen takes
//  over the watch face the moment the runner taps Start (WatchSync.
//  startTreadmillHRSession, called from LiveRunTreadmillV5.startRun(), never
//  earlier — see that call site's history) and hands back nothing but
//  numbers the phone is pushing it: heart rate straight off this session's
//  own HealthKit reads, and distance/elapsed/pace relayed from the phone's
//  own belt arithmetic (TreadmillHRSession.applyLiveStats, since there is no
//  GPS indoors and the belt has no sensor of its own).
//
//  2026-08-28 · David asked for "our in run layout" here — the same
//  distance/time/pace/HR reading the outdoor faces already show — rather
//  than heart rate alone. Reuses RunFaceV6's own primitives (WorkoutPage /
//  WorkoutMetricStack / WorkoutMetric) rather than a bespoke layout, so this
//  screen looks and sizes exactly like every other running face instead of
//  being visually its own thing.
//
//  Earlier drafts of this screen carried a wordmark, a "the phone has the
//  controls" line, and a Stop button wired to a clock that started the
//  instant the phone's READY screen rendered — before any run existed. Both
//  are gone: the wordmark/coach-line per direct feedback, and the premature
//  clock+Stop because the underlying early-start bridge call they depended
//  on was itself the bug (see LiveRunTreadmillV5's `.onAppear` history) —
//  showing either implied a workout was running when nothing had started.
//
//  · A treadmill has no trustworthy pace — no incline sensor, no calibrated
//    belt speed — so nothing here grades and every value is neutral/white,
//    same as the treadmill running faces throughout the rest of the app.
//  · Heart rate is MEASURED with no band to grade against, so it stays white
//    at full opacity rather than reaching for amber, which means "out of
//    range" and has no meaning without one.
//

import SwiftUI

struct TreadmillHRView: View {
    @ObservedObject private var hr = TreadmillHRSession.shared

    var body: some View {
        WorkoutPage {
            WorkoutMetricStack(metrics: [
                paceMetric,
                heartRateMetric,
                distanceMetric,
                elapsedMetric,
            ])
        }
    }

    /// Absent (not "0:00") until the phone's first stats push lands, and
    /// absent again whenever the belt reports no speed — a "0:00" pace would
    /// claim a speed nobody is running at.
    private var paceMetric: WorkoutMetric {
        guard let p = hr.livePaceSecPerMi, let text = WFmt.pace(p) else {
            return WorkoutMetric(value: "--", role: "Pace")
        }
        return WorkoutMetric(value: text, unit: "/mi", role: "Pace")
    }

    /// The one figure this screen exists for even with the phone
    /// unreachable — this reads straight off THIS session's own HealthKit
    /// samples, not anything the phone pushes, so it is drawn as absent
    /// (never a zero) exactly the way it always has been here.
    private var heartRateMetric: WorkoutMetric {
        hr.currentBpm > 0
            ? WorkoutMetric(value: "\(hr.currentBpm)", unit: "bpm", role: "Heart rate")
            : WorkoutMetric(value: "No heart signal", fault: true, role: "Heart rate unavailable")
    }

    private var distanceMetric: WorkoutMetric {
        guard let d = hr.liveDistanceMi else {
            return WorkoutMetric(value: "--", role: "Distance")
        }
        return WorkoutMetric(value: WFmt.miles(d), unit: "mi", role: "Distance")
    }

    private var elapsedMetric: WorkoutMetric {
        guard let e = hr.liveElapsedSec else {
            return WorkoutMetric(value: "--", role: "Elapsed")
        }
        return WorkoutMetric(value: WFmt.clock(e), role: "Elapsed")
    }
}
