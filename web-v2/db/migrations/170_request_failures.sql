-- 170_request_failures.sql
--
-- ══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED TO PRODUCTION. APPLIED AND EXERCISED ON A LOCAL SCRATCH DB
-- (`faff_observability_scratch`, loopback, created for the purpose) — see
-- `web-v2/lib/observability/_observability_falsification.test.ts` for the
-- falsification run against it. This migration AWAITS DAVID'S EXPLICIT
-- PER-STATEMENT DDL GO before it is run against Railway, per CLAUDE.md's
-- "Operational vs decision vs external" section (DDL/data writes require a
-- separate explicit go, distinct from code-change approval) and per the
-- precedent 166_plan_decision_ledger.sql already set for this exact posture.
-- It does not touch, reorder, or renumber migration 166 or its packet.
-- ══════════════════════════════════════════════════════════════════════════
--
-- THE DURABLE 5XX / TIMEOUT LOG. Backs the bounded, non-destructive
-- production-observability work David asked for against the real,
-- unresolved 502/~13-second-timeout incident: "no durable, queryable log of
-- 5xx/timeout events that would let anyone diagnose the NEXT occurrence."
--
-- ── WHY A NEW TABLE, NOT `ops_alerts` ────────────────────────────────────
--
-- `ops_alerts` (lib/ops/alerts.ts) already exists and is the right shape for
-- a discrete named event ("this cron ran stale", "this deploy's plan
-- convergence check failed") — one row per event, a kind/severity/message,
-- webhook dispatch on write. A 5xx is a different shape of fact: one row per
-- REQUEST, correlated by a threaded id, carrying route path, http method,
-- duration and a failure-CLASS taxonomy (edge / application / database-pool
-- / upstream / client-timeout) that `ops_alerts`'s free-text `kind` enum was
-- never designed to hold with the discipline Rule 11 demands here — the
-- whole point of this table is that a query can `GROUP BY failure_class` and
-- get an honest count, not grep free text. This table is written by request
-- volume (every 5xx/timeout, not every "something an operator should read"),
-- so it deliberately does NOT dispatch to the `ops_alerts` Slack webhook per
-- row — that would be alert fatigue on the very incident class this exists
-- to make legible. `lib/observability/record.ts`'s header states this
-- decision; a future aggregate staleness-style alert (Rule 23's shape) is
-- named there as a follow-up, not built here, to keep this change bounded.
--
-- ── WHAT NEVER GOES IN THIS TABLE (David's explicit instruction) ──────────
--
-- No secrets, auth tokens/session data, HealthKit/health payloads, or
-- unnecessary personal data. `error_message` and `error_stack` are written
-- through `lib/observability/sanitize.ts` before this INSERT ever runs —
-- redacted of bearer tokens, JWT-shaped strings, connection strings and
-- email addresses, and length-capped. `metadata` is a small sanitized jsonb
-- bag (call-site detail like a Postgres SQLSTATE or an upstream service
-- name), never a raw request/response body. `user_uuid` is the same
-- structured id already used throughout this schema (Rule 14's population
-- column), not a name or email.
--
-- ── CORRELATION ID IS THE SPINE ────────────────────────────────────────────
--
-- `correlation_id` is generated at the earliest point in-app — `middleware.ts`
-- (edge runtime, first Next.js code that runs for every `/api/*` request) —
-- or reused from an `x-faff-correlation-id` header the CLIENT already set
-- before sending. Reusing rather than re-minting is deliberate: a true EDGE
-- failure (something failed before the app ever received the request — a
-- proxy/load-balancer timeout) means no row from THIS app can ever exist for
-- that request, by definition. The only way to see it at all is a client
-- self-report carrying the SAME id the client generated before the request
-- left the device, so a human can ask "does the server have any row for
-- this id" and get a real answer instead of two different ids that happen
-- to describe the same failed call. `client_reported` marks that a row
-- arrived this way rather than being written by the server observing its
-- own request.
--
-- ── ADDITIVE ONLY ──────────────────────────────────────────────────────────
--
-- One new table, four new indexes, one comment. No ALTER against an existing
-- table, no rename, no drop. An application running the OLD code against a
-- database with this migration applied behaves identically, because nothing
-- outside this feature reads or writes the table, and every column has a
-- sane default or is nullable.
--
-- REVERSED BY: DROP TABLE IF EXISTS request_failures;

-- MIGRATIONTXN-1 pattern (see 166) · explicit transaction so a failure
-- partway through (table created, an index fails) cannot leave a
-- half-applied object with no way to tell "fully applied" from "partial"
-- short of inspecting every object by hand.
BEGIN;

CREATE TABLE IF NOT EXISTS request_failures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── correlation · the spine, see header ─────────────────────────────────
  correlation_id    text NOT NULL,

  -- ── what was being served ────────────────────────────────────────────────
  route_path        text NOT NULL,
  http_method       text NOT NULL,

  -- ── the failure-class taxonomy · David's explicit five, plus UNKNOWN ────
  -- Rule 11 applied to failure diagnosis: these are different facts and must
  -- never collapse into one generic "error" bucket.
  --   EDGE           · failed before the app received the request at all
  --                    (proxy/load-balancer timeout). Never written by the
  --                    server observing itself — only by a client self-report
  --                    whose correlation_id has no matching server-side row,
  --                    or by an operator annotating a known gap.
  --   APPLICATION    · an unhandled exception or explicit error in app code.
  --   DATABASE_POOL  · a Postgres connection-pool exhaustion, query timeout,
  --                    or connection failure.
  --   UPSTREAM       · a failed call to an external service (Strava, Apple,
  --                    weather, etc). `upstream_service` names which.
  --   CLIENT_TIMEOUT · the client gave up / aborted before the server
  --                    responded (`NextRequest.signal` fired abort).
  --   UNKNOWN        · the classifier itself could not determine a class.
  --                    This is a DIFFERENT fact from "we know it was
  --                    APPLICATION" (Rule 11) — never silently coerced to
  --                    APPLICATION just because that happens to be the
  --                    default bucket elsewhere in the app.
  failure_class     text NOT NULL
                      CHECK (failure_class IN (
                        'EDGE', 'APPLICATION', 'DATABASE_POOL', 'UPSTREAM',
                        'CLIENT_TIMEOUT', 'UNKNOWN')),

  -- ── outcome ──────────────────────────────────────────────────────────────
  -- Nullable: an EDGE or CLIENT_TIMEOUT failure may have no status the
  -- server ever sent, and that absence is itself the fact worth keeping —
  -- coercing it to a fake 0 or 500 would be exactly the Rule 11 violation
  -- this table exists to avoid making.
  http_status       integer,
  duration_ms       integer,

  -- ── the error, sanitized before this row is ever built ──────────────────
  error_message     text,
  error_stack       text,

  -- ── only set when failure_class = 'UPSTREAM' ────────────────────────────
  upstream_service  text,

  -- ── the runner, if resolvable without extra work · Rule 14's population id
  user_uuid         uuid,

  -- ── small structured extras · never a raw request/response body ─────────
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── the code site that wrote this row ───────────────────────────────────
  source            text NOT NULL,

  -- ── true only for a row written from a client's own failure report ──────
  client_reported   boolean NOT NULL DEFAULT false,

  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The read every incident starts with: what happened recently, newest first.
CREATE INDEX IF NOT EXISTS request_failures_created_at
  ON request_failures (created_at DESC);

-- THE ROLLUP QUERY David asked for — "summarize recent failures by class":
--   SELECT failure_class, count(*) FROM request_failures
--    WHERE created_at > now() - interval '24 hours'
--    GROUP BY failure_class;
CREATE INDEX IF NOT EXISTS request_failures_class_at
  ON request_failures (failure_class, created_at DESC);

-- Reconstruct one request's full path across every row that shares its id
-- (a DB failure the route caught and re-raised as an application error, for
-- instance) — the reason the correlation id is threaded at all.
CREATE INDEX IF NOT EXISTS request_failures_correlation
  ON request_failures (correlation_id);

-- Per-route incident triage ("is this endpoint the one that's been 502ing").
CREATE INDEX IF NOT EXISTS request_failures_route_at
  ON request_failures (route_path, created_at DESC);

COMMENT ON TABLE request_failures IS
  'Durable, queryable log of every 5xx/timeout at the app layer, correlated by correlation_id and '
  'classified into EDGE/APPLICATION/DATABASE_POOL/UPSTREAM/CLIENT_TIMEOUT/UNKNOWN (never collapsed '
  'into one generic bucket, per CLAUDE.md Rule 11). Written by lib/observability/record.ts from '
  'instrumentation.ts (onRequestError, catches every unhandled route-handler exception app-wide) '
  'and from lib/observability/with-observability.ts (opt-in per-route wrapper for explicit 5xx '
  'responses and client-abort detection). Never holds secrets, auth material, health payloads, or '
  'raw request bodies — error_message/error_stack are sanitized before this row is built. '
  'NOT APPLIED TO PRODUCTION as of authoring; awaits explicit DDL approval per CLAUDE.md.';

COMMIT;
