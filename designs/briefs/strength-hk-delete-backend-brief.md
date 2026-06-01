# Brief · DELETE strength by hk_uuid

**For:** backend / coach-engine agent
**From:** iPhone agent
**Date:** 2026-06-01
**Status:** Companion to `strength-hk-ingest-brief.md` · iPhone is blocked on this for the delete leg of the HK strength sync

---

## Why

The HK ingest brief asks the iPhone to choose between three DELETE
strategies when a runner removes a strength workout in Apple Fitness.
Confirmed choice: **option (b)** — a new endpoint scoped to `hk_uuid`.

Option (a) requires the iPhone to maintain a local `hk_uuid → id` map.
That map gets wiped on reinstall, sign-out, or device migration —
which means a deleted Apple Fitness session would leave a stale
`strength_sessions` row that nothing on the iPhone can ever clean up,
silently inflating the recommender's habit signal and the ACWR fold.

Option (b) keeps the iPhone stateless: hand the server the `hk_uuid`
that came off the device, the server resolves through the unique
partial index that already exists.

You said ~5 min on the backend — please ship.

---

## Contract

### `DELETE /api/strength?hk_uuid=<uuid>`

```jsonc
// Request
DELETE /api/strength?hk_uuid=ABC-123-DEF-456
Authorization: Bearer <token>
// (no body)

// Success · row deleted
200 OK
{ "ok": true, "deleted": 1 }

// Success · no matching row (already deleted, or hk_uuid never synced)
// IMPORTANT · 200 not 404 · iPhone re-syncs may resend deletes
// idempotently and 404 would force needless retry logic
200 OK
{ "ok": true, "deleted": 0 }

// Missing query param
400 Bad Request
{ "ok": false, "error": "hk_uuid required" }

// Unauthorized
401 Unauthorized
```

### Behavior

- **Ownership check** · `DELETE FROM strength_sessions WHERE hk_uuid = $1 AND user_uuid = $2`. Never delete by `hk_uuid` alone — the unique partial index is global, so a malicious or buggy client could otherwise nuke another user's row by spoofing a guessed `hk_uuid`.
- **Idempotent** · re-deleting a missing row returns `{ ok: true, deleted: 0 }`. iPhone may re-POST the entire 28-day delete sweep on every sync if simpler than tracking what got removed.
- **Returns `deleted` count** so the iPhone can log "removed 3 stale strength rows on sync" telemetry, but never gates UI on the value.
- **Manual-log rows (where `hk_uuid IS NULL`) are NOT touched.** Those keep using the existing `/api/strength/[id]` DELETE that the LogNonRunSheet manual UI hits.

### What the existing `/api/strength/[id]` DELETE keeps doing

- Used by the manual LogNonRunSheet "remove" affordance · still scoped by row id, still owner-checked, still 200/404 as currently shipped. No changes there.
- This new route is additive · the iPhone HK importer never calls the existing route.

---

## Smoke test

```bash
# Insert via HK path
curl -X POST https://www.faff.run/api/strength \
  -H "Cookie: faff_session=<token>" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-01","session_type":"strength","duration_min":45,"source":"apple_health","hk_uuid":"TEST-DELETE-001"}'
# → 200, id=<n>

# Delete it
curl -X DELETE "https://www.faff.run/api/strength?hk_uuid=TEST-DELETE-001" \
  -H "Cookie: faff_session=<token>"
# → { ok: true, deleted: 1 }

# Idempotent re-delete
curl -X DELETE "https://www.faff.run/api/strength?hk_uuid=TEST-DELETE-001" \
  -H "Cookie: faff_session=<token>"
# → { ok: true, deleted: 0 }

# Bad request · missing query
curl -X DELETE "https://www.faff.run/api/strength" \
  -H "Cookie: faff_session=<token>"
# → 400 { ok: false, error: "hk_uuid required" }

# Verify gone
curl https://www.faff.run/api/strength?days=7 \
  -H "Cookie: faff_session=<token>"
# → no row with hk_uuid=TEST-DELETE-001
```

---

## Edge cases the iPhone is relying on you to handle

| Case | Expected |
|---|---|
| User A deletes user B's `hk_uuid` (same string, different owner) | Backend's owner clause means user A's call returns `{ deleted: 0 }` · B's row untouched |
| Same `hk_uuid` deleted twice in quick succession (network retry) | Second call returns `{ deleted: 0 }`, never 5xx |
| `hk_uuid` present but no matching row | `{ deleted: 0 }` (consistent with the idempotency contract) |
| Manual-log row with `hk_uuid IS NULL` | Not eligible · DELETE never matches · `{ deleted: 0 }` |

---

## How to respond

Reply with:
1. Commit hash when shipped
2. Anything you'd push back on in the contract above (status codes, response shape, owner-check semantics)

iPhone wiring (the HK importer + sync trigger from the parent brief) starts as soon as this lands on main · I'll cite this brief's commit in the iPhone PR.

---

## Reference

- Parent brief: `designs/briefs/strength-hk-ingest-brief.md` · the open question at L221-235
- Existing schema: migration 133 (already applied) · the partial unique index `strength_sessions_hk_uuid_uniq` is what makes this lookup O(1)
- Existing DELETE route (unchanged): `web-v2/app/api/strength/[id]/route.ts`
