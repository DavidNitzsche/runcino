# Strava push surface · available for design

**As of commit `<next>` · 2026-06-01**

The runner can either auto-push every new run to Strava, or push specific
runs on demand. The backend exposes both today. Design agents picking up
the next pass on Activity / Today / Profile should know what's wired and
which fields the UI can read.

---

## API endpoints

### `GET /api/strava/push/[runId]` · per-run push state

Returns whether a specific run has been pushed yet, and the latest push
result if so.

```jsonc
// Never pushed:
{ "pushed": false, "status": "never" }

// Pushed successfully:
{
  "pushed": true,
  "pushId": 123,
  "status": "uploaded",            // 'uploaded' | 'pending' | 'failed' | 'duplicate' | 'never'
  "stravaActivityId": 18742199553,
  "title": "Long · base · 12.4 mi",
  "privacy": "private",
  "pushedAt": "2026-06-01T08:34:11Z",
  "completedAt": "2026-06-01T08:34:18Z",
  "error": null
}

// Last push failed:
{
  "pushed": false,
  "pushId": 99,
  "status": "failed",
  "error": "PUSH_401_REAUTH_REQUIRED",
  "pushedAt": "2026-05-28T09:12:00Z"
}
```

**Use it for:** rendering the Push / Pushed / Retry button on the
RunDetail drawer, the Activity log row chip, the post-run hero on /today.

### `POST /api/strava/push/[runId]` · push or retry one run

Body (all optional):

```jsonc
{
  "privacy": "private",            // 'private' | 'followers' | 'public'
  "title": "Custom title",
  "description": "Notes",
  "isRace": false
}
```

Returns the same `status` enum. **Idempotent** on `(user_uuid, run_id)` —
re-POSTing after a successful push returns the prior result without
re-uploading. Re-POSTing after a `failed` push retries.

### `POST /api/strava/push-recent` · batch backfill

When the runner first enables auto-push, they usually want their last
N days on Strava too. This endpoint pushes every eligible recent run
that hasn't been uploaded yet.

```jsonc
// Body:
{ "days": 14, "dryRun": false }

// Response:
{
  "ok": true,
  "days": 14,
  "candidates": 8,
  "pushed": [
    { "runId": "-16421550262950", "status": "uploaded", "stravaActivityId": 18742199553, "pushId": 124 }
  ],
  "skipped": [
    { "runId": "12345", "reason": "STRAVA_PUSH_NO_TCX_DATA" }
  ]
}
```

`dryRun: true` returns the candidate list without uploading anything ·
useful for a confirmation modal. Default 14 days, max 90.

**Eligibility rules** (encoded in the SQL):
- Canonical row only (no `mergedIntoId`, no `absorbed_into_canonical_at`)
- Source NOT `strava` or `strava_webhook` (don't push back to Strava
  what came FROM Strava)
- No prior push with status `uploaded` or `pending` exists
- Within `days` of today

### `GET /api/strava/pushes` · push history

Top 10 most recent pushes across all runs · already used by the
StravaConnectionCard on `/me` to render "Last 3 pushes" + retry buttons.

```jsonc
{
  "pushes": [
    {
      "id": 124,
      "run_id": "-16421550262950",
      "status": "uploaded",
      "strava_activity_id": 18742199553,
      "title": "Long · base · 12.4 mi",
      "privacy": "private",
      "error_message": null,
      "pushed_at": "2026-06-01T08:34:11Z",
      "completed_at": "2026-06-01T08:34:18Z"
    }
  ]
}
```

---

## Auto-push toggle

`profile.strava_auto_push` (boolean) controls whether new runs push
automatically. The runner toggles it in two places today:

- Web: `StravaConnectionCard` on `/me` · already wired with PATCH /api/settings
- iPhone: settings row coming in the next pass (the connect button just
  landed at commit `f57dbd21`; the auto-push toggle is the natural next
  step on the same row)

**Hook firing now** · every ingest path calls `lib/strava/auto-push.ts`:

| Ingest path | Hook | What gets pushed |
|---|---|---|
| `POST /api/ingest/workout` (HK + Apple Watch) | `maybeAutoPush(userId, slug)` | HK workout converted to canonical row |
| `POST /api/watch/workouts/complete` (Faff watch app) | `maybeAutoPush(userId, stableId)` | Watch-completion converted to canonical row |
| `POST /api/run/manual` (manual entry) | `maybeAutoPush(userId, slug)` | Hand-logged run |

The helper reads `profile.strava_auto_push` itself · ingest paths don't
duplicate the check. Fire-and-forget · failures are logged but never
block the ingest response.

---

## Doctrine

**Idempotent.** `pushRunToStrava` is idempotent on `(user_uuid, run_id)`.
A retry after a successful upload returns the prior result without
re-uploading. A retry after a failed upload re-attempts. The UI can
re-POST safely.

**Source-aware.** Runs whose `data.source` is `strava` or `strava_webhook`
are NEVER pushed · they're already on Strava. The push-recent endpoint's
SQL filter enforces this; the per-run POST is up to the caller (but
`pushRunToStrava` short-circuits with a `duplicate` status when the run's
provenance shows Strava as the originating source).

**Canonical-only.** Dedup-loser rows (rows with `mergedIntoId` set or
`absorbed_into_canonical_at` not null) are NEVER pushed. Only the
canonical winner per actual run.

**Voice doctrine still applies.** Push titles + descriptions are
generated from the canonical row · workout type, distance, phase. The
hardcoded "Long run · base · 12.4 mi" style is fine for now but if you're
authoring richer copy, use the coach's verdict from `/api/runs/[id]/recap`
as the title and the first fact as the description. Keep it plain
English · no PhD jargon (the engine already enforces this).

---

## Surfaces that should consume

### Web

| Surface | Endpoint | What it shows |
|---|---|---|
| `/today` post-run hero (CompletedHeroV2) | `GET /api/strava/push/[runId]` | "Push to Strava" button or "Pushed ↗" chip |
| `/me` StravaConnectionCard | `GET /api/strava/pushes` | Last 3 pushes + retry. ALREADY LIVE. |
| `/me` autoPush toggle | `PATCH /api/settings { strava_auto_push }` | Toggle. ALREADY LIVE. |
| Activity drawer (RunDetailModal) | `GET /api/strava/push/[runId]` | Same button as Today's hero |

### iPhone

| Surface | Endpoint | Notes |
|---|---|---|
| RunDetailView "Push to Strava" affordance | GET + POST `/api/strava/push/[runId]` | Native button; same idempotent contract |
| Settings → Strava row → "Push every new run" sub-toggle | `PATCH /api/settings { strava_auto_push }` | Next to the connect row · standard `Toggle` |
| Activity row chip | `GET /api/strava/push/[runId]` | Tiny "↗" if pushed |

---

## Smoke test

```bash
# Per-run state (returns 401 without auth)
curl -H "Cookie: faff_session=<token>" https://www.faff.run/api/strava/push/-16421550262950

# Dry-run backfill of last 14 days
curl -X POST -H "Cookie: faff_session=<token>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true,"days":14}' \
  https://www.faff.run/api/strava/push-recent

# Manual push of one run
curl -X POST -H "Cookie: faff_session=<token>" \
  https://www.faff.run/api/strava/push/-16421550262950
```

---

## Reference files

```
web-v2/app/api/strava/push/[runId]/route.ts   · GET + POST per-run
web-v2/app/api/strava/push-recent/route.ts    · POST batch backfill
web-v2/app/api/strava/pushes/route.ts         · GET history
web-v2/lib/strava/push.ts                     · core push engine
web-v2/lib/strava/auto-push.ts                · shared ingest hook
web-v2/lib/strava/build-tcx.ts                · TCX file builder
```

That's the whole surface. Open question for the design pass: should
the "Push to Strava" button surface push attempts that are still
`pending` (Strava is processing the upload), or only flip to "Pushed"
once Strava confirms terminal `uploaded`? Either decision is fine ·
the endpoint exposes both.
