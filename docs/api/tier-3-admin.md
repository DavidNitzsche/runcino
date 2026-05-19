# Tier 3 · Admin-only

All routes under `/api/admin/`.  Auth: admin session OR
`ADMIN_OPERATIONAL_TOKEN` env var via `requireAdminOrOpToken` /
`requireAdmin`.

**Off-limits to iPhone.**  These exist for diagnostics, audits, and
operational tasks; they are not user-facing surfaces.

## Diagnostic views (read-only)

These power admin debugging — surface the underlying state of adaptive
signals, sync jobs, and feature flags.  Many produce HTML/JSON hybrid
output meant for human review, not machine consumption.

| Route | What it shows |
|---|---|
| `GET /api/admin/l7-signal-view` | Signal 1 (threshold workouts) firing state per workout |
| `GET /api/admin/l7-signal2-view` | Signal 2 (Z2 pace at fixed HR) drift window |
| `GET /api/admin/l7-signal3-view` | Signal 3 (interval pace adherence) firing state |
| `GET /api/admin/l7-signal4-view` | Signal 4 (PR trajectory) PRs in 8-week window |
| `GET /api/admin/race-trajectory-view` | V3 trajectory state computation breakdown |
| `GET /api/admin/elevation-adjust-view` | S3 elevation-adjusted finish times per race |
| `GET /api/admin/post-race-view` | E2 post-race awareness state per race |
| `GET /api/admin/race-hr-diagnostic` | HR data integrity per race result |
| `GET /api/admin/readiness-view` | C6 readiness composite per day with score breakdown |
| `GET /api/admin/vdot-shift-view` | Large-shift guard state per user |
| `GET /api/admin/z2-coverage-view` | V5 Z2 stimulus check state |
| `GET /api/admin/z2-sparkline-view` | C2 sparkline raw data |
| `GET /api/admin/strava-gap-view` | E1/E4 gap state machine |
| `GET /api/admin/system-actions` | Aggregate of operational state (closes the round-2 F2 "did the auto-migration run?" question) |
| `GET /api/admin/audit-races` | Race-data integrity audit per L6 |
| `GET /api/admin/inspect-splits` | Per-activity splits validation |

## Operational write endpoints

| Route | Method | What it does |
|---|---|---|
| `POST /api/admin/set-fitness-config` | POST | Override fitness-engine params for a user |
| `POST /api/admin/backfill-splits` | POST | Recompute splits across all activities |
| `POST /api/admin/seed-orphan-races` | POST | Create race rows for races without one |
| `POST /api/admin/race-updates-2026-05-19` | POST | One-time batch update (dated; should be archived after run) |
| `POST /api/admin/users/[id]/[action]` | POST | User admin actions (impersonate, reset, etc.) |
| `POST /api/admin/strava-webhook` | POST | Manually trigger Strava webhook (test) |

---

## Auth shape

```typescript
// All routes:
const admin = await requireAdminOrOpToken(req);
// OR
const admin = await requireAdmin();
```

`requireAdminOrOpToken` accepts either an admin session cookie OR the
`X-Op-Token: $ADMIN_OPERATIONAL_TOKEN` header.  This is how operational
audits run from CLI/curl without an interactive session.

## Cleanup candidate

`POST /api/admin/race-updates-2026-05-19` is a one-time batch dated for
2026-05-19.  Should be archived after the run completes; leaving named
routes for past one-time updates clutters the admin namespace.
