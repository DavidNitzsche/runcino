# Multi-tenant schema spec

These SQL files are the **spec** for the multi-tenant cutover. They are
NOT yet applied — `web/lib/db.ts` still bootstraps the single-user
schema (`user_id TEXT 'me'`) which is what the current /web/ deployment
runs against.

When the /web/ port lands (v4 React components), this is the schema we
move to. Apply in numbered order against the existing database.

## Files

| File | What it adds |
| --- | --- |
| `001_auth.sql` | `users`, `sessions`, `password_resets` |
| `002_connectors.sql` | `connector_tokens`, `connector_sync_state` (replaces the single-user env-var Strava credentials) |
| `003_link_user_id.sql` | Adds `user_uuid UUID REFERENCES users(id)` to every existing user-scoped table; backfill plan |
| `004_drop_legacy_text_user_id.sql` | Final cutover — drops the old `user_id TEXT` columns once `user_uuid` is enforced not-null everywhere |
| `types.ts` | TypeScript type definitions matching the new tables (drop-in for /web/) |

## Cutover plan

1. **Apply 001 + 002** (purely additive — new tables, no impact on existing rows).
2. **Apply 003** — adds `user_uuid` columns to existing tables, nullable. Existing rows still keyed by `user_id TEXT='me'`.
3. **Backfill script** — once user signs up via the new auth flow:
   - Create a `users` row for the existing single-user (you, David).
   - `UPDATE` every table where `user_id='me'`, setting `user_uuid = <that-user's-uuid>`.
4. **Verify** — every row in `daily_checkin`, `personal_goals`, `profile`, `user_prefs`, `training_plans`, `plan_phases`, `plan_weeks`, `plan_workouts`, `plan_mutations`, `skipped_workouts`, `recovery_sessions`, `strava_activities`, `shoes` has a non-null `user_uuid`.
5. **Apply 004** — drops the legacy `user_id TEXT` columns, marks `user_uuid` NOT NULL, switches PKs/indexes.

This sequence avoids any downtime and is reversible up through step 4.

## Design choices

**UUID over BIGSERIAL for `users.id`**
- Won't leak user count via incrementing IDs in URLs.
- Strava tokens already keyed externally — having a UUID join key keeps things consistent for future webhook → user lookups.
- `gen_random_uuid()` is Postgres-native (pgcrypto), no extension needed in recent versions.

**Password hashing**: bcrypt with cost 12.
- Stored in `users.password_hash` (single column, includes salt + cost).
- Library: `bcryptjs` (pure-JS, no native build issues on Railway nixpacks).

**Session storage**: separate `sessions` table.
- Cookie holds an opaque session token (32 bytes, base64url).
- Server looks up `(session_token, expires_at > NOW())` on every request.
- Short-lived (default 30 days, refreshed on use).
- Could swap to signed JWTs later; table-backed is simpler + revokable.

**Connector tokens**: separate table per (user, provider).
- Strava tokens currently live in env vars + `strava_sync_state` for one user.
- New `connector_tokens` table: per-user encrypted access/refresh + scope + last-sync metadata.
- Same table will hold Garmin / Apple Health / Whoop / Oura / Coros / etc. when those land.

**Existing tables stay**: we do NOT drop and recreate.
- `daily_checkin`, `personal_goals`, `profile`, `user_prefs`, `training_plans` etc. keep their schema.
- Only addition: `user_uuid UUID REFERENCES users(id)` column.
- The eventual goal is to drop the legacy `user_id TEXT` column once `user_uuid` is enforced, but that's a final step.
