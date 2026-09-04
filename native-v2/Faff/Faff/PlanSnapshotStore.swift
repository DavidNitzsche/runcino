//
//  PlanSnapshotStore.swift
//  PLANSNAPSHOT-1 · the ONE locally persisted, versioned copy of the
//  runner's whole authored block, and the only thing Today/the week strip
//  are allowed to read for date navigation.
//

import Foundation
//  ── THE CONTRACT ────────────────────────────────────────────────────────
//
//  - One file on disk, not a per-date/per-week key sprawl (the shape
//    TODAYPERSIST-1/RETENTION-1 used, and what this replaces for
//    navigation reads — see PLANSNAPSHOT-1's own handback for why a
//    sliding LRU window fails the "every date, offline" acceptance test a
//    full-block snapshot does not).
//  - Atomic replacement: a new snapshot is validated FIRST, in memory, and
//    only written to disk if validation passes. `current` (the in-memory
//    copy every read goes through) is swapped in the SAME step as the
//    disk write — never before, never separately — so a reader can never
//    observe a `current` that disagrees with what is actually on disk.
//  - A failed decode, a failed validation, a cancelled request, or a
//    partial download never reaches `commit(rawData:)` far enough to
//    touch either `current` or the file — see `TodayHostV5`'s sync
//    coordinator for where a cancelled/failed fetch is caught before it
//    ever calls this type.
//  - `loadFromDiskSynchronously()` is the cold-launch path — synchronous,
//    on the main thread, before the first `await`, mirroring
//    `TodayHostV5.seedCachesFromDisk()`'s existing contract for exactly
//    the same reason: the first frame must be able to paint from local
//    storage with no Task hop.
//
final class PlanSnapshotStore {
    static let shared = PlanSnapshotStore()

    enum SyncState: Equatable {
        case idle
        case syncing
        case failed(String)
    }

    enum CommitError: Error, Equatable {
        case decodeFailed(String)
        case invalidShape(String)
    }

    /// The in-memory copy every reader (Today, the week strip) actually
    /// reads. Never mutated in place — always REPLACED, as one atomic
    /// assignment, by `commit(rawData:)` or `loadFromDiskSynchronously()`.
    private(set) var current: PlanSnapshot?
    private(set) var lastSuccessfulSyncAt: Date?
    private(set) var lastError: String?
    private(set) var syncState: SyncState = .idle
    /// STAGE1-DIAG-1's sibling for sync — bumped on every commit attempt
    /// (successful or not), so the diagnostics sheet can show "which sync
    /// attempt is this" the same way `RequestDiagnosticsLog` shows which
    /// navigation generation a request belonged to.
    private(set) var syncGeneration: Int = 0

    private let fileURL: URL
    private let tmpURL: URL

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        // Directory may not exist on first launch — ok to fail silently
        // here; the write path below surfaces any real problem.
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("plan_snapshot.v1.json")
        tmpURL = dir.appendingPathComponent("plan_snapshot.v1.json.tmp")
    }

    #if DEBUG
    /// Test-only: a fresh store pointed at an isolated temp file, so tests
    /// never touch the real app's on-disk snapshot or share state with
    /// each other.
    init(testDirectory: URL) {
        try? FileManager.default.createDirectory(at: testDirectory, withIntermediateDirectories: true)
        fileURL = testDirectory.appendingPathComponent("plan_snapshot.v1.json")
        tmpURL = testDirectory.appendingPathComponent("plan_snapshot.v1.json.tmp")
    }
    #endif

    // MARK: - Cold launch

    /// Synchronous, disk-only. Call once, before the first `await`, exactly
    /// as `TodayHostV5.seedCachesFromDisk()` already does for the dated
    /// day/week cache. A missing or corrupt file is a quiet miss, not an
    /// error — `current` simply stays nil, and the empty/error state this
    /// task's brief requires is what the UI shows for "no plan has ever
    /// synced," not a crash or a stale-looking blank screen.
    func loadFromDiskSynchronously() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        guard let decoded = try? JSONDecoder().decode(PlanSnapshot.self, from: data) else {
            // A file that exists but no longer decodes (a schema change,
            // a truncated write from a killed process) must not crash the
            // launch and must not silently pretend to be empty forever —
            // remove it so the NEXT sync gets a clean slate rather than
            // permanently failing to decode on every launch.
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        current = decoded
    }

    // MARK: - Commit (the only way `current`/disk change after launch)

    /// Validate `rawData` and, only if it passes, replace `current` and the
    /// on-disk file atomically. Returns the committed snapshot on success.
    /// On failure, `current` and the file are UNTOUCHED — the caller still
    /// has whatever was valid before this call, per the brief's own rule:
    /// "a failed, cancelled, partial, or malformed sync cannot damage it."
    @discardableResult
    func commit(rawData: Data) -> Result<PlanSnapshot, CommitError> {
        syncGeneration += 1
        let decoded: PlanSnapshot
        do {
            decoded = try JSONDecoder().decode(PlanSnapshot.self, from: rawData)
        } catch {
            let msg = String(describing: error).prefix(300).description
            lastError = msg
            syncState = .failed(msg)
            return .failure(.decodeFailed(msg))
        }
        if let invalid = Self.validationFailureReason(decoded) {
            lastError = invalid
            syncState = .failed(invalid)
            return .failure(.invalidShape(invalid))
        }
        do {
            try Self.writeAtomically(rawData, to: fileURL, tmp: tmpURL)
        } catch {
            let msg = "disk write failed: \(error)"
            lastError = msg
            syncState = .failed(msg)
            return .failure(.invalidShape(msg))
        }
        current = decoded
        lastSuccessfulSyncAt = Date()
        lastError = nil
        syncState = .idle
        return .success(decoded)
    }

    /// A snapshot is well-formed in exactly two shapes: a real plan (id,
    /// version and both bounds all present, at least one day) or an honest
    /// "no active plan" response (`message` present, no bounds, no days).
    /// Anything else — bounds without days, days without bounds, an empty
    /// `today_iso` — is malformed and must be refused, per Rule 11: a
    /// missing input must never silently pass as valid.
    static func validationFailureReason(_ snapshot: PlanSnapshot) -> String? {
        if snapshot.today_iso.isEmpty { return "empty today_iso" }
        let hasPlanIdentity = snapshot.plan_id != nil && snapshot.plan_version != nil
        let hasBounds = snapshot.plan_start_iso != nil && snapshot.plan_end_iso != nil
        if snapshot.message != nil {
            // The honest "no active plan" shape. Days must be empty — a
            // message alongside real days would be a self-contradicting
            // response, not a refusal.
            return snapshot.days.isEmpty ? nil : "message present but days is non-empty"
        }
        if !hasPlanIdentity { return "missing plan_id/plan_version with no message" }
        if !hasBounds { return "missing plan_start_iso/plan_end_iso with no message" }
        if snapshot.days.isEmpty { return "a real plan with zero days" }
        if let start = snapshot.plan_start_iso, let end = snapshot.plan_end_iso, start > end {
            return "plan_start_iso (\(start)) after plan_end_iso (\(end))"
        }
        return nil
    }

    /// Write-to-temp-then-replace. `FileManager.replaceItemAt` is the
    /// Darwin primitive for exactly this — it either fully lands the new
    /// content at `dest` or leaves `dest` exactly as it was; there is no
    /// observable partial-write state a concurrent reader of `dest` could
    /// see. `current` is only updated by the CALLER after this returns
    /// successfully, so an in-memory reader and a disk reader can never
    /// disagree about which snapshot is live.
    private static func writeAtomically(_ data: Data, to dest: URL, tmp: URL) throws {
        try data.write(to: tmp, options: .atomic)
        if FileManager.default.fileExists(atPath: dest.path) {
            _ = try FileManager.default.replaceItemAt(dest, withItemAt: tmp)
        } else {
            try FileManager.default.moveItem(at: tmp, to: dest)
        }
    }

    // MARK: - State the sync coordinator drives directly

    func markSyncing() {
        syncState = .syncing
    }

    /// Called by the sync coordinator when a fetch itself failed before
    /// ever reaching `commit` (a transport error, a cancellation that
    /// should NOT be read as a sync failure, a non-2xx status). Distinct
    /// from `commit`'s own failure path so a caller can choose not to call
    /// this for a routine cancellation — see `TodayHostV5`'s sync
    /// coordinator for that distinction.
    func markSyncFailed(_ reason: String) {
        syncGeneration += 1
        lastError = reason
        syncState = .failed(reason)
    }

    #if DEBUG
    /// Test-only escape hatch for exercising "no snapshot has ever synced"
    /// without touching the real file.
    func resetForTesting() {
        current = nil
        lastSuccessfulSyncAt = nil
        lastError = nil
        syncState = .idle
        syncGeneration = 0
        try? FileManager.default.removeItem(at: fileURL)
    }
    #endif
}
