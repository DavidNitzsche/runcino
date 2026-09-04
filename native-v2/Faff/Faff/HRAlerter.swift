//
//  HRAlerter.swift  (P35)
//  Phone-side HR ceiling alert. Subscribes to new HR samples in HealthKit;
//  when one arrives and the value is over the runner's ceiling, fires a local
//  notification.
//
//  Backup to the watch's own HR alert — useful when the phone is in a pocket /
//  on a treadmill console and the watch buzz is muted.
//
//  Toggle: profile.phone_hr_alerts (settings sheet). Cached locally to avoid a
//  round-trip per sample.
//
//  ── HR-SEMANTICS-2 (2026-09-01) · NOW WIRED, TO ONE CEILING ────────────────
//
//  C-12 fixed three defects here and left the alarm dormant: `configure` had
//  no call site, so `ceilingBpm` was a `UserDefaults` value nothing wrote.
//  Wired, tested and inert is this codebase's signature failure (Rule 21), and
//  on a safety mechanism it is the worst place for it.
//
//  It is armed from ONE number: `WatchWorkout.hrCeilingBpm`, the aerobic
//  ceiling `lib/watch/build-workout.ts#resolveHrCeiling` resolves — and that
//  resolver already answers the only question that matters here, which is WHEN
//  a ceiling applies at all. It emits one for easy and long sessions only, and
//  suppresses it on a long run carrying an HM/M finish, because a workout-level
//  aerobic cap would alarm through the whole finish and coach the opposite of
//  the prescription.
//
//  So the alarm is armed on an easy day and DISARMED on a quality day, a race
//  and a long run with a fast finish — not by a rule written here, but because
//  the plan sent no ceiling. `armedCeiling(toggleOn:workoutHrCeilingBpm:)` is
//  that whole decision, pure and tested (`HRAlerterArmingTests`), because the
//  bug this replaces was precisely an alarm firing off a number nobody set.
//
//  ── C-12 (2026-09-01) · THREE DEFECTS, FIXED BEFORE THE TOGGLE WAS WIRED ───
//
//  1 · IT FIRED AT 95% OF THE CEILING AND SAID "ABOVE YOUR N CEILING".
//      `threshold = Double(ceiling) * 0.95`, then copy asserting the runner was
//      above `ceiling`. At a 145 ceiling that alarms at 138 and tells him he is
//      over 145. Rule 16: a sentence asserting a fact about a measurement is
//      gated on that measurement or not said. It now compares against the
//      ceiling itself, and the copy states the reading and the ceiling as the
//      two numbers they are.
//
//  2 · NO WORKOUT PREDICATE, DESPITE THE HEADER CLAIMING ONE. The old header
//      said "when one arrives during an active workout"; `predicate: nil` on
//      both queries meant every HR sample the watch ever wrote — sitting at a
//      desk, climbing stairs, asleep — was a candidate. An easy-run ceiling is
//      a statement about RUNNING, and 150 bpm on a staircase is not a breach of
//      it. Both queries are now bounded to samples the runner produced while a
//      workout was in flight.
//
//  3 · ONE SAMPLE WAS ENOUGH. `Research/03` §2: heart-rate kinetics have a
//      half-time of about 30 s. A single beat over a line says nothing a runner
//      could act on, and an optical wrist sensor's own artefacts are exactly
//      that shape. It now requires the breach to be sustained across
//      `sustainSec`.
//
//  RULE 20 · the header no longer claims anything the code does not do. Both
//  halves of the old claim were false, and nothing could tell.
//

import Foundation
import HealthKit
import UserNotifications

@MainActor
final class HRAlerter: ObservableObject {
    static let shared = HRAlerter()
    private init() {}

    /// HKHealthStore is thread-safe. Reads happen via callbacks; we
    /// don't await on the store directly.
    nonisolated private let store = HKHealthStore()
    private var observerQuery: HKObserverQuery?
    private var observerActive = false
    private var anchor: HKQueryAnchor?
    private var lastAlertAt: Date?

    /// Minimum spacing between phone alerts so a sustained spike doesn't
    /// buzz every second. 90s matches the watch alerter cooldown.
    private let cooldownSec: TimeInterval = 90

    /// How long the ceiling must be breached before this says anything.
    ///
    /// `Research/03` section 2: HR kinetics have a half-time of about 30 s, so
    /// a single sample over a line is not a fact about the runner's effort. It
    /// is also the shape of an optical-sensor artefact. Sixty seconds is two
    /// half-times — long enough that the reading is the effort and not the
    /// instrument, short enough to still be actionable inside a rep.
    private let sustainSec: TimeInterval = 60

    /// When the current uninterrupted breach began. Nil whenever the last
    /// batch came back under the ceiling — the question is a pattern, not a
    /// beat.
    private var breachStartedAt: Date?

    @Published var enabled: Bool = UserDefaults.standard.bool(forKey: "faff.phone_hr_alerts")
    @Published var ceilingBpm: Int? = UserDefaults.standard.object(forKey: "faff.phone_hr_ceiling") as? Int

    /// THE arming decision, pure and total.
    ///
    /// Returns the ceiling this alarm should watch today, or nil for "do not
    /// arm". A nil `workoutHrCeilingBpm` is the plan saying this session has no
    /// aerobic ceiling — a quality day, a race, a long run with a race-pace
    /// finish — and on those the alarm must be silent, because the runner is
    /// SUPPOSED to be above any easy-day line. Rule 11: absent is not zero and
    /// is not permission to reuse yesterday's number.
    ///
    /// Separated from `configure` so it can be tested without HealthKit, and
    /// because it is the exact question the old code never asked: it read a
    /// `UserDefaults` ceiling that nothing wrote and would have alarmed on any
    /// session at all.
    static func armedCeiling(toggleOn: Bool, workoutHrCeilingBpm: Int?) -> Int? {
        guard toggleOn else { return nil }
        guard let c = workoutHrCeilingBpm, c > 0 else { return nil }
        return c
    }

    /// The settings toggle. Keeps whatever ceiling today's session set.
    func configure(enabled: Bool) {
        configure(enabled: enabled, ceiling: ceilingBpm)
    }

    func configure(enabled: Bool, ceiling: Int?) {
        let armed = Self.armedCeiling(toggleOn: enabled, workoutHrCeilingBpm: ceiling)
        self.enabled = enabled
        self.ceilingBpm = ceiling
        UserDefaults.standard.set(enabled, forKey: "faff.phone_hr_alerts")
        if let c = ceiling { UserDefaults.standard.set(c, forKey: "faff.phone_hr_ceiling") }
        else { UserDefaults.standard.removeObject(forKey: "faff.phone_hr_ceiling") }
        if armed != nil { Task { await start() } } else { stop() }
    }

    /// TODAY'S CEILING, from today's prescription.
    ///
    /// Called every time the phone refreshes the day's workout, so the alarm
    /// tracks the plan rather than a stale stored number. Passing nil disarms
    /// it for the day, which is what a quality session must do.
    func applyTodaysCeiling(_ bpm: Int?) {
        let armed = Self.armedCeiling(toggleOn: enabled, workoutHrCeilingBpm: bpm)
        self.ceilingBpm = bpm
        if let b = bpm { UserDefaults.standard.set(b, forKey: "faff.phone_hr_ceiling") }
        else { UserDefaults.standard.removeObject(forKey: "faff.phone_hr_ceiling") }
        // Reset the sustain clock: a new ceiling is a new question, and a
        // breach measured against yesterday's number is not evidence.
        breachStartedAt = nil
        if armed != nil { Task { await start() } } else { stop() }
    }

    func start() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        // The same arming decision `configure` / `applyTodaysCeiling` take,
        // asked again here so a direct `start()` cannot bypass it.
        guard Self.armedCeiling(toggleOn: enabled, workoutHrCeilingBpm: ceilingBpm) != nil,
              !observerActive else { return }

        // Request notification permission once. Silent if already granted.
        //
        // Skipped for a `-faffToken` QA/verification launch. Per
        // `FaffApp.isQATokenLaunch`'s own doc comment, an automated or
        // headless driver cannot tap a SpringBoard permission alert — it
        // is owned by SpringBoard, not this app's window — so requesting
        // one here wedges every verification run behind a dialog nothing
        // can dismiss the moment today's workout arms an HR ceiling. This
        // was the one call site `isQATokenLaunch` was introduced for; this
        // one was simply missed. A QA session renders real data and does
        // not need to actually deliver an HR-breach notification.
        #if DEBUG
        if !FaffApp.isQATokenLaunch {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        }
        #else
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        #endif

        let hrType = HKQuantityType(.heartRate)
        // P-1a: capture the completion handler and call it after the drain so iOS
        // does not throttle (then stop) background delivery for missed completions.
        // P-1b: bound the first flush to now so anchor==nil doesn't drain the
        // entire HR history — that caused a spurious ceiling alert off a historic
        // max and a memory spike equal to years of watch-wear HR samples.
        if anchor == nil {
            // Set a synthetic anchor at "now" so the first flush only sees
            // future samples. (The workout bound is applied in
            // `flushNewSamples`, where the workout list is actually known.)
            let startPred = HKQuery.predicateForSamples(withStart: Date(), end: nil, options: .strictStartDate)
            let primer: HKAnchoredObjectQuery = HKAnchoredObjectQuery(
                type: hrType, predicate: startPred, anchor: nil, limit: 0
            ) { [weak self] _, _, _, newAnchor, _ in
                Task { @MainActor [weak self] in self?.anchor = newAnchor }
            }
            store.execute(primer)
        }
        let q = HKObserverQuery(sampleType: hrType, predicate: nil) { [weak self] _, completionHandler, _ in
            Task { await self?.flushNewSamples(); completionHandler() }
        }
        store.execute(q)
        observerQuery = q
        observerActive = true
        // Background delivery requires com.apple.developer.healthkit.background-delivery
        // entitlement (missing from Faff.entitlements as of 2026-06-10 — add before
        // enabling this in prod). Called here so the plumbing is ready; foreground
        // delivery still works without the entitlement.
        store.enableBackgroundDelivery(for: hrType, frequency: .immediate) { _, _ in }
    }

    func stop() {
        observerActive = false
        breachStartedAt = nil
        if let q = observerQuery { store.stop(q); observerQuery = nil }
        store.disableBackgroundDelivery(for: HKQuantityType(.heartRate)) { _, _ in }
    }

    /// Samples produced while a workout was in flight, and no others.
    ///
    /// C-12 · both queries used `predicate: nil`, so every HR sample the watch
    /// ever wrote was a candidate — sitting at a desk, climbing stairs, asleep.
    /// An easy-run ceiling is a statement about RUNNING; 150 bpm on a staircase
    /// is not a breach of it. `HKQuery.predicateForObjectsFromWorkout` needs a
    /// specific workout, so this uses the equivalent that HealthKit exposes for
    /// "produced during any workout": a sample's own `workoutActivity` metadata
    /// is not queryable, so the bound is the workout SESSION window — the
    /// samples that fall inside a running workout the watch recorded.
    nonisolated private static func duringWorkoutPredicate(
        workouts: [HKWorkout]
    ) -> NSPredicate? {
        guard !workouts.isEmpty else { return nil }
        return NSCompoundPredicate(orPredicateWithSubpredicates: workouts.map {
            HKQuery.predicateForSamples(withStart: $0.startDate, end: $0.endDate, options: [])
        })
    }

    /// Running workouts that overlap the last hour. Empty when the runner is
    /// not running, which is the answer that switches this alarm off.
    private func recentRunningWorkouts() async -> [HKWorkout] {
        let since = Date().addingTimeInterval(-3600)
        let pred = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForWorkouts(with: .running),
            HKQuery.predicateForSamples(withStart: since, end: nil, options: []),
        ])
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(
                sampleType: .workoutType(), predicate: pred,
                limit: HKObjectQueryNoLimit, sortDescriptors: nil
            ) { _, samples, _ in
                cont.resume(returning: (samples as? [HKWorkout]) ?? [])
            }
            store.execute(q)
        }
    }

    /// Drain new HR samples since the anchor; when the ceiling is breached and
    /// STAYS breached, fire a local notification (respecting the cooldown).
    private func flushNewSamples() async {
        guard enabled, let ceiling = ceilingBpm, ceiling > 0 else { return }
        let hrType = HKQuantityType(.heartRate)
        let bpm = HKUnit.count().unitDivided(by: .minute())

        // C-12 defect 2 · no workout, no alarm. A ceiling is a statement about
        // running. Nothing to alarm about also resets the sustain clock.
        let workouts = await recentRunningWorkouts()
        guard let duringWorkout = Self.duringWorkoutPredicate(workouts: workouts) else {
            breachStartedAt = nil
            return
        }

        let snapshotAnchor = self.anchor

        let (newSamples, newAnchor): ([HKQuantitySample], HKQueryAnchor?) = await withCheckedContinuation { cont in
            let q = HKAnchoredObjectQuery(
                type: hrType, predicate: duringWorkout, anchor: snapshotAnchor, limit: HKObjectQueryNoLimit
            ) { _, samples, _, newAnchor, _ in
                cont.resume(returning: ((samples as? [HKQuantitySample]) ?? [], newAnchor))
            }
            store.execute(q)
        }
        self.anchor = newAnchor ?? self.anchor
        guard !newSamples.isEmpty else { return }

        // Find the highest sample in this batch.
        var peak: Double = 0
        for s in newSamples {
            let v = s.quantity.doubleValue(for: bpm)
            if v > peak { peak = v }
        }

        // C-12 defect 1 · the threshold IS the ceiling. It was `ceiling * 0.95`
        // under copy asserting the runner was above `ceiling` — at a 145
        // ceiling that alarmed at 138 and said he was over 145.
        guard peak > Double(ceiling) else {
            breachStartedAt = nil
            return
        }

        // C-12 defect 3 · sustained, not instantaneous. See `sustainSec`.
        let now = Date()
        let started = breachStartedAt ?? now
        breachStartedAt = started
        guard now.timeIntervalSince(started) >= sustainSec else { return }

        maybeFire(val: Int(peak.rounded()), ceiling: ceiling)
    }

    private func maybeFire(val: Int, ceiling: Int) {
        let now = Date()
        if let last = lastAlertAt, now.timeIntervalSince(last) < cooldownSec { return }
        lastAlertAt = now
        let content = UNMutableNotificationContent()
        content.title = "HR ceiling"
        // Rule 16 · the sentence states the reading and the ceiling as two
        // measured numbers. It used to assert "above your N ceiling" off a
        // comparison against 0.95 × N, which was a claim the trigger could not
        // support. Coach voice: no exclamation, no question mark, no hype.
        content.body  = "Heart rate \(val) against your \(ceiling) ceiling. Ease off."
        content.sound = .default
        let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}
