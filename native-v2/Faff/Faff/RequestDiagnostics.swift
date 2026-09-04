//
//  RequestDiagnostics.swift
//  STAGE1-DIAG-1 · a lightweight, in-memory request-lifecycle recorder for
//  this validation build.
//
//  Why this exists: CANCELBANNER-1 was diagnosed from a physical-device
//  report ("repeatedly can't reach faff", "data over an hour old") that had
//  to be reconstructed after the fact, entirely from reading code — nothing
//  in the app could say which request, for which date, failed which way, or
//  whether it was ever sent at all. This closes that gap for the next
//  report: every authenticated request records its endpoint, the `date`
//  query param if present, a monotonic generation number (so a superseded
//  request and the one that replaced it are visibly distinguishable in
//  order), start/finish times, and exactly one of: success, cancellation,
//  timeout, a transport error, an HTTP error status, or (recorded
//  separately, from the decode call site) a decoding failure.
//
//  Internal only. Never surfaced in the runner-facing interface directly —
//  reachable only via the hidden diagnostics sheet in Settings (seven taps
//  on the version/build footer). Not persisted; a debugging aid, not a log
//  product, so it resets on relaunch and is capped in memory.
//

import Foundation

enum RequestOutcome: Equatable {
    case success(status: Int)
    case httpError(status: Int)
    case cancelled
    case timeout
    case transportError(String)
    case decodingError(String)

    var label: String {
        switch self {
        case .success(let status): return "OK \(status)"
        case .httpError(let status): return "HTTP \(status)"
        case .cancelled: return "cancelled"
        case .timeout: return "timeout"
        case .transportError(let msg): return "transport: \(msg)"
        case .decodingError(let msg): return "decode: \(msg)"
        }
    }

    /// True for the shapes that should read as a genuine problem in the
    /// diagnostics list, as opposed to routine cancellation or a normal
    /// 2xx/401 (401 is handled separately by the session-expiry flow, not
    /// logged here as an "error" shape).
    var isNotable: Bool {
        switch self {
        case .success, .cancelled: return false
        case .httpError, .timeout, .transportError, .decodingError: return true
        }
    }
}

struct RequestDiagnosticEntry: Identifiable, Equatable {
    let id: Int // generation, assigned at send time, monotonic for the process lifetime
    let endpoint: String // path only — no host, no query string, nothing that could carry a token
    let dateParam: String?
    let startedAt: Date
    var finishedAt: Date?
    var outcome: RequestOutcome?

    var durationMs: Int? {
        guard let finishedAt else { return nil }
        return Int(finishedAt.timeIntervalSince(startedAt) * 1000)
    }
}

/// Actor-isolated so concurrent requests (prefetch fires several in
/// parallel) can't race the ring buffer. Capped — this is a rolling window
/// for "what just happened," not a persisted audit trail.
actor RequestDiagnosticsLog {
    static let shared = RequestDiagnosticsLog()

    private var entries: [RequestDiagnosticEntry] = []
    private var nextGeneration = 1
    private let cap = 300

    /// Called at the moment a request is actually handed to URLSession.
    /// Returns the generation id the caller must pass back to `finish`.
    func begin(endpoint: String, dateParam: String?) -> Int {
        let gen = nextGeneration
        nextGeneration += 1
        entries.append(RequestDiagnosticEntry(id: gen, endpoint: endpoint, dateParam: dateParam,
                                               startedAt: Date(), finishedAt: nil, outcome: nil))
        if entries.count > cap { entries.removeFirst(entries.count - cap) }
        return gen
    }

    func finish(_ generation: Int, outcome: RequestOutcome) {
        guard let idx = entries.firstIndex(where: { $0.id == generation }) else { return }
        entries[idx].finishedAt = Date()
        entries[idx].outcome = outcome
    }

    /// For a decode failure, which happens one layer above `authedSend` and
    /// after that request's own entry has already recorded a 2xx success —
    /// recorded as its own standalone entry rather than mutating the
    /// already-finished one, so the log shows both "the transport succeeded"
    /// and "the decode did not" as the two separate facts they are.
    func recordDecodeFailure(endpoint: String, dateParam: String?, error: Error) {
        let gen = nextGeneration
        nextGeneration += 1
        var entry = RequestDiagnosticEntry(id: gen, endpoint: endpoint, dateParam: dateParam,
                                            startedAt: Date(), finishedAt: nil, outcome: nil)
        entry.finishedAt = entry.startedAt
        entry.outcome = .decodingError(String(describing: error).prefix(200).description)
        entries.append(entry)
        if entries.count > cap { entries.removeFirst(entries.count - cap) }
    }

    func snapshot() -> [RequestDiagnosticEntry] {
        entries.reversed() // most recent first
    }

    func clear() { entries.removeAll() }
}

extension URL {
    /// The `date=` query value, if present — pulled once at the diagnostics
    /// recording site rather than threaded as a separate parameter through
    /// every fetch function's signature.
    var faffDiagnosticDateParam: String? {
        URLComponents(url: self, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "date" })?.value
    }
}
