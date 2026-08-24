//
//  FaffWidgetSnapshot.swift
//  FaffWatch Widgets
//
//  What the complications and the Smart Stack widget read, and the only
//  thing they read.
//
//  SOURCE OF TRUTH — see WatchThemeV5.swift's header.
//    README.md § "Screens · 9 · Before the app opens"
//    Faff-Watch-App.dc.html, boards: Complications · Smart Stack
//    design_handoff_0821_addendum README § "3 · Watch · before there is a
//    session" — the three degraded states and how each is drawn.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY A SNAPSHOT AND NOT THE APP'S OWN STATE
//
//  A widget process is not the app process. It is woken by WidgetKit,
//  minutes or hours after the app last ran, with no WatchConnectivity
//  session, no network and no `PhoneSync.shared`. Anything it cannot read
//  from disk in a few milliseconds it cannot draw — and the one thing the
//  design forbids it to draw is a spinner (rule 13). So the app writes a
//  flat, pre-formatted snapshot into the shared App Group and the widget
//  only ever reads.
//
//  PRE-FORMATTED, deliberately. `lede` and `dose` are the strings the lobby
//  already renders, not miles and seconds the widget would have to re-derive.
//  The runner's distance unit (`unitsDistance` on the wire) lives on the
//  phone side of that formatting; a widget that re-derived it would be a
//  second place for the units audit to regress.
//
//  This file is compiled into BOTH targets — the widget extension reads it,
//  the watch app writes it. It holds no design tokens and imports no SwiftUI
//  on purpose, so it can sit in the app target without dragging the widget's
//  view layer in with it.
//  ─────────────────────────────────────────────────────────────────────────
//

import Foundation
import WidgetKit

// MARK: - The snapshot

/// One session, flattened to what a face-sized surface can hold.
///
/// Everything optional is an ABSENT REGISTER, not an empty one — the same
/// contract `V5LobbySession` carries on the lobby. A rest day has a `lede`
/// and no `dose`, and the complication drops the register rather than
/// drawing a dash in it.
struct FaffSessionSnapshot: Codable, Equatable {

    /// Schema version. A widget built against v1 that finds v2 on disk shows
    /// the no-plan board rather than mis-reading fields — a wrong dose on a
    /// wrist is worse than no dose.
    static let currentSchema = 1
    let schema: Int

    /// The local day the session was prescribed FOR, as `yyyy-MM-dd`. This
    /// is what staleness is measured against, not `writtenAt`: a plan written
    /// last night for this morning is fresh, and a plan written an hour ago
    /// for last Tuesday is not.
    let sessionDay: String

    /// When the app last wrote this. Carried for diagnostics and for the
    /// "no phone contact since" half of the addendum's stale board. Not the
    /// staleness clock.
    let writtenAt: Date

    /// The day-state ramp, by the class the wire already carries
    /// (`SessionClass` in lib/watch/build-workout.ts). Fed straight to
    /// `WatchV5.DayState.forSession`, so the widget's ramp cannot drift from
    /// the lobby's. Known values: easy · quality · long · race · rest · none.
    let ramp: String

    /// The display word. `nil` where there is no session type to name — the
    /// No-session board carries no lede by design and inventing one is the
    /// failure that board exists to avoid.
    let lede: String?

    /// The dose, in the value register, already formatted. Single line here:
    /// the lobby's two-line formula dose does not fit a complication, and the
    /// content rule is that the dose is what goes when space runs out, not
    /// that it wraps.
    let dose: String?

    /// The workout this describes. Not drawn. It is here so a future writer
    /// can tell "the same session, rewritten" from "a different session"
    /// without diffing strings.
    let workoutId: String?

    init(sessionDay: String,
         writtenAt: Date = Date(),
         ramp: String,
         lede: String?,
         dose: String?,
         workoutId: String? = nil) {
        self.schema = FaffSessionSnapshot.currentSchema
        self.sessionDay = sessionDay
        self.writtenAt = writtenAt
        self.ramp = ramp
        self.lede = lede
        self.dose = dose
        self.workoutId = workoutId
    }

    /// Everything except `writtenAt`. The write guard compares on THIS, not
    /// on `==`: `writtenAt` moves on every push, so an `==` guard would
    /// never fire and every WCSession message would spend a reload.
    func sameContent(as other: FaffSessionSnapshot) -> Bool {
        schema == other.schema
            && sessionDay == other.sessionDay
            && ramp == other.ramp
            && lede == other.lede
            && dose == other.dose
            && workoutId == other.workoutId
    }
}

// MARK: - The three states

/// What the widget actually has, and the reason it has three cases rather
/// than one optional.
///
/// "No session", "a session too old to trust" and "nothing has ever arrived"
/// are three different sentences and the design draws three different boards
/// for them (addendum § 3). Collapsing them into `FaffSessionSnapshot?` is
/// how a nine-day-old prescription gets drawn as today's, or how a first
/// launch gets drawn as a bug. **None of the three is a spinner and none of
/// them is a placeholder** — rule 13, and the handoff's standing instruction
/// that a value which is not available drops out rather than being faked.
enum FaffWidgetState: Equatable {

    /// A snapshot written for today. Draw it plainly.
    case current(FaffSessionSnapshot)

    /// A snapshot written for an earlier day, with no fresher one since.
    /// The prescription is STILL DRAWN, at 48% — hiding it would be
    /// pretending we do not have it — under an age kicker that says how old
    /// it is. Amber where amber is allowed; on a watch face nothing is
    /// coloured (rule 12) so the kicker steps in opacity instead.
    case stale(FaffSessionSnapshot, daysOld: Int)

    /// Nothing has ever been written, or what is on disk is a schema this
    /// build cannot read. The whole of onboarding on the wrist: the plan is
    /// made on the phone and this app is a receiver, so the board says that
    /// and stops.
    case noPlan
}

// MARK: - The store

/// The App Group shelf. Read by the widget extension, written by the watch
/// app.
///
/// `group.run.faff.app` is the group both existing targets already declare —
/// see `FaffWatch Watch App.entitlements` and `Faff.entitlements`. The widget
/// extension declares the same one and nothing new is provisioned.
enum FaffWidgetStore {

    static let appGroup = "group.run.faff.app"

    /// Versioned in the key as well as in the payload. A future writer that
    /// changes shape takes a new key and leaves this one alone, so a widget
    /// from an older install keeps reading something it understands until it
    /// is replaced.
    static let key = "widget.session.v1"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    /// `yyyy-MM-dd` in the runner's own calendar. The widget and the app must
    /// agree on what "today" is, so both go through here.
    ///
    /// POSIX locale on purpose: a device set to a non-Gregorian calendar or a
    /// locale with its own numerals would otherwise write a string that does
    /// not compare against the one the other process wrote.
    static func dayString(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    // ── Read ──

    /// The raw snapshot on disk, or nil. Decode failure reads as nil: a
    /// payload this build cannot parse is not a session, and the no-plan
    /// board is the honest answer to "we do not have one".
    static func read() -> FaffSessionSnapshot? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        guard let snap = try? JSONDecoder().decode(FaffSessionSnapshot.self, from: data) else {
            return nil
        }
        guard snap.schema == FaffSessionSnapshot.currentSchema else { return nil }
        return snap
    }

    /// The snapshot resolved against a clock. This is the whole degradation
    /// ladder, in one place, so the three views cannot disagree about which
    /// state they are in.
    static func state(now: Date = Date(), calendar: Calendar = .current) -> FaffWidgetState {
        guard let snap = read() else { return .noPlan }

        let today = dayString(now, calendar: calendar)
        if snap.sessionDay == today { return .current(snap) }

        // A day in the future is a clock the runner has moved, or a plan
        // written just before midnight in another zone. Not stale — there is
        // nothing old about it, so it draws plainly.
        if snap.sessionDay > today { return .current(snap) }

        return .stale(snap, daysOld: daysBetween(snap.sessionDay, and: today, calendar: calendar))
    }

    /// Whole days between two `yyyy-MM-dd` strings. Falls back to 1 rather
    /// than 0 if either fails to parse — an unparseable date is not evidence
    /// of freshness.
    static func daysBetween(_ from: String, and to: String, calendar: Calendar = .current) -> Int {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        guard let a = f.date(from: from), let b = f.date(from: to) else { return 1 }
        let days = calendar.dateComponents([.day], from: a, to: b).day ?? 1
        return max(1, days)
    }

    // ── Write ──

    /// Called by the watch app whenever the session it holds changes.
    ///
    /// Writing an IDENTICAL snapshot is a no-op that skips the timeline
    /// reload: WidgetKit's reload budget on watchOS is small and finite, and
    /// spending it on a re-push of the same session is how a widget runs out
    /// of budget before the session that actually matters arrives.
    static func write(_ snapshot: FaffSessionSnapshot) {
        guard let defaults else { return }
        if let existing = read(), existing.sameContent(as: snapshot) { return }
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: key)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Explicit destruction, for sign-out. Deliberately separate from
    /// `write` — the default path always preserves, and clearing the shelf
    /// takes a purpose-built call (project Rule 6's shape, applied to a much
    /// smaller shelf).
    static func clear() {
        defaults?.removeObject(forKey: key)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

// ─────────────────────────────────────────────────────────────────────────
// CLOSED. The watch app writes this snapshot.
//
// `PhoneSync.writeWidgetSnapshot(workout:message:glance:replayed:)` is
// implemented and called from both branches of `apply(_:)` — the resolved
// session and the no-session-with-a-reason path — and a decode failure still
// writes nothing, so the shelf keeps its last good snapshot and ages honestly
// rather than being cleared to a no-plan board.
//
// This note used to describe the call site as outstanding. It was closed and
// the note was not, which is worse than no note: it sends the next person to
// build something that already exists, and it did.

