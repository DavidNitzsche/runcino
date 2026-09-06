# Repair plan · corrupted active-energy history

**Prepared, not applied.** No SQL below has been run against production.

## What is broken

`REQUESTSTORM-2` (merged to `main`) traced the request flood to a
data-corruption bug: the phone sent every raw ~15-second HealthKit
active-energy bucket (thousands per day), split across up-to-21 sequential
request bodies of 500 samples each. `health_samples` upserts
`ON CONFLICT (user_id, sample_type, sample_date) DO UPDATE SET value =
EXCLUDED.value` — last write wins **per request body**, so only the final
chunk's tiny fragment of one day's buckets survived. Measured read-only against
production:

- 54 of 135 stored `active_energy` days under 100 kcal, 37 under 20
- 11.4 kcal stored for an 11.01-mile run day
- 2.1 kcal on an 8.02-mile day

## Why the repair is a resync, not a data patch

The raw buckets that would let a script recompute the correct totals were
**never stored** — `health_samples` only ever held the corrupted aggregate,
never the constituent buckets. There is nothing in the database to repair from.

But HealthKit **on the device** still holds every original bucket; nothing was
deleted there. The client-side fix (already merged) changes what gets sent:
`activeEnergyDailyTotals` now sums the day's buckets on the phone and sends
**one row per calendar day** instead of thousands of fragments. The server's
existing `ON CONFLICT ... DO UPDATE SET value = EXCLUDED.value` already
overwrites unconditionally for non-manual rows (this exact behavior was
added deliberately in a prior fix, `2026-06-05`, specifically so a corrected
value from a new build reaches rows that were wrong under an old one).

**So the fix is: ship the build, then run one HealthKit import covering the
corrupted date range.** The existing upsert does the rest — no manual UPDATE,
no backfill script, no destructive statement.

## The exact mechanism, for review

1. Client (next TestFlight build) computes `SUM(activeEnergy buckets)` per
   calendar day from HealthKit, for `daysBack` days.
2. Client POSTs one row per day: `{ sample_type: 'active_energy', value:
   <daily total>, sample_date: <day>, recorded_at: <now> }`.
3. Server: `INSERT ... ON CONFLICT (user_id, sample_type, sample_date) DO
   UPDATE SET value = EXCLUDED.value ... WHERE health_samples.source IS
   DISTINCT FROM 'manual'` — the corrected total replaces the corrupted one
   for every date in the sync window.

## What triggers the range needed

- Foreground/background sync only requests `daysBack: 2` or `daysBack: 7`
  (see `FaffApp.swift`), which will not reach back far enough to repair the
  full 54-day history in normal use.
- **A full historical resync is already wired**: `requestAuthAndImport
  (daysBack: 365)` — used at onboarding/reconnect — would cover the entire
  corrupted range in one pass.

## The recommended action, awaiting explicit go

**Do not run any SQL.** Instead: after the client fix ships and the owner
opens the app once, trigger a 365-day HealthKit re-import (existing
`requestAuthAndImport(daysBack: 365)` call, reachable today from the Health
connect/reconnect flow — no new code needed). That single import overwrites
every corrupted `active_energy` row with the correct daily total, using the
exact upsert path already in production.

If the owner would rather not go through the connect/reconnect flow, the
alternative is a one-time admin-triggered call to the same importer function
with `daysBack: 90` (covers back past 2026-06-01, the start of the corrupted
window) — still zero SQL, still using the existing idempotent upsert, and
still requires the owner's explicit go before it is invoked.

## Verification query, read-only, to confirm repair after either path runs

```sql
SELECT sample_date, value
  FROM health_samples
 WHERE user_id = '0645f40c-951d-4ccc-b86e-9979cd26c795'
   AND sample_type = 'active_energy'
   AND sample_date BETWEEN '2026-06-01' AND '2026-08-31'
 ORDER BY sample_date;
```

Expect values in the hundreds-to-low-thousands of kcal per active day, not the
single digits currently on record for 54 of the 135 stored days.
