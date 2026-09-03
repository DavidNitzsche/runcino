# The visual walk substrate

A local, writable, throwaway Postgres database holding a **copy** of the
reference runner's real rows, plus a real session token for his uuid in that
copy, so the iPhone app can be walked against real data with no possibility of
touching production.

Built by `web-v2/scripts/walk-substrate.ts`. Served by
`web-v2/scripts/walk-server.sh`.

---

## Why it exists

Rule 13: a fix to something the runner sees is verified by RENDERING it, with
real data. Never against a sample fixture, because a fixture skips the exact
code paths that break.

Everything the phone reads is behind `requireUserId`, so a walk needs a
session. There were three ways to get one and two of them are forbidden:

1. **Sign in as the owner.** Needs his password. Never.
2. **Add a dev auth bypass to the app.** A permanent hole in the real product
   so that a verification run can be convenient. Never. Nothing in this work
   touches the auth decision path.
3. **Copy his rows into a local scratch database and mint a session there.**
   This.

The session is an ordinary `sessions` row that the app's own resolver accepts
on its own terms. The build script proves that by calling
`userIdFromRequest` on the token it just wrote, and refuses to print a token it
cannot demonstrate works.

---

## Stand it up

```bash
# 1 · build the substrate and mint the session
bash web-v2/scripts/walk-substrate.sh

# 2 · serve it on :3111, which is the host native-v2 already targets
bash web-v2/scripts/walk-server.sh

# 3 · prove the session works before trusting a single screenshot
curl -sS -w '\nHTTP %{http_code}\n' \
  -H "Authorization: Bearer $(cat web-v2/.walk-session-token)" \
  http://localhost:3111/api/v5/today
```

`web-v2/.env.local` must carry `DATABASE_URL_RO` (the `faff_readonly` role).
`DATABASE_URL_RO` in the environment wins over the file if both are present.
The token is printed and also written to `web-v2/.walk-session-token`, mode
600, gitignored.

Knobs, all optional: `FAFF_WALK_DB` (default `faff_visual_walk`),
`FAFF_WALK_PORT` (default `3111`), `FAFF_WALK_OWNER_UUID`.

### Tear-down

```bash
dropdb -h localhost faff_visual_walk
rm -f web-v2/.walk-session-token
```

Nothing else persists. The substrate is a database and a file.

---

## What it copies

The copier is **not new**. `web-v2/scripts/adapt-harness-substrate.sh` already
does this job for the adaptation harness; the walk points it at a database of
its own via `FAFF_HARNESS_DB` and calls it. There is one copier in this repo
and this is not a second one.

It clones production's schema (structure only, through `pg_dump --schema-only`)
and then copies, scoped to the owner's uuid:

- **every `public` table carrying a `user_uuid` column** — 46 of the 55 base
  tables, which covers `runs`, `plan_workouts`, `plan_weeks`, `plan_phases`,
  `training_plans`, `races`, `profile`, `user_prefs`, `coach_intents`,
  `shoes`, `health_samples`, `readiness_snapshots`, `projection_snapshots`,
  `goal_projection_snapshots`, `day_actions`, `niggles`, `sick_episodes`,
  `strength_sessions`, `workout_routes`, `device_tokens`, `notifications_*`,
  `strava_pushes`, `subjective_checkins`, `runner_calibration` and the rest
- `users`, filtered to `id = <owner>`
- `coach_intents` also picks up legacy rows where `user_uuid` is null and
  `user_id` holds the uuid
- the global reference tables, whose rows are shared training knowledge rather
  than anyone's data: `course_library`, `learn_articles`, `niggle_recovery`,
  `workout_weather_cache`

A representative run: 275 runs, 4,021 plan_workouts, 48 training_plans, 11
races, 558 plan_weeks, 316 coach_intents, 4,218 health_samples, 95
readiness_snapshots, 8 shoes.

Then it advances every sequence past its table's max, restores the CHECK
constraints `NOT VALID` (production's own posture, so the owner's
grandfathered rows load and new writes are still checked), and the walk script
deletes every copied `sessions` row and mints exactly one. That last step
matters: the printed token is the **only** key to the database, so an
authenticated 200 cannot have come from some other credential.

## What it deliberately does not copy

- **Production `sessions`.** Copied by the table sweep, then deleted. Keeping
  them would leave hashes of live tokens in a scratch database for no benefit.
- **Tables with no user column that are not reference data**:
  `data_migrations`, `ops_alerts`, `strava_webhook_events`,
  `strava_webhook_subscriptions`. Nothing the phone renders reads them.
- **`sick_recovery`.** A child of `sick_episodes` keyed by `episode_id` with
  no user column, so the sweep skips it and it arrives empty. Only ever
  written by `/api/sick/recovery` and `/api/notifications/ack`; no phone
  surface reads it back. Named here so an empty table is a known fact rather
  than a mystery.
- **Anything from another account.** Every copy is scoped by uuid. This is not
  a database clone.
- **No time shift.** The adaptation harness slides the whole history forward so
  a finished block straddles today. The walk does not: the runner's rows
  already run up to today, and a walk should show what he would actually see.

---

## How production is protected

Four fences. Each was made to fail on purpose before being relied on (Rule 18);
the falsification for each is written beside it.

### 1 · Privilege, proved by the server

The only production connection is `DATABASE_URL_RO`, whose role is
`faff_readonly`. The script does not assert this, it asks production:
`has_table_privilege` for INSERT / UPDATE / DELETE / TRUNCATE across the ten
tables the walk reads, plus `has_database_privilege(..., 'CREATE')`. Any yes,
or a role name that does not look read-only, is a refusal.

*Falsified* by handing it a "read-only" URL whose role can actually write,
exactly as a mistyped `.env.local` would:

```
[walk] REFUSING TO RUN
  the production connection is not read-only. Role 'david' on '…'.
    holds INSERT/UPDATE/DELETE/TRUNCATE on runs
    … (ten tables)
    holds CREATE on the database
    and the role name does not look read-only
```

### 2 · Statement classification at the call site

Every statement the script sends to production goes through `productionRead`,
which runs `classifyStatement` (the write barrier's own allow-list: a statement
passes only if it is recognisably a read, and anything unparseable is refused)
and throws before the driver sees it. The run reports what it issued:
`3 statements issued by this process, 0 mutating`.

*Falsified on every run:* the script classifies a plain `UPDATE` and stops if
the classifier calls it a read, and classifies a plain `SELECT` and stops if it
calls that a write. A guard that says no to everything is an outage, not a
guard.

**Why this is at the call site and not left to the global barrier.** This is
worth stating plainly, because the assumption that the global barrier covered
it was wrong and nearly shipped a real production write.
`installProductionWriteBarrier` patches `pg`'s prototypes, but the patched
`query` calls `judge(text)` with no url, so the target it judges against is
`process.env.DATABASE_URL`. In this process that is the **loopback scratch
database**, because that is what the walk writes. So the global barrier reports
`writes permitted (loopback)` and would have let a mutating statement through
on the *production* client this process also holds. A process holding two
connections is fenced only for the one the environment names. Fences 1 and 2
are what cover the production connection.

### 3 · The local-target fence

`inspectConnectionString` from `lib/adaptation-harness/fence.ts` refuses any
`DATABASE_URL` that is not loopback and not named `faff_visual_walk`. Checked
before the first query and before the production credential is even read. The
predicate was already owned by the harness fence; it gained an optional
`expectedDb` argument rather than being copied.

*Falsified*, twice:

```
$ DATABASE_URL=postgresql://u:p@crossover.proxy.rlwy.net:20769/railway \
    bash web-v2/scripts/walk-substrate.sh
[walk] REFUSING TO RUN
  DATABASE_URL points at host 'crossover.proxy.rlwy.net', which is not loopback.
exit 2

$ DATABASE_URL=postgresql://localhost:5432/faff_sandbox \
    bash web-v2/scripts/walk-substrate.sh
[walk] REFUSING TO RUN
  DATABASE_URL names database 'faff_sandbox', not 'faff_visual_walk'. Being
  local is not enough — this tooling truncates and rewrites every table it
  touches, so it must own the database it is pointed at.
exit 2
```

Being local is not sufficient, because the script TRUNCATES and rewrites every
table in whatever it is pointed at.

### 4 · The copier's own check

`adapt-harness-substrate.sh` independently refuses if `DATABASE_URL_RO`
connects as a role whose name does not look read-only. Its production traffic
is a second channel this process does not classify: `psql` issuing `SELECT` and
`\copy (SELECT …) TO STDOUT`. Both are reads by construction and both run as
`faff_readonly`, so fence 1 covers them. Said out loud because "no write
reached production" has to account for every channel or it is a sentence about
one of them.

### The independent check afterwards

The walk's token hash does not exist in production, and the owner's production
session count is unchanged at the number that was copied:

```
role: faff_readonly
walk token hash present in PRODUCTION sessions: 0
walk token hash present in SCRATCH sessions:    1
production sessions rows for the owner:         630
```

---

## The proof that it works

Against the walk server, with the printed token:

```
### 1 · NO token                → HTTP 401  {"error":"Unauthorized"}
### 2 · BAD token, right shape  → HTTP 401  {"error":"Unauthorized"}
### 3 · the walk token          → HTTP 200  4377 bytes
```

and across the phone's surface:

```
/api/v5/today              200   /api/records            200
/api/v5/block              200   /api/coach/log          200
/api/v5/races              200   /api/shoe               200
/api/plan/week             200   /api/streak             200
/api/profile               200   /api/health/state       200
/api/settings              200   /api/training/state     200
/api/readiness             200   /api/watch/today        200
/api/targets/projection    200
```

Real content, not an empty 200. `/api/v5/today` for 2026-09-03 returns
`state: before_run`, panel `Intervals · 6.5 mi · about 50 min`, a week strip
with the completed days marked, and a coaching thesis whose limiter is
`DURABILITY`. `/api/v5/races` returns California International Marathon, goal
`3:00:00`, projected `3:19:43`, 94 days out, with the Santa Monica 10k on the
schedule.

Two non-200s, both correct app behaviour rather than substrate failures:
`/api/v5/paces` answers 404 `no_pace_change` ("You have already settled this
one"), which is its documented empty state, and `/api/v5/race-authority` is
POST-only so GET is 405. Both prove the session resolved, since neither is 401.

**The 401/200 pair is also the proof of which database the server is reading.**
`next dev` loads `.env.local`, which holds the production connection string.
`@next/env` does not overwrite a variable already present in `process.env`, so
the export in `walk-server.sh` wins — but that is a claim about a library's
precedence rule, and Rule 20 says a claim with no check is a hypothesis. The
token exists only in the scratch database, so an authenticated 200 is the
check. Run the curl before trusting a screenshot.

---

## What this substrate CANNOT prove

Rule 22: say what the gate is structurally incapable of catching.

- **It is a snapshot.** Anything written to production after the copy is
  invisible here, and anything the walk writes stays local. A screenshot off
  this substrate is evidence about the CODE, not about production's current row
  values. Rebuild it if the question is about today's rows.
- **No cron has run against it.** `run-adaptations`, `plan-drift` and the
  notification jobs are not fired by standing it up, and the in-process
  heartbeat does not start without `CRON_SECRET`. Anything whose state is
  produced by a scheduled job is frozen at whatever production held when the
  copy was taken. A walk cannot tell you what tomorrow's adaptation will do.
- **Third-party calls are not stubbed and not configured.** Strava, Apple push
  and the weather provider have no credentials in a walk shell, so a surface
  that depends on a live external fetch shows its failure path. That is a real
  path, but it is not the one under test.
- **It says nothing about the phone binary.** It stands up the server half.
  Which build of the app points at port 3111, and whether that build is a debug
  build serving a stale cache, is a separate question and the one that has
  burned this project before.
- **It cannot detect that the copy is incomplete in a way nobody thought of.**
  The liveness floors assert "this is a real runner's history" (200+ runs, 200+
  plan_workouts, at least one plan, race, profile and prefs row). They do not
  and cannot assert that every table a future surface reads arrived. A surface
  that renders empty here should be checked against production before being
  filed as a defect.
- **It proves nothing about multi-user behaviour.** One account, by design.
  Cross-tenant leaks are invisible to it because there is nothing to leak from.

---

## Notes for whoever runs it next

- **Do not pipe the build to `head`.** Truncating the pipe kills the script
  with EPIPE partway through, and the window where that hurts is between
  clearing the sessions table and minting the new one: the token file then
  holds a key to a database that no longer has it, and every request 401s while
  the file looks fine. The script now re-reads the file from disk and resolves
  it before printing, so this fails loudly instead of quietly, but the cheapest
  fix is to redirect to a file.
- **Port 3111 may already be taken.** If another `next dev` holds it, that
  server is almost certainly pointed at production. Do not curl it expecting
  the walk. Either stop it, or set `FAFF_WALK_PORT` and point the phone
  somewhere else for the run.
- **`--refresh` drops and rebuilds the database.** The copier terminates other
  backends first, so stop the walk server before rebuilding.
