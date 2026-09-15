//
//  PhoneSyncStatusTests.swift
//  FaffWatch Watch AppTests
//
//  Finding F119 — PhoneSync's syncState/lastSyncError exist to warn a
//  runner their run didn't sync, but had zero UI readers (confirmed by
//  external review) and carried two compounding bugs of its own. This file
//  covers the two bugs; FinishSyncStatusTests.swift covers the 3-state UI
//  spec these bugs' fix is finally wired up to.
//
//  Deliberately does NOT call `PhoneSync.sendCompletion` anywhere: that
//  method fires live `WCSession.default.transferUserInfo` /
//  `.transferFile` calls, and this test host never calls
//  `PhoneSync.shared.activate()` — an unactivated `WCSession` is not a
//  state Apple's docs describe as safe to drive most session methods from.
//  Instead, every test below drives the exact same internal logic
//  `sendCompletion` and its delegate callbacks would exercise in
//  production (`enqueueDirect`, `handlePrimaryTransferResult`,
//  `handleDirectPostResult`), each pulled out into its own internal,
//  test-reachable method for exactly this reason (see F119's comments at
//  each call site in PhoneSync.swift).
//
//  `PhoneSync.shared` is a true singleton (no test-friendly initializer),
//  so every test restores whatever shared, mutable state it touched
//  (UserDefaults-backed pendingDirect, the static evictionLogger hook) via
//  `defer`, and the suite runs `.serialized` so two tests never interleave
//  on that shared state.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
@Suite(.serialized)
struct PhoneSyncStatusTests {

    // MARK: - Fixtures

    private func completion(id: String) -> WatchCompletion {
        WatchCompletion(
            workoutId: id,
            startedAt: "2026-09-14T06:00:00.000Z",
            completedAt: "2026-09-14T06:48:12.000Z",
            status: "completed",
            totalDistanceMi: 6.02,
            totalDurationSec: 2892,
            avgHr: 148,
            maxHr: 171,
            phases: []
        )
    }

    // MARK: - Bug 1 · the one-way state guard

    /// The exact defect: the primary transferUserInfo fails first
    /// (syncState → .failed), and the backup direct-POST then succeeds.
    /// Before the fix, `handleDirectPostResult`'s guard only matched
    /// `.sending`, so a success arriving after `.failed` never corrected
    /// anything — syncState stayed wrong forever. After the fix, a
    /// successful backup POST is unconditionally good news for this
    /// workoutId and corrects the state to `.sent` regardless of which
    /// non-terminal state it finds.
    @Test func backupSuccessAfterPrimaryFailureCorrectsToSent() {
        let sync = PhoneSync.shared
        sync.setSyncStateForTest(.sending)

        sync.handlePrimaryTransferResult(failed: true)
        #expect(sync.syncState == .failed("Transfer failed · uploading directly"))

        sync.handleDirectPostResult(id: "f119-guard-1", status: 200, failed: false)
        #expect(sync.syncState == .sent)
    }

    /// Sanity check on the other side of the same fix: a backup POST that
    /// has NOT succeeded (server error, no network) must not be read as
    /// "unconditionally good news" — `.failed` must survive it. Guards
    /// against a fix that over-corrects to `.sent` on every callback
    /// regardless of outcome.
    @Test func backupServerErrorLeavesFailedStateAlone() {
        let sync = PhoneSync.shared
        sync.setSyncStateForTest(.sending)
        sync.handlePrimaryTransferResult(failed: true)

        sync.handleDirectPostResult(id: "f119-guard-2", status: 500, failed: false)
        #expect(sync.syncState == .failed("Transfer failed · uploading directly"))
    }

    /// The ORIGINAL, already-working direction: primary transfer succeeds
    /// outright (no failure first). Confirms the fix didn't disturb the
    /// happy path the old guard already handled correctly.
    @Test func primarySuccessStillCorrectsToSent() {
        let sync = PhoneSync.shared
        sync.setSyncStateForTest(.sending)
        sync.handlePrimaryTransferResult(failed: false)
        #expect(sync.syncState == .sent)
    }

    // MARK: - Bug 2 · silent retry-queue eviction now logs

    /// Fills `pendingDirect` past its 50-entry cap and asserts the
    /// eviction logger actually FIRED — not just that the queue still caps
    /// at 50 (which the pre-fix code already did silently). Asserts the
    /// evicted entry's workoutId appears in the message: the queue is
    /// FIFO (`removeFirst`), so the very first completion enqueued
    /// ("f119-evict-0") is the one that must be evicted, and the log line
    /// is the ONLY surviving trace that its direct-POST backup was lost.
    @Test func evictionPastCapLogsBeforeDropping() throws {
        let pendingKey = "faff.watch.pendingDirect.v1"
        let originalQueue = UserDefaults.standard.array(forKey: pendingKey)
        let originalLogger = PhoneSync.evictionLogger
        defer {
            if let originalQueue {
                UserDefaults.standard.set(originalQueue, forKey: pendingKey)
            } else {
                UserDefaults.standard.removeObject(forKey: pendingKey)
            }
            PhoneSync.evictionLogger = originalLogger
        }
        UserDefaults.standard.removeObject(forKey: pendingKey)

        var logged: [String] = []
        PhoneSync.evictionLogger = { logged.append($0) }

        let sync = PhoneSync.shared
        for i in 0..<51 {
            let data = try JSONEncoder().encode(completion(id: "f119-evict-\(i)"))
            sync.enqueueDirect(data)
        }

        // Exactly one eviction: 51 enqueues over a 50 cap evicts exactly
        // the single oldest entry, once.
        #expect(logged.count == 1)
        #expect(logged.first?.contains("f119-evict-0") == true)
        #expect((UserDefaults.standard.array(forKey: pendingKey) as? [Data])?.count == 50)
    }

    /// Staying at or under the cap must log nothing — the log exists for a
    /// genuine loss event, not every enqueue.
    @Test func noEvictionNoLog() throws {
        let pendingKey = "faff.watch.pendingDirect.v1"
        let originalQueue = UserDefaults.standard.array(forKey: pendingKey)
        let originalLogger = PhoneSync.evictionLogger
        defer {
            if let originalQueue {
                UserDefaults.standard.set(originalQueue, forKey: pendingKey)
            } else {
                UserDefaults.standard.removeObject(forKey: pendingKey)
            }
            PhoneSync.evictionLogger = originalLogger
        }
        UserDefaults.standard.removeObject(forKey: pendingKey)

        var logged: [String] = []
        PhoneSync.evictionLogger = { logged.append($0) }

        let sync = PhoneSync.shared
        for i in 0..<50 {
            let data = try JSONEncoder().encode(completion(id: "f119-noevict-\(i)"))
            sync.enqueueDirect(data)
        }

        #expect(logged.isEmpty)
    }
}
