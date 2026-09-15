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
    // CORRELATIONID-1 · the same id sent as `x-faff-correlation-id` on the
    // wire (see `authedSend`) and read back by `middleware.ts`/
    // `lib/observability/*` server-side. This is the whole point of this
    // field: it lets a specific row in this on-device log be matched to a
    // specific row in the server's `request_failures` table (once migration
    // 170 is applied — see that migration's own header) or a specific
    // Railway log line, closing the gap F156/F159 named — every incident
    // tonight had to work from disconnected, point-in-time evidence because
    // nothing tied a device request to a server log line.
    let correlationId: String
    // CLIENTREPORT-1 · carried so `finish()` can name the method on a
    // self-report to `/api/observability/client-report` without threading
    // a second parameter through it.
    let httpMethod: String
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

    // STAGE0-REPORTBATCH-1 (2026-09-15, backend-architecture-brief Stage 0)
    // · the brief's own words on client failure reporting: "Reporting must
    // be batched and must never create another refresh storm." Before this,
    // every `.timeout`/`.transportError` outcome fired its own immediate
    // POST — during a real burst (F162's repro: ~12 requests failing
    // together) that is ~12 simultaneous self-reports, which is exactly the
    // shape the brief is warning against, even though this endpoint does
    // one cheap INSERT and the practical load is trivial next to what
    // caused the original incident. At most one report leaves the device
    // per window; anything else in that window is folded into the next
    // report's own `suppressedCount` rather than sent separately.
    private var lastReportSentAt: Date?
    private var suppressedSinceLastReport = 0
    private static let reportWindowSec: TimeInterval = 5

    /// Called at the moment a request is actually handed to URLSession.
    /// Returns the generation id the caller must pass back to `finish`.
    func begin(endpoint: String, dateParam: String?, correlationId: String, httpMethod: String) -> Int {
        let gen = nextGeneration
        nextGeneration += 1
        entries.append(RequestDiagnosticEntry(id: gen, endpoint: endpoint, dateParam: dateParam,
                                               correlationId: correlationId, httpMethod: httpMethod,
                                               startedAt: Date(), finishedAt: nil, outcome: nil))
        if entries.count > cap { entries.removeFirst(entries.count - cap) }
        return gen
    }

    /// CLIENTREPORT-1 · `.timeout`/`.transportError` are the two shapes
    /// `/api/observability/client-report`'s own header names as the true
    /// EDGE case — "something failed before the app even received the
    /// request" — which by definition NOTHING server-side can ever
    /// observe on its own. F162 confirmed this gap live: the correlation
    /// id existed only on-device, in this exact log, with no path off the
    /// phone. At most one report actually leaves the device per
    /// `reportWindowSec` (STAGE0-REPORTBATCH-1) — a burst of many
    /// failures together (the exact shape of F162's own repro) folds into
    /// one report plus a suppressed count, never one POST per failure.
    /// The one that does fire is sent fire-and-forget, off the actor
    /// (`Task.detached`), so a flaky network reporting its own flakiness
    /// can never slow down or block the diagnostics log itself — the same
    /// "observability must not be the thing that makes it worse"
    /// discipline `outage()` was just given server-side.
    func finish(_ generation: Int, outcome: RequestOutcome) {
        guard let idx = entries.firstIndex(where: { $0.id == generation }) else { return }
        entries[idx].finishedAt = Date()
        entries[idx].outcome = outcome

        if let kind = Self.clientReportKind(for: outcome) {
            let now = Date()
            guard Self.shouldSendReport(now: now, lastSentAt: lastReportSentAt, window: Self.reportWindowSec) else {
                // Inside the window since the last report actually sent —
                // fold this one in as a suppressed count rather than firing
                // a second request. Still a real, observable fact (visible
                // in the next report's own body), just not a second POST.
                suppressedSinceLastReport += 1
                return
            }
            let entry = entries[idx]
            let suppressed = suppressedSinceLastReport
            lastReportSentAt = now
            suppressedSinceLastReport = 0
            Task.detached(priority: .background) {
                await Self.reportToServer(entry: entry, kind: kind, suppressedCount: suppressed)
            }
        }
    }

    /// For a decode failure, which happens one layer above `authedSend` and
    /// after that request's own entry has already recorded a 2xx success —
    /// recorded as its own standalone entry rather than mutating the
    /// already-finished one, so the log shows both "the transport succeeded"
    /// and "the decode did not" as the two separate facts they are.
    func recordDecodeFailure(endpoint: String, dateParam: String?, correlationId: String, httpMethod: String, error: Error) {
        let gen = nextGeneration
        nextGeneration += 1
        var entry = RequestDiagnosticEntry(id: gen, endpoint: endpoint, dateParam: dateParam,
                                            correlationId: correlationId, httpMethod: httpMethod,
                                            startedAt: Date(), finishedAt: nil, outcome: nil)
        entry.finishedAt = entry.startedAt
        entry.outcome = .decodingError(String(describing: error).prefix(200).description)
        entries.append(entry)
        if entries.count > cap { entries.removeFirst(entries.count - cap) }
        // Not a client-report candidate: the transport succeeded (this is
        // recorded only after a 2xx), so there is nothing EDGE about it —
        // `clientReportKind(for:)` correctly returns nil for `.decodingError`.
    }

    func snapshot() -> [RequestDiagnosticEntry] {
        entries.reversed() // most recent first
    }

    func clear() { entries.removeAll() }

    /// `.timeout`/`.transportError` are the only two shapes worth a
    /// self-report — see `finish()`'s own comment. `.cancelled` is routine
    /// (a superseded navigation, not a failure); `.httpError` and
    /// `.decodingError` both mean the transport actually succeeded, so
    /// there is a real response and nothing EDGE-shaped happened.
    /// Internal, not private, for the same reason `isCancellation`/
    /// `isStuckConnectionSignal` are in API.swift: the mapping IS the fix,
    /// and it should be directly testable rather than provable only by
    /// triggering a real network failure.
    static func clientReportKind(for outcome: RequestOutcome) -> String? {
        switch outcome {
        case .timeout: return "no_response"
        case .transportError: return "network_error"
        case .success, .httpError, .cancelled, .decodingError: return nil
        }
    }

    /// STAGE0-REPORTBATCH-1 · the whole batching decision, extracted as a
    /// pure input-to-output function for the same reason `clientReportKind`
    /// is: directly testable with fixed timestamps, rather than provable
    /// only by racing real `Date()` calls against a real 5-second wall-clock
    /// wait in a test. `nil` (never sent before) always sends.
    static func shouldSendReport(now: Date, lastSentAt: Date?, window: TimeInterval) -> Bool {
        guard let lastSentAt else { return true }
        return now.timeIntervalSince(lastSentAt) >= window
    }

    /// Static, not an actor method — this runs off a `Task.detached`, after
    /// the entry has already been captured as a value, so it needs no
    /// actor isolation and cannot race or block the log itself.
    ///
    /// Deliberately does not go through `API.authedSend`/`authedGET`: this
    /// call is ABOUT a request that may have failed at the transport level,
    /// so it must not be recorded in this same diagnostics log (that would
    /// be self-referential noise) and must not inherit `authedSend`'s own
    /// 401-handling/session-expiry side effects. A short, bare, best-effort
    /// POST — never retried, never surfaced to the runner, never throws
    /// upward. Silence on failure is correct here: this is itself a report
    /// about a flaky network, so failing to file it is not a new fact worth
    /// interrupting anything for.
    private static func reportToServer(entry: RequestDiagnosticEntry, kind: String, suppressedCount: Int) async {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/observability/client-report"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 5

        // Best-effort attribution only — the endpoint itself does not
        // require a valid session (see its own header), so an unreadable
        // token here must not stop the report from going out.
        TokenStore.shared.authorize(&req)

        var body: [String: Any] = [
            "correlationId": entry.correlationId,
            "routePath": entry.endpoint,
            "httpMethod": entry.httpMethod,
            "kind": kind,
        ]
        if let durationMs = entry.durationMs {
            body["observedDurationMs"] = durationMs
        }
        if suppressedCount > 0 {
            body["suppressedCount"] = suppressedCount
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        req.httpBody = data

        _ = try? await URLSession.shared.data(for: req)
    }
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
